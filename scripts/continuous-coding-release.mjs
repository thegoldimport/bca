#!/usr/bin/env node
// Operator-only release utility. No generation, project mutation, or Publish.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const account = "03ef1e6e42498920987f07059e107538";
const worker = "buildcustom-vibesdk-launch";
const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const checkpoint = "production/vibesdk-launch/continuous-coding-release-operation.json";
const modulesDirectory = "/tmp/buildcustom-lifecycle-upload";
const action = process.argv[2];
assert(["stage", "stage-corrected", "activate", "rollback", "observe"].includes(action));
assert(process.env.CLOUDFLARE_API_TOKEN, "Cloudflare credential unavailable");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
async function cf(method, uri, body) {
  const response = await fetch(api + uri, {
    method,
    headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  const json = await response.json();
  assert(response.ok && json.success === true,
    `Cloudflare ${method} HTTP ${response.status}; codes ${(json.errors ?? []).map(e => e.code).join(",")}`);
  return json.result;
}
async function current(name) {
  const data = await cf("GET", `/workers/scripts/${name}/deployments`);
  const row = data.deployments[0];
  assert.equal(row.versions.length, 1, `${name} has a split deployment`);
  assert.equal(row.versions[0].percentage, 100);
  return { version: row.versions[0].version_id, deployment: row.id };
}
async function allCurrent() {
  const names = [worker, "buildcustom-control-plane-launch", "buildcustom-apps-gateway", "buildcustom-apps-gateway-launch"];
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await current(name)])));
}
const order = bindings => [...bindings].sort((a, b) => a.name.localeCompare(b.name));
async function save(report) {
  await writeFile(checkpoint, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
async function load() {
  try { return JSON.parse(await readFile(checkpoint, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
const existing = await load();
if (action === "stage" || action === "stage-corrected") {
  const corrected = action === "stage-corrected";
  if (corrected) {
    assert.equal(existing?.state, "UPLOAD_FAILED_OR_UNKNOWN");
    assert.equal(existing.uploadResponse.status, 400);
    assert(existing.uploadResponse.codes.length > 0 && existing.uploadResponse.codes.every(code => code === 10057));
    assert(!existing.metadataCorrection, "Only one metadata correction is permitted.");
  } else assert(!existing, "Release action already reserved; do not repeat uploads.");
  const parity = JSON.parse(await readFile("/tmp/buildcustom-release-source-parity.json", "utf8"));
  assert.deepEqual(parity.differences, []);
  const before = await allCurrent();
  if (corrected) assert.deepEqual(before, existing.before);
  const previous = before[worker].version;
  if (corrected) {
    const list = await cf("GET", `/workers/scripts/${worker}/versions`);
    assert.equal(list.items[0].id, previous, "Latest is not the active accepted version");
  }
  const version = await cf("GET", `/workers/scripts/${worker}/versions/${previous}`);
  const bytes = await readFile(path.join(modulesDirectory, "index.js"));
  const source = bytes.toString("utf8");
  for (const marker of [
    "preflightCommitDeploy", "INCOMPLETE_RESOURCE_LIMIT",
    "THINK_OPERATION_MAX_CONTINUATIONS", "THINK_OPERATION_MAX_ELAPSED_MS",
    "Enter a valid email address.", "Password does not meet the requirements.",
  ]) assert(source.includes(marker), `Missing candidate marker: ${marker}`);
  assert(/\bmaxSteps\s*=\s*25\s*;/.test(source), "Native Think guard differs");
  async function moduleNames(directory = "") {
    const result = [];
    for (const entry of await readdir(path.join(modulesDirectory, directory), { withFileTypes: true })) {
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) result.push(...await moduleNames(relative));
      else if (/\.(js|wasm)$/.test(entry.name)) result.push(relative);
    }
    return result;
  }
  const names = await moduleNames();
  const modules = await Promise.all(names.map(async name => ({
    name, bytes: await readFile(path.join(modulesDirectory, name)),
  })));
  const expected = modules.map(m => ({ name: m.name, sha256: hash(m.bytes) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const limitBindings = [
    { type: "plain_text", name: "THINK_OPERATION_MAX_CONTINUATIONS", text: "4" },
    { type: "plain_text", name: "THINK_OPERATION_MAX_ELAPSED_MS", text: "900000" },
  ];
  assert(!version.resources.bindings.some(b => limitBindings.some(v => v.name === b.name)),
    "Operation limits already exist; investigate before changing them.");
  const metadata = {
    main_module: "index.js",
    compatibility_date: version.resources.script_runtime.compatibility_date,
    compatibility_flags: version.resources.script_runtime.compatibility_flags,
    bindings: [
      ...version.resources.bindings.map(b => ({ type: "inherit", name: b.name, version_id: corrected ? "latest" : previous })),
      ...limitBindings,
    ],
    containers: version.resources.script_runtime.containers,
    keep_assets: true,
    annotations: { "workers/message": "Verified continuous coding lifecycle and accepted auth provenance" },
  };
  const report = {
    startedAt: new Date().toISOString(), state: "UPLOAD_RESERVED", before, expected,
    parity, limits: { maxSteps: 25, maxTotalTurns: 5, maxContinuations: 4, maxElapsedMs: 900000 },
    retainedAssets: true, retainedContainers: true,
    rollbackCommand: "node scripts/continuous-coding-release.mjs rollback",
    ...(corrected ? { metadataCorrection: true, priorUploadResponse: existing.uploadResponse } : {}),
  };
  await save(report);
  const boundary = "----BuildCustomLifecycleCandidate";
  const chunks = [];
  function part(header, content) {
    chunks.push(Buffer.from(`--${boundary}\r\n${header}\r\n\r\n`), content, Buffer.from("\r\n"));
  }
  part('Content-Disposition: form-data; name="metadata"\r\nContent-Type: application/json',
    Buffer.from(JSON.stringify(metadata)));
  for (const module of modules) {
    const type = module.name.endsWith(".wasm") ? "application/wasm" :
      module.name.endsWith(".md") ? "text/plain" : "application/javascript+module";
    part(`Content-Disposition: form-data; name="${module.name}"; filename="${module.name}"\r\nContent-Type: ${type}`,
      module.bytes);
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const response = await fetch(`${api}/workers/scripts/${worker}/versions?bindings_inherit=strict`, {
    method: "POST", headers: { ...headers, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(chunks), signal: AbortSignal.timeout(120000),
  });
  const json = await response.json();
  if (!response.ok || json.success !== true || !json.result?.id) {
    report.state = "UPLOAD_FAILED_OR_UNKNOWN";
    report.uploadResponse = {
      status: response.status, codes: (json.errors ?? []).map(e => e.code),
      messages: (json.errors ?? []).map(e => String(e.message ?? "").slice(0, 1500)),
    };
    await save(report);
    throw new Error(`Upload failed/unknown: HTTP ${response.status}`);
  }
  report.newVersion = json.result.id;
  report.state = "UPLOADED_UNVERIFIED";
  await save(report);
  const next = await cf("GET", `/workers/scripts/${worker}/versions/${report.newVersion}`);
  assert.deepEqual(order(next.resources.bindings), order([...version.resources.bindings, ...limitBindings]));
  assert.deepEqual(next.resources.script_runtime, version.resources.script_runtime);
  const stored = await cf("GET", `/workers/workers/${worker}/versions/${report.newVersion}?include=modules`);
  const hashes = stored.modules.map(m => ({
    name: m.name, sha256: hash(Buffer.from(m.content_base64, "base64")),
  })).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(hashes, expected);
  assert.deepEqual(await allCurrent(), before, "Serving versions changed during staging");
  report.state = "STAGED_VERIFIED";
  report.bindingsVerified = true;
  report.modulesVerified = true;
  report.verifiedAt = new Date().toISOString();
  await save(report);
  console.log(JSON.stringify({ state: report.state, before, newVersion: report.newVersion, modules: expected.length }));
} else {
  assert(existing, "No release checkpoint");
  if (action === "observe") {
    console.log(JSON.stringify({ state: existing.state, current: await allCurrent(), newVersion: existing.newVersion }));
  } else {
    const rollback = action === "rollback";
    assert.equal(existing.state, rollback ? "ACTIVE" : "STAGED_VERIFIED");
    const observed = await allCurrent();
    const expectedVersion = rollback ? existing.newVersion : existing.before[worker].version;
    assert.equal(observed[worker].version, expectedVersion);
    for (const name of Object.keys(existing.before).filter(name => name !== worker)) {
      assert.deepEqual(observed[name], existing.before[name]);
    }
    existing.state = rollback ? "ROLLBACK_RESERVED" : "ACTIVATION_RESERVED";
    await save(existing);
    const target = rollback ? existing.before[worker].version : existing.newVersion;
    const result = await cf("POST", `/workers/scripts/${worker}/deployments`, {
      strategy: "percentage", versions: [{ version_id: target, percentage: 100 }],
      annotations: { "workers/message": rollback ? "Rollback continuous coding candidate" : "Activate verified continuous coding candidate" },
    });
    assert.equal((await current(worker)).version, target);
    existing.state = rollback ? "ROLLED_BACK" : "ACTIVE";
    existing.lastDeployment = result.id;
    existing.updatedAt = new Date().toISOString();
    await save(existing);
    console.log(JSON.stringify({ state: existing.state, version: target, deployment: result.id }));
  }
}