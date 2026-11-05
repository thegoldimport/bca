import assert from "node:assert/strict";
import test from "node:test";
import { adminDeploymentLinks, validManagedAppSlug } from "../cloudflare/admin-deployment-url";

test("admin links use the customer-facing managed hostname and keep a sanitized gateway diagnostic", () => {
  const links = adminDeploymentLinks({
    storedUrl: "https://gateway.example.workers.dev/p/site?token=private#private",
    slug: "customer-site",
    publicAppsEnabled: true,
  });
  assert.deepEqual(links, {
    deploymentUrl: "https://customer-site.apps.buildcustom.ai/",
    diagnosticUrl: "https://gateway.example.workers.dev/p/site",
  });
});

test("managed hostnames reject reserved or malformed slugs", () => {
  for (const slug of ["api", "admin", "bad slug", "-site", "site-"]) {
    assert.equal(validManagedAppSlug(slug), false, `${slug} must be rejected`);
  }
  assert.equal(validManagedAppSlug("customer-site"), true);
  assert.deepEqual(adminDeploymentLinks({
    storedUrl: "https://gateway.example.workers.dev/p/site",
    slug: "api",
    publicAppsEnabled: true,
  }), {
    deploymentUrl: null,
    diagnosticUrl: "https://gateway.example.workers.dev/p/site",
  });
});

test("custom domains require the product Live state and active SSL", () => {
  const storedUrl = "https://gateway.example.workers.dev/p/site";
  assert.equal(adminDeploymentLinks({
    storedUrl,
    slug: "customer-site",
    publicAppsEnabled: true,
    customDomains: [{ hostname: "site.example.com", status: "active", sslStatus: "active", isPrimary: true }],
  }).deploymentUrl, "https://customer-site.apps.buildcustom.ai/");

  assert.equal(adminDeploymentLinks({
    storedUrl,
    slug: "customer-site",
    publicAppsEnabled: true,
    customDomains: [{ hostname: "site.example.com", status: "live", sslStatus: "active", isPrimary: true }],
  }).deploymentUrl, "https://site.example.com/");

  assert.equal(adminDeploymentLinks({
    storedUrl,
    slug: "customer-site",
    publicAppsEnabled: true,
    customDomains: [{ hostname: "site.example.com/path", status: "live", sslStatus: "active", isPrimary: true }],
  }).deploymentUrl, "https://customer-site.apps.buildcustom.ai/");
});

test("secondary domains never replace the primary deployment address", () => {
  assert.equal(adminDeploymentLinks({
    storedUrl: "https://gateway.example.workers.dev/p/site",
    slug: "customer-site",
    publicAppsEnabled: true,
    customDomains: [{ hostname: "alias.example.com", status: "live", sslStatus: "active", isPrimary: false }],
  }).deploymentUrl, "https://customer-site.apps.buildcustom.ai/");
});

test("managed links stay disabled unless the product makes generated apps public", () => {
  assert.equal(adminDeploymentLinks({
    storedUrl: "https://gateway.example.workers.dev/p/site",
    slug: "customer-site",
    publicAppsEnabled: false,
  }).deploymentUrl, null);
});
