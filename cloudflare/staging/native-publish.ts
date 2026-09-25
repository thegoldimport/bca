import { handleThinkRuntime, openStockAgentWebSocket } from "./think-runtime";
import type { BrowserRunBinding } from "./preview-image";
import { browserContent, requiredAssets } from "./published-readiness";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED = new Set(["www", "api", "app", "apps", "admin", "billing", "support", "status", "docs", "mail", "customers", "editor", "gateway"]);
const PUBLISH_TIMEOUT = 240_000;

type NativeEnv = {
  DB: D1Database;
  STAGING_ROUTES: KVNamespace;
  LAB_APPS_GATEWAY?: Fetcher;
  BROWSER?: BrowserRunBinding;
  STAGING_ROUTE_KV_ID: string;
  ENVIRONMENT: string;
} & Parameters<typeof openStockAgentWebSocket>[0];

type NativeProject = {
  id: number;
  name: string;
  user_id: string;
  agent_id?: string | null;
  runtime_provider?: string;
  creation_key?: string | null;
  initialization_status?: string;
  hosting_provider?: string;
  subdomain_slug?: string | null;
  deployment_url?: string | null;
  deployment_script_name?: string | null;
};

export type NativePublishDependencies = {
  readRuntime?: (
    env: NativeEnv,
    request: Request,
    project: NativeProject,
    operation: "status" | "revision" | "files" | "files/content",
    path?: string,
  ) => Promise<any>;
  openSocket?: (env: NativeEnv, request: Request, agentId: string) => Promise<WebSocket>;
  waitForDeploy?: (socket: WebSocket) => Promise<string>;
  waitForAgentState?: (socket: WebSocket) => Promise<any>;
  verifyReady?: (gateway: Fetcher, url: string) => Promise<void>;
  verifyPublic?: (
    browser: BrowserRunBinding | undefined,
    url: string,
    publicFetch: (url: string) => Promise<Response>,
  ) => Promise<void>;
};

export function validNativeSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG.test(value) && !RESERVED.has(value);
}

export function normalizedNativeSlug(name: string, projectId: number): string {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63).replace(/-+$/g, "");
  return validNativeSlug(normalized) ? normalized : `project-${projectId}`;
}

export function parseStockDeploymentUrl(value: unknown): { scriptName: string; url: string; dispatchUrl: string } | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const match = url.hostname.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9]))\.(?:lab-apps\.buildcustom\.ai|bc-vibesdk-lab-20260925\.thegoldimport\.workers\.dev)$/);
    if (url.protocol !== "https:" || !match || url.pathname !== "/" || url.search || url.hash
      || url.username || url.password || url.port) return null;
    return {
      scriptName: match[1],
      url: url.toString(),
      dispatchUrl: `https://${match[1]}.lab-apps.buildcustom.ai/`,
    };
  } catch {
    return null;
  }
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
}

function csrfPresent(request: Request): boolean {
  const token = request.headers.get("X-CSRF-Token");
  return Boolean(token && token.length <= 4096 && !/[\r\n]/.test(token));
}

async function runtimeData(
  env: NativeEnv,
  request: Request,
  project: NativeProject,
  operation: "status" | "revision" | "files" | "files/content",
  path?: string,
): Promise<any> {
  const url = new URL(request.url);
  if (operation === "files/content") {
    if (!path) throw new Error("An authoritative Think file path is required.");
    url.searchParams.set("path", path);
  }
  const response = await handleThinkRuntime(env, new Request(url, { method: "GET", headers: request.headers }), project as any, operation);
  if (!response || !response.ok) throw new Error("The owner-authorized project runtime could not be verified.");
  return response.json();
}

async function awaitNativeAgentState(socket: WebSocket, timeoutMs = 10_000): Promise<any> {
  socket.accept();
  return new Promise<any>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, state?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
      try { socket.close(); } catch { /* already closed */ }
      if (error) reject(error);
      else resolve(state);
    };
    const timer = setTimeout(() => finish(new Error("Think agent state timed out.")), timeoutMs);
    const onMessage = (event: MessageEvent) => {
      let message: any;
      try {
        if (typeof event.data !== "string") throw new Error();
        message = JSON.parse(event.data);
      } catch {
        finish(new Error("Think agent state was malformed."));
        return;
      }
      if (message?.type !== "agent_connected") return;
      if (!message.state || typeof message.state !== "object" || Array.isArray(message.state)) {
        finish(new Error("Think agent state was incomplete."));
        return;
      }
      finish(undefined, message.state);
    };
    const onClose = () => finish(new Error("Think connection closed before agent state was read."));
    const onError = () => finish(new Error("Think agent state connection failed."));
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
  });
}

export async function awaitNativeDeployResult(socket: WebSocket, timeoutMs = PUBLISH_TIMEOUT): Promise<string> {
  socket.accept();
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, deploymentUrl?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
      try { socket.close(); } catch { /* already closed */ }
      if (error) reject(error);
      else resolve(deploymentUrl!);
    };
    const timer = setTimeout(() => finish(new Error("Think publish timed out.")), timeoutMs);
    const onMessage = (event: MessageEvent) => {
      let message: any;
      try {
        if (typeof event.data !== "string") throw new Error();
        message = JSON.parse(event.data);
        if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.type !== "string") throw new Error();
      } catch {
        finish(new Error("Think returned a malformed publish response."));
        return;
      }
      if (message.type === "cloudflare_deployment_error" || message.type === "error") {
        finish(new Error(typeof message.error === "string" ? message.error : "Think reported a publish error."));
      } else if (message.type === "cloudflare_deployment_completed") {
        if (typeof message.deploymentUrl !== "string") finish(new Error("Think returned a malformed deployment URL."));
        else finish(undefined, message.deploymentUrl);
      }
    };
    const onClose = () => finish(new Error("Think connection closed before publishing completed."));
    const onError = () => finish(new Error("Think connection failed during publishing."));
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
    try {
      socket.send(JSON.stringify({ type: "deploy", target: "platform" }));
    } catch {
      finish(new Error("Think publish request could not be sent."));
    }
  });
}

async function verifyReady(gateway: Fetcher, url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const response = await gateway.fetch(new Request(url, { headers: { Accept: "text/html" } }));
      lastStatus = response.status;
      if (response.ok && response.headers.get("content-type")?.toLowerCase().includes("text/html")) return;
    } catch { /* Retry while the script is becoming available. */ }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Published route was not ready${lastStatus ? ` (HTTP ${lastStatus})` : ""}.`);
}

async function verifyNativeStyleAlias(gateway: Fetcher, publicUrl: string, expectedCss?: string): Promise<void> {
  const stylesheetUrl = new URL("/style.css", publicUrl);
  const response = await gateway.fetch(new Request(stylesheetUrl, { method: "GET", headers: { Accept: "text/css" } }));
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (response.status !== 200 || !contentType.includes("text/css")) {
    await response.body?.cancel();
    throw new Error(`Native public stylesheet fallback failed (${response.status}).`);
  }
  if (expectedCss !== undefined) {
    const actual = await readBoundedResponse(response, 2_000_000);
    const expected = new TextEncoder().encode(expectedCss);
    if (actual.byteLength !== expected.byteLength || actual.some((byte, index) => byte !== expected[index])) {
      throw new Error("Native public stylesheet fallback does not match the authoritative Think source.");
    }
    return;
  }
  await response.body?.cancel();
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error("Verification response exceeded the safe size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readAuthoritativeSources(
  env: NativeEnv,
  request: Request,
  project: NativeProject,
  readRuntime: NonNullable<NativePublishDependencies["readRuntime"]>,
): Promise<{ indexHtml: string; stylesCss: string }> {
  const files = await readRuntime(env, request, project, "files");
  if (!Array.isArray(files)) throw new Error("The authoritative Think file list could not be verified.");
  const paths = new Set(files.map((file: any) => file?.path).filter((path: unknown): path is string => typeof path === "string"));
  if (!paths.has("public/index.html") || !paths.has("public/styles.css")) {
    throw new Error("The authoritative Think public files are missing.");
  }
  const readFile = async (path: string): Promise<string> => {
    const content = await readRuntime(env, request, project, "files/content", path);
    if (!content || content.path !== path || typeof content.content !== "string"
      || new TextEncoder().encode(content.content).byteLength > 2_000_000) {
      throw new Error(`The authoritative Think file ${path} could not be verified.`);
    }
    return content.content;
  };
  const [indexHtml, stylesCss] = await Promise.all([
    readFile("public/index.html"),
    readFile("public/styles.css"),
  ]);
  return { indexHtml, stylesCss };
}

async function verifyDispatchedSources(
  gateway: Fetcher,
  directUrl: string,
  source: { indexHtml: string; stylesCss: string },
): Promise<void> {
  for (const [path, expected, mediaType] of [
    ["/", source.indexHtml, "text/html"],
    ["/styles.css", source.stylesCss, "text/css"],
  ] as const) {
    const url = new URL(path, directUrl);
    const response = await gateway.fetch(new Request(url, { headers: { Accept: mediaType } }));
    const type = response.headers.get("content-type")?.toLowerCase() || "";
    if (response.status !== 200 || !type.includes(mediaType)) {
      await response.body?.cancel();
      throw new Error(`The deployed ${path} response could not be verified.`);
    }
    const actual = await readBoundedResponse(response, 2_000_000);
    const expectedBytes = new TextEncoder().encode(expected);
    if (actual.byteLength !== expectedBytes.byteLength
      || actual.some((byte, index) => byte !== expectedBytes[index])) {
      throw new Error(`The deployed ${path} does not match the authoritative Think source.`);
    }
  }
}

export async function verifyNativePublicRoute(
  browser: BrowserRunBinding | undefined,
  url: string,
  publicFetch: (url: string) => Promise<Response>,
): Promise<void> {
  if (!browser) throw new Error("Public staging verification requires Browser Rendering.");
  const response = await browser.quickAction("content", {
    url,
    gotoOptions: { waitUntil: "networkidle2", timeout: 25_000 },
  });
  if (!response.ok) throw new Error(`Public browser request failed (${response.status}).`);
  const browserHtml = browserContent(await response.text());
  if (!/<html\b/i.test(browserHtml) || !/<body\b/i.test(browserHtml)) {
    throw new Error("The public browser route did not return an HTML document.");
  }
  const root = await publicFetch(url);
  const rootType = root.headers.get("content-type")?.toLowerCase() || "";
  if (root.status !== 200 || !rootType.includes("text/html")) {
    await root.body?.cancel();
    throw new Error(`Public root request failed HTML verification (${root.status}).`);
  }
  const rootHtml = await root.text();
  if (rootHtml.length > 2_000_000 || !/<html\b/i.test(rootHtml) || !/<body\b/i.test(rootHtml)) {
    throw new Error("The public route did not return a valid root HTML document.");
  }
  const stylesheets = requiredAssets(`${rootHtml}\n${browserHtml}`, url).filter((asset) => asset.kind === "css");
  if (stylesheets.length > 8) throw new Error("Public stylesheet verification exceeded the safe asset limit.");
  for (const stylesheet of stylesheets) {
    const assetUrl = new URL(stylesheet.path, url).toString();
    const asset = await publicFetch(assetUrl);
    const contentType = asset.headers.get("content-type")?.toLowerCase() || "";
    if (asset.status !== 200 || !contentType.includes("text/css")) {
      await asset.body?.cancel();
      throw new Error(`Public stylesheet verification failed (${asset.status}) for ${stylesheet.path}.`);
    }
    await asset.body?.cancel();
  }
}

function mapRelease(row: any) {
  return {
    id: row.id, projectId: row.project_id, commitHash: row.revision, scriptName: row.script_name,
    subdomainSlug: row.slug, deploymentUrl: row.public_url, status: row.status, createdAt: row.created_at,
  };
}

async function currentSlug(env: NativeEnv, project: NativeProject): Promise<string> {
  const settings = await env.DB.prepare("SELECT subdomain_slug,hosting_provider FROM runtime_project_links WHERE project_id=?")
    .bind(project.id).first<any>();
  if (settings?.hosting_provider === "custom") throw new Error("Automatic publishing is available with BuildCustom.Ai Hosting.");
  const slug = settings?.subdomain_slug || project.subdomain_slug;
  if (!validNativeSlug(slug)) return suggestedNativeSlug(env, project);
  return slug;
}

async function suggestedNativeSlug(env: NativeEnv, project: NativeProject): Promise<string> {
  const base = normalizedNativeSlug(project.name, project.id);
  let candidate = base;
  let suffix = 1;
  while (true) {
    const conflict = await env.DB.prepare("SELECT project_id FROM runtime_project_links WHERE subdomain_slug=? AND project_id<>?")
      .bind(candidate, project.id).first<any>();
    if (!conflict) return candidate;
    const tail = `-${project.id}${suffix === 1 ? "" : `-${suffix}`}`;
    candidate = `${base.slice(0, 63 - tail.length).replace(/-+$/g, "")}${tail}`;
    suffix++;
  }
}

async function assertNoForeignScriptCollision(env: NativeEnv, projectId: number, scriptName: string): Promise<void> {
  const linkedCollision = await env.DB.prepare(
    "SELECT project_id FROM runtime_project_links WHERE deployment_script_name=? AND project_id<>? LIMIT 1",
  ).bind(scriptName, projectId).first<any>();
  const releaseCollision = await env.DB.prepare(
    "SELECT project_id FROM native_publish_releases WHERE script_name=? AND project_id<>? AND status='published' LIMIT 1",
  ).bind(scriptName, projectId).first<any>();
  if (linkedCollision || releaseCollision) {
    throw new Error("The stock deployment script name is already used by another project.");
  }
}

async function publish(
  env: NativeEnv,
  request: Request,
  project: NativeProject,
  dependencies: NativePublishDependencies,
  reconcileOnly = false,
): Promise<Response> {
  if (!csrfPresent(request)) return errorResponse("A secure project request is required.", 403);
  if (!env.LAB_APPS_GATEWAY) return errorResponse("The lab apps gateway is not configured.", 503);

  // The project lookup in worker.ts is owner-filtered. Refresh the same server-side
  // link before any Think operation; no browser-provided agent identifier is read.
  const link = await env.DB.prepare("SELECT agent_id,initialization_status,hosting_provider FROM runtime_project_links WHERE project_id=?")
    .bind(project.id).first<any>();
  if (!link?.agent_id || link.initialization_status !== "ready") return errorResponse("This project is not ready for runtime access.", 409);
  const slug = await currentSlug(env, project);
  const readRuntime = dependencies.readRuntime || runtimeData;
  const status = await readRuntime(env, request, project, "status");
  if (status?.state?.generation?.status !== "idle") return errorResponse("Stop Think generation before publishing.", 409);
  const revision = await readRuntime(env, request, project, "revision");
  if (typeof revision?.commitHash !== "string" || !/^[a-f0-9]{40}$/i.test(revision.commitHash)) {
    return errorResponse("A committed Git revision is required before publishing.", 409);
  }
  const already = await env.DB.prepare("SELECT * FROM native_publish_releases WHERE project_id=? AND revision=? AND status='published' ORDER BY id DESC LIMIT 1")
    .bind(project.id, revision.commitHash).first<any>();
  if (already) {
    if (reconcileOnly) return errorResponse("A native release already exists; reconciliation is only for an unpublished dispatch.", 409);
    return Response.json({ deploymentUrl: already.public_url, release: mapRelease(already), alreadyPublished: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const priorRelease = await env.DB.prepare("SELECT revision,script_name FROM native_publish_releases WHERE project_id=? AND status='published' ORDER BY id DESC LIMIT 1")
    .bind(project.id).first<any>();
  if (priorRelease) {
    return errorResponse(
      "A changed-revision republish is paused because Think may overwrite the existing stock script in place. A versioned stock deployment name is required to preserve the current release.",
      409,
    );
  }
  if (project.deployment_script_name) {
    const linkedCollision = await env.DB.prepare(
      "SELECT project_id FROM runtime_project_links WHERE deployment_script_name=? AND project_id<>? LIMIT 1",
    ).bind(project.deployment_script_name, project.id).first<any>();
    const releaseCollision = await env.DB.prepare(
      "SELECT project_id FROM native_publish_releases WHERE script_name=? AND project_id<>? AND status='published' LIMIT 1",
    ).bind(project.deployment_script_name, project.id).first<any>();
    if (linkedCollision || releaseCollision) return errorResponse("The stock deployment script name is already used by another project.", 409);
  }

  const existingSlug = await env.DB.prepare("SELECT project_id FROM runtime_project_links WHERE subdomain_slug=? AND project_id<>?")
    .bind(slug, project.id).first<any>();
  if (existingSlug) return errorResponse("This publishing address is already in use.", 409);
  // Check the route owner before consuming the one-shot stock publish. A value
  // owned by this project may be replaced; unknown/foreign mappings fail closed.
  let savedRoute: string | null = null;
  savedRoute = await env.STAGING_ROUTES.get(slug);
  if (savedRoute !== null) {
    if (reconcileOnly) return errorResponse("The reconciliation publishing address is already mapped.", 409);
    let previous: any;
    try { previous = JSON.parse(savedRoute); } catch { return errorResponse("This publishing address has an unknown route mapping.", 409); }
    const ownsOldRoute = project.deployment_script_name && previous?.scriptName === project.deployment_script_name;
    if (!ownsOldRoute) return errorResponse("This publishing address is already in use.", 409);
  }
  const owner = await env.DB.prepare("SELECT user_id FROM projects WHERE id=?").bind(project.id).first<any>();
  if (!owner || owner.user_id !== project.user_id) return errorResponse("Project not found.", 404);

  const claimToken = crypto.randomUUID();
  // Lease duration (10 minutes) exceeds the 240s stock deploy plus bounded
  // route/browser verification, allowing takeover after a terminated Worker.
  const claim = await env.DB.prepare(
    "INSERT INTO native_publish_claims(project_id,claim_token,expires_at) VALUES(?,?,unixepoch()+600) " +
    "ON CONFLICT(project_id) DO UPDATE SET claim_token=excluded.claim_token,created_at=CURRENT_TIMESTAMP,expires_at=excluded.expires_at " +
    "WHERE native_publish_claims.expires_at<=unixepoch() RETURNING project_id",
  )
    .bind(project.id, claimToken).first<any>();
  if (!claim) return errorResponse("A publish is already in progress for this project.", 409);

  let routeWritten = false;
  let writtenRoute: string | null = null;
  try {
    const latestStatus = await readRuntime(env, request, project, "status");
    if (latestStatus?.state?.generation?.status !== "idle") throw new Error("Stop Think generation before publishing.");
    const beforeRevision = await readRuntime(env, request, project, "revision");
    if (beforeRevision?.commitHash !== revision.commitHash) throw new Error("Project revision changed before deployment.");

    const latestLink = await env.DB.prepare("SELECT agent_id,initialization_status FROM runtime_project_links WHERE project_id=?")
      .bind(project.id).first<any>();
    if (!latestLink?.agent_id || latestLink.agent_id !== link.agent_id || latestLink.initialization_status !== "ready") {
      throw new Error("This project is not ready for runtime access.");
    }
    const socket = await (dependencies.openSocket || openStockAgentWebSocket)(env, request, latestLink.agent_id);
    let deployed: { scriptName: string; url: string; dispatchUrl: string } | null;
    let authoritativeSources: { indexHtml: string; stylesCss: string } | undefined;
    if (reconcileOnly) {
      const agentState = await (dependencies.waitForAgentState || awaitNativeAgentState)(socket);
      if (agentState?.shouldBeGenerating !== false) throw new Error("Think must be idle before dispatch reconciliation.");
      deployed = parseStockDeploymentUrl(agentState?.cloudflareDeploymentUrl);
      if (!deployed) throw new Error("The owner-authorized Think state has no valid stock dispatch URL.");
    } else {
      // Think chooses the script name only after its irreversible stock publish.
      // A collision discovered below prevents routing/release writes but cannot undo
      // a stock-side overwrite that may already have occurred.
      deployed = parseStockDeploymentUrl(await (dependencies.waitForDeploy || awaitNativeDeployResult)(socket));
    }
    if (!deployed) throw new Error("Think returned an invalid lab deployment URL.");
    await assertNoForeignScriptCollision(env, project.id, deployed.scriptName);
    if (reconcileOnly) {
      authoritativeSources = await readAuthoritativeSources(env, request, project, readRuntime);
      await verifyDispatchedSources(env.LAB_APPS_GATEWAY, deployed.dispatchUrl, authoritativeSources);
    }
    const publicUrl = `https://${slug}.lab-apps.buildcustom.ai/`;

    const afterRevision = await readRuntime(env, request, project, "revision");
    if (afterRevision?.commitHash !== revision.commitHash) throw new Error("Project revision changed during deployment.");
    if (await env.STAGING_ROUTES.get(slug) !== savedRoute) throw new Error("Publishing address ownership changed during deployment.");
    writtenRoute = JSON.stringify({
      scriptName: deployed.scriptName,
      metadata: { styleCssFallback: true },
    });
    routeWritten = true;
    await env.STAGING_ROUTES.put(slug, writtenRoute);
    // Verify both direct script dispatch and the public slug route through the
    // bound lab gateway before committing a release.
    const checkReady = dependencies.verifyReady || verifyReady;
    if (!RESERVED.has(deployed.scriptName)) await checkReady(env.LAB_APPS_GATEWAY, deployed.dispatchUrl);
    await checkReady(env.LAB_APPS_GATEWAY, publicUrl);
    await verifyNativeStyleAlias(env.LAB_APPS_GATEWAY, publicUrl, authoritativeSources?.stylesCss);
    const fetchPublic = (target: string) => env.LAB_APPS_GATEWAY!.fetch(new Request(target, {
      headers: { Accept: target === publicUrl ? "text/html" : "text/css" },
      signal: AbortSignal.timeout(5_000),
    }));
    await (dependencies.verifyPublic || verifyNativePublicRoute)(env.BROWSER, publicUrl, fetchPublic);
    const finalRevision = await readRuntime(env, request, project, "revision");
    if (finalRevision?.commitHash !== revision.commitHash) throw new Error("Project revision changed during public route verification.");
    const activeClaim = await env.DB.prepare(
      "SELECT claim_token FROM native_publish_claims WHERE project_id=? AND claim_token=? AND expires_at>unixepoch()",
    ).bind(project.id, claimToken).first<any>();
    if (!activeClaim) throw new Error("The native publish claim expired or changed.");
    if (await env.STAGING_ROUTES.get(slug) !== writtenRoute) throw new Error("The public route mapping changed during verification.");

    const statements = [
      env.DB.prepare("UPDATE runtime_project_links SET deployment_url=?,deployment_origin_url=?,deployment_script_name=?,subdomain_slug=?,hosting_provider='cloudflare',updated_at=datetime('now') WHERE project_id=?")
        .bind(publicUrl, deployed.url, deployed.scriptName, slug, project.id),
      env.DB.prepare("INSERT INTO native_publish_releases(user_id,project_id,revision,script_name,slug,public_url,status) VALUES(?,?,?,?,?,?,'published') RETURNING *")
        .bind(project.user_id, project.id, revision.commitHash, deployed.scriptName, slug, publicUrl),
    ];
    const results = await env.DB.batch(statements);
    const row = results[1].results?.[0];
    if (!row) throw new Error("Native publish release could not be committed.");
    return Response.json({ deploymentUrl: publicUrl, release: mapRelease(row), alreadyPublished: false }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (routeWritten && await env.STAGING_ROUTES.get(slug) === writtenRoute) {
      if (savedRoute === null) await env.STAGING_ROUTES.delete(slug);
      else await env.STAGING_ROUTES.put(slug, savedRoute);
    }
    return errorResponse(error instanceof Error ? error.message : "Think publish failed.", 502);
  } finally {
    await env.DB.prepare("DELETE FROM native_publish_claims WHERE project_id=? AND claim_token=?").bind(project.id, claimToken).run();
  }
}

export async function handleNativeThinkPublish(
  env: NativeEnv,
  request: Request,
  project: NativeProject,
  operation: string,
  actor: { id: string },
  input: Record<string, unknown> = {},
  dependencies: NativePublishDependencies = {},
): Promise<Response | null> {
  if (env.ENVIRONMENT !== "staging") return null;
  if (actor.id !== project.user_id) return errorResponse("Project not found", 404);
  if (operation === "deployments" && request.method === "POST") {
    if (Object.prototype.hasOwnProperty.call(input, "reconcileOnly")) {
      return errorResponse("Reconciliation uses POST /runtime/reconcile-deployment.", 400);
    }
    return publish(env, request, project, dependencies);
  }
  if (operation === "reconcile-deployment" && request.method === "POST") {
    if (Object.keys(input).length > 0) return errorResponse("Reconciliation does not accept deployment details.", 400);
    return publish(env, request, project, dependencies, true);
  }
  if (operation === "releases" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM native_publish_releases WHERE project_id=? ORDER BY created_at DESC,id DESC")
      .bind(project.id).all<any>();
    return Response.json({ releases: rows.results.map(mapRelease) }, { headers: { "Cache-Control": "no-store" } });
  }
  if (operation === "publishing-settings" && request.method === "GET") {
    const link = await env.DB.prepare("SELECT subdomain_slug FROM runtime_project_links WHERE project_id=?")
      .bind(project.id).first<any>();
    const slug = validNativeSlug(link?.subdomain_slug) ? link.subdomain_slug : await suggestedNativeSlug(env, project);
    return Response.json({ subdomainSlug: slug, hostingProvider: "buildcustom", customDomain: "", customOrigin: "" }, { headers: { "Cache-Control": "no-store" } });
  }
  if (operation === "status" && request.method === "GET") {
    const response = await handleThinkRuntime(env, request, project as any, operation);
    if (!response || !response.ok) return response;
    const data = await response.json() as any;
    const release = await env.DB.prepare("SELECT public_url FROM native_publish_releases WHERE project_id=? AND status='published' ORDER BY id DESC LIMIT 1")
      .bind(project.id).first<any>();
    return Response.json({ ...data, deploymentUrl: release?.public_url || null }, { headers: { "Cache-Control": "no-store" } });
  }
  if (operation === "publishing-settings" && request.method === "PUT") {
    if (!csrfPresent(request)) return errorResponse("A secure project request is required.", 403);
    const slug = input.subdomainSlug;
    if (!validNativeSlug(slug)) return errorResponse("Choose a valid, non-reserved publishing address.", 400);
    const live = await env.DB.prepare("SELECT id FROM native_publish_releases WHERE project_id=? AND status='published' LIMIT 1").bind(project.id).first();
    if (live) return errorResponse("The published address cannot be changed while this project is live.", 409);
    const conflict = await env.DB.prepare("SELECT project_id FROM runtime_project_links WHERE subdomain_slug=? AND project_id<>?").bind(slug, project.id).first();
    if (conflict) return errorResponse("This publishing address is already in use.", 409);
    await env.DB.prepare("INSERT INTO runtime_project_links(project_id,subdomain_slug,hosting_provider) VALUES(?,?,'cloudflare') ON CONFLICT(project_id) DO UPDATE SET subdomain_slug=excluded.subdomain_slug,hosting_provider='cloudflare',updated_at=datetime('now')")
      .bind(project.id, slug).run();
    return Response.json({ subdomainSlug: slug, hostingProvider: "buildcustom", customDomain: "", customOrigin: "" }, { headers: { "Cache-Control": "no-store" } });
  }
  return null;
}