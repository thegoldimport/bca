import test from "node:test";
import assert from "node:assert/strict";
import {
  awaitNativeDeployResult,
  handleNativeThinkPublish,
  normalizedNativeSlug,
  parseStockDeploymentUrl,
  validNativeSlug,
} from "../cloudflare/staging/native-publish";

const project = {
  id: 10, name: "Task 3 acceptance a", user_id: "owner-a", runtime_provider: "stock-think",
  deployment_script_name: "old-script",
};
const owner = { id: "owner-a" };

class MockSocket extends EventTarget {
  sent: string[] = [];
  closed = false;
  accept() {}
  send(value: string) { this.sent.push(value); }
  close() { this.closed = true; }
  message(value: unknown) { this.dispatchEvent(new MessageEvent("message", { data: value })); }
}

function mockEnv(query: (sql: string, values: unknown[]) => any = () => null) {
  const db: any = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bound: unknown[]) { values = bound; return statement; },
        async first() { return query(sql, values); },
        async all() { return { results: query(sql, values) || [] }; },
        async run() { query(sql, values); return { meta: { changes: 1 } }; },
      };
      return statement;
    },
  };
  const kv = new Map<string, string>();
  return {
    env: {
      ENVIRONMENT: "staging",
      DB: db,
      STAGING_ROUTE_KV_ID: "test",
      STAGING_ROUTES: {
        async get(key: string) { return kv.get(key) ?? null; },
        async put(key: string, value: string) { kv.set(key, value); },
        async delete(key: string) { kv.delete(key); },
      },
      LAB_APPS_GATEWAY: { async fetch() { return new Response("<html></html>", { headers: { "content-type": "text/html" } }); } },
    } as any,
    kv,
  };
}

test("native deployment URL parser requires the stock lab origin and yields script independently", () => {
  assert.deepEqual(parseStockDeploymentUrl("https://sanitized-worker.lab-apps.buildcustom.ai/"), {
    scriptName: "sanitized-worker",
    url: "https://sanitized-worker.lab-apps.buildcustom.ai/",
    dispatchUrl: "https://sanitized-worker.lab-apps.buildcustom.ai/",
  });
  assert.deepEqual(parseStockDeploymentUrl("https://northstar-coffee.bc-vibesdk-lab-20260925.thegoldimport.workers.dev/"), {
    scriptName: "northstar-coffee",
    url: "https://northstar-coffee.bc-vibesdk-lab-20260925.thegoldimport.workers.dev/",
    dispatchUrl: "https://northstar-coffee.lab-apps.buildcustom.ai/",
  });
  for (const invalid of [
    "http://worker.lab-apps.buildcustom.ai/",
    "https://worker.example.com/",
    "https://worker.lab-apps.buildcustom.ai/path",
    "https://worker.lab-apps.buildcustom.ai/?x=1",
    "https://worker.lab-apps.buildcustom.ai.evil.example/",
    "https://user@worker.lab-apps.buildcustom.ai/",
    "https://worker.bc-vibesdk-lab-20260925.thegoldimport.workers.dev.evil.example/",
  ]) assert.equal(parseStockDeploymentUrl(invalid), null);
});

test("native publishing slugs normalize legacy names and reject reserved or unsafe names", () => {
  assert.equal(normalizedNativeSlug("Task 3 acceptance a", 10), "task-3-acceptance-a");
  assert.equal(validNativeSlug("task-3-acceptance-a"), true);
  assert.equal(validNativeSlug("api"), false);
  assert.equal(validNativeSlug("bad slug"), false);
});

test("publish socket sends only the platform deploy command and accepts a completion URL", async () => {
  const socket = new MockSocket();
  const pending = awaitNativeDeployResult(socket as any, 100);
  assert.deepEqual(socket.sent, ['{"type":"deploy","target":"platform"}']);
  socket.message(JSON.stringify({ type: "cloudflare_deployment_completed", deploymentUrl: "https://worker.lab-apps.buildcustom.ai/" }));
  assert.equal(await pending, "https://worker.lab-apps.buildcustom.ai/");
  assert.equal(socket.closed, true);
});

test("publish socket rejects errors, malformed events, and premature close", async () => {
  for (const fire of [
    (socket: MockSocket) => socket.message(JSON.stringify({ type: "cloudflare_deployment_error", error: "failed" })),
    (socket: MockSocket) => socket.message("{bad-json"),
    (socket: MockSocket) => socket.dispatchEvent(new Event("close")),
    (socket: MockSocket) => socket.message(JSON.stringify({ type: "cloudflare_deployment_completed" })),
  ]) {
    const socket = new MockSocket();
    const pending = awaitNativeDeployResult(socket as any, 100);
    fire(socket);
    await assert.rejects(pending);
    assert.equal(socket.closed, true);
  }
  const timeout = new MockSocket();
  await assert.rejects(awaitNativeDeployResult(timeout as any, 1), /timed out/);
  assert.equal(timeout.closed, true);
});

test("native settings write enforces CSRF and safe slugs but is not gated by super-admin role", async () => {
  const state: { slug?: string } = {};
  const { env } = mockEnv((sql, values) => {
    if (sql.includes("SELECT id FROM native_publish_releases")) return null;
    if (sql.includes("SELECT project_id FROM runtime_project_links")) return null;
    if (sql.startsWith("INSERT INTO runtime_project_links")) { state.slug = String(values[1]); return null; }
    return null;
  });
  const unsafe = await handleNativeThinkPublish(env, new Request("https://control.test/api", {
    method: "PUT", headers: { "X-CSRF-Token": "csrf" },
  }), project, "publishing-settings", owner, { subdomainSlug: "api" });
  assert.equal(unsafe?.status, 400);
  const noCsrf = await handleNativeThinkPublish(env, new Request("https://control.test/api", { method: "PUT" }), project,
    "publishing-settings", owner, { subdomainSlug: "safe-site" });
  assert.equal(noCsrf?.status, 403);
  const response = await handleNativeThinkPublish(env, new Request("https://control.test/api", {
    method: "PUT", headers: { "X-CSRF-Token": "csrf" },
  }), project, "publishing-settings", owner, { subdomainSlug: "safe-site" });
  assert.equal(response?.status, 200);
  assert.equal(state.slug, "safe-site");
});

test("native GET settings normalizes an invalid preexisting slug; releases are project-scoped", async () => {
  const { env } = mockEnv((sql) => {
    if (sql.includes("SELECT subdomain_slug FROM runtime_project_links")) return { subdomain_slug: "task 3 acceptance a" };
    if (sql.includes("SELECT * FROM native_publish_releases")) return [{
      id: 7, project_id: 10, revision: "a".repeat(40), script_name: "stock-generated-script",
      slug: "task-3-acceptance-a", public_url: "https://task-3-acceptance-a.lab-apps.buildcustom.ai/",
      status: "published", created_at: "2026-01-01 00:00:00",
    }];
    return null;
  });
  const settings = await handleNativeThinkPublish(env, new Request("https://control.test/api"), project, "publishing-settings", owner);
  assert.deepEqual(await settings?.json(), {
    subdomainSlug: "task-3-acceptance-a", hostingProvider: "buildcustom", customDomain: "", customOrigin: "",
  });
  const releases = await handleNativeThinkPublish(env, new Request("https://control.test/api"), project, "releases", owner);
  assert.deepEqual(await releases?.json(), { releases: [{
    id: 7, projectId: 10, commitHash: "a".repeat(40), scriptName: "stock-generated-script",
    subdomainSlug: "task-3-acceptance-a", deploymentUrl: "https://task-3-acceptance-a.lab-apps.buildcustom.ai/",
    status: "published", createdAt: "2026-01-01 00:00:00",
  }] });
});

function nativePublishEnv(options: {
  held?: boolean; expired?: boolean; oldRoute?: string | null; scriptCollision?: boolean; collisionScriptName?: string;
  styleAliasFails?: boolean;
} = {}) {
  const state: any = {
    held: Boolean(options.held), expiresAt: options.expired ? 0 : Math.floor(Date.now() / 1000) + 360,
    route: options.oldRoute ?? null, claimToken: null,
    link: { agent_id: "owner-agent", initialization_status: "ready" },
    releases: [], claimed: false,
  };
  const query = (sql: string, values: unknown[]) => {
    if (sql.includes("SELECT agent_id,initialization_status,hosting_provider")) return state.link;
    if (sql.includes("SELECT subdomain_slug,hosting_provider")) return { subdomain_slug: "task-3-acceptance-a", hosting_provider: "cloudflare" };
    if (sql.includes("SELECT agent_id,initialization_status FROM runtime_project_links")) return state.link;
    if (sql.includes("WHERE deployment_script_name=?")) {
      return options.scriptCollision || options.collisionScriptName === values[0] ? { project_id: 99 } : null;
    }
    if (sql.includes("WHERE script_name=? AND project_id<>?")) {
      return options.collisionScriptName === values[0] ? { project_id: 99 } : null;
    }
    if (sql.includes("SELECT project_id FROM runtime_project_links")) return null;
    if (sql.includes("SELECT user_id FROM projects")) return { user_id: "owner-a" };
    if (sql.includes("INSERT INTO native_publish_claims")) {
      if (state.held && state.expiresAt > Math.floor(Date.now() / 1000)) return null;
      state.held = true;
      state.claimToken = values[1];
      state.expiresAt = Math.floor(Date.now() / 1000) + 360;
      return { project_id: 10 };
    }
    if (sql.includes("SELECT claim_token FROM native_publish_claims")) {
      return state.claimToken === values[1] ? { claim_token: state.claimToken } : null;
    }
    if (sql.includes("SELECT * FROM native_publish_releases") && sql.includes("revision=?")) {
      return state.releases.find((release: any) => release.project_id === values[0] && release.revision === values[1] && release.status === "published") || null;
    }
    if (sql.includes("SELECT revision,script_name FROM native_publish_releases")) return state.releases.at(-1) || null;
    if (sql.includes("UPDATE runtime_project_links SET deployment_url")) {
      state.link = {
        ...state.link, deployment_url: values[0], deployment_origin_url: values[1],
        deployment_script_name: values[2], subdomain_slug: values[3],
      };
      return null;
    }
    if (sql.includes("INSERT INTO native_publish_releases")) {
      const row = {
        id: state.releases.length + 1, user_id: values[0], project_id: values[1], revision: values[2],
        script_name: values[3], slug: values[4], public_url: values[5], status: "published", created_at: "2026-01-01 00:00:00",
      };
      state.releases.push(row);
      return row;
    }
    if (sql.includes("DELETE FROM native_publish_claims")) { state.held = false; state.claimToken = null; return null; }
    return null;
  };
  const db: any = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement: any = {
        sql,
        bind(...bound: unknown[]) { values = bound; statement.values = values; return statement; },
        async first() { return query(sql, values); },
        async all() { return { results: state.releases }; },
        async run() { query(sql, values); return { meta: { changes: 1 } }; },
      };
      return statement;
    },
    async batch(statements: any[]) {
      const out: any[] = [];
      for (const statement of statements) out.push({ results: [query(statement.sql, statement.values)] });
      return out;
    },
  };
  const kv = new Map<string, string>();
  if (state.route !== null) kv.set("task-3-acceptance-a", state.route);
  const env: any = {
    ENVIRONMENT: "staging", DB: db, STAGING_ROUTE_KV_ID: "test",
    STAGING_ROUTES: {
      async get(key: string) { return kv.get(key) ?? null; },
      async put(key: string, value: string) { kv.set(key, value); state.route = value; },
      async delete(key: string) { kv.delete(key); state.route = null; },
    },
    LAB_APPS_GATEWAY: {
      async fetch(request: Request) {
        if (new URL(request.url).pathname === "/style.css") {
          return options.styleAliasFails
            ? new Response("not found", { status: 404, headers: { "content-type": "text/html" } })
            : new Response("body {}", { headers: { "content-type": "text/css" } });
        }
        return new Response("<html></html>", { headers: { "content-type": "text/html" } });
      },
    },
  };
  return { env, state, kv };
}

const publishRequest = () => new Request("https://control.test/api", {
  method: "POST", headers: { "X-CSRF-Token": "csrf", Cookie: "accessToken=owner-session" },
});
const publishDeps = (
  revisions = ["a".repeat(40), "a".repeat(40), "a".repeat(40), "a".repeat(40)],
  verifyReady?: () => Promise<void>,
  verifyPublic?: (url: string) => Promise<void>,
  stockResult = "https://sanitized-script.lab-apps.buildcustom.ai/",
) => {
  let index = 0;
  let deploys = 0;
  const readyUrls: string[] = [];
  return {
    get deploys() { return deploys; },
    readyUrls,
    dependencies: {
      async readRuntime(_env: any, _request: any, _project: any, operation: string) {
        if (operation === "status") return { state: { generation: { status: "idle" } } };
        const current = revisions[Math.min(index, revisions.length - 1)];
        index += 1;
        return { commitHash: current };
      },
      async openSocket(_env: any, _request: any, agentId: string) { assert.equal(agentId, "owner-agent"); return {} as WebSocket; },
      async waitForDeploy() { deploys++; return stockResult; },
      async verifyReady(_gateway: any, url: string) { readyUrls.push(url); await verifyReady?.(); },
      async verifyPublic(_browser: any, url: string) { await verifyPublic?.(url); },
    },
  };
};

function reconciliationDeps(options: {
  stateUrl?: string;
  generating?: boolean;
  sourceCss?: string;
  deployedCss?: string;
  publicAliasCss?: string;
} = {}) {
  const socket = new MockSocket();
  let deploys = 0;
  const indexHtml = '<html><body><link rel="stylesheet" href="/styles.css"></body></html>';
  const stylesCss = options.sourceCss ?? "body { color: blue; }\n";
  const deployedCss = options.deployedCss ?? stylesCss;
  const envState = nativePublishEnv();
  const gatewayHosts: string[] = [];
  const requestedFilePaths: unknown[] = [];
  envState.env.BROWSER = {
    async quickAction(_action: string, actionOptions: any) {
      assert.equal(actionOptions.url, "https://task-3-acceptance-a.lab-apps.buildcustom.ai/");
      return new Response(JSON.stringify({ result: indexHtml }));
    },
  };
  envState.env.LAB_APPS_GATEWAY = {
    async fetch(request: Request) {
      const url = new URL(request.url);
      gatewayHosts.push(url.hostname);
      if (url.hostname.endsWith(".bc-vibesdk-lab-20260925.thegoldimport.workers.dev")) {
        return new Response("gateway rejects workers.dev", { status: 404, headers: { "content-type": "text/html" } });
      }
      if (url.hostname === "northstar-coffee.lab-apps.buildcustom.ai") {
        if (url.pathname === "/styles.css") {
          return new Response(deployedCss, { headers: { "content-type": "text/css" } });
        }
        return new Response(indexHtml, { headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/style.css") {
        return new Response(options.publicAliasCss ?? stylesCss, { headers: { "content-type": "text/css" } });
      }
      if (url.pathname === "/styles.css") {
        return new Response(stylesCss, { headers: { "content-type": "text/css" } });
      }
      return new Response(indexHtml, { headers: { "content-type": "text/html" } });
    },
  };
  const dependencies = {
    async readRuntime(_env: any, _request: Request, _project: any, operation: string, path?: string) {
      if (operation === "status") return { state: { generation: { status: "idle" } } };
      if (operation === "revision") return { commitHash: "a".repeat(40) };
      if (operation === "files") return [{ path: "public/index.html" }, { path: "public/styles.css" }];
      requestedFilePaths.push(path);
      if (path === "public/index.html") return { path, content: indexHtml };
      if (path === "public/styles.css") return { path, content: stylesCss };
      return null;
    },
    async openSocket(_env: any, _request: any, agentId: string) {
      assert.equal(agentId, "owner-agent");
      setTimeout(() => socket.message(JSON.stringify({
        type: "agent_connected",
        state: {
          shouldBeGenerating: options.generating ?? false,
          cloudflareDeploymentUrl: options.stateUrl
            ?? "https://northstar-coffee.bc-vibesdk-lab-20260925.thegoldimport.workers.dev/",
        },
      })), 0);
      return socket as any;
    },
    async waitForDeploy() { deploys++; throw new Error("reconciliation must not deploy"); },
    async verifyReady(_gateway: any, url: string) {
      assert.equal(new URL(url).hostname.endsWith(".bc-vibesdk-lab-20260925.thegoldimport.workers.dev"), false);
    },
  };
  return {
    ...envState,
    socket,
    dependencies,
    gatewayHosts,
    requestedFilePaths,
    get deploys() { return deploys; },
  };
}

test("native publish claims atomically, maps slug to independent stock script, and republish is idempotent", async () => {
  const { env, state, kv } = nativePublishEnv();
  const fake = publishDeps();
  const response = await handleNativeThinkPublish(env, publishRequest(), project, "deployments", owner, {}, fake.dependencies);
  assert.equal(response?.status, 201);
  const result = await response!.json() as any;
  assert.equal(result.deploymentUrl, "https://task-3-acceptance-a.lab-apps.buildcustom.ai/");
  assert.equal(result.release.scriptName, "sanitized-script");
  assert.deepEqual(JSON.parse(kv.get("task-3-acceptance-a")!), {
    scriptName: "sanitized-script", metadata: { styleCssFallback: true },
  });
  assert.equal(state.releases.length, 1);
  const repeated = await handleNativeThinkPublish(env, publishRequest(), project, "deployments", owner, {}, fake.dependencies);
  assert.equal(repeated?.status, 200);
  assert.equal((await repeated!.json() as any).alreadyPublished, true);
  assert.equal(fake.deploys, 1);

  const previousRoute = kv.get("task-3-acceptance-a");
  const changedRevision = publishDeps(["b".repeat(40)]);
  const blockedRepublish = await handleNativeThinkPublish(env, publishRequest(), project, "deployments", owner, {}, changedRevision.dependencies);
  assert.equal(blockedRepublish?.status, 409);
  assert.equal(changedRevision.deploys, 0);
  assert.equal(kv.get("task-3-acceptance-a"), previousRoute);
  assert.equal(state.releases.length, 1);
});

test("reconcile-only adopts an owner-linked idle Think dispatch without sending deploy", async () => {
  const fixture = reconciliationDeps();
  const response = await handleNativeThinkPublish(
    fixture.env, publishRequest(), project, "reconcile-deployment", owner, {}, fixture.dependencies,
  );
  assert.equal(response?.status, 201, await response?.clone().text());
  assert.equal(fixture.deploys, 0);
  assert.deepEqual(fixture.socket.sent, []);
  assert.equal(fixture.state.releases.length, 1);
  assert.equal(fixture.state.releases[0].script_name, "northstar-coffee");
  assert.deepEqual(fixture.requestedFilePaths, ["public/index.html", "public/styles.css"]);
  assert.ok(fixture.gatewayHosts.includes("northstar-coffee.lab-apps.buildcustom.ai"));
  assert.equal(fixture.gatewayHosts.some((host) => host.endsWith(".bc-vibesdk-lab-20260925.thegoldimport.workers.dev")), false);
  assert.deepEqual(JSON.parse(fixture.kv.get("task-3-acceptance-a")!), {
    scriptName: "northstar-coffee", metadata: { styleCssFallback: true },
  });
});

test("deployments endpoint rejects reconcileOnly flags without opening a stock socket", async () => {
  const { env, state, kv } = nativePublishEnv();
  const fake = publishDeps();
  for (const reconcileOnly of [true, false]) {
    const response = await handleNativeThinkPublish(
      env, publishRequest(), project, "deployments", owner, { reconcileOnly }, fake.dependencies,
    );
    assert.equal(response?.status, 400);
  }
  assert.equal(fake.deploys, 0);
  assert.equal(kv.has("task-3-acceptance-a"), false);
  assert.equal(state.releases.length, 0);
});

test("normal publish resolves workers.dev origin through the lab gateway dispatch host", async () => {
  const { env, state } = nativePublishEnv();
  const stockOrigin = "https://northstar-coffee.bc-vibesdk-lab-20260925.thegoldimport.workers.dev/";
  const fake = publishDeps(undefined, undefined, undefined, stockOrigin);
  const response = await handleNativeThinkPublish(env, publishRequest(), project, "deployments", owner, {}, fake.dependencies);
  assert.equal(response?.status, 201);
  assert.deepEqual(fake.readyUrls, [
    "https://northstar-coffee.lab-apps.buildcustom.ai/",
    "https://task-3-acceptance-a.lab-apps.buildcustom.ai/",
  ]);
  assert.equal(state.link.deployment_origin_url, stockOrigin);
});

test("reconcile-only rejects deployed source mismatch before mapping or release", async () => {
  const fixture = reconciliationDeps({ deployedCss: "body { color: red; }\n" });
  const response = await handleNativeThinkPublish(
    fixture.env, publishRequest(), project, "reconcile-deployment", owner, {}, fixture.dependencies,
  );
  assert.equal(response?.status, 502);
  assert.equal(fixture.deploys, 0);
  assert.deepEqual(fixture.socket.sent, []);
  assert.equal(fixture.kv.has("task-3-acceptance-a"), false);
  assert.equal(fixture.state.releases.length, 0);
});

test("reconcile-only rolls back when mapped /style.css differs from authoritative source", async () => {
  const fixture = reconciliationDeps({ publicAliasCss: "body { color: green; }\n" });
  const response = await handleNativeThinkPublish(
    fixture.env, publishRequest(), project, "reconcile-deployment", owner, {}, fixture.dependencies,
  );
  assert.equal(response?.status, 502);
  assert.equal(fixture.deploys, 0);
  assert.deepEqual(fixture.socket.sent, []);
  assert.equal(fixture.kv.has("task-3-acceptance-a"), false);
  assert.equal(fixture.state.releases.length, 0);
});

test("reconcile-only rejects an untrusted stock state URL without writes", async () => {
  const fixture = reconciliationDeps({ stateUrl: "https://northstar-coffee.evil.example/" });
  const response = await handleNativeThinkPublish(
    fixture.env, publishRequest(), project, "reconcile-deployment", owner, {}, fixture.dependencies,
  );
  assert.equal(response?.status, 502);
  assert.equal(fixture.deploys, 0);
  assert.deepEqual(fixture.socket.sent, []);
  assert.equal(fixture.kv.has("task-3-acceptance-a"), false);
  assert.equal(fixture.state.releases.length, 0);
});

test("native publish rejects active claims and restores the prior mapping after readiness failure", async () => {
  const busy = nativePublishEnv({ held: true });
  const fake = publishDeps();
  const busyResponse = await handleNativeThinkPublish(busy.env, publishRequest(), project, "deployments", owner, {}, fake.dependencies);
  assert.equal(busyResponse?.status, 409);
  assert.equal(fake.deploys, 0);

  const previous = JSON.stringify({ scriptName: "old-script" });
  const envState = nativePublishEnv({ oldRoute: previous });
  const failed = publishDeps(undefined, async () => { throw new Error("not ready"); });
  const response = await handleNativeThinkPublish(envState.env, publishRequest(), project, "deployments", owner, {}, failed.dependencies);
  assert.equal(response?.status, 502);
  assert.equal(envState.kv.get("task-3-acceptance-a"), previous);
  assert.equal(envState.state.releases.length, 0);
});

test("native publish preflights a foreign KV route before consuming the stock publish", async () => {
  const foreign = JSON.stringify({ scriptName: "foreign-script", metadata: {} });
  const { env, state, kv } = nativePublishEnv({ oldRoute: foreign });
  const fake = publishDeps();
  const response = await handleNativeThinkPublish(env, publishRequest(), project, "deployments", owner, {}, fake.dependencies);
  assert.equal(response?.status, 409);
  assert.equal(fake.deploys, 0);
  assert.equal(kv.get("task-3-acceptance-a"), foreign);
  assert.equal(state.releases.length, 0);
});

test("native publish preflights a known D1 script-name collision before stock deploy", async () => {
  const { env, state } = nativePublishEnv({ scriptCollision: true });
  const fake = publishDeps();
  const response = await handleNativeThinkPublish(env, publishRequest(), project, "deployments", owner, {}, fake.dependencies);
  assert.equal(response?.status, 409);
  assert.equal(fake.deploys, 0);
  assert.equal(state.releases.length, 0);
});

test("normal publish rejects a returned script already owned by another project before mapping", async () => {
  const { env, state, kv } = nativePublishEnv({ collisionScriptName: "taken-script" });
  const fake = publishDeps(
    undefined, undefined, undefined, "https://taken-script.lab-apps.buildcustom.ai/",
  );
  const response = await handleNativeThinkPublish(env, publishRequest(), project, "deployments", owner, {}, fake.dependencies);
  assert.equal(response?.status, 502);
  assert.equal(fake.deploys, 1);
  assert.equal(kv.has("task-3-acceptance-a"), false);
  assert.equal(state.releases.length, 0);
});

test("expired publish claims can be taken over after the bounded lease", async () => {
  const { env, state } = nativePublishEnv({ held: true, expired: true });
  const fake = publishDeps();
  const response = await handleNativeThinkPublish(env, publishRequest(), project, "deployments", owner, {}, fake.dependencies);
  assert.equal(response?.status, 201);
  assert.equal(fake.deploys, 1);
  assert.equal(state.held, false);
});

test("native publish restores the previous route if release persistence fails", async () => {
  const previous = JSON.stringify({ scriptName: "old-script", metadata: {} });
  const { env, state, kv } = nativePublishEnv({ oldRoute: previous });
  env.DB.batch = async () => { throw new Error("D1 unavailable"); };
  const fake = publishDeps();
  const response = await handleNativeThinkPublish(env, publishRequest(), project, "deployments", owner, {}, fake.dependencies);
  assert.equal(response?.status, 502);
  assert.equal(kv.get("task-3-acceptance-a"), previous);
  assert.equal(state.releases.length, 0);
  assert.equal(state.held, false);
});

test("public-browser verifier checks real browser rendering and service-bound HTML/stylesheets", async () => {
  const { verifyNativePublicRoute } = await import("../cloudflare/staging/native-publish");
  const visited: string[] = [];
  const browser: any = {
    async quickAction(_action: string, options: any) {
      visited.push(options.url);
      return new Response(JSON.stringify({ result: '<html><body><link rel="stylesheet" href="/assets/site.css"></body></html>' }));
    },
  };
  const serviceRequests: string[] = [];
  const rootHtml = '<html><body><link rel="stylesheet" href="/assets/site.css"></body></html>';
  const serviceBinding = {
    async fetch(request: Request) {
      const url = request.url;
      serviceRequests.push(url);
      return url.endsWith(".css")
        ? new Response("body { color: red }", { headers: { "content-type": "text/css" } })
        : new Response(rootHtml, { headers: { "content-type": "text/html" } });
    },
  };
  await verifyNativePublicRoute(browser, "https://site.lab-apps.buildcustom.ai/",
    (url) => serviceBinding.fetch(new Request(url)));
  assert.deepEqual(visited, ["https://site.lab-apps.buildcustom.ai/"]);
  assert.deepEqual(serviceRequests, [
    "https://site.lab-apps.buildcustom.ai/",
    "https://site.lab-apps.buildcustom.ai/assets/site.css",
  ]);
  await assert.rejects(verifyNativePublicRoute(browser, "https://site.lab-apps.buildcustom.ai/", async (url) =>
    url.endsWith(".css")
      ? new Response("not css", { status: 404, headers: { "content-type": "text/html" } })
      : new Response("not html", { status: 404, headers: { "content-type": "text/html" } })), /root request failed/);
  await assert.rejects(verifyNativePublicRoute(browser, "https://site.lab-apps.buildcustom.ai/", async (url) =>
    url.endsWith(".css")
      ? new Response("not css", { status: 404, headers: { "content-type": "text/html" } })
      : new Response(rootHtml, { headers: { "content-type": "text/html" } })), /stylesheet verification failed/);
});

test("public browser failure after deployment rolls back mapping and does not persist release", async () => {
  const previous = JSON.stringify({ scriptName: "old-script", metadata: {} });
  const { env, state, kv } = nativePublishEnv({ oldRoute: previous });
  const failed = publishDeps(undefined, undefined, async () => { throw new Error("public route unavailable"); });
  const response = await handleNativeThinkPublish(env, publishRequest(), project, "deployments", owner, {}, failed.dependencies);
  assert.equal(response?.status, 502);
  assert.equal(kv.get("task-3-acceptance-a"), previous);
  assert.equal(state.releases.length, 0);
});

test("failed /style.css fallback check rolls back route and release", async () => {
  const previous = JSON.stringify({ scriptName: "old-script", metadata: {} });
  const { env, state, kv } = nativePublishEnv({ oldRoute: previous, styleAliasFails: true });
  const fake = publishDeps();
  const response = await handleNativeThinkPublish(env, publishRequest(), project, "deployments", owner, {}, fake.dependencies);
  assert.equal(response?.status, 502);
  assert.equal(kv.get("task-3-acceptance-a"), previous);
  assert.equal(state.releases.length, 0);
});

test("malformed stock deployment URL is rejected without route or release writes", async () => {
  const { env, state, kv } = nativePublishEnv();
  const fake = publishDeps(undefined, undefined, undefined, "https://stock.example.com/");
  const response = await handleNativeThinkPublish(env, publishRequest(), project, "deployments", owner, {}, fake.dependencies);
  assert.equal(response?.status, 502);
  assert.equal(kv.has("task-3-acceptance-a"), false);
  assert.equal(state.releases.length, 0);
});

test("native publish rejects revision drift and missing CSRF without touching route mappings", async () => {
  const envState = nativePublishEnv({ oldRoute: JSON.stringify({ scriptName: "old-script", metadata: {} }) });
  const previous = envState.kv.get("task-3-acceptance-a");
  const drift = publishDeps(["a".repeat(40), "a".repeat(40), "b".repeat(40)]);
  const changed = await handleNativeThinkPublish(envState.env, publishRequest(), project, "deployments", owner, {}, drift.dependencies);
  assert.equal(changed?.status, 502);
  assert.equal(envState.kv.get("task-3-acceptance-a"), previous);
  const noCsrf = await handleNativeThinkPublish(envState.env, new Request("https://control.test/api", { method: "POST" }), project, "deployments", owner);
  assert.equal(noCsrf?.status, 403);
  const otherOwner = await handleNativeThinkPublish(envState.env, publishRequest(), project, "deployments", { id: "owner-b" }, {}, drift.dependencies);
  assert.equal(otherOwner?.status, 404);
});

test("revision is checked again after readiness and public verification", async () => {
  const previous = JSON.stringify({ scriptName: "old-script", metadata: {} });
  const envState = nativePublishEnv({ oldRoute: previous });
  const revisions = ["a".repeat(40), "a".repeat(40), "a".repeat(40), "b".repeat(40)];
  const fake = publishDeps(revisions);
  const response = await handleNativeThinkPublish(envState.env, publishRequest(), project, "deployments", owner, {}, fake.dependencies);
  assert.equal(response?.status, 502);
  assert.equal(fake.deploys, 1);
  assert.equal(envState.kv.get("task-3-acceptance-a"), previous);
  assert.equal(envState.state.releases.length, 0);
});