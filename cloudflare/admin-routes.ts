import bcrypt from "bcryptjs";
import { createSession, resolveSession, sessionCookie, type SessionUser } from "./staging/auth";

type AdminEnv = { DB: D1Database; STAGING_LOGIN_ENABLED?: string };
type AdminRouteArgs = { request: Request; env: AdminEnv; url: URL; input: Record<string, unknown> };

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BUCKET_LIMIT = 2_048;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
// Used for nonexistent accounts too, so login failures do not disclose account existence.
const DUMMY_PASSWORD_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, { headers: { "Cache-Control": "no-store", ...init.headers }, ...init });

function serializeEntry(row: any) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    source: row.source,
    status: row.status,
    createdAt: row.created_at ?? row.createdAt,
  };
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.trim().length <= 320 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

function adminUser(user: SessionUser | null): user is SessionUser {
  return user?.role === "super_admin";
}

function requestIp(request: Request): string {
  return (request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0] || "unknown").trim().slice(0, 128);
}

function rateLimited(keys: string[], now = Date.now()): boolean {
  let limited = false;
  for (const key of keys) {
    const current = loginAttempts.get(key);
    if (current && current.resetAt > now) {
      if (current.count >= LOGIN_MAX_ATTEMPTS) limited = true;
      continue;
    }
    loginAttempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
  }
  while (loginAttempts.size > LOGIN_BUCKET_LIMIT) {
    const oldest = loginAttempts.keys().next().value;
    if (oldest === undefined) break;
    loginAttempts.delete(oldest);
  }
  return limited;
}

function recordLoginFailure(keys: string[], now = Date.now()): void {
  for (const key of keys) {
    const current = loginAttempts.get(key);
    if (!current || current.resetAt <= now) {
      loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    } else {
      current.count += 1;
    }
  }
}

export async function handleAdminRoute({ request, env, url, input }: AdminRouteArgs): Promise<Response | null> {
  if (url.pathname === "/api/waitlist" && request.method === "POST") {
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const source = typeof input.source === "string" && input.source.trim() ? input.source.trim().slice(0, 80) : "waitlist";
    if (!name || !validEmail(email)) {
      return json({ message: "Name and a valid email are required." }, { status: 400 });
    }
    const row = await env.DB.prepare(
      "INSERT INTO waitlist_entries(name,email,source) VALUES(?,?,?) RETURNING id,name,email,source,status,created_at",
    ).bind(name, email, source).first();
    return json(serializeEntry(row), { status: 201 });
  }

  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    if (env.STAGING_LOGIN_ENABLED !== "true") return json({ message: "Admin login is disabled." }, { status: 503 });
    const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!username || !password) return json({ message: "Username and password are required." }, { status: 400 });
    const limiterKeys = [`ip:${requestIp(request)}`, `identity:${username}`];
    if (rateLimited(limiterKeys)) return json({ message: "Too many login attempts. Please try again later." }, { status: 429 });
    const user = await env.DB.prepare("SELECT id,username,email,password,plan,role,created_at FROM users WHERE lower(username)=? OR lower(email)=?")
      .bind(username, username).first<any>();
    const passwordMatches = await bcrypt.compare(password, user?.password || DUMMY_PASSWORD_HASH);
    if (!user || user.role !== "super_admin" || !passwordMatches) {
      recordLoginFailure(limiterKeys);
      return json({ message: "Invalid username or password." }, { status: 401 });
    }
    const token = await createSession(env.DB, user);
    return json({ success: true, user: { id: user.id, username: user.username, email: user.email, plan: user.plan, role: user.role, createdAt: user.created_at } }, {
      headers: { "Set-Cookie": sessionCookie(token) },
    });
  }

  const waitlistMatch = url.pathname.match(/^\/api\/admin\/waitlist(?:\/(\d+))?$/);
  const statusMatch = url.pathname.match(/^\/api\/admin\/waitlist\/(\d+)\/status$/);
  if (!waitlistMatch && !statusMatch) return null;
  const user = await resolveSession(env.DB, request);
  if (!adminUser(user)) return json({ message: "Forbidden" }, { status: user ? 403 : 401 });

  if (waitlistMatch && request.method === "GET" && !waitlistMatch[1]) {
    const rows = await env.DB.prepare("SELECT id,name,email,source,status,created_at FROM waitlist_entries ORDER BY created_at DESC, id DESC").all();
    return json(rows.results.map(serializeEntry));
  }
  if (waitlistMatch?.[1] && request.method === "DELETE") {
    const id = Number(waitlistMatch[1]);
    if (!Number.isSafeInteger(id)) return json({ message: "Invalid waitlist entry." }, { status: 400 });
    await env.DB.prepare("DELETE FROM waitlist_entries WHERE id=?").bind(id).run();
    return json({ success: true });
  }
  if (statusMatch && request.method === "PATCH") {
    const id = Number(statusMatch[1]);
    const status = typeof input.status === "string" ? input.status.trim().slice(0, 40) : "";
    if (!Number.isSafeInteger(id) || !status) return json({ message: "A valid status is required." }, { status: 400 });
    const row = await env.DB.prepare("UPDATE waitlist_entries SET status=? WHERE id=? RETURNING id,name,email,source,status,created_at")
      .bind(status, id).first();
    return row ? json(serializeEntry(row)) : json({ message: "Waitlist entry not found." }, { status: 404 });
  }
  return json({ message: "Not found" }, { status: 404 });
}