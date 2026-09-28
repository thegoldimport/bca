#!/usr/bin/env node

// Read-only cutover observer. Never uploads, deploys, registers, or publishes.
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLab = createRequire(path.join(root, "lab/bc-vibesdk-lab-20260925/package.json"));
const puppeteer = requireLab("puppeteer");
const wrangler = requireLab.resolve("wrangler/bin/wrangler.js");
const phase = process.argv[2]?.replace(/^--phase=/, "");
if (!["closed", "open"].includes(phase) || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/task12j-control-cutover-probe.mjs --phase=closed|open");
}
const worker = "buildcustom-control-plane-launch";
const accepted = "8d07cbf8-c7ad-423e-b592-268e538e3410";
const candidate = "754a3a04-91f9-49e2-b9a8-614aa183a13c";
const expectedVersion = phase === "closed" ? accepted : candidate;
const expectedRegistration = phase === "open";
const api = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const product = "https://app.buildcustom.ai";
const runtime = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const runId = randomUUID();
// Cloudflare tail redacts UUID-shaped values in request URLs. A timestamp is
// sufficient to correlate this public GET without depending on hidden tokens.
const requestMarker = String(Date.now());
const artifact = path.join(root, "production/vibesdk-launch",
  `task12j-observation-${new Date().toISOString().replace(/[:.]/g, "-")}-${runId.slice(0, 8)}.json`);
const report = {
  phase, runId, startedAt: new Date().toISOString(), expectedVersion,
  versionEvidenceClassification: "STRONG", checks: {},
};
let failed = false;

function record(name, observed, expected, passed, extra = {}) {
  const row = { timestamp: new Date().toISOString(), observed, expected,
    status: passed ? "PASS" : "FAIL", ...extra };
  report.checks[name] = row;
  console.log(JSON.stringify({ check: name, ...row }));
  if (!passed) failed = true;
}
function errorRecord(name, error, expected) {
  record(name, { error: error instanceof Error ? error.message : String(error) }, expected, false);
}
async function cfGet(pathname) {
  const response = await fetch(`${api}${pathname}`, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`Cloudflare GET failed: ${response.status}`);
  return body;
}
function binding(version, name) {
  return version.resources?.bindings?.find((item) => item.name === name);
}
function safeBinding(version, name) {
  const value = binding(version, name);
  if (!value) return null;
  if (value.type === "plain_text") return { type: value.type, value: value.text };
  if (value.type === "service") return {
    type: value.type, service: value.service, environment: value.environment ?? null,
  };
  return { type: value.type, value: "[not recorded]" };
}
function moduleHashes(detail) {
  return (detail.modules ?? []).map((module) => ({
    name: module.name.replace(/^\.\//, ""),
    sha256: createHash("sha256").update(Buffer.from(module.content_base64, "base64")).digest("hex"),
  })).sort((a, b) => a.name.localeCompare(b.name));
}
function publicHeaders(headers) {
  const result = {};
  for (const [name, value] of headers) {
    if (/(cookie|authorization|token|secret|credential|api-key|proxy-authenticate|report-to)/i.test(name)) {
      result[name] = "[redacted]";
    } else {
      result[name] = value;
    }
  }
  return result;
}

// Wrangler's JSON tail prints one indented JSON object per invocation. Only
// project the uniquely matched public request; never retain unrelated events
// (which could contain customer request headers or application logs).
function startTail() {
  const child = spawn(process.execPath, [
    wrangler, "tail", worker, "--format=json", "--config",
    path.join(root, "wrangler.product-launch.jsonc"),
  ], { cwd: root, env: { ...process.env, NO_COLOR: "1" }, stdio: ["pipe", "pipe", "pipe"] });
  const waiting = new Map();
  let fragment = "", current = "", collecting = false, stderr = "";
  const metrics = { stdoutChunks: 0, starts: 0, parsedEvents: 0, matchedUrls: 0, samples: [] };
  child.stdout.on("data", (chunk) => {
    metrics.stdoutChunks++;
    fragment += chunk.toString();
    const lines = fragment.split("\n");
    fragment = lines.pop();
    for (const line of lines) {
      if (!collecting && line.trim() === "{") { current = line; collecting = true; metrics.starts++; continue; }
      if (!collecting) continue;
      current += `\n${line}`;
      try {
        const event = JSON.parse(current);
        metrics.parsedEvents++;
        const url = event.event?.request?.url;
        if (metrics.samples.length < 3) metrics.samples.push({
          scriptMatches: event.scriptName === worker,
          isCalibration: typeof url === "string" && url.includes("task12j_calibration="),
          urlMatched: waiting.has(url),
          eventType: event.event?.request?.method ?? null,
          hasVersion: !!event.scriptVersion?.id,
        });
        if (event.scriptName === worker && waiting.has(url)) {
          metrics.matchedUrls++;
          waiting.get(url)(event);
        }
        collecting = false;
        current = "";
      } catch {
        // A partial JSON object is expected; discard unexpectedly large
        // events rather than keeping arbitrary request data in memory.
        if (current.length > 262144) { collecting = false; current = ""; }
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    // Never print tail stderr verbatim; it may include request or account data.
    stderr = (stderr + chunk.toString()).slice(-2048);
  });
  function watch(url, timeoutMs) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => { waiting.delete(url); resolve(null); }, timeoutMs);
      waiting.set(url, (event) => { clearTimeout(timeout); waiting.delete(url); resolve(event); });
    });
  }
  async function ready() {
    // Calibrate the subscription by observing our own harmless GET, not by
    // assuming a fixed Wrangler startup time or deployment convergence.
    for (let attempt = 0; attempt < 15 && child.exitCode === null; attempt++) {
      const url = `${product}/api/public/capabilities?task12j_calibration=${requestMarker}-${attempt}`;
      const observed = watch(url, 1500);
      await fetch(url, { cache: "no-store" }).catch(() => undefined);
      if (await observed) return { ready: true, attempts: attempt + 1, metrics };
    }
    return { ready: false, attempts: 15, exitCode: child.exitCode, metrics,
      error: stderr ? "tail failed to produce a matching event" : "tail unavailable" };
  }
  async function close() {
    child.kill("SIGTERM");
    child.stdin.end();
  }
  return { ready, watch, close };
}

async function capability(tail) {
  const url = `${product}/api/public/capabilities?task12j_observation=${requestMarker}`;
  const requestedAt = new Date().toISOString();
  const correlated = tail?.watch(url, 12000);
  const response = await fetch(url, { cache: "no-store" });
  const headers = publicHeaders(response.headers);
  const rawBody = await response.text();
  if (rawBody.length > 16384) throw new Error("Public capability response exceeded safe capture limit");
  const parsed = JSON.parse(rawBody);
  if (!parsed || typeof parsed.registrationEnabled !== "boolean"
    || typeof parsed.publicGeneratedAppsEnabled !== "boolean"
    || Object.keys(parsed).some((key) => !["registrationEnabled", "publicGeneratedAppsEnabled"].includes(key))) {
    throw new Error("Unexpected capability body; refusing to persist potentially private fields");
  }
  const event = correlated ? await correlated : null;
  const version = event?.scriptVersion?.id ?? null;
  const identity = {
    versionEvidenceClassification: version ? "STRONG" : "UNAVAILABLE",
    perRequestVersionIdentity: version ?? "UNKNOWN",
    observedVersionId: version,
    correlation: event ? {
      eventTimestamp: event.eventTimestamp,
      requestUrl: event.event?.request?.url,
      requestMethod: event.event?.request?.method,
      scriptName: event.scriptName,
      scriptVersion: event.scriptVersion?.id ?? null,
      outcome: event.outcome,
    } : null,
    limitations: version
      ? "Wrangler tail ScriptVersion identifies the Worker invocation with this exact unique request URL; this is not a signed response header."
      : "No matching Wrangler tail event with scriptVersion.id; deployment readback cannot establish per-request version.",
  };
  report.versionEvidenceClassification = identity.versionEvidenceClassification;
  report.perRequestVersionIdentity = identity.perRequestVersionIdentity;
  report.versionCorrelation = identity;
  const observed = {
    request: { url, requestedAt, method: "GET", cache: "no-store" },
    response: {
      status: response.status, headers, cfRay: response.headers.get("cf-ray"),
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      age: response.headers.get("age"),
      cfCacheStatus: response.headers.get("cf-cache-status"),
      rawBody, parsedJson: parsed,
    },
    versionEvidence: identity,
  };
  record("D-live-capability", observed,
    { status: 200, registrationEnabled: expectedRegistration, publicGeneratedAppsEnabled: true,
      servingVersion: expectedVersion },
    response.status === 200 && parsed.registrationEnabled === expectedRegistration
      && parsed.publicGeneratedAppsEnabled === true && version === expectedVersion);
}

async function ui(browser) {
  const page = await browser.newPage();
  try {
    const url = `${product}/app/signup`;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction((open) => {
      const button = document.querySelector('[data-testid="button-submit"]');
      return open ? button?.textContent?.includes("Create Account")
        : !!document.querySelector('[data-testid="registration-closed-notice"]');
    }, { timeout: 15000 }, expectedRegistration);
    const state = await page.evaluate(() => ({
      heading: document.querySelector("h1")?.textContent?.trim(),
      submitLabel: document.querySelector('[data-testid="button-submit"]')?.textContent?.trim(),
      nameInput: !!document.querySelector('[data-testid="input-name"]'),
      emailInput: !!document.querySelector('[data-testid="input-email"]'),
      passwordInput: !!document.querySelector('[data-testid="input-password"]'),
      closedNotice: !!document.querySelector('[data-testid="registration-closed-notice"]'),
      switchLabel: document.querySelector('[data-testid="button-switch-mode"]')?.textContent?.trim() ?? null,
    }));
    await page.goto(`${product}/app/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector('[data-testid="button-submit"]');
    const loginAvailable = await page.$eval('[data-testid="button-submit"]',
      (button) => button.textContent?.trim() === "Sign In");
    const observed = { url, httpStatus: response.status(), state, loginAvailable };
    record("E-signup-ui", observed,
      { signup: expectedRegistration ? "Create Account" : "closed", loginAvailable: true },
      response.status() === 200 && loginAvailable && state.emailInput && state.passwordInput
        && (expectedRegistration
          ? state.submitLabel === "Create Account" && state.nameInput && state.switchLabel === "Sign in" && !state.closedNotice
          : state.closedNotice && state.submitLabel === "Sign In" && !state.nameInput));
  } finally { await page.close(); }
}

async function runtimeCapability() {
  const url = `${runtime}/api/auth/providers?task12j_observation=${runId}`;
  const response = await fetch(url, { cache: "no-store" });
  const raw = await response.json();
  // /api/auth/providers includes a CSRF token. Never persist that token.
  const relevant = { success: raw.success,
    data: { registrationEnabled: raw.data?.registrationEnabled,
      email: raw.data?.providers?.email } };
  record("F-runtime-registration",
    { url, status: response.status, relevantBody: relevant },
    { status: 200, registrationEnabled: expectedRegistration },
    response.status === 200 && relevant.data.registrationEnabled === expectedRegistration);
}

async function existingUser(browser) {
  if (!process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD) throw new Error("Tester credential unavailable");
  const page = await browser.newPage();
  try {
    await page.goto(`${product}/app/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector('[data-testid="input-email"]');
    await page.locator('[data-testid="input-email"]').fill("cutover-test@buildcustom.ai");
    await page.locator('[data-testid="input-password"]').fill(process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD);
    const login = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
    { timeout: 30000 });
    await page.click('[data-testid="button-submit"]');
    const loginResponse = await login;
    const productResponse = await page.evaluate(async () => {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await response.json();
      return { status: response.status, identityPresent: !!data?.id };
    });
    const cookie = (await page.cookies(product)).map((part) => `${part.name}=${part.value}`).join("; ");
    const runtimeResponse = await fetch(`${runtime}/api/auth/check?task12j_observation=${runId}`, {
      headers: { Cookie: cookie }, cache: "no-store",
    });
    const body = await runtimeResponse.json();
    record("G-existing-user-auth",
      { loginStatus: loginResponse.status(), product: productResponse,
        runtime: { status: runtimeResponse.status, authenticated: body.data?.authenticated } },
      { loginStatus: 200, product: { status: 200, identityPresent: true },
        runtime: { status: 200, authenticated: true } },
      loginResponse.status() === 200 && productResponse.status === 200
        && productResponse.identityPresent && runtimeResponse.status === 200
        && body.data?.authenticated === true);
  } finally { await page.close(); }
}

async function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("Cloudflare read credential unavailable");
  let tail, browser;
  try {
    tail = startTail();
    const tailReady = await tail.ready();
    report.tailCalibration = tailReady;
    const deployment = (await cfGet(`/workers/scripts/${worker}/deployments`)).result.deployments?.[0];
    const versions = deployment?.versions ?? [];
    record("A-control-deployment",
      { deploymentId: deployment?.id ?? null, rawRelevantApiResponse: deployment ?? null },
      { version: expectedVersion, percentage: 100 },
      versions.length === 1 && versions[0].version_id === expectedVersion && versions[0].percentage === 100);
    const acceptedPct = versions.find((item) => item.version_id === accepted)?.percentage ?? 0;
    const candidatePct = versions.find((item) => item.version_id === candidate)?.percentage ?? 0;
    record("B-accepted-candidate-percentages",
      { acceptedVersion: accepted, acceptedPercentage: acceptedPct,
        candidateVersion: candidate, candidatePercentage: candidatePct },
      { acceptedPercentage: phase === "closed" ? 100 : 0,
        candidatePercentage: phase === "open" ? 100 : 0 },
      acceptedPct === (phase === "closed" ? 100 : 0)
        && candidatePct === (phase === "open" ? 100 : 0));
    try {
      const [candidateVersion, acceptedVersion, candidateDetail, acceptedDetail] = await Promise.all([
        cfGet(`/workers/scripts/${worker}/versions/${candidate}`),
        cfGet(`/workers/scripts/${worker}/versions/${accepted}`),
        cfGet(`/workers/workers/${worker}/versions/${candidate}?include=modules`),
        cfGet(`/workers/workers/${worker}/versions/${accepted}?include=modules`),
      ]);
      const candidateHashes = moduleHashes(candidateDetail.result);
      const acceptedHashes = moduleHashes(acceptedDetail.result);
      const mainModule = candidateDetail.result.main_module;
      const candidateMain = candidateHashes.find((module) => module.name === mainModule);
      const observed = {
        versionId: candidate, mainModule, candidateMainSha256: candidateMain?.sha256 ?? null,
        acceptedMainSha256: acceptedHashes.find((module) => module.name === mainModule)?.sha256 ?? null,
        modules: candidateHashes, moduleParity: JSON.stringify(candidateHashes) === JSON.stringify(acceptedHashes),
        bindings: Object.fromEntries([
          "STAGING_REGISTRATION_ENABLED", "PUBLIC_GENERATED_APPS_ENABLED",
          "CONTROL_PLANE_PROFILE", "ENVIRONMENT", "STAGING_LOGIN_ENABLED",
          "AUTH_RUNTIME", "AUTH_RUNTIME_URL",
        ].map((name) => [name, safeBinding(candidateVersion.result, name)])),
        acceptedRegistration: safeBinding(acceptedVersion.result, "STAGING_REGISTRATION_ENABLED"),
        assetConfiguration: candidateDetail.result.assets?.config ?? null,
      };
      record("C-candidate-configuration", observed,
        { registration: "true", acceptedRegistration: "false", publicApps: "true",
          profile: "launch", environment: "production", moduleParity: true },
        observed.moduleParity && !!candidateMain
          && observed.bindings.STAGING_REGISTRATION_ENABLED?.value === "true"
          && observed.acceptedRegistration?.value === "false"
          && observed.bindings.PUBLIC_GENERATED_APPS_ENABLED?.value === "true"
          && observed.bindings.CONTROL_PLANE_PROFILE?.value === "launch"
          && observed.bindings.ENVIRONMENT?.value === "production"
          && observed.bindings.AUTH_RUNTIME?.type === "service");
    } catch (error) { errorRecord("C-candidate-configuration", error, { candidate }); }

    try { await capability(tailReady.ready ? tail : null); }
    catch (error) { errorRecord("D-live-capability", error, { registrationEnabled: expectedRegistration }); }
    await tail.close();
    browser = await puppeteer.launch({
      executablePath: "/repl/tools/bin/chromium", headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try { await ui(browser); }
    catch (error) { errorRecord("E-signup-ui", error, { signup: expectedRegistration }); }
    try { await runtimeCapability(); }
    catch (error) { errorRecord("F-runtime-registration", error, { registrationEnabled: expectedRegistration }); }
    try { await existingUser(browser); }
    catch (error) { errorRecord("G-existing-user-auth", error, { authenticated: true }); }
  } catch (error) {
    report.fatalError = error instanceof Error ? error.message : String(error);
    failed = true;
  } finally {
    if (tail) await tail.close();
    if (browser) await browser.close();
    report.completedAt = new Date().toISOString();
    report.status = failed ? "FAIL" : "PASS";
    await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ artifact: path.relative(root, artifact), status: report.status,
      versionEvidence: report.perRequestVersionIdentity ?? "UNKNOWN" }));
  }
  if (failed) process.exitCode = 1;
}

await main();