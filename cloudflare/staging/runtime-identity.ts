import { expiredSessionCookie, hasValidCsrfToken, parseCookie, revokeSession, type SessionUser } from "./auth";

const LAB_AUTH_URL = "https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev";
const LAUNCH_AUTH_URL = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const AUTH_COOKIE = "accessToken";
const CSRF_COOKIE = "csrf-token";
const clearCookie = (name: string) => `${name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;

type RuntimeAuthEnv = {
  DB: D1Database;
  AUTH_RUNTIME?: Fetcher;
  AUTH_RUNTIME_URL?: string;
  ENVIRONMENT?: string;
  CONTROL_PLANE_PROFILE?: string;
};

type RuntimeIdentity = {
  id: string;
  email: string;
  displayName?: string;
  sessionId: string;
};

export class RuntimeIdentityError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

function authRuntime(env: RuntimeAuthEnv): Fetcher {
  const expectedUrl = env.ENVIRONMENT === "production" && env.CONTROL_PLANE_PROFILE === "launch"
    ? LAUNCH_AUTH_URL : LAB_AUTH_URL;
  if (env.AUTH_RUNTIME_URL !== expectedUrl || !env.AUTH_RUNTIME) {
    throw new RuntimeIdentityError("Staging sign-in is not configured.", 503);
  }
  return env.AUTH_RUNTIME;
}

function cookies(request: Request): string {
  return [AUTH_COOKIE, CSRF_COOKIE]
    .map((name) => {
      const value = parseCookie(request.headers.get("Cookie"), name);
      return value ? `${name}=${value}` : null;
    })
    .filter(Boolean).join("; ");
}

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() || [];
  // Never forward an unexpected cookie or a Domain attribute from the runtime.
  return values.filter((value) => /^(accessToken|csrf-token)=/i.test(value) && !/(?:^|;)\s*Domain=/i.test(value));
}

async function runtimeRequest(env: RuntimeAuthEnv, request: Request, path: string, options: {
  method?: string;
  body?: Record<string, unknown>;
  cookie?: string;
  sessionId?: string;
  timeoutMs?: number;
} = {}): Promise<Response> {
  const headers = new Headers({ Accept: "application/json" });
  const cookie = options.cookie ?? cookies(request);
  headers.set("Cookie", options.sessionId ? `${cookie}; sessionId=${encodeURIComponent(options.sessionId)}` : cookie);
  const csrf = request.headers.get("X-CSRF-Token");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  if (options.body) headers.set("Content-Type", "application/json");
  try {
    return await authRuntime(env).fetch(new Request(`${env.AUTH_RUNTIME_URL}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    }));
  } catch {
    throw new RuntimeIdentityError("BuildCustom sign-in is temporarily unavailable.");
  }
}

// These are the only stock agent interfaces the staging product bridge uses.
// The browser's Authorization header and any browser-provided owner ID are never forwarded.
export function stockAgentRequest(
  env: RuntimeAuthEnv, request: Request, path: string,
  options: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {},
): Promise<Response> {
  const method = options.method || "GET";
  if (!((path === "/api/agent" && method === "POST")
    || (path === "/api/apps" && method === "GET")
    || (/^\/api\/agent\/[a-zA-Z0-9_-]+\/connect$/.test(path) && method === "GET"))) {
    throw new RuntimeIdentityError("Unsupported project setup request.", 400);
  }
  if (method === "POST" && !request.headers.get("X-CSRF-Token")) {
    throw new RuntimeIdentityError("A secure project request is required.", 403);
  }
  return runtimeRequest(env, request, path, { ...options, timeoutMs: 45_000 });
}

async function verifiedIdentity(env: RuntimeAuthEnv, request: Request, cookie?: string): Promise<RuntimeIdentity | null> {
  if (!cookie && !parseCookie(request.headers.get("Cookie"), AUTH_COOKIE)) return null;
  const response = await runtimeRequest(env, request, "/api/auth/check", { cookie });
  if (!response.ok) throw new RuntimeIdentityError("Could not verify your session.");
  const result = await response.json().catch(() => null) as any;
  if (result?.success !== true || typeof result?.data?.authenticated !== "boolean") {
    throw new RuntimeIdentityError("Could not verify your session.");
  }
  if (!result.data.authenticated) return null;
  const user = result.data.user;
  if (typeof user?.id !== "string" || !user.id || typeof user?.email !== "string"
    || !user.email || typeof result.data.sessionId !== "string" || !result.data.sessionId) {
    throw new RuntimeIdentityError("Could not verify your session.");
  }
  return { id: user.id, email: user.email.toLowerCase(), displayName: user.displayName, sessionId: result.data.sessionId };
}

async function productUser(env: RuntimeAuthEnv, identity: RuntimeIdentity): Promise<SessionUser> {
  const name = typeof identity.displayName === "string" && identity.displayName.trim()
    ? identity.displayName.trim().slice(0, 120) : identity.email.split("@")[0].slice(0, 120);
  try {
    // username remains a unique internal key; display_name is customer-facing.
    // No credential or browser-provided owner ID is stored here.
    await env.DB.prepare(
      "INSERT INTO users(id,username,email,display_name) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name",
    ).bind(identity.id, identity.id, identity.email, name).run();
  } catch {
    throw new RuntimeIdentityError("This account conflicts with an existing staging account.", 409);
  }
  const user = await env.DB.prepare(
    "SELECT id,display_name AS username,email,role,plan,created_at FROM users WHERE id=?",
  ).bind(identity.id).first<SessionUser>();
  if (!user) throw new RuntimeIdentityError("Could not load your BuildCustom account.");
  return user;
}

export async function resolveRuntimeProductUser(env: RuntimeAuthEnv, request: Request): Promise<SessionUser | null> {
  const identity = await verifiedIdentity(env, request);
  return identity ? productUser(env, identity) : null;
}

function responseCookies(response: Response): Headers {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const cookie of setCookies(response)) headers.append("Set-Cookie", cookie);
  return headers;
}

export async function handleStagingCustomerAuth(
  env: RuntimeAuthEnv, request: Request, pathname: string, input: Record<string, unknown>,
): Promise<Response | null> {
  if (pathname === "/api/auth/csrf-token" && request.method === "GET") {
    const response = await runtimeRequest(env, request, pathname);
    if (!response.ok) throw new RuntimeIdentityError("Could not start sign-in.");
    const result = await response.json().catch(() => null) as any;
    if (result?.success !== true || typeof result?.data?.token !== "string") {
      throw new RuntimeIdentityError("Could not start sign-in.");
    }
    return Response.json({ token: result.data.token }, { headers: responseCookies(response) });
  }

  if ((pathname === "/api/auth/register" || pathname === "/api/auth/login") && request.method === "POST") {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!email || !password || (pathname.endsWith("register") && !name)) {
      return Response.json({ message: "Enter your name, email, and password." }, { status: 400 });
    }
    const response = await runtimeRequest(env, request, pathname, {
      method: "POST",
      body: pathname.endsWith("register") ? { email, password, name } : { email, password },
    });
    if (!response.ok) {
      const message = pathname.endsWith("register") ? "Could not create your account. Check your details." : "Invalid email or password.";
      return Response.json({ message }, { status: [400, 401, 403, 409, 429].includes(response.status) ? response.status : 502 });
    }
    const issuedCookies = setCookies(response);
    const accessCookie = issuedCookies.find((value) => value.startsWith(`${AUTH_COOKIE}=`));
    if (!accessCookie) throw new RuntimeIdentityError("Could not establish your session.");
    const cookie = issuedCookies.map((value) => value.split(";")[0]).join("; ");
    const identity = await verifiedIdentity(env, request, cookie);
    if (!identity) throw new RuntimeIdentityError("Could not establish your session.");
    const user = await productUser(env, identity);
    return Response.json(user, { headers: responseCookies(response) });
  }

  if ((pathname === "/api/auth/forgot-password" || pathname === "/api/auth/reset-password") && request.method === "POST") {
    if (!hasValidCsrfToken(request)) {
      return Response.json({ message: "A secure request is required." }, { status: 403 });
    }
    const forgot = pathname.endsWith("forgot-password");
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const token = typeof input.token === "string" ? input.token : "";
    const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
    const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";
    if (forgot && (!email || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
      // Keep the public response indistinguishable from an unknown account.
      return Response.json({ message: "If an account exists for that email, password reset instructions will be sent." });
    }
    if (!forgot && (!token || token.length > 4096 || newPassword.length < 6 || newPassword.length > 256
      || !confirmPassword || confirmPassword.length > 256 || newPassword !== confirmPassword)) {
      return Response.json({ message: "Enter a valid reset link and a password of at least 6 characters." }, { status: 400 });
    }
    const body = forgot ? { email } : { token, newPassword, confirmPassword };
    let response: Response;
    try {
      response = await runtimeRequest(env, request, pathname, { method: "POST", body, timeoutMs: 10_000 });
    } catch {
      return Response.json({ message: forgot
        ? "Password recovery is temporarily unavailable. Please try again."
        : "We could not reset your password. Please request a new reset link." }, { status: 502 });
    }
    if (forgot) {
      if ([400, 403, 429].includes(response.status)) {
        return Response.json({ message: response.status === 403
          ? "A secure request is required."
          : response.status === 429
            ? "Too many requests. Please wait before trying again."
            : "Password recovery is temporarily unavailable. Please try again." }, { status: response.status });
      }
      if (!response.ok) {
        return Response.json({ message: "Password recovery is temporarily unavailable. Please try again." }, { status: 502 });
      }
      return Response.json({ message: "If an account exists for that email, password reset instructions will be sent." });
    }
    if (!response.ok) {
      const status = [400, 401, 403, 404, 410, 429].includes(response.status) ? response.status : 502;
      return Response.json({ message: status === 429
        ? "Too many requests. Please wait before trying again."
        : "We could not reset your password. The link may be invalid or expired." }, { status });
    }
    return Response.json({ success: true });
  }

  if (pathname === "/api/auth/me" && request.method === "GET") {
    return Response.json(await resolveRuntimeProductUser(env, request), {
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (pathname === "/api/auth/logout" && request.method === "POST") {
    const identity = await verifiedIdentity(env, request);
    if (identity) {
      // The session ID comes from the runtime's verified check, never a browser field.
      // Stock logout uses this cookie to revoke the actual runtime D1 session.
      const response = await runtimeRequest(env, request, pathname, { method: "POST", sessionId: identity.sessionId });
      if (!response.ok) throw new RuntimeIdentityError("Could not sign out. Please try again.");
      if ((await verifiedIdentity(env, request))?.sessionId === identity.sessionId) {
        // Stock logout can acknowledge a revocation error. Its protected,
        // owner-scoped session endpoint is the second route to revoke it.
        const revoke = await runtimeRequest(env, request, `/api/auth/sessions/${encodeURIComponent(identity.sessionId)}`, { method: "DELETE" });
        if (!revoke.ok || (await verifiedIdentity(env, request))?.sessionId === identity.sessionId) {
          throw new RuntimeIdentityError("Could not sign out. Please try again.");
        }
      }
    }
    // Retire any pre-migration staging admin session in the same browser too.
    await revokeSession(env.DB, request);
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", clearCookie(AUTH_COOKIE));
    headers.append("Set-Cookie", `${CSRF_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict`);
    headers.append("Set-Cookie", expiredSessionCookie());
    return new Response(null, { status: 204, headers });
  }

  if (pathname.startsWith("/api/auth/")) {
    return Response.json({ message: "This account setting is not available yet." }, { status: 404 });
  }
  return null;
}