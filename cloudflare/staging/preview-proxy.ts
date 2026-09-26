import { RuntimeIdentityError } from "./runtime-identity";
import { controlOriginForRequest, configuredControlOrigin } from "./control-origin";

const LAUNCH_RUNTIME_ORIGIN = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const PREVIEW_PATH = "/_private_preview";
const AGENT_ID = /^[A-Za-z0-9_-]{1,120}$/;
const TOKEN = /^[A-Za-z0-9._~+=-]+$/;
const MAX_TOKEN_LENGTH = 2048;
const MAX_RESOURCE_PATH = 2048;
const MAX_TEXT_RESPONSE = 2_000_000;

export type LaunchPreviewEnv = {
  ENVIRONMENT?: string;
  CONTROL_PLANE_PROFILE?: string;
  AUTH_RUNTIME?: Fetcher;
  AUTH_RUNTIME_URL?: string;
  CONTROL_PLANE_ALLOWED_ORIGIN?: string;
  CONTROL_PLANE_CANARY_ORIGIN?: string;
  STAGING_ALLOWED_ORIGIN?: string;
};

type PreviewCapability = {
  agentId: string;
  branch: string;
  token?: string;
  path: string;
};

function isLaunch(env: LaunchPreviewEnv): boolean {
  return env.ENVIRONMENT === "production" && env.CONTROL_PLANE_PROFILE === "launch";
}

function runtimeOrigin(env: LaunchPreviewEnv): string {
  if (env.AUTH_RUNTIME_URL !== LAUNCH_RUNTIME_ORIGIN || !env.AUTH_RUNTIME) {
    throw new RuntimeIdentityError("The private launch preview runtime is not configured.", 503);
  }
  return LAUNCH_RUNTIME_ORIGIN;
}

function controlOrigin(env: LaunchPreviewEnv): string {
  const value = configuredControlOrigin(env);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.pathname !== "/"
      || parsed.search || parsed.hash) throw new Error();
    return parsed.origin;
  } catch {
    throw new RuntimeIdentityError("The private launch preview origin is not configured.", 503);
  }
}

function validBranch(value: string): boolean {
  return value.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && !value.includes("..") && !value.includes("//") && !value.includes("@{")
    && !value.endsWith("/") && !value.endsWith(".")
    && !value.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"));
}

function validToken(value: string): boolean {
  return value.length > 0 && value.length <= MAX_TOKEN_LENGTH && TOKEN.test(value);
}

function encodeBranch(branch: string): string {
  return encodeURIComponent(branch);
}

function safeAssetPath(raw: string): string | null {
  if (!raw || raw.length > MAX_RESOURCE_PATH || raw.startsWith("//") || raw.includes("\\")
    || /[\u0000-\u001f]/.test(raw)) return null;
  const segments = raw.replace(/^\/+/, "").split("/");
  if (segments.some((segment) => !segment)) return null;
  const safe: string[] = [];
  try {
    for (const segment of segments) {
      const decoded = decodeURIComponent(segment);
      if (!decoded || decoded === "." || decoded === ".." || decoded.includes("/")
        || decoded.includes("\\") || /[\u0000-\u001f]/.test(decoded)) return null;
      safe.push(encodeURIComponent(decoded));
    }
  } catch {
    return null;
  }
  return safe.join("/");
}

function capabilityPrefix(origin: string, capability: PreviewCapability): string {
  return `${origin}${PREVIEW_PATH}/${encodeURIComponent(capability.agentId)}/${encodeBranch(capability.branch)}/`;
}

function parseCapabilityPath(pathname: string): PreviewCapability | null {
  const match = pathname.match(/^\/_private_preview\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
  if (!match) return null;
  let agentId: string, branch: string;
  try {
    agentId = decodeURIComponent(match[1]);
    branch = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  if (!AGENT_ID.test(agentId) || !validBranch(branch)) return null;
  const path = match[3] ? safeAssetPath(match[3]) : "";
  if (match[3] && !path) return null;
  return { agentId, branch, path: path || "" };
}

function fromRuntimePreviewUrl(
  env: LaunchPreviewEnv,
  agentId: string,
  value: unknown,
): PreviewCapability | null {
  if (typeof value !== "string" || value.length > 4096 || !AGENT_ID.test(agentId)) return null;
  try {
    const url = new URL(value);
    const prefix = `/space/${encodeURIComponent(agentId)}/preview/`;
    if (url.protocol !== "https:" || url.origin !== runtimeOrigin(env)
      || url.username || url.password || url.hash || !url.pathname.startsWith(prefix)) return null;
    const branchSegment = url.pathname.slice(prefix.length);
    if (!branchSegment.endsWith("/") || !branchSegment.slice(0, -1) || branchSegment.slice(0, -1).includes("/")) return null;
    const branch = decodeURIComponent(branchSegment.slice(0, -1));
    const token = url.searchParams.get("t") || "";
    if (!validBranch(branch) || !validToken(token) || url.searchParams.size !== 1) return null;
    return { agentId, branch, token, path: "" };
  } catch {
    return null;
  }
}

/** Convert a verified runtime URL into a same-origin, branch-scoped preview URL. */
export function launchPreviewProxyUrl(env: LaunchPreviewEnv, agentId: string, value: unknown, request?: Request): string | null {
  if (!isLaunch(env)) return null;
  const capability = fromRuntimePreviewUrl(env, agentId, value);
  if (!capability) return null;
  return capabilityPrefix(request ? controlOriginForRequest(env, request) : controlOrigin(env), capability);
}

async function previewCookieName(agentId: string, branch: string): Promise<string> {
  const data = new TextEncoder().encode(`${agentId}\0${branch}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const suffix = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `__Secure-bc-preview-${suffix}`;
}

/** Return a path-scoped HttpOnly capability cookie after an owner-gated status/create call. */
export async function launchPreviewCookie(env: LaunchPreviewEnv, agentId: string, value: unknown): Promise<string | null> {
  if (!isLaunch(env)) return null;
  const capability = fromRuntimePreviewUrl(env, agentId, value);
  if (!capability?.token) return null;
  const name = await previewCookieName(capability.agentId, capability.branch);
  const path = capabilityPrefix("", capability);
  return `${name}=${encodeURIComponent(capability.token)}; Path=${path}; Max-Age=1800; Secure; HttpOnly; SameSite=None; Partitioned`;
}

async function requestPreviewToken(request: Request, capability: PreviewCapability): Promise<string | null> {
  const name = await previewCookieName(capability.agentId, capability.branch);
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      const token = decodeURIComponent(part.slice(separator + 1).trim());
      return validToken(token) ? token : null;
    } catch {
      return null;
    }
  }
  return null;
}

function capabilityFromReferer(request: Request, origin: string): PreviewCapability | null {
  const referer = request.headers.get("Referer");
  if (!referer || referer.length > 4096) return null;
  try {
    const url = new URL(referer);
    if (url.origin !== origin || url.username || url.password || url.hash) return null;
    return parseCapabilityPath(url.pathname);
  } catch {
    return null;
  }
}

function isForbiddenAppPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/")
    || pathname === PREVIEW_PATH || pathname.startsWith(`${PREVIEW_PATH}/`)
    || pathname === "/_private_preview";
}

/**
 * True for product API requests made by a same-origin preview document. They
 * must not inherit the dashboard session, even if a browser sends same-origin
 * cookies for an opaque sandboxed iframe.
 */
export function isPreviewProductApiRequest(request: Request, configuredOrigin: string): boolean {
  const path = new URL(request.url).pathname;
  if (!(path === "/api" || path.startsWith("/api/"))) return false;
  return capabilityFromReferer(request, configuredOrigin) !== null;
}

function capabilityForRequest(request: Request, origin: string): PreviewCapability | null {
  const url = new URL(request.url);
  const direct = parseCapabilityPath(url.pathname);
  if (direct) return direct;
  if (isForbiddenAppPath(url.pathname)) return null;
  const refererCapability = capabilityFromReferer(request, origin);
  if (!refererCapability) return null;
  const assetPath = url.pathname === "/" ? "" : safeAssetPath(url.pathname);
  if (assetPath === null) return null;
  return { ...refererCapability, path: assetPath };
}

function scopedHtmlUrl(
  value: string,
  requestUrl: URL,
  origin: string,
  capability: PreviewCapability,
  includeToken = true,
): string {
  const trimmed = value.trim();
  if (!trimmed || /^(?:data:|blob:|javascript:|mailto:|tel:|#|\/\/|[a-z][a-z0-9+.-]*:)/i.test(trimmed)) return value;
  try {
    const resolved = new URL(trimmed, requestUrl);
    if (resolved.origin !== origin) return value;
    const withoutPreviewToken = () => {
      if (!resolved.searchParams.has("t")) return value;
      const query = new URLSearchParams(resolved.searchParams);
      query.delete("t");
      const suffix = `${query.size ? `?${query.toString()}` : ""}${resolved.hash}`;
      return `${resolved.pathname}${suffix}`;
    };
    const prefix = capabilityPrefix(origin, capability);
    let relative: string;
    let isScopedRoot = false;
    if (trimmed.startsWith("/")) {
      let rootPath = resolved.pathname;
      let isPreviewRoot = rootPath === "/";
      const runtimePreviewPrefix =
        `/space/${encodeURIComponent(capability.agentId)}/preview/${encodeURIComponent(capability.branch)}/`;
      if (/^\/space\/[^/]+\/preview\/[^/]+(?:\/|$)/.test(rootPath)) {
        if (!rootPath.startsWith(runtimePreviewPrefix)) {
          return withoutPreviewToken();
        }
        rootPath = rootPath.slice(runtimePreviewPrefix.length);
        isPreviewRoot = !rootPath;
      }
      relative = rootPath ? safeAssetPath(rootPath) || "" : "";
      if (!relative && !isPreviewRoot) return withoutPreviewToken();
      isScopedRoot = isPreviewRoot;
    } else {
      const branchPrefix =
        `${PREVIEW_PATH}/${encodeURIComponent(capability.agentId)}/${encodeBranch(capability.branch)}/`;
      if (!resolved.pathname.startsWith(branchPrefix)) return value;
      const path = resolved.pathname.slice(branchPrefix.length);
      relative = path ? safeAssetPath(path) || "" : "";
      isScopedRoot = !path;
    }
    if ((!relative && !isScopedRoot) || (trimmed.startsWith("/") && isForbiddenAppPath(resolved.pathname))) {
      return withoutPreviewToken();
    }
    const query = new URLSearchParams(resolved.searchParams);
    query.delete("t");
    if (includeToken && relative && capability.token && validToken(capability.token)) {
      query.set("t", capability.token);
    }
    const suffix = `${query.size ? `?${query.toString()}` : ""}${resolved.hash}`;
    return `${prefix}${relative}${suffix}`;
  } catch {
    return value;
  }
}

export function rewritePreviewHtml(
  html: string,
  requestUrl: URL,
  origin: string,
  capability: PreviewCapability,
): string {
  const rewrite = (value: string) => scopedHtmlUrl(value, requestUrl, origin, capability);
  let output = html.replace(/<([a-z][a-z0-9:-]*)\b[^>]*>/gi, (tag, tagName: string) => {
    const name = tagName.toLowerCase();
    return tag.replace(
      /(\b(href|src|poster|action|formaction|xlink:href)\s*=\s*)(["'])(.*?)\3/gi,
      (_match, prefix: string, attribute: string, quote: string, value: string) => {
        const asset = attribute.toLowerCase();
        const includeToken = asset === "src" || asset === "poster" || asset === "xlink:href"
          || (asset === "href" && ["link", "use", "image"].includes(name));
        const rewritten = scopedHtmlUrl(value, requestUrl, origin, capability, includeToken);
        return `${prefix}${quote}${rewritten}${quote}`;
      },
    );
  });
  output = output.replace(
    /(\bsrcset\s*=\s*)(["'])(.*?)\2/gi,
    (_match, prefix: string, quote: string, value: string) => {
      const entries = value.split(",").map((entry) => {
        const match = entry.trim().match(/^(\S+)(\s+.*)?$/);
        return match ? `${rewrite(match[1])}${match[2] || ""}` : entry;
      });
      return `${prefix}${quote}${entries.join(", ")}${quote}`;
    },
  );
  output = output.replace(/(\bstyle\s*=\s*)(["'])(.*?)\2/gi, (_match, prefix: string, quote: string, value: string) =>
    `${prefix}${quote}${rewritePreviewCss(value, requestUrl, origin, capability)}${quote}`);
  output = output.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_match, open: string, body: string, close: string) =>
    `${open}${rewritePreviewCss(body, requestUrl, origin, capability)}${close}`);
  output = output.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (_match, open: string, body: string, close: string) =>
    `${open}${rewritePreviewJavaScript(body, requestUrl, origin, capability)}${close}`);
  output = output.replace(/<head\b[^>]*>/i, (head) => `${head}<meta name="referrer" content="no-referrer">`);
  return output;
}

export function rewritePreviewJavaScript(
  javascript: string,
  requestUrl: URL,
  origin: string,
  capability: PreviewCapability,
): string {
  return javascript.replace(/(["'])((?:\/(?!\/)|\.{1,2}\/)[^"'\\\r\n]*(?:\\.[^"'\\\r\n]*)*)\1/g, (match, _quote: string, value: string) => {
    const rewritten = scopedHtmlUrl(value, requestUrl, origin, capability);
    return rewritten === value ? match : `${_quote}${rewritten}${_quote}`;
  });
}

export function rewritePreviewCss(
  css: string,
  requestUrl: URL,
  origin: string,
  capability: PreviewCapability,
): string {
  return css
    .replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (match, _quote: string, value: string) => {
      const trimmed = value.trim();
      if (!trimmed || /^(?:data:|blob:|#|\/\/|[a-z][a-z0-9+.-]*:)/i.test(trimmed)) return match;
      const rewritten = scopedHtmlUrl(trimmed, requestUrl, origin, capability);
      return `url("${rewritten}")`;
    })
    .replace(/(@import\s+)(["'])(.*?)\2/gi, (_match, prefix: string, quote: string, value: string) => {
      const rewritten = scopedHtmlUrl(value, requestUrl, origin, capability);
      return `${prefix}${quote}${rewritten}${quote}`;
    });
}

function simpleResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function responseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  const contentType = upstream.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Referrer-Policy", "no-referrer");
  return headers;
}

/** Handle branch-scoped preview requests before normal dashboard authentication/assets routing. */
export async function handleLaunchPreviewProxy(
  env: LaunchPreviewEnv,
  request: Request,
): Promise<Response | null> {
  if (!isLaunch(env)) return null;
  const requestUrl = new URL(request.url);
  let origin: string;
  try {
    origin = controlOriginForRequest(env, request);
    runtimeOrigin(env);
  } catch {
    return simpleResponse(503, "Private preview is unavailable.");
  }
  if (requestUrl.origin !== origin) return null;
  if (request.method !== "GET") {
    if (requestUrl.pathname.startsWith(`${PREVIEW_PATH}/`)) return simpleResponse(405, "Preview only supports GET.");
    if (requestUrl.searchParams.has("t")) return simpleResponse(400, "Invalid preview request.");
    return null;
  }

  const direct = requestUrl.pathname.startsWith(`${PREVIEW_PATH}/`);
  const capability = capabilityForRequest(request, origin);
  const tokenParameters = requestUrl.searchParams.getAll("t");
  // A runtime token may bypass the cookie only for a parsed, non-root asset path.
  if (tokenParameters.length > 0
    && (!direct || !capability?.path || tokenParameters.length !== 1 || !validToken(tokenParameters[0]))) {
    return simpleResponse(400, "Invalid preview request.");
  }
  if (!capability) {
    if (direct || capabilityFromReferer(request, origin)) return simpleResponse(404, "Preview resource not found.");
    return null;
  }
  const previewToken = tokenParameters[0] || await requestPreviewToken(request, capability);
  if (!previewToken) return simpleResponse(401, "The preview capability is unavailable or expired.");
  const authorizedCapability = { ...capability, token: previewToken };
  const safeQuery = new URLSearchParams(requestUrl.search);
  safeQuery.delete("t");
  const upstreamUrl = new URL(runtimeOrigin(env));
  const assetPath = authorizedCapability.path;
  upstreamUrl.pathname = `/space/${encodeURIComponent(authorizedCapability.agentId)}/preview/${encodeURIComponent(authorizedCapability.branch)}/${assetPath}`;
  upstreamUrl.search = safeQuery.toString();
  upstreamUrl.searchParams.set("t", authorizedCapability.token!);
  const headers = new Headers();
  const accept = request.headers.get("Accept");
  if (accept && accept.length <= 512) headers.set("Accept", accept);

  let upstream: Response;
  try {
    upstream = await env.AUTH_RUNTIME!.fetch(new Request(upstreamUrl, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    }));
  } catch {
    return simpleResponse(502, "Preview runtime is temporarily unavailable.");
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    return simpleResponse(502, "The preview runtime returned an unexpected redirect.");
  }
  if ([401, 403, 429].includes(upstream.status)) {
    await upstream.body?.cancel();
    return simpleResponse(upstream.status, "The preview capability is invalid or expired.");
  }
  if (!upstream.ok) {
    const status = upstream.status === 404 ? 404 : 502;
    await upstream.body?.cancel();
    return simpleResponse(status, "The preview resource is unavailable.");
  }

  const outputHeaders = responseHeaders(upstream);
  const contentType = upstream.headers.get("Content-Type")?.toLowerCase() || "";
  if (contentType.includes("text/html") || contentType.includes("text/css")
    || contentType.includes("javascript") || contentType.includes("ecmascript")) {
    const length = Number(upstream.headers.get("Content-Length"));
    if (Number.isFinite(length) && length > MAX_TEXT_RESPONSE) {
      await upstream.body?.cancel();
      return simpleResponse(413, "Preview resource is too large.");
    }
    const text = await upstream.text();
    if (new TextEncoder().encode(text).byteLength > MAX_TEXT_RESPONSE) {
      return simpleResponse(413, "Preview resource is too large.");
    }
    const currentCapability = { ...authorizedCapability, path: assetPath };
    const body = contentType.includes("text/html")
      ? rewritePreviewHtml(text, requestUrl, origin, currentCapability)
      : contentType.includes("text/css")
        ? rewritePreviewCss(text, requestUrl, origin, currentCapability)
        : rewritePreviewJavaScript(text, requestUrl, origin, currentCapability);
    return new Response(body, { status: upstream.status, headers: outputHeaders });
  }
  return new Response(upstream.body, { status: upstream.status, headers: outputHeaders });
}
