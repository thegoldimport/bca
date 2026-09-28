import { handleThinkRuntime, openStockAgentWebSocket } from "./think-runtime";
import type { BrowserRunBinding } from "./preview-image";
import { browserContent, requiredAssets } from "./published-readiness";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED = new Set(["www", "api", "app", "apps", "admin", "billing", "support", "status", "docs", "mail", "customers", "editor", "gateway"]);
const PUBLISH_PROTOCOL = "immutable-v2";
const PUBLISH_BUILD_ID = "immutable-v2";
const PUBLISH_TIMEOUT = 240_000;
const AGENT_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

type NativeEnv = {
  DB: D1Database;
  STAGING_ROUTES: KVNamespace;
  LAB_APPS_GATEWAY?: Fetcher;
  BROWSER?: BrowserRunBinding;
  STAGING_ROUTE_KV_ID: string;
  ENVIRONMENT: string;
  CONTROL_PLANE_PROFILE?: string;
  PUBLIC_GENERATED_APPS_ENABLED?: string;
  STAGING_MANAGED_GATEWAY_URL?: string;
  STAGING_GATEWAY?: Fetcher;
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
  readThinkStatus?: (
    env: NativeEnv,
    request: Request,
    project: NativeProject,
  ) => Promise<Response | null>;
  readRuntime?: (
    env: NativeEnv,
    request: Request,
    project: NativeProject,
    operation: "status" | "revision" | "files" | "files/content",
    path?: string,
  ) => Promise<any>;
  openSocket?: (env: NativeEnv, request: Request, agentId: string) => Promise<WebSocket>;
  waitForDeploy?: (socket: WebSocket, expectedRevision: string) => Promise<string>;
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

export async function nativeReleaseScriptName(agentId: string, revision: string): Promise<string | null> {
  if (typeof agentId !== "string" || !AGENT_UUID.test(agentId)
    || typeof revision !== "string" || !/^[a-f0-9]{40}$/i.test(revision)) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${agentId.toLowerCase()}:${revision.toLowerCase()}`),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const name = `bc-r-${hash.slice(0, 56)}`;
  return name.length === 61 && /^bc-r-[a-f0-9]{56}$/.test(name) ? name : null;
}

export function parseStockDeploymentUrl(
  value: unknown, expectedScriptName?: string, dispatchSuffix = "lab-apps.buildcustom.ai",
): { scriptName: string; url: string; dispatchUrl: string } | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const match = url.hostname.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9]))\./);
    if (url.protocol !== "https:" || !match || (expectedScriptName && match[1] !== expectedScriptName)
      || url.pathname !== "/" || url.search || url.hash
      || url.username || url.password || url.port) return null;
    if (dispatchSuffix === "buildcustom-vibesdk-launch.thegoldimport.workers.dev"
      && url.hostname !== `${match[1]}.${dispatchSuffix}`) return null;
    return {
      scriptName: match[1],
      url: url.toString(),
      dispatchUrl: dispatchSuffix === "buildcustom-vibesdk-launch.thegoldimport.workers.dev"
        ? `https://buildcustom-apps-gateway-launch.thegoldimport.workers.dev/c/${match[1]}/`
        : `https://${match[1]}.${dispatchSuffix}/`,
    };
  } catch {
    return null;
  }
}

function launchProfile(env: NativeEnv): boolean {
  return env.ENVIRONMENT === "production" && env.CONTROL_PLANE_PROFILE === "launch";
}

function candidateUrl(env: NativeEnv, scriptName: string): string {
  return launchProfile(env)
    ? `https://buildcustom-apps-gateway-launch.thegoldimport.workers.dev/c/${scriptName}/`
    : `https://${scriptName}.lab-apps.buildcustom.ai/`;
}

function publicUrl(env: NativeEnv, slug: string): string {
  return launchProfile(env)
    ? `${env.STAGING_MANAGED_GATEWAY_URL!.replace(/\/+$/, "")}/${slug}/`
    : `https://${slug}.lab-apps.buildcustom.ai/`;
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
}

function launchPreviewCookie(response: Response, env: NativeEnv): string | null {
  if (!launchProfile(env)) return null;
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw = response.headers.get("Set-Cookie") || "";
  const cookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : raw.split(/,\s*(?=[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/);
  return cookies.find((cookie) =>
    /^__Secure-bc-preview-[a-f0-9]{64}=[^;,]+(?:;|$)/.test(cookie) && !cookie.includes(","),
  ) || null;
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

export async function awaitNativeDeployResult(
  socket: WebSocket,
  expectedRevision: string,
  timeoutMs = PUBLISH_TIMEOUT,
): Promise<string> {
  if (!/^[a-f0-9]{40}$/.test(expectedRevision)) {
    throw new Error("An authoritative lowercase Git revision is required for immutable deployment.");
  }
  socket.accept();
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let deploySent = false;
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
      if (message.type === "agent_connected" && !deploySent) {
        if (message.deploymentCapabilities?.platformImmutableRelease !== true) {
          finish(new Error("The linked stock runtime does not support immutable platform deployment identities."));
          return;
        }
        if (message.state?.shouldBeGenerating !== false) {
          finish(new Error("Think must be idle before publishing an immutable candidate."));
          return;
        }
        try {
          socket.send(JSON.stringify({
            type: "deploy",
            target: "platform",
            immutableRelease: true,
            expectedRevision,
          }));
          deploySent = true;
        } catch {
          finish(new Error("The immutable Think publish request could not be sent."));
        }
      } else if (message.type === "cloudflare_deployment_error" || message.type === "error") {
        finish(new Error(typeof message.error === "string" ? message.error : "Think reported a publish error."));
      } else if (message.type === "cloudflare_deployment_completed") {
        if (!deploySent) {
          finish(new Error("The stock runtime returned a deployment before confirming immutable identity support."));
          return;
        }
        if (typeof message.deploymentUrl !== "string") finish(new Error("Think returned a malformed deployment URL."));
        else finish(undefined, message.deploymentUrl);
      }
    };
    const onClose = () => finish(new Error("Think connection closed before publishing completed."));
    const onError = () => finish(new Error("Think connection failed during publishing."));
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
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
): Promise<{ indexHtml: string; stylesCss: string | null }> {
  const files = await readRuntime(env, request, project, "files");
  if (!Array.isArray(files)) throw new Error("The authoritative Think file list could not be verified.");
  const paths = new Set(files.map((file: any) => file?.path).filter((path: unknown): path is string => typeof path === "string"));
  if (!paths.has("public/index.html")) throw new Error("The authoritative Think public files are missing.");
  const readFile = async (path: string): Promise<string> => {
    const content = await readRuntime(env, request, project, "files/content", path);
    if (!content || content.path !== path || typeof content.content !== "string"
      || new TextEncoder().encode(content.content).byteLength > 2_000_000) {
      throw new Error(`The authoritative Think file ${path} could not be verified.`);
    }
    return content.content;
  };
  const indexHtml = await readFile("public/index.html");
  const stylesCss = paths.has("public/styles.css") ? await readFile("public/styles.css") : null;
  return { indexHtml, stylesCss };
}

async function verifyDispatchedSources(
  gateway: Fetcher,
  directUrl: string,
  source: { indexHtml: string; stylesCss: string | null },
  launch = false,
): Promise<void> {
  const sources: Array<readonly [string, string, string]> = [["/", source.indexHtml, "text/html"]];
  if (source.stylesCss !== null) sources.push(["/styles.css", source.stylesCss, "text/css"]);
  for (const [path, expected, mediaType] of sources) {
    const url = path === "/" ? new URL(directUrl) : launch
      ? new URL(path.slice(1), directUrl)
      : new URL(path, directUrl);
    const headers = new Headers({ Accept: mediaType });
    if (launch) headers.set("X-BuildCustom-Verify-Source", "1");
    const response = await gateway.fetch(new Request(url, { headers }));
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

async function verifyStableRoute(
  gateway: Fetcher,
  stableUrl: string,
  slug: string,
  expectedScriptName: string,
): Promise<void> {
  const checkUrl = new URL("_buildcustom/route-check", stableUrl);
  const response = await gateway.fetch(new Request(checkUrl, { headers: { Accept: "application/json" } }));
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || payload?.ok !== true || payload.project !== slug
    || payload.scriptName !== expectedScriptName) {
    throw new Error("The private launch route check resolved to an unexpected project or deployment.");
  }
}

async function verifyStableRouteAbsent(gateway: Fetcher, stableUrl: string): Promise<void> {
  const checkUrl = new URL("_buildcustom/route-check", stableUrl);
  const response = await gateway.fetch(new Request(checkUrl, { headers: { Accept: "application/json" } }));
  await response.body?.cancel();
  if (response.status !== 404) {
    throw new Error("The private launch route remained reachable after rollback.");
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

export function customerDeploymentUrl(env: NativeEnv, slug: unknown): string | null {
  if (!launchProfile(env)) return null;
  return env.PUBLIC_GENERATED_APPS_ENABLED === "true" && validNativeSlug(slug)
    ? `https://${slug}.apps.buildcustom.ai` : null;
}

function visibleDeploymentUrl(env: NativeEnv, row: any): string | null {
  return launchProfile(env) ? customerDeploymentUrl(env, row.slug) : row.public_url;
}

function mapRelease(row: any, env: NativeEnv) {
  return {
    id: row.id, projectId: row.project_id, commitHash: row.revision, scriptName: row.script_name,
    subdomainSlug: row.slug, deploymentUrl: visibleDeploymentUrl(env, row),
    publicAvailable: !launchProfile(env) || Boolean(customerDeploymentUrl(env, row.slug)),
    status: row.status, createdAt: row.created_at,
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
    "SELECT project_id FROM native_publish_releases WHERE script_name=? AND project_id<>? AND status IN ('pending','published') LIMIT 1",
  ).bind(scriptName, projectId).first<any>();
  if (linkedCollision || releaseCollision) {
    throw new Error("The stock deployment script name is already used by another project.");
  }
}

async function ownsActivePublishClaim(env: NativeEnv, projectId: number, claimToken: string): Promise<boolean> {
  const claim = await env.DB.prepare(
    "SELECT claim_token FROM native_publish_claims WHERE project_id=? AND claim_token=? AND expires_at>unixepoch()",
  ).bind(projectId, claimToken).first<any>();
  return Boolean(claim);
}

async function publishImmutable(
  env: NativeEnv,
  request: Request,
  project: NativeProject,
  dependencies: NativePublishDependencies,
): Promise<Response> {
  if (!csrfPresent(request)) return errorResponse("A secure project request is required.", 403);
  if (request.headers.get("X-Publish-Protocol") !== PUBLISH_PROTOCOL) {
    return errorResponse("Refresh publishing capabilities before publishing.", 409);
  }
  const launch = launchProfile(env);
  if (launch && (env.STAGING_ROUTE_KV_ID !== "248ac5b6821a475794a7fe3d2b0c3718"
    || env.STAGING_MANAGED_GATEWAY_URL !== "https://buildcustom-apps-gateway-launch.thegoldimport.workers.dev/p"
    || !env.STAGING_GATEWAY)) return errorResponse("The private launch apps gateway is not configured.", 503);
  const gateway = launch ? env.STAGING_GATEWAY : env.LAB_APPS_GATEWAY;
  if (!gateway) return errorResponse(launch ? "The private launch apps gateway is not configured." : "The lab apps gateway is not configured.", 503);
  const fetchPublicTarget = (target: string) => gateway!.fetch(new Request(target, {
    headers: { Accept: new URL(target).pathname.endsWith(".css") ? "text/css" : "text/html" },
    signal: AbortSignal.timeout(5_000),
  }));

  // Project and agent identity come only from owner-filtered server-side rows.
  const link = await env.DB.prepare(
    "SELECT agent_id,initialization_status,hosting_provider,subdomain_slug,deployment_script_name,deployment_url,deployment_origin_url FROM runtime_project_links WHERE project_id=?",
  )
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
  const expectedRevision = revision.commitHash.toLowerCase();
  const scriptName = await nativeReleaseScriptName(link.agent_id, expectedRevision);
  if (!scriptName) return errorResponse("A collision-safe deployment identity could not be derived.", 409);
  const stableUrl = publicUrl(env, slug);
  const already = await env.DB.prepare(
    "SELECT * FROM native_publish_releases WHERE project_id=? AND revision=? AND script_name=? AND status='published' ORDER BY id DESC LIMIT 1",
  ).bind(project.id, expectedRevision, scriptName).first<any>();
  if (already) {
    try {
      const savedRoute = await env.STAGING_ROUTES.get(slug);
      let mapped: any;
      try { mapped = savedRoute === null ? null : JSON.parse(savedRoute); } catch { mapped = null; }
      if (link.deployment_script_name !== scriptName || link.deployment_url !== stableUrl
        || already.public_url !== stableUrl || mapped?.scriptName !== scriptName) {
        return errorResponse("This immutable release is not the active published route.", 409);
      }
      const authoritativeSources = await readAuthoritativeSources(env, request, project, readRuntime);
      const directUrl = candidateUrl(env, scriptName);
      const fetchPublic = fetchPublicTarget;
      const checkReady = dependencies.verifyReady || verifyReady;
      const verifyPublic = dependencies.verifyPublic || verifyNativePublicRoute;
      await verifyDispatchedSources(gateway!, directUrl, authoritativeSources, launch);
      await checkReady(gateway!, directUrl);
      await verifyPublic(env.BROWSER, directUrl, fetchPublic);
      await checkReady(gateway!, stableUrl);
      await verifyPublic(env.BROWSER, stableUrl, fetchPublic);
      if (launch) await verifyStableRoute(gateway!, stableUrl, slug, scriptName);
      const latestLink = await env.DB.prepare(
        "SELECT agent_id,initialization_status,deployment_script_name,deployment_url FROM runtime_project_links WHERE project_id=?",
      ).bind(project.id).first<any>();
      const latestRoute = await env.STAGING_ROUTES.get(slug);
      const latestStatus = await readRuntime(env, request, project, "status");
      const latestRevision = await readRuntime(env, request, project, "revision");
      if (latestLink?.agent_id !== link.agent_id || latestLink?.initialization_status !== "ready"
        || latestLink?.deployment_script_name !== scriptName || latestLink?.deployment_url !== stableUrl
        || latestRoute !== savedRoute || latestStatus?.state?.generation?.status !== "idle"
        || latestRevision?.commitHash?.toLowerCase() !== expectedRevision) {
        return errorResponse("The active immutable release changed during verification.", 409);
      }
    } catch (error) {
      return errorResponse(
        error instanceof Error ? `The existing immutable release could not be verified: ${error.message}` : "The existing immutable release could not be verified.",
        409,
      );
    }
    return Response.json({ deploymentUrl: visibleDeploymentUrl(env, already), release: mapRelease(already, env), alreadyPublished: true,
      publicAvailable: !launch || Boolean(customerDeploymentUrl(env, already.slug)) }, { headers: { "Cache-Control": "no-store" } });
  }
  const prepared = launch
    ? await env.DB.prepare(
      "SELECT * FROM native_publish_releases WHERE project_id=? AND revision=? AND script_name=? AND status='pending' ORDER BY id DESC LIMIT 1",
    ).bind(project.id, expectedRevision, scriptName).first<any>()
    : null;
  if (prepared && (prepared.slug !== slug || prepared.public_url !== stableUrl)) {
    return errorResponse("The prepared immutable release does not match the current publishing address.", 409);
  }
  const priorRelease = await env.DB.prepare(
    "SELECT * FROM native_publish_releases WHERE project_id=? AND status='published' ORDER BY id DESC LIMIT 1",
  ).bind(project.id).first<any>();
  const oldScriptName = link.deployment_script_name || priorRelease?.script_name || null;
  if (oldScriptName === scriptName) return errorResponse("The candidate identity is already active without matching release metadata.", 409);
  try {
    await assertNoForeignScriptCollision(env, project.id, scriptName);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "The candidate deployment identity is already in use.", 409);
  }

  const existingSlug = await env.DB.prepare("SELECT project_id FROM runtime_project_links WHERE subdomain_slug=? AND project_id<>?")
    .bind(slug, project.id).first<any>();
  if (existingSlug) return errorResponse("This publishing address is already in use.", 409);
  const savedRoute = await env.STAGING_ROUTES.get(slug);
  if (oldScriptName) {
    let previous: any;
    try { previous = savedRoute === null ? null : JSON.parse(savedRoute); } catch { previous = null; }
    if (previous?.scriptName !== oldScriptName) {
      return errorResponse("The current public route does not match the last-known-good deployment.", 409);
    }
  } else if (savedRoute !== null) {
    return errorResponse("This publishing address already has an unknown route mapping.", 409);
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
    const authoritativeSources = await readAuthoritativeSources(env, request, project, readRuntime);
    const referencedCss = requiredAssets(authoritativeSources.indexHtml, stableUrl)
      .filter((asset) => asset.kind === "css");
    if (authoritativeSources.stylesCss === null && referencedCss.some((asset) => {
      const path = new URL(asset.path, stableUrl).pathname;
      return path === "/styles.css" || (launch && path === `/p/${slug}/styles.css`);
    })) {
      throw new Error("The authoritative project HTML references a missing public/styles.css asset.");
    }
    const candidateFetch = fetchPublicTarget;
    const checkReady = dependencies.verifyReady || verifyReady;
    const verifyPublic = dependencies.verifyPublic || verifyNativePublicRoute;

    if (oldScriptName) {
      const oldDirectUrl = candidateUrl(env, oldScriptName);
      await checkReady(gateway!, oldDirectUrl);
      if (priorRelease?.revision === expectedRevision) {
        await verifyDispatchedSources(gateway!, oldDirectUrl, authoritativeSources, launch);
      }
      await checkReady(gateway!, stableUrl);
      await verifyPublic(env.BROWSER, stableUrl, candidateFetch);
    }

    const latestStatus = await readRuntime(env, request, project, "status");
    if (latestStatus?.state?.generation?.status !== "idle") throw new Error("Stop Think generation before publishing.");
    const beforeRevision = await readRuntime(env, request, project, "revision");
    if (beforeRevision?.commitHash?.toLowerCase() !== expectedRevision) throw new Error("Project revision changed before deployment.");

    const latestLink = await env.DB.prepare(
      "SELECT agent_id,initialization_status,deployment_script_name,deployment_url FROM runtime_project_links WHERE project_id=?",
    )
      .bind(project.id).first<any>();
    if (!latestLink?.agent_id || latestLink.agent_id !== link.agent_id
      || latestLink.initialization_status !== "ready"
      || latestLink.deployment_script_name !== link.deployment_script_name
      || latestLink.deployment_url !== link.deployment_url) {
      throw new Error("This project is not ready for runtime access.");
    }
    let deployed: ReturnType<typeof parseStockDeploymentUrl>;
    if (prepared) {
      // A prepared launch release has already passed source and browser
      // verification. Explicit Publish retries reuse it; recovery endpoints
      // remain read-only and never initiate another stock deployment.
      deployed = parseStockDeploymentUrl(
        `https://${scriptName}.buildcustom-vibesdk-launch.thegoldimport.workers.dev/`,
        scriptName,
        "buildcustom-vibesdk-launch.thegoldimport.workers.dev",
      );
    } else {
      // Stock performs the authoritative Cloudflare dispatch-script preflight
      // and create-once guard. The shared gateway cannot safely distinguish an
      // absent dispatch from an existing candidate.
      const socket = await (dependencies.openSocket || openStockAgentWebSocket)(env, request, latestLink.agent_id);
      deployed = parseStockDeploymentUrl(
        await (dependencies.waitForDeploy || awaitNativeDeployResult)(socket, expectedRevision),
        scriptName,
        launch ? "buildcustom-vibesdk-launch.thegoldimport.workers.dev" : "lab-apps.buildcustom.ai",
      );
    }
    if (!deployed) throw new Error("Think returned an invalid deployment URL.");
    await verifyDispatchedSources(gateway!, deployed.dispatchUrl, authoritativeSources, launch);

    await checkReady(gateway!, deployed.dispatchUrl);
    await verifyPublic(env.BROWSER, deployed.dispatchUrl, candidateFetch);

    // The active slug is deliberately not touched until the new script and all
    // required assets render successfully. Prove the last-known-good route is
    // still live after candidate upload and before cutover.
    if (oldScriptName) {
      const activeRoute = await env.STAGING_ROUTES.get(slug);
      if (activeRoute !== savedRoute) throw new Error("The active public route changed during candidate deployment.");
      if (priorRelease?.revision === expectedRevision) {
        await verifyDispatchedSources(
          gateway!,
          candidateUrl(env, oldScriptName),
          authoritativeSources,
          launch,
        );
      }
      await checkReady(gateway!, stableUrl);
      await verifyPublic(env.BROWSER, stableUrl, candidateFetch);
    }

    const afterRevision = await readRuntime(env, request, project, "revision");
    if (afterRevision?.commitHash?.toLowerCase() !== expectedRevision) throw new Error("Project revision changed during deployment.");
    if (await env.STAGING_ROUTES.get(slug) !== savedRoute) throw new Error("Publishing address ownership changed during deployment.");
    if (!await ownsActivePublishClaim(env, project.id, claimToken)) {
      throw new Error("The native publish claim expired or changed before route activation.");
    }
    if (launch && !prepared) {
      const preparedRow = await env.DB.prepare(
        "INSERT INTO native_publish_releases(user_id,project_id,revision,script_name,slug,public_url,status) VALUES(?,?,?,?,?,?,'pending') RETURNING *",
      ).bind(project.user_id, project.id, expectedRevision, deployed.scriptName, slug, stableUrl).first<any>();
      if (!preparedRow) throw new Error("The immutable release could not be prepared before route activation.");
    }
    writtenRoute = JSON.stringify({ scriptName, metadata: {} });
    routeWritten = true;
    await env.STAGING_ROUTES.put(slug, writtenRoute);
    // Verify the stable customer URL only after the candidate passed direct
    // dispatch, exact-source, required-asset, and rendered-page checks.
    await checkReady(gateway!, stableUrl);
    await verifyPublic(env.BROWSER, stableUrl, candidateFetch);
    if (launch) await verifyStableRoute(gateway!, stableUrl, slug, scriptName);
    const finalRevision = await readRuntime(env, request, project, "revision");
    if (finalRevision?.commitHash?.toLowerCase() !== expectedRevision) throw new Error("Project revision changed during public route verification.");
    if (!await ownsActivePublishClaim(env, project.id, claimToken)) throw new Error("The native publish claim expired or changed.");
    if (await env.STAGING_ROUTES.get(slug) !== writtenRoute) throw new Error("The public route mapping changed during verification.");
    if (launch) await verifyStableRoute(gateway!, stableUrl, slug, scriptName);

    const statements = launch ? [
      env.DB.prepare("UPDATE runtime_project_links SET deployment_url=?,deployment_origin_url=?,deployment_script_name=?,subdomain_slug=?,hosting_provider='cloudflare',updated_at=datetime('now') WHERE project_id=? AND EXISTS (SELECT 1 FROM native_publish_releases WHERE project_id=? AND revision=? AND script_name=? AND slug=? AND public_url=? AND status='pending')")
        .bind(stableUrl, deployed.url, deployed.scriptName, slug, project.id, project.id, expectedRevision, deployed.scriptName, slug, stableUrl),
      env.DB.prepare("UPDATE native_publish_releases SET status='published' WHERE project_id=? AND revision=? AND script_name=? AND slug=? AND public_url=? AND status='pending' AND EXISTS (SELECT 1 FROM runtime_project_links WHERE project_id=? AND deployment_script_name=? AND deployment_url=?) RETURNING *")
        .bind(project.id, expectedRevision, deployed.scriptName, slug, stableUrl, project.id, deployed.scriptName, stableUrl),
    ] : [
      env.DB.prepare("UPDATE runtime_project_links SET deployment_url=?,deployment_origin_url=?,deployment_script_name=?,subdomain_slug=?,hosting_provider='cloudflare',updated_at=datetime('now') WHERE project_id=?")
        .bind(stableUrl, deployed.url, deployed.scriptName, slug, project.id),
      env.DB.prepare("INSERT INTO native_publish_releases(user_id,project_id,revision,script_name,slug,public_url,status) VALUES(?,?,?,?,?,?,'published') RETURNING *")
        .bind(project.user_id, project.id, expectedRevision, deployed.scriptName, slug, stableUrl),
    ];
    const results = await env.DB.batch(statements);
    const row = results[1].results?.[0];
    if (!row) throw new Error("Native publish release could not be committed.");
    return Response.json({ deploymentUrl: visibleDeploymentUrl(env, row), release: mapRelease(row, env), alreadyPublished: false,
      publicAvailable: !launch || Boolean(customerDeploymentUrl(env, row.slug)) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (routeWritten && await env.STAGING_ROUTES.get(slug) === writtenRoute) {
      if (await ownsActivePublishClaim(env, project.id, claimToken)) {
        if (savedRoute === null) await env.STAGING_ROUTES.delete(slug);
        else await env.STAGING_ROUTES.put(slug, savedRoute);
        if (launch) {
          try {
            if (savedRoute === null) {
              if (await env.STAGING_ROUTES.get(slug) !== null) throw new Error("The private launch route rollback did not clear the new mapping.");
              await verifyStableRouteAbsent(gateway!, publicUrl(env, slug));
            } else {
              let restoredScript: unknown;
              try { restoredScript = JSON.parse(savedRoute).scriptName; } catch { /* Fail closed below. */ }
              if (typeof restoredScript !== "string") throw new Error("The last-known-good private launch route could not be parsed after rollback.");
              await verifyStableRoute(gateway!, publicUrl(env, slug), slug, restoredScript);
            }
          } catch {
            return errorResponse("The previous private launch route was restored but could not be verified.", 502);
          }
        }
      } else {
        return errorResponse("The native publish claim expired; route rollback was unsafe and was not attempted.", 502);
      }
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
  if (env.ENVIRONMENT !== "staging" && !launchProfile(env)) return null;
  if (actor.id !== project.user_id) return errorResponse("Project not found", 404);
  if (operation === "publishing-capabilities" && request.method === "GET") {
    return Response.json(
      { buildId: PUBLISH_BUILD_ID, publishProtocol: PUBLISH_PROTOCOL,
        publicGeneratedAppsEnabled: !launchProfile(env) || env.PUBLIC_GENERATED_APPS_ENABLED === "true" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (operation === "publish-immutable-v2" && request.method === "POST") {
    if (Object.keys(input).length > 0) return errorResponse("Publish accepts no client-provided deployment details.", 400);
    return publishImmutable(env, request, project, dependencies);
  }
  if (operation === "publish-immutable" && request.method === "POST") {
    return errorResponse("Use the current immutable publishing operation.", 410);
  }
  if (operation === "deployments" && request.method === "POST") {
    return errorResponse("Refresh publishing capabilities and use the immutable publish endpoint.", 410);
  }
  if (operation === "reconcile-deployment" && request.method === "POST") {
    return errorResponse("Recovery and reconciliation never invoke stock deploy. Use explicit Publish to create a candidate.", 409);
  }
  if (operation === "releases" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM native_publish_releases WHERE project_id=? ORDER BY created_at DESC,id DESC")
      .bind(project.id).all<any>();
    return Response.json({ releases: rows.results.map((row) => mapRelease(row, env)) }, { headers: { "Cache-Control": "no-store" } });
  }
  if (operation === "publishing-settings" && request.method === "GET") {
    const link = await env.DB.prepare("SELECT subdomain_slug FROM runtime_project_links WHERE project_id=?")
      .bind(project.id).first<any>();
    const slug = validNativeSlug(link?.subdomain_slug) ? link.subdomain_slug : await suggestedNativeSlug(env, project);
    return Response.json({ subdomainSlug: slug, hostingProvider: "buildcustom", customDomain: "", customOrigin: "" }, { headers: { "Cache-Control": "no-store" } });
  }
  if (operation === "status" && request.method === "GET") {
    const response = dependencies.readThinkStatus
      ? await dependencies.readThinkStatus(env, request, project)
      : await handleThinkRuntime(env, request, project as any, operation);
    if (!response) return null;
    if (!response.ok) {
      const headers = new Headers({ "Cache-Control": "no-store" });
      const contentType = response.headers.get("Content-Type");
      if (contentType) headers.set("Content-Type", contentType);
      return new Response(response.body, { status: response.status, headers });
    }
    const previewCookie = launchPreviewCookie(response, env);
    const data = await response.json() as any;
    const release = await env.DB.prepare("SELECT public_url,slug FROM native_publish_releases WHERE project_id=? AND status='published' ORDER BY id DESC LIMIT 1")
      .bind(project.id).first<any>();
    return Response.json({ ...data, deploymentUrl: release ? visibleDeploymentUrl(env, release) : null,
      publicAvailable: Boolean(release && (!launchProfile(env) || customerDeploymentUrl(env, release.slug))) }, {
      headers: {
        "Cache-Control": "no-store",
        ...(previewCookie ? { "Set-Cookie": previewCookie } : {}),
      },
    });
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