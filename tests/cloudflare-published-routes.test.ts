import assert from "node:assert/strict";
import test from "node:test";
import { assertRouteBinding, deleteProjectWithRoutes, writePublishedRoute } from "../cloudflare/published-routes";

const STAGING_KV_ID = "e5e119fa2abc4c26a8c027e0d8a8d82c";

type Link = {
  subdomain_slug: string | null;
  deployment_script_name: string | null;
  custom_domain_cloudflare_id: string | null;
  custom_domain_secondary_cloudflare_id: string | null;
};

function kv(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  const calls: Array<{ method: string; key: string; value?: string }> = [];
  return {
    calls,
    values,
    async get(key: string) {
      calls.push({ method: "get", key });
      return values.get(key) ?? null;
    },
    async delete(key: string) {
      calls.push({ method: "delete", key });
      values.delete(key);
    },
    async put(key: string, value: string) {
      calls.push({ method: "put", key, value });
      values.set(key, value);
    },
  };
}

function d1(link: Link | null, claims: Array<{ hostname: string; cloudflare_id: string | null }>, changes = 1) {
  const prepared: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepared,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          prepared.push({ sql, args });
          return {
            async first() {
              return sql.includes("runtime_project_links") ? link : null;
            },
            async all() {
              return { results: sql.includes("runtime_custom_domain_claims") ? claims : [] };
            },
            async run() {
              return { success: true, meta: { changes } };
            },
          };
        },
      };
    },
  };
  return db;
}

function env(
  routes: ReturnType<typeof kv>,
  db: ReturnType<typeof d1>,
  environment = "staging",
  stagingRouteKvId = STAGING_KV_ID,
) {
  return {
    STAGING_ROUTES: routes,
    DB: db,
    ENVIRONMENT: environment,
    STAGING_ROUTE_KV_ID: stagingRouteKvId,
  } as any;
}

const link = (overrides: Partial<Link> = {}): Link => ({
  subdomain_slug: "owner",
  deployment_script_name: "owner_script",
  custom_domain_cloudflare_id: null,
  custom_domain_secondary_cloudflare_id: null,
  ...overrides,
});

test("enforces the isolated staging route KV binding before cleanup", async () => {
  assert.throws(
    () => assertRouteBinding({ ENVIRONMENT: "staging", STAGING_ROUTE_KV_ID: "wrong" } as any),
    /ISOLATED_ROUTE_KV_REQUIRED/,
  );
  const routes = kv({ owner: "route" });
  const database = d1(link(), []);
  await assert.rejects(
    deleteProjectWithRoutes(env(routes, database, "staging", "wrong"), 7),
    /ISOLATED_ROUTE_KV_REQUIRED/,
  );
  assert.deepEqual(routes.calls, []);
  assert.equal(database.prepared.length, 0);
});

test("launch route writes require the exact private production KV", async () => {
  const routes = kv({});
  const launchEnv = {
    STAGING_ROUTES: routes,
    ENVIRONMENT: "production",
    CONTROL_PLANE_PROFILE: "launch",
    STAGING_ROUTE_KV_ID: "248ac5b6821a475794a7fe3d2b0c3718",
    CONTROL_PLANE_ROUTE_KV_ID: "248ac5b6821a475794a7fe3d2b0c3718",
  } as any;
  await writePublishedRoute(launchEnv, "launch-project", "bc-r-launch", {});
  assert.equal(routes.values.get("launch-project"), JSON.stringify({ scriptName: "bc-r-launch", metadata: {} }));
  await assert.rejects(writePublishedRoute({ ...launchEnv, STAGING_ROUTE_KV_ID: "wrong" }, "other", "bc-r-other", {}), /LAUNCH_ROUTE_KV_REQUIRED/);
});

test("refuses to delete when the slug route belongs to another owner", async () => {
  const routes = kv({
    owner: JSON.stringify({ scriptName: "different_script", metadata: {} }),
    "preview:owner": "preview",
  });
  const database = d1(link(), []);

  await assert.rejects(
    deleteProjectWithRoutes(env(routes, database), 7),
    /Published route does not belong to this project/,
  );
  assert.deepEqual([...routes.values], [
    ["owner", JSON.stringify({ scriptName: "different_script", metadata: {} })],
    ["preview:owner", "preview"],
  ]);
  assert.equal(database.prepared.some(({ sql }) => sql.startsWith("DELETE FROM projects")), false);
});

test("refuses to delete a hostname mapping for a different project", async () => {
  const ownerRoute = JSON.stringify({ scriptName: "owner_script", metadata: {} });
  const routes = kv({
    owner: ownerRoute,
    "preview:owner": "preview",
    "hostname:example.test": JSON.stringify({ slug: "other-owner" }),
  });
  const database = d1(link(), [{ hostname: "example.test", cloudflare_id: null }]);

  await assert.rejects(
    deleteProjectWithRoutes(env(routes, database), 7),
    /Hostname route does not belong to this project/,
  );
  assert.deepEqual([...routes.values].sort(([a], [b]) => a.localeCompare(b)), [
    ["hostname:example.test", JSON.stringify({ slug: "other-owner" })],
    ["owner", ownerRoute],
    ["preview:owner", "preview"],
  ].sort(([a], [b]) => a.localeCompare(b)));
  assert.equal(database.prepared.some(({ sql }) => sql.startsWith("DELETE FROM projects")), false);
});

test("deletes the slug, preview, hostname mapping, and D1 project together", async () => {
  const routes = kv({
    owner: JSON.stringify({ scriptName: "owner_script", metadata: { title: "Owner" } }),
    "preview:owner": "preview-value",
    "hostname:example.test": JSON.stringify({ slug: "owner" }),
  });
  const database = d1(link(), [{ hostname: "example.test", cloudflare_id: null }]);

  await deleteProjectWithRoutes(env(routes, database), 7);

  assert.deepEqual([...routes.values], []);
  assert.deepEqual(
    routes.calls.filter(({ method }) => method === "delete").map(({ key }) => key),
    ["owner", "preview:owner", "hostname:example.test"],
  );
  const deletion = database.prepared.find(({ sql }) => sql.startsWith("DELETE FROM projects"));
  assert.deepEqual(deletion, { sql: "DELETE FROM projects WHERE id=?", args: [7] });
});

test("restores every removed KV value when the D1 project deletion fails", async () => {
  const original = {
    owner: JSON.stringify({ scriptName: "owner_script", metadata: {} }),
    "preview:owner": "preview-value",
    "hostname:example.test": "owner",
  };
  const routes = kv(original);
  const database = d1(link(), [{ hostname: "example.test", cloudflare_id: null }], 0);

  await assert.rejects(deleteProjectWithRoutes(env(routes, database), 7), /Project not found/);
  assert.deepEqual([...routes.values], Object.entries(original));
  assert.deepEqual(
    routes.calls.filter(({ method }) => method === "put").map(({ key, value }) => [key, value]),
    Object.entries(original),
  );
});

test("refuses claims and link mappings that still have a Cloudflare ID", async () => {
  const claimRoutes = kv({});
  const claimDb = d1(link(), [{ hostname: "example.test", cloudflare_id: "cf-claim" }]);
  await assert.rejects(
    deleteProjectWithRoutes(env(claimRoutes, claimDb), 7),
    /Remove verified Cloudflare custom hostnames/,
  );
  assert.equal(claimRoutes.calls.length, 0);

  const linkRoutes = kv({});
  const linkDb = d1(link({ custom_domain_cloudflare_id: "cf-link" }), []);
  await assert.rejects(
    deleteProjectWithRoutes(env(linkRoutes, linkDb), 7),
    /Remove verified Cloudflare custom hostnames/,
  );
  assert.equal(linkRoutes.calls.length, 0);
});