#!/usr/bin/env node

// Closed-production read-only checks. Login creates only ordinary test sessions.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifact = path.join(root, "production/vibesdk-launch",
  `task12l-regression-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const app = "https://app.buildcustom.ai";
const api = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
const report = { at: new Date().toISOString(), results: {} };
async function query(sql, params = []) {
  const response = await fetch(`${api}/d1/database/ca820baf-6973-4318-ac52-529d56293bb6/query`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const body = await response.json();
  assert(body.success === true && body.result?.[0]?.results, "Product D1 read failed");
  return body.result[0].results;
}
async function versions(worker) {
  const body = await (await fetch(`${api}/workers/scripts/${worker}/deployments`, { headers })).json();
  assert(body.success);
  return body.result.deployments[0].versions;
}
function setCookie(response) {
  return response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
}
async function login(email, password) {
  const csrf = await fetch(`${app}/api/auth/csrf-token`, { cache: "no-store" });
  assert.equal(csrf.status, 200);
  const token = (await csrf.json()).token;
  const response = await fetch(`${app}/api/auth/login`, {
    method: "POST",
    headers: { Origin: app, Cookie: setCookie(csrf),
      "X-CSRF-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, "Existing account login failed");
  const cookie = setCookie(response);
  assert(cookie.includes("accessToken="), "Login did not issue runtime credential");
  return cookie;
}
async function read(uri, cookie) {
  const response = await fetch(`${app}${uri}`, {
    headers: { Cookie: cookie }, cache: "no-store", redirect: "manual",
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function user(email, password, own, other) {
  const cookie = await login(email, password);
  const [me, dashboard, ownProject, cross] = await Promise.all([
    read("/api/auth/me", cookie), read("/api/projects", cookie),
    read(`/api/projects/${own}`, cookie), read(`/api/projects/${other}`, cookie),
  ]);
  assert.equal(me.status, 200);
  assert(me.body?.id, "Product identity absent");
  assert.equal(dashboard.status, 200);
  assert(Array.isArray(dashboard.body));
  assert.deepEqual(dashboard.body.map(p => Number(p.id)), [own]);
  assert.equal(ownProject.status, 200);
  assert.equal(Number(ownProject.body?.id), own);
  assert([403, 404].includes(cross.status));
  return { login: 200, identity: true, ownDashboard: true, ownProject: own,
    crossOwnerStatus: cross.status };
}
try {
  const [runtimeBefore, controlBefore, gatewayBefore, candidates, registration, claims] = await Promise.all([
    versions("buildcustom-vibesdk-launch"), versions("buildcustom-control-plane-launch"),
    versions("buildcustom-apps-gateway"),
    fetch(`${api}/workers/scripts/buildcustom-vibesdk-launch/versions`, { headers }).then(r => r.json()),
    Promise.all([
      fetch(`${app}/api/public/capabilities`, { cache: "no-store" }).then(r => r.json()),
      fetch("https://buildcustom-vibesdk-launch.thegoldimport.workers.dev/api/auth/providers", { cache: "no-store" })
        .then(r => r.json()),
    ]),
    query("SELECT count(*) AS n FROM native_publish_claims"),
  ]);
  assert.deepEqual(runtimeBefore, [{ version_id: "8e28025f-e415-4405-9b1f-67d93eff7fd8", percentage: 100 }]);
  assert.deepEqual(controlBefore, [{ version_id: "8d07cbf8-c7ad-423e-b592-268e538e3410", percentage: 100 }]);
  assert.deepEqual(gatewayBefore, [{ version_id: "9d80432b-4e53-4fe7-950a-2b53f0213eff", percentage: 100 }]);
  assert.equal(candidates.result?.items?.[0]?.id, "95da88fe-fe8a-4ce3-9c62-4565d7f279c2");
  assert.equal(registration[0].registrationEnabled, false);
  assert.equal(registration[0].publicGeneratedAppsEnabled, true);
  assert.equal(registration[1].data?.registrationEnabled, false);
  assert.equal(claims[0].n, 0);
  report.results.closed = { runtimeBefore, controlBefore, gatewayBefore,
    runtimeRegistration: false, controlRegistration: false, publicAppsEnabled: true, claims: 0,
    newRuntimeCandidateInactive: true };

  const user2 = await query("SELECT u.email FROM users u JOIN projects p ON p.user_id=u.id WHERE p.id=? LIMIT 1", [3]);
  assert.equal(user2.length, 1);
  assert(process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD && process.env.BUILDCUSTOM_NEW_USER_ACCEPTANCE_PASSWORD);
  report.results.user1 = await user("cutover-test@buildcustom.ai", process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD, 2, 3);
  report.results.user2 = await user(user2[0].email, process.env.BUILDCUSTOM_NEW_USER_ACCEPTANCE_PASSWORD, 3, 2);
  for (const [label, host, marker] of [
    ["project2", "create-a-minimal-public-app-by-creating-public-index-html-and-p.apps.buildcustom.ai", "BUILDCUSTOM_CUTOVER_TESTER_OK"],
    ["project3", "create-a-tiny-single-page-website-with-a-heading-that-says-buil.apps.buildcustom.ai", "BUILDCUSTOM_NEW_USER_OK"],
  ]) {
    const response = await fetch(`https://${host}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert(html.includes(marker), `${label} public marker absent`);
    report.results[label] = { status: 200, marker: true };
  }
  const unknown = await fetch(`https://task12l-not-a-release-${Date.now()}.apps.buildcustom.ai/`);
  assert.equal(unknown.status, 404);
  report.results.unknownSlug = 404;
  const marketing = await fetch("https://buildcustom.ai/");
  assert.equal(marketing.status, 200);
  report.results.marketing = 200;
  assert.deepEqual(await versions("buildcustom-vibesdk-launch"), runtimeBefore);
  assert.deepEqual(await versions("buildcustom-control-plane-launch"), controlBefore);
  assert.deepEqual(await versions("buildcustom-apps-gateway"), gatewayBefore);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ artifact: path.relative(root, artifact), status: report.status,
    checks: Object.keys(report.results), error: report.error ?? null }));
}