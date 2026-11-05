import assert from "node:assert/strict";
import test from "node:test";
import { handleOwnerBootstrapRoute } from "../cloudflare/owner-bootstrap";

const origin = "https://app.buildcustom.ai";
const ownerEmail = "support@buildcustom.ai";

type User = {
  id: string;
  email: string;
  role: string;
  account_status: "active" | "suspended";
  username: string;
};

type TokenRow = {
  userId: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
  nonce: string | null;
};

type ProofRow = {
  verifiedAt: number;
  expiresAt: number;
  consumedAt: number | null;
  nonce: string | null;
};

function ownerEnv(options: {
  user?: Partial<User>;
  users?: User[];
  secret?: string;
  emailAvailable?: boolean;
} = {}) {
  const user: User = {
    id: "existing-owner-id",
    email: ownerEmail,
    role: "user",
    account_status: "active",
    username: "BuildCustom Support",
    ...options.user,
  };
  const users = [user, ...(options.users || [])];
  const tokens = new Map<string, TokenRow>();
  const proofs = new Map<string, ProofRow>();
  const rateLimits = new Map<string, { window: number; count: number }>();
  const sent: Array<Record<string, string>> = [];
  const audit: string[] = [];
  const bootstrap = { consumedAt: null as number | null, nonce: null as string | null };
  const statements: string[] = [];

  function statement(sql: string) {
    statements.push(sql);
    let values: unknown[] = [];
    const current = {
      sql,
      bind(...args: unknown[]) {
        values = args;
        return current;
      },
      async first() {
        if (sql.includes("SELECT id,COALESCE(profile_name,display_name,username) AS username,email,role,plan,created_at,account_status FROM users WHERE id=?")
          || sql.includes("SELECT id,display_name AS username,email,role,plan,created_at,account_status FROM users WHERE id=?")) {
          const found = users.find((row) => row.id === values[0]);
          return found ? {
            id: found.id,
            username: found.username,
            email: found.email,
            role: found.role,
            plan: "free",
            created_at: "2026-01-01",
            account_status: found.account_status,
          } : null;
        }
        if (sql.includes("SELECT COUNT(*) AS count FROM users WHERE role='super_admin'")) {
          return { count: users.filter((row) => row.role === "super_admin").length };
        }
        if (sql.includes("SELECT consumed_at_ms FROM owner_bootstrap_state")) {
          return { consumed_at_ms: bootstrap.consumedAt };
        }
        if (sql.includes("SELECT verified_at_ms FROM owner_email_verification_proofs")) {
          const proof = proofs.get(String(values[0]));
          return proof && proof.expiresAt > Number(values[1]) && proof.consumedAt === null
            ? { verified_at_ms: proof.verifiedAt } : null;
        }
        if (sql.includes("SELECT request_count FROM owner_bootstrap_rate_limits")) {
          return { request_count: rateLimits.get(String(values[0]))?.count || 0 };
        }
        return null;
      },
      async run() {
        if (/^\s*INSERT INTO users/i.test(sql)) {
          const existing = users.find((row) => row.id === values[0]);
          if (existing) {
            existing.email = String(values[2]);
            existing.username = String(values[3]);
          }
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("INSERT INTO owner_bootstrap_rate_limits")) {
          const key = String(values[0]);
          const window = Number(values[1]);
          const resetBefore = Number(values[2]);
          const previous = rateLimits.get(key);
          if (!previous) rateLimits.set(key, { window, count: 1 });
          else if (previous.window <= resetBefore) rateLimits.set(key, { window, count: 1 });
          else previous.count += 1;
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("DELETE FROM owner_email_verification_tokens")) {
          if (sql.includes("WHERE user_id=?")) {
            for (const [hash, row] of tokens) {
              if (row.userId === values[0] && row.consumedAt === null) tokens.delete(hash);
            }
          } else {
            tokens.delete(String(values[0]));
          }
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("INSERT INTO owner_email_verification_tokens")) {
          tokens.set(String(values[0]), {
            userId: String(values[1]),
            createdAt: Number(values[2]),
            expiresAt: Number(values[3]),
            consumedAt: null,
            nonce: null,
          });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("UPDATE owner_email_verification_tokens")) {
          const [now, nonce, hash, expiresAfter] = values;
          const row = tokens.get(String(hash));
          const changed = Boolean(row && row.consumedAt === null && row.expiresAt > Number(expiresAfter));
          if (changed) {
            row!.consumedAt = Number(now);
            row!.nonce = String(nonce);
          }
          return { success: true, meta: { changes: changed ? 1 : 0 } };
        }
        if (sql.includes("INSERT INTO owner_email_verification_proofs")) {
          const [verifiedAt, expiresAt, hash, nonce, consumedAt] = values;
          const token = tokens.get(String(hash));
          if (token && token.nonce === nonce && token.consumedAt === Number(consumedAt)) {
            proofs.set(token.userId, {
              verifiedAt: Number(verifiedAt),
              expiresAt: Number(expiresAt),
              consumedAt: null,
              nonce: null,
            });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        if (sql.includes("UPDATE users SET role='super_admin'")) {
          const [id, email, proofUserId, now] = values;
          const target = users.find((row) => row.id === id && row.email.toLowerCase() === email);
          const proof = proofs.get(String(proofUserId));
          const allowed = target?.role === "user"
            && target.account_status === "active"
            && proof?.expiresAt! > Number(now)
            && proof?.consumedAt === null
            && bootstrap.consumedAt === null
            && !users.some((row) => row.role === "super_admin");
          if (allowed) target!.role = "super_admin";
          return { success: true, meta: { changes: allowed ? 1 : 0 } };
        }
        if (sql.includes("UPDATE owner_email_verification_proofs SET consumed_at_ms")) {
          const [now, nonce, userId, expiresAfter, adminId] = values;
          const proof = proofs.get(String(userId));
          const admin = users.find((row) => row.id === adminId && row.role === "super_admin");
          const changed = Boolean(proof && admin && proof.expiresAt > Number(expiresAfter)
            && proof.consumedAt === null);
          if (changed) {
            proof!.consumedAt = Number(now);
            proof!.nonce = String(nonce);
          }
          return { success: true, meta: { changes: changed ? 1 : 0 } };
        }
        if (sql.includes("UPDATE owner_bootstrap_state SET consumed_at_ms")) {
          const [now, nonce, userId, proofUserId, proofNonce] = values;
          const proof = proofs.get(String(proofUserId));
          const admin = users.find((row) => row.id === userId && row.role === "super_admin");
          const changed = Boolean(admin && proof?.nonce === proofNonce
            && bootstrap.consumedAt === null);
          if (changed) {
            bootstrap.consumedAt = Number(now);
            bootstrap.nonce = String(nonce);
          }
          return { success: true, meta: { changes: changed ? 1 : 0 } };
        }
        if (sql.includes("INSERT INTO audit_events(actor_user_id,action,metadata_json)")) {
          const [, , nonce, id] = values;
          if (bootstrap.nonce === nonce && users.some((row) => row.id === id && row.role === "super_admin")) {
            audit.push("initial_owner_bootstrap");
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        return { success: true, meta: { changes: 1 } };
      },
    };
    return current;
  }

  const env = {
    DB: {
      prepare: statement,
      async batch(items: any[]) {
        const results = [];
        for (const item of items) results.push(await item.run());
        return results;
      },
    },
    ENVIRONMENT: "production",
    CONTROL_PLANE_PROFILE: "launch",
    AUTH_RUNTIME_URL: "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev",
    CONTROL_PLANE_ALLOWED_ORIGIN: origin,
    OWNER_BOOTSTRAP_SECRET: options.secret ?? "x".repeat(64),
    ...(options.emailAvailable === false ? {} : {
      EMAIL: {
        async send(message: Record<string, string>) {
          sent.push(message);
          return { messageId: "test-message-only" };
        },
      },
    }),
    AUTH_RUNTIME: {
      async fetch(request: Request) {
        if (new URL(request.url).pathname === "/api/auth/check") {
          const authenticated = Boolean(request.headers.get("Cookie")?.includes("accessToken="));
          return Response.json({
            success: true,
            data: {
              authenticated,
              user: authenticated ? {
                id: user.id,
                email: user.email,
                displayName: user.username,
                provider: "email",
                emailVerified: true,
                emailVerifiedAt: "2026-11-03T12:00:00.000Z",
              } : null,
              ...(authenticated ? { sessionId: "test-session-id" } : {}),
            },
          });
        }
        return Response.json({ success: false }, { status: 404 });
      },
    },
  } as any;

  return { env, user, users, tokens, proofs, rateLimits, sent, audit, bootstrap, statements };
}

function request(path: string, options: {
  method?: string;
  body?: unknown;
  authenticated?: boolean;
  csrf?: boolean;
  withOrigin?: boolean;
} = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.withOrigin !== false) headers.set("Origin", origin);
  if (options.authenticated !== false) headers.set("Cookie", "accessToken=runtime-session");
  if (options.csrf) {
    headers.set("Cookie", `${headers.get("Cookie") ? `${headers.get("Cookie")}; ` : ""}csrf-token=csrf-value`);
    headers.set("X-CSRF-Token", "csrf-value");
  }
  return new Request(`${origin}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function route(env: any, req: Request) {
  return handleOwnerBootstrapRoute({
    env,
    request: req,
    url: new URL(req.url),
    input: req.method === "GET" ? {} : await req.json() as Record<string, unknown>,
  });
}

async function requestLink(env: any, auth = true) {
  return route(env, request("/api/admin/owner-bootstrap/request-email", {
    method: "POST",
    authenticated: auth,
    csrf: true,
    body: {},
  }));
}

function tokenFromMail(mail: Record<string, string>): string {
  const match = mail.text.match(/owner-email-verification#token=([A-Za-z0-9_-]+)/);
  assert.ok(match, "verification email contains the link");
  return match[1];
}

async function verifyToken(env: any, token: string, withOrigin = true) {
  return route(env, request("/api/admin/owner-bootstrap/verify-email", {
    method: "POST",
    authenticated: false,
    withOrigin,
    body: { token },
  }));
}

async function activate(env: any, body: Record<string, unknown> = {}, csrf = true) {
  return route(env, request("/api/admin/owner-bootstrap", {
    method: "POST",
    body: { confirmEmail: ownerEmail, ...body },
    csrf,
  }));
}

test("owner verification sends only to the designated mailbox and stores a token hash", async () => {
  const fixture = ownerEnv();
  const response = await requestLink(fixture.env);
  assert.equal(response?.status, 202);
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.sent[0].to, ownerEmail);
  assert.equal(fixture.sent[0].from, "security@buildcustom.ai");
  assert.match(fixture.sent[0].text, /15 minutes/);
  assert.equal(fixture.tokens.size, 1);

  const token = tokenFromMail(fixture.sent[0]);
  const tokenDigest = Array.from(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  )), (byte) => byte.toString(16).padStart(2, "0")).join("");
  assert.ok(fixture.tokens.has(tokenDigest));
  assert.equal(fixture.tokens.has(token), false);
  const row = fixture.tokens.get(tokenDigest)!;
  assert.ok(row.expiresAt - row.createdAt <= 15 * 60 * 1000);
  assert.equal(row.userId, fixture.user.id);
});

test("expired, invalid, and reused verification links do not create new proof", async () => {
  const fixture = ownerEnv();
  const response = await requestLink(fixture.env);
  const token = tokenFromMail(fixture.sent[0]);
  const tokenDigest = Array.from(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  )), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const expiredRow = fixture.tokens.get(tokenDigest)!;
  expiredRow.expiresAt = Date.now() - 1;
  const expired = await verifyToken(fixture.env, token);
  assert.equal((await expired?.json() as any).verified, false);
  assert.equal(fixture.proofs.has(fixture.user.id), false);

  const invalid = await verifyToken(fixture.env, "not-a-real-token-123456789012345678901234567890");
  assert.equal((await invalid?.json() as any).verified, false);
  assert.equal(fixture.proofs.has(fixture.user.id), false);

  assert.equal(response?.status, 202);
  const second = ownerEnv();
  await requestLink(second.env);
  const validToken = tokenFromMail(second.sent[0]);
  const firstUse = await verifyToken(second.env, validToken);
  assert.equal((await firstUse?.json() as any).verified, true);
  const reuse = await verifyToken(second.env, validToken);
  assert.equal((await reuse?.json() as any).verified, false);
  assert.equal(second.proofs.size, 1);
});

test("signup verification claims and provider identities are not proof of mailbox ownership", async () => {
  const fixture = ownerEnv();
  const stateResponse = await route(fixture.env, request("/api/admin/owner-bootstrap"));
  const state = await stateResponse?.json() as any;
  assert.equal(state.emailOwnershipVerified, false);

  const attempt = await activate(fixture.env);
  assert.equal(attempt?.status, 409);
  assert.equal(fixture.user.role, "user");
});

test("regular customers cannot request or activate the owner bootstrap", async () => {
  const customer = ownerEnv({ user: { id: "customer-2", email: "customer@example.test" } });
  const requestResponse = await requestLink(customer.env);
  assert.equal(requestResponse?.status, 202);
  assert.equal(customer.sent.length, 0);
  assert.deepEqual(await requestResponse?.json(), {
    message: "If this account is eligible, a one-time verification link will be sent.",
  });
  assert.equal((await route(customer.env, request("/api/admin/owner-bootstrap")))?.status, 403);
  assert.equal((await activate(customer.env))?.status, 403);
  assert.equal(customer.user.role, "user");
});

test("anonymous verification requests reveal no account existence and send no email", async () => {
  const fixture = ownerEnv();
  const response = await requestLink(fixture.env, false);
  assert.equal(response?.status, 202);
  assert.deepEqual(await response?.json(), {
    message: "If this account is eligible, a one-time verification link will be sent.",
  });
  assert.equal(fixture.sent.length, 0);
});

test("owner activation requires fresh proof, exact origin, CSRF, and exact email confirmation", async () => {
  const fixture = ownerEnv();
  await requestLink(fixture.env);
  const token = tokenFromMail(fixture.sent[0]);
  assert.equal((await verifyToken(fixture.env, token, false))?.status, 403);
  assert.equal((await verifyToken(fixture.env, token))?.status, 200);

  assert.equal((await activate(fixture.env, {}, false))?.status, 403);
  assert.equal((await activate(fixture.env, { confirmEmail: "wrong@example.test" }))?.status, 400);
  assert.equal(fixture.user.role, "user");
});

test("owner activation stays disabled unless the server-side operator authorization is provisioned", async () => {
  const fixture = ownerEnv({ secret: "" });
  const stateResponse = await route(fixture.env, request("/api/admin/owner-bootstrap"));
  const state = await stateResponse?.json() as any;
  assert.equal(state.operatorAuthorizationReady, false);
  assert.equal(state.eligible, false);

  await requestLink(fixture.env);
  const token = tokenFromMail(fixture.sent[0]);
  await verifyToken(fixture.env, token);
  const response = await activate(fixture.env, { ownerSecret: "client-supplied-value-that-is-not-authoritative" });
  assert.equal(response?.status, 403);
  assert.equal(fixture.user.role, "user");
});

test("owner state exposes readiness only, never the server-side secret", async () => {
  const fixture = ownerEnv();
  const stateResponse = await route(fixture.env, request("/api/admin/owner-bootstrap"));
  const state = await stateResponse?.json() as any;
  assert.equal(state.operatorAuthorizationReady, true);
  assert.equal(JSON.stringify(state).includes(fixture.env.OWNER_BOOTSTRAP_SECRET), false);
});

test("only the existing verified owner can be promoted once", async () => {
  const customer = { id: "other-customer", email: "other@example.test", role: "user", account_status: "active" as const, username: "Other" };
  const fixture = ownerEnv({ users: [customer] });
  await requestLink(fixture.env);
  const token = tokenFromMail(fixture.sent[0]);
  assert.equal((await verifyToken(fixture.env, token))?.status, 200);
  const promoted = await activate(fixture.env);
  assert.equal(promoted?.status, 200);
  assert.equal(fixture.user.role, "super_admin");
  assert.equal(customer.role, "user");
  assert.equal(fixture.audit.filter((action) => action === "initial_owner_bootstrap").length, 1);
  assert.ok(fixture.bootstrap.consumedAt);

  const repeat = await activate(fixture.env);
  assert.equal(repeat?.status, 409);
  assert.equal(fixture.users.filter((row) => row.role === "super_admin").length, 1);
});

test("verification requests are rate-limited without changing their public response", async () => {
  const fixture = ownerEnv();
  const bodies = [];
  for (let index = 0; index < 4; index += 1) {
    const response = await requestLink(fixture.env);
    bodies.push(await response?.json());
  }
  assert.equal(fixture.sent.length, 3);
  assert.ok(bodies.every((body) => JSON.stringify(body) === JSON.stringify(bodies[0])));
});

test("email delivery failures do not expose account or provider details", async () => {
  const fixture = ownerEnv();
  fixture.env.EMAIL.send = async () => { throw new Error("sensitive provider detail"); };
  const response = await requestLink(fixture.env);
  assert.equal(response?.status, 202);
  assert.deepEqual(await response?.json(), {
    message: "If this account is eligible, a one-time verification link will be sent.",
  });
  assert.equal(fixture.tokens.size, 0);
});
