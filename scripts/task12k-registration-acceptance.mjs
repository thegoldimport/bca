#!/usr/bin/env node

// Bounded rejected registrations only. No new user, project, generation, or publish.
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const puppeteer = createRequire(path.join(root, "lab/bc-vibesdk-lab-20260925/package.json"))("puppeteer");
const account = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const product = "https://app.buildcustom.ai";
const existing = "cutover-test@buildcustom.ai";
const testEmail = `task12k-invalid-${Date.now()}@example.net`;
const artifact = path.join(root, "production/vibesdk-launch",
  `task12k-registration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const report = { startedAt: new Date().toISOString(), checks: {} };
let failed = false;
function check(name, evidence, passed) {
  report.checks[name] = { at: new Date().toISOString(), status: passed ? "PASS" : "FAIL", evidence };
  if (!passed) failed = true;
  console.log(JSON.stringify({ name, status: report.checks[name].status, evidence }));
}
async function count(id, email) {
  const column = id.startsWith("ca820") ? ",SUM(CASE WHEN legacy_password_hash IS NULL THEN 1 ELSE 0 END) AS nullLegacy" : "";
  const response = await fetch(`${account}/d1/database/${id}/query`, {
    method: "POST", headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql: `SELECT count(*) AS total${column} FROM users WHERE lower(email)=lower(?)`, params: [email] }),
  });
  const body = await response.json();
  if (!body.success) throw new Error(`D1 identity count failed HTTP ${response.status}`);
  return body.result[0].results[0];
}
async function counts(email) {
  const [productCount, runtimeCount] = await Promise.all([
    count("ca820baf-6973-4318-ac52-529d56293bb6", email),
    count("716c6600-8c60-408a-9446-3779979d5316", email),
  ]);
  return { product: productCount, runtime: runtimeCount };
}
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("Cloudflare read credential unavailable");
let browser;
try {
  const before = await counts(existing);
  const beforeInvalid = await counts(testEmail);
  check("existing-identity-before", before,
    before.product.total === 1 && before.runtime.total === 1 && before.product.nullLegacy === 1);
  if (failed) throw new Error("Existing identity precondition failed");
  browser = await puppeteer.launch({ executablePath: "/repl/tools/bin/chromium", headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.goto(`${product}/app/signup`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="button-submit"]')?.textContent?.includes("Create Account"),
  { timeout: 20000 });
  const ephemeralPassword = `Qa9!${randomBytes(14).toString("hex")}`;
  await page.locator('[data-testid="input-name"]').fill("Existing Tester");
  await page.locator('[data-testid="input-email"]').fill(existing);
  await page.locator('[data-testid="input-password"]').fill(ephemeralPassword);
  const responsePending = page.waitForResponse(response =>
    response.url().includes("/api/auth/register") && response.request().method() === "POST", { timeout: 30000 });
  await page.click('[data-testid="button-submit"]');
  const response = await responsePending;
  const body = await response.json().catch(() => null);
  const productIdentity = await page.evaluate(async () =>
    await (await fetch("/api/auth/me", { cache: "no-store" })).json());
  const errorText = await page.evaluate(() =>
    document.querySelector(".text-red-400")?.textContent?.trim() ?? null);
  check("duplicate-normal-signup", {
    status: response.status(), message: String(body?.message ?? body?.error ?? "").slice(0, 180),
    productIdentityPresent: !!productIdentity?.id, uiError: errorText?.slice(0, 180) ?? null,
  }, response.status() >= 400 && response.status() < 500 && !productIdentity?.id
    && !!errorText && String(body?.message ?? body?.error ?? "").length < 200);
  if (failed) throw new Error("Normal duplicate signup failed");

  const rejected = await page.evaluate(async (cases) => {
    const results = [];
    for (const item of cases) {
      const csrf = await (await fetch("/api/auth/csrf-token", { cache: "no-store" })).json();
      const response = await fetch("/api/auth/register", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.token },
        body: JSON.stringify(item.body),
      });
      const body = await response.json().catch(() => null);
      results.push({ kind: item.kind, status: response.status,
        message: String(body?.message ?? body?.error ?? "").slice(0, 180) });
    }
    return results;
  }, [
    { kind: "email-case-variation", body: { name: "Existing Tester", email: existing.toUpperCase(),
      password: ephemeralPassword } },
    { kind: "invalid-email", body: { name: "Test", email: "not-an-email", password: ephemeralPassword } },
    { kind: "missing-password", body: { name: "Test", email: testEmail } },
    { kind: "invalid-shape", body: { email: ["wrong-type"], password: true } },
    { kind: "stock-password-policy", body: { name: "Test", email: testEmail, password: "short" } },
  ]);
  for (const row of rejected) check(row.kind, row,
    row.status >= 400 && row.status < 500);
  if (failed) throw new Error("Bounded rejection failed");

  const csrf = await page.evaluate(async () =>
    (await (await fetch("/api/auth/csrf-token", { cache: "no-store" })).json()).token);
  const cookie = (await page.cookies(product)).map(c => `${c.name}=${c.value}`).join("; ");
  const attempt = async (kind, origin, token) => {
    const response = await fetch(`${product}/api/auth/register`, {
      method: "POST", headers: { Origin: origin, Cookie: cookie,
        "Content-Type": "application/json", ...(token ? { "X-CSRF-Token": token } : {}) },
      body: JSON.stringify({ name: "Existing Tester", email: existing, password: ephemeralPassword }),
    });
    check(kind, { status: response.status }, response.status === 403);
  };
  await attempt("invalid-origin", "https://not-buildcustom.example", csrf);
  await attempt("missing-csrf", product, null);
  await attempt("invalid-csrf", product, "invalid");
  const [after, afterInvalid] = await Promise.all([counts(existing), counts(testEmail)]);
  check("identity-counts-unchanged", { before, after, beforeInvalid, afterInvalid },
    before.product.total === after.product.total
      && before.runtime.total === after.runtime.total
      && beforeInvalid.product.total === 0 && afterInvalid.product.total === 0
      && beforeInvalid.runtime.total === 0 && afterInvalid.runtime.total === 0
      && after.product.nullLegacy === 1);
} catch (error) {
  report.error = error.message;
  failed = true;
} finally {
  if (browser) await browser.close();
  report.completedAt = new Date().toISOString();
  report.status = failed ? "FAIL" : "PASS";
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ artifact: path.relative(root, artifact), status: report.status }));
  if (failed) process.exitCode = 1;
}