import assert from "node:assert/strict";
import test from "node:test";
import { deleteProjectAndPublishedRoute, PublishedRouteRestoreError } from "../server/project-deletion";

test("project deletion removes its public route", async () => {
  const events: string[] = [];
  await deleteProjectAndPublishedRoute(42, { subdomainSlug: "customer-site", deploymentUrl: "https://customer-site.apps.buildcustom.ai" }, {
    getRouteValue: async () => '{"scriptName":"site-worker","metadata":{"title":"Customer"}}',
    removeRoute: async (slug) => { events.push(`remove:${slug}`); },
    restoreRouteValue: async () => { throw new Error("must not restore"); },
    deleteProject: async (id) => { events.push(`delete:${id}`); },
  });
  assert.deepEqual(events, ["remove:customer-site", "delete:42"]);
});

test("database failure restores the exact route value", async () => {
  const exactValue = '{"scriptName":"site-worker","metadata":{"title":"Customer","allowIndexing":false}}';
  let restored: { slug: string; value: string } | undefined;
  const databaseError = new Error("injected database failure");

  await assert.rejects(
    deleteProjectAndPublishedRoute(42, { subdomainSlug: "customer-site", deploymentUrl: "published" }, {
      getRouteValue: async () => exactValue,
      removeRoute: async () => undefined,
      restoreRouteValue: async (slug, value) => { restored = { slug, value }; },
      deleteProject: async () => { throw databaseError; },
    }),
    databaseError,
  );
  assert.deepEqual(restored, { slug: "customer-site", value: exactValue });
});

test("a failed compensation remains distinguishable from the database failure", async () => {
  await assert.rejects(
    deleteProjectAndPublishedRoute(42, { subdomainSlug: "customer-site", deploymentUrl: "published" }, {
      getRouteValue: async () => "site-worker",
      removeRoute: async () => undefined,
      restoreRouteValue: async () => { throw new Error("injected restore failure"); },
      deleteProject: async () => { throw new Error("injected database failure"); },
    }),
    PublishedRouteRestoreError,
  );
});