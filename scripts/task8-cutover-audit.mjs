#!/usr/bin/env node
/**
 * Passive browser smoke test for the future app-host cutover.
 * GET requests only: no signup, login, inference, preview creation or publish.
 * Run on the private canary with --rehearsal; on app.buildcustom.ai only AFTER
 * the separately approved hostname reassignment.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const rehearsal = process.argv.includes("--rehearsal");
const expectedHost = rehearsal
  ? "buildcustom-control-plane-launch.thegoldimport.workers.dev"
  : "app.buildcustom.ai";
const origin = `https://${expectedHost}`;
const forbidden = /(?:^|\.)replit\.(?:com|dev|app)$|(?:^|\.)replit\.ai$|(?:^|\.)lab-apps\.buildcustom\.ai$|(?:^|\.)staging\.buildcustom\.ai$/i;
const forbiddenWorker = /(?:^|\.)workers\.dev$/i;
const results = { origin, rehearsal, checks: [], browserRequests: [], violations: [] };

async function check(path, expectedType) {
  const response = await fetch(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  const type = response.headers.get("content-type") || "";
  results.checks.push({ path, status: response.status, type });
  assert.equal(response.status, 200, `${path} must return HTTP 200 without a redirect`);
  assert.match(type, expectedType, `${path} returned an unexpected content type`);
  await response.body?.cancel();
}

await check("/app/login", /text\/html/i);
await check("/api/auth/me", /application\/json/i);
await check("/api/auth/csrf-token", /application\/json/i);

const labRequire = createRequire(new URL("../lab/bc-vibesdk-lab-20260925/package.json", import.meta.url));
const puppeteer = labRequire("puppeteer");
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/repl/tools/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  const assetResponses = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    results.browserRequests.push({ host: url.hostname, path: url.pathname, kind: request.resourceType() });
    if (forbidden.test(url.hostname) || (url.hostname !== expectedHost && forbiddenWorker.test(url.hostname))) {
      results.violations.push({ host: url.hostname, path: url.pathname });
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname === expectedHost && /\.(?:js|css)$/.test(url.pathname)) {
      assetResponses.push({ path: url.pathname, status: response.status() });
    }
  });
  const failures = [];
  page.on("requestfailed", (request) => failures.push(request.url()));
  const response = await page.goto(`${origin}/app/login`, { waitUntil: "networkidle2", timeout: 45_000 });
  assert.equal(response?.status(), 200);
  await page.waitForSelector('[data-testid="input-email"]', { timeout: 20_000 });
  const assets = results.browserRequests.filter((request) =>
    request.host === expectedHost && /\.(?:js|css)$/.test(request.path));
  assert(assets.some((asset) => asset.path.endsWith(".js")), "No app JavaScript loaded");
  assert(assets.some((asset) => asset.path.endsWith(".css")), "No app CSS loaded");
  assert(assetResponses.length >= assets.length && assetResponses.every((asset) => asset.status === 200),
    "A browser JS or CSS asset failed to load with HTTP 200");
  assert.equal(results.violations.length, 0, "Browser called a forbidden Replit/legacy/staging/lab origin");
  assert.equal(failures.length, 0, `Browser requests failed: ${failures.length}`);
  results.loadedAssets = assets.map(({ path, kind }) => ({ path, kind }));
  results.checks.push({ path: "/app/login (Chromium)", status: response.status(), loadedAssets: assets.length });
  delete results.browserRequests;
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}