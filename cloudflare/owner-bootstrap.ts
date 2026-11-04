import { hasValidCsrfToken, type SessionUser } from "./staging/auth";
import { resolveRuntimeProductUser } from "./staging/runtime-identity";

const OWNER_EMAIL = "support@buildcustom.ai";
const SENDER_EMAIL = "security@buildcustom.ai";
const TOKEN_TTL_MS = 15 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const GENERIC_REQUEST_MESSAGE = "If this account is eligible, a one-time verification link will be sent.";

type EmailBinding = {
  send(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
};

type OwnerBootstrapEnv = {
  DB: D1Database;
  AUTH_RUNTIME?: Fetcher;
  AUTH_RUNTIME_URL?: string;
  ENVIRONMENT?: string;
  CONTROL_PLANE_PROFILE?: string;
  CONTROL_PLANE_ALLOWED_ORIGIN?: string;
  OWNER_BOOTSTRAP_SECRET?: string;
  EMAIL?: EmailBinding;
};

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
});

function hasValidOrigin(env: OwnerBootstrapEnv, request: Request): boolean {
  return Boolean(env.CONTROL_PLANE_ALLOWED_ORIGIN)
    && request.headers.get("Origin") === env.CONTROL_PLANE_ALLOWED_ORIGIN;
}

function protectedMutation(env: OwnerBootstrapEnv, request: Request): boolean {
  return hasValidOrigin(env, request) && hasValidCsrfToken(request);
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function constantTimeSecretMatch(expected: string, supplied: string): Promise<boolean> {
  if (expected.length < 32 || supplied.length > 512) return false;
  const [left, right] = await Promise.all([sha256(expected), sha256(supplied)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hashBucket(value: string): Promise<string> {
  return sha256(`buildcustom-owner-bootstrap:${value}`);
}

async function rateLimit(
  env: OwnerBootstrapEnv,
  bucket: string,
  limit: number,
  now: number,
): Promise<boolean> {
  const bucketHash = await hashBucket(bucket);
  const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  await env.DB.prepare(
    `INSERT INTO owner_bootstrap_rate_limits(bucket_hash,window_started_at_ms,request_count)
     VALUES(?,?,1)
     ON CONFLICT(bucket_hash) DO UPDATE SET
       window_started_at_ms=CASE
         WHEN owner_bootstrap_rate_limits.window_started_at_ms <= ? THEN excluded.window_started_at_ms
         ELSE owner_bootstrap_rate_limits.window_started_at_ms END,
       request_count=CASE
         WHEN owner_bootstrap_rate_limits.window_started_at_ms <= ? THEN 1
         ELSE owner_bootstrap_rate_limits.request_count + 1 END`,
  ).bind(bucketHash, windowStart, now - RATE_WINDOW_MS, now - RATE_WINDOW_MS).run();
  const row = await env.DB.prepare(
    "SELECT request_count FROM owner_bootstrap_rate_limits WHERE bucket_hash=?",
  ).bind(bucketHash).first<{ request_count: number }>();
  return Number(row?.request_count || 0) <= limit;
}

async function ownerState(env: OwnerBootstrapEnv, user: SessionUser) {
  const now = Date.now();
  const [proof, owners, bootstrap] = await Promise.all([
    env.DB.prepare(
      "SELECT verified_at_ms FROM owner_email_verification_proofs WHERE user_id=? AND expires_at_ms>? AND consumed_at_ms IS NULL",
    ).bind(user.id, now).first<{ verified_at_ms: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM users WHERE role='super_admin'",
    ).first<{ count: number }>(),
    env.DB.prepare(
      "SELECT consumed_at_ms FROM owner_bootstrap_state WHERE singleton=1",
    ).first<{ consumed_at_ms: number | null }>(),
  ]);
  const ownerAlreadyInitialized = Number(owners?.count || 0) > 0 || bootstrap?.consumed_at_ms != null;
  const isOwnerCandidate = user.email.trim().toLowerCase() === OWNER_EMAIL;
  const emailOwnershipVerified = Boolean(proof);
  return {
    candidateEmail: OWNER_EMAIL,
    accountStatus: user.account_status || "active",
    alreadyAdmin: user.role === "super_admin",
    ownerAlreadyInitialized,
    emailOwnershipVerified,
    verifiedAt: proof?.verified_at_ms ?? null,
    verificationServiceAvailable: Boolean(env.EMAIL),
    ownerSecretConfigured: typeof env.OWNER_BOOTSTRAP_SECRET === "string"
      && env.OWNER_BOOTSTRAP_SECRET.length >= 32,
    eligible: isOwnerCandidate
      && user.role === "user"
      && user.account_status !== "suspended"
      && emailOwnershipVerified
      && !ownerAlreadyInitialized,
  };
}

async function requestVerification(
  env: OwnerBootstrapEnv,
  request: Request,
): Promise<Response> {
  if (!protectedMutation(env, request)) {
    return json({ message: "A secure request is required." }, 403);
  }

  const now = Date.now();
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipAllowed = await rateLimit(env, `ip:${ip}`, 8, now);
  const user = await resolveRuntimeProductUser(env, request);
  const accountAllowed = user
    ? await rateLimit(env, `account:${user.id}`, 3, now)
    : true;
  const eligible = Boolean(user
    && user.email.trim().toLowerCase() === OWNER_EMAIL
    && user.role === "user"
    && user.account_status !== "suspended");
  const owners = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM users WHERE role='super_admin'",
  ).first<{ count: number }>();
  const bootstrap = await env.DB.prepare(
    "SELECT consumed_at_ms FROM owner_bootstrap_state WHERE singleton=1",
  ).first<{ consumed_at_ms: number | null }>();
  const bootstrapAvailable = Number(owners?.count || 0) === 0 && bootstrap?.consumed_at_ms == null;

  if (!eligible || !bootstrapAvailable || !ipAllowed || !accountAllowed || !env.EMAIL) {
    return json({ message: GENERIC_REQUEST_MESSAGE }, 202);
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = now + TOKEN_TTL_MS;
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM owner_email_verification_tokens WHERE expires_at_ms<=? OR (user_id=? AND consumed_at_ms IS NULL)",
    ).bind(now, user!.id),
    env.DB.prepare(
      "DELETE FROM owner_bootstrap_rate_limits WHERE window_started_at_ms<?",
    ).bind(now - 24 * 60 * 60 * 1000),
    env.DB.prepare(
      "INSERT INTO owner_email_verification_tokens(token_hash,user_id,created_at_ms,expires_at_ms,consumed_at_ms,consume_nonce) VALUES(?,?,?,?,NULL,NULL)",
    ).bind(tokenHash, user!.id, now, expiresAt),
  ]);

  let link: string;
  try {
    const origin = new URL(env.CONTROL_PLANE_ALLOWED_ORIGIN || "");
    if (origin.origin !== "https://app.buildcustom.ai") throw new Error("Invalid owner verification origin.");
    const verificationUrl = new URL("/owner-email-verification", origin);
    verificationUrl.hash = new URLSearchParams({ token }).toString();
    link = verificationUrl.toString();
  } catch {
    await env.DB.prepare("DELETE FROM owner_email_verification_tokens WHERE token_hash=?")
      .bind(tokenHash).run();
    return json({ message: GENERIC_REQUEST_MESSAGE }, 202);
  }

  const text = [
    "A request was made to verify the owner email for BuildCustom.",
    "",
    `Open this one-time link within 15 minutes: ${link}`,
    "",
    "If you did not request this, ignore this message.",
  ].join("\n");
  const html = `<p>A request was made to verify the owner email for BuildCustom.</p><p><a href="${link}">Verify email ownership</a></p><p>This one-time link expires in 15 minutes. If you did not request it, ignore this message.</p>`;
  try {
    await env.EMAIL.send({
      from: SENDER_EMAIL,
      to: OWNER_EMAIL,
      subject: "Verify BuildCustom owner email",
      text,
      html,
    });
  } catch {
    // Do not log the token or expose whether an account or delivery attempt exists.
    await env.DB.prepare("DELETE FROM owner_email_verification_tokens WHERE token_hash=?")
      .bind(tokenHash).run();
  }
  return json({ message: GENERIC_REQUEST_MESSAGE }, 202);
}

async function verifyEmailToken(env: OwnerBootstrapEnv, input: Record<string, unknown>): Promise<Response> {
  const token = typeof input.token === "string" ? input.token : "";
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
    return json({ success: true, message: "If the link was valid, email ownership is now confirmed." });
  }
  const tokenHash = await sha256(token);
  const now = Date.now();
  const consumeNonce = randomToken();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE owner_email_verification_tokens
       SET consumed_at_ms=?, consume_nonce=?
       WHERE token_hash=? AND consumed_at_ms IS NULL AND expires_at_ms>?`,
    ).bind(now, consumeNonce, tokenHash, now),
    env.DB.prepare(
      `INSERT INTO owner_email_verification_proofs(user_id,verified_at_ms,expires_at_ms,consumed_at_ms,consume_nonce)
       SELECT user_id,?,?,NULL,NULL FROM owner_email_verification_tokens
       WHERE token_hash=? AND consume_nonce=? AND consumed_at_ms=?
       ON CONFLICT(user_id) DO UPDATE SET
         verified_at_ms=excluded.verified_at_ms,
         expires_at_ms=excluded.expires_at_ms,
         consumed_at_ms=NULL,
         consume_nonce=NULL`,
    ).bind(now, now + TOKEN_TTL_MS, tokenHash, consumeNonce, now),
  ]);
  const verified = Number(results[0]?.meta?.changes || 0) === 1;
  return json({
    success: true,
    verified,
    message: verified
      ? "Email ownership is confirmed. Sign in to the existing account and return to Owner access."
      : "This link may be expired or already used. Return to Owner access to request a new link.",
  });
}

async function activateOwner(
  env: OwnerBootstrapEnv,
  request: Request,
  user: SessionUser,
  input: Record<string, unknown>,
): Promise<Response> {
  if (!protectedMutation(env, request)) return json({ message: "A secure request is required." }, 403);
  if (user.email.trim().toLowerCase() !== OWNER_EMAIL) {
    return json({ message: "Owner authorization is restricted to the designated account." }, 403);
  }
  if (user.role !== "user") {
    return json({ message: "Owner bootstrap is only available before an owner is initialized." }, 409);
  }
  if (user.account_status === "suspended") {
    return json({ message: "This account is not eligible for owner authorization." }, 403);
  }
  if (input.confirmEmail !== OWNER_EMAIL) {
    return json({ message: "Type the exact owner email to confirm authorization." }, 400);
  }
  const suppliedSecret = typeof input.ownerSecret === "string" ? input.ownerSecret : "";
  const configuredSecret = env.OWNER_BOOTSTRAP_SECRET;
  if (!configuredSecret || !(await constantTimeSecretMatch(configuredSecret, suppliedSecret))) {
    return json({ message: "The owner authorization secret is invalid or not configured." }, 403);
  }

  const now = Date.now();
  const consumeNonce = randomToken();
  const metadata = JSON.stringify({ method: "fresh-email-verification" });
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET role='super_admin'
       WHERE id=? AND lower(email)=? AND role='user' AND account_status='active'
         AND EXISTS (
           SELECT 1 FROM owner_email_verification_proofs
           WHERE user_id=? AND expires_at_ms>? AND consumed_at_ms IS NULL
         )
         AND EXISTS (SELECT 1 FROM owner_bootstrap_state WHERE singleton=1 AND consumed_at_ms IS NULL)
         AND NOT EXISTS (SELECT 1 FROM users WHERE role='super_admin')`,
    ).bind(user.id, OWNER_EMAIL, user.id, now),
    env.DB.prepare(
      `UPDATE owner_email_verification_proofs SET consumed_at_ms=?,consume_nonce=?
       WHERE user_id=? AND expires_at_ms>? AND consumed_at_ms IS NULL
         AND EXISTS (SELECT 1 FROM users WHERE id=? AND role='super_admin')`,
    ).bind(now, consumeNonce, user.id, now, user.id),
    env.DB.prepare(
      `UPDATE owner_bootstrap_state SET consumed_at_ms=?,consume_nonce=?
       WHERE singleton=1 AND consumed_at_ms IS NULL
         AND EXISTS (SELECT 1 FROM users WHERE id=? AND role='super_admin')
         AND EXISTS (SELECT 1 FROM owner_email_verification_proofs WHERE user_id=? AND consume_nonce=?)`,
    ).bind(now, consumeNonce, user.id, user.id, consumeNonce),
    env.DB.prepare(
      `INSERT INTO audit_events(actor_user_id,action,metadata_json)
       SELECT ?, 'initial_owner_bootstrap', ?
       WHERE EXISTS (SELECT 1 FROM owner_bootstrap_state WHERE singleton=1 AND consume_nonce=?)
         AND EXISTS (SELECT 1 FROM users WHERE id=? AND role='super_admin')`,
    ).bind(user.id, metadata, consumeNonce, user.id),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    return json({ message: "Owner bootstrap is no longer available or the email proof has expired." }, 409);
  }
  return json({ success: true, role: "super_admin" });
}

export async function handleOwnerBootstrapRoute(args: {
  env: OwnerBootstrapEnv;
  request: Request;
  url: URL;
  input: Record<string, unknown>;
}): Promise<Response | null> {
  const { env, request, url, input } = args;
  if (!url.pathname.startsWith("/api/admin/owner-bootstrap")) return null;

  if (url.pathname === "/api/admin/owner-bootstrap/verify-email" && request.method === "POST") {
    if (!hasValidOrigin(env, request)) return json({ message: "A secure request is required." }, 403);
    return verifyEmailToken(env, input);
  }

  if (url.pathname === "/api/admin/owner-bootstrap/request-email" && request.method === "POST") {
    return requestVerification(env, request);
  }

  if (url.pathname !== "/api/admin/owner-bootstrap") return json({ message: "Not found" }, 404);

  const user = await resolveRuntimeProductUser(env, request);
  if (!user) return json({ message: "Unauthorized" }, 401);
  if (user.email.trim().toLowerCase() !== OWNER_EMAIL) {
    return json({ message: "Owner authorization is restricted to the designated account." }, 403);
  }
  if (request.method === "GET") return json(await ownerState(env, user));
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  return activateOwner(env, request, user, input);
}
