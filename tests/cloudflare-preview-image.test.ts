import assert from "node:assert/strict";
import test from "node:test";
import { capturePreviewImage, imageDataUri, previewImageKey, verifyPublicHostnameRoute } from "../cloudflare/staging/preview-image";
import { hasExactStagingGatewayConfig, managedStagingPublishUrl, verifyManagedStagingRoute } from "../cloudflare/worker";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

test("Browser Run screenshot helper requests the current publish preview contract", async () => {
  let request: Record<string, unknown> | undefined;
  const browser = {
    quickAction: async (_action: "screenshot", options: Record<string, unknown>) => {
      request = options;
      return new Response(jpeg, { headers: { "Content-Type": "image/jpeg" } });
    },
  };
  const result = await capturePreviewImage(browser, "https://gateway.test/p/demo/");
  assert.deepEqual([...result], [...jpeg]);
  assert.deepEqual(request, {
    url: "https://gateway.test/p/demo/",
    viewport: { width: 1200, height: 630, deviceScaleFactor: 1 },
    gotoOptions: { waitUntil: "networkidle2", timeout: 30_000 },
    waitForTimeout: 1_200,
    screenshotOptions: { type: "jpeg", quality: 85, fullPage: false, captureBeyondViewport: false },
  });
});

test("screenshot helper rejects non-JPEG and oversized responses", async () => {
  const wrongType = { quickAction: async () => new Response("png", { headers: { "Content-Type": "image/png" } }) };
  await assert.rejects(() => capturePreviewImage(wrongType, "https://gateway.test/p/demo/"), /unsupported format/);
  const oversized = { quickAction: async () => new Response(new Uint8Array(5_000_001), { headers: { "Content-Type": "image/jpeg" } }) };
  await assert.rejects(() => capturePreviewImage(oversized, "https://gateway.test/p/demo/"), /invalid image/);
});

test("preview image key, data URI, and managed gateway URL stay isolated", () => {
  assert.equal(previewImageKey("demo"), "preview:demo");
  assert.equal(imageDataUri(jpeg), "data:image/jpeg;base64,/9j/2Q==");
  assert.equal(managedStagingPublishUrl("https://gateway.test/p/", "demo"), "https://gateway.test/p/demo/");
  assert.equal(managedStagingPublishUrl("https://gateway.test/p", "demo", "staging.buildcustom.ai"), "https://demo.staging.buildcustom.ai/");
});

test("managed route verification uses the staging gateway service binding", async () => {
  const requests: string[] = [];
  const gateway = {
    fetch: async (request: Request) => {
      requests.push(request.url);
      if (request.url.endsWith("_buildcustom/route-check")) {
        return Response.json({ ok: true, project: "demo", scriptName: "demo-script" });
      }
      return new Response("<!doctype html><title>demo</title>", { headers: { "Content-Type": "text/html" } });
    },
  };
  await verifyManagedStagingRoute(gateway, "https://gateway.test/p/demo/", "demo", "demo-script");
  assert.deepEqual(requests, [
    "https://gateway.test/p/demo/_buildcustom/route-check",
    "https://gateway.test/p/demo/",
  ]);
});

test("hostname publish requires public Browser Rendering route identity", async () => {
  const url = "https://demo.staging.buildcustom.ai/";
  const calls: string[] = [];
  const browser = { quickAction: async (action: "content", options: Record<string, unknown>) => {
    calls.push(`${action}:${options.url}`);
    return new Response('<html><body><div id="buildcustom-staging-route" data-project="demo" data-script="demo-script">Staging route</div></body></html>', {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } };
  await verifyPublicHostnameRoute(browser, url, "demo", "demo-script");
  assert.deepEqual(calls, ["content:https://demo.staging.buildcustom.ai/_buildcustom/route-check.html"]);
  await verifyPublicHostnameRoute({ quickAction: async () => Response.json({
    success: true,
    result: '<html><body><div id="buildcustom-staging-route" data-project="demo" data-script="demo-script">Staging route</div></body></html>',
  }) }, url, "demo", "demo-script");
  await assert.rejects(() => verifyPublicHostnameRoute(browser, url, "demo", "wrong-script"), /unexpected gateway/);
  await assert.rejects(() => verifyPublicHostnameRoute(undefined, url, "demo", "demo-script"), /requires Browser Rendering/);
});

test("staging publishing rejects missing or non-isolated gateway configuration", () => {
  const binding = { fetch: async () => new Response() };
  assert.equal(hasExactStagingGatewayConfig(undefined, binding), false);
  assert.equal(hasExactStagingGatewayConfig("https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev/p", binding), true);
  assert.equal(hasExactStagingGatewayConfig("https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev/p", binding, "staging.buildcustom.ai"), true);
  assert.equal(hasExactStagingGatewayConfig("https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev/p", binding, "apps.buildcustom.ai"), false);
  assert.equal(hasExactStagingGatewayConfig("https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev/p?route=prod", binding), false);
  assert.equal(hasExactStagingGatewayConfig("https://buildcustom-apps-gateway.thegoldimport.workers.dev/p", binding), false);
});