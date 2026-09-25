import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { type Env } from "../cloudflare/worker";

const origin = "https://buildcustom-control-plane-staging.thegoldimport.workers.dev";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/d1/0001_control_plane.sql", "utf8"));
  sqlite.exec("INSERT INTO users(id,username,email,password) VALUES('legacy','Legacy','legacy@example.test','existing-hash')");
  sqlite.exec("INSERT INTO projects(id,user_id,name) VALUES(1,'legacy','Existing project')");
  sqlite.exec("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('legacy-session','legacy','2030-01-01')");
  sqlite.exec(readFileSync("migrations/d1/0002_staging_runtime_identity.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/d1/0003_staging_think_project_links.sql", "utf8"));
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async first<T>() { return (sqlite.prepare(sql).get(...args as string[]) as T | undefined) || null; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...args as string[]) as T[] }; },
        async run() {
          const result = sqlite.prepare(sql).run(...args as string[]);
          return { meta: { last_row_id: Number(result.lastInsertRowid), changes: result.changes } };
        },
      };
    },
  } as unknown as D1Database;
  return { sqlite, db };
}

type Account = { id: string; email: string; name: string; password: string };
function runtime(options: { silentLogout?: boolean } = {}) {
  const accounts = new Map<string, Account>();
  const sessions = new Map<string, { account: Account; id: string }>();
  const calls: string[] = [];
  const agents = new Map<string, { owner: string; originalPrompt: string }>();
  const failures = { nextCreateStatus: 0, loseNextResponse: false, nextStreamError: false };
  let nextAgent = 0;
  let nextUser = 0;
  let nextSession = 0;
  const fetcher = {
    async fetch(request: Request) {
      const path = new URL(request.url).pathname;
      calls.push(path);
      const cookie = request.headers.get("Cookie") || "";
      const token = cookie.match(/(?:^|;\s*)accessToken=([^;]+)/)?.[1];
      const session = token ? sessions.get(token) : null;
      if (path === "/api/agent" && request.method === "POST") {
        if (!session) return Response.json({ success: false }, { status: 401 });
        if (failures.nextCreateStatus) {
          const status = failures.nextCreateStatus;
          failures.nextCreateStatus = 0;
          return Response.json({ success: false, error: "unavailable" }, { status });
        }
        const body = await request.json() as { query: string; behaviorType: string };
        assert.equal(body.behaviorType, "think");
        assert.match(body.query, /^BuildCustom project \d+ \[bc-project:\d+\]$/);
        const agentId = `agent-${++nextAgent}`;
        agents.set(agentId, { owner: session.account.id, originalPrompt: body.query });
        if (failures.loseNextResponse) {
          failures.loseNextResponse = false;
          throw new Error("response lost after stock creation");
        }
        const streamError = failures.nextStreamError;
        failures.nextStreamError = false;
        return new Response(JSON.stringify({ agentId, behaviorType: "think" }) + "\n" +
          (streamError ? JSON.stringify({ error: { message: "init failed" } }) + "\n" : ""), {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (path === "/api/apps") {
        if (!session) return Response.json({ success: false }, { status: 401 });
        return Response.json({ success: true, data: { apps: [...agents].filter(([, agent]) =>
          agent.owner === session.account.id).map(([id, agent]) => ({ id, originalPrompt: agent.originalPrompt })) } });
      }
      if (/^\/api\/agent\/[a-zA-Z0-9_-]+\/connect$/.test(path)) {
        const agentId = path.split("/")[3];
        const agent = agents.get(agentId);
        if (!session) return Response.json({ success: false }, { status: 401 });
        if (!agent) return Response.json({ success: false }, { status: 404 });
        if (agent.owner !== session.account.id) return Response.json({ success: false }, { status: 403 });
        return Response.json({ success: true, data: { agentId, websocketUrl: `wss://example.test/${agentId}` } });
      }
      if (path === "/api/auth/csrf-token") {
        return new Response(JSON.stringify({ success: true, data: { token: "csrf-value" } }), {
          headers: { "Set-Cookie": "csrf-token=csrf-cookie; Path=/; Secure; HttpOnly; SameSite=Strict" },
        });
      }
      if (path === "/api/auth/check") {
        return Response.json({ success: true, data: session
          ? { authenticated: true, user: { id: session.account.id, email: session.account.email, displayName: session.account.name }, sessionId: session.id }
          : { authenticated: false, user: null } });
      }
      if (path === "/api/auth/register" || path === "/api/auth/login") {
        if (request.headers.get("X-CSRF-Token") !== "csrf-value" || !cookie.includes("csrf-token=csrf-cookie")) {
          return Response.json({ success: false }, { status: 403 });
        }
        const body = await request.json() as { email: string; password: string; name?: string };
        let account = accounts.get(body.email);
        if (path.endsWith("register")) {
          if (account) return Response.json({ success: false }, { status: 409 });
          account = { id: `runtime-user-${++nextUser}`, email: body.email, name: body.name!, password: body.password };
          accounts.set(body.email, account);
        } else if (!account || account.password !== body.password) {
          return Response.json({ success: false }, { status: 401 });
        }
        const issuedToken = `runtime-token-${++nextSession}`;
        const issuedId = `runtime-session-${nextSession}`;
        sessions.set(issuedToken, { account: account!, id: issuedId });
        const headers = new Headers();
        headers.append("Set-Cookie", `accessToken=${issuedToken}; Path=/; Secure; HttpOnly; SameSite=Lax`);
        headers.append("Set-Cookie", "csrf-token=rotated; Path=/; Secure; HttpOnly; SameSite=Strict");
        return Response.json({ success: true, data: { user: account, sessionId: issuedId } }, { headers });
      }
      if (path === "/api/auth/logout") {
        if (request.headers.get("X-CSRF-Token") !== "csrf-value") return Response.json({ success: false }, { status: 403 });
        const verifiedId = cookie.match(/(?:^|;\s*)sessionId=([^;]+)/)?.[1];
        if (!session || verifiedId !== session.id) return Response.json({ success: false }, { status: 401 });
        if (!options.silentLogout) sessions.delete(token!);
        return Response.json({ success: true });
      }
      if (path.startsWith("/api/auth/sessions/") && request.method === "DELETE") {
        if (!session || request.headers.get("X-CSRF-Token") !== "csrf-value"
          || path.split("/").pop() !== session.id) return Response.json({ success: false }, { status: 403 });
        sessions.delete(token!);
        return Response.json({ success: true });
      }
      return new Response("Unexpected runtime call", { status: 500 });
    },
  };
  return { fetcher: fetcher as Fetcher, calls, agents, failures };
}

function browser(env: Env) {
  const jar = new Map<string, string>();
  const send = async (path: string, method = "GET", body?: Record<string, unknown>, headers: Record<string, string> = {}) => {
    const request = new Request(`${origin}${path}`, {
      method,
      headers: {
        ...(jar.size ? { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
        ...(method !== "GET" ? { Origin: origin, "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const response = await worker.fetch(request, env);
    for (const setCookie of response.headers.getSetCookie()) {
      const [name, value] = setCookie.split(";")[0].split("=");
      if (setCookie.includes("Max-Age=0")) jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  };
  const auth = async (path: string, body: Record<string, unknown>) => {
    const csrf = await send("/api/auth/csrf-token");
    assert.equal(csrf.status, 200);
    const { token } = await csrf.json() as { token: string };
    return send(path, "POST", body, { "X-CSRF-Token": token });
  };
  const create = async (body: Record<string, unknown>, key = crypto.randomUUID()) => {
    const csrf = await send("/api/auth/csrf-token");
    const { token } = await csrf.json() as { token: string };
    return send("/api/projects", "POST", body, { "X-CSRF-Token": token, "Idempotency-Key": key });
  };
  const initialize = async (id: number) => {
    const csrf = await send("/api/auth/csrf-token");
    const { token } = await csrf.json() as { token: string };
    return send(`/api/projects/${id}/runtime/initialize`, "POST", {}, { "X-CSRF-Token": token });
  };
  return { send, auth, create, initialize, jar };
}

test("staging D1 migration retains legacy user, project and session without a password for new product users", () => {
  const { sqlite } = database();
  assert.equal(sqlite.prepare("SELECT legacy_password_hash FROM users WHERE id='legacy'").get()?.legacy_password_hash, "existing-hash");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM projects").get()?.n, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sessions").get()?.n, 1);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(sqlite.prepare("PRAGMA table_info(users)").all().some((column: any) => column.name === "password"), false);
  sqlite.close();
});

test("two runtime users have one verified session each and isolated BuildCustom projects", async () => {
  const { sqlite, db } = database();
  const stock = runtime({ silentLogout: true });
  const env = {
    DB: db,
    ENVIRONMENT: "staging",
    AUTH_RUNTIME: stock.fetcher,
    AUTH_RUNTIME_URL: "https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev",
    STAGING_RUNTIME_URL: "https://buildcustom-vibesdk-migration-staging.thegoldimport.workers.dev",
    STAGING_ROUTE_KV_ID: "e5e119fa2abc4c26a8c027e0d8a8d82c",
    STAGING_DISPATCH_NAMESPACE: "buildcustom-vibesdk-migration-staging",
    STAGING_ALLOWED_ORIGIN: origin,
    STAGING_REGISTRATION_ENABLED: "true",
    STAGING_LOGIN_ENABLED: "true",
    RUNTIME_OPERATIONS_ENABLED: "false",
  } as Env;
  const a = browser(env), b = browser(env), anonymous = browser(env);

  assert.equal((await anonymous.send("/api/projects")).status, 401);
  assert.equal((await anonymous.send("/api/projects/1")).status, 401);
  assert.equal((await anonymous.send("/api/projects", "POST", { name: "Unauthorized" })).status, 401);
  assert.equal((await anonymous.send("/api/projects/1/runtime/files")).status, 401);

  const aSignup = await a.auth("/api/auth/register", { name: "User A", email: "a@example.test", password: "Str0ng!PasswordA" });
  assert.equal(aSignup.status, 200);
  const aSignupBody = await aSignup.text();
  assert.doesNotMatch(aSignupBody, /sessionId|accessToken|password|api.?key/i);
  assert.equal((await b.auth("/api/auth/register", { name: "User B", email: "b@example.test", password: "Str0ng!PasswordB" })).status, 200);
  const aMe = await (await a.send("/api/auth/me")).json() as { id: string };
  const bMe = await (await b.send("/api/auth/me")).json() as { id: string };
  assert.notEqual(aMe.id, bMe.id);
  assert.equal(sqlite.prepare("SELECT legacy_password_hash FROM users WHERE id=?").get(aMe.id)?.legacy_password_hash, null);
  assert.equal(a.jar.has("__Host-bc_session"), false);

  const aKey = crypto.randomUUID(), bKey = crypto.randomUUID();
  const projectAResponse = await a.create({ name: "Project A", userId: bMe.id }, aKey);
  const projectBResponse = await b.create({ name: "Project B", userId: aMe.id }, bKey);
  assert.equal(projectAResponse.status, 201);
  assert.equal(projectBResponse.status, 201);
  const projectA = await projectAResponse.json() as { id: number; userId: string; agentId: string; runtimeStatus: string };
  const projectB = await projectBResponse.json() as { id: number; userId: string; agentId: string; runtimeStatus: string };
  assert.equal(projectA.userId, aMe.id);
  assert.equal(projectB.userId, bMe.id);
  assert.equal(projectA.runtimeStatus, "ready");
  assert.equal(projectB.runtimeStatus, "ready");
  assert.notEqual(projectA.agentId, projectB.agentId);
  assert.equal(stock.agents.get(projectA.agentId)?.owner, aMe.id);
  assert.equal(stock.agents.get(projectB.agentId)?.owner, bMe.id);
  assert.equal(sqlite.prepare("SELECT agent_id,runtime_provider FROM runtime_project_links WHERE project_id=?").get(projectA.id)?.agent_id, projectA.agentId);
  assert.equal(sqlite.prepare("SELECT runtime_provider FROM runtime_project_links WHERE project_id=?").get(projectB.id)?.runtime_provider, "stock-think");
  assert.equal((await a.create({ name: "Different name on retry" }, aKey)).status, 200);
  const retry = await (await a.create({ name: "Project A" }, aKey)).json() as { id: number; agentId: string };
  assert.equal(retry.id, projectA.id);
  assert.equal(retry.agentId, projectA.agentId);
  assert.equal(stock.agents.size, 2);
  assert.deepEqual((await (await a.send("/api/projects")).json() as any[]).map((p) => p.id), [projectA.id]);
  assert.deepEqual((await (await b.send("/api/projects")).json() as any[]).map((p) => p.id), [projectB.id]);
  assert.equal((await a.send(`/api/projects/${projectB.id}`)).status, 404);
  assert.equal((await b.send(`/api/projects/${projectA.id}`)).status, 404);
  assert.equal((await a.send(`/api/projects/${projectB.id}/runtime/agent/${projectB.agentId}`)).status, 404);
  assert.equal((await b.send(`/api/projects/${projectA.id}/runtime/agent/${projectA.agentId}`)).status, 404);
  assert.equal((await a.send(`/api/projects/${projectA.id}/runtime/agent/${projectB.agentId}`)).status, 404);
  assert.equal((await b.send(`/api/projects/${projectB.id}/runtime/agent/${projectA.agentId}`)).status, 404);
  const stockRequest = (browserJar: Map<string, string>, agentId: string) => stock.fetcher.fetch(new Request(
    `https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev/api/agent/${agentId}/connect`,
    { headers: { Cookie: [...browserJar].map(([k, v]) => `${k}=${v}`).join("; ") } },
  ));
  assert.equal((await stockRequest(a.jar, projectA.agentId)).status, 200);
  assert.equal((await stockRequest(b.jar, projectB.agentId)).status, 200);
  assert.equal((await stockRequest(a.jar, projectB.agentId)).status, 403);
  assert.equal((await stockRequest(b.jar, projectA.agentId)).status, 403);
  assert.equal((await a.send(`/api/projects/${projectA.id}`)).status, 200);
  assert.equal((await b.send(`/api/projects/${projectB.id}`)).status, 200);
  const reloadA = browser(env), reloadB = browser(env);
  for (const [key, value] of a.jar) reloadA.jar.set(key, value);
  for (const [key, value] of b.jar) reloadB.jar.set(key, value);
  assert.equal((await (await reloadA.send(`/api/projects/${projectA.id}`)).json() as any).agentId, projectA.agentId);
  assert.equal((await (await reloadB.send(`/api/projects/${projectB.id}`)).json() as any).agentId, projectB.agentId);
  assert.equal(stock.agents.size, 2);
  assert.equal((await a.initialize(projectA.id)).status, 200);
  assert.equal(stock.agents.size, 2);
  const runtimeStatus = await (await a.send(`/api/projects/${projectA.id}/runtime/status`)).json() as any;
  assert.equal(runtimeStatus.connected, true);
  assert.equal(runtimeStatus.runtimeStatus, "ready");
  assert.equal((await a.send(`/api/projects/${projectA.id}/runtime/files`)).status, 200);
  assert.equal((await a.send(`/api/projects/${projectA.id}/runtime/turns`)).status, 200);
  assert.equal((await a.send(`/api/projects/${projectA.id}/runtime/releases`)).status, 200);
  assert.equal((await a.send(`/api/projects/${projectA.id}/runtime/publishing-settings`)).status, 200);
  assert.equal((await a.send(`/api/projects/${projectA.id}/runtime/previews`, "POST", {})).status, 501);
  assert.equal((await a.send(`/api/projects/${projectA.id}/runtime/messages`, "POST", { prompt: "Do not send" })).status, 501);
  assert.equal((await a.send(`/api/projects/${projectA.id}/runtime/deployments`, "POST", {})).status, 501);
  assert.equal(stock.agents.size, 2);

  assert.equal((await a.send("/api/projects", "POST", { name: "Forged" }, { "x-user-id": bMe.id })).status, 400);
  assert.equal((await a.create({ name: "Forged", ownerId: bMe.id })).status, 201);
  assert.equal(sqlite.prepare("SELECT user_id FROM projects WHERE name='Forged'").get()?.user_id, aMe.id);
  assert.equal((await a.send("/api/projects", "POST", { name: "No CSRF" }, { "Idempotency-Key": crypto.randomUUID() })).status, 403);
  assert.equal((await a.send("/api/projects", "POST", { name: "No key" }, { "X-CSRF-Token": "csrf-value" })).status, 400);

  stock.failures.nextCreateStatus = 503;
  const unavailable = await (await a.create({ name: "Unavailable" })).json() as any;
  assert.equal(unavailable.runtimeStatus, "reconcile");
  assert.equal(unavailable.status, "error");
  assert.equal(unavailable.agentId, null);
  assert.equal((await a.initialize(unavailable.id)).status, 200);
  assert.equal(stock.agents.size, 3);
  assert.equal((await (await a.send(`/api/projects/${unavailable.id}`)).json() as any).runtimeStatus, "reconcile");

  stock.failures.loseNextResponse = true;
  const recovered = await (await a.create({ name: "Recoverable" })).json() as any;
  assert.equal(recovered.agentId, null);
  assert.equal(recovered.runtimeStatus, "reconcile");
  const resolved = await (await a.send(`/api/projects/${recovered.id}`)).json() as any;
  assert.ok(resolved.agentId);
  assert.equal(resolved.runtimeStatus, "ready");
  assert.equal(stock.agents.size, 4);

  stock.failures.nextStreamError = true;
  const partial = await (await a.create({ name: "Initialization failed" })).json() as any;
  assert.equal(partial.runtimeStatus, "error");
  assert.ok(partial.agentId);
  assert.equal((await (await a.send(`/api/projects/${partial.id}`)).json() as any).runtimeStatus, "error");
  assert.equal((await a.initialize(partial.id)).status, 200);
  assert.equal(stock.agents.size, 5);

  const missingResult = sqlite.prepare("INSERT INTO projects(user_id,name,status) VALUES(?,?,'draft')").run(aMe.id, "Missing link");
  const missingId = Number(missingResult.lastInsertRowid);
  assert.equal((await (await a.send(`/api/projects/${missingId}`)).json() as any).runtimeStatus, "missing");
  assert.equal((await a.initialize(missingId)).status, 200);
  assert.equal((await (await a.send(`/api/projects/${missingId}`)).json() as any).runtimeStatus, "ready");
  assert.equal(stock.agents.size, 6);

  const gapId = Number(sqlite.prepare(
    "INSERT INTO projects(user_id,name,status,creation_key) VALUES(?,?,'initializing',?)",
  ).run(aMe.id, "New project before link claim", crypto.randomUUID()).lastInsertRowid);
  const callsBeforeGap = stock.calls.filter((path) => path === "/api/agent").length;
  assert.equal((await (await a.send(`/api/projects/${gapId}/runtime/status`)).json() as any).runtimeStatus, "missing");
  assert.equal((await a.send(`/api/projects/${gapId}/runtime/previews`, "POST", {})).status, 501);
  assert.equal((await a.send(`/api/projects/${gapId}/runtime/messages`, "POST", { prompt: "Do not send" })).status, 501);
  assert.equal((await b.send(`/api/projects/${gapId}/runtime/status`)).status, 404);
  assert.equal(stock.calls.filter((path) => path === "/api/agent").length, callsBeforeGap);
  assert.equal((await a.initialize(gapId)).status, 200);
  assert.equal((await (await a.send(`/api/projects/${gapId}`)).json() as any).runtimeStatus, "ready");
  assert.equal(stock.agents.size, 7);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal((await worker.fetch(new Request(`${origin}/api/projects`, {
    headers: { Cookie: "__Host-bc_session=legacy-session" },
  }), env)).status, 401);

  // A new page request with the same cookie restores the same identity.
  assert.equal((await (await a.send("/api/auth/me")).json() as { id: string }).id, aMe.id);
  const oldCookie = [...a.jar].map(([key, value]) => `${key}=${value}`).join("; ");
  assert.equal((await a.auth("/api/auth/logout", {})).status, 204);
  assert.ok(stock.calls.includes("/api/auth/sessions/runtime-session-1"));
  assert.equal(await (await a.send("/api/auth/me")).json(), null);
  assert.equal((await a.send("/api/projects")).status, 401);
  assert.equal((await worker.fetch(new Request(`${origin}/api/projects`, { headers: { Cookie: oldCookie } }), env)).status, 401);
  assert.equal((await b.send("/api/projects")).status, 200);

  assert.equal((await a.auth("/api/auth/login", { email: "a@example.test", password: "Str0ng!PasswordA" })).status, 200);
  assert.equal((await (await a.send("/api/auth/me")).json() as { id: string }).id, aMe.id);
  assert.equal((await a.send(`/api/projects/${projectA.id}`)).status, 200);
  assert.equal(stock.calls.filter((path) => path === "/api/agent").length, 8);
  sqlite.close();
});

test("concurrent project creates with one key claim only one stock Think agent", async () => {
  const { sqlite, db } = database();
  const stock = runtime();
  const env = {
    DB: db,
    ENVIRONMENT: "staging",
    AUTH_RUNTIME: stock.fetcher,
    AUTH_RUNTIME_URL: "https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev",
    STAGING_RUNTIME_URL: "https://buildcustom-vibesdk-migration-staging.thegoldimport.workers.dev",
    STAGING_ROUTE_KV_ID: "e5e119fa2abc4c26a8c027e0d8a8d82c",
    STAGING_DISPATCH_NAMESPACE: "buildcustom-vibesdk-migration-staging",
    STAGING_ALLOWED_ORIGIN: origin,
    STAGING_REGISTRATION_ENABLED: "true",
    STAGING_LOGIN_ENABLED: "true",
    RUNTIME_OPERATIONS_ENABLED: "false",
  } as Env;
  const a = browser(env);
  assert.equal((await a.auth("/api/auth/register", {
    name: "Parallel", email: "parallel@example.test", password: "Str0ng!PasswordP",
  })).status, 200);
  const key = crypto.randomUUID();
  const [first, second] = await Promise.all([
    a.create({ name: "Concurrent project" }, key),
    a.create({ name: "Concurrent project" }, key),
  ]);
  assert.ok([200, 201, 202].includes(first.status));
  assert.ok([200, 201, 202].includes(second.status));
  const left = await first.json() as any, right = await second.json() as any;
  assert.equal(left.id, right.id);
  const resolved = await (await a.send(`/api/projects/${left.id}`)).json() as any;
  assert.equal(resolved.runtimeStatus, "ready");
  assert.equal(stock.agents.size, 1);
  assert.equal(sqlite.prepare("SELECT agent_id FROM runtime_project_links WHERE project_id=?").get(left.id)?.agent_id, resolved.agentId);
  sqlite.close();
});