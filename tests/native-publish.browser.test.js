import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const labRequire = createRequire(path.join(root, "lab/bc-vibesdk-lab-20260925/package.json"));
const puppeteer = labRequire("puppeteer");

function installPublishMocks(options) {
  const originalFetch = window.fetch.bind(window);
  const requests = [];
  const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
    const method = String(init.method || "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
    const body = init.body ? String(init.body) : "";
    if (url.pathname === "/api/public/capabilities" && method === "GET") {
      return json({
        registrationEnabled: true,
        publicGeneratedAppsEnabled: options.publicAppsEnabled !== false,
      });
    }
    if (url.pathname.endsWith("/runtime/publishing-capabilities") && method === "GET") {
      return options.staleCapabilities
        ? json({ publishProtocol: "immutable-v1" })
        : json({
          buildId: "immutable-v2",
          publishProtocol: "immutable-v2",
          publicGeneratedAppsEnabled: options.publicAppsEnabled !== false,
        });
    }
    if (url.pathname.endsWith("/runtime/publishing-settings") && method === "GET") {
      return json({ subdomainSlug: "native-publish-test", hostingProvider: "buildcustom", customDomain: "", customOrigin: "" });
    }
    if (url.pathname.endsWith("/runtime/publishing-settings") && method === "PUT") {
      requests.push({ path: url.pathname, method, headers, body });
      return json({ subdomainSlug: JSON.parse(body).subdomainSlug, hostingProvider: "buildcustom" });
    }
    if (url.pathname.endsWith("/runtime/publish-immutable-v2") && method === "POST") {
      requests.push({ path: url.pathname, method, headers, body });
      return options.rejectDeployment
        ? json({ message: "The publish service rejected this request." }, 503)
        : json({
          deploymentUrl: options.publicAppsEnabled === false ? null : "https://native-publish-test.apps.buildcustom.ai",
          publicAvailable: options.publicAppsEnabled !== false,
          release: { id: 1, publicAvailable: options.publicAppsEnabled !== false },
          alreadyPublished: false,
        });
    }
    if (url.pathname === "/api/auth/me") return json({ id: "owner-a", username: "Owner A", email: "owner@example.test", plan: "free", role: "user" });
    if (url.pathname === "/api/auth/csrf-token") return json({ token: "browser-test-csrf" });
    if (url.pathname.endsWith("/runtime/status")) {
      return json({
        nativeThink: true,
        connected: true,
        runtimeStatus: "ready",
        previewUrl: `${location.origin}/preview`,
        deploymentUrl: options.existingUrl || null,
        publicAvailable: Boolean(options.existingUrl) && options.publicAppsEnabled !== false,
        deploymentComplete: Boolean(options.existingUrl),
        state: { shouldBeGenerating: false, generation: { status: "idle" }, previewUrl: `${location.origin}/preview` },
      });
    }
    if (url.pathname.endsWith("/runtime/releases")) return json({ releases: options.existingUrl ? [{
      id: 1,
      commitHash: "release",
      deploymentUrl: options.publicAppsEnabled === false ? null : options.existingUrl,
      publicAvailable: options.publicAppsEnabled !== false,
      createdAt: "2026-01-01T00:00:00Z",
    }] : [] });
    if (url.pathname.endsWith("/runtime/revision")) return json({ branch: "main", commitHash: "revision-1" });
    if (url.pathname.endsWith("/runtime/files")) return json({ files: [] });
    if (url.pathname.endsWith("/runtime/turns")) return json({ turns: [] });
    return json({});
  };
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor() {
      this.readyState = FakeWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      setTimeout(() => {
        if (this.readyState !== FakeWebSocket.CONNECTING) return;
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.({ target: this });
      }, 0);
    }
    send() {}
    close(code = 1000, reason = "") {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ code, reason, wasClean: true, target: this });
    }
  }
  window.WebSocket = FakeWebSocket;
  window.__nativePublishHarness = { requests };
}

async function openEditor(serverUrl, browser, options) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(installPublishMocks, options);
  await page.goto(`${serverUrl}/app/editor/10`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="button-open-native-publish"]', { timeout: 20_000 });
  await page.click('[data-testid="button-open-native-publish"]');
  await page.waitForSelector('[data-testid="button-publish-native"]', { timeout: 10_000 });
  return page;
}

test("native Publish sends one CSRF-protected project deployment and renders published or rejected states", { timeout: 300_000 }, async (t) => {
  const bundleDir = await mkdtemp(path.join(os.tmpdir(), "native-publish-browser-"));
  let httpServer;
  let browser;
  try {
    await build({
      configFile: path.join(root, "vite.config.ts"),
      mode: "production",
      logLevel: "error",
      build: { outDir: bundleDir, emptyOutDir: true },
    });
    httpServer = createHttpServer(async (request, response) => {
      const requestUrl = new URL(request.url || "/", "http://localhost");
      const relative = path.normalize(decodeURIComponent(requestUrl.pathname).replace(/^[/\\]+/, ""));
      let filePath = path.join(bundleDir, relative || "index.html");
      if (!filePath.startsWith(bundleDir + path.sep) && filePath !== path.join(bundleDir, "index.html")) {
        response.writeHead(400).end();
        return;
      }
      try {
        await stat(filePath);
      } catch {
        filePath = path.join(bundleDir, "index.html");
      }
      try {
        const content = await readFile(filePath);
        const extension = path.extname(filePath);
        const contentType = extension === ".js" ? "text/javascript"
          : extension === ".css" ? "text/css"
            : extension === ".svg" ? "image/svg+xml"
              : extension === ".woff2" ? "font/woff2"
                : "text/html; charset=utf-8";
        response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
        response.end(content);
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    assert.ok(address && typeof address !== "string");
    const serverUrl = `http://127.0.0.1:${address.port}`;
    browser = await puppeteer.launch({
      executablePath: "/repl/tools/bin/chromium",
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    await t.test("publishes once and displays the returned public URL", async () => {
      const page = await openEditor(serverUrl, browser, {});
      try {
        await page.click('[data-testid="button-publish-native"]');
        await page.waitForFunction(() => document.querySelector('[data-testid="native-publish-status"]')?.textContent?.includes("Published"));
        const result = await page.evaluate(() => ({
          requests: window.__nativePublishHarness.requests,
          status: document.querySelector('[data-testid="native-publish-status"]')?.textContent,
          url: document.querySelector('[data-testid="link-native-public-url"]')?.getAttribute("href"),
        }));
        const settingsRequests = result.requests.filter((request) => request.method === "PUT");
        const deployments = result.requests.filter((request) => request.method === "POST");
        assert.equal(settingsRequests.length, 1);
        assert.equal(deployments.length, 1);
        assert.equal(settingsRequests[0].path, "/api/projects/10/runtime/publishing-settings");
        assert.equal(deployments[0].path, "/api/projects/10/runtime/publish-immutable-v2");
        for (const request of [...settingsRequests, ...deployments]) {
          assert.equal(request.headers["x-csrf-token"], "browser-test-csrf");
          assert.equal(request.headers["x-publish-protocol"], "immutable-v2");
          assert.doesNotMatch(request.body, /agentId|agent_id|prompt/i);
        }
        assert.deepEqual(JSON.parse(deployments[0].body), {});
        assert.match(result.status, /Published/);
        assert.equal(result.url, "https://native-publish-test.apps.buildcustom.ai");
      } finally {
        await page.close();
      }
    });

    await t.test("closed public-app capability hides deployment URLs while preserving internal publish status", async () => {
      const page = await openEditor(serverUrl, browser, { publicAppsEnabled: false });
      try {
        await page.click('[data-testid="button-publish-native"]');
        await page.waitForFunction(() => document.querySelector('[data-testid="native-publish-status"]')?.textContent?.includes("Published internally"));
        const result = await page.evaluate(() => ({
          status: document.querySelector('[data-testid="native-publish-status"]')?.textContent,
          publicLink: document.querySelector('[data-testid="link-native-public-url"]')?.getAttribute("href"),
          notice: document.querySelector('[data-testid="native-public-apps-disabled"]')?.textContent,
          body: document.body.innerText,
        }));
        assert.match(result.status, /Published internally/);
        assert.equal(result.publicLink, undefined);
        assert.match(result.notice, /internal only|not enabled|not publicly available/i);
        assert.doesNotMatch(result.body, /buildcustom-apps-gateway-launch\.thegoldimport\.workers\.dev/);
      } finally {
        await page.close();
      }
    });

    await t.test("shows a rejected publish error with the stable-slug public address", async () => {
      const existingUrl = "https://already-live.apps.buildcustom.ai";
      const page = await openEditor(serverUrl, browser, { rejectDeployment: true, existingUrl });
      try {
        await page.click('[data-testid="button-publish-native"]');
        await page.waitForFunction(() => document.querySelector('[data-testid="native-publish-status"]')?.textContent?.includes("Publish failed"));
        const result = await page.evaluate(() => ({
          requests: window.__nativePublishHarness.requests,
          status: document.querySelector('[data-testid="native-publish-status"]')?.textContent,
          error: document.querySelector('[role="alert"]')?.textContent,
          url: document.querySelector('[data-testid="link-native-public-url"]')?.getAttribute("href"),
        }));
        assert.equal(result.requests.filter((request) => request.method === "PUT").length, 1);
        assert.equal(result.requests.filter((request) => request.method === "POST").length, 1);
        assert.match(result.status, /Publish failed/);
        assert.equal(result.error, "The publish service rejected this request.");
        assert.equal(result.url, "https://native-publish-test.apps.buildcustom.ai");
      } finally {
        await page.close();
      }
    });

    await t.test("stale capability build cannot save settings or invoke publish", async () => {
      const page = await openEditor(serverUrl, browser, { staleCapabilities: true });
      try {
        await page.click('[data-testid="button-publish-native"]');
        await page.waitForFunction(() => document.querySelector('[data-testid="native-publish-status"]')?.textContent?.includes("Publish failed"));
        const result = await page.evaluate(() => ({
          requests: window.__nativePublishHarness.requests,
          error: document.querySelector('[role="alert"]')?.textContent,
        }));
        assert.deepEqual(result.requests, []);
        assert.match(result.error, /not ready for immutable publishing/);
      } finally {
        await page.close();
      }
    });
  } finally {
    if (browser) await browser.close();
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    await rm(bundleDir, { recursive: true, force: true });
  }
});