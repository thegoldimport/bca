import assert from "node:assert/strict";
import test from "node:test";
import { handleLaunchAdminRoute } from "../cloudflare/launch-admin-routes";
import worker from "../cloudflare/worker";

const appOrigin = "https://app.buildcustom.ai";
const launchRuntimeUrl = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const ownerEmail = "support@buildcustom.ai";

type TestUser = {
  id: string;
  email: string;
  username: string;
  role: string;
  plan: string;
  created_at: string;
  account_status: "active" | "suspended";
};

function makeDb(options: {
  actor: TestUser;
  users?: TestUser[];
  customers?: Record<string, unknown>[];
  projects?: Record<string, unknown>[];
  adminProjects?: Record<string, unknown>[];
  deployments?: Record<string, unknown>[];
}): { DB: any; state: { users: TestUser[]; statements: string[]; auditEvents: string[] } } {
  const state = {
    users: [options.actor, ...(options.users || [])],
    statements: [] as string[],
    auditEvents: [] as string[],
  };
  const db = {
    async batch(items: Array<{ run: () => Promise<unknown> }>) {
      const results = [];
      for (const item of items) results.push(await item.run());
      return results;
    },
    prepare(sql: string) {
      state.statements.push(sql);
      let values: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) {
          values = args;
          return statement;
        },
        async first() {
          if (sql.includes("SELECT id,COALESCE(profile_name,display_name,username) AS username,email,role,plan,created_at,account_status FROM users WHERE id=?")
            || sql.includes("SELECT id,display_name AS username,email,role,plan,created_at,account_status FROM users WHERE id=?")) {
            const user = state.users.find((row) => row.id === values[0]);
            return user ? { ...user, display_name: user.username } : null;
          }
          if (sql.includes("SELECT COUNT(*) AS count FROM users WHERE role='super_admin'")) {
            return { count: state.users.filter((row) => row.role === "super_admin").length };
          }
          if (sql.includes("SELECT id,role,email FROM users WHERE id=?")
            || sql.includes("SELECT id,role FROM users WHERE id=?")) {
            const user = state.users.find((row) => row.id === values[0]);
            return user ? { id: user.id, role: user.role, email: user.email } : null;
          }
          if (sql.includes("SELECT id FROM users WHERE id=? AND role='user'")) {
            const user = state.users.find((row) => row.id === values[0] && row.role === "user");
            return user ? { id: user.id } : null;
          }
          if (sql.includes("SELECT 1 AS ok")) return { ok: 1 };
          return null;
        },
        async all() {
          if (sql.includes("SELECT u.id,COALESCE(u.display_name,u.username) AS name")) {
            return { results: options.customers || [] };
          }
          if (sql.includes("COALESCE(u.display_name,u.username) AS owner_name")) {
            return { results: options.adminProjects || [] };
          }
          if (sql.includes("SELECT id,name,type,status,framework,created_at,updated_at")) {
            return { results: options.projects || [] };
          }
          if (sql.includes("SELECT p.id,p.name,p.type,p.status,p.updated_at")) {
            const deployments = options.deployments || [];
            return {
              results: sql.includes("AND p.id=?")
                ? deployments.filter((row) => Number(row.id) === Number(values[0]))
                : deployments,
            };
          }
          return { results: [] };
        },
        async run() {
          if (/^\s*INSERT INTO users/i.test(sql)) {
            const id = String(values[0]);
            const email = String(values[2]);
            if (!state.users.some((row) => row.id === id)) {
              state.users.push({
                id,
                email,
                username: String(values[3] || email),
                role: "user",
                plan: "free",
                created_at: "2026-01-01 00:00:00",
                account_status: "active",
              });
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("UPDATE users SET role='super_admin'")) {
            const user = state.users.find((row) => row.id === values[0] && row.email === values[1]
              && row.role === "user" && row.account_status === "active");
            if (user && !state.users.some((row) => row.role === "super_admin")) {
              user.role = "super_admin";
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (sql.includes("UPDATE users SET account_status=?")) {
            const user = state.users.find((row) => row.id === values[1] && row.role === "user");
            if (user) user.account_status = values[0] as "active" | "suspended";
            return { success: true, meta: { changes: user ? 1 : 0 } };
          }
          if (sql.includes("INSERT INTO audit_events")) {
            state.auditEvents.push(String(values[1]));
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
  return { DB: db, state };
}

function makeEnv(options: {
  actor: TestUser;
  users?: TestUser[];
  customers?: Record<string, unknown>[];
  projects?: Record<string, unknown>[];
  adminProjects?: Record<string, unknown>[];
  deployments?: Record<string, unknown>[];
  identities?: { provider: string; email: string; emailVerified: boolean }[];
}) {
  const { DB, state } = makeDb(options);
  const env = {
    DB,
    ASSETS: { fetch: async () => new Response("asset", { status: 404 }) },
    STAGING_ROUTES: {},
    ENVIRONMENT: "production",
    CONTROL_PLANE_PROFILE: "launch",
    STAGING_RUNTIME_URL: launchRuntimeUrl,
    VIBESDK_RUNTIME_URL: launchRuntimeUrl,
    VIBESDK_RUNTIME: {},
    AUTH_RUNTIME_URL: launchRuntimeUrl,
    AUTH_RUNTIME: {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        if (path === "/api/auth/check") {
          const authenticated = Boolean(request.headers.get("Cookie"));
          return Response.json({
            success: true,
            data: {
              authenticated,
              user: authenticated ? {
                id: options.actor.id,
                email: options.actor.email,
                displayName: options.actor.username,
                provider: "email",
                // This field is deliberately not trusted for owner verification.
                emailVerified: true,
                emailVerifiedAt: "2026-11-03T12:00:00.000Z",
              } : null,
              ...(authenticated ? { sessionId: "test-session" } : {}),
            },
          });
        }
        if (path === "/api/auth/identities") {
          return Response.json({ success: true, data: { identities: options.identities || [] } });
        }
        return Response.json({ success: false }, { status: 404 });
      },
    },
    STAGING_ROUTE_KV_ID: "248ac5b6821a475794a7fe3d2b0c3718",
    CONTROL_PLANE_ROUTE_KV_ID: "248ac5b6821a475794a7fe3d2b0c3718",
    STAGING_DISPATCH_NAMESPACE: "buildcustom-vibesdk-launch-dispatch",
    CONTROL_PLANE_DISPATCH_NAMESPACE: "buildcustom-vibesdk-launch-dispatch",
    STAGING_MANAGED_GATEWAY_URL: "https://buildcustom-apps-gateway-launch.thegoldimport.workers.dev/p",
    STAGING_GATEWAY: {},
    STAGING_LOGIN_ENABLED: "true",
    STAGING_REGISTRATION_ENABLED: "true",
    PUBLIC_GENERATED_APPS_ENABLED: "false",
    CONTROL_PLANE_ALLOWED_ORIGIN: appOrigin,
    STAGING_ALLOWED_ORIGIN: appOrigin,
    CONTROL_PLANE_CANARY_ORIGIN: "https://buildcustom-control-plane-launch.thegoldimport.workers.dev",
    RUNTIME_OPERATIONS_ENABLED: "true",
  };
  return { env, state };
}

function makeRequest(
  path: string,
  options: { method?: string; body?: unknown; authenticated?: boolean; csrf?: boolean } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: appOrigin };
  if (options.authenticated !== false) headers.Cookie = "accessToken=session-token";
  if (options.csrf) {
    headers.Cookie = `${headers.Cookie ? `${headers.Cookie}; ` : ""}csrf-token=csrf-value`;
    headers["X-CSRF-Token"] = "csrf-value";
  }
  return new Request(`${appOrigin}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function route(
  env: any,
  request: Request,
) {
  return handleLaunchAdminRoute({
    request,
    env,
    url: new URL(request.url),
    input: request.method === "GET" ? {} : await request.json() as Record<string, unknown>,
  });
}

function testUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: "customer-1",
    email: "customer@example.test",
    username: "Customer One",
    role: "user",
    plan: "free",
    created_at: "2026-02-01 10:00:00",
    account_status: "active",
    ...overrides,
  };
}

test("anonymous visitors cannot read launch admin data", async () => {
  const { env, state } = makeEnv({ actor: testUser() });
  const response = await route(env, makeRequest("/api/admin/overview", { authenticated: false }));
  assert.equal(response?.status, 401);
  assert.equal(state.statements.some((sql) => sql.includes("FROM projects")), false);
});

test("regular customers cannot access launch admin data", async () => {
  const { env } = makeEnv({ actor: testUser() });
  const response = await route(env, makeRequest("/api/admin/customers"));
  assert.equal(response?.status, 403);
  assert.deepEqual(await response?.json(), { message: "Admin access required." });
  assert.equal((await route(env, makeRequest("/api/admin/projects")))?.status, 403);
});

test("admin health reports actual D1 and runtime connectivity checks", async () => {
  const { env } = makeEnv({ actor: testUser({ id: "admin-1", role: "super_admin" }) });
  const response = await route(env, makeRequest("/api/admin/health"));
  assert.equal(response?.status, 200);
  const health = await response?.json() as { database: string; runtime: string };
  assert.equal(health.database, "available");
  assert.equal(health.runtime, "available");
});

test("production launch Worker routes admin requests to the launch admin API", async () => {
  const { env } = makeEnv({
    actor: testUser({ id: "admin-1", email: "admin@example.test", role: "super_admin" }),
  });
  const response = await worker.fetch(
    new Request(`${appOrigin}/api/admin/overview`, {
      headers: { Cookie: "accessToken=session-token" },
    }),
    env as never,
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { stats: { customers: number }; billing: { configured: boolean } };
  assert.equal(body.stats.customers, 0);
  assert.equal(body.billing.configured, false);
});

test("suspended customers cannot access launch product APIs", async () => {
  const { env } = makeEnv({
    actor: testUser({ account_status: "suspended" }),
  });
  const response = await worker.fetch(
    new Request(`${appOrigin}/api/projects`, {
      headers: { Cookie: "accessToken=session-token" },
    }),
    env as never,
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: "Account access is suspended." });
});

test("authorized admins receive real customer and project metadata without sensitive fields", async () => {
  const admin = testUser({ id: "admin-1", email: "owner@example.test", role: "super_admin" });
  const { env, state } = makeEnv({
    actor: admin,
    users: [testUser({ id: "customer-2", email: "two@example.test", username: "Customer Two" })],
    customers: [{
      id: "customer-2",
      name: "Customer Two",
      email: "two@example.test",
      plan: "free",
      role: "user",
      account_status: "active",
      created_at: "2026-03-01 09:00:00",
      project_count: 1,
      operation_count: 4,
      builder_turn_count: 2,
      password_hash: "must-not-return",
      session_token: "must-not-return",
      source_files: "must-not-return",
    }],
    projects: [{
      id: 12,
      name: "Customer site",
      type: "website",
      status: "draft",
      framework: "React",
      created_at: "2026-03-02 09:00:00",
      updated_at: "2026-03-02 10:00:00",
      agent_id: "must-not-return",
      source_files: "must-not-return",
      api_key: "must-not-return",
    }],
  });

  const customersResponse = await route(env, makeRequest("/api/admin/customers"));
  assert.equal(customersResponse?.status, 200);
  const customersBody = await customersResponse?.json() as { customers: Record<string, unknown>[] };
  assert.equal(customersBody.customers[0].email, "two@example.test");
  assert.equal(customersBody.customers[0].projectCount, 1);
  assert.equal(customersBody.customers[0].operationCount, 4);
  assert.equal(customersBody.customers[0].builderTurnCount, 2);
  assert.equal(customersBody.customers[0].creditsTracked, false);
  assert.deepEqual(Object.keys(customersBody.customers[0]).sort(), [
    "accountStatus", "builderTurnCount", "createdAt", "creditsTracked", "email", "id",
    "name", "operationCount", "plan", "projectCount", "role",
  ].sort());

  const projectsResponse = await route(
    env,
    makeRequest("/api/admin/customers/customer-2/projects"),
  );
  assert.equal(projectsResponse?.status, 200);
  const projectsBody = await projectsResponse?.json() as { projects: Record<string, unknown>[] };
  assert.deepEqual(projectsBody.projects[0], {
    id: 12,
    name: "Customer site",
    type: "website",
    status: "draft",
    framework: "React",
    created_at: "2026-03-02 09:00:00",
    updated_at: "2026-03-02 10:00:00",
  });
  assert.equal(state.statements.some((sql) => /\b(password|session_token|api_key|source_files)\b/i.test(sql)), false);
});

test("anonymous visitors cannot read the all-projects admin endpoint", async () => {
  const { env } = makeEnv({ actor: testUser() });
  const response = await route(env, makeRequest("/api/admin/projects", { authenticated: false }));
  assert.equal(response?.status, 401);
});

test("authorized admins receive only safe metadata from all customer projects", async () => {
  const { env, state } = makeEnv({
    actor: testUser({ id: "admin-1", role: "super_admin" }),
    adminProjects: [{
      id: 31,
      name: "Customer project",
      type: "website",
      status: "published",
      framework: "React",
      created_at: "2026-05-10 09:00:00",
      updated_at: "2026-05-11 10:00:00",
      owner_name: "Customer One",
      owner_email: "customer@example.test",
      user_id: "customer-2",
      hosting_provider: "cloudflare",
      subdomain_slug: "customer-project",
      deployment_url: "https://apps.example.test/customer-project?private=must-not-return",
      password: "must-not-return",
      session_token: "must-not-return",
      api_key: "must-not-return",
      source_files: "must-not-return",
    }],
  });
  env.PUBLIC_GENERATED_APPS_ENABLED = "true";
  const response = await route(env, makeRequest("/api/admin/projects"));
  assert.equal(response?.status, 200);
  const body = await response?.json() as { projects: Record<string, unknown>[] };
  assert.deepEqual(body.projects[0], {
    id: 31,
    name: "Customer project",
    type: "website",
    status: "published",
    framework: "React",
    createdAt: "2026-05-10 09:00:00",
    updatedAt: "2026-05-11 10:00:00",
    ownerId: "customer-2",
    ownerName: "Customer One",
    ownerEmail: "customer@example.test",
    deploymentStatus: "Deployment record exists",
    hostingProvider: "cloudflare",
    publishedUrl: "https://customer-project.apps.buildcustom.ai/",
    gatewayDiagnosticUrl: "https://apps.example.test/customer-project",
    subdomainSlug: "customer-project",
    customDomains: [],
  });
  assert.equal(JSON.stringify(body).includes("must-not-return"), false);
  assert.equal(state.statements.some((sql) => /\b(password|session_token|api_key|source_files)\b/i.test(sql)), false);
});

test("admin deployment diagnostics can be filtered to one project", async () => {
  const { env } = makeEnv({
    actor: testUser({ id: "admin-1", role: "super_admin" }),
    deployments: [
      {
        id: 31,
        name: "Project One",
        type: "website",
        status: "published",
        updated_at: "2026-05-11 10:00:00",
        owner_name: "Customer One",
        owner_email: "one@example.test",
        hosting_provider: "cloudflare",
        subdomain_slug: "project-one",
        deployment_url: "https://one.example.test",
      },
      {
        id: 32,
        name: "Project Two",
        type: "website",
        status: "published",
        updated_at: "2026-05-12 10:00:00",
        owner_name: "Customer Two",
        owner_email: "two@example.test",
        hosting_provider: "cloudflare",
        deployment_url: "https://two.example.test",
      },
    ],
  });
  env.PUBLIC_GENERATED_APPS_ENABLED = "true";
  const response = await route(env, makeRequest("/api/admin/deployments?projectId=31"));
  assert.equal(response?.status, 200);
  const body = await response?.json() as { deployments: Record<string, unknown>[] };
  assert.deepEqual(body.deployments.map((deployment) => deployment.projectId), [31]);
  assert.equal(body.deployments[0].deploymentUrl, "https://project-one.apps.buildcustom.ai/");
  assert.equal(body.deployments[0].gatewayDiagnosticUrl, "https://one.example.test/");
});

test("email/password signup flag alone cannot authorize owner bootstrap", async () => {
  const { env, state } = makeEnv({ actor: testUser({ id: "owner-1", email: ownerEmail }) });
  const statusResponse = await route(env, makeRequest("/api/admin/owner-bootstrap"));
  assert.equal(statusResponse?.status, 200);
  const status = await statusResponse?.json() as { emailOwnershipVerified: boolean; eligible: boolean };
  assert.equal(status.emailOwnershipVerified, false);
  assert.equal(status.eligible, false);
  assert.equal(statusResponse?.headers.get("Cache-Control"), "no-store");

  const bootstrapResponse = await route(env, makeRequest("/api/admin/owner-bootstrap", {
    method: "POST",
    body: { confirmEmail: ownerEmail },
    csrf: true,
  }));
  assert.equal(bootstrapResponse?.status, 403);
  assert.equal(state.users[0].role, "user");
});

test("a provider identity and client-supplied value cannot replace server operator authorization", async () => {
  const { env, state } = makeEnv({
    actor: testUser({ id: "owner-1", email: ownerEmail }),
    identities: [{ provider: "google", email: ownerEmail, emailVerified: true }],
  });
  const missingConfirmation = await route(env, makeRequest("/api/admin/owner-bootstrap", {
    method: "POST",
    body: { confirmEmail: "wrong@example.test" },
    csrf: true,
  }));
  assert.equal(missingConfirmation?.status, 400);
  assert.equal(state.users[0].role, "user");

  const response = await route(env, makeRequest("/api/admin/owner-bootstrap", {
    method: "POST",
    body: { confirmEmail: ownerEmail, ownerSecret: "x".repeat(64) },
    csrf: true,
  }));
  assert.equal(response?.status, 403);
  assert.equal(state.users[0].role, "user");
});

test("a different verified identity cannot hijack the owner bootstrap", async () => {
  const { env, state } = makeEnv({
    actor: testUser({ id: "owner-1", email: ownerEmail }),
    identities: [{ provider: "google", email: "attacker@example.test", emailVerified: true }],
  });
  const response = await route(env, makeRequest("/api/admin/owner-bootstrap", {
    method: "POST",
    body: { confirmEmail: ownerEmail },
    csrf: true,
  }));
  assert.equal(response?.status, 403);
  assert.equal(state.users[0].role, "user");
});

test("a provider without an explicit verified-email claim cannot authorize owner bootstrap", async () => {
  const { env, state } = makeEnv({
    actor: testUser({ id: "owner-1", email: ownerEmail }),
    identities: [{ provider: "cloudflare", email: ownerEmail, emailVerified: true }],
  });
  const response = await route(env, makeRequest("/api/admin/owner-bootstrap", {
    method: "POST",
    body: { confirmEmail: ownerEmail },
    csrf: true,
  }));
  assert.equal(response?.status, 403);
  assert.equal(state.users[0].role, "user");
});

test("customer status changes require an admin session and valid CSRF token", async () => {
  const admin = testUser({ id: "admin-1", email: "admin@example.test", role: "super_admin" });
  const customer = testUser({ id: "customer-2", email: "two@example.test" });
  const { env, state } = makeEnv({ actor: admin, users: [customer] });

  const noCsrf = await route(env, makeRequest("/api/admin/customers/customer-2/status", {
    method: "PATCH",
    body: { accountStatus: "suspended" },
  }));
  assert.equal(noCsrf?.status, 403);
  assert.equal(customer.account_status, "active");

  const response = await route(env, makeRequest("/api/admin/customers/customer-2/status", {
    method: "PATCH",
    body: { accountStatus: "suspended" },
    csrf: true,
  }));
  assert.equal(response?.status, 200);
  assert.equal(customer.account_status, "suspended");
  assert.ok(state.auditEvents.includes("admin_account_status_changed"));
});

test("owner bootstrap cannot run without CSRF or after another owner exists", async () => {
  const existingOwner = testUser({ id: "existing-owner", role: "super_admin" });
  const candidate = testUser({ id: "owner-1", email: ownerEmail });
  const { env, state } = makeEnv({
    actor: candidate,
    users: [existingOwner],
    identities: [{ provider: "google", email: ownerEmail, emailVerified: true }],
  });
  env.OWNER_BOOTSTRAP_SECRET = "x".repeat(64);
  const noCsrf = await route(env, makeRequest("/api/admin/owner-bootstrap", {
    method: "POST",
    body: { confirmEmail: ownerEmail },
  }));
  assert.equal(noCsrf?.status, 403);
  assert.equal(candidate.role, "user");

  const alreadyInitialized = await route(env, makeRequest("/api/admin/owner-bootstrap", {
    method: "POST",
    body: { confirmEmail: ownerEmail },
    csrf: true,
  }));
  assert.equal(alreadyInitialized?.status, 409);
  assert.equal(candidate.role, "user");
  assert.equal(state.users.filter((user) => user.role === "super_admin").length, 1);
});
