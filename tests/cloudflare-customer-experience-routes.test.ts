import assert from "node:assert/strict";
import test from "node:test";
import { handleBuilderPlanningRoute } from "../cloudflare/planning-routes";
import { handleCustomerSupportTicketRoute } from "../cloudflare/support-ticket-routes";
import { handleLaunchAdminRoute } from "../cloudflare/launch-admin-routes";
import { startBuildPlanning } from "../shared/build-planning";

const origin = "https://app.buildcustom.ai";
const ownerTicketId = "00000000-0000-4000-8000-000000000001";

type TestUser = {
  id: string;
  username: string;
  email: string;
  role: string;
  plan: string;
  account_status: string;
  created_at: string;
};

type TestState = {
  users: Map<string, TestUser>;
  tickets: Array<Record<string, any>>;
  messages: Array<Record<string, any>>;
  audits: Array<Record<string, any>>;
  writes: string[];
};

class MockStatement {
  params: unknown[] = [];

  constructor(readonly sql: string, readonly state: TestState) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first() {
    const sql = this.sql;
    if (sql.includes("FROM users WHERE id=?")) return this.state.users.get(String(this.params[0])) || null;
    if (sql.includes("FROM projects WHERE id=? AND user_id=?")) {
      return { id: this.params[0] };
    }
    if (sql.includes("FROM support_tickets t") && sql.includes("WHERE t.id=? AND t.customer_user_id=?")) {
      return this.state.tickets.find((ticket) => ticket.id === this.params[0]
        && ticket.customer_user_id === this.params[1]) || null;
    }
    if (sql.includes("FROM support_tickets t") && sql.includes("WHERE t.id=?")) {
      return this.state.tickets.find((ticket) => ticket.id === this.params[0]) || null;
    }
    if (sql.includes("FROM support_access_grants")) return null;
    return null;
  }

  async all() {
    if (this.sql.includes("FROM support_ticket_messages")) {
      return {
        results: this.state.messages.filter((message) => message.ticket_id === this.params[0]),
      };
    }
    if (this.sql.includes("FROM support_tickets t") && this.sql.includes("WHERE t.customer_user_id=?")) {
      return {
        results: this.state.tickets.filter((ticket) => ticket.customer_user_id === this.params[0]),
      };
    }
    if (this.sql.includes("FROM support_tickets t") && this.sql.includes("JOIN users u")) {
      return { results: this.state.tickets };
    }
    return { results: [] };
  }

  async run() {
    this.state.writes.push(this.sql);
    return { success: true, meta: { changes: 1 } };
  }
}

function makeEnv(overrides: {
  actorId?: string | null;
  role?: string;
  tickets?: Array<Record<string, any>>;
  messages?: Array<Record<string, any>>;
} = {}) {
  const actorId = overrides.actorId === undefined ? "customer-1" : overrides.actorId;
  const accountId = actorId || "customer-1";
  const state: TestState = {
    users: new Map([
      ["customer-1", {
        id: "customer-1", username: "Customer One", email: "one@example.test",
        role: "user", plan: "free", account_status: "active", created_at: "2026-01-01",
      }],
      ["customer-2", {
        id: "customer-2", username: "Customer Two", email: "two@example.test",
        role: "user", plan: "free", account_status: "active", created_at: "2026-01-01",
      }],
      ["admin-1", {
        id: "admin-1", username: "Admin", email: "admin@example.test",
        role: "super_admin", plan: "pro", account_status: "active", created_at: "2026-01-01",
      }],
    ]),
    tickets: overrides.tickets || [{
      id: ownerTicketId,
      customer_user_id: "customer-1",
      category: "builder",
      subject: "A private test ticket",
      status: "open",
      project_id: 19,
      project_name: "Customer Project",
      customer_name: "Customer One",
      customer_email: "one@example.test",
      created_at: "2026-11-01 12:00:00",
      updated_at: "2026-11-01 12:00:00",
      last_message_at: "2026-11-01 12:00:00",
    }],
    messages: overrides.messages || [{
      id: "message-1",
      ticket_id: ownerTicketId,
      sender_user_id: "customer-1",
      sender_type: "customer",
      sender_name: "Customer One",
      body: "The builder needs help.",
      created_at: "2026-11-01 12:00:00",
    }],
    audits: [],
    writes: [],
  };
  const DB = {
    prepare(sql: string) {
      return new MockStatement(sql, state);
    },
    async batch(statements: MockStatement[]) {
      for (const statement of statements) {
        state.writes.push(statement.sql);
        if (statement.sql.includes("INSERT INTO support_tickets")) {
          const [id, customer_user_id, project_id, category, subject] = statement.params;
          state.tickets.unshift({
            id, customer_user_id, project_id, category, subject, status: "open",
            project_name: null, customer_name: "Customer One", customer_email: "one@example.test",
          });
        }
        if (statement.sql.includes("INSERT INTO support_ticket_messages")) {
          const [id, ticket_id, sender_user_id, sender_type, body] = statement.params;
          state.messages.push({ id, ticket_id, sender_user_id, sender_type, sender_name: "Customer One", body });
        }
        if (statement.sql.includes("INSERT INTO audit_events")) state.audits.push({ sql: statement.sql, params: statement.params });
      }
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  } as unknown as D1Database;
  const env: any = {
    DB,
    ENVIRONMENT: "production",
    CONTROL_PLANE_PROFILE: "launch",
    CONTROL_PLANE_ALLOWED_ORIGIN: origin,
    AUTH_RUNTIME_URL: "https://auth.example.test",
    AUTH_RUNTIME: {
      async fetch(request: Request) {
        const hasSession = Boolean(request.headers.get("Cookie")?.includes("accessToken="));
        if (!hasSession || !actorId) {
          return Response.json({ success: true, data: { authenticated: false } });
        }
        return Response.json({
          success: true,
          data: {
            authenticated: true,
            user: {
              id: accountId,
              email: accountId === "admin-1" ? "admin@example.test" : `${accountId === "customer-2" ? "two" : "one"}@example.test`,
              displayName: accountId,
              provider: "email",
              emailVerified: true,
              emailVerifiedAt: "2026-01-01T00:00:00.000Z",
            },
            sessionId: `session-${accountId}`,
          },
        });
      },
    },
  };
  if (overrides.role) {
    const user = state.users.get(accountId);
    if (user) user.role = overrides.role;
  }
  return { env, state };
}

function makeRequest(path: string, options: {
  method?: string;
  body?: unknown;
  actorId?: string | null;
  csrf?: boolean;
  requestOrigin?: string;
} = {}) {
  const headers: Record<string, string> = {
    Origin: options.requestOrigin || origin,
    "Content-Type": "application/json",
  };
  if (options.actorId !== null) headers.Cookie = "accessToken=session-token";
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

test("customer support tickets require a verified signed-in session", async () => {
  const { env } = makeEnv();
  const response = await handleCustomerSupportTicketRoute({
    env,
    request: makeRequest("/api/support/tickets", { actorId: null }),
    url: new URL(`${origin}/api/support/tickets`),
    input: {},
  });
  assert.equal(response?.status, 401);
});

test("customers can open tickets without projects and receive only safe ticket fields", async () => {
  const { env, state } = makeEnv({ tickets: [], messages: [] });
  const response = await handleCustomerSupportTicketRoute({
    env,
    request: makeRequest("/api/support/tickets", {
      method: "POST",
      csrf: true,
      body: { category: "general", subject: "Account question", body: "Please help with my account." },
    }),
    url: new URL(`${origin}/api/support/tickets`),
    input: { category: "general", subject: "Account question", body: "Please help with my account." },
    allowedOrigin: origin,
  });
  assert.equal(response?.status, 201);
  const body = await response?.json() as { ticket: Record<string, unknown>; messages: unknown[] };
  assert.equal(body.ticket.project_id, null);
  assert.equal(body.messages.length, 1);
  assert.equal(state.audits.length, 1);
  const serialized = JSON.stringify(body);
  for (const secret of ["password", "session_token", "api_key", "PRIVATE_SOURCE_CODE"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("customer tickets and replies are isolated by account and protected by CSRF and Origin", async () => {
  const { env } = makeEnv({ actorId: "customer-2" });
  const hidden = await handleCustomerSupportTicketRoute({
    env,
    request: makeRequest(`/api/support/tickets/${ownerTicketId}`, { actorId: "customer-2" }),
    url: new URL(`${origin}/api/support/tickets/${ownerTicketId}`),
    input: {},
  });
  assert.equal(hidden?.status, 404);

  const noCsrf = await handleCustomerSupportTicketRoute({
    env,
    request: makeRequest("/api/support/tickets", {
      method: "POST",
      actorId: "customer-2",
      body: { category: "general", subject: "Question", body: "A message." },
    }),
    url: new URL(`${origin}/api/support/tickets`),
    input: { category: "general", subject: "Question", body: "A message." },
    allowedOrigin: origin,
  });
  assert.equal(noCsrf?.status, 403);

  const badOrigin = await handleCustomerSupportTicketRoute({
    env,
    request: makeRequest("/api/support/tickets", {
      method: "POST",
      actorId: "customer-2",
      csrf: true,
      requestOrigin: "https://attacker.example",
      body: { category: "general", subject: "Question", body: "A message." },
    }),
    url: new URL(`${origin}/api/support/tickets`),
    input: { category: "general", subject: "Question", body: "A message." },
    allowedOrigin: origin,
  });
  assert.equal(badOrigin?.status, 403);
});

test("admin ticket APIs require super-admin authorization and never return source files", async () => {
  const customer = makeEnv({ actorId: "customer-1" });
  const customerRequest = makeRequest("/api/admin/support/tickets", { actorId: "customer-1" });
  const deniedCustomer = await handleLaunchAdminRoute({
    request: customerRequest,
    env: customer.env,
    url: new URL(customerRequest.url),
    input: {},
  });
  assert.equal(deniedCustomer?.status, 403);

  const anonymous = makeEnv({ actorId: null });
  const anonymousRequest = makeRequest("/api/admin/support/tickets", { actorId: null });
  const deniedAnonymous = await handleLaunchAdminRoute({
    request: anonymousRequest,
    env: anonymous.env,
    url: new URL(anonymousRequest.url),
    input: {},
  });
  assert.equal(deniedAnonymous?.status, 401);

  const admin = makeEnv({ actorId: "admin-1" });
  const adminRequest = makeRequest("/api/admin/support/tickets", { actorId: "admin-1" });
  const allowed = await handleLaunchAdminRoute({
    request: adminRequest,
    env: admin.env,
    url: new URL(adminRequest.url),
    input: {},
  });
  assert.equal(allowed?.status, 200);
  const body = await allowed?.json() as { tickets: Array<Record<string, unknown>> };
  assert.equal(body.tickets[0].id, ownerTicketId);
  const serialized = JSON.stringify(body);
  for (const secret of ["password", "session_token", "api_key", "source_code", "source_files"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("planning sessions are project-bound, CSRF-protected, and validated", async () => {
  const state = startBuildPlanning("Build a lead generation app", false, 100);
  assert.equal(state.kind, "planning");
  if (state.kind !== "planning") return;

  let savedState: string | null = null;
  const DB: any = {
    prepare(sql: string) {
      let params: unknown[] = [];
      return {
        bind(...values: unknown[]) { params = values; return this; },
        async first() {
          if (sql.includes("SELECT state_json")) {
            return savedState ? { state_json: savedState, updated_at: "2026-11-01 12:00:00" } : null;
          }
          return null;
        },
        async run() {
          if (sql.includes("INSERT INTO builder_planning_sessions")) savedState = String(params[2]);
          if (sql.includes("DELETE FROM builder_planning_sessions")) savedState = null;
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
  };
  const user = {
    id: "customer-1", username: "Customer One", email: "one@example.test",
    role: "user", plan: "free", created_at: "2026-01-01", account_status: "active",
  };
  const url = new URL(`${origin}/api/projects/19/planning`);
  const putRequest = makeRequest("/api/projects/19/planning", { method: "PUT", csrf: true, body: { session: state.session } });
  const noCsrf = await handleBuilderPlanningRoute({
    env: { DB } as any,
    request: makeRequest("/api/projects/19/planning", { method: "PUT", body: { session: state.session } }),
    url,
    input: { session: state.session },
    user,
    projectId: 19,
    allowedOrigin: origin,
  });
  assert.equal(noCsrf?.status, 403);

  const wrongOwner = await handleBuilderPlanningRoute({
    env: { DB } as any,
    request: putRequest,
    url,
    input: { session: state.session },
    user,
    projectId: null,
    allowedOrigin: origin,
  });
  assert.equal(wrongOwner?.status, 404);

  const saved = await handleBuilderPlanningRoute({
    env: { DB } as any,
    request: putRequest,
    url,
    input: { session: state.session },
    user,
    projectId: 19,
    allowedOrigin: origin,
  });
  assert.equal(saved?.status, 200);
  const loaded = await handleBuilderPlanningRoute({
    env: { DB } as any,
    request: makeRequest("/api/projects/19/planning"),
    url,
    input: {},
    user,
    projectId: 19,
    allowedOrigin: origin,
  });
  assert.equal(loaded?.status, 200);
  const loadedBody = await loaded?.json() as { session: { currentQuestion: { id: string } } };
  assert.equal(loadedBody.session.currentQuestion.id, "audience");
});
