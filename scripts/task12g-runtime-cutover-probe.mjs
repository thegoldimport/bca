#!/usr/bin/env node

// Read-only observation for a separately authorized cutover. This script never
// uploads a version, creates a deployment, or changes a registration gate.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const puppeteer = createRequire(path.join(root, "lab/bc-vibesdk-lab-20260925/package.json"))("puppeteer");
const phase = process.argv[2]?.replace(/^--phase=/, "");
if (!["closed", "candidate"].includes(phase) || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/task12g-runtime-cutover-probe.mjs --phase=closed|candidate");
}

const account = "03ef1e6e42498920987f07059e107538";
const worker = "buildcustom-vibesdk-launch";
const accepted = "8e28025f-e415-4405-9b1f-67d93eff7fd8";
const candidate = process.env.TASK12M_RUNTIME_CANDIDATE || "946f5b87-be42-45f1-adf6-67c67ced0dd6";
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const runtime = `https://${worker}.thegoldimport.workers.dev`;
const product = "https://app.buildcustom.ai";
const expectedVersion = phase === "candidate" ? candidate : accepted;
const expectedRegistration = phase === "candidate";
const observations = [];

function record(check, observed, expected, pass, note) {
  const row = {
    timestamp: new Date().toISOString(),
    phase,
    check,
    observed,
    expected,
    status: pass ? "PASS" : "FAIL",
    ...(note ? { note } : {}),
  };
  observations.push(row);
  console.log(JSON.stringify(row));
}

async function cloudflare(pathname) {
  const response = await fetch(`${base}${pathname}`, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`Cloudflare read failed (${response.status})`);
  return body.result;
}

async function providers(versionOverride) {
  const url = new URL("/api/auth/providers", runtime);
  url.searchParams.set("cutover_observation", `${Date.now()}-${versionOverride ? "override" : "live"}`);
  const response = await fetch(url, {
    headers: {
      "Cache-Control": "no-store",
      ...(versionOverride
        ? { "Cloudflare-Workers-Version-Overrides": `${worker}="${versionOverride}"` }
        : {}),
    },
    cache: "no-store",
  });
  const body = await response.json();
  return { status: response.status, registrationEnabled: body.data?.registrationEnabled };
}

async function existingUserAuth() {
  if (!process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD) {
    throw new Error("Existing-user test password is unavailable");
  }
  const browser = await puppeteer.launch({
    executablePath: "/repl/tools/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`${product}/app/login`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="input-email"]', { timeout: 30000 });
    await page.locator('[data-testid="input-email"]').fill("cutover-test@buildcustom.ai");
    await page.locator('[data-testid="input-password"]').fill(process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD);
    const pending = page.waitForResponse(
      (response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
      { timeout: 30000 },
    );
    await page.click('[data-testid="button-submit"]');
    const login = await pending;
    const identity = await page.evaluate(async () => {
      const me = await (await fetch("/api/auth/me", { cache: "no-store" })).json();
      return { authenticated: !!me?.id };
    });
    const cookies = await page.cookies(product);
    const cookie = cookies.map((item) => `${item.name}=${item.value}`).join("; ");
    const response = await fetch(`${runtime}/api/auth/check?cutover_observation=${Date.now()}`, {
      headers: { Cookie: cookie, "Cache-Control": "no-store" },
      cache: "no-store",
    });
    const body = await response.json();
    return {
      loginStatus: login.status(),
      productAuthenticated: identity.authenticated,
      runtimeStatus: response.status,
      runtimeAuthenticated: body.data?.authenticated ?? body.authenticated,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error("Cloudflare read credential is unavailable");
  }
  let active = [];
  try {
    const deployments = await cloudflare(`/workers/scripts/${worker}/deployments`);
    active = deployments.deployments?.[0]?.versions ?? [];
    const selected = active.find((entry) => entry.version_id === expectedVersion);
    record(
      "A: expected runtime deployment",
      { version: selected?.version_id ?? null, percentage: selected?.percentage ?? 0 },
      { version: expectedVersion, percentage: 100 },
      active.length === 1 && selected?.percentage === 100,
    );
    const other = phase === "candidate" ? accepted : candidate;
    const excluded = active.find((entry) => entry.version_id === other);
    record(
      "B: other runtime receives no traffic",
      { version: other, percentage: excluded?.percentage ?? 0 },
      { version: other, percentage: 0 },
      !excluded,
    );
  } catch (error) {
    record("A: expected runtime deployment", { error: error.message }, { version: expectedVersion, percentage: 100 }, false);
    record("B: other runtime receives no traffic", { error: error.message }, { percentage: 0 }, false);
  }

  try {
    const version = await cloudflare(`/workers/scripts/${worker}/versions/${expectedVersion}`);
    const configFlag = version.resources?.bindings?.find((binding) => binding.name === "REGISTRATION_ENABLED")?.text;
    // Overrides only apply to versions in the CURRENT deployment. This is a
    // targeted request, not an independent per-request version attestation.
    const targeted = active.some((entry) => entry.version_id === expectedVersion)
      ? await providers(expectedVersion)
      : { status: null, registrationEnabled: null };
    record(
      "C: configured version and supported targeted request",
      { version: expectedVersion, configuredFlag: configFlag ?? null, targeted },
      { configuredFlag: String(expectedRegistration), targeted: { status: 200, registrationEnabled: expectedRegistration } },
      configFlag === String(expectedRegistration)
        && targeted.status === 200 && targeted.registrationEnabled === expectedRegistration,
      "The version override is valid only for an actively deployed version; this is not per-request version-ID attestation.",
    );
  } catch (error) {
    record("C: configured version and supported targeted request", { error: error.message }, { registrationEnabled: expectedRegistration }, false);
  }

  try {
    const live = await providers();
    record(
      "D: ordinary live runtime registration capability",
      live,
      { status: 200, registrationEnabled: expectedRegistration },
      live.status === 200 && live.registrationEnabled === expectedRegistration,
    );
  } catch (error) {
    record("D: ordinary live runtime registration capability", { error: error.message }, { registrationEnabled: expectedRegistration }, false);
  }

  try {
    const auth = await existingUserAuth();
    record(
      "E: existing-user product and runtime authentication",
      auth,
      { loginStatus: 200, productAuthenticated: true, runtimeStatus: 200, runtimeAuthenticated: true },
      auth.loginStatus === 200 && auth.productAuthenticated && auth.runtimeStatus === 200 && auth.runtimeAuthenticated === true,
    );
  } catch (error) {
    record("E: existing-user product and runtime authentication", { error: error.message }, { authenticated: true }, false);
  }
  if (observations.some((row) => row.status !== "PASS")) process.exitCode = 1;
}

await main();