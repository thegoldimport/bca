import git from "isomorphic-git";
import { createFsFromVolume, Volume } from "memfs";
import { refreshProjectAgent } from "./project-initialization";
import { RuntimeIdentityError } from "./runtime-identity";
import { launchPreviewCookie, launchPreviewProxyUrl } from "./preview-proxy";
import { controlOriginForRequest } from "./control-origin";
import {
  closeNativeConnectionAttempt,
  completeNativeConnectionHandshake,
  failNativeConnectionAttempt,
  setNativeConnectionStage,
  startNativeConnectionAttempt,
  type NativeConnectionStage,
} from "./native-connection-diagnostics";

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
type OwnerCsrfContext = { accessCookie: string; cookieValue: string; token: string };

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

export function ownerCsrfToken(request: Request): string | null {
  const fromHeader = request.headers.get("X-CSRF-Token");
  if (fromHeader && fromHeader.length <= 512 && !/[\r\n]/.test(fromHeader)) return fromHeader;
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1 || part.slice(0, index).trim() !== "csrf-token") continue;
    const rawValue = part.slice(index + 1).trim();
    if (!rawValue || rawValue.length > 8192 || /[\r\n;]/.test(rawValue)) return null;
    let value: string;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      return null;
    }
    try {
      const data = JSON.parse(value);
      if (!data || typeof data !== "object" || Array.isArray(data)
        || typeof data.token !== "string" || !data.token || data.token.length > 4096 || /[\r\n]/.test(data.token)
        || !Number.isFinite(data.timestamp)) return null;
      const age = Date.now() - data.timestamp;
      if (age < 0 || age > 2 * 60 * 60 * 1000) return null;
      return data.token;
    } catch {
      // Match the runtime's legacy plain-string CSRF cookie support, but do
      // not forward malformed JSON-looking values as header tokens.
      if (/^\s*[\[{"]/.test(value) || value.length > 4096 || /[\r\n]/.test(value)) return null;
      return value;
    }
  }
  return null;
}

async function freshOwnerCsrfContext(env: Env, request: Request): Promise<OwnerCsrfContext> {
  const accessCookie = ownerAccessCookie(request);
  let response: Response;
  try {
    response = await stockRuntime(env).fetch(new Request(`${stockRuntimeUrl(env)}/api/auth/csrf-token`, {
      method: "GET",
      headers: { Accept: "application/json", Cookie: accessCookie, "Cache-Control": "no-store" },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    }));
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    throw new RuntimeIdentityError(
      "The owner-authorized runtime is temporarily unavailable.",
      502,
      timeout ? "NATIVE_CSRF_BOOTSTRAP_TIMEOUT" : "NATIVE_CSRF_BOOTSTRAP_FAILED",
    );
  }

  let data: any;
  try {
    data = await responseJson(response);
  } catch (error) {
    const status = error instanceof RuntimeIdentityError && [401, 403].includes(error.status) ? error.status : 502;
    throw new RuntimeIdentityError("The runtime could not authorize a secure request.", status, "NATIVE_CSRF_BOOTSTRAP_REJECTED");
  }
  const setCookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [];
  const setCookie = setCookies.find((value) => /^csrf-token=/i.test(value))
    || response.headers.get("Set-Cookie") || "";
  const cookieValue = /^csrf-token=([^;]+)/i.exec(setCookie)?.[1] || "";
  const token = data?.token;
  if (typeof token !== "string" || !token || token.length > 4096 || /[\r\n]/.test(token)
    || !cookieValue || cookieValue.length > 4096 || /[;\r\n]/.test(cookieValue)
    || /(?:^|;)\s*Domain=/i.test(setCookie)) {
    throw new RuntimeIdentityError("The runtime did not provide a valid secure request token.", 502, "NATIVE_CSRF_BOOTSTRAP_INVALID");
  }
  return { accessCookie, cookieValue, token };
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
  if (/^\/api\/agent\/[a-zA-Z0-9_-]{1,120}\/buildcustom-ai-config\/refresh$/.test(pathname)) return method === "POST";
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
  const origin = request.headers.get("Origin");
  if (origin && origin === controlOriginForRequest(env, request)) headers.set("Origin", origin);
  if (method === "POST") {
    headers.set("Content-Type", "application/json");
    const csrf = await freshOwnerCsrfContext(env, request);
    headers.set("Cookie", `${csrf.accessCookie}; csrf-token=${csrf.cookieValue}`);
    headers.set("X-CSRF-Token", csrf.token);
  }
  try {
    return await stockRuntime(env).fetch(new Request(`${stockRuntimeUrl(env)}${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    }));
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    throw new RuntimeIdentityError(
      "The owner-authorized runtime is temporarily unavailable.",
      502,
      timeout ? "NATIVE_STOCK_REQUEST_TIMEOUT" : "NATIVE_STOCK_REQUEST_FAILED",
    );
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

export async function changedFilesBetweenCommits(
  snapshot: GitSnapshot,
  baselineCommitHash: string | null,
  targetCommitHash: string,
): Promise<Array<{ path: string; change: string; size: number }>> {
  if (!snapshot.commitHash || snapshot.commitHash !== targetCommitHash || !HASH.test(targetCommitHash)) {
    throw new RuntimeIdentityError("The checkpoint no longer matches the current Development revision.", 409);
  }
  if (baselineCommitHash && !HASH.test(baselineCommitHash)) {
    throw new RuntimeIdentityError("The starting Development revision could not be verified.", 409);
  }
  const targetFiles = await git.listFiles({ fs: snapshot.fs, dir: snapshot.dir, ref: targetCommitHash });
  const baselineFiles = baselineCommitHash
    ? await git.listFiles({ fs: snapshot.fs, dir: snapshot.dir, ref: baselineCommitHash })
    : [];
  const targetSet = new Set(targetFiles);
  const baselineSet = new Set(baselineFiles);
  const changed = [...new Set([...baselineFiles, ...targetFiles])]
    .filter((path) => baselineSet.has(path) !== targetSet.has(path)
      || baselineSet.has(path) && targetSet.has(path) && baselineCommitHash !== targetCommitHash)
    .sort();
  const result: Array<{ path: string; change: string; size: number }> = [];
  for (const path of changed) {
    try { safeProjectPath(path); } catch {
      throw new RuntimeIdentityError("A Development checkpoint contains an unsafe file path.", 409);
    }
    let change: string;
    let size = 0;
    if (!baselineSet.has(path)) {
      change = "added";
      const target = await git.readBlob({ fs: snapshot.fs, dir: snapshot.dir, oid: targetCommitHash, filepath: path });
      size = target.blob.byteLength;
    } else if (!targetSet.has(path)) {
      change = "deleted";
    } else {
      const [before, after] = await Promise.all([
        git.readBlob({ fs: snapshot.fs, dir: snapshot.dir, oid: baselineCommitHash!, filepath: path }),
        git.readBlob({ fs: snapshot.fs, dir: snapshot.dir, oid: targetCommitHash, filepath: path }),
      ]);
      if (before.oid === after.oid) continue;
      change = "modified";
      size = after.blob.byteLength;
    }
    result.push({ path, change, size });
    if (result.length > TREE_ENTRY_LIMIT) {
      throw new RuntimeIdentityError("This checkpoint changes too many files to record safely.", 413);
    }
  }
  return result;
}

async function finalizeNativeTurnCheckpoint(
  env: Env,
  request: Request,
  projectId: number,
  agentId: string,
  body: unknown,
): Promise<Response> {
  const input = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown> : {};
  const token = typeof input.turnId === "string" && NATIVE_TURN_TOKEN.test(input.turnId)
    ? input.turnId.toLowerCase() : "";
  const commitHash = typeof input.commitHash === "string" && HASH.test(input.commitHash)
    ? input.commitHash.toLowerCase() : "";
  if (!token || !commitHash) {
    return Response.json({ message: "A verified Agent turn and Development revision are required." }, { status: 400 });
  }

  const rows = await env.DB.prepare(
    "SELECT id,project_id,mode,prompt,response,changed_files,commit_hash,activity,created_at FROM runtime_builder_turns WHERE project_id=? AND mode='native_build' ORDER BY id DESC LIMIT 200",
  ).bind(projectId).all<any>();
  const row = (rows.results || []).find((candidate) => nativeTurnMeta(parseJsonArray(candidate.activity))?.token === token);
  if (!row) return Response.json({ message: "The saved Agent turn was not found." }, { status: 404 });
  const activity = parseJsonArray(row.activity);
  const meta = nativeTurnMeta(activity);
  if (meta?.status === "checkpoint_verified" && row.commit_hash === commitHash) {
    return Response.json({
      checkpointVerified: true,
      commitHash,
      changedFiles: parseJsonArray(row.changed_files),
    }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!meta || meta.status !== "agent_turn_ended") {
    return Response.json({ message: "The Agent turn has not reached a verified checkpoint state." }, { status: 409 });
  }
  if (row.commit_hash && row.commit_hash !== commitHash) {
    return Response.json({ message: "A different checkpoint is already saved for this turn." }, { status: 409 });
  }
  if (meta.baselineCommitHash === commitHash) {
    return Response.json({ message: "This turn did not produce a new Development revision." }, { status: 409 });
  }

  let changedFiles: Array<{ path: string; change: string; size: number }>;
  try {
    const branch = await currentBranch(env, request, agentId);
    if (!branch) return Response.json({ message: "A Development branch could not be verified." }, { status: 409 });
    const snapshot = await currentGitSnapshot(env, request, agentId, branch);
    if (!snapshot.commitHash || snapshot.commitHash !== commitHash) {
      return Response.json({ message: "The Development revision changed before its checkpoint could be saved." }, { status: 409 });
    }
    if (meta.baselineCommitHash) {
      const history = await git.log({ fs: snapshot.fs, dir: snapshot.dir, ref: commitHash, depth: 1000 });
      if (!history.some((entry) => entry.oid === meta.baselineCommitHash)) {
        return Response.json({ message: "The starting revision is no longer verifiable on this Development branch." }, { status: 409 });
      }
    }
    changedFiles = await changedFilesBetweenCommits(snapshot, meta.baselineCommitHash, commitHash);
  } catch (error) {
    const message = error instanceof RuntimeIdentityError
      ? error.message
      : "The Development checkpoint could not be verified.";
    const status = error instanceof RuntimeIdentityError ? error.status : 409;
    return Response.json({ message }, { status });
  }
  const nextMeta: NativeTurnMeta = { ...meta, status: "checkpoint_verified" };
  const cleanActivity = activity.filter((item) => item?.type !== NATIVE_TURN_META_TYPE);
  await env.DB.prepare(
    "UPDATE runtime_builder_turns SET commit_hash=?,changed_files=?,activity=? WHERE id=? AND project_id=? AND mode='native_build'",
  ).bind(commitHash, JSON.stringify(changedFiles), JSON.stringify([nextMeta, ...cleanActivity]), row.id, projectId).run();
  return Response.json({ checkpointVerified: true, commitHash, changedFiles }, {
    headers: { "Cache-Control": "no-store" },
  });
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
  const csrf = await freshOwnerCsrfContext(env, request);
  let response: Response;
  try {
    response = await stockRuntime(env).fetch(new Request(`${stockRuntimeUrl(env)}/api/ws-ticket`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: `${csrf.accessCookie}; csrf-token=${csrf.cookieValue}`,
        "X-CSRF-Token": csrf.token,
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({ resourceType: "agent", resourceId: agentId }),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    }));
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    throw new RuntimeIdentityError(
      "The owner-authorized runtime is temporarily unavailable.",
      502,
      timeout ? "NATIVE_WS_TICKET_REQUEST_TIMEOUT" : "NATIVE_WS_TICKET_REQUEST_FAILED",
    );
  }
  let data: any;
  try {
    data = await responseJson(response);
  } catch (error) {
    const status = error instanceof RuntimeIdentityError && [401, 403].includes(error.status) ? error.status : 502;
    throw new RuntimeIdentityError(
      "The runtime could not issue a project connection ticket.",
      status,
      "NATIVE_WS_TICKET_REJECTED",
    );
  }
  if (typeof data?.ticket !== "string" || !/^tk_[a-f0-9]{32,}$/i.test(data.ticket)) {
    throw new RuntimeIdentityError("The runtime did not provide a valid connection ticket.", 502, "NATIVE_WS_TICKET_INVALID");
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
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    throw new RuntimeIdentityError(
      "The owner-authorized project connection failed.",
      502,
      timeout ? "NATIVE_AGENT_WS_TIMEOUT" : "NATIVE_AGENT_WS_REQUEST_FAILED",
    );
  }
  if (response.status !== 101 || !response.webSocket) {
    throw new RuntimeIdentityError("The owner-authorized project connection was rejected.", 502, "NATIVE_AGENT_WS_REJECTED");
  }
  return response.webSocket;
}

export function allowedNativeClientFrame(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const frame = value as Record<string, unknown>;
  if (frame.type === "set_auto_continue" && typeof frame.enabled === "boolean"
    && typeof frame.taskId === "string" && /^[a-zA-Z0-9_:.-]{1,256}$/.test(frame.taskId)) {
    return { type: frame.type, taskId: frame.taskId, enabled: frame.enabled };
  }
  if (frame.type === "get_conversation_state") return { type: frame.type };
  if (frame.type === "stop_generation") return { type: frame.type };
  if (frame.type === "user_suggestion" && typeof frame.message === "string"
    && frame.message.trim().length > 0 && frame.message.length <= 30_000) {
    const clean: Record<string, unknown> = { type: frame.type, message: frame.message };
    if (frame.buildcustomTurnId !== undefined) {
      if (typeof frame.buildcustomTurnId !== "string" || !/^[a-f0-9-]{36}$/i.test(frame.buildcustomTurnId)
        || (frame.buildcustomBaselineCommitHash !== null
          && (typeof frame.buildcustomBaselineCommitHash !== "string" || !HASH.test(frame.buildcustomBaselineCommitHash)))) return null;
      clean.buildcustomTurnId = frame.buildcustomTurnId.toLowerCase();
      clean.buildcustomBaselineCommitHash = frame.buildcustomBaselineCommitHash;
    }
    if (frame.continuationApproval !== undefined) {
      const approval = frame.continuationApproval as Record<string, unknown> | null;
      if (!approval || typeof approval !== "object" || Array.isArray(approval)
        || typeof approval.taskId !== "string" || typeof approval.operationId !== "string"
        || !/^[a-zA-Z0-9_:.-]{1,256}$/.test(approval.taskId)
        || !/^[a-zA-Z0-9_:.-]{1,256}$/.test(approval.operationId)
        || (Array.isArray(frame.images) && frame.images.length > 0)
        || !/^(yes|continue|keep going|go ahead|finish it|keep working)[.!?]*$/i.test(frame.message.trim())) return null;
      clean.continuationApproval = { taskId: approval.taskId, operationId: approval.operationId };
    }
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

const NATIVE_TURN_META_TYPE = "__buildcustom_native_turn";
const NATIVE_TURN_ACTIVITY_LIMIT = 300;
const NATIVE_TURN_TOKEN = /^[a-f0-9-]{36}$/i;
const NATIVE_TURN_STATUSES = new Set([
  "running", "reply_saved", "needs_input", "agent_turn_ended", "interrupted", "error", "stopped", "checkpoint_verified",
]);

type NativeTurnMeta = {
  type: typeof NATIVE_TURN_META_TYPE;
  token: string;
  status: string;
  baselineCommitHash: string | null;
};

type NativeTurnActivity = {
  type: string;
  label: string;
  path?: string;
  status?: string;
  createdAt: string;
};

function nativeTurnMeta(activity: unknown): NativeTurnMeta | null {
  if (!Array.isArray(activity)) return null;
  const value = activity.find((item) => item?.type === NATIVE_TURN_META_TYPE) as Record<string, unknown> | undefined;
  if (!value || typeof value.token !== "string" || !NATIVE_TURN_TOKEN.test(value.token)
    || typeof value.status !== "string" || !NATIVE_TURN_STATUSES.has(value.status)
    || (value.baselineCommitHash !== null
      && (typeof value.baselineCommitHash !== "string" || !HASH.test(value.baselineCommitHash)))) return null;
  return {
    type: NATIVE_TURN_META_TYPE,
    token: value.token.toLowerCase(),
    status: value.status,
    baselineCommitHash: value.baselineCommitHash as string | null,
  };
}

export function safeNativeTurnEvent(frame: Record<string, any>): {
  activity?: NativeTurnActivity;
  status?: string;
} | null {
  const type = typeof frame.type === "string" ? frame.type : "";
  const now = new Date().toISOString();
  const pathValue = typeof frame.path === "string" ? frame.path
    : typeof frame.file?.filePath === "string" ? frame.file.filePath
      : typeof frame.file?.path === "string" ? frame.file.path
        : typeof frame.filePath === "string" ? frame.filePath : "";
  let path: string | undefined;
  if (pathValue) {
    const normalizedPath = pathValue.startsWith("/") ? pathValue.slice(1) : pathValue;
    try { path = safeProjectPath(normalizedPath); } catch { path = undefined; }
  }
  const event = (label: string, status = "info", eventType = "progress"): NativeTurnActivity => ({
    type: eventType,
    label: label.slice(0, 300),
    ...(path ? { path } : {}),
    status,
    createdAt: now,
  });

  if (type === "generation_started") return { activity: event("Agent started this turn", "info"), status: "running" };
  if (type === "generation_complete") {
    return {
      activity: event("Agent turn ended · application completion is not verified", "success"),
      status: "agent_turn_ended",
    };
  }
  if (type === "generation_stopped" || type === "generation_cancelled") {
    return { activity: event("Agent turn stopped", "error"), status: "stopped" };
  }
  if (type === "error") return { activity: event("Agent reported an error", "error"), status: "error" };
  if (type === "user_input_required" || type === "needs_input") {
    return { activity: event("Agent needs your input"), status: "needs_input" };
  }
  const phases: Record<string, string> = {
    phase_generating: "Generating project files",
    phase_implementing: "Applying project changes",
    phase_validating: "Validating project changes",
    phase_generated: "Project file generation phase ended",
    phase_implemented: "Project implementation phase ended",
    phase_validated: "Project validation phase ended",
    deployment_started: "Preparing the Development preview",
    deployment_completed: "Development preview deployment reported",
    deployment_failed: "Development preview deployment failed",
  };
  if (phases[type]) {
    const failed = type === "deployment_failed";
    const terminal = type.endsWith("_generated") || type.endsWith("_implemented")
      || type.endsWith("_validated") || type === "deployment_completed" || failed;
    return {
      activity: event(phases[type], failed ? "error" : terminal ? "success" : "info"),
    };
  }
  if (["file_generating", "file_generated", "file_regenerated", "file_chunk_generated", "file_deleted"].includes(type) && path) {
    const label = type === "file_generating" ? `Writing ${path}`
      : type === "file_deleted" ? `Agent reported removing ${path}`
        : type === "file_generated" ? `Agent reported generating ${path}`
          : `Agent reported updating ${path}`;
    return { activity: event(label, type === "file_generating" ? "info" : "success", "tool") };
  }
  const tool = frame.tool && typeof frame.tool === "object" ? frame.tool : null;
  if (type === "conversation_response" && tool && typeof tool.name === "string"
    && /^[A-Za-z0-9_-]{1,80}$/.test(tool.name)) {
    const toolPathValue = typeof tool.args?.path === "string" ? tool.args.path : "";
    let toolPath: string | undefined;
    if (toolPathValue) {
      const normalizedPath = toolPathValue.startsWith("/") ? toolPathValue.slice(1) : toolPathValue;
      try { toolPath = safeProjectPath(normalizedPath); } catch { /* omit unsafe path */ }
    }
    const status = typeof tool.status === "string" ? tool.status.toLowerCase() : "";
    const label = toolPath
      ? `${["success", "complete", "completed"].includes(status) ? "Updated" : "Working on"} ${toolPath}`
      : tool.name.replaceAll("_", " ");
    return { activity: { ...event(label, ["success", "complete", "completed"].includes(status) ? "success" : "info", "tool"),
      ...(toolPath ? { path: toolPath } : {}) } };
  }
  if (type === "conversation_response" && frame.isStreaming === false
    && typeof frame.message === "string" && frame.message.trim().length > 0) {
    return { status: "reply_saved" };
  }
  return null;
}

function parseJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function updateNativeTurn(
  db: D1Database,
  projectId: number,
  turnId: number,
  response: string,
  activity: NativeTurnActivity[],
  meta: NativeTurnMeta,
): Promise<void> {
  const storedActivity = [meta, ...activity.slice(-NATIVE_TURN_ACTIVITY_LIMIT)];
  await db.prepare(
    "UPDATE runtime_builder_turns SET response=?,activity=? WHERE id=? AND project_id=? AND mode='native_build'",
  ).bind(response, JSON.stringify(storedActivity), turnId, projectId).run();
}

function restoredNativeTurn(
  row: any,
): {
  id: number;
  prompt: string;
  response: string;
  changedFiles: Array<{ path: string; change: string; size: number }>;
  activity: NativeTurnActivity[];
  commitHash: string | null;
  createdAt: string;
  status: string;
} | null {
  if (!Number.isSafeInteger(row?.id) || typeof row.prompt !== "string" || typeof row.response !== "string") return null;
  const rawActivity = parseJsonArray(row.activity);
  const meta = nativeTurnMeta(rawActivity);
  if (!meta) return null;
  return {
    id: row.id,
    prompt: row.prompt,
    response: row.response,
    changedFiles: parseJsonArray(row.changed_files ?? row.changedFiles),
    activity: rawActivity.filter((item) => item?.type !== NATIVE_TURN_META_TYPE),
    commitHash: typeof (row.commit_hash ?? row.commitHash) === "string" ? (row.commit_hash ?? row.commitHash) : null,
    createdAt: String(row.created_at ?? row.createdAt ?? ""),
    status: meta.status,
  };
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

function relay(
  server: WebSocket,
  upstream: WebSocket,
  options?: {
    db: D1Database;
    projectId: number;
    executionCtx?: ExecutionContext;
  },
): void {
  server.accept();
  upstream.accept();
  let activeTurn: {
    id: number;
    response: string;
    activity: NativeTurnActivity[];
    meta: NativeTurnMeta;
    persistQueue: Promise<void>;
    lastPersistAt: number;
  } | null = null;
  let suggestionReceived = false;
  let persistenceWarningLogged = false;
  const queueTurnSave = (wait = false) => {
    if (!activeTurn || !options) return Promise.resolve();
    const turn = activeTurn;
    const task = turn.persistQueue.then(() => updateNativeTurn(
      options.db, options.projectId, turn.id, turn.response, turn.activity, turn.meta,
    ));
    turn.persistQueue = task.catch(() => {
      if (persistenceWarningLogged) return;
      persistenceWarningLogged = true;
      console.warn("native_turn_activity_write_failed", { projectId: options.projectId, turnId: turn.id });
    });
    options.executionCtx?.waitUntil(turn.persistQueue);
    return wait ? turn.persistQueue : Promise.resolve();
  };
  const setTurnStatus = (status: string) => {
    if (!activeTurn || !NATIVE_TURN_STATUSES.has(status)) return;
    const current = activeTurn.meta.status;
    if (current === "checkpoint_verified") return;
    if (["agent_turn_ended", "needs_input", "interrupted", "error", "stopped"].includes(current)
      && status !== "checkpoint_verified") return;
    if (current !== "running" && (status === "running" || status === "reply_saved")) return;
    activeTurn.meta = { ...activeTurn.meta, status };
  };
  const closeBoth = (code = 1000, reason = "Connection closed") => {
    if (activeTurn?.meta.status === "running") setTurnStatus("interrupted");
    void queueTurnSave(true);
    try { server.close(code, reason); } catch { /* already closed */ }
    try { upstream.close(code, reason); } catch { /* already closed */ }
  };
  server.addEventListener("message", async (event) => {
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
    if (clean.type === "user_suggestion") {
      if (suggestionReceived) {
        try { server.send(JSON.stringify({ type: "error", error: "Send one Agent request per connection." })); } catch { /* closed */ }
        return;
      }
      suggestionReceived = true;
      const token = typeof clean.buildcustomTurnId === "string" ? clean.buildcustomTurnId : null;
      const baselineCommitHash = clean.buildcustomBaselineCommitHash === null
        || typeof clean.buildcustomBaselineCommitHash === "string" ? clean.buildcustomBaselineCommitHash : undefined;
      const upstreamFrame = { ...clean };
      delete upstreamFrame.buildcustomTurnId;
      delete upstreamFrame.buildcustomBaselineCommitHash;
      if (token && baselineCommitHash !== undefined && options) {
        const meta: NativeTurnMeta = {
          type: NATIVE_TURN_META_TYPE,
          token,
          status: "running",
          baselineCommitHash,
        };
        try {
          const inserted = await options.db.prepare(
            "INSERT INTO runtime_builder_turns(project_id,mode,prompt,response,changed_files,commit_hash,activity) VALUES(?,'native_build',?,'','[]',NULL,?)",
          ).bind(options.projectId, String(clean.message), JSON.stringify([meta])).run();
          const id = Number(inserted.meta?.last_row_id);
          if (!Number.isSafeInteger(id) || id < 1) throw new Error("Native turn insert did not return its row ID.");
          activeTurn = {
            id,
            response: "",
            activity: [],
            meta,
            persistQueue: Promise.resolve(),
            lastPersistAt: Date.now(),
          };
        } catch {
          try { server.send(JSON.stringify({ type: "error", error: "The conversation activity could not be saved. No request was sent." })); } catch { /* closed */ }
          return;
        }
      }
      if (server.readyState !== 1) {
        if (activeTurn) {
          setTurnStatus("interrupted");
          await queueTurnSave(true);
        }
        return;
      }
      try {
        upstream.send(JSON.stringify(upstreamFrame));
      } catch {
        if (activeTurn) {
          setTurnStatus("interrupted");
          await queueTurnSave(true);
        }
        closeBoth(1011, "Project connection failed.");
      }
      return;
    }
    try { upstream.send(JSON.stringify(clean)); } catch { closeBoth(1011, "Project connection failed."); }
  });
  upstream.addEventListener("message", async (event) => {
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
    if (activeTurn) {
      try {
        const frame = JSON.parse(safeFrame) as Record<string, any>;
        let shouldPersist = false;
        if (frame.type === "conversation_response" && typeof frame.message === "string"
          && frame.message.trim().length > 0) {
          activeTurn.response = frame.isDelta === true
            ? `${activeTurn.response}${frame.message}`.slice(-100_000)
            : frame.message.slice(-100_000);
          shouldPersist = frame.isStreaming === false || Date.now() - activeTurn.lastPersistAt >= 2_000;
        }
        const observation = safeNativeTurnEvent(frame);
        if (observation?.activity) {
          const previous = activeTurn.activity[activeTurn.activity.length - 1];
          const next = observation.activity;
          if (!previous || previous.label !== next.label || previous.status !== next.status || previous.path !== next.path) {
            activeTurn.activity = [...activeTurn.activity, next].slice(-NATIVE_TURN_ACTIVITY_LIMIT);
            shouldPersist = true;
          }
        }
        if (observation?.status && activeTurn.meta.status !== observation.status) {
          setTurnStatus(observation.status);
          shouldPersist = true;
        }
        if (shouldPersist) {
          activeTurn.lastPersistAt = Date.now();
          await queueTurnSave(frame.type === "generation_complete"
            || frame.type === "generation_stopped" || frame.type === "generation_cancelled"
            || frame.type === "error" || frame.type === "conversation_response" && frame.isStreaming === false);
        }
      } catch {
        // Persisted activity is best-effort; validated runtime frames still flow to the editor.
      }
    }
    try { server.send(safeFrame); } catch { closeBoth(1011, "Project connection failed."); }
  });
  server.addEventListener("close", (event) => closeBoth(event.code, event.reason));
  upstream.addEventListener("close", (event) => {
    closeBoth(event.code, event.reason);
  });
  server.addEventListener("error", () => closeBoth(1011, "Project connection failed."));
  upstream.addEventListener("error", () => closeBoth(1011, "Project connection failed."));
}

async function bridgeWebSocket(
  env: Env,
  request: Request,
  project: Project,
  origin: string,
  executionCtx?: ExecutionContext,
): Promise<Response> {
  let attemptId: string;
  let correlationId: string;
  try {
    ({ attemptId, correlationId } = await startNativeConnectionAttempt(env.DB, request, project.id, project.user_id));
  } catch {
    throw new RuntimeIdentityError("Project connection diagnostics are temporarily unavailable.", 503, "NATIVE_CONNECTION_DIAGNOSTICS_WRITE_FAILED");
  }

  let stage: NativeConnectionStage = "request_received";
  const markStage = async (next: NativeConnectionStage, completed = false) => {
    stage = next;
    try {
      await setNativeConnectionStage(env.DB, attemptId, next, completed);
    } catch {
      throw new RuntimeIdentityError("Project connection diagnostics are temporarily unavailable.", 503, "NATIVE_CONNECTION_DIAGNOSTICS_UPDATE_FAILED");
    }
  };
  const markFailure = async (errorCode: string, status?: number, timeoutReason?: "runtime_timeout" | "upstream_timeout") => {
    try {
      await failNativeConnectionAttempt(env.DB, attemptId, { stage, errorCode, status, timeoutReason });
    } catch {
      console.warn("native_connection_diagnostic_write_failed", {
        code: "NATIVE_CONNECTION_DIAGNOSTICS_UPDATE_FAILED",
        correlationId,
      });
    }
  };

  try {
    await markStage("upgrade_validation");
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      await markFailure("NATIVE_WS_UPGRADE_REQUIRED", 426);
      return new Response("WebSocket upgrade required.", { status: 426 });
    }
    await markStage("origin_validation");
    if (request.headers.get("Origin") !== origin) {
      console.warn("native_connection_diagnostic", { code: "NATIVE_CONTROL_ORIGIN_REJECTED", status: 403 });
      await markFailure("NATIVE_CONTROL_ORIGIN_REJECTED", 403);
      return Response.json({ message: "Project connection origin rejected.", code: "NATIVE_CONTROL_ORIGIN_REJECTED" }, { status: 403 });
    }
    if ([...new URL(request.url).searchParams.keys()].length) {
      await markFailure("NATIVE_WS_QUERY_REJECTED", 400);
      return Response.json({ message: "Project connection parameters are not accepted." }, { status: 400 });
    }
    await markStage("project_link_check");
    let link;
    try {
      link = await refreshProjectAgent(env, request, project);
    } catch (error) {
      const status = error instanceof RuntimeIdentityError ? error.status : 502;
      const code = status === 403 ? "NATIVE_RUNTIME_OWNER_REJECTED" : "NATIVE_PROJECT_LINK_CHECK_FAILED";
      await markFailure(code, status);
      throw new RuntimeIdentityError("Project ownership could not be verified.", status, code);
    }
    await markStage("project_link_check", true);
    const agentId = link?.agent_id;
    if (!agentId || !AGENT_ID.test(agentId) || link.initialization_status !== "ready") {
      await markFailure("NATIVE_PROJECT_LINK_NOT_READY", 409);
      return Response.json({ message: "This project is not ready for editing.", code: "NATIVE_PROJECT_LINK_NOT_READY" }, { status: 409 });
    }
    const aiSettings = await env.DB.prepare(
      "SELECT mode FROM user_ai_credentials WHERE user_id=?",
    ).bind(project.user_id).first<{ mode: string }>();
    if (aiSettings) {
      await markStage("ai_settings_refresh");
      const configResponse = await stockThinkRequest(
        env,
        request,
        `/api/agent/${agentId}/buildcustom-ai-config/refresh`,
        { method: "POST", body: {} },
      );
      if (!configResponse.ok) {
        const status = configResponse.status === 401 || configResponse.status === 403 ? configResponse.status : 503;
        const code = configResponse.status === 401 || configResponse.status === 403
          ? "NATIVE_AI_CONFIG_REFRESH_REJECTED" : "NATIVE_AI_CONFIG_REFRESH_FAILED";
        await markFailure(code, status);
        throw new RuntimeIdentityError("The project's AI settings could not be applied.", status, code);
      }
      await markStage("ai_settings_refresh", true);
    }
    await markStage("runtime_websocket");
    const upstream = await openStockAgentWebSocket(env, request, agentId);
    try {
      await completeNativeConnectionHandshake(env.DB, attemptId);
    } catch {
      try { upstream.close(1011, "Connection diagnostics unavailable"); } catch { /* already closed */ }
      throw new RuntimeIdentityError("Project connection diagnostics are temporarily unavailable.", 503, "NATIVE_CONNECTION_DIAGNOSTICS_UPDATE_FAILED");
    }
    const pair = new WebSocketPair() as SocketPair;
    let disconnectRecorded = false;
    const recordDisconnect = (event: CloseEvent) => {
      if (disconnectRecorded) return;
      disconnectRecorded = true;
      const task = closeNativeConnectionAttempt(env.DB, attemptId, event.code === 1000)
        .catch(() => console.warn("native_connection_diagnostic_write_failed", {
          code: "NATIVE_CONNECTION_DIAGNOSTICS_UPDATE_FAILED",
          correlationId,
        }));
      if (executionCtx) executionCtx.waitUntil(task);
      else void task;
    };
    pair[1].addEventListener("close", recordDisconnect);
    upstream.addEventListener("close", recordDisconnect);
    relay(pair[1], upstream, { db: env.DB, projectId: project.id, executionCtx });
    return new Response(null, { status: 101, webSocket: pair[0], headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof RuntimeIdentityError) || error.code !== "NATIVE_AI_CONFIG_REFRESH_REJECTED") {
      const code = error instanceof RuntimeIdentityError ? error.code || "NATIVE_CONNECTION_FAILED" : "NATIVE_CONNECTION_FAILED";
      const status = error instanceof RuntimeIdentityError ? error.status : 502;
      const timeoutReason = code.includes("TIMEOUT")
        ? code.includes("CSRF") || code.includes("STOCK_REQUEST") ? "runtime_timeout" : "upstream_timeout"
        : undefined;
      await markFailure(code, status, timeoutReason);
    }
    throw error;
  }
}

export function shapeThinkHistory(messages: unknown, persistedRows: any[] = []): Array<{
  id: number;
  mode: "build";
  prompt: string;
  response: string;
  changedFiles: Array<{ path: string; change: string; size: number }>;
  activity: NativeTurnActivity[];
  commitHash: string | null;
  createdAt: string;
  status?: string;
}> {
  if (!Array.isArray(messages)) throw new RuntimeIdentityError("The project conversation returned an invalid result.", 502);
  const turns: Array<{
    id: number;
    mode: "build";
    prompt: string;
    response: string;
    changedFiles: Array<{ path: string; change: string; size: number }>;
    activity: NativeTurnActivity[];
    commitHash: string | null;
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
  const savedQueues = new Map<string, any[]>();
  for (const row of persistedRows) {
    if (row?.mode !== "native_build" || typeof row.prompt !== "string") continue;
    const restored = restoredNativeTurn(row);
    if (!restored) continue;
    const queue = savedQueues.get(row.prompt) || [];
    queue.push({ row, restored });
    savedQueues.set(row.prompt, queue);
  }
  for (const queue of savedQueues.values()) queue.sort((a, b) => Number(a.row.id) - Number(b.row.id));
  const usedIds = new Set<number>();
  const merged = turns.map((turn, index) => {
    const saved = savedQueues.get(turn.prompt)?.shift();
    if (!saved) return { ...turn, id: persistedRows.length ? -(index + 1) : index + 1 };
    usedIds.add(saved.restored.id);
    return {
      ...turn,
      id: saved.restored.id,
      response: turn.response || saved.restored.response,
      changedFiles: saved.restored.changedFiles,
      activity: saved.restored.activity,
      commitHash: saved.restored.commitHash,
      createdAt: saved.restored.createdAt,
      status: saved.restored.status,
    };
  });
  // If the stock transcript temporarily omits a turn, surface only the
  // independently persisted prompt/reply that the bridge actually observed.
  for (const row of persistedRows) {
    if (row?.mode !== "native_build") continue;
    const saved = restoredNativeTurn(row);
    if (!saved || usedIds.has(saved.id) || !saved.prompt.trim()) continue;
    merged.push({
      id: saved.id,
      mode: "build",
      prompt: saved.prompt,
      response: saved.response,
      changedFiles: saved.changedFiles,
      activity: saved.activity,
      commitHash: saved.commitHash,
      createdAt: saved.createdAt,
      status: saved.status,
    });
  }
  return merged;
}

const NATIVE_TASK_STATUSES = new Set(["RUNNING", "COMPLETE", "BLOCKED", "USER_INPUT_REQUIRED", "INCOMPLETE_RESOURCE_LIMIT"]);
const NATIVE_RESOURCE_REASONS = new Set([
  "credit_limit", "model_call_limit", "tool_call_limit", "elapsed_time_limit",
  "available_credits_limit", "continuation_budget_exhausted",
]);

export function projectOwnerNativeTaskLifecycle(value: unknown):
  { status: string; updatedAt: number; reason?: string; customerStatus?: string; taskId?: string; operationId?: string; accounting?: Record<string, number> } | undefined {
  if (value === undefined) return undefined; // Older runtime versions remain compatible.
  const lifecycle = value as Record<string, unknown> | null;
  if (!lifecycle || typeof lifecycle.status !== "string" || !NATIVE_TASK_STATUSES.has(lifecycle.status)
    || typeof lifecycle.updatedAt !== "number" || !Number.isFinite(lifecycle.updatedAt)) {
    throw new RuntimeIdentityError("The native task status was incomplete.", 502);
  }
  const operationBoundaryReasons = new Set([
    "credit_limit", "model_call_limit", "tool_call_limit", "elapsed_time_limit", "continuation_budget_exhausted",
  ]);
  // Derive from supported lifecycle facts, never trust a contradictory label.
  const customerStatus = lifecycle.status === "COMPLETE" ? lifecycle.approvalReady === false ? "WORKING" : "BUILD_COMPLETE"
    : lifecycle.status === "USER_INPUT_REQUIRED" ? "NEEDS_INPUT"
    : lifecycle.status === "RUNNING" ? "WORKING"
    : lifecycle.status === "INCOMPLETE_RESOURCE_LIMIT" && typeof lifecycle.reason === "string"
      && operationBoundaryReasons.has(lifecycle.reason)
      ? lifecycle.approvalReady === false ? "WORKING" : "CONTINUE_AVAILABLE" : "STOPPED";
  const taskIdentity = typeof lifecycle.taskId === "string" && /^[a-zA-Z0-9_:.-]{1,256}$/.test(lifecycle.taskId)
    && typeof lifecycle.operationId === "string" && /^[a-zA-Z0-9_:.-]{1,256}$/.test(lifecycle.operationId)
    ? { taskId: lifecycle.taskId, operationId: lifecycle.operationId } : {};
  let accounting: Record<string, number> | undefined;
  if (lifecycle.accounting && typeof lifecycle.accounting === "object" && !Array.isArray(lifecycle.accounting)) {
    const candidate = lifecycle.accounting as Record<string, unknown>;
    const names = ["startedAt", "creditsUsed", "turnsUsed", "continuationsUsed", "modelCalls", "toolCalls"];
    if (names.every(name => typeof candidate[name] === "number" && Number.isFinite(candidate[name]) && Number(candidate[name]) >= 0)) {
      accounting = Object.fromEntries(names.map(name => [name, Number(candidate[name])]));
    }
  }
  return {
    status: lifecycle.status,
    updatedAt: lifecycle.updatedAt,
    ...taskIdentity,
    customerStatus,
    ...(lifecycle.autoContinue && typeof lifecycle.autoContinue === "object"
      && !Array.isArray(lifecycle.autoContinue)
      && typeof (lifecycle.autoContinue as any).enabled === "boolean"
      && (lifecycle.autoContinue as any).taskId === taskIdentity.taskId
      && Number.isSafeInteger((lifecycle.autoContinue as any).version)
      && Number.isFinite((lifecycle.autoContinue as any).changedAt)
      ? { autoContinue: {
        taskId: taskIdentity.taskId,
        enabled: (lifecycle.autoContinue as any).enabled,
        version: (lifecycle.autoContinue as any).version,
        changedAt: (lifecycle.autoContinue as any).changedAt,
      } } : {}),
    ...(accounting ? { accounting } : {}),
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

async function stockHistory(env: Env, request: Request, projectId: number, agentId: string): Promise<any[]> {
  const savedRows = await env.DB.prepare(
    "SELECT id,project_id,mode,prompt,response,changed_files,commit_hash,activity,created_at FROM runtime_builder_turns WHERE project_id=? AND mode='native_build' ORDER BY id ASC",
  ).bind(projectId).all<any>();
  const savedFallback = () => shapeThinkHistory([], savedRows.results || []);
  let socket: WebSocket;
  try {
    socket = await openStockAgentWebSocket(env, request, agentId);
  } catch (error) {
    if ((savedRows.results || []).length) return savedFallback();
    throw error;
  }
  socket.accept();
  return new Promise<any[]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { socket.close(1000, "History read complete."); } catch { /* closed */ }
      reject(new RuntimeIdentityError("The project conversation could not be loaded.", 502));
    }, 15_000);
    const finish = (error: Error | null, value: any[] = []) => {
      clearTimeout(timeout);
      try { socket.close(1000, "History read complete."); } catch { /* closed */ }
      if (error && (savedRows.results || []).length) resolve(savedFallback());
      else if (error) reject(error);
      else resolve(value);
    };
    socket.addEventListener("message", (event) => {
      const text = socketText(event.data);
      if (!text || new TextEncoder().encode(text).byteLength > SERVER_FRAME_LIMIT) return finish(new RuntimeIdentityError("The project conversation could not be loaded.", 502));
      try {
        const message = JSON.parse(text);
        if (message?.type !== "conversation_state") return;
        const messages = message.state?.fullHistory;
        finish(null, shapeThinkHistory(messages, savedRows.results || []));
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
  executionCtx?: ExecutionContext,
  input?: unknown,
): Promise<Response | null> {
  if (project.runtime_provider !== "stock-think" && !project.creation_key) return null;
  const origin = controlOriginForRequest(env, request);
  const agentId = project.agent_id || "";
  if (operation === "ws" && request.method === "GET") return bridgeWebSocket(env, request, project, origin, executionCtx);

  if (operation === "previews" && request.method === "POST" && !request.headers.get("X-CSRF-Token")) {
    return Response.json({ message: "A secure project request is required." }, { status: 403 });
  }
  const supportedRead = request.method === "GET"
    && ["status", "revision", "files", "files/content", "turns"].includes(operation);
  const supportedTurnCheckpoint = operation === "turns/checkpoint" && request.method === "POST";
  if (!supportedRead && !supportedTurnCheckpoint && !(operation === "previews" && request.method === "POST")) return null;
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
  if (supportedTurnCheckpoint) {
    return finalizeNativeTurnCheckpoint(env, request, project.id, linkedAgentId, input);
  }
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
    return Response.json({ turns: await stockHistory(env, request, project.id, linkedAgentId) }, { headers: { "Cache-Control": "no-store" } });
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