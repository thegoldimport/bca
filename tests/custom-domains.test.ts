import assert from "node:assert/strict";
import test from "node:test";
import {
  createCustomHostname,
  buildDnsReplacementPlan,
  classifyHostname,
  customDomainRecords,
  customDomainUpdate,
  domainLifecycle,
  normalizeCustomDomain,
  nameserverActivationReady,
  nameserversMatchExpected,
  parseNameserverDnsResponse,
  proposedBuildCustomWebsiteRecords,
  removeCnameFollowedAddresses,
  routingStatusAfterVerification,
  selectNameserverConsensus,
  validateExpectedNameservers,
  verifyCustomDomainRouting,
} from "../server/custom-domains";

function dnsName(name: string) {
  return Buffer.concat([
    ...name.split(".").map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])),
    Buffer.from([0]),
  ]);
}

function nameserverResponse(options: {
  id?: number;
  name?: string;
  nameserver?: string;
  flags?: number;
  owner?: Buffer;
  dataLength?: number;
  target?: Buffer;
}) {
  const id = options.id ?? 0x1234;
  const name = options.name ?? "example.com";
  const nameserver = options.nameserver ?? "brad.ns.cloudflare.com";
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(options.flags ?? 0x8400, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(1, 6);
  const question = Buffer.concat([dnsName(name), Buffer.from([0, 2, 0, 1])]);
  const owner = options.owner ?? Buffer.from([0xc0, 0x0c]);
  const target = options.target ?? dnsName(nameserver);
  const recordHeader = Buffer.alloc(10);
  recordHeader.writeUInt16BE(2, 0);
  recordHeader.writeUInt16BE(1, 2);
  recordHeader.writeUInt32BE(300, 4);
  recordHeader.writeUInt16BE(options.dataLength ?? target.length, 8);
  return Buffer.concat([header, question, owner, recordHeader, target]);
}

test("custom domains are normalized and BuildCustom-owned hostnames are rejected", () => {
  assert.equal(normalizeCustomDomain("HTTPS://App.Example.COM/path"), "app.example.com");
  assert.throws(() => normalizeCustomDomain("test1.apps.buildcustom.ai"), /customer-owned domain/);
  assert.throws(() => normalizeCustomDomain("not a hostname"), /valid domain/);
});

test("hostname classification follows the public suffix list", () => {
  assert.deepEqual(classifyHostname("example.co.uk"), { hostname: "example.co.uk", kind: "apex", registrableDomain: "example.co.uk" });
  assert.deepEqual(classifyHostname("www.example.co.uk"), { hostname: "www.example.co.uk", kind: "www", registrableDomain: "example.co.uk" });
  assert.deepEqual(classifyHostname("app.example.co.uk"), { hostname: "app.example.co.uk", kind: "subdomain", registrableDomain: "example.co.uk" });
});

test("DNS replacement plan separates website conflicts, protected records, and ambiguous aliases", () => {
  const plan = buildDnsReplacementPlan([
    { type: "A", name: "example.com", value: "192.0.2.10" },
    { type: "CNAME", name: "www.example.com", value: "legacy.example.net" },
    { type: "MX", name: "example.com", value: "10 mail.example.com" },
    { type: "TXT", name: "example.com", value: "v=spf1 include:_spf.example.net ~all" },
    { type: "TXT", name: "selector._domainkey.example.com", value: "v=DKIM1; p=key" },
    { type: "TXT", name: "_verify.example.com", value: "provider-token" },
    { type: "SRV", name: "_sip._tcp.example.com", value: "10 5 443 sip.example.com" },
    { type: "CNAME", name: "ftp.example.com", value: "example.com" },
    { type: "A", name: "cpanel.example.com", value: "192.0.2.11" },
  ], "example.com");

  assert.deepEqual(plan.counts, { replace: 2, keep: 6, review: 1 });
  assert.equal(plan.records.find((record) => record.name === "ftp.example.com")?.action, "review");
  assert.equal(plan.records.find((record) => record.name === "ftp.example.com")?.proxyGuidance, "dns_only");
  assert.equal(plan.records.find((record) => record.name === "cpanel.example.com")?.proxyGuidance, "dns_only");
  assert.equal(plan.records.find((record) => record.name === "_verify.example.com")?.action, "keep");
});

test("proposed BuildCustom website records show root and www without changing DNS", (t) => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    CLOUDFLARE_ZONE_ID: "zone",
    CLOUDFLARE_API_TOKEN: "token",
    CLOUDFLARE_CUSTOM_HOSTNAME_TARGET: "customers.buildcustom.ai",
  });
  t.after(() => { process.env = originalEnv; });

  assert.deepEqual(proposedBuildCustomWebsiteRecords("example.com"), [
    { type: "CNAME", name: "example.com", value: "customers.buildcustom.ai" },
    { type: "CNAME", name: "www.example.com", value: "customers.buildcustom.ai" },
  ]);
});

test("a non-www subdomain replaces and proposes only the inspected hostname", (t) => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    CLOUDFLARE_ZONE_ID: "zone",
    CLOUDFLARE_API_TOKEN: "token",
    CLOUDFLARE_CUSTOM_HOSTNAME_TARGET: "customers.buildcustom.ai",
  });
  t.after(() => { process.env = originalEnv; });
  const plan = buildDnsReplacementPlan([
    { type: "A", name: "example.com", value: "192.0.2.10" },
    { type: "CNAME", name: "www.example.com", value: "legacy.example.net" },
    { type: "CNAME", name: "app.example.com", value: "old-app.example.net" },
  ], "example.com", "app.example.com");

  assert.equal(plan.records.find((record) => record.name === "app.example.com")?.action, "replace");
  assert.equal(plan.records.find((record) => record.name === "example.com")?.action, "review");
  assert.equal(plan.records.find((record) => record.name === "www.example.com")?.action, "review");
  assert.deepEqual(proposedBuildCustomWebsiteRecords("example.com", "app.example.com"), [
    { type: "CNAME", name: "app.example.com", value: "customers.buildcustom.ai" },
  ]);
});

test("DNS discovery does not present CNAME target addresses as customer-owned records", () => {
  assert.deepEqual(removeCnameFollowedAddresses([
    { type: "CNAME", name: "www.example.com", value: "legacy.host.example" },
    { type: "A", name: "www.example.com", value: "192.0.2.20" },
    { type: "AAAA", name: "www.example.com", value: "2001:db8::20" },
    { type: "A", name: "example.com", value: "192.0.2.10" },
  ]), [
    { type: "CNAME", name: "www.example.com", value: "legacy.host.example" },
    { type: "A", name: "example.com", value: "192.0.2.10" },
  ]);
});

test("customer Cloudflare nameservers must be two distinct assigned hosts", () => {
  assert.deepEqual(validateExpectedNameservers(["BRAD.NS.CLOUDFLARE.COM.", "ollie.ns.cloudflare.com"]), [
    "brad.ns.cloudflare.com",
    "ollie.ns.cloudflare.com",
  ]);
  assert.throws(() => validateExpectedNameservers(["ns1.example.com", "ns2.example.com"]), /\.ns\.cloudflare\.com/);
  assert.throws(() => validateExpectedNameservers(["brad.ns.cloudflare.com", "brad.ns.cloudflare.com"]), /two different/);
});

test("authoritative nameservers must exactly match the expected Cloudflare pair", () => {
  const expected = ["brad.ns.cloudflare.com", "ollie.ns.cloudflare.com"];
  assert.equal(nameserversMatchExpected(expected, expected), true);
  assert.equal(nameserversMatchExpected([...expected, "ns1.legacy.example"], expected), false);
  assert.equal(nameserversMatchExpected([expected[0]], expected), false);
});

test("nameserver activation requires parent delegation and authoritative Cloudflare answers", () => {
  const expected = ["brad.ns.cloudflare.com", "ollie.ns.cloudflare.com"];
  assert.equal(nameserverActivationReady(expected, expected, true), true);
  assert.equal(nameserverActivationReady(expected, expected, false), false);
  assert.equal(nameserverActivationReady(["ns1.legacy.example", "ns2.legacy.example"], expected, true), false);
});

test("direct DNS parser accepts an exact compressed authoritative NS response", () => {
  const packet = nameserverResponse({});
  assert.deepEqual(parseNameserverDnsResponse(packet, { id: 0x1234, name: "example.com" }), {
    authoritative: true,
    nameservers: ["brad.ns.cloudflare.com"],
  });
});

test("direct DNS parser rejects untrusted or malformed responses", () => {
  assert.throws(
    () => parseNameserverDnsResponse(nameserverResponse({}), { id: 0x4321, name: "example.com" }),
    /Mismatched DNS response ID/,
  );
  assert.throws(
    () => parseNameserverDnsResponse(nameserverResponse({ flags: 0x0400 }), { id: 0x1234, name: "example.com" }),
    /not a response/,
  );
  assert.throws(
    () => parseNameserverDnsResponse(nameserverResponse({ flags: 0x8600 }), { id: 0x1234, name: "example.com" }),
    /Truncated UDP/,
  );
  assert.throws(
    () => parseNameserverDnsResponse(nameserverResponse({ dataLength: 512 }), { id: 0x1234, name: "example.com" }),
    /Truncated DNS record data/,
  );
  assert.throws(
    () => parseNameserverDnsResponse(nameserverResponse({ owner: Buffer.from([0xc0, 0x1d]) }), { id: 0x1234, name: "example.com" }),
    /compression loop/,
  );
});

test("direct DNS parser ignores NS records for an unrelated owner", () => {
  const packet = nameserverResponse({ owner: dnsName("other.example.com") });
  assert.deepEqual(
    parseNameserverDnsResponse(packet, { id: 0x1234, name: "example.com" }).nameservers,
    [],
  );
});

test("direct DNS parser enforces exact NS record framing", () => {
  const target = dnsName("brad.ns.cloudflare.com");
  assert.throws(
    () => parseNameserverDnsResponse(
      nameserverResponse({ target, dataLength: target.length - 2 }),
      { id: 0x1234, name: "example.com" },
    ),
    /Invalid NS record data length/,
  );
  assert.throws(
    () => parseNameserverDnsResponse(
      nameserverResponse({ target: Buffer.concat([target, Buffer.from([0])]) }),
      { id: 0x1234, name: "example.com" },
    ),
    /Invalid NS record data length/,
  );
  assert.deepEqual(
    parseNameserverDnsResponse(
      nameserverResponse({ target: Buffer.from([0xc0, 0x0c]) }),
      { id: 0x1234, name: "example.com" },
    ).nameservers,
    ["example.com"],
  );
});

test("parent delegation requires a unique strict consensus", () => {
  assert.deepEqual(selectNameserverConsensus([
    { nameservers: ["brad.ns.cloudflare.com", "ollie.ns.cloudflare.com"], count: 3 },
    { nameservers: ["ns1.legacy.example", "ns2.legacy.example"], count: 1 },
  ]), ["brad.ns.cloudflare.com", "ollie.ns.cloudflare.com"]);
  assert.throws(() => selectNameserverConsensus([
    { nameservers: ["brad.ns.cloudflare.com", "ollie.ns.cloudflare.com"], count: 2 },
    { nameservers: ["ns1.legacy.example", "ns2.legacy.example"], count: 2 },
  ]), /strict delegation consensus/);
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

test("routing verification reaches the customer hostname and requires the expected project context", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return Response.json({
      ok: true,
      project: "test1",
      redirectTo: null,
      purpose: "website",
      role: "primary",
      primaryHostname: "buyermagnets.com",
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  assert.equal(await verifyCustomDomainRouting("buyermagnets.com", "test1", null, {
    purpose: "website",
    role: "primary",
    primaryHostname: "buyermagnets.com",
  }), true);
  const url = new URL(requestedUrl);
  assert.equal(url.hostname, "buyermagnets.com");
  assert.equal(url.pathname, "/_buildcustom/route-check");
  assert.ok(url.searchParams.get("probe"));
  assert.equal(requestedInit?.redirect, "manual");
  assert.equal(new Headers(requestedInit?.headers).get("cache-control"), "no-cache");
  assert.equal(await verifyCustomDomainRouting("buyermagnets.com", "another-project"), false);
});

test("routing verification keeps an old or unrelated customer site in connecting state", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>old site</html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  const verified = await verifyCustomDomainRouting("buyermagnets.com", "test1");
  assert.equal(verified, false);
  assert.equal(routingStatusAfterVerification("live", verified), "connecting");
  assert.equal(routingStatusAfterVerification("pending_dns", verified), "pending_dns");
  assert.equal(routingStatusAfterVerification("live", true), "live");
});

test("secondary routing verification requires an exact path and query preserving 301", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    const url = new URL(requestedUrl);
    return new Response(null, {
      status: 301,
      headers: { Location: `https://buyermagnets.com${url.pathname}${url.search}` },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  assert.equal(await verifyCustomDomainRouting("www.buyermagnets.com", "test1", "buyermagnets.com"), true);
  const url = new URL(requestedUrl);
  assert.equal(url.hostname, "www.buyermagnets.com");
  assert.match(url.pathname, /^\/_buildcustom\/route-check\/[a-f0-9]{16}$/);
  assert.equal(url.searchParams.get("probe"), url.pathname.split("/").at(-1));

  globalThis.fetch = async () => new Response(null, {
    status: 301,
    headers: { Location: "https://buyermagnets.com/wrong-path" },
  });
  assert.equal(await verifyCustomDomainRouting("www.buyermagnets.com", "test1", "buyermagnets.com"), false);
});