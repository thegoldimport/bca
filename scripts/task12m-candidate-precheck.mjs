#!/usr/bin/env node
// Read-only version parity and closed-state gate for the one Task 12M attempt.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const account = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const runtime = "buildcustom-vibesdk-launch";
const control = "buildcustom-control-plane-launch";
const gateway = "buildcustom-apps-gateway";
const acceptedRuntime = "8e28025f-e415-4405-9b1f-67d93eff7fd8";
const priorRuntime = "946f5b87-be42-45f1-adf6-67c67ced0dd6";
const newRuntime = "95da88fe-fe8a-4ce3-9c62-4565d7f279c2";
const acceptedControl = "8d07cbf8-c7ad-423e-b592-268e538e3410";
const candidateControl = "754a3a04-91f9-49e2-b9a8-614aa183a13c";
const acceptedGateway = "9d80432b-4e53-4fe7-950a-2b53f0213eff";
const artifact = path.join(root, "production/vibesdk-launch",
  `task12m-precheck-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const report = { startedAt: new Date().toISOString(), status: "FAIL" };
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("Cloudflare credential unavailable");
async function get(url) {
  const response = await fetch(`${account}${url}`, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) throw new Error(`Cloudflare GET failed: HTTP ${response.status}`);
  return body.result;
}
function hashes(detail) {
  return (detail.modules ?? []).map(m => ({
    name: m.name,
    sha256: createHash("sha256").update(Buffer.from(m.content_base64, "base64")).digest("hex"),
  })).sort((a, b) => a.name.localeCompare(b.name));
}
function binding(version, name) {
  return version.resources?.bindings?.find(b => b.name === name);
}
function single(deployments, expected) {
  assert.deepEqual(deployments.deployments[0]?.versions, [{ version_id: expected, percentage: 100 }]);
  return deployments.deployments[0].id;
}
try {
  const [rd, cd, gd, rn, rp, ra, rnm, rpm, cam, cb, ca, camod, caomod, record] = await Promise.all([
    get(`/workers/scripts/${runtime}/deployments`),
    get(`/workers/scripts/${control}/deployments`),
    get(`/workers/scripts/${gateway}/deployments`),
    get(`/workers/scripts/${runtime}/versions/${newRuntime}`),
    get(`/workers/scripts/${runtime}/versions/${priorRuntime}`),
    get(`/workers/scripts/${runtime}/versions/${acceptedRuntime}`),
    get(`/workers/workers/${runtime}/versions/${newRuntime}?include=modules`),
    get(`/workers/workers/${runtime}/versions/${priorRuntime}?include=modules`),
    get(`/workers/workers/${control}/versions/${candidateControl}?include=modules`),
    get(`/workers/scripts/${control}/versions/${candidateControl}`),
    get(`/workers/scripts/${control}/versions/${acceptedControl}`),
    get(`/workers/workers/${control}/versions/${candidateControl}?include=modules`),
    get(`/workers/workers/${control}/versions/${acceptedControl}?include=modules`),
    readFile(path.join(root, "production/vibesdk-launch/task12l-candidate-2026-09-28T18-55-18-650Z.json"), "utf8"),
  ]);
  report.deployments = {
    runtime: single(rd, acceptedRuntime),
    control: single(cd, acceptedControl),
    gateway: single(gd, acceptedGateway),
  };
  const expected = JSON.parse(record);
  assert.equal(expected.state, "VERIFIED_INACTIVE");
  assert.equal(expected.version, newRuntime);
  assert.deepEqual(hashes(rnm), expected.expected.moduleHashes);
  const oldHashes = hashes(rpm), newHashes = hashes(rnm);
  assert.equal(newHashes.length, 6);
  assert.deepEqual(newHashes.filter(m => m.name !== "index.js"),
    oldHashes.filter(m => m.name !== "index.js"));
  assert.notEqual(newHashes.find(m => m.name === "index.js")?.sha256,
    oldHashes.find(m => m.name === "index.js")?.sha256);
  const main = rnm.modules.find(m => m.name === "index.js");
  const source = Buffer.from(main.content_base64, "base64").toString("utf8");
  const register = source.slice(source.indexOf("static async register("), source.indexOf("static async login("));
  assert(register.includes("Enter a valid email address."));
  assert(register.includes("Password does not meet the requirements."));
  assert.deepEqual(rn.resources.bindings, rp.resources.bindings);
  assert.equal(rn.resources.bindings.length, 29);
  assert.deepEqual(rn.resources.script_runtime, rp.resources.script_runtime);
  assert.deepEqual(rn.resources.script_runtime, ra.resources.script_runtime);
  assert.deepEqual(rn.resources.script_runtime.containers, [{ class_name: "UserAppSandboxService" }]);
  assert.equal(binding(rn, "REGISTRATION_ENABLED")?.text, "true");
  assert.equal(binding(ra, "REGISTRATION_ENABLED")?.text, "false");
  assert.deepEqual(rnm.assets?.config, rpm.assets?.config);
  assert.deepEqual(hashes(camod), hashes(caomod));
  assert.deepEqual(cam.assets?.config, caomod.assets?.config);
  assert.deepEqual(cb.resources.script_runtime, ca.resources.script_runtime);
  const oldBindings = Object.fromEntries(ca.resources.bindings.map(b => [b.name, b]));
  const newBindings = Object.fromEntries(cb.resources.bindings.map(b => [b.name, b]));
  for (const name of new Set([...Object.keys(oldBindings), ...Object.keys(newBindings)])) {
    if (name === "STAGING_REGISTRATION_ENABLED") {
      assert.equal(oldBindings[name]?.text, "false");
      assert.equal(newBindings[name]?.text, "true");
    } else assert.deepEqual(newBindings[name], oldBindings[name]);
  }
  assert.equal(binding(cb, "PUBLIC_GENERATED_APPS_ENABLED")?.text, "true");
  assert.equal(binding(cb, "CONTROL_PLANE_PROFILE")?.text, "launch");
  assert.equal(binding(cb, "ENVIRONMENT")?.text, "production");
  assert.equal(binding(cb, "AUTH_RUNTIME")?.service, runtime);
  report.runtime = { version: newRuntime, moduleHashes: newHashes, otherFiveMatch: true,
    bindings: 29, resourcesMatch: true, assetRoutingMatches: true, validationFixPresent: true };
  report.control = { version: candidateControl, modulesMatch: true, bindingsMatchExceptGate: true,
    assetRoutingMatches: true, authRuntime: runtime };
  report.status = "PASS";
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ artifact: path.relative(root, artifact), status: report.status, error: report.error }));
}