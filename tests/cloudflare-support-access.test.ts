import assert from "node:assert/strict";
import test from "node:test";
import { handleLaunchAdminRoute } from "../cloudflare/launch-admin-routes";
import {
  handleAdminSupportAccessRoute,
  handleCustomerSupportAccessRoute,
} from "../cloudflare/support-access-routes";

const origin = "https://app.buildcustom.ai";
const verifiedAt = "2026-11-03T12:00:00.000Z";

type User = {
  id: string;
  username: string;
  display_name: string;
  email: string;
  role: string;
  plan: string;
  account_status: "active" | "suspended";
  created_at: string;
  [key: string]: unknown;
};

type State = {
  users: Map<string, User>;
  projects: Map<number, Record<string, any>>;
  grants: Map<string, Record<string, any>>;
  sessions: Map<string, Record<string, any>>;
  operations: Record<string, any>[];
  turns: Record<string, any>[];
  releases: Record<string, any>[];
  auditActions: string[];
  writes: number;
};

function makeUser(id: string, role = "user"): User {
  return {
    id,
    username: id,
    display_name: id,
    email: `${id}@example.test`,
    role,
    plan: "free",
    account_status: "active",
    created_at: "2026-01-01 00:00:00",
  };
}

function makeState(): State {
  const customer = makeUser("customer-1");
  const project = {
    id: 101,
    user_id: customer.id,
    name: "Customer Site",
    type: "website",
    status: "published",
    framework: "React",
    created_at: "2026-01-02 00:00:00",
    updated_at: "2026-02-02 00:00:00",
    deployment_updated_at: "2026-02-02 00:00:00",
    deployment_url: "https://customer.example.test/path?token=deployment-secret",
    description: "PRIVATE_PROJECT_DESCRIPTION",
    source_code: "PRIVATE_SOURCE_CODE",
    api_key: "PRIVATE_API_KEY",
  };
  return {
    users: new Map([[customer.id, customer], ["customer-2", makeUser("customer-2")], ["owner-1", makeUser("owner-1", "super_admin")]]),
    projects: new Map([[101, project], [202, { ...project, id: 202, user_id: "customer-2", name: "Other Customer Project" }]]),
    grants: new Map(),
    sessions: new Map(),
    operations: [{
      project_id: 101,
      user_id: customer.id,
      kind: "build",
      status: "failed",
      created_at: "2026-02-03 00:00:00",
      started_at: "2026-02-03 00:00:00",
      finished_at: "2026-02-03 00:00:10",
      error: "PRIVATE_RAW_ERROR",
      input_json: "PRIVATE_PROMPT",
      result_json: "PRIVATE_RESULT",
    }],
    turns: [{
      project_id: 101,
      mode: "build",
      created_at: "2026-02-03 00:00:00",
      prompt: "PRIVATE_PROMPT",
      response: "PRIVATE_RESPONSE",
      changed_files: "PRIVATE_FILES",
      activity: "PRIVATE_ACTIVITY",
    }],
    releases: [{
      project_id: 101,
      deployment_url: "https://customer.example.test/app?token=release-secret",
      created_at: "2026-02-02 00:00:00",
      commit_hash: "PRIVATE_COMMIT_HASH",
    }],
    auditActions: [],
    writes: 0,
  };
}

function isGrantActive(grant: Record<string, any> | undefined): boolean {
  return Boolean(grant && grant.revoked_at_ms == null && Number(grant.expires_at_ms) > Date.now());
}

function createDb(state: State) {
  const first = async (sql: string, values: unknown[]) => {
    if (sql.includes("SELECT id,display_name AS username,email,role,plan,created_at,account_status FROM users WHERE id=?")) {
      const user = state.users.get(String(values[0]));
      return user ? { ...user, account_status: user.account_status } : null;
    }
    if (sql.includes("FROM users WHERE id=? AND role='user'")) {
      const user = state.users.get(String(values[0]));
      return user?.role === "user" ? { ...user, name: user.display_name } : null;
    }
    if (sql.includes("SELECT id,role,email FROM users WHERE id=?") || sql.includes("SELECT id,role FROM users WHERE id=?")) {
      const user = state.users.get(String(values[0]));
      return user ? { id: user.id, role: user.role, email: user.email } : null;
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM operations")) {
      return { total: state.operations.length };
    }
    if (sql.includes("SELECT COUNT(*) AS total,MAX(t.created_at) AS last_activity")) {
      return { total: state.turns.length, last_activity: state.turns[0]?.created_at || null };
    }
    if (sql.includes("SELECT id,project_id FROM support_access_grants")) {
      const grant = state.grants.get(String(values[0]));
      return grant?.customer_user_id === values[1]
        ? { id: grant.id, project_id: grant.project_id }
        : null;
    }
    if (sql.includes("SELECT g.project_id FROM support_access_grants")) {
      const grant = state.grants.get(String(values[0]));
      return grant?.customer_user_id === values[1] && isGrantActive(grant)
        ? { project_id: grant.project_id }
        : null;
    }
    if (sql.includes("FROM support_access_sessions s") && sql.includes("g.expires_at_ms")) {
      const session = state.sessions.get(String(values[0]));
      const grant = session ? state.grants.get(String(session.grant_id)) : undefined;
      const customer = grant ? state.users.get(String(grant.customer_user_id)) : undefined;
      const project = grant ? state.projects.get(Number(grant.project_id)) : undefined;
      if (!session || session.admin_user_id !== values[1] || session.closed_at_ms != null
        || !isGrantActive(grant) || customer?.role !== "user" || customer.account_status !== "active"
        || project?.user_id !== grant?.customer_user_id) return null;
      return {
        id: session.id,
        grant_id: session.grant_id,
        project_id: session.project_id,
        customer_user_id: session.customer_user_id,
        started_at_ms: session.started_at_ms,
        expires_at_ms: grant?.expires_at_ms,
        permission: grant?.permission,
        customer_name: customer?.display_name,
        customer_email: customer?.email,
      };
    }
    if (sql.includes("SELECT id,project_id,closed_at_ms FROM support_access_sessions")) {
      const session = state.sessions.get(String(values[0]));
      return session?.admin_user_id === values[1] ? session : null;
    }
    return null;
  };

  const all = async (sql: string, values: unknown[]) => {
    if (sql.trimStart().startsWith("SELECT s.id,s.grant_id,s.project_id,s.started_at_ms")
      && sql.includes("s.admin_user_id=?")
      && sql.includes("g.expires_at_ms")) {
      const session = state.sessions.get(String(values[0]));
      const grant = session ? state.grants.get(String(session.grant_id)) : undefined;
      const customer = grant ? state.users.get(String(grant.customer_user_id)) : undefined;
      const project = grant ? state.projects.get(Number(grant.project_id)) : undefined;
      if (!session || session.admin_user_id !== values[1] || session.closed_at_ms != null
        || !isGrantActive(grant) || customer?.role !== "user" || customer.account_status !== "active"
        || project?.user_id !== grant?.customer_user_id) return [];
      return [{
        id: session.id,
        grant_id: session.grant_id,
        project_id: session.project_id,
        started_at_ms: session.started_at_ms,
        expires_at_ms: grant?.expires_at_ms,
        permission: grant?.permission,
        customer_name: customer?.display_name,
        customer_email: customer?.email,
      }];
    }
    if (sql.includes("FROM projects p LEFT JOIN runtime_project_links") && sql.includes("WHERE p.user_id=?")) {
      const userId = String(values[0]);
      return [...state.projects.values()].filter((project) => project.user_id === userId);
    }
    if (sql.includes("FROM projects p") && sql.includes("WHERE p.user_id=?")) {
      const userId = String(values[0]);
      return [...state.projects.values()].filter((project) => project.user_id === userId);
    }
    if (sql.includes("FROM operations o")) {
      return state.operations;
    }
    if (sql.includes("FROM runtime_builder_turns t")) {
      return state.turns;
    }
    if (sql.includes("FROM runtime_releases r")) {
      return state.releases;
    }
    if (sql.includes("FROM support_access_grants g")) {
      return [...state.grants.values()].filter((grant) => grant.customer_user_id === values[0]).map((grant) => ({
        ...grant,
        project_name: state.projects.get(Number(grant.project_id))?.name,
      }));
    }
    if (sql.includes("FROM support_access_sessions s") && sql.includes("WHERE s.customer_user_id=?")) {
      return [...state.sessions.values()].filter((session) => session.customer_user_id === values[0]).map((session) => {
        const user = state.users.get(String(session.admin_user_id));
        const grant = state.grants.get(String(session.grant_id));
        return {
          ...session,
          operator_name: user?.display_name,
          operator_email: user?.email,
          expires_at_ms: grant?.expires_at_ms,
          revoked_at_ms: grant?.revoked_at_ms,
        };
      });
    }
    if (sql.includes("FROM runtime_releases r") || sql.includes("FROM operations o")) return [];
    if (sql.includes("FROM projects p") && sql.includes("p.id=?")) {
      const project = state.projects.get(Number(values[0]));
      if (!project) return [];
      const sessionId = String(values[1]);
      const session = state.sessions.get(sessionId);
      const grant = session ? state.grants.get(String(session.grant_id)) : undefined;
      if (!session || !isGrantActive(grant) || session.closed_at_ms != null
        || session.admin_user_id !== values[2] || project.id !== Number(values[0])) return [];
      const customer = grant ? state.users.get(String(grant.customer_user_id)) : undefined;
      if (customer?.account_status !== "active" || project.user_id !== customer.id) return [];
      return [project];
    }
    if (sql.includes("SELECT r.deployment_url,r.created_at")) {
      return state.releases;
    }
    if (sql.includes("SELECT o.kind,o.status,o.created_at")) {
      return state.operations;
    }
    if (sql.includes("SELECT t.mode,t.created_at")) return state.turns;
    if (sql.includes("SELECT COUNT(*) AS total,MAX(t.created_at)")) {
      const session = state.sessions.get(String(values[0]));
      const grant = session ? state.grants.get(String(session.grant_id)) : undefined;
      return isGrantActive(grant)
        ? [{ total: state.turns.length, last_activity: state.turns[0]?.created_at || null }]
        : [{ total: 0, last_activity: null }];
    }
    return [];
  };

  const run = async (sql: string, values: unknown[]) => {
    state.writes += 1;
    if (sql.startsWith("INSERT INTO users")) {
      const id = String(values[0]);
      const old = state.users.get(id);
      state.users.set(id, {
        ...(old || makeUser(id)),
        id,
        username: String(values[1]),
        email: String(values[2]),
        display_name: String(values[3]),
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO support_access_grants")) {
      const [id, customerId, projectId, permission, grantedAt, expiresAt] = values as any[];
      const project = state.projects.get(Number(projectId));
      const customer = state.users.get(String(customerId));
      const activeDuplicate = [...state.grants.values()].some((grant) =>
        grant.customer_user_id === customerId && grant.project_id === Number(projectId) && isGrantActive(grant));
      if (!project || project.user_id !== customerId || customer?.role !== "user"
        || customer.account_status !== "active" || activeDuplicate) {
        return { success: true, meta: { changes: 0 } };
      }
      state.grants.set(String(id), {
        id,
        customer_user_id: customerId,
        project_id: Number(projectId),
        permission,
        granted_at_ms: Number(grantedAt),
        expires_at_ms: Number(expiresAt),
        revoked_at_ms: null,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("UPDATE support_access_grants")) {
      const [revokedAt, revokedBy, grantId, customerId] = values as any[];
      const grant = state.grants.get(String(grantId));
      if (!grant || grant.customer_user_id !== customerId || grant.revoked_at_ms != null) {
        return { success: true, meta: { changes: 0 } };
      }
      grant.revoked_at_ms = Number(revokedAt);
      grant.revoked_by_user_id = revokedBy;
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("UPDATE support_access_sessions SET closed_at_ms=? WHERE grant_id=?")) {
      const [closedAt, grantId] = values as any[];
      let changes = 0;
      for (const session of state.sessions.values()) {
        if (session.grant_id === grantId && session.closed_at_ms == null) {
          session.closed_at_ms = Number(closedAt);
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }
    if (sql.includes("INSERT INTO support_access_sessions")) {
      const [sessionId, adminId, startedAt, lastAccessAt, grantId, customerId] = values as any[];
      const grant = state.grants.get(String(grantId));
      if (!grant || grant.customer_user_id !== customerId || !isGrantActive(grant)) {
        return { success: true, meta: { changes: 0 } };
      }
      state.sessions.set(String(sessionId), {
        id: sessionId,
        grant_id: grantId,
        project_id: grant.project_id,
        customer_user_id: customerId,
        admin_user_id: adminId,
        started_at_ms: Number(startedAt),
        last_access_at_ms: Number(lastAccessAt),
        closed_at_ms: null,
        access_count: 0,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("UPDATE support_access_sessions SET last_access_at_ms")) {
      const [lastAccess, sessionId, adminId, projectId] = values as any[];
      const session = state.sessions.get(String(sessionId));
      const grant = session ? state.grants.get(String(session.grant_id)) : undefined;
      if (!session || session.admin_user_id !== adminId || Number(session.project_id) !== Number(projectId)
        || session.closed_at_ms != null || !isGrantActive(grant)) return { success: true, meta: { changes: 0 } };
      session.last_access_at_ms = Number(lastAccess);
      session.access_count += 1;
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("UPDATE support_access_sessions SET closed_at_ms=? WHERE id=?")) {
      const [closedAt, sessionId, adminId] = values as any[];
      const session = state.sessions.get(String(sessionId));
      if (!session || session.admin_user_id !== adminId || session.closed_at_ms != null) {
        return { success: true, meta: { changes: 0 } };
      }
      session.closed_at_ms = Number(closedAt);
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO audit_events")) {
      const match = sql.match(/'((?:customer|admin)_[a-z_]+)'/);
      const action = match?.[1] || String(values[1] || "audit");
      state.auditActions.push(action);
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("UPDATE users SET account_status")) {
      const [status, customerId] = values as any[];
      const user = state.users.get(String(customerId));
      if (!user || user.role !== "user" || user.account_status === status) {
        return { success: true, meta: { changes: 0 } };
      }
      user.account_status = status;
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 1 } };
  };

  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement: any = {
        sql,
        bind(...args: unknown[]) {
          values = args;
          return statement;
        },
        first: () => first(sql, values),
        all: async () => ({ success: true, results: await all(sql, values), meta: { changes: 0 } }),
        run: () => run(sql, values),
      };
      return statement;
    },
    async batch(statements: any[]) {
      const results = [];
      for (const statement of statements) {
        if (/^\s*SELECT/i.test(statement.sql)) {
          results.push(await statement.all());
        } else {
          results.push(await statement.run());
        }
      }
      return results;
    },
  };
}

function makeEnv(state: State, actorId = "customer-1") {
  return {
    DB: createDb(state),
    ENVIRONMENT: "production",
    CONTROL_PLANE_PROFILE: "launch",
    CONTROL_PLANE_ALLOWED_ORIGIN: origin,
    AUTH_RUNTIME_URL: "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev",
    AUTH_RUNTIME: {
      async fetch() {
        const user = state.users.get(actorId);
        if (!user) return Response.json({ success: false }, { status: 401 });
        return Response.json({
          success: true,
          data: {
            authenticated: true,
            user: {
              id: user.id,
              email: user.email,
              displayName: user.display_name,
              provider: "email",
              emailVerified: true,
              emailVerifiedAt: verifiedAt,
            },
            sessionId: `runtime-session-${user.id}`,
          },
        });
      },
    },
  };
}

function request(path: string, options: {
  method?: string;
  body?: unknown;
  authenticated?: boolean;
  csrf?: boolean;
  originHeader?: string;
} = {}) {
  const headers: Record<string, string> = { Origin: options.originHeader || origin };
  if (options.authenticated !== false) headers.Cookie = "accessToken=runtime-session";
  if (options.csrf) {
    headers.Cookie = `${headers.Cookie ? `${headers.Cookie}; ` : ""}csrf-token=csrf-value`;
    headers["X-CSRF-Token"] = "csrf-value";
  }
  return new Request(`${origin}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function activeGrant(state: State, overrides: Record<string, unknown> = {}) {
  const grant = {
    id: "grant-1",
    customer_user_id: "customer-1",
    project_id: 101,
    permission: "read_only_diagnostics",
    granted_at_ms: Date.now() - 1000,
    expires_at_ms: Date.now() + 60 * 60 * 1000,
    revoked_at_ms: null,
    ...overrides,
  };
  state.grants.set(String(grant.id), grant);
  return grant;
}

test("admin detail requires server-side super-admin authorization", async () => {
  const state = makeState();
  const anonymousEnv = makeEnv(state, "owner-1");
  const anonymous = await handleLaunchAdminRoute({
    request: request("/api/admin/customers/customer-1", { authenticated: false }),
    env: anonymousEnv as any,
    url: new URL(`${origin}/api/admin/customers/customer-1`),
    input: {},
  });
  assert.equal(anonymous?.status, 401);

  const customerEnv = makeEnv(state, "customer-1");
  const regularCustomer = await handleLaunchAdminRoute({
    request: request("/api/admin/customers/customer-1"),
    env: customerEnv as any,
    url: new URL(`${origin}/api/admin/customers/customer-1`),
    input: {},
  });
  assert.equal(regularCustomer?.status, 403);
});

test("admin customer detail returns safe real-data projections only", async () => {
  const state = makeState();
  const adminEnv = makeEnv(state, "owner-1");
  const response = await handleLaunchAdminRoute({
    request: request("/api/admin/customers/customer-1", { authenticated: true }),
    env: adminEnv as any,
    url: new URL(`${origin}/api/admin/customers/customer-1`),
    input: {},
  });
  assert.equal(response?.status, 200);
  const body = await response!.json() as any;
  assert.equal(body.customer.id, "customer-1");
  assert.equal(body.customer.email, "customer-1@example.test");
  assert.equal(body.projects[0].name, "Customer Site");
  assert.equal(body.usage.operationCount, 1);
  assert.equal(body.usage.builderTurnCount, 1);
  assert.equal(body.customer.emailVerification, "Not tracked in product data");
  assert.equal(body.customer.credits, "Not tracked");
  const serialized = JSON.stringify(body);
  for (const secret of [
    "PRIVATE_PROJECT_DESCRIPTION",
    "PRIVATE_SOURCE_CODE",
    "PRIVATE_API_KEY",
    "PRIVATE_RAW_ERROR",
    "PRIVATE_PROMPT",
    "PRIVATE_RESPONSE",
    "PRIVATE_FILES",
    "PRIVATE_ACTIVITY",
    "PRIVATE_COMMIT_HASH",
    "deployment-secret",
    "release-secret",
  ]) assert.equal(serialized.includes(secret), false, `response must omit ${secret}`);
  assert.equal(body.projects[0].deploymentUrl, "https://customer.example.test");
});

test("owner account is protected from customer suspend/reactivate controls", async () => {
  const state = makeState();
  state.users.set("preactivation-owner", {
    ...makeUser("preactivation-owner"),
    email: "support@buildcustom.ai",
  });
  const env = makeEnv(state, "owner-1");
  const response = await handleLaunchAdminRoute({
    request: request("/api/admin/customers/owner-1/status", {
      method: "PATCH",
      csrf: true,
      body: { accountStatus: "suspended" },
    }),
    env: env as any,
    url: new URL(`${origin}/api/admin/customers/owner-1/status`),
    input: { accountStatus: "suspended" },
  });
  assert.equal(response?.status, 409);
  assert.equal(state.users.get("owner-1")?.account_status, "active");
  assert.equal(state.auditActions.includes("admin_account_status_changed"), false);

  const preactivationOwner = await handleLaunchAdminRoute({
    request: request("/api/admin/customers/preactivation-owner/status", {
      method: "PATCH",
      csrf: true,
      body: { accountStatus: "suspended" },
    }),
    env: env as any,
    url: new URL(`${origin}/api/admin/customers/preactivation-owner/status`),
    input: { accountStatus: "suspended" },
  });
  assert.equal(preactivationOwner?.status, 409);
  assert.equal(state.users.get("preactivation-owner")?.account_status, "active");
  assert.equal(state.auditActions.includes("admin_account_status_changed"), false);
});

test("customer grants are project-owned, duration-bounded, CSRF-protected, and auditable", async () => {
  const state = makeState();
  const env = makeEnv(state);

  const noCsrf = await handleCustomerSupportAccessRoute({
    request: request("/api/support-access/grants", {
      method: "POST",
      body: { projectId: 101, durationMinutes: 60 },
    }),
    env: env as any,
    url: new URL(`${origin}/api/support-access/grants`),
    input: { projectId: 101, durationMinutes: 60 },
  });
  assert.equal(noCsrf?.status, 403);
  assert.equal(state.grants.size, 0);

  const invalidOrigin = await handleCustomerSupportAccessRoute({
    request: request("/api/support-access/grants", {
      method: "POST",
      csrf: true,
      originHeader: "https://attacker.example",
      body: { projectId: 101, durationMinutes: 60 },
    }),
    env: env as any,
    url: new URL(`${origin}/api/support-access/grants`),
    input: { projectId: 101, durationMinutes: 60 },
  });
  assert.equal(invalidOrigin?.status, 403);
  assert.equal(state.grants.size, 0);

  const crossCustomer = await handleCustomerSupportAccessRoute({
    request: request("/api/support-access/grants", {
      method: "POST",
      csrf: true,
      body: { projectId: 202, durationMinutes: 60 },
    }),
    env: env as any,
    url: new URL(`${origin}/api/support-access/grants`),
    input: { projectId: 202, durationMinutes: 60 },
  });
  assert.equal(crossCustomer?.status, 409);
  assert.equal(state.grants.size, 0);

  const invalidDuration = await handleCustomerSupportAccessRoute({
    request: request("/api/support-access/grants", {
      method: "POST",
      csrf: true,
      body: { projectId: 101, durationMinutes: 120 },
    }),
    env: env as any,
    url: new URL(`${origin}/api/support-access/grants`),
    input: { projectId: 101, durationMinutes: 120 },
  });
  assert.equal(invalidDuration?.status, 400);

  const created = await handleCustomerSupportAccessRoute({
    request: request("/api/support-access/grants", {
      method: "POST",
      csrf: true,
      body: { projectId: 101, durationMinutes: 60 },
    }),
    env: env as any,
    url: new URL(`${origin}/api/support-access/grants`),
    input: { projectId: 101, durationMinutes: 60 },
  });
  assert.equal(created?.status, 201);
  const { grant } = await created!.json() as any;
  assert.equal(grant.projectId, 101);
  assert.equal(grant.permission, "read_only_diagnostics");
  assert.equal(state.auditActions.includes("customer_support_access_granted"), true);

  const revoked = await handleCustomerSupportAccessRoute({
    request: request(`/api/support-access/grants/${encodeURIComponent(grant.id)}/revoke`, {
      method: "POST",
      csrf: true,
      body: {},
    }),
    env: env as any,
    url: new URL(`${origin}/api/support-access/grants/${encodeURIComponent(grant.id)}/revoke`),
    input: {},
  });
  assert.equal(revoked?.status, 200);
  assert.notEqual(state.grants.get(grant.id)?.revoked_at_ms, null);
  assert.equal(state.auditActions.includes("customer_support_access_revoked"), true);
});

test("expired or revoked approvals cannot open a support session", async () => {
  const state = makeState();
  const admin = state.users.get("owner-1")!;
  const grant = activeGrant(state, { revoked_at_ms: Date.now() - 1000 });
  const env = makeEnv(state, "owner-1");
  const response = await handleAdminSupportAccessRoute({
    request: request(`/api/admin/customers/${grant.customer_user_id}/support-grants/${grant.id}/sessions`, {
      method: "POST",
      csrf: true,
      body: {},
    }),
    env: env as any,
    url: new URL(`${origin}/api/admin/customers/${grant.customer_user_id}/support-grants/${grant.id}/sessions`),
    input: {},
    admin,
  });
  assert.equal(response?.status, 403);
  assert.equal(state.sessions.size, 0);

  const expiredGrant = activeGrant(state, {
    id: "grant-expired",
    project_id: 101,
    expires_at_ms: Date.now() - 1000,
    revoked_at_ms: null,
  });
  const expired = await handleAdminSupportAccessRoute({
    request: request(`/api/admin/customers/${expiredGrant.customer_user_id}/support-grants/${expiredGrant.id}/sessions`, {
      method: "POST",
      csrf: true,
      body: {},
    }),
    env: env as any,
    url: new URL(`${origin}/api/admin/customers/${expiredGrant.customer_user_id}/support-grants/${expiredGrant.id}/sessions`),
    input: {},
    admin,
  });
  assert.equal(expired?.status, 403);
  assert.equal(state.sessions.size, 0);
});

test("support workspace is project-scoped, read-only, audited, and rechecks revocation", async () => {
  const state = makeState();
  const grant = activeGrant(state);
  const adminEnv = makeEnv(state, "owner-1");
  const admin = state.users.get("owner-1")!;
  const openPath = `/api/admin/customers/${grant.customer_user_id}/support-grants/${grant.id}/sessions`;
  const opened = await handleAdminSupportAccessRoute({
    request: request(openPath, { method: "POST", csrf: true, body: {} }),
    env: adminEnv as any,
    url: new URL(`${origin}${openPath}`),
    input: {},
    admin,
  });
  assert.equal(opened?.status, 201);
  const { sessionId } = await opened!.json() as any;
  assert.equal(state.sessions.has(sessionId), true, `created session ${sessionId}`);
  assert.equal(state.auditActions.includes("admin_support_session_opened"), true);

  const workspaceResponse = await handleLaunchAdminRoute({
    request: request(`/api/admin/support-sessions/${encodeURIComponent(sessionId)}`),
    env: adminEnv as any,
    url: new URL(`${origin}/api/admin/support-sessions/${encodeURIComponent(sessionId)}`),
    input: {},
  });
  assert.equal(workspaceResponse?.status, 200, await workspaceResponse?.clone().text());
  const workspace = await workspaceResponse!.json() as any;
  assert.equal(workspace.project.id, 101);
  assert.equal(workspace.restrictions.readOnly, true);
  assert.equal(workspace.project.deploymentUrl, "https://customer.example.test");
  const serialized = JSON.stringify(workspace);
  for (const secret of [
    "PRIVATE_PROJECT_DESCRIPTION",
    "PRIVATE_SOURCE_CODE",
    "PRIVATE_API_KEY",
    "PRIVATE_RAW_ERROR",
    "PRIVATE_PROMPT",
    "PRIVATE_RESPONSE",
    "PRIVATE_FILES",
    "PRIVATE_ACTIVITY",
    "PRIVATE_COMMIT_HASH",
    "deployment-secret",
  ]) assert.equal(serialized.includes(secret), false, `workspace must omit ${secret}`);
  assert.equal(state.auditActions.includes("admin_support_resource_accessed"), true);
  assert.equal(state.sessions.get(sessionId)?.access_count, 1);

  state.grants.get(grant.id)!.revoked_at_ms = Date.now();
  const revokedResponse = await handleLaunchAdminRoute({
    request: request(`/api/admin/support-sessions/${encodeURIComponent(sessionId)}`),
    env: adminEnv as any,
    url: new URL(`${origin}/api/admin/support-sessions/${encodeURIComponent(sessionId)}`),
    input: {},
  });
  assert.equal(revokedResponse?.status, 403);
});

test("support workspace has no write or file-inspection endpoints", async () => {
  const state = makeState();
  const env = makeEnv(state, "owner-1");
  const path = "/api/admin/support-sessions/session-1/files";
  const response = await handleLaunchAdminRoute({
    request: request(path),
    env: env as any,
    url: new URL(`${origin}${path}`),
    input: {},
  });
  assert.equal(response?.status, 404);
});
