import assert from "node:assert/strict";
import test from "node:test";
import {
  createCustomHostname,
  customDomainRecords,
  customDomainUpdate,
  domainLifecycle,
  normalizeCustomDomain,
} from "../server/custom-domains";

test("custom domains are normalized and BuildCustom-owned hostnames are rejected", () => {
  assert.equal(normalizeCustomDomain("HTTPS://App.Example.COM/path"), "app.example.com");
  assert.throws(() => normalizeCustomDomain("test1.apps.buildcustom.ai"), /customer-owned domain/);
  assert.throws(() => normalizeCustomDomain("not a hostname"), /valid domain/);
});

test("Cloudflare states map to the customer domain lifecycle", () => {
  assert.equal(domainLifecycle({ status: "pending", ssl: { status: "pending_validation" } }), "pending_dns");
  assert.equal(domainLifecycle({ status: "active", ssl: { status: "pending_validation" } }), "verifying");
  assert.equal(domainLifecycle({ status: "active", ssl: { status: "pending_deployment" } }), "ssl_provisioning");
  assert.equal(domainLifecycle({ status: "active", ssl: { status: "active" } }), "live");
  assert.equal(domainLifecycle({ status: "blocked", ssl: { status: "active" } }), "error");
});

test("DNS instructions include the configured route and Cloudflare validation records", (t) => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    CLOUDFLARE_ZONE_ID: "zone",
    CLOUDFLARE_API_TOKEN: "token",
    CLOUDFLARE_CUSTOM_HOSTNAME_TARGET: "customers.buildcustom.ai",
  });
  t.after(() => { process.env = originalEnv; });

  assert.deepEqual(customDomainRecords({
    hostname: "app.example.com",
    ownership_verification: { type: "txt", name: "_cf-custom-hostname.app.example.com", value: "ownership" },
    ssl: {
      validation_records: [
        { txt_name: "_acme-challenge.app.example.com", txt_value: "certificate" },
      ],
    },
  }), [
    { type: "CNAME", name: "app.example.com", value: "customers.buildcustom.ai" },
    { type: "TXT", name: "_cf-custom-hostname.app.example.com", value: "ownership" },
    { type: "TXT", name: "_acme-challenge.app.example.com", value: "certificate" },
  ]);
});

test("custom hostname creation requests TXT validation and stores safe state", async (t) => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    CLOUDFLARE_ZONE_ID: "zone",
    CLOUDFLARE_API_TOKEN: "token",
    CLOUDFLARE_CUSTOM_HOSTNAME_TARGET: "customers.buildcustom.ai",
  });
  t.after(() => { process.env = originalEnv; });

  let requestBody: any;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      success: true,
      result: {
        id: "hostname-id",
        hostname: "app.example.com",
        status: "pending",
        ssl: { status: "pending_validation" },
        ownership_verification: { type: "txt", name: "_verify.app.example.com", value: "verify" },
      },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await createCustomHostname("app.example.com");
  const update = customDomainUpdate(result);

  assert.equal(requestBody.hostname, "app.example.com");
  assert.equal(requestBody.ssl.method, "txt");
  assert.equal(requestBody.ssl.type, "dv");
  assert.equal(update.customDomainCloudflareId, "hostname-id");
  assert.equal(update.customDomainStatus, "pending_dns");
  assert.equal(update.customDomainDnsRecords[0].value, "customers.buildcustom.ai");
});

test("missing Cloudflare for SaaS quota becomes a clear configuration error", async (t) => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    CLOUDFLARE_ZONE_ID: "zone",
    CLOUDFLARE_API_TOKEN: "token",
    CLOUDFLARE_CUSTOM_HOSTNAME_TARGET: "customers.buildcustom.ai",
  });
  t.after(() => { process.env = originalEnv; });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    success: false,
    errors: [{ code: 1404, message: "No quota has been allocated" }],
  }, { status: 403 });
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(createCustomHostname("app.example.com"), /Cloudflare for SaaS is not enabled/);
});