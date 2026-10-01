#!/usr/bin/env node
// Operator-only instrumentation release. No project data, generation or Publish.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const account = "03ef1e6e42498920987f07059e107538";
const worker = "buildcustom-vibesdk-launch";
const expectedPrevious = "122e2da3-5617-49cc-92ca-5c5723e30af3";
const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const checkpoint = "production/vibesdk-launch/observability-release-operation.json";
const modulesDirectory = "/tmp/buildcustom-observability-upload";
const action = process.argv[2];
assert(["stage", "activate", "observe"].includes(action));
assert(process.env.CLOUDFLARE_API_TOKEN, "Cloudflare credential unavailable");
const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function cf(method, uri, body) {
  const response = await fetch(api + uri, {
    method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000),
  });
  const json = await response.json();
  assert(response.ok && json.success, `Cloudflare ${method}: HTTP ${response.status}; codes ${(json.errors ?? []).map(e => e.code).join(",")}`);
  return json.result;
}
async function current(name) {
  const data = await cf("GET", `/workers/scripts/${name}/deployments`);
  const row = data.deployments[0];
  assert.equal(row.versions.length, 1);
  assert.equal(row.versions[0].percentage, 100);
  return { version: row.versions[0].version_id, deployment: row.id };
}
async function allCurrent() {
  const names = [worker, "buildcustom-control-plane-launch", "buildcustom-apps-gateway", "buildcustom-apps-gateway-launch"];
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await current(name)])));
}
const order = bindings => [...bindings].sort((a, b) => a.name.localeCompare(b.name));
async function save(report) { await writeFile(checkpoint, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); }
let existing;
try { existing = JSON.parse(await readFile(checkpoint, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }

if (action === "stage") {
  assert(!existing, "Instrumentation upload already reserved; do not repeat.");
  const verification = JSON.parse(await readFile("production/vibesdk-launch/observability-local-verification.json", "utf8"));
  assert.equal(verification.status, "PASS");
  assert.equal(verification.safetyReview, "PASS");
  const parity = JSON.parse(await readFile("/tmp/buildcustom-observability-parity.json", "utf8"));
  assert.deepEqual(parity.unexpectedDifferences, []);
  const before = await allCurrent();
  assert.equal(before[worker].version, expectedPrevious);
  const list = await cf("GET", `/workers/scripts/${worker}/versions`);
  assert.equal(list.items[0].id, expectedPrevious, "Latest binding inheritance does not refer to the accepted serving version");
  const version = await cf("GET", `/workers/scripts/${worker}/versions/${expectedPrevious}`);
  const source = await readFile(path.join(modulesDirectory, "index.js"), "utf8");
  for (const marker of ["THINK_DIAGNOSTIC", "operation.persistence", "driver.post-chat-decision", "host.websocket", "preflightCommitDeploy", "INCOMPLETE_RESOURCE_LIMIT", "Enter a valid email address.", "Password does not meet the requirements."]) {
    assert(source.includes(marker), `Missing runtime marker: ${marker}`);
  }
  assert(/\bmaxSteps\s*=\s*25\s*;/.test(source));
  assert.equal(hash(Buffer.from(source)), verification.workerHash, "Worker changed after validation");
  async function moduleNames(directory = "") {
    const result = [];
    for (const entry of await readdir(path.join(modulesDirectory, directory), { withFileTypes: true })) {
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) result.push(...await moduleNames(relative));
      else if (/\.(js|wasm)$/.test(entry.name)) result.push(relative);
    }
    return result;
  }
  const modules = await Promise.all((await moduleNames()).map(async name => ({
    name, bytes: await readFile(path.join(modulesDirectory, name)),
  })));
  const expected = modules.map(m => ({ name: m.name, sha256: hash(m.bytes) })).sort((a, b) => a.name.localeCompare(b.name));
  const metadata = {
    main_module: "index.js",
    compatibility_date: version.resources.script_runtime.compatibility_date,
    compatibility_flags: version.resources.script_runtime.compatibility_flags,
    bindings: version.resources.bindings.map(b => ({ type: "inherit", name: b.name, version_id: "latest" })),
    containers: version.resources.script_runtime.containers, keep_assets: true,
    annotations: { "workers/message": "Safe non-interfering continuous-coding observability only" },
  };
  const report = { startedAt: new Date().toISOString(), state: "UPLOAD_RESERVED", before, expected,
    rollbackVersion: expectedPrevious, parity, verification, retainedBindings: true, retainedAssets: true,
    retainedContainers: true, controlChanged: false, gatewayChanged: false };
  await save(report);
  const boundary = "----BuildCustomSafeObservability";
  const chunks = [];
  function part(header, content) { chunks.push(Buffer.from(`--${boundary}\r\n${header}\r\n\r\n`), content, Buffer.from("\r\n")); }
  part('Content-Disposition: form-data; name="metadata"\r\nContent-Type: application/json', Buffer.from(JSON.stringify(metadata)));
  for (const module of modules) {
    part(`Content-Disposition: form-data; name="${module.name}"; filename="${module.name}"\r\nContent-Type: ${module.name.endsWith(".wasm") ? "application/wasm" : "application/javascript+module"}`, module.bytes);
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const response = await fetch(`${api}/workers/scripts/${worker}/versions?bindings_inherit=strict`, {
    method: "POST", headers: { ...headers, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(chunks), signal: AbortSignal.timeout(120000),
  });
  const json = await response.json();
  if (!response.ok || !json.success || !json.result?.id) {
    report.state = "UPLOAD_FAILED_OR_UNKNOWN";
    report.uploadResponse = { status: response.status, codes: (json.errors ?? []).map(e => e.code) };
    await save(report);
    throw new Error(`Instrumentation upload failed/unknown: HTTP ${response.status}`);
  }
  report.newVersion = json.result.id;
  report.state = "UPLOADED_UNVERIFIED";
  await save(report);
  const next = await cf("GET", `/workers/scripts/${worker}/versions/${report.newVersion}`);
  assert.deepEqual(order(next.resources.bindings), order(version.resources.bindings));
  assert.deepEqual(next.resources.script_runtime, version.resources.script_runtime);
  const stored = await cf("GET", `/workers/workers/${worker}/versions/${report.newVersion}?include=modules`);
  const hashes = stored.modules.map(m => ({ name: m.name, sha256: hash(Buffer.from(m.content_base64, "base64")) })).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(hashes, expected);
  assert.deepEqual(await allCurrent(), before);
  report.state = "STAGED_VERIFIED";
  report.verifiedAt = new Date().toISOString();
  await save(report);
  console.log(JSON.stringify({ state: report.state, newVersion: report.newVersion, rollback: report.rollbackVersion, modules: hashes.length }));
} else if (action === "activate") {
  assert.equal(existing?.state, "STAGED_VERIFIED");
  assert.deepEqual(await allCurrent(), existing.before);
  existing.state = "ACTIVATION_RESERVED";
  await save(existing);
  const result = await cf("POST", `/workers/scripts/${worker}/deployments`, {
    strategy: "percentage", versions: [{ version_id: existing.newVersion, percentage: 100 }],
    annotations: { "workers/message": "Activate verified safe observability; lifecycle unchanged" },
  });
  const after = await allCurrent();
  assert.equal(after[worker].version, existing.newVersion);
  for (const name of Object.keys(existing.before).filter(name => name !== worker)) assert.deepEqual(after[name], existing.before[name]);
  existing.state = "ACTIVE"; existing.rolloutPercentage = 100; existing.deployment = result.id;
  existing.activatedAt = new Date().toISOString(); existing.after = after;
  await save(existing);
  console.log(JSON.stringify({ state: existing.state, version: existing.newVersion, rollout: 100, rollback: existing.rollbackVersion }));
} else {
  console.log(JSON.stringify({ state: existing?.state ?? "NO_CHECKPOINT", current: await allCurrent(), newVersion: existing?.newVersion }));
}