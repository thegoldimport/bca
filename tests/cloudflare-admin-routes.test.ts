import test from "node:test";
import assert from "node:assert/strict";
import { handleAdminRoute } from "../cloudflare/admin-routes";

function dbWithRows(rows: any[] = []) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.startsWith("SELECT id,username")) return null;
              if (sql.startsWith("SELECT u.id")) return null;
              if (sql.startsWith("INSERT INTO waitlist")) {
                return { id: 1, name: args[0], email: args[1], source: args[2], status: "Pending", created_at: "now" };
              }
              return null;
            },
            async run() { return { success: true, meta: { changes: 1 } }; },
          };
        },
        async first() { return null; },
        async all() { return { results: rows }; },
        async run() { return { success: true, meta: { changes: 0 } }; },
      };
    },
  } as unknown as D1Database;
}

const env = (DB: D1Database) => ({ DB });
const request = (method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
  new Request(`https://staging.example.test${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("unrelated routes are left for the main worker", async () => {
  const req = request("GET", "/api/projects");
  assert.equal(await handleAdminRoute({ request: req, env: env(dbWithRows()), url: new URL(req.url), input: {} }), null);
});

test("public waitlist validates input and returns the created entry", async () => {
  const req = request("POST", "/api/waitlist", { name: "Ada", email: "ADA@example.com", source: "launch" });
  const response = await handleAdminRoute({ request: req, env: env(dbWithRows()), url: new URL(req.url), input: { name: "Ada", email: "ADA@example.com", source: "launch" } });
  assert.equal(response?.status, 201);
  assert.deepEqual(await response?.json(), { id: 1, name: "Ada", email: "ada@example.com", source: "launch", status: "Pending", createdAt: "now" });
});

test("waitlist rejects invalid email without touching storage", async () => {
  const req = request("POST", "/api/waitlist", { name: "Ada", email: "not-an-email" });
  const response = await handleAdminRoute({ request: req, env: env(dbWithRows()), url: new URL(req.url), input: { name: "Ada", email: "not-an-email" } });
  assert.equal(response?.status, 400);
});

test("admin waitlist endpoints require a secure session", async () => {
  const req = request("GET", "/api/admin/waitlist");
  const response = await handleAdminRoute({ request: req, env: env(dbWithRows()), url: new URL(req.url), input: {} });
  assert.equal(response?.status, 401);
});

test("admin login never accepts a missing or non-admin account", async () => {
  const req = request("POST", "/api/admin/login", { username: "admin", password: "anything" });
  const response = await handleAdminRoute({ request: req, env: env(dbWithRows()), url: new URL(req.url), input: { username: "admin", password: "anything" } });
  assert.equal(response?.status, 503);
});

test("admin login requires the explicit staging gate and rate-limits IP and identity", async () => {
  const database = dbWithRows();
  const headers = { "CF-Connecting-IP": `198.51.100.${Math.floor(Math.random() * 200) + 1}` };
  const input = { username: `unknown-${Math.random()}`, password: "anything" };
  const makeRequest = () => request("POST", "/api/admin/login", input, headers);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const req = makeRequest();
    const response = await handleAdminRoute({ request: req, env: { DB: database, STAGING_LOGIN_ENABLED: "true" }, url: new URL(req.url), input });
    assert.equal(response?.status, 401);
  }
  const req = makeRequest();
  const response = await handleAdminRoute({ request: req, env: { DB: database, STAGING_LOGIN_ENABLED: "true" }, url: new URL(req.url), input });
  assert.equal(response?.status, 429);
});