import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  awaitNativeDeployResult,
  handleNativeThinkPublish,
  nativeReleaseScriptName,
  PUBLISHER_ARTIFACT_VERSION,
  parseStockDeploymentUrl,
  validNativeSlug,
  verifyNativePublicRoute,
} from "../cloudflare/staging/native-publish";

const revisionA = "a".repeat(40);
const revisionB = "b".repeat(40);
const agentId = "11111111-2222-4333-8444-555555555555";
const slug = "northstar-coffee-live";
const publicUrl = `https://${slug}.lab-apps.buildcustom.ai/`;
const oldScript = "northstar-coffee";
const oldRoute = JSON.stringify({ scriptName: oldScript, metadata: { styleCssFallback: true } });
const indexHtml =
  '<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body><h1>BUILDCUSTOM_TASK3_EDIT_OK</h1><p>Fresh coffee. Simple mornings.</p></body></html>';
const stylesCss = "body { background: #0f141c; }\n";
const project = {
  id: 10,
  name: "Northstar Coffee",
  user_id: "owner-a",
  runtime_provider: "stock-think",
  deployment_script_name: oldScript,
};
const owner = { id: "owner-a" };
const wrongOwner = { id: "owner-b" };
const validScript = (rev = revisionA, linkedAgentId = agentId) =>
  `bc-r-${createHash("sha256").update(`${linkedAgentId.toLowerCase()}:${rev.toLowerCase()}:${PUBLISHER_ARTIFACT_VERSION}`).digest("hex").slice(0, 56)}`;

class MockSocket extends EventTarget {
  sent: string[] = [];
  closed = false;
  accept() {}
  send(value: string) { this.sent.push(value); }
  close() { this.closed = true; }
  message(value: unknown) { this.dispatchEvent(new MessageEvent("message", { data: value })); }
}

type FixtureOptions = {
  legacy?: boolean;
  revision?: string;
  inlineStylesOnly?: boolean;
  missingStylesheet?: boolean;
  failCandidateAsset?: boolean;
  failCandidateRender?: boolean;
  failStableAfterSwitch?: boolean;
  loseClaimOnStableFailure?: boolean;
  expireClaimBeforeActivation?: boolean;
  preexistingExpiredClaim?: boolean;
  candidateProbeStatus?: number;
  stockAlreadyExists?: boolean;
  failBatch?: boolean;
  failBatchOnce?: boolean;
  failRoutePutOnce?: boolean;
  collisionScript?: string;
  stockUrl?: (scriptName: string) => string;
  holdDeploy?: boolean;
  launch?: boolean;
  launchSourceHtml?: boolean;
  failLaunchRouteCheck?: boolean;
};

function fixture(options: FixtureOptions = {}) {
  const currentRevision = options.revision ?? revisionA;
  const events: string[] = [];
  const browserVisits: { url: string; mappedScript: string | null }[] = [];
  const defaultLegacy = options.legacy !== false;
  const state: any = {
    releases: defaultLegacy ? [{
      id: 1,
      user_id: "owner-a",
      project_id: 10,
      revision: revisionA,
      script_name: oldScript,
      slug,
      public_url: publicUrl,
      status: "published",
      created_at: "2026-09-25 23:24:36",
    }] : [],
    link: {
      agent_id: agentId,
      initialization_status: "ready",
      hosting_provider: "cloudflare",
      subdomain_slug: slug,
      deployment_script_name: defaultLegacy ? oldScript : null,
      deployment_url: defaultLegacy ? publicUrl : null,
      deployment_origin_url: null,
    },
    claimToken: null as string | null,
    claimExpired: false,
    uploadedScripts: new Set<string>(),
    failBatchOnce: options.failBatchOnce ?? false,
    failRoutePutOnce: options.failRoutePutOnce ?? false,
    route: defaultLegacy ? oldRoute : null as string | null,
  };
  const authoritativeHtml = options.inlineStylesOnly
    ? '<!doctype html><html><head><style>body{color:#123}</style></head><body><h1>BUILDCUSTOM_NEW_USER_OK</h1></body></html>'
    : options.launchSourceHtml
      ? indexHtml.replace('href="/styles.css"', `href="/p/${slug}/styles.css"`)
      : indexHtml;
  if (options.preexistingExpiredClaim) {
    state.claimToken = "expired-old-claim";
    state.claimExpired = true;
  }
  const query = (sql: string, values: unknown[]) => {
    if (sql.includes("SELECT subdomain_slug,hosting_provider")) return state.link;
    if (sql.includes("SELECT agent_id,initialization_status,hosting_provider")) return state.link;
    if (sql.includes("SELECT agent_id,initialization_status,deployment_script_name,deployment_url")) return state.link;
    if (sql.includes("WHERE script_name=? AND project_id<>?")) {
      return options.collisionScript === values[0] ? { project_id: 99 } : null;
    }
    if (sql.includes("WHERE deployment_script_name=?")) {
      return options.collisionScript === values[0] ? { project_id: 99 } : null;
    }
    if (sql.includes("SELECT project_id FROM runtime_project_links")) return null;
    if (sql.includes("SELECT user_id FROM projects")) return { user_id: "owner-a" };
    if (sql.includes("SELECT * FROM native_publish_releases") && sql.includes("status='pending'")) {
      return state.releases.find((row: any) =>
        row.project_id === values[0] && row.revision === values[1]
        && row.script_name === values[2] && row.status === "pending",
      ) || null;
    }
    if (sql.includes("SELECT * FROM native_publish_releases") && sql.includes("script_name=?")) {
      return state.releases.find((row: any) =>
        row.project_id === values[0] && row.revision === values[1]
        && row.script_name === values[2] && row.status === "published",
      ) || null;
    }
    if (sql.includes("SELECT * FROM native_publish_releases") && sql.includes("ORDER BY id DESC LIMIT 1")) {
      return state.releases.filter((row: any) => row.project_id === values[0] && row.status === "published").at(-1) || null;
    }
    if (sql.includes("INSERT INTO native_publish_claims")) {
      if (state.claimToken && !state.claimExpired) return null;
      state.claimToken = String(values[1]);
      state.claimExpired = false;
      return { project_id: values[0] };
    }
    if (sql.includes("SELECT claim_token FROM native_publish_claims")) {
      return state.claimToken === values[1] && !state.claimExpired ? { claim_token: state.claimToken } : null;
    }
    if (sql.includes("UPDATE runtime_project_links SET deployment_url")) {
      state.link = {
        ...state.link,
        deployment_url: values[0],
        deployment_origin_url: values[1],
        deployment_script_name: values[2],
        subdomain_slug: values[3],
      };
      return null;
    }
    if (sql.includes("INSERT INTO native_publish_releases")) {
      const row = {
        id: state.releases.length + 1,
        user_id: values[0],
        project_id: values[1],
        revision: values[2],
        script_name: values[3],
        slug: values[4],
        public_url: values[5],
        status: sql.includes("'pending'") ? "pending" : "published",
        created_at: "2026-09-26 00:00:00",
      };
      events.push(`d1:release:${row.status}`);
      state.releases.push(row);
      return row;
    }
    if (sql.includes("UPDATE native_publish_releases SET status='published'")) {
      const row = state.releases.find((release: any) =>
        release.project_id === values[0] && release.revision === values[1]
        && release.script_name === values[2] && release.status === "pending",
      );
      if (!row) return null;
      row.status = "published";
      events.push("d1:release:published");
      return row;
    }
    if (sql.includes("DELETE FROM native_publish_claims")) {
      if (state.claimToken === values[1]) {
        state.claimToken = null;
        state.claimExpired = false;
      }
      return null;
    }
    return null;
  };
  const db: any = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement: any = {
        sql,
        values,
        bind(...bound: unknown[]) { values = bound; statement.values = values; return statement; },
        async first() { return query(sql, values); },
        async all() {
          if (sql.includes("FROM native_publish_releases") && sql.includes("project_id=?")) {
            return { results: state.releases.filter((row: any) => row.project_id === values[0]) };
          }
          return { results: [] };
        },
        async run() { query(sql, values); return { meta: { changes: 1 } }; },
      };
      return statement;
    },
    async batch(statements: any[]) {
      events.push("d1:batch");
      if (options.failBatch || state.failBatchOnce) {
        state.failBatchOnce = false;
        throw new Error("D1 unavailable");
      }
      return statements.map((statement) => ({ results: [query(statement.sql, statement.values)] }));
    },
  };
  const routes = new Map<string, string>();
  if (state.route !== null) routes.set(slug, state.route);
  const routeStore = {
    async get(key: string) { return routes.get(key) ?? null; },
    async put(key: string, value: string) {
      routes.set(key, value);
      state.route = value;
      events.push(`kv:${JSON.parse(value).scriptName}`);
      if (state.failRoutePutOnce) {
        state.failRoutePutOnce = false;
        throw new Error("KV write response was lost.");
      }
    },
    async delete(key: string) { routes.delete(key); state.route = null; },
  };
  function routeTarget(host: string) {
    if (host === `${slug}.lab-apps.buildcustom.ai`) {
      try { return JSON.parse(state.route || "null")?.scriptName ?? slug; } catch { return null; }
    }
    if (host === "buildcustom-apps-gateway-launch.thegoldimport.workers.dev") {
      try { return JSON.parse(state.route || "null")?.scriptName ?? slug; } catch { return null; }
    }
    return host.split(".")[0];
  }
  const gateway = {
    async fetch(request: Request) {
      const url = new URL(request.url);
      if (options.inlineStylesOnly && url.pathname.endsWith("/styles.css")) {
        events.push("unexpected-stylesheet-request");
        return new Response("Not found", { status: 404 });
      }
      if (options.launch && url.hostname !== "buildcustom-apps-gateway-launch.thegoldimport.workers.dev") {
        events.push(`unexpected-host:${url.hostname}`);
        return new Response("Direct runtime-host access is not permitted.", { status: 404 });
      }
      const candidatePath = url.pathname.match(/^\/c\/([a-z0-9_-]+)(\/.*)?$/);
      const stableLaunchPath = url.pathname.match(/^\/p\/([a-z0-9-]+)(\/.*)?$/);
      const target = candidatePath ? candidatePath[1] : routeTarget(url.hostname);
      events.push(`fetch:${target}:${url.pathname}`);
      events.push(`request:${url.origin}${url.pathname}`);
      if (!target) return new Response("Not found", { status: 404 });
      if (url.pathname.endsWith("/_buildcustom/route-check") && stableLaunchPath) {
        const mapped = (() => { try { return JSON.parse(state.route || "null")?.scriptName ?? null; } catch { return null; } })();
        if (!mapped) return new Response("Not found", { status: 404 });
        return Response.json({
          ok: true,
          project: options.failLaunchRouteCheck && mapped === validScript(currentRevision) ? "wrong-project" : stableLaunchPath[1],
          scriptName: mapped,
        });
      }
      if (candidatePath && request.headers.get("X-BuildCustom-Verify-Source") === "1") {
        assert.equal(url.pathname, `/c/${candidatePath[1]}/` + (url.pathname.endsWith("/styles.css") ? "styles.css" : ""));
        if (url.pathname.endsWith("/styles.css")) {
          return new Response(stylesCss, { headers: { "content-type": "text/css" } });
        }
        return new Response(authoritativeHtml, { headers: { "content-type": "text/html" } });
      }
      if (target.startsWith("bc-r-") && options.candidateProbeStatus !== undefined
        && !state.uploadedScripts.has(target)) {
        return new Response("candidate probe status", { status: options.candidateProbeStatus });
      }
      if (target.startsWith("bc-r-") && !state.uploadedScripts.has(target)) {
        return new Response("The shared dispatcher could not resolve this candidate.", { status: 500 });
      }
      if (options.failCandidateAsset && target === validScript(currentRevision) && url.pathname.endsWith("/styles.css")) {
        return new Response("missing", { status: 404, headers: { "content-type": "text/html" } });
      }
      if (url.pathname.endsWith("/styles.css")) {
        return new Response(stylesCss, { headers: { "content-type": "text/css" } });
      }
      if (candidatePath && !request.headers.has("X-BuildCustom-Verify-Source")) {
        return new Response(authoritativeHtml.replace('href="/styles.css"', `href="/c/${candidatePath[1]}/styles.css"`), { headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/" || url.pathname.startsWith("/p/") || (candidatePath && url.pathname.endsWith("/"))) {
        return new Response(authoritativeHtml, { headers: { "content-type": "text/html" } });
      }
      return new Response("Not found", { status: 404 });
    },
  };
  const browser = {
    async quickAction(_action: string, actionOptions: any) {
      const url = new URL(actionOptions.url);
      const candidate = url.pathname.match(/^\/c\/([a-z0-9_-]+)(\/.*)?$/);
      const target = candidate ? candidate[1] : routeTarget(url.hostname);
      browserVisits.push({ url: url.toString(), mappedScript: state.route ? JSON.parse(state.route).scriptName : null });
      if (options.failCandidateRender && target === validScript(currentRevision)) {
        return new Response("Candidate render failed", { status: 502 });
      }
      if (options.failStableAfterSwitch && url.hostname === `${slug}.lab-apps.buildcustom.ai`
        && target === validScript(currentRevision)) {
        if (options.loseClaimOnStableFailure) {
          state.claimToken = "replacement-claim";
          state.claimExpired = false;
        }
        return new Response("Switched candidate render failed", { status: 502 });
      }
      if (options.failStableAfterSwitch && url.hostname === "buildcustom-apps-gateway-launch.thegoldimport.workers.dev"
        && target === validScript(currentRevision)) {
        if (options.loseClaimOnStableFailure) {
          state.claimToken = "replacement-claim";
          state.claimExpired = false;
        }
        return new Response("Switched candidate render failed", { status: 502 });
      }
      return new Response(JSON.stringify({ result: authoritativeHtml }), {
        headers: { "content-type": "application/json" },
      });
    },
  };
  const env: any = {
    ENVIRONMENT: options.launch ? "production" : "staging",
    CONTROL_PLANE_PROFILE: options.launch ? "launch" : undefined,
    DB: db,
    STAGING_ROUTE_KV_ID: options.launch ? "248ac5b6821a475794a7fe3d2b0c3718" : "test-routes",
    STAGING_ROUTES: routeStore,
    LAB_APPS_GATEWAY: gateway,
    STAGING_MANAGED_GATEWAY_URL: options.launch ? "https://buildcustom-apps-gateway-launch.thegoldimport.workers.dev/p" : undefined,
    STAGING_GATEWAY: options.launch ? gateway : undefined,
    BROWSER: browser,
  };
  let revisionReads = 0;
  let deploys = 0;
  let completeDeploy!: () => void;
  const dependencies: any = {
    async readRuntime(_env: any, _request: Request, _project: any, operation: string, path?: string) {
      if (operation === "status") return { state: { generation: { status: "idle" } } };
      if (operation === "revision") {
        revisionReads++;
        return { commitHash: currentRevision };
      }
      if (operation === "files") return options.inlineStylesOnly
        ? [{ path: ".think/space.json" }, { path: "public/index.html" }, { path: "src/index.ts" }, { path: "wrangler.json" }]
        : options.missingStylesheet ? [{ path: "public/index.html" }]
          : [{ path: "public/index.html" }, { path: "public/styles.css" }];
      if (operation === "files/content" && path === "public/index.html") return { path, content: authoritativeHtml };
      if (operation === "files/content" && path === "public/styles.css"
        && !options.inlineStylesOnly && !options.missingStylesheet) return { path, content: stylesCss };
      return null;
    },
    async openSocket(_env: any, _request: Request, linkedAgentId: string) {
      assert.equal(linkedAgentId, agentId);
      return {} as WebSocket;
    },
    async waitForDeploy(_socket: WebSocket, expectedRevision: string) {
      const scriptName = validScript(expectedRevision);
      deploys++;
      events.push(`stock:${expectedRevision}`);
      if (options.stockAlreadyExists) {
        throw new Error("Cloudflare dispatch script already exists; refusing immutable upload.");
      }
      state.uploadedScripts.add(scriptName);
      const deployedUrl = options.stockUrl?.(scriptName)
        ?? `https://${scriptName}.${options.launch ? "buildcustom-vibesdk-launch.thegoldimport.workers.dev" : "any-preview-host.test"}/`;
      if (options.holdDeploy) {
        return await new Promise<string>((resolve) => {
          completeDeploy = () => resolve(deployedUrl);
        });
      }
      return deployedUrl;
    },
    async verifyReady(_gateway: any, url: string) {
      events.push(`ready:${new URL(url).hostname}`);
      if (options.expireClaimBeforeActivation
        && new URL(url).hostname === `${validScript(currentRevision)}.lab-apps.buildcustom.ai`) {
        state.claimExpired = true;
      }
      if (new URL(url).hostname === "verify-failure.lab-apps.buildcustom.ai") {
        throw new Error("candidate readiness failed");
      }
    },
  };
  const request = (headers: Record<string, string> = {}) => new Request("https://control.test/api", {
    method: "POST",
    headers: {
      "X-CSRF-Token": "csrf",
      "X-Publish-Protocol": "immutable-v2",
      Cookie: "accessToken=owner-session",
      ...headers,
    },
  });
  return {
    env,
    gateway,
    state,
    routes,
    events,
    browserVisits,
    dependencies,
    request,
    get deploys() { return deploys; },
    get revisionReads() { return revisionReads; },
    finishDeploy() { completeDeploy(); },
  };
}

async function publish(target: ReturnType<typeof fixture>, projectOverride = project, actor = owner, input: Record<string, unknown> = {}) {
  return handleNativeThinkPublish(
    target.env, target.request(), projectOverride, "publish-immutable-v2", actor, input, target.dependencies,
  );
}

test("release identity hashes the linked agent UUID and full authoritative revision", async () => {
  const first = await nativeReleaseScriptName(agentId, revisionA);
  assert.equal(first, validScript(revisionA));
  assert.equal(first?.length, 61);
  assert.notEqual(first, await nativeReleaseScriptName("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", revisionA));
  assert.notEqual(first, await nativeReleaseScriptName(agentId, revisionB));
  assert.equal(await nativeReleaseScriptName("not-an-agent-uuid", revisionA), null);
  assert.equal(await nativeReleaseScriptName(agentId, "a".repeat(39)), null);
  assert.equal(validNativeSlug("northstar-coffee-live"), true);
  assert.equal(validNativeSlug("api"), false);
});

test("stock URL only supplies the confirmed script identity; preview host is not assumed", () => {
  const name = validScript(revisionA);
  assert.deepEqual(parseStockDeploymentUrl(`https://${name}.preview.invalid/`, name), {
    scriptName: name,
    url: `https://${name}.preview.invalid/`,
    dispatchUrl: `https://${name}.lab-apps.buildcustom.ai/`,
  });
  assert.equal(parseStockDeploymentUrl(`https://another-script.preview.invalid/`, name), null);
  assert.equal(parseStockDeploymentUrl(`https://${name}.preview.invalid/path`, name), null);
  assert.equal(parseStockDeploymentUrl(`http://${name}.preview.invalid/`, name), null);
  assert.deepEqual(parseStockDeploymentUrl(
    `https://${name}.buildcustom-vibesdk-launch.thegoldimport.workers.dev/`, name,
    "buildcustom-vibesdk-launch.thegoldimport.workers.dev",
  ), {
    scriptName: name,
    url: `https://${name}.buildcustom-vibesdk-launch.thegoldimport.workers.dev/`,
    dispatchUrl: `https://buildcustom-apps-gateway-launch.thegoldimport.workers.dev/c/${name}/`,
  });
});

test("stock WebSocket waits for immutable capability and idle state before deploying", async () => {
  const socket = new MockSocket();
  const pending = awaitNativeDeployResult(socket as any, revisionA, 500);
  assert.deepEqual(socket.sent, []);
  socket.message(JSON.stringify({
    type: "agent_connected",
    deploymentCapabilities: { platformImmutableRelease: true, publisherArtifactVersion: PUBLISHER_ARTIFACT_VERSION },
    state: { shouldBeGenerating: false },
  }));
  assert.deepEqual(socket.sent, [`{"type":"deploy","target":"platform","immutableRelease":true,"expectedRevision":"${revisionA}"}`]);
  socket.message(JSON.stringify({
    type: "cloudflare_deployment_completed",
    deploymentUrl: `https://${validScript(revisionA)}.stock-preview.invalid/`,
  }));
  assert.equal(await pending, `https://${validScript(revisionA)}.stock-preview.invalid/`);
  assert.equal(socket.closed, true);
});

test("native artifact identity versions packaging without changing generated source", async () => {
  const current = await nativeReleaseScriptName(agentId, revisionA);
  assert.equal(current, await nativeReleaseScriptName(agentId, revisionA, PUBLISHER_ARTIFACT_VERSION));
  assert.notEqual(current, await nativeReleaseScriptName(agentId, revisionA, "app-routing-v3"));
  assert.notEqual(current, await nativeReleaseScriptName(agentId, revisionB));
  assert.equal(await nativeReleaseScriptName(agentId, revisionA, ""), null);
});

test("mixed publisher versions fail closed before sending deploy", async () => {
  const socket = new MockSocket();
  const pending = awaitNativeDeployResult(socket as any, revisionA, 500);
  socket.message(JSON.stringify({
    type: "agent_connected",
    deploymentCapabilities: { platformImmutableRelease: true, publisherArtifactVersion: "old-publisher" },
    state: { shouldBeGenerating: false },
  }));
  await assert.rejects(pending, /does not support immutable/);
  assert.deepEqual(socket.sent, []);
});

test("launch status preserves only the path-scoped preview capability cookie", async () => {
  const f = fixture({ launch: true });
  const previewCookie = `__Secure-bc-preview-${"a".repeat(64)}=signed-preview-token; Path=/_private_preview/${agentId}/main/; Max-Age=1800; Secure; HttpOnly; SameSite=None; Partitioned`;
  const statusHeaders = new Headers();
  statusHeaders.append("Set-Cookie", previewCookie);
  statusHeaders.append("Set-Cookie", "__Host-bc_session=must-not-forward; Path=/; Secure; HttpOnly");
  const statusResponse = Response.json({ nativeThink: true, previewUrl: "/_private_preview/agent/main/" }, { headers: statusHeaders });
  const response = await handleNativeThinkPublish(
    f.env,
    new Request("https://control.test/api/projects/10/runtime/status"),
    project,
    "status",
    owner,
    {},
    { readThinkStatus: async () => statusResponse },
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Set-Cookie"), previewCookie);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    nativeThink: true,
    previewUrl: "/_private_preview/agent/main/",
    deploymentUrl: null,
    publicAvailable: false,
  });
});

test("stale stock worker, generating agent, timeout, and premature completion never send deploy", async () => {
  const expectedRevision = revisionA;
  const stale = new MockSocket();
  const stalePending = awaitNativeDeployResult(stale as any, expectedRevision, 500);
  stale.message(JSON.stringify({ type: "agent_connected", state: { shouldBeGenerating: false } }));
  await assert.rejects(stalePending, /does not support immutable/);
  assert.deepEqual(stale.sent, []);

  const generating = new MockSocket();
  const generatingPending = awaitNativeDeployResult(generating as any, expectedRevision, 500);
  generating.message(JSON.stringify({
    type: "agent_connected",
    deploymentCapabilities: { platformImmutableRelease: true, publisherArtifactVersion: PUBLISHER_ARTIFACT_VERSION },
    state: { shouldBeGenerating: true },
  }));
  await assert.rejects(generatingPending, /must be idle/);
  assert.deepEqual(generating.sent, []);

  const premature = new MockSocket();
  const prematurePending = awaitNativeDeployResult(premature as any, expectedRevision, 500);
  premature.message(JSON.stringify({ type: "cloudflare_deployment_completed", deploymentUrl: `https://${validScript()}.test/` }));
  await assert.rejects(prematurePending, /before confirming/);
  assert.deepEqual(premature.sent, []);

  const timeout = new MockSocket();
  await assert.rejects(awaitNativeDeployResult(timeout as any, expectedRevision, 1), /timed out/);
  assert.deepEqual(timeout.sent, []);
});

test("legacy release A stays public while same-revision immutable candidate B is verified, then is retained", async () => {
  const f = fixture();
  const response = await publish(f);
  assert.equal(response?.status, 201, await response?.clone().text());
  const payload = await response!.json() as any;
  const candidate = validScript(revisionA);
  assert.equal(payload.deploymentUrl, publicUrl);
  assert.equal(payload.release.scriptName, candidate);
  assert.equal(f.deploys, 1);
  assert.equal(f.state.releases.length, 2);
  assert.equal(f.state.releases[0].script_name, oldScript);
  assert.equal(f.state.releases[0].revision, revisionA);
  assert.equal(f.state.releases[1].script_name, candidate);
  assert.equal(f.state.releases[1].revision, revisionA);
  assert.equal(f.state.link.deployment_script_name, candidate);
  assert.equal(JSON.parse(f.routes.get(slug)!).scriptName, candidate);
  assert.deepEqual(f.state.releases.map((row: any) => row.script_name), [oldScript, candidate]);
  assert.ok(f.browserVisits.some((visit) => visit.url.startsWith(`https://${candidate}.lab-apps.buildcustom.ai/`)));
  const candidateIndex = f.events.findIndex((event) => event === `fetch:${candidate}:/`);
  const cutoverIndex = f.events.findIndex((event) => event === `kv:${candidate}`);
  assert.ok(candidateIndex >= 0 && candidateIndex < cutoverIndex);
  const oldDuringCandidate = f.browserVisits.find((visit) => visit.url.startsWith(`https://${candidate}.lab-apps.buildcustom.ai/`));
  assert.equal(oldDuringCandidate?.mappedScript, oldScript);
});

test("same-revision retry returns existing immutable release without opening another stock deployment", async () => {
  const f = fixture();
  const first = await publish(f);
  const firstBody = await first!.json() as any;
  const visitsBeforeRetry = f.browserVisits.length;
  const repeated = await publish(f);
  assert.equal(repeated?.status, 200);
  assert.equal((await repeated!.json() as any).alreadyPublished, true);
  assert.equal(f.deploys, 1);
  assert.equal(f.state.releases.length, 2);
  assert.equal(firstBody.release.scriptName, validScript(revisionA));
  assert.ok(f.browserVisits.length >= visitsBeforeRetry + 2);
});

test("concurrent already-published retries return the same release without a claim or route mutation", { timeout: 10_000 }, async () => {
  const f = fixture({ launch: true, legacy: false });
  const initial = await publish(f);
  assert.equal(initial?.status, 201);
  const published = (await initial!.json() as any).release;
  const route = f.routes.get(slug);
  const routeWrites = f.events.filter((event) => event.startsWith("kv:")).length;
  const [first, second] = await Promise.all([publish(f), publish(f)]);
  for (const response of [first, second]) {
    assert.equal(response?.status, 200);
    const body = await response!.json() as any;
    assert.equal(body.alreadyPublished, true);
    assert.equal(body.release.id, published.id);
    assert.equal(body.release.commitHash, published.commitHash);
    assert.equal(body.release.subdomainSlug, published.subdomainSlug);
    assert.equal(body.release.scriptName, published.scriptName);
  }
  assert.equal(f.state.releases.length, 1);
  assert.equal(f.deploys, 1);
  assert.equal(f.routes.get(slug), route);
  assert.equal(f.events.filter((event) => event.startsWith("kv:")).length, routeWrites);
  assert.equal(f.state.claimToken, null);
  assert.equal((await publish(f, project, wrongOwner))?.status, 404);
});

test("same-revision retry refuses stale link or route metadata instead of claiming the old release is active", async () => {
  const f = fixture();
  assert.equal((await publish(f))?.status, 201);
  const visitsBefore = f.browserVisits.length;
  f.state.link.deployment_script_name = oldScript;
  const retry = await publish(f);
  assert.equal(retry?.status, 409);
  assert.equal(f.deploys, 1);
  assert.equal(f.browserVisits.length, visitsBefore);
});

test("same-revision retry requires a healthy direct and stable route", async () => {
  const options: FixtureOptions = {};
  const f = fixture(options);
  assert.equal((await publish(f))?.status, 201);
  options.failCandidateAsset = true;
  const missingAsset = await publish(f);
  assert.equal(missingAsset?.status, 409);
  assert.notEqual((await missingAsset!.json() as any).alreadyPublished, true);
  options.failCandidateAsset = false;
  options.failStableAfterSwitch = true;
  const retry = await publish(f);
  assert.equal(retry?.status, 409);
  assert.equal(f.deploys, 1);
});

test("a later revision receives a new identity, activates only after verification, and preserves both releases", async () => {
  const f = fixture({ revision: revisionB });
  const response = await publish(f);
  assert.equal(response?.status, 201, await response?.clone().text());
  assert.notEqual(validScript(revisionA), validScript(revisionB));
  assert.deepEqual(f.state.releases.map((row: any) => row.script_name), [oldScript, validScript(revisionB)]);
  assert.equal(f.state.releases[1].revision, revisionB);
  assert.equal(JSON.parse(f.routes.get(slug)!).scriptName, validScript(revisionB));
  assert.equal(f.state.link.deployment_url, publicUrl);
});

test("stock upload errors and malformed/wrong identities leave the old route and release history intact", async () => {
  for (const options of [
    { stockUrl: () => { throw new Error("stock upload failed"); } },
    { stockAlreadyExists: true },
    { stockUrl: () => "not a URL" },
    { stockUrl: () => "https://another-worker.preview.invalid/" },
  ]) {
    const f = fixture(options as FixtureOptions);
    const before = f.routes.get(slug);
    const response = await publish(f);
    assert.equal(response?.status, 502);
    assert.equal(f.routes.get(slug), before);
    assert.equal(f.state.releases.length, 1);
  }
});

test("candidate asset and rendered verification failures retain the last-known-good slug", async () => {
  for (const options of [{ failCandidateAsset: true }, { failCandidateRender: true }]) {
    const f = fixture(options);
    const before = f.routes.get(slug);
    const response = await publish(f);
    assert.equal(response?.status, 502);
    assert.equal(f.routes.get(slug), before);
    assert.equal(f.state.releases.length, 1);
    assert.equal(f.state.link.deployment_script_name, oldScript);
  }
});

test("a gateway HTTP 500 for an absent candidate does not block stock's authoritative create-once publish", async () => {
  const f = fixture({ candidateProbeStatus: 500 });
  const absentCandidate = await f.gateway.fetch(new Request(`https://${validScript()}.lab-apps.buildcustom.ai/`));
  assert.equal(absentCandidate.status, 500);
  await absentCandidate.body?.cancel();
  const response = await publish(f);
  assert.equal(response?.status, 201, await response?.clone().text());
  assert.equal(f.deploys, 1);
  assert.equal(f.state.releases.length, 2);
  assert.equal(JSON.parse(f.routes.get(slug)!).scriptName, validScript());
  assert.equal(f.events.some((event) => event === `stock:${revisionA}`), true);
  const stockIndex = f.events.indexOf(`stock:${revisionA}`);
  const candidateDispatchIndex = f.events.findIndex((event, index) => index > stockIndex && event === `fetch:${validScript()}:/`);
  assert.ok(candidateDispatchIndex > stockIndex);
});

test("an expired claim cannot activate a candidate, and an expired lease may be taken over", async () => {
  const expiredBeforeActivation = fixture({ expireClaimBeforeActivation: true });
  assert.equal((await publish(expiredBeforeActivation))?.status, 502);
  assert.equal(expiredBeforeActivation.deploys, 1);
  assert.equal(JSON.parse(expiredBeforeActivation.routes.get(slug)!).scriptName, oldScript);
  assert.equal(expiredBeforeActivation.state.releases.length, 1);

  const takeover = fixture({ preexistingExpiredClaim: true });
  assert.equal((await publish(takeover))?.status, 201);
  assert.equal(takeover.deploys, 1);
  assert.equal(takeover.state.releases.length, 2);
});

test("rollback fails closed rather than restoring over a route after the claim is lost", async () => {
  const f = fixture({ failStableAfterSwitch: true, loseClaimOnStableFailure: true });
  const response = await publish(f);
  assert.equal(response?.status, 502);
  assert.match((await response!.json() as any).message, /rollback was unsafe/);
  assert.equal(JSON.parse(f.routes.get(slug)!).scriptName, validScript());
  assert.equal(f.state.releases.length, 1);
});

test("stable-route verification failure rolls the cutover back to release A", async () => {
  const f = fixture({ failStableAfterSwitch: true });
  const response = await publish(f);
  assert.equal(response?.status, 502);
  assert.equal(JSON.parse(f.routes.get(slug)!).scriptName, oldScript);
  assert.equal(f.state.releases.length, 1);
  assert.equal(f.state.link.deployment_script_name, oldScript);
});

test("D1 persistence failure rolls the cutover back without replacing release A", async () => {
  const f = fixture({ failBatch: true });
  const response = await publish(f);
  assert.equal(response?.status, 502);
  assert.equal(JSON.parse(f.routes.get(slug)!).scriptName, oldScript);
  assert.equal(f.state.releases.length, 1);
  assert.equal(f.state.link.deployment_script_name, oldScript);
});

test("a missing route starts an immutable release without depending on a stylesheet alias", async () => {
  const f = fixture({ legacy: false });
  const response = await publish(f);
  assert.equal(response?.status, 201, await response?.clone().text());
  assert.deepEqual(JSON.parse(f.routes.get(slug)!), { scriptName: validScript(), metadata: {} });
  assert.equal(f.events.some((event) => event.includes("/style.css")), false);
});

test("a first-generation Git tree with inline CSS and no stylesheet publishes its exact revision", async () => {
  const revision = "e0730b8e778f421c0c351990c193ffc7f6a1ff6c";
  const f = fixture({ launch: true, legacy: false, inlineStylesOnly: true, revision });
  const response = await publish(f);
  assert.equal(response?.status, 201, await response?.clone().text());
  assert.equal(f.deploys, 1);
  assert.equal(f.state.releases.length, 1);
  assert.equal(f.state.releases[0].revision, revision);
  assert.equal(f.state.releases[0].script_name, validScript(revision));
  assert.deepEqual(JSON.parse(f.routes.get(slug)!), { scriptName: validScript(revision), metadata: {} });
  assert.ok(f.events.includes(`stock:${revision}`));
  assert.ok(f.events.some((event) => event.includes(`/c/${validScript(revision)}/`)));
  assert.ok(!f.events.includes("unexpected-stylesheet-request"));
});

test("an HTML stylesheet reference absent from the Git tree still blocks publication", async () => {
  const f = fixture({ legacy: false, missingStylesheet: true });
  const response = await publish(f);
  assert.equal(response?.status, 502);
  assert.match((await response!.json() as any).message, /missing public\/styles\.css/);
  assert.equal(f.deploys, 0);
  assert.equal(f.state.releases.length, 0);
  assert.equal(f.routes.get(slug), undefined);
});

test("publishing refuses a foreign script collision before the stock socket opens", async () => {
  const f = fixture({ collisionScript: validScript() });
  const response = await publish(f);
  assert.equal(response?.status, 409);
  assert.equal(f.deploys, 0);
  assert.equal(JSON.parse(f.routes.get(slug)!).scriptName, oldScript);
  assert.equal(f.state.releases.length, 1);
});

test("the project claim prevents concurrent candidates from racing the active route", async () => {
  const f = fixture({ holdDeploy: true });
  const first = publish(f);
  while (!f.state.claimToken) await new Promise((resolve) => setTimeout(resolve, 0));
  const second = await publish(f);
  assert.equal(second?.status, 409);
  assert.equal(f.deploys, 1);
  f.finishDeploy();
  assert.equal((await first)?.status, 201);
  assert.equal(f.state.releases.length, 2);
});

test("publishing capabilities, protocol header, legacy path, recovery, and ownership fail closed", async () => {
  const f = fixture();
  const get = new Request("https://control.test/api", { method: "GET" });
  const capability = await handleNativeThinkPublish(f.env, get, project, "publishing-capabilities", owner);
  assert.deepEqual(await capability?.json(), { buildId: "immutable-v2", publishProtocol: "immutable-v2", publisherArtifactVersion: PUBLISHER_ARTIFACT_VERSION, publicGeneratedAppsEnabled: true });

  const missingProtocol = await handleNativeThinkPublish(
    f.env, f.request({ "X-Publish-Protocol": "wrong" }), project, "publish-immutable-v2", owner, {}, f.dependencies,
  );
  assert.equal(missingProtocol?.status, 409);
  assert.equal(f.deploys, 0);

  const oldRoute = await handleNativeThinkPublish(f.env, f.request(), project, "deployments", owner, {}, f.dependencies);
  assert.equal(oldRoute?.status, 410);
  const recovery = await handleNativeThinkPublish(f.env, f.request(), project, "reconcile-deployment", owner, {}, f.dependencies);
  assert.equal(recovery?.status, 409);
  const oldVersion = await handleNativeThinkPublish(f.env, f.request(), project, "publish-immutable", owner, {}, f.dependencies);
  assert.equal(oldVersion?.status, 410);
  const userB = await handleNativeThinkPublish(f.env, f.request(), project, "publish-immutable-v2", wrongOwner, {}, f.dependencies);
  assert.equal(userB?.status, 404);
  const forged = await handleNativeThinkPublish(
    f.env, f.request(), project, "publish-immutable-v2", owner, { scriptName: "northstar-coffee" }, f.dependencies,
  );
  assert.equal(forged?.status, 400);
  assert.equal(f.deploys, 0);
  assert.equal(JSON.parse(f.routes.get(slug)!).scriptName, oldScript);
});

test("launch native publish exposes owner-scoped capabilities and requires its private gateway", async () => {
  const f = fixture();
  f.env.ENVIRONMENT = "production";
  f.env.CONTROL_PLANE_PROFILE = "launch";
  f.env.STAGING_ROUTE_KV_ID = "248ac5b6821a475794a7fe3d2b0c3718";
  f.env.STAGING_MANAGED_GATEWAY_URL = "https://buildcustom-apps-gateway-launch.thegoldimport.workers.dev/p";
  f.env.STAGING_GATEWAY = undefined;
  const capability = await handleNativeThinkPublish(
    f.env, new Request("https://control.test/api", { method: "GET" }), project, "publishing-capabilities", owner,
  );
  assert.deepEqual(await capability?.json(), { buildId: "immutable-v2", publishProtocol: "immutable-v2", publisherArtifactVersion: PUBLISHER_ARTIFACT_VERSION, publicGeneratedAppsEnabled: false });
  const response = await publish(f);
  assert.equal(response?.status, 503);
  assert.match((await response!.json()).message, /private launch apps gateway/i);
  assert.equal(f.deploys, 0);
});

test("launch owner publish verifies the immutable dispatch candidate before the private /p route cutover", async () => {
  const f = fixture({ launch: true });
  const response = await publish(f);
  assert.equal(response?.status, 201, await response?.clone().text());
  const result = await response!.json() as any;
  assert.equal(result.deploymentUrl, null);
  assert.equal(result.publicAvailable, false);
  assert.equal(result.release.deploymentUrl, null);
  assert.equal(f.state.route && JSON.parse(f.state.route).scriptName, validScript(revisionA));
  const routeWrite = f.events.indexOf(`kv:${validScript(revisionA)}`);
  const candidateReady = f.events.indexOf("ready:buildcustom-apps-gateway-launch.thegoldimport.workers.dev");
  assert.ok(candidateReady >= 0);
  assert.ok(routeWrite > candidateReady);
  assert.ok(f.events.some((event) => event === `fetch:${validScript(revisionA)}:/c/${validScript(revisionA)}/styles.css`));
  assert.ok(f.events.some((event) => event.includes(`/p/${slug}/_buildcustom/route-check`)));
  assert.ok(f.events.some((event) => event === `request:https://buildcustom-apps-gateway-launch.thegoldimport.workers.dev/c/${validScript(revisionA)}/`));
  assert.equal(f.events.some((event) => event.startsWith("unexpected-host:")), false);
  const preparedIndex = f.events.indexOf("d1:release:pending");
  assert.ok(preparedIndex >= 0 && preparedIndex < routeWrite, "prepared D1 release must precede the KV route switch");
  const retriesBefore = f.events.filter((event) => event.includes(`/p/${slug}/_buildcustom/route-check`)).length;
  const retry = await publish(f);
  assert.equal(retry?.status, 200);
  assert.ok(f.events.filter((event) => event.includes(`/p/${slug}/_buildcustom/route-check`)).length > retriesBefore);
});

test("launch initial publish preserves an absent route after failure between prepared D1 and KV, then retries without another upload", async () => {
  const f = fixture({ launch: true, legacy: false, failRoutePutOnce: true });
  const first = await publish(f);
  assert.equal(first?.status, 502);
  assert.equal(f.routes.get(slug) ?? null, null);
  assert.equal(f.state.releases.at(-1).status, "pending");
  assert.equal(f.deploys, 1);

  const retry = await publish(f);
  assert.equal(retry?.status, 201, await retry?.clone().text());
  assert.equal(f.deploys, 1);
  assert.equal(f.state.releases.at(-1).status, "published");
  assert.equal(JSON.parse(f.routes.get(slug)!).scriptName, validScript());
});

test("launch republish restores the last-known-good route on final D1 failure and prepared retry avoids upload", async () => {
  const f = fixture({ launch: true, failBatchOnce: true });
  const first = await publish(f);
  assert.equal(first?.status, 502);
  assert.equal(JSON.parse(f.routes.get(slug)!).scriptName, oldScript);
  assert.equal(f.state.link.deployment_script_name, oldScript);
  assert.equal(f.state.releases.at(-1).status, "pending");
  assert.equal(f.deploys, 1);

  const retry = await publish(f);
  assert.equal(retry?.status, 201, await retry?.clone().text());
  assert.equal(f.deploys, 1);
  assert.equal(JSON.parse(f.routes.get(slug)!).scriptName, validScript());
  assert.equal(f.state.releases.at(-1).status, "published");
});

test("launch route-check failure rolls back and verifies the previous slug and script mapping", async () => {
  const f = fixture({ launch: true, failLaunchRouteCheck: true });
  const response = await publish(f);
  assert.equal(response?.status, 502);
  assert.equal(JSON.parse(f.routes.get(slug)!).scriptName, oldScript);
  assert.ok(f.events.some((event) => event.includes(`/p/${slug}/_buildcustom/route-check`)));
});

test("launch source verification accepts original CSS URLs and requires the exact-source header", async () => {
  const f = fixture({ launch: true, launchSourceHtml: true });
  const response = await publish(f);
  assert.equal(response?.status, 201, await response?.clone().text());
});

test("public verification checks rendered HTML and every required stylesheet without an alias", async () => {
  const visits: string[] = [];
  const browser: any = {
    async quickAction(_action: string, options: any) {
      visits.push(options.url);
      return new Response(JSON.stringify({ result: indexHtml }));
    },
  };
  const requests: string[] = [];
  const gateway = {
    async fetch(request: Request) {
      requests.push(request.url);
      return new URL(request.url).pathname === "/styles.css"
        ? new Response(stylesCss, { headers: { "content-type": "text/css" } })
        : new Response(indexHtml, { headers: { "content-type": "text/html" } });
    },
  };
  await verifyNativePublicRoute(browser, publicUrl, (url) => gateway.fetch(new Request(url)));
  assert.deepEqual(visits, [publicUrl]);
  assert.deepEqual(requests, [publicUrl, `https://${slug}.lab-apps.buildcustom.ai/styles.css`]);
});