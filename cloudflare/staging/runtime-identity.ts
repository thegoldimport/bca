import { expiredSessionCookie, parseCookie, revokeSession, type SessionUser } from "./auth";

const LAB_AUTH_URL = "https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev";
const AUTH_COOKIE = "accessToken";
const CSRF_COOKIE = "csrf-token";
const clearCookie = (name: string) => `${name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;

type RuntimeAuthEnv = {
  DB: D1Database;
  AUTH_RUNTIME?: Fetcher;
  AUTH_RUNTIME_URL?: string;
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
  if (env.AUTH_RUNTIME_URL !== LAB_AUTH_URL || !env.AUTH_RUNTIME) {
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
} = {}): Promise<Response> {
  const headers = new Headers({ Accept: "application/json" });
  const cookie = options.cookie ?? cookies(request);
  headers.set("Cookie", options.sessionId ? `${cookie}; sessionId=${encodeURIComponent(options.sessionId)}` : cookie);
  const csrf = request.headers.get("X-CSRF-Token");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  if (options.body) headers.set("Content-Type", "application/json");
  try {
    return await authRuntime(env).fetch(new Request(`${LAB_AUTH_URL}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }));
  } catch {
    throw new RuntimeIdentityError("BuildCustom sign-in is temporarily unavailable.");
  }
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