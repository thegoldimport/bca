import assert from "node:assert/strict";
import test from "node:test";
import gateway, { metadataTags, rewriteRootAbsoluteCss, rewriteRootAbsoluteUrl, stagingPath } from "../infrastructure/buildcustom-apps-gateway-staging.js";

const route = JSON.stringify({ scriptName: "staging-app", metadata: { title: "Staging app", allowIndexing: true } });
function env(extra = {}) {
  return {
    ROUTES: { get: async (key, type) => key === "demo" ? route : key === "preview:demo" && type === "arrayBuffer" ? new Uint8Array([1, 2]).buffer : null },
    DISPATCHER: { get: (name) => ({ fetch: async (request) => new Response(`<html><head></head><body><img src="/assets/logo.svg"><a href="/about">About</a><p>${name}:${new URL(request.url).pathname}</p></body></html>`, { headers: { "content-type": "text/html" } }) }) },
    ...extra,
  };
}

test("only the staging host and reserved slug path resolve", () => {
  assert.deepEqual(stagingPath("/p/demo/"), { slug: "demo", path: "/", trailingSlash: true });
  assert.deepEqual(stagingPath("/p/demo/assets/app.js"), { slug: "demo", path: "/assets/app.js", trailingSlash: true });
  assert.equal(stagingPath("/demo/"), null);
  assert.equal(rewriteRootAbsoluteUrl("/assets/app.js", "demo"), "/p/demo/assets/app.js");
  assert.equal(rewriteRootAbsoluteUrl("//cdn.example/app.js", "demo"), "//cdn.example/app.js");
  assert.equal(rewriteRootAbsoluteCss('body{background:url("/img/bg.png")} @import "/css/site.css";', "demo"), 'body{background:url("/p/demo/img/bg.png")} @import "/p/demo/css/site.css";');
  assert.equal(metadataTags({}), "");
});

test("bare project path redirects before dispatch and preserves query", async () => {
  let dispatched = false;
  const response = await gateway.fetch(new Request("https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev/p/demo?from=bare"), {
    ...env({ DISPATCHER: { get: () => { dispatched = true; return { fetch: async () => new Response("bad") }; } } }),
  });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev/p/demo/?from=bare");
  assert.equal(dispatched, false);
});

test("staging gateway dispatches only the KV-resolved script after stripping prefix", async () => {
  let seen;
  const response = await gateway.fetch(new Request("https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev/p/demo/"), {
    ...env({ DISPATCHER: { get: (name) => { seen = name; return { fetch: async (request) => new Response(`path:${new URL(request.url).pathname}`, { headers: { "content-type": "text/plain" } }) }; } } }),
  });
  assert.equal(seen, "staging-app");
  assert.equal(await response.text(), "path:/");
});

test("asset requests retain the slug boundary while dispatching app-relative paths", async () => {
  let seenPath;
  const response = await gateway.fetch(new Request("https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev/p/demo/assets/app.js?v=1"), {
    ...env({ DISPATCHER: { get: () => ({ fetch: async (request) => {
      seenPath = new URL(request.url).pathname + new URL(request.url).search;
      return new Response("asset", { headers: { "content-type": "text/javascript" } });
    } }) } }),
  });
  assert.equal(seenPath, "/assets/app.js?v=1");
  assert.equal(await response.text(), "asset");
});

test("root-relative redirects are rewritten at the gateway boundary", async () => {
  const response = await gateway.fetch(new Request("https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev/p/demo/login"), {
    ...env({ DISPATCHER: { get: () => ({ fetch: async () => new Response(null, { status: 302, headers: { Location: "/login/" } }) }) } }),
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/p/demo/login/");
});

test("rejects non-staging hosts and URL script-name injection", async () => {
  let dispatched = false;
  const e = env({ DISPATCHER: { get: () => { dispatched = true; return { fetch: async () => new Response("bad") }; } } });
  assert.equal((await gateway.fetch(new Request("https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev/deployed/staging-app"), e)).status, 404);
  assert.equal((await gateway.fetch(new Request("https://buildcustom-control-plane-staging.thegoldimport.workers.dev/p/demo/"), e)).status, 404);
  assert.equal(dispatched, false);
});

test("route-check, preview, robots and sitemap stay under the staging prefix", async () => {
  const e = env();
  const routeCheck = await gateway.fetch(new Request("https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev/p/demo/_buildcustom/route-check"), e);
  assert.equal(routeCheck.status, 200);
  assert.equal((await routeCheck.json()).scriptName, "staging-app");
  assert.equal((await gateway.fetch(new Request("https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev/p/demo/_buildcustom/preview-image"), e)).headers.get("content-type"), "image/jpeg");
  const robots = await gateway.fetch(new Request("https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev/p/demo/robots.txt"), e);
  assert.match(await robots.text(), /\/p\/demo\/sitemap\.xml/);
});