export type SessionUser = { id: string; username: string; email: string; role: string };
export const SESSION_COOKIE = "__Host-bc_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function parseCookie(header: string | null, name = SESSION_COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS): string {
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export async function createSession(db: D1Database, user: SessionUser): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)")
    .bind(tokenHash, user.id, expires).run();
  return token;
}

export async function resolveSession(db: D1Database, request: Request): Promise<SessionUser | null> {
  const token = parseCookie(request.headers.get("Cookie"));
  if (!token) return null;
  const row = await db.prepare(
    "SELECT u.id,u.username,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>datetime('now')",
  ).bind(await sha256(token)).first<SessionUser>();
  return row || null;
}

export async function revokeSession(db: D1Database, request: Request): Promise<void> {
  const token = parseCookie(request.headers.get("Cookie"));
  if (token) await db.prepare("UPDATE sessions SET revoked_at=datetime('now') WHERE token_hash=?").bind(await sha256(token)).run();
}

export function assertOrigin(request: Request, allowedOrigin: string): void {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
  const origin = request.headers.get("Origin");
  if (origin !== allowedOrigin) throw new Error("ORIGIN_REJECTED");
}