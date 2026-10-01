import git from "isomorphic-git";
import { createFsFromVolume, Volume } from "memfs";
import { refreshProjectAgent } from "./project-initialization";
import { RuntimeIdentityError } from "./runtime-identity";
import { launchPreviewCookie, launchPreviewProxyUrl } from "./preview-proxy";
import { controlOriginForRequest } from "./control-origin";

const STOCK_RUNTIME_URL = "https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev";
const LAUNCH_RUNTIME_URL = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const AGENT_ID = /^[a-zA-Z0-9_-]{1,120}$/;
const HASH = /^[a-f0-9]{40}$/i;
const CLIENT_FRAME_LIMIT = 8_500_000;
const SERVER_FRAME_LIMIT = 16_000_000;
const FRAME_TYPE_LIMIT = 64_000;
const FRAME_TYPE_JSON_DEPTH = 24;
const SERVER_JSON_DEPTH = 64;
const FILE_LIMIT = 2_000_000;
const TREE_ENTRY_LIMIT = 2_000;
const GIT_TRANSFER_LIMIT = 16_000_000;
const GIT_REQUEST_LIMIT = 8_500_000;
const GIT_TIMEOUT_MS = 30_000;
const COOKIE_ALLOWLIST = ["accessToken", "csrf-token", "__Host-cf_oauth_token"] as const;

type Env = {
  DB: D1Database;
  AUTH_RUNTIME?: Fetcher;
  AUTH_RUNTIME_URL?: string;
  ENVIRONMENT?: string;
  CONTROL_PLANE_PROFILE?: string;
  STAGING_ALLOWED_ORIGIN?: string;
  CONTROL_PLANE_ALLOWED_ORIGIN?: string;
};

type Project = {
  id: number;
  user_id: string;
  creation_key?: string | null;
  agent_id: string | null;
  runtime_provider?: string;
  initialization_status?: string;
  preview_url?: string | null;
};

type SocketPair = { 0: WebSocket; 1: WebSocket };
type StockResponse = Response & { webSocket?: WebSocket };

function stockRuntime(env: Env): Fetcher {
  const expectedUrl = env.ENVIRONMENT === "production" && env.CONTROL_PLANE_PROFILE === "launch"
    ? LAUNCH_RUNTIME_URL : STOCK_RUNTIME_URL;
  if (env.AUTH_RUNTIME_URL !== expectedUrl || !env.AUTH_RUNTIME) {
    throw new RuntimeIdentityError("The owner-authorized staging runtime is not configured.", 503);
  }
  return env.AUTH_RUNTIME;
}

function stockRuntimeUrl(env: Env): string {
  stockRuntime(env);
  return env.AUTH_RUNTIME_URL!;
}

function ownerCookies(request: Request, includeCloudflareOAuth = false): string {
  const raw = request.headers.get("Cookie") || "";
  const allowed = new Set<string>(includeCloudflareOAuth ? COOKIE_ALLOWLIST : COOKIE_ALLOWLIST.slice(0, 2));
  const cookies = new Map<string, string>();
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (allowed.has(name) && !cookies.has(name) && value && !/[;\r\n]/.test(value)) cookies.set(name, value);
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

function ownerAccessCookie(request: Request): string {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1 || part.slice(0, index).trim() !== "accessToken") continue;
    const value = part.slice(index + 1).trim();
    if (value && value.length <= 8192 && !/[;\r\n]/.test(value)) return `accessToken=${value}`;
    break;
  }
  throw new RuntimeIdentityError("Sign in again to access this project.", 401);
}

function allowedStockPath(path: string, method: "GET" | "POST"): boolean {
  const pathname = path.split("?", 1)[0];
  if (pathname === "/api/ws-ticket") return method === "POST" && path === pathname;
  if (/^\/api\/agent\/[a-zA-Z0-9_-]{1,120}\/(?:connect|branches|preview)$/.test(pathname)) return method === "GET";
  return false;
}

export async function stockThinkRequest(
  env: Env,
  request: Request,
  path: string,
  options: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {},
): Promise<Response> {
  const method = options.method || "GET";
  if (!allowedStockPath(path, method)) throw new RuntimeIdentityError("Unsupported owner-scoped runtime request.", 400);
  const headers = new Headers({ Accept: "application/json", Cookie: ownerCookies(request) });
  if (method === "POST") {
    headers.set("Content-Type", "application/json");
    const csrf = request.headers.get("X-CSRF-Token");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  try {
    return await stockRuntime(env).fetch(new Request(`${stockRuntimeUrl(env)}${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    }));
  } catch {
    throw new RuntimeIdentityError("The owner-authorized runtime is temporarily unavailable.", 502);
  }
}

function envelope(response: any): any {
  if (response?.success === false || (Array.isArray(response?.errors) && response.errors.length > 0)) {
    throw new RuntimeIdentityError("The owner-authorized runtime returned an error.", 502);
  }
  return response?.data ?? response?.result ?? response;
}

async function responseJson(response: Response): Promise<any> {
  const bytes = await limitedBody(response, 2_000_000);
  const body = (() => {
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  })();
  if (!response.ok) {
    throw new RuntimeIdentityError(
      response.status === 401 ? "Sign in again to access this project."
        : response.status === 403 ? "This project is not available to your account."
          : response.status === 404 ? "The requested project data was not found."
            : "The owner-authorized runtime request failed.",
      response.status === 401 || response.status === 403 || response.status === 404 ? response.status : 502,
    );
  }
  if (!body) throw new RuntimeIdentityError("The owner-authorized runtime returned an invalid response.", 502);
  return envelope(body);
}

async function limitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredSize = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new RuntimeIdentityError("The owner-authorized runtime response is too large.", 413);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RuntimeIdentityError("The owner-authorized runtime response is too large.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function safeProjectPath(path: string | null): string {
  if (!path || path.length > 512 || path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f]/.test(path)) {
    throw new RuntimeIdentityError("Choose a valid file path.", 400);
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new RuntimeIdentityError("Choose a valid file path.", 400);
  }
  return path;
}

async function currentBranch(env: Env, request: Request, agentId: string): Promise<string | null> {
  const response = await stockThinkRequest(env, request, `/api/agent/${agentId}/branches`);
  const value = await responseJson(response);
  if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, "current")) {
    throw new RuntimeIdentityError("The current project branch could not be verified.", 502);
  }
  if (value.current === null) return null;
  const branch = value.current;
  if (typeof branch !== "string" || !validBranch(branch)) {
    throw new RuntimeIdentityError("The current project branch could not be verified.", 502);
  }
  return branch;
}

type GitSnapshot = {
  fs: ReturnType<typeof createFsFromVolume>;
  dir: string;
  commitHash: string | null;
  files: Array<{ path: string }>;
};

function accessTokenCookie(request: Request): string {
  return ownerAccessCookie(request).slice("accessToken=".length);
}

function validBranch(value: string): boolean {
  return value.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && !value.includes("..") && !value.includes("//") && !value.includes("@{")
    && !value.endsWith("/") && !value.endsWith(".") && !value.split("/").some((part) =>
      !part || part.startsWith(".") || part.endsWith(".lock"));
}

async function iterableBytes(body: AsyncIterableIterator<Uint8Array> | undefined, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (body) {
    for await (const chunk of body) {
      total += chunk.byteLength;
      if (total > limit) throw new RuntimeIdentityError("The project Git request is too large.", 413);
      chunks.push(chunk);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function* responseChunks(response: Response, maxBytes: number, addBytes: (size: number) => void) {
  if (!response.body) return;
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      total += value.byteLength;
      if (total > maxBytes) throw new RuntimeIdentityError("The project Git response is too large.", 413);
      addBytes(value.byteLength);
      yield value;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function gitHttpAdapter(env: Env, agentId: string, token: string): {
  request: (request: import("isomorphic-git").GitHttpRequest) => Promise<import("isomorphic-git").GitHttpResponse>;
  isEmptyRepository: () => boolean;
} {
  const expectedRepo = `/apps/${agentId}.git`;
  let transferred = 0;
  let emptyAdvertisement = false;
  const deadline = Date.now() + GIT_TIMEOUT_MS;
  return {
    isEmptyRepository: () => emptyAdvertisement,
    async request(gitRequest) {
      const target = new URL(gitRequest.url);
      const isInfoRefs = target.pathname === `${expectedRepo}/info/refs`;
      const isUploadPack = target.pathname === `${expectedRepo}/git-upload-pack`;
      const expectedQuery = isInfoRefs && target.search === "?service=git-upload-pack";
      if (target.origin !== stockRuntimeUrl(env) || target.username || target.password || target.hash
        || !(isInfoRefs && expectedQuery && gitRequest.method === "GET"
          || isUploadPack && !target.search && gitRequest.method === "POST")) {
        throw new RuntimeIdentityError("Unsupported project Git request.", 502);
      }

      const body = await iterableBytes(gitRequest.body, GIT_REQUEST_LIMIT);
      const headers = new Headers(gitRequest.headers);
      if (gitRequest.headers) {
        for (const [name, value] of Object.entries(gitRequest.headers)) headers.set(name, value);
      }
      headers.set("Authorization", `Bearer ${token}`);
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new RuntimeIdentityError("The project Git request timed out.", 504);
      let response: Response;
      try {
        response = await stockRuntime(env).fetch(new Request(target.toString(), {
          method: gitRequest.method,
          headers,
          body: gitRequest.method === "POST" ? body : undefined,
          redirect: "manual",
          signal: AbortSignal.timeout(remainingMs),
        }));
      } catch (error) {
        if (error instanceof RuntimeIdentityError) throw error;
        throw new RuntimeIdentityError("The owner-authorized project Git service is unavailable.", 502);
      }
      if (response.url && response.url !== target.toString()) {
        throw new RuntimeIdentityError("The project Git service returned an unexpected redirect.", 502);
      }
      if (response.status === 401) throw new RuntimeIdentityError("Sign in again to access this project.", 401);
      if (response.status === 403) throw new RuntimeIdentityError("This project is not available to your account.", 403);
      if (response.status !== 200) {
        throw new RuntimeIdentityError("The owner-authorized project Git request failed.", 502);
      }
      const length = Number(response.headers.get("Content-Length"));
      if (Number.isFinite(length) && length > GIT_TRANSFER_LIMIT) {
        throw new RuntimeIdentityError("The project Git response is too large.", 413);
      }
      const chunks: Uint8Array[] = [];
      let responseSize = 0;
      for await (const chunk of responseChunks(response, GIT_TRANSFER_LIMIT, (size) => {
        transferred += size;
        if (transferred > GIT_TRANSFER_LIMIT) throw new RuntimeIdentityError("The project Git transfer is too large.", 413);
      })) {
        responseSize += chunk.byteLength;
        chunks.push(chunk);
      }
      const responseBytes = new Uint8Array(responseSize);
      let offset = 0;
      for (const chunk of chunks) {
        responseBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (isInfoRefs && new TextDecoder().decode(responseBytes) === "001e# service=git-upload-pack\n0000") {
        emptyAdvertisement = true;
      }
      async function* bodyIterator() { yield responseBytes; }
      return {
        url: target.toString(),
        method: gitRequest.method,
        statusCode: response.status,
        statusMessage: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: bodyIterator(),
      };
    },
  };
}

async function currentGitSnapshot(
  env: Env, request: Request, agentId: string, branch: string | null,
): Promise<GitSnapshot> {
  const volume = new Volume();
  const fs = createFsFromVolume(volume);
  const dir = "/project";
  if (!branch) return { fs, dir, commitHash: null, files: [] };
  if (!AGENT_ID.test(agentId) || !validBranch(branch)) {
    throw new RuntimeIdentityError("The current project branch could not be verified.", 502);
  }
  const token = accessTokenCookie(request);
  const http = gitHttpAdapter(env, agentId, token);
  try {
    await http.request({
          url: `${stockRuntimeUrl(env)}/apps/${agentId}.git/info/refs?service=git-upload-pack`,
      method: "GET",
      headers: { Accept: "application/x-git-upload-pack-advertisement" },
    });
    if (http.isEmptyRepository()) return { fs, dir, commitHash: null, files: [] };
    await git.clone({
      fs, http, dir, url: `${stockRuntimeUrl(env)}/apps/${agentId}.git`,
      ref: branch, singleBranch: true, noCheckout: true,
    });
  } catch (error) {
    if (!http.isEmptyRepository()) {
      if (error instanceof RuntimeIdentityError) throw error;
      throw new RuntimeIdentityError("The project Git revision could not be read or verified.", 502);
    }
    return { fs, dir, commitHash: null, files: [] };
  }
  let commitHash: string;
  try {
    commitHash = await git.resolveRef({ fs, dir, ref: "HEAD" });
  } catch (error) {
    if (http.isEmptyRepository()) return { fs, dir, commitHash: null, files: [] };
    throw new RuntimeIdentityError("The current project revision could not be verified.", 502);
  }
  if (!HASH.test(commitHash)) throw new RuntimeIdentityError("The current project revision could not be verified.", 502);
  let paths: string[];
  try {
    paths = await git.listFiles({ fs, dir, ref: "HEAD" });
  } catch {
    throw new RuntimeIdentityError("The project file tree could not be read.", 502);
  }
  if (paths.length > TREE_ENTRY_LIMIT) {
    throw new RuntimeIdentityError("This project contains too many files to list safely.", 413);
  }
  let totalPathBytes = 0;
  const files = paths.map((path) => {
    totalPathBytes += new TextEncoder().encode(path).byteLength;
    const segments = path.split("/");
    if (!path || path.length > 512 || path.startsWith("/") || path.includes("\\")
      || /[\u0000-\u001f]/.test(path) || segments.length > 25
      || segments.some((part) => !part || part === "." || part === "..")) {
      throw new RuntimeIdentityError("The project file tree contains an invalid path.", 502);
    }
    return { path };
  });
  if (totalPathBytes > 1_000_000) throw new RuntimeIdentityError("The project file tree is too large to list safely.", 413);
  return { fs, dir, commitHash, files };
}

async function listCurrentFiles(env: Env, request: Request, agentId: string): Promise<Array<{ path: string; size?: number }>> {
  const branch = await currentBranch(env, request, agentId);
  const snapshot = await currentGitSnapshot(env, request, agentId, branch);
  return snapshot.files;
}

async function readCurrentFile(env: Env, request: Request, agentId: string, path: string): Promise<{ path: string; content: string }> {
  const branch = await currentBranch(env, request, agentId);
  if (!branch) throw new RuntimeIdentityError("This project has no committed files yet.", 404);
  const snapshot = await currentGitSnapshot(env, request, agentId, branch);
  if (!snapshot.commitHash) throw new RuntimeIdentityError("This project has no committed files yet.", 404);
  if (!snapshot.files.some((file) => file.path === path)) {
    throw new RuntimeIdentityError("This file is not in the current project revision.", 404);
  }
  try {
    const result = await git.readBlob({ fs: snapshot.fs, dir: snapshot.dir, oid: snapshot.commitHash, filepath: path });
    if (result.blob.byteLength > FILE_LIMIT) throw new RuntimeIdentityError("This file is too large to display.", 413);
    return { path, content: new TextDecoder().decode(result.blob) };
  } catch (error) {
    if (error instanceof RuntimeIdentityError) throw error;
    throw new RuntimeIdentityError("The project file could not be read.", 502);
  }
}

function allowedPreviewUrl(env: Env, agentId: string, value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    const runtime = new URL(env.AUTH_RUNTIME_URL!);
    const previewPrefix = `/space/${encodeURIComponent(agentId)}/preview/`;
    const branchPath = url.pathname.startsWith(previewPrefix) ? url.pathname.slice(previewPrefix.length) : "";
    if (url.protocol !== "https:" || url.origin !== runtime.origin || url.username || url.password || url.hash
      || !branchPath || branchPath === "/" || !branchPath.endsWith("/") || !url.searchParams.get("t")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function issueTicket(env: Env, request: Request, agentId: string): Promise<string> {
  const accessCookie = ownerAccessCookie(request);
  let csrfResponse: Response;
  try {
    csrfResponse = await stockRuntime(env).fetch(new Request(`${stockRuntimeUrl(env)}/api/auth/csrf-token`, {
      method: "GET",
      headers: { Accept: "application/json", Cookie: accessCookie, "Cache-Control": "no-store" },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    }));
  } catch {
    throw new RuntimeIdentityError("The owner-authorized runtime is temporarily unavailable.", 502);
  }
  const csrfData = await responseJson(csrfResponse);
  const csrfToken = csrfData?.token;
  const setCookies = (csrfResponse.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [];
  const csrfSetCookie = setCookies.find((value) => /^csrf-token=/i.test(value));
  const csrfCookieValue = csrfSetCookie?.split(";", 1)[0].slice("csrf-token=".length);
  if (typeof csrfToken !== "string" || !csrfToken || csrfToken.length > 4096 || /[\r\n]/.test(csrfToken)
    || !csrfCookieValue || csrfCookieValue.length > 4096 || /[;\r\n]/.test(csrfCookieValue)
    || /(?:^|;)\s*Domain=/i.test(csrfSetCookie || "")) {
    throw new RuntimeIdentityError("The runtime did not provide a valid secure request token.", 502);
  }
  let response: Response;
  try {
    response = await stockRuntime(env).fetch(new Request(`${stockRuntimeUrl(env)}/api/ws-ticket`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: `${accessCookie}; csrf-token=${csrfCookieValue}`,
        "X-CSRF-Token": csrfToken,
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({ resourceType: "agent", resourceId: agentId }),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    }));
  } catch {
    throw new RuntimeIdentityError("The owner-authorized runtime is temporarily unavailable.", 502);
  }
  const data = await responseJson(response);
  if (typeof data?.ticket !== "string" || !/^tk_[a-f0-9]{32,}$/i.test(data.ticket)) {
    throw new RuntimeIdentityError("The runtime did not provide a valid connection ticket.", 502);
  }
  return data.ticket;
}

export async function openStockAgentWebSocket(env: Env, request: Request, agentId: string): Promise<WebSocket> {
  if (!AGENT_ID.test(agentId)) throw new RuntimeIdentityError("Invalid linked project reference.", 502);
  const ticket = await issueTicket(env, request, agentId);
  const headers = new Headers({ Upgrade: "websocket", Cookie: ownerCookies(request, true) });
  const csrf = request.headers.get("X-CSRF-Token");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  let response: StockResponse;
  try {
    response = await stockRuntime(env).fetch(new Request(
      `${stockRuntimeUrl(env)}/api/agent/${agentId}/ws?ticket=${encodeURIComponent(ticket)}`,
      { headers, signal: AbortSignal.timeout(15_000) },
    )) as StockResponse;
  } catch {
    throw new RuntimeIdentityError("The owner-authorized project connection failed.", 502);
  }
  if (response.status !== 101 || !response.webSocket) {
    throw new RuntimeIdentityError("The owner-authorized project connection failed.", 502);
  }
  return response.webSocket;
}

export function allowedNativeClientFrame(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const frame = value as Record<string, unknown>;
  if (frame.type === "get_conversation_state") return { type: frame.type };
  if (frame.type === "stop_generation") return { type: frame.type };
  if (frame.type === "user_suggestion" && typeof frame.message === "string"
    && frame.message.trim().length > 0 && frame.message.length <= 30_000) {
    const clean: Record<string, unknown> = { type: frame.type, message: frame.message };
    if (frame.images !== undefined) {
      if (!Array.isArray(frame.images) || frame.images.length > 2) return null;
      let total = 0;
      const images: Array<Record<string, unknown>> = [];
      for (const item of frame.images) {
        const image = item as Record<string, unknown>;
        if (!image || typeof image !== "object" || typeof image.id !== "string" || image.id.length > 128
          || typeof image.filename !== "string" || image.filename.length > 255
          || !["image/png", "image/jpeg", "image/webp"].includes(String(image.mimeType))
          || typeof image.base64Data !== "string" || image.base64Data.length > 5_600_000
          || !Number.isFinite(image.size) || Number(image.size) < 0 || Number(image.size) > 4_000_000) return null;
        total += Number(image.size);
        if (total > 8_000_000) return null;
        images.push({
          id: image.id,
          filename: image.filename,
          mimeType: image.mimeType,
          base64Data: image.base64Data,
          size: image.size,
        });
      }
      clean.images = images;
    }
    return clean;
  }
  return null;
}

function socketText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return null;
}

const SENSITIVE_STATE_KEY = /token|secret|credential|authorization|cookie|password|api.?key|private.?key/i;

function redactStateCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactStateCredentials);
  if (!value || typeof value !== "object") return value;
  const clean: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!SENSITIVE_STATE_KEY.test(key)) clean[key] = redactStateCredentials(child);
  }
  return clean;
}

function jsonDepthWithinLimit(value: string, limit: number): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of value) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{" || char === "[") {
      depth += 1;
      if (depth > limit) return false;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return !inString && depth === 0;
}

function containsFrameworkEnvelope(value: unknown, depth = 0): boolean {
  if (depth > FRAME_TYPE_JSON_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => containsFrameworkEnvelope(item, depth + 1));
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "type" && typeof child === "string" && /^cf_agent_/i.test(child)) return true;
    if (containsFrameworkEnvelope(child, depth + 1)) return true;
  }
  return false;
}

export function filterNativeServerFrame(value: string): string | null {
  if (new TextEncoder().encode(value).byteLength > SERVER_FRAME_LIMIT || !jsonDepthWithinLimit(value, SERVER_JSON_DEPTH)) return null;
  let frame: unknown;
  try { frame = JSON.parse(value); } catch { return null; }
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return null;
  const record = frame as Record<string, unknown>;
  if (typeof record.type !== "string") return null;
  const frameType = record.type.trim();
  const typeLooksLikeJson = /^[{\["]/.test(frameType);
  if (typeLooksLikeJson) {
    if (new TextEncoder().encode(frameType).byteLength > FRAME_TYPE_LIMIT
      || !jsonDepthWithinLimit(frameType, FRAME_TYPE_JSON_DEPTH)) return null;
    let parsedType: unknown;
    try { parsedType = JSON.parse(frameType); } catch { return null; }
    if (containsFrameworkEnvelope(parsedType)) return null;
    // JSON-bearing frame types are non-native framework envelopes; fail closed.
    return null;
  }
  if (frameType.length > 64 || !/^[a-z][a-z0-9_]*$/.test(frameType)
    || /^cf_agent_/i.test(frameType)) return null;
  if (record.state && typeof record.state === "object") {
    return JSON.stringify({ ...record, type: frameType, state: redactStateCredentials(record.state) });
  }
  return JSON.stringify({ ...record, type: frameType });
}

function relay(server: WebSocket, upstream: WebSocket): void {
  server.accept();
  upstream.accept();
  const closeBoth = (code = 1000, reason = "Connection closed") => {
    try { server.close(code, reason); } catch { /* already closed */ }
    try { upstream.close(code, reason); } catch { /* already closed */ }
  };
  server.addEventListener("message", (event) => {
    const text = socketText(event.data);
    if (text === null || new TextEncoder().encode(text).byteLength > CLIENT_FRAME_LIMIT) {
      closeBoth(1009, "Message is too large.");
      return;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch {
      closeBoth(1008, "Invalid project message.");
      return;
    }
    const clean = allowedNativeClientFrame(parsed);
    if (!clean) {
      try { server.send(JSON.stringify({ type: "error", error: "This project action is not available." })); } catch { /* closed */ }
      return;
    }
    try { upstream.send(JSON.stringify(clean)); } catch { closeBoth(1011, "Project connection failed."); }
  });
  upstream.addEventListener("message", (event) => {
    const text = socketText(event.data);
    const size = text === null ? (event.data instanceof ArrayBuffer ? event.data.byteLength : SERVER_FRAME_LIMIT + 1)
      : new TextEncoder().encode(text).byteLength;
    if (size > SERVER_FRAME_LIMIT) {
      closeBoth(1009, "Runtime message is too large.");
      return;
    }
    if (text === null) return;
    const safeFrame = filterNativeServerFrame(text);
    if (safeFrame === null) return;
    try { server.send(safeFrame); } catch { closeBoth(1011, "Project connection failed."); }
  });
  server.addEventListener("close", (event) => closeBoth(event.code, event.reason));
  upstream.addEventListener("close", (event) => {
    try { server.close(event.code, event.reason); } catch { /* already closed */ }
  });
  server.addEventListener("error", () => closeBoth(1011, "Project connection failed."));
  upstream.addEventListener("error", () => closeBoth(1011, "Project connection failed."));
}

async function bridgeWebSocket(env: Env, request: Request, project: Project, origin: string): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket upgrade required.", { status: 426 });
  if (request.headers.get("Origin") !== origin) return Response.json({ message: "Project connection origin rejected." }, { status: 403 });
  if ([...new URL(request.url).searchParams.keys()].length) return Response.json({ message: "Project connection parameters are not accepted." }, { status: 400 });
  const link = await refreshProjectAgent(env, request, project);
  const agentId = link?.agent_id;
  if (!agentId || !AGENT_ID.test(agentId) || link.initialization_status !== "ready") {
    return Response.json({ message: "This project is not ready for editing." }, { status: 409 });
  }
  const upstream = await openStockAgentWebSocket(env, request, agentId);
  const pair = new WebSocketPair() as SocketPair;
  relay(pair[1], upstream);
  return new Response(null, { status: 101, webSocket: pair[0], headers: { "Cache-Control": "no-store" } });
}

export function shapeThinkHistory(messages: unknown): Array<{
  id: number;
  mode: "build";
  prompt: string;
  response: string;
  changedFiles: Array<never>;
  activity: Array<never>;
  commitHash: null;
  createdAt: string;
}> {
  if (!Array.isArray(messages)) throw new RuntimeIdentityError("The project conversation returned an invalid result.", 502);
  const turns: Array<{
    id: number;
    mode: "build";
    prompt: string;
    response: string;
    changedFiles: Array<never>;
    activity: Array<never>;
    commitHash: null;
    createdAt: string;
  }> = [];
  const contentText = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.flatMap((part: any) => part?.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n");
  };
  for (const item of messages) {
    if (item?.role === "user") {
      turns.push({
        id: turns.length + 1,
        mode: "build",
        prompt: contentText(item.content),
        response: "",
        changedFiles: [],
        activity: [],
        commitHash: null,
        createdAt: "",
      });
    } else if (item?.role === "assistant" && turns.length) {
      const text = contentText(item.content);
      if (text) turns[turns.length - 1].response += `${turns[turns.length - 1].response ? "\n" : ""}${text}`;
    }
  }
  return turns;
}

const NATIVE_TASK_STATUSES = new Set(["RUNNING", "COMPLETE", "BLOCKED", "INCOMPLETE_RESOURCE_LIMIT"]);
const NATIVE_RESOURCE_REASONS = new Set([
  "credit_limit", "model_call_limit", "tool_call_limit", "elapsed_time_limit",
  "available_credits_limit", "continuation_budget_exhausted",
]);

export function projectOwnerNativeTaskLifecycle(value: unknown):
  { status: string; updatedAt: number; reason?: string } | undefined {
  if (value === undefined) return undefined; // Older runtime versions remain compatible.
  const lifecycle = value as Record<string, unknown> | null;
  if (!lifecycle || typeof lifecycle.status !== "string" || !NATIVE_TASK_STATUSES.has(lifecycle.status)
    || typeof lifecycle.updatedAt !== "number" || !Number.isFinite(lifecycle.updatedAt)) {
    throw new RuntimeIdentityError("The native task status was incomplete.", 502);
  }
  return {
    status: lifecycle.status,
    updatedAt: lifecycle.updatedAt,
    ...(typeof lifecycle.reason === "string" && NATIVE_RESOURCE_REASONS.has(lifecycle.reason)
      ? { reason: lifecycle.reason } : {}),
  };
}

type ThinkStatusSnapshot = {
  shouldBeGenerating: boolean;
  previewUrl: string | null;
  nativeTaskLifecycle?: ReturnType<typeof projectOwnerNativeTaskLifecycle>;
};

async function stockStatusSnapshot(env: Env, request: Request, agentId: string): Promise<ThinkStatusSnapshot> {
  const socket = await openStockAgentWebSocket(env, request, agentId);
  return new Promise<ThinkStatusSnapshot>((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, snapshot?: ThinkStatusSnapshot) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { socket.close(1000, "Status read complete."); } catch { /* already closed */ }
      if (error) reject(error);
      else resolve(snapshot!);
    };
    const timeout = setTimeout(() => {
      finish(new RuntimeIdentityError("The native Think status could not be loaded.", 502));
    }, 8_000);
    socket.addEventListener("message", (event) => {
      const text = socketText(event.data);
      if (!text || new TextEncoder().encode(text).byteLength > SERVER_FRAME_LIMIT) {
        return finish(new RuntimeIdentityError("The native Think status returned an invalid frame.", 502));
      }
      let message: any;
      try { message = JSON.parse(text); } catch {
        return finish(new RuntimeIdentityError("The native Think status returned an invalid frame.", 502));
      }
      if (message?.type === "error") {
        return finish(new RuntimeIdentityError("The native task status could not be loaded.", 502));
      }
      if (message?.type !== "agent_connected") return;
      if (typeof message.state?.shouldBeGenerating !== "boolean") {
        return finish(new RuntimeIdentityError("The native Think status was incomplete.", 502));
      }
      const previewUrl = message.previewUrl
        ? allowedPreviewUrl(env, agentId, message.previewUrl)
        : null;
      let nativeTaskLifecycle;
      try { nativeTaskLifecycle = projectOwnerNativeTaskLifecycle(message.nativeTaskLifecycle); }
      catch {
        return finish(new RuntimeIdentityError("The native task status was incomplete.", 502));
      }
      finish(null, {
        shouldBeGenerating: message.state.shouldBeGenerating,
        previewUrl,
        ...(nativeTaskLifecycle ? { nativeTaskLifecycle } : {}),
      });
    });
    socket.addEventListener("error", () => finish(new RuntimeIdentityError("The native Think status connection failed.", 502)));
    socket.accept();
  });
}

async function stockHistory(env: Env, request: Request, agentId: string): Promise<any[]> {
  const socket = await openStockAgentWebSocket(env, request, agentId);
  socket.accept();
  return new Promise<any[]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { socket.close(1000, "History read complete."); } catch { /* closed */ }
      reject(new RuntimeIdentityError("The project conversation could not be loaded.", 502));
    }, 15_000);
    const finish = (error: Error | null, value: any[] = []) => {
      clearTimeout(timeout);
      try { socket.close(1000, "History read complete."); } catch { /* closed */ }
      if (error) reject(error);
      else resolve(value);
    };
    socket.addEventListener("message", (event) => {
      const text = socketText(event.data);
      if (!text || new TextEncoder().encode(text).byteLength > SERVER_FRAME_LIMIT) return finish(new RuntimeIdentityError("The project conversation could not be loaded.", 502));
      try {
        const message = JSON.parse(text);
        if (message?.type !== "conversation_state") return;
        const messages = message.state?.fullHistory;
        finish(null, shapeThinkHistory(messages));
      } catch {
        finish(new RuntimeIdentityError("The project conversation could not be read.", 502));
      }
    });
    socket.addEventListener("error", () => finish(new RuntimeIdentityError("The project conversation connection failed.", 502)));
    try { socket.send(JSON.stringify({ type: "get_conversation_state" })); }
    catch { finish(new RuntimeIdentityError("The project conversation connection failed.", 502)); }
  });
}

export async function handleThinkRuntime(
  env: Env,
  request: Request,
  project: Project,
  operation: string,
): Promise<Response | null> {
  if (project.runtime_provider !== "stock-think" && !project.creation_key) return null;
  const origin = controlOriginForRequest(env, request);
  const agentId = project.agent_id || "";
  if (operation === "ws" && request.method === "GET") return bridgeWebSocket(env, request, project, origin);

  if (operation === "previews" && request.method === "POST" && !request.headers.get("X-CSRF-Token")) {
    return Response.json({ message: "A secure project request is required." }, { status: 403 });
  }
  const supportedRead = request.method === "GET"
    && ["status", "revision", "files", "files/content", "turns"].includes(operation);
  if (!supportedRead && !(operation === "previews" && request.method === "POST")) return null;
  const link = await refreshProjectAgent(env, request, project);
  if ((!link?.agent_id || !AGENT_ID.test(link.agent_id) || link.initialization_status !== "ready")
    && operation === "status" && request.method === "GET") {
    return Response.json({
      nativeThink: true,
      runtimeStatus: link?.initialization_status || "missing",
      connected: false,
      files: 0,
      state: { generation: { status: "unknown" } },
      previewUrl: null,
      deploymentUrl: null,
    }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!link?.agent_id || !AGENT_ID.test(link.agent_id) || link.initialization_status !== "ready") {
    return Response.json({ message: "This project is not ready for runtime access." }, { status: 409 });
  }
  const linkedAgentId = link.agent_id;
  if (operation === "revision" && request.method === "GET") {
    const branch = await currentBranch(env, request, linkedAgentId);
    if (!branch) {
      return Response.json({ branch: null, commitHash: null }, { headers: { "Cache-Control": "no-store" } });
    }
    const snapshot = await currentGitSnapshot(env, request, linkedAgentId, branch);
    return Response.json({ branch, commitHash: snapshot.commitHash }, { headers: { "Cache-Control": "no-store" } });
  }
  if (operation === "status" && request.method === "GET") {
    const [snapshot, fileCount] = await Promise.all([
      stockStatusSnapshot(env, request, linkedAgentId),
      listCurrentFiles(env, request, linkedAgentId).then((files) => files.length),
    ]);
    const previewUrl = env.ENVIRONMENT === "production" && env.CONTROL_PLANE_PROFILE === "launch"
      ? launchPreviewProxyUrl(env, linkedAgentId, snapshot.previewUrl, request)
      : snapshot.previewUrl;
    const previewCookie = await launchPreviewCookie(env, linkedAgentId, snapshot.previewUrl);
    return Response.json({
      nativeThink: true,
      runtimeStatus: link.initialization_status,
      connected: true,
      files: fileCount,
      ...(snapshot.nativeTaskLifecycle ? { nativeTaskLifecycle: snapshot.nativeTaskLifecycle } : {}),
      state: {
        shouldBeGenerating: snapshot.shouldBeGenerating,
        generation: { status: snapshot.shouldBeGenerating ? "running" : "idle" },
      },
      previewUrl,
      deploymentUrl: null,
    }, { headers: {
      "Cache-Control": "no-store",
      ...(previewCookie ? { "Set-Cookie": previewCookie } : {}),
    } });
  }
  if (operation === "files" && request.method === "GET") {
    return Response.json(await listCurrentFiles(env, request, linkedAgentId), { headers: { "Cache-Control": "no-store" } });
  }
  if (operation === "files/content" && request.method === "GET") {
    const path = safeProjectPath(new URL(request.url).searchParams.get("path"));
    return Response.json(await readCurrentFile(env, request, linkedAgentId, path), { headers: { "Cache-Control": "no-store" } });
  }
  if (operation === "turns" && request.method === "GET") {
    return Response.json({ turns: await stockHistory(env, request, linkedAgentId) }, { headers: { "Cache-Control": "no-store" } });
  }
  if (operation === "previews" && request.method === "POST") {
    const response = await stockThinkRequest(env, request, `/api/agent/${linkedAgentId}/preview`);
    const data = await responseJson(response);
    const url = allowedPreviewUrl(env, linkedAgentId, data?.previewURL || data?.url);
    if (!url) return Response.json({ message: "The project preview could not be verified." }, { status: 502 });
    const previewUrl = env.ENVIRONMENT === "production" && env.CONTROL_PLANE_PROFILE === "launch"
      ? launchPreviewProxyUrl(env, linkedAgentId, url, request)
      : url;
    if (!previewUrl) return Response.json({ message: "The project preview could not be verified." }, { status: 502 });
    const previewCookie = await launchPreviewCookie(env, linkedAgentId, url);
    return Response.json({ url: previewUrl }, {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
        ...(previewCookie ? { "Set-Cookie": previewCookie } : {}),
      },
    });
  }
  return null;
}

export function previewUrlAllowed(env: Env, agentId: string, value: unknown): boolean {
  return allowedPreviewUrl(env, agentId, value) !== null;
}

export function safeThinkFilePath(value: string | null): string | null {
  try { return safeProjectPath(value); } catch { return null; }
}

export function createNativeTicketRequest(path: string): boolean {
  return allowedStockPath(path, "POST");
}