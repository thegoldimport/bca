import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import git from "isomorphic-git";
import { createFsFromVolume, Volume } from "memfs";
import worker, { type Env } from "../cloudflare/worker";
import { handleStagingCustomerAuth } from "../cloudflare/staging/runtime-identity";

const origin = "https://buildcustom-control-plane-staging.thegoldimport.workers.dev";

test("launch auth bridge targets only the reviewed stock runtime", async () => {
  const launchUrl = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
  let forwardedUrl = "";
  const response = await handleStagingCustomerAuth({
    DB: {} as D1Database,
    ENVIRONMENT: "production",
    CONTROL_PLANE_PROFILE: "launch",
    AUTH_RUNTIME_URL: launchUrl,
    AUTH_RUNTIME: {
      async fetch(request: Request) {
        forwardedUrl = request.url;
        return Response.json({ success: true, data: { token: "launch-csrf" } }, {
          headers: { "Set-Cookie": "csrf-token=csrf-cookie; Path=/; Secure; HttpOnly; SameSite=Strict" },
        });
      },
    } as Fetcher,
  }, new Request("https://control.launch.test/api/auth/csrf-token"), "/api/auth/csrf-token", {});
  assert.equal(forwardedUrl, `${launchUrl}/api/auth/csrf-token`);
  assert.equal(response?.status, 200);
  assert.deepEqual(await response?.json(), { token: "launch-csrf" });
});

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/d1/0001_control_plane.sql", "utf8"));
  sqlite.exec("INSERT INTO users(id,username,email,password) VALUES('legacy','Legacy','legacy@example.test','existing-hash')");
  sqlite.exec("INSERT INTO projects(id,user_id,name) VALUES(1,'legacy','Existing project')");
  sqlite.exec("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('legacy-session','legacy','2030-01-01')");
  sqlite.exec(readFileSync("migrations/d1/0002_staging_runtime_identity.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/d1/0003_staging_think_project_links.sql", "utf8"));
  // Apply the native publish migration after legacy data and project rows have
  // been inserted above; this exercises upgrade compatibility on a populated D1.
  sqlite.exec(readFileSync("migrations/d1/0004_native_publish.sql", "utf8"));
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
async function gitFixture() {
  const fs = createFsFromVolume(new Volume());
  const dir = "/fixture";
  await git.init({ fs, dir, defaultBranch: "main" });
  await fs.promises.mkdir(`${dir}/src`, { recursive: true });
  await fs.promises.writeFile(`${dir}/README.md`, "hello");
  await fs.promises.writeFile(`${dir}/src/App.tsx`, "hello");
  await git.add({ fs, dir, filepath: "README.md" });
  await git.add({ fs, dir, filepath: "src/App.tsx" });
  const commitHash = await git.commit({
    fs, dir, message: "fixture",
    author: { name: "Fixture", email: "fixture@example.test" },
  });
  const commit = await git.readCommit({ fs, dir, oid: commitHash });
  const reachable = new Set<string>([commitHash]);
  const collectTree = async (oid: string) => {
    reachable.add(oid);
    const tree = await git.readTree({ fs, dir, oid });
    for (const entry of tree.tree) {
      reachable.add(entry.oid);
      if (entry.type === "tree") await collectTree(entry.oid);
    }
  };
  await collectTree(commit.commit.tree);
  const packed = await git.packObjects({ fs, dir, oids: [...reachable], write: false });
  assert.ok(packed.packfile);
  const pkt = (line: string) => `${(line.length + 4).toString(16).padStart(4, "0")}${line}`;
  const advertisement = new TextEncoder().encode(
    `001e# service=git-upload-pack\n0000${pkt(`${commitHash} HEAD\u0000side-band-64k thin-pack ofs-delta symref=HEAD:refs/heads/main\n`)}${pkt(`${commitHash} refs/heads/main\n`)}0000`,
  );
  const sidebandHeader = new TextEncoder().encode(
    `${(packed.packfile!.byteLength + 5).toString(16).padStart(4, "0")}\u0001`,
  );
  const responsePack = new Uint8Array(8 + sidebandHeader.byteLength + packed.packfile!.byteLength + 4);
  responsePack.set(new TextEncoder().encode("0008NAK\n"));
  responsePack.set(sidebandHeader, 8);
  responsePack.set(packed.packfile!, 8 + sidebandHeader.byteLength);
  responsePack.set(new TextEncoder().encode("0000"), responsePack.byteLength - 4);
  return { commitHash, advertisement, responsePack };
}

function runtime(options: { silentLogout?: boolean; gitFixture?: Awaited<ReturnType<typeof gitFixture>> } = {}) {
  const accounts = new Map<string, Account>();
  const sessions = new Map<string, { account: Account; id: string }>();
  const calls: string[] = [];
  const requests: Array<{ url: string; method: string; headers: Headers }> = [];
  const ticketScopes: Array<{ resourceType: string; resourceId: string }> = [];
  const sockets: MockStockSocket[] = [];
  const agents = new Map<string, { owner: string; originalPrompt: string; commitHash: string | null }>();
  const wsTickets = new Map<string, { agentId: string; owner: string; expiresAt: number }>();
  const freshCsrf = new Map<string, { token: string; cookie: string }>();
  const failures = { nextCreateStatus: 0, loseNextResponse: false, nextStreamError: false, shouldBeGenerating: false, expireNextTicket: false };
  let nextAgent = 0;
  let nextUser = 0;
  let nextSession = 0;
  let nextTicket = 0;
  class MockStockSocket extends EventTarget {
    constructor(private agentId: string) { super(); }
    sent: string[] = [];
    accept() {
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({
          type: "agent_connected",
          state: { shouldBeGenerating: failures.shouldBeGenerating },
          previewUrl: `https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev/space/${this.agentId}/preview/main/?t=signed-preview-token`,
        }),
      })));
    }
    emitFrame(frame: unknown) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
    }
    close() {}
    send(frame: string) {
      this.sent.push(frame);
      const request = JSON.parse(frame);
      if (request.type === "get_conversation_state") {
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify({ type: "conversation_state", state: { fullHistory: [] } }),
        })));
      }
    }
  }
  const fetcher = {
    async fetch(request: Request) {
      const path = new URL(request.url).pathname;
      calls.push(path);
      requests.push({ url: request.url, method: request.method, headers: new Headers(request.headers) });
      const cookie = request.headers.get("Cookie") || "";
      const token = cookie.match(/(?:^|;\s*)accessToken=([^;]+)/)?.[1];
      const session = token ? sessions.get(token) : null;
      if (path === "/api/auth/csrf-token" && request.method === "GET") {
        if (!session || /(?:^|;\s*)csrf-token=/.test(cookie)) return Response.json({ success: true, data: { token: "csrf-value" } }, {
          headers: { "Set-Cookie": "csrf-token=csrf-cookie; Path=/; Secure; HttpOnly; SameSite=Strict" },
        });
        const csrf = { token: `csrf-header-${session.id}`, cookie: `csrf-cookie-${session.id}` };
        freshCsrf.set(session.id, csrf);
        return Response.json({ success: true, data: { token: csrf.token } }, {
          headers: { "Set-Cookie": `csrf-token=${csrf.cookie}; Path=/; Secure; HttpOnly; SameSite=Strict` },
        });
      }
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
        agents.set(agentId, { owner: session.account.id, originalPrompt: body.query, commitHash: null });
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
      if (/^\/api\/agent\/[a-zA-Z0-9_-]+\/(?:connect|branches|preview)$/.test(path)) {
        const agentId = path.split("/")[3];
        const agent = agents.get(agentId);
        if (!session) return Response.json({ success: false }, { status: 401 });
        if (!agent) return Response.json({ success: false }, { status: 404 });
        if (agent.owner !== session.account.id) return Response.json({ success: false }, { status: 403 });
        if (path.endsWith("/branches")) return Response.json({ success: true, data: { current: "main", branches: ["main"] } });
        if (path.endsWith("/preview")) {
          return Response.json({ success: true, data: { previewURL: `https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev/space/${agentId}/preview/main/?t=signed-preview-token` } });
        }
        return Response.json({ success: true, data: { agentId, websocketUrl: `wss://example.test/${agentId}` } });
      }
      if (/^\/apps\/[a-zA-Z0-9_-]+\.git\/(?:info\/refs|git-upload-pack)$/.test(path)) {
        const agentId = path.split("/")[2].replace(/\.git$/, "");
        const agent = agents.get(agentId);
        const bearer = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
        const gitSession = bearer ? sessions.get(bearer) : null;
        if (!gitSession) return new Response("Authentication required", { status: 401 });
        if (!agent || agent.owner !== gitSession.account.id) return new Response("Access denied", { status: 403 });
        if (path.endsWith("/info/refs")) {
          const bytes = agent.commitHash ? options.gitFixture?.advertisement
            : new TextEncoder().encode("001e# service=git-upload-pack\n0000");
          return new Response(bytes || "Git fixture unavailable", {
            status: bytes ? 200 : 500,
            headers: { "Content-Type": "application/x-git-upload-pack-advertisement" },
          });
        }
        if (!agent.commitHash || !options.gitFixture) return new Response("No commits to pack", { status: 404 });
        return new Response(options.gitFixture.responsePack, {
          headers: { "Content-Type": "application/x-git-upload-pack-result" },
        });
      }
      if (path === "/api/ws-ticket" && request.method === "POST") {
        if (!session) return Response.json({ success: false }, { status: 401 });
        const csrf = freshCsrf.get(session.id);
        if (!csrf || request.headers.get("X-CSRF-Token") !== csrf.token
          || cookie.match(/(?:^|;\s*)csrf-token=([^;]+)/)?.[1] !== csrf.cookie) {
          return Response.json({ success: false, error: "CSRF validation failed" }, { status: 403 });
        }
        const body = await request.json() as { resourceType: string; resourceId: string };
        ticketScopes.push(body);
        const agent = agents.get(body.resourceId);
        if (body.resourceType !== "agent" || !agent || agent.owner !== session.account.id) {
          return Response.json({ success: false }, { status: 403 });
        }
        const ticket = `tk_${(++nextTicket).toString(16).padStart(40, "0")}`;
        const expiresAt = failures.expireNextTicket ? Date.now() - 1 : Date.now() + 15_000;
        failures.expireNextTicket = false;
        wsTickets.set(ticket, { agentId: body.resourceId, owner: session.account.id, expiresAt });
        return Response.json({ success: true, data: { ticket } });
      }
      if (/^\/api\/agent\/[a-zA-Z0-9_-]+\/ws$/.test(path)) {
        const agentId = path.split("/")[3];
        const ticket = new URL(request.url).searchParams.get("ticket") || "";
        const issued = wsTickets.get(ticket);
        wsTickets.delete(ticket);
        if (!issued || issued.expiresAt < Date.now() || issued.agentId !== agentId || agents.get(agentId)?.owner !== issued.owner) {
          return new Response("Invalid ticket", { status: 403 });
        }
        const socket = new MockStockSocket(agentId);
        sockets.push(socket);
        return { status: 101, webSocket: socket } as unknown as Response;
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
        if (request.headers.get("X-CSRF-Token") !== "csrf-value"
          || !cookie.includes("csrf-token=csrf-cookie")) {
          return Response.json({ success: false }, { status: 403 });
        }
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
  return { fetcher: fetcher as Fetcher, calls, requests, ticketScopes, sockets, agents, failures, gitFixture: options.gitFixture };
}

async function withMockSocketPlatform<T>(
  run: (pairs: Array<[any, any]>) => Promise<T>,
): Promise<T> {
  const responseDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Response");
  const pairDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocketPair");
  const NativeResponse = globalThis.Response;
  class TestResponse extends NativeResponse {
    static json(body: unknown, init?: ResponseInit): Response {
      return NativeResponse.json(body, init);
    }
    constructor(body?: any, init?: any) {
      if (init?.status !== 101) {
        super(body, init);
        return;
      }
      super(null, { headers: init.headers });
      Object.defineProperty(this, "status", { value: 101 });
      Object.defineProperty(this, "webSocket", { value: init.webSocket });
    }
  }
  class MockSocket extends EventTarget {
    peer!: MockSocket;
    sent: unknown[] = [];
    accepted = false;
    closed: { code: number; reason: string } | null = null;
    accept() { this.accepted = true; }
    send(data: any) {
      this.sent.push(data);
      this.peer?.dispatchEvent(new MessageEvent("message", { data }));
    }
    close(code = 1000, reason = "") {
      this.closed = { code, reason };
    }
  }
  const pairs: Array<[MockSocket, MockSocket]> = [];
  class MockWebSocketPair {
    0: MockSocket;
    1: MockSocket;
    constructor() {
      this[0] = new MockSocket();
      this[1] = new MockSocket();
      this[0].peer = this[1];
      this[1].peer = this[0];
      pairs.push([this[0], this[1]]);
    }
  }
  Object.defineProperty(globalThis, "Response", { configurable: true, writable: true, value: TestResponse });
  Object.defineProperty(globalThis, "WebSocketPair", { configurable: true, writable: true, value: MockWebSocketPair });
  try {
    return await run(pairs);
  } finally {
    if (responseDescriptor) Object.defineProperty(globalThis, "Response", responseDescriptor);
    else delete (globalThis as any).Response;
    if (pairDescriptor) Object.defineProperty(globalThis, "WebSocketPair", pairDescriptor);
    else delete (globalThis as any).WebSocketPair;
  }
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
    assert.equal(csrf.status, 200, await csrf.clone().text());
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

test("browser-equivalent logout requires matching CSRF and revokes only the verified session", async () => {
  const { sqlite, db } = database();
  try {
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
    } as Env;
    const a = browser(env), aOther = browser(env), b = browser(env);
    assert.equal((await a.auth("/api/auth/register", {
      name: "User A", email: "a@example.test", password: "Str0ng!PasswordA",
    })).status, 200);
    assert.equal((await aOther.auth("/api/auth/login", {
      email: "a@example.test", password: "Str0ng!PasswordA",
    })).status, 200);
    assert.equal((await b.auth("/api/auth/register", {
      name: "User B", email: "b@example.test", password: "Str0ng!PasswordB",
    })).status, 200);

    const csrf = await a.send("/api/auth/csrf-token");
    assert.equal(csrf.status, 200);
    const { token } = await csrf.json() as { token: string };
    assert.equal(token, "csrf-value");
    assert.equal(a.jar.get("csrf-token"), "csrf-cookie");
    const oldCookie = [...a.jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const check = async (cookie: string) => (await (await stock.fetcher.fetch(new Request(
      `${env.AUTH_RUNTIME_URL}/api/auth/check`, { headers: { Cookie: cookie } },
    ))).json() as any).data;
    const originalSession = (await check(oldCookie)).sessionId;
    assert.ok(originalSession);
    const otherCookie = [...aOther.jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const otherSession = (await check(otherCookie)).sessionId;
    assert.notEqual(originalSession, otherSession);

    const missing = await a.send("/api/auth/logout", "POST");
    assert.equal(missing.status, 502);
    assert.equal((await check(oldCookie)).authenticated, true);
    assert.equal((await b.send("/api/auth/me")).status, 200);
    assert.equal((await (await b.send("/api/auth/me")).json() as any).email, "b@example.test");

    const mismatch = await a.send("/api/auth/logout", "POST", undefined, { "X-CSRF-Token": "wrong-token" });
    assert.equal(mismatch.status, 502);
    assert.equal((await check(oldCookie)).authenticated, true);
    assert.equal((await check(otherCookie)).authenticated, true);

    const success = await a.send("/api/auth/logout", "POST", undefined, { "X-CSRF-Token": token });
    assert.equal(success.status, 204);
    const forwarded = stock.requests.filter((request) => new URL(request.url).pathname === "/api/auth/logout");
    assert.equal(forwarded.length, 3);
    assert.equal(forwarded[2].headers.get("X-CSRF-Token"), token);
    assert.match(forwarded[2].headers.get("Cookie") || "", /csrf-token=csrf-cookie/);
    assert.match(forwarded[2].headers.get("Cookie") || "", new RegExp(`sessionId=${originalSession}`));
    assert.equal(forwarded[2].headers.get("Origin"), null);
    assert.equal((await check(oldCookie)).authenticated, false);
    assert.equal(await (await worker.fetch(new Request(`${origin}/api/auth/me`, {
      headers: { Cookie: oldCookie },
    }), env)).json(), null);
    assert.equal((await check(otherCookie)).authenticated, true);
    assert.equal((await (await aOther.send("/api/auth/me")).json() as any).email, "a@example.test");
    assert.equal((await (await b.send("/api/auth/me")).json() as any).email, "b@example.test");
  } finally {
    sqlite.close();
  }
});

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
  const stock = runtime({ silentLogout: true, gitFixture: await gitFixture() });
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
  assert.equal((await a.send(`/api/projects/${projectB.id}/runtime/reconcile-deployment`, "POST", {}, {
    "X-CSRF-Token": "csrf-value",
  })).status, 404);
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
  const stockGitRequest = (browserJar: Map<string, string>, agentId: string) => {
    const accessToken = browserJar.get("accessToken");
    return stock.fetcher.fetch(new Request(
      `https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev/apps/${agentId}.git/info/refs?service=git-upload-pack`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    ));
  };
  assert.equal((await stockGitRequest(a.jar, projectA.agentId)).status, 200);
  assert.equal((await stockGitRequest(b.jar, projectA.agentId)).status, 403);
  assert.equal((await stockGitRequest(a.jar, projectB.agentId)).status, 403);
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
  assert.deepEqual(await (await a.send(`/api/projects/${projectA.id}/runtime/revision`)).json(), {
    branch: "main",
    commitHash: null,
  });
  stock.agents.get(projectA.agentId)!.commitHash = stock.gitFixture!.commitHash;
  assert.deepEqual(await (await a.send(`/api/projects/${projectA.id}/runtime/revision`)).json(), {
    branch: "main",
    commitHash: stock.gitFixture!.commitHash,
  });
  const runtimeStatus = await (await a.send(`/api/projects/${projectA.id}/runtime/status`)).json() as any;
  assert.equal(runtimeStatus.nativeThink, true);
  assert.equal(runtimeStatus.connected, true);
  assert.equal(runtimeStatus.runtimeStatus, "ready");
  assert.equal(runtimeStatus.files, 2);
  assert.deepEqual(runtimeStatus.state, { shouldBeGenerating: false, generation: { status: "idle" } });
  assert.equal(runtimeStatus.previewUrl, `https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev/space/${projectA.agentId}/preview/main/?t=signed-preview-token`);
  assert.equal(stock.calls.filter((path) => /\/api\/agent\/[^/]+\/preview$/.test(path)).length, 0);
  stock.failures.shouldBeGenerating = true;
  const generatingStatus = await (await a.send(`/api/projects/${projectA.id}/runtime/status`)).json() as any;
  assert.equal(generatingStatus.state.shouldBeGenerating, true);
  assert.equal(generatingStatus.state.generation.status, "running");
  stock.failures.shouldBeGenerating = false;
  const currentFiles = await (await a.send(`/api/projects/${projectA.id}/runtime/files`)).json() as Array<{ path: string }>;
  assert.deepEqual(currentFiles.map(({ path }) => path).sort(), ["README.md", "src/App.tsx"]);
  assert.deepEqual(await (await a.send(`/api/projects/${projectA.id}/runtime/files/content?path=src%2FApp.tsx`)).json(), {
    path: "src/App.tsx",
    content: "hello",
  });
  const ownerDataCallsBeforeForeignReads = stock.calls.filter((path) => path.startsWith("/api/agent/") || path.startsWith("/apps/")).length;
  assert.equal((await b.send(`/api/projects/${projectA.id}/runtime/files`)).status, 404);
  assert.equal((await b.send(`/api/projects/${projectA.id}/runtime/files/content?path=src%2FApp.tsx`)).status, 404);
  assert.equal((await b.send(`/api/projects/${projectA.id}/runtime/previews`, "POST", {}, { "X-CSRF-Token": "csrf-value" })).status, 404);
  assert.equal(
    stock.calls.filter((path) => path.startsWith("/api/agent/") || path.startsWith("/apps/")).length,
    ownerDataCallsBeforeForeignReads,
  );

  a.jar.set("__Host-cf_oauth_token", "oauth-encrypted-value");
  await withMockSocketPlatform(async (pairs) => {
    const wsPath = `/api/projects/${projectA.id}/runtime/ws`;
    const cookie = [...a.jar].map(([key, value]) => `${key}=${value}`).join("; ");
    const request = (path: string, requestOrigin = origin) => new Request(`${origin}${path}`, {
      headers: { Cookie: cookie, Origin: requestOrigin, Upgrade: "websocket" },
    });
    const ticketsBefore = stock.ticketScopes.length;
    const foreignCookie = [...b.jar].map(([key, value]) => `${key}=${value}`).join("; ");
    assert.equal((await worker.fetch(new Request(`${origin}${wsPath}`, {
      headers: { Cookie: foreignCookie, Origin: origin, Upgrade: "websocket" },
    }), env)).status, 404);
    assert.equal(stock.ticketScopes.length, ticketsBefore, "A different authenticated user must not obtain the owner's agent ticket.");
    assert.equal((await worker.fetch(request(wsPath, `${origin}.attacker.test`), env)).status, 403);
    assert.equal((await worker.fetch(request(`${wsPath}?agentId=${projectB.agentId}`), env)).status, 400);
    assert.equal((await worker.fetch(request(`/api/projects/${projectB.id}/runtime/ws`), env)).status, 404);
    assert.equal(stock.ticketScopes.length, ticketsBefore);

    const upgraded = await worker.fetch(request(wsPath), env);
    assert.equal(upgraded.status, 101);
    assert.equal(upgraded.body, null);
    assert.deepEqual(stock.ticketScopes.at(-1), { resourceType: "agent", resourceId: projectA.agentId });
    const ticketCall = stock.requests.filter(({ url }) => url.endsWith("/api/ws-ticket")).at(-1)!;
    const socketCall = stock.requests.filter(({ url }) => url.includes("/api/agent/") && url.includes("/ws?ticket=")).at(-1)!;
    assert.doesNotMatch(ticketCall.headers.get("Cookie") || "", /__Host-cf_oauth_token/);
    assert.match(socketCall.headers.get("Cookie") || "", /__Host-cf_oauth_token=oauth-encrypted-value/);
    assert.equal((await upgraded.text()).includes("tk_"), false);

    const client = pairs.at(-1)![0];
    const upstream = stock.sockets.at(-1)!;
    const browserFrames: string[] = [];
    client.addEventListener("message", (event) => browserFrames.push(String((event as MessageEvent).data)));
    client.send(JSON.stringify({ type: "generate_all" }));
    assert.equal(upstream.sent.length, 0);
    client.send(JSON.stringify({
      type: "user_suggestion",
      message: "Make the landing page.",
      agentId: "attacker-selected",
      source: "attacker-selected",
    }));
    assert.deepEqual(JSON.parse(String(upstream.sent[0])), {
      type: "user_suggestion",
      message: "Make the landing page.",
    });
    assert.ok(browserFrames.some((frame) => JSON.parse(frame).type === "error"));
    upstream.emitFrame({ type: "file_changed", path: "src/App.tsx" });
    assert.ok(browserFrames.some((frame) => JSON.parse(frame).type === "file_changed"));
    upstream.emitFrame({
      type: "agent_connected",
      state: { shouldBeGenerating: true, generation: { status: "running" }, cloudflareToken: "encrypted-oauth-blob" },
    });
    const connectedFrame = browserFrames.map((frame) => JSON.parse(frame)).find((frame) => frame.type === "agent_connected");
    assert.deepEqual(connectedFrame?.state, { shouldBeGenerating: true, generation: { status: "running" } });
    assert.doesNotMatch(browserFrames.join("\n"), /encrypted-oauth-blob/);
    upstream.emitFrame({ type: "cf_agent_state", state: { cloudflareToken: "encrypted-oauth-blob" } });
    assert.equal(browserFrames.some((frame) => JSON.parse(frame).type === "cf_agent_state"), false);

    const usedSocketCall = socketCall;
    const replay = await stock.fetcher.fetch(new Request(usedSocketCall.url, {
      headers: { Cookie: cookie, Upgrade: "websocket" },
    }));
    assert.equal(replay.status, 403);

    stock.failures.expireNextTicket = true;
    assert.equal((await worker.fetch(request(wsPath), env)).status, 502);
    const expiredSocketCall = stock.requests.filter(({ url }) => url.includes("/api/agent/") && url.includes("/ws?ticket=")).at(-1)!;
    const expiredReplay = await stock.fetcher.fetch(new Request(expiredSocketCall.url, {
      headers: { Cookie: cookie, Upgrade: "websocket" },
    }));
    assert.equal(expiredReplay.status, 403);
  });
  assert.deepEqual(await (await a.send(`/api/projects/${projectA.id}/runtime/turns`, "GET", undefined, { "X-CSRF-Token": "csrf-value" })).json(), { turns: [] });
  const nativeReleases = await a.send(`/api/projects/${projectA.id}/runtime/releases`);
  assert.equal(nativeReleases.status, 200);
  assert.deepEqual(await nativeReleases.json(), { releases: [] });
  assert.equal((await a.send(`/api/projects/${projectA.id}/runtime/publishing-settings`)).status, 200);
  const previewResponse = await a.send(`/api/projects/${projectA.id}/runtime/previews`, "POST", {}, { "X-CSRF-Token": "csrf-value" });
  assert.equal(previewResponse.status, 201);
  assert.match((await previewResponse.json() as any).url, /\?t=signed-preview-token$/);
  assert.equal(stock.calls.filter((path) => /\/api\/agent\/[^/]+\/preview$/.test(path)).length, 1);
  assert.equal(stock.calls.some((path) => /deploy|publish/i.test(path)), false);
  assert.equal((await a.send(`/api/projects/${projectA.id}/runtime/messages`, "POST", { prompt: "Do not send" })).status, 501);
  const stockSocketCallsBeforePublishGuards = stock.calls.filter((path) => /\/api\/agent\/[^/]+\/ws/.test(path)).length;
  assert.equal((await a.send(`/api/projects/${projectA.id}/runtime/deployments`, "POST", {})).status, 410);
  assert.equal((await a.send(
    `/api/projects/${projectA.id}/runtime/publish-immutable-v2`,
    "POST",
    {},
    { "X-Publish-Protocol": "immutable-v2" },
  )).status, 403);
  assert.equal((await b.send(
    `/api/projects/${projectA.id}/runtime/publish-immutable-v2`,
    "POST",
    {},
    { "X-Publish-Protocol": "immutable-v2" },
  )).status, 404);
  assert.equal(stock.calls.filter((path) => /\/api\/agent\/[^/]+\/ws/.test(path)).length, stockSocketCallsBeforePublishGuards);
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
  assert.equal((await a.send(`/api/projects/${gapId}/runtime/previews`, "POST", {}, { "X-CSRF-Token": "csrf-value" })).status, 409);
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
  // Stale legacy cookies are not a new stock session. A fresh login replaces
  // their host-scoped values; closed registration does not disable login.
  const oldAccess = a.jar.get("accessToken")!;
  a.jar.set("accessToken", "stale-legacy-session");
  a.jar.set("csrf-token", "stale-legacy-csrf");
  assert.equal(await (await a.send("/api/auth/me")).json(), null);
  assert.equal((await a.send("/api/projects")).status, 401);
  env.STAGING_REGISTRATION_ENABLED = "false";
  assert.equal((await a.auth("/api/auth/register", { name: "Denied", email: "denied@example.test", password: "not-created" })).status, 403);
  assert.equal((await a.auth("/api/auth/login", { email: "a@example.test", password: "Str0ng!PasswordA" })).status, 200);
  assert.notEqual(a.jar.get("accessToken"), oldAccess);
  assert.notEqual(a.jar.get("accessToken"), "stale-legacy-session");

  // A new page request with the same cookie restores the same identity.
  assert.equal((await (await a.send("/api/auth/me")).json() as { id: string }).id, aMe.id);
  const oldCookie = [...a.jar].map(([key, value]) => `${key}=${value}`).join("; ");
  const oldRuntimeCheck = () => stock.fetcher.fetch(new Request(`${env.AUTH_RUNTIME_URL}/api/auth/check`, {
    headers: { Cookie: oldCookie },
  }));
  assert.equal(((await (await oldRuntimeCheck()).json()) as any).data.authenticated, true);
  assert.equal((await a.auth("/api/auth/logout", {})).status, 204);
  assert.ok(stock.calls.some((path) => /^\/api\/auth\/sessions\/runtime-session-\d+$/.test(path)));
  assert.equal(await (await a.send("/api/auth/me")).json(), null);
  assert.equal((await a.send("/api/projects")).status, 401);
  assert.equal((await worker.fetch(new Request(`${origin}/api/projects`, { headers: { Cookie: oldCookie } }), env)).status, 401);
  // /api/auth/me returns HTTP 200 even for an anonymous user. Check the
  // identity and stock session authority, not just the status code.
  const oldProductMe = await worker.fetch(new Request(`${origin}/api/auth/me`, { headers: { Cookie: oldCookie } }), env);
  assert.equal(oldProductMe.status, 200);
  assert.equal(await oldProductMe.json(), null);
  assert.equal(((await (await oldRuntimeCheck()).json()) as any).data.authenticated, false);
  const malformedCookie = "accessToken=not-a-valid-session";
  const malformedMe = await worker.fetch(new Request(`${origin}/api/auth/me`, {
    headers: { Cookie: malformedCookie },
  }), env);
  assert.equal(malformedMe.status, 200);
  assert.equal(await malformedMe.json(), null);
  assert.equal(((await (await stock.fetcher.fetch(new Request(`${env.AUTH_RUNTIME_URL}/api/auth/check`, {
    headers: { Cookie: malformedCookie },
  }))).json()) as any).data.authenticated, false);
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