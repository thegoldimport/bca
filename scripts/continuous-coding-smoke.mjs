#!/usr/bin/env node
// Existing disposable accounts/projects only; no coding, Publish, or Project 5.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const mode = process.argv[2];
assert(["before", "before-auth", "after"].includes(mode));
const authOnly = mode === "before-auth";
const app = "https://app.buildcustom.ai";
const runtime = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const report = { mode, startedAt: new Date().toISOString(), checks: {}, status: "RUNNING" };
const file = `production/vibesdk-launch/continuous-coding-smoke-${mode}.json`;
const cookies = new Map();
let csrf;
function absorb(response) {
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0], equals = pair.indexOf("=");
    cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
  }
}
function cookie() { return [...cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
async function req(uri, { method = "GET", body, headers = {}, rawCookie, origin = app } = {}) {
  assert(!/^\/api\/projects\/5(?:\/|$)/.test(uri), "Project 5 is forbidden");
  const response = await fetch(app + uri, {
    method, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000),
    headers: {
      Cookie: rawCookie ?? cookie(), Origin: origin, ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": csrf }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  absorb(response);
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { /* HTML is expected for dashboard/preview. */ }
  return { status: response.status, json, text };
}
async function query(sql) {
  assert(/^SELECT\b/i.test(sql));
  const response = await fetch("https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538/d1/database/ca820baf-6973-4318-ac52-529d56293bb6/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql }), signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  assert(data.success, "Read-only product query failed");
  return data.result[0].results;
}
try {
  if (!authOnly) {
  const health = await fetch(runtime + "/api/health", { signal: AbortSignal.timeout(30000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");
  report.checks.runtime = "PASS";
  const capabilities = await req("/api/public/capabilities");
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.json.registrationEnabled, true);
  assert.equal(capabilities.json.publicGeneratedAppsEnabled, true);
  const providers = await (await fetch(runtime + "/api/auth/providers")).json();
  assert.equal(providers.data.registrationEnabled, true);
  report.checks.controlAndSignupConfiguration = "PASS";
  assert.equal((await query("SELECT count(*) AS n FROM native_publish_claims"))[0].n, 0);
  report.checks.activePublishClaims = 0;
  const csrfResponse = await req("/api/auth/csrf-token");
  assert.equal(csrfResponse.status, 200);
  csrf = csrfResponse.json.token;
  assert(csrf);
  for (const input of [
    { email: "not-an-email", password: "Valid-Test-Password123!", name: "Validation fixture" },
    { email: "nonexistent-validation-fixture@example.invalid", password: "short", name: "Validation fixture" },
  ]) {
    const result = await req("/api/auth/register", { method: "POST", body: input });
    assert.equal(result.status, 400, "Expected bounded signup validation");
  }
  report.checks.signupValidation = "PASS";
  const forgot = await req("/api/auth/forgot-password", {
    method: "POST", body: { email: `nonexistent-recovery-fixture-${mode}@example.invalid` },
  });
  assert.equal(forgot.status, 200);
  const badReset = await req("/api/auth/reset-password", {
    method: "POST", body: {
      token: "0".repeat(64), newPassword: "Valid-Test-Password123!", confirmPassword: "Valid-Test-Password123!",
    },
  });
  assert.equal(badReset.status, 400);
  report.checks.passwordRecoveryAnonymousAndInvalidToken = "PASS";
  } else {
    const tokenResponse = await req("/api/auth/csrf-token");
    assert.equal(tokenResponse.status, 200);
    csrf = tokenResponse.json.token;
    assert(csrf);
  }
  const login = await req("/api/auth/login", {
    method: "POST", body: { email: "cutover-test@buildcustom.ai", password: process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD },
  });
  assert.equal(login.status, 200);
  assert(cookies.get("accessToken"));
  report.checks.login = "PASS";
  if (!authOnly) {
  const identity = await req("/api/auth/me");
  assert.equal(identity.status, 200);
  const dashboard = await req("/api/projects");
  assert.equal(dashboard.status, 200);
  assert(Array.isArray(dashboard.json));
  assert(dashboard.json.some(project => Number(project.id) === 2));
  report.checks.dashboard = "PASS";
  const own = await req("/api/projects/2");
  assert.equal(own.status, 200);
  for (const [label, headers, expected] of [
    ["crossOwnerStatus", {}, 404],
    ["forgedHeaderStatus", { "X-User-Id": "3" }, 400],
    ["ignoredOwnerHeaderStatus", { "X-Project-Owner": "3" }, 404],
  ]) {
    const cross = await req("/api/projects/3", { headers });
    report.checks[label] = cross.status;
    if (cross.status !== expected) {
      report.checks[`${label}Error`] = cross.status === 200
        ? "Unexpected successful access" : cross.text.slice(0, 400);
    }
    assert.equal(cross.status, expected, `${label} returned ${cross.status}`);
    if (expected === 400) assert.equal(cross.json.message, "Browser-supplied identity is not accepted.");
  }
  report.checks.ownershipAndForgedAccess = "PASS";
  const files = await req("/api/projects/2/runtime/files");
  assert.equal(files.status, 200);
  report.checks.files = "PASS";
  const state = await req("/api/projects/2/runtime/status");
  assert.equal(state.status, 200);
  report.checks.runtimeStatus = "PASS";
  // Do not create a new preview just to smoke-test an existing published fixture.
  const signed = state.json?.previewURL ?? state.json?.previewUrl ??
    state.json?.data?.previewURL ?? state.json?.data?.previewUrl;
  if (signed) {
    const url = new URL(signed, app);
    assert([app, runtime].includes(url.origin));
    const preview = await fetch(url, { headers: { Cookie: cookie() }, redirect: "manual" });
    assert.equal(preview.status, 200);
    report.checks.existingPreview = "PASS";
  } else report.checks.existingPreview = "NOT_AVAILABLE_IN_STATUS";
  for (const [host, marker] of [
    ["create-a-minimal-public-app-by-creating-public-index-html-and-p.apps.buildcustom.ai", "BUILDCUSTOM_CUTOVER_TESTER_OK"],
    ["create-a-tiny-single-page-website-with-a-heading-that-says-buil.apps.buildcustom.ai", "BUILDCUSTOM_NEW_USER_OK"],
  ]) {
    const response = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    assert((await response.text()).includes(marker));
  }
  report.checks.publicApps = "PASS";
  assert.equal((await fetch(`https://lifecycle-unknown-${Date.now()}.apps.buildcustom.ai/`)).status, 404);
  report.checks.unknownSlug = 404;
  }
  const logoutCsrf = await req("/api/auth/csrf-token");
  assert.equal(logoutCsrf.status, 200);
  csrf = logoutCsrf.json.token;
  assert(csrf, "Logout must use post-login CSRF token");
  const oldCredential = cookie();
  const logout = await req("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrf } });
  report.checks.logoutStatus = logout.status;
  assert.equal(logout.status, 204);
  const oldMe = await req("/api/auth/me", { rawCookie: oldCredential });
  assert.equal(oldMe.status, 200);
  assert.equal(oldMe.json, null, "Identity probe must be anonymous after logout");
  report.checks.oldIdentityProbe = "ANONYMOUS";
  const oldProjects = await req("/api/projects", { rawCookie: oldCredential });
  assert.equal(oldProjects.status, 401, "Pre-logout credential must not access protected projects");
  report.checks.oldProtectedProjectsStatus = oldProjects.status;
  const oldNative = await fetch(runtime + "/api/auth/check", {
    headers: { Cookie: oldCredential }, redirect: "manual", signal: AbortSignal.timeout(30000),
  });
  assert.equal(oldNative.status, 200);
  assert.equal((await oldNative.json()).data.authenticated, false, "Native runtime must reject the pre-logout credential");
  report.checks.logoutRevocation = "PASS";
  assert.equal((await query("SELECT count(*) AS n FROM native_publish_claims"))[0].n, 0);
  report.checks.publishSeparation = "NO_PUBLISH_REQUESTS";
  report.status = "PASS";
} catch (error) {
  report.status = "BLOCKED";
  report.error = String(error.message).slice(0, 700);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report));
}