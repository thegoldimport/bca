import assert from "node:assert/strict";
import test from "node:test";
import {
  getPublishedProjectRouteValue,
  removePublishedCustomHostname,
  removePublishedProjectRoute,
  restorePublishedProjectRouteValue,
  setPublishedCustomHostname,
  setPublishedProjectRoute,
} from "../server/published-routes";

const env = {
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_ROUTES_KV_NAMESPACE_ID: "namespace",
  WORKERSKV: "test-token",
};

test("published route operations preserve exact KV values and metadata", async (t) => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, env);
  t.after(() => {
    process.env = originalEnv;
  });

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (!init?.method) return new Response('{"scriptName":"old","metadata":{"title":"Exact"}}');
    return new Response("ok");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const exact = await getPublishedProjectRouteValue("my-site");
  await removePublishedProjectRoute("my-site");
  await restorePublishedProjectRouteValue("my-site", exact!);
  await setPublishedProjectRoute("my-site", "new-script", { title: "New", faviconData: "data:image/png;base64,a" });
  await setPublishedCustomHostname("www.example.com", "my-site");
  await removePublishedCustomHostname("www.example.com");

  assert.equal(exact, '{"scriptName":"old","metadata":{"title":"Exact"}}');
  assert.equal(calls[1].init?.method, "DELETE");
  assert.equal(calls[2].init?.body, exact);
  assert.deepEqual(JSON.parse(String(calls[3].init?.body)), {
    scriptName: "new-script",
    metadata: { title: "New", faviconData: "data:image/png;base64,a" },
  });
  assert.match(calls[4].url, /hostname%3Awww\.example\.com$/);
  assert.equal(calls[4].init?.body, "my-site");
  assert.equal(calls[5].init?.method, "DELETE");
});