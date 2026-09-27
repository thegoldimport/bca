#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const puppeteer = createRequire(path.join(root, "lab/bc-vibesdk-lab-20260925/package.json"))("puppeteer");
const base = "https://buildcustom-control-plane-launch.thegoldimport.workers.dev";
const runtime = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const profile = "/tmp/buildcustom-task8e-legacy-profile";
const email = "cutover-test@buildcustom.ai";
const userId = "3f730b86-bc16-4954-b3fd-db22aea136b7";
const projectId = 2;
const password = process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD;
assert(password, "Tester password is required from Replit Secrets.");

async function identity(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    const body = await response.json().catch(() => null);
    return { status: response.status, id: body?.id || null };
  });
}

async function projects(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/projects", { credentials: "same-origin", cache: "no-store" });
    const body = await response.json().catch(() => null);
    return { status: response.status, ids: Array.isArray(body) ? body.map((item) => item.id) : [] };
  });
}

async function login(page) {
  await page.goto(`${base}/app/login`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="input-email"]').fill(email);
  await page.locator('[data-testid="input-password"]').fill(password);
  await page.locator('[data-testid="button-submit"]').click();
  await page.waitForFunction(() => location.pathname === "/app" || location.pathname === "/app/", { timeout: 90_000 });
  const me = await identity(page);
  assert.equal(me.status, 200);
  assert.equal(me.id, userId);
  const dashboard = await projects(page);
  assert.equal(dashboard.status, 200);
  assert.deepEqual(dashboard.ids, [projectId]);
}

await mkdir(profile, { recursive: true, mode: 0o700 });
await chmod(profile, 0o700);
const browser = await puppeteer.launch({
  executablePath: "/repl/tools/bin/chromium",
  headless: true,
  userDataDir: profile,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
let step = "stale-cookies";
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(90_000);
  await page.goto(`${base}/app/login`, { waitUntil: "domcontentloaded" });
  // Legacy names with invalid values, not credentials. Use a fresh isolated browser profile.
  await page.setCookie(
    { name: "accessToken", value: "invalid-legacy-value", url: base, secure: true, path: "/" },
    { name: "csrf-token", value: "invalid-legacy-value", url: base, secure: true, path: "/" },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const stale = await identity(page);
  assert.equal(stale.id, null, "Stale legacy cookie unexpectedly authenticated.");
  const deniedProjects = await projects(page);
  assert.notEqual(deniedProjects.status, 200, "Stale legacy cookie accessed an owner dashboard.");
  await login(page);
  console.log(JSON.stringify({
    stage: "task8e-legacy-cookie",
    staleAuthenticated: false,
    staleOwnershipBypass: false,
    normalLoginSucceeded: true,
    dashboardProjectId: projectId,
  }));

  step = "capture-pre-logout-session";
  const priorCookies = (await page.cookies()).filter((item) => ["accessToken", "csrf-token"].includes(item.name));
  assert(priorCookies.some((item) => item.name === "accessToken" && item.value !== "invalid-legacy-value"),
    "Normal login did not set a new runtime access cookie.");
  const oldCookieHeader = priorCookies.map((item) => `${item.name}=${item.value}`).join("; ");
  step = "pre-logout-runtime-check";
  const before = await fetch(`${runtime}/api/auth/check`, { headers: { Cookie: oldCookieHeader } });
  const beforeBody = await before.json().catch(() => null);
  assert(before.ok && beforeBody?.data?.authenticated === true, "Exact pre-logout runtime session was not valid.");

  step = "browser-logout";
  await page.goto(`${base}/app`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="button-logout"]', { timeout: 30_000 });
  await page.locator('[data-testid="button-logout"]').click();
  await page.waitForFunction(() => location.pathname === "/app/login", { timeout: 45_000 });
  const afterCookies = await page.cookies();
  assert.equal(afterCookies.some((item) => item.name === "accessToken" && item.value === priorCookies.find((old) => old.name === "accessToken")?.value),
    false, "Browser retained the exact pre-logout access cookie.");
  const after = await identity(page);
  assert.equal(after.id, null, "Browser remained authenticated after logout.");

  step = "old-runtime-session-rejection";
  // Reuse the exact saved pre-logout cookie bytes only in memory. Never print them.
  const oldRuntime = await fetch(`${runtime}/api/auth/check`, { headers: { Cookie: oldCookieHeader } });
  const oldRuntimeBody = await oldRuntime.json().catch(() => null);
  assert(!oldRuntime.ok || oldRuntimeBody?.data?.authenticated === false, "Runtime accepted the exact revoked session.");
  step = "old-product-session-rejection";
  const oldProduct = await fetch(`${base}/api/auth/me`, { headers: { Cookie: oldCookieHeader } });
  const oldProductBody = await oldProduct.json().catch(() => null);
  assert(!oldProduct.ok || !oldProductBody?.id, "Control plane accepted the exact revoked session.");

  step = "fresh-login";
  await login(page);
  const fresh = (await page.cookies()).find((item) => item.name === "accessToken");
  assert(fresh && fresh.value !== priorCookies.find((item) => item.name === "accessToken")?.value,
    "Fresh login did not establish a different session.");
  console.log(JSON.stringify({
    stage: "task8e-logout-revocation",
    normalLogout: true,
    browserOldCookieCleared: true,
    serverOldRuntimeSessionRejected: true,
    serverOldProductSessionRejected: true,
    freshLoginSucceeded: true,
    oldRuntimeStatus: oldRuntime.status,
    oldProductStatus: oldProduct.status,
    projectId,
  }));
} catch (error) {
  // Exceptions may contain request URLs and credentials; fail without echoing them.
  console.error(JSON.stringify({ stage: "task8e-auth-acceptance-failed", at: step, reason: error?.code || error?.name || "error", noSecretOutput: true }));
  process.exitCode = 1;
} finally {
  await browser.close();
}