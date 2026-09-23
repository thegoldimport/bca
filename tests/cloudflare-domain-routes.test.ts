import test from "node:test";
import assert from "node:assert/strict";
import { handleDomainRoute, stagingHostnameAllowed } from "../cloudflare/domain-routes";

function db(rows: Record<string, unknown>[] = [], link: Record<string, unknown> | null = null) {
  const calls: string[] = [];
  const statement = (sql: string) => {
    calls.push(sql);
    return {
      bind: (..._args: unknown[]) => ({
        first: async () => sql.includes("runtime_project_links") ? link : rows[0] || null,
        all: async () => ({ results: rows }),
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
    };
  };
  return { prepare: statement, calls } as any;
}

const env = (link: any = {
  project_id: 7, deployment_url: "https://runtime.test/deployed/app",
  subdomain_slug: "app", custom_domain_migration_state: "{}",
}) => ({ DB: db([], link), STAGING_ROUTES: {}, ENVIRONMENT: "staging", STAGING_ALLOWED_DOMAIN_SUFFIXES: "example.test" } as any);
const args = (operation: string, method: string, input: Record<string, unknown> = {}, e = env()) => ({
  request: new Request(`https://staging.example.test/api/projects/7/runtime/${operation}`, { method }),
  env: e, url: new URL(`https://staging.example.test/api/projects/7/runtime/${operation}`),
  input, user: { id: "u" }, project: { id: 7, user_id: "u" }, operation,
});

test("enforces the isolated staging hostname allowlist", () => {
  assert.equal(stagingHostnameAllowed("demo.example.test", env()), true);
  assert.equal(stagingHostnameAllowed("buyermagnets.com", env()), false);
  assert.equal(stagingHostnameAllowed("foo.apps.buildcustom.ai", env()), false);
});

test("does not simulate custom-hostname creation", async () => {
  const result = await handleDomainRoute(args("custom-domain", "POST", { hostname: "demo.example.test" }) as any);
  assert.equal(result?.status, 503);
  assert.match(await result!.text(), /dedicated staging zone and token/);
});

test("does not delete or refresh production custom hostnames", async () => {
  for (const [operation, method] of [["custom-domain", "DELETE"], ["application-domain/refresh", "POST"]]) {
    const result = await handleDomainRoute(args(operation, method, { hostname: "demo.example.test" }) as any);
    assert.equal(result?.status, 503);
  }
});

test("rejects non-allowlisted mutation before any database write", async () => {
  const e = env();
  const result = await handleDomainRoute(args("custom-domain", "POST", { hostname: "buyermagnets.com" }, e) as any);
  assert.equal(result?.status, 400);
  assert.equal(e.DB.calls.some((sql: string) => sql.includes("INSERT") || sql.includes("UPDATE")), false);
});

test("supports metadata-only inspection and requires inspection before import", async () => {
  const inspected = await handleDomainRoute(args("custom-domain/inspect", "POST", { hostname: "demo.example.test" }) as any);
  assert.equal(inspected?.status, 200);
  const imported = await handleDomainRoute(args("custom-domain/import-dns", "POST", { hostname: "demo.example.test", content: "[]" }) as any);
  assert.equal(imported?.status, 409);
});

test("returns null for unrelated operations", async () => {
  assert.equal(await handleDomainRoute(args("messages", "POST", {}) as any), null);
});