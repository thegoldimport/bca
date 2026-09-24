import assert from "node:assert/strict";
import test from "node:test";
import {
  checkStagingAppReady, requiredAssets, renderedBodyHasContent,
  StagingPublishNotReadyError, waitForStagingAppReady,
} from "../cloudflare/staging/published-readiness";

const url = "https://fixture.staging.buildcustom.ai/";
const html = `<html><body><div id="root"></div>
<link rel="stylesheet" href="/styles.css?v=1">
<script src="/app.js" defer></script>
<a href="/about">About</a>
<script>const fake = '<link href="/absent.css"><script src="/absent.js">';</script>
<script src="https://cdn.example/remote.js"></script></body></html>`;

function gateway(cssType = "text/css"): Fetcher {
  return { fetch: async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response(html, { headers: { "content-type": "text/html", "cache-control": "public, max-age=0, must-revalidate" } });
    if (path === "/styles.css") return new Response("body{}", { headers: { "content-type": cssType } });
    if (path === "/app.js") return new Response("document.body.textContent='Hello app'", { headers: { "content-type": "application/javascript" } });
    return new Response("<html>Fallback</html>", { headers: { "content-type": "text/html" } });
  } } as Fetcher;
}

const browser = { quickAction: async () => Response.json({
  result: "<html><body><div id=\"root\"><h1>Hello app</h1></div></body></html>",
}) };

test("required assets exclude navigation, remote CDN, and inline script strings", () => {
  assert.deepEqual(requiredAssets(html, url), [
    { path: "/styles.css?v=1", kind: "css" }, { path: "/app.js", kind: "js" },
  ]);
  assert.equal(renderedBodyHasContent("<html><body><div id=\"root\"></div><script>Ready</script></body></html>"), false);
  assert.equal(renderedBodyHasContent("<html><body><div id=\"root\">Ready to use</div></body></html>"), true);
});

test("readiness requires successful assets with correct MIME and rendered body", async () => {
  assert.deepEqual(await checkStagingAppReady(url, gateway(), browser), { assets: 2 });
  assert.equal((await checkStagingAppReady(url, gateway("text/html"), browser)).failure?.path, "/styles.css?v=1");
  assert.equal((await checkStagingAppReady(url, gateway(), {
    quickAction: async () => new Response("<html><body><div id=\"root\"></div></body></html>"),
  })).failure?.layer, "rendered-content");
});

test("bounded readiness retries the existing deployment without creating another", async () => {
  let clock = 0;
  let routeCalls = 0;
  let assetCalls = 0;
  const staged = { fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/styles.css") {
      assetCalls++;
      if (assetCalls === 1) return new Response("not ready", { status: 404, headers: { "content-type": "text/html" } });
    }
    return gateway().fetch(request);
  } } as Fetcher;
  const ready = await waitForStagingAppReady(url, staged, browser, async () => {
    routeCalls++;
    if (routeCalls === 1) throw new Error("KV not visible yet");
  }, { now: () => clock, sleep: async (ms) => { clock += ms; }, timeoutMs: 5000 });
  assert.equal(ready.attempts, 3);
  assert.equal(ready.elapsedMs, 1500);
  assert.equal(routeCalls, 3);
  assert.equal(assetCalls, 2);
});

test("readiness times out with a clear layer and bounded attempts", async () => {
  let clock = 0;
  await assert.rejects(
    waitForStagingAppReady(url, gateway("text/html"), browser, async () => {},
      { now: () => clock, sleep: async (ms) => { clock += ms; }, timeoutMs: 1600 }),
    (error: unknown) => error instanceof StagingPublishNotReadyError
      && error.failure.layer === "asset" && error.attempts === 3 && error.elapsedMs === 1600,
  );
});