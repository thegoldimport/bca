import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { auditModuleSets } from "./resource-envelope-module-audit.mjs";

// Explicitly authorized platform release only. Never publishes a customer app.
const account = "03ef1e6e42498920987f07059e107538";
const prefix = "production/vibesdk-launch/publisher-routing";
const targets = [
  ["buildcustom-control-plane-launch", "/tmp/publisher-control-upload", "dd40f46c-cd23-4e82-8679-83460169570f"],
  ["buildcustom-vibesdk-launch", "/tmp/publisher-runtime-upload", "5a964dd5-db65-4cde-83f8-22a17f4d909f"],
];
const gateways = {
  "buildcustom-apps-gateway": "9d80432b-4e53-4fe7-950a-2b53f0213eff",
  "buildcustom-apps-gateway-launch": "26ac7a8c-695f-49d9-845a-8fe79ec2c28e",
};
const sha = value => createHash("sha256").update(value).digest("hex");
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const load = async suffix => JSON.parse(await readFile(`${prefix}-${suffix}.json`, "utf8"));
async function save(suffix, value, exclusive = false) {
  await writeFile(`${prefix}-${suffix}.json`, JSON.stringify(value, null, 2) + "\n",
    { mode: 0o600, ...(exclusive ? { flag: "wx" } : {}) });
}
async function cf(method, route, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${route}`, {
    method, headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}) }, body,
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  assert(response.ok && result.success, `Cloudflare ${method} failed: HTTP ${response.status}; codes ${
    (result.errors ?? []).map(item => item.code).join(",")}`);
  return result.result;
}
async function current(name) {
  const r = await cf("GET", `/workers/scripts/${name}/deployments`);
  const versions = r.deployments[0]?.versions;
  assert(versions?.length === 1 && versions[0].percentage === 100, "Expected one serving version at 100%");
  return versions[0].version_id;
}
async function guard(report, active = false) {
  for (const [name, , previous] of targets) {
    assert.equal(await current(name), active && report?.targets?.[name]?.activated
      ? report.targets[name].version : previous, `Serving version changed: ${name}`);
  }
  for (const [name, version] of Object.entries(gateways)) assert.equal(await current(name), version, `Gateway changed: ${name}`);
}
async function remote(name, id) {
  const r = await cf("GET", `/workers/workers/${name}/versions/${id}?include=modules`);
  assert(typeof r.main_module === "string" && Array.isArray(r.modules));
  return { main: r.main_module, modules: r.modules.map(item => ({
    name: item.name, bytes: Buffer.from(item.content_base64, "base64"),
  })).sort((a, b) => a.name.localeCompare(b.name)) };
}
async function local(directory) {
  return Promise.all((await readdir(directory, { recursive: true })).filter(file => /\.(js|wasm)$/.test(file))
    .sort().map(async name => ({ name, bytes: await readFile(path.join(directory, name)) })));
}
const manifest = modules => modules.map(item => ({ name: item.name, sha256: sha(item.bytes) }))
  .sort((a, b) => a.name.localeCompare(b.name));
const bindingsHash = bindings => sha(stable([...bindings].sort((a, b) => a.name.localeCompare(b.name))));
async function sourceGate() {
  const validation = await load("validation");
  assert.equal(validation.status, "PASS");
  const source = await load("source-parity");
  for (const [file, expected] of Object.entries(source.sourceHashes)) {
    assert.equal(sha(await readFile(`production/vibesdk-launch/runtime-source/${file}`)), expected, `Source changed: ${file}`);
  }
  for (const [file, expected] of Object.entries(validation.controlSourceHashes)) {
    assert.equal(sha(await readFile(file)), expected, `Control source changed: ${file}`);
  }
  for (const [directory, expected] of Object.entries(validation.moduleManifests)) {
    assert.equal(stable(manifest(await local(directory))), stable(expected), `Validated bundle changed: ${directory}`);
  }
  return sha(stable(validation));
}
const action = process.argv[2];
if (action === "audit") {
  await guard();
  const audit = { status: "PASS", auditedAt: new Date().toISOString(), validationHash: await sourceGate(), targets: {} };
  for (const [name, directory, previous] of targets) {
    const versions = await cf("GET", `/workers/scripts/${name}/versions`);
    assert.equal(versions.items[0]?.id, previous, "Latest version must be the serving baseline");
    const old = await remote(name, previous);
    const candidate = await local(directory);
    assert(candidate.find(item => item.name === old.main)?.bytes.includes(Buffer.from("app-routing-v2")),
      "Publisher marker missing from candidate main module");
    const modulesAudit = auditModuleSets(old.modules, candidate, old.main);
    const prior = await cf("GET", `/workers/scripts/${name}/versions/${previous}`);
    audit.targets[name] = { previous, main: old.main, oldModules: manifest(old.modules),
      candidateModules: manifest(candidate), modulesAudit, bindingsHash: bindingsHash(prior.resources.bindings),
      runtime: stable(prior.resources.script_runtime) };
  }
  await save("audit", audit);
  console.log(JSON.stringify({ status: audit.status, previous: Object.fromEntries(targets.map(([name,,id]) => [name,id])) }));
} else if (action === "stage") {
  const audit = await load("audit");
  assert.equal(audit.status, "PASS");
  assert.equal(await sourceGate(), audit.validationHash);
  await guard();
  const report = { state: "STAGING", canonicalCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    validationHash: audit.validationHash, targets: {} };
  await save("release", report, true); // A reserved/unknown upload may never be blindly retried.
  for (const [name, directory, previous] of targets) {
    await guard();
    const versions = await cf("GET", `/workers/scripts/${name}/versions`);
    assert.equal(versions.items[0]?.id, previous, "Latest inheritance source changed");
    const prior = await cf("GET", `/workers/scripts/${name}/versions/${previous}`);
    assert.equal(bindingsHash(prior.resources.bindings), audit.targets[name].bindingsHash);
    const runtime = prior.resources.script_runtime;
    assert.equal(stable(runtime), audit.targets[name].runtime);
    const modules = await local(directory);
    assert.equal(stable(manifest(modules)), stable(audit.targets[name].candidateModules));
    const metadata = { main_module: audit.targets[name].main,
      compatibility_date: runtime.compatibility_date, compatibility_flags: runtime.compatibility_flags,
      bindings: prior.resources.bindings.map(binding => ({ name: binding.name, type: "inherit", version_id: "latest" })),
      keep_assets: true, ...(runtime.containers ? { containers: runtime.containers } : {}),
      annotations: { "workers/message": "Versioned publisher routing fix only; generated source, auth and limits unchanged" } };
    report.targets[name] = { previousVersion: previous, state: "UPLOAD_RESERVED", modules: manifest(modules) };
    await save("release", report);
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    for (const module of modules) form.append(module.name, new Blob([module.bytes], {
      type: module.name.endsWith(".wasm") ? "application/wasm" : "application/javascript+module",
    }), module.name);
    const uploaded = await cf("POST", `/workers/scripts/${name}/versions?bindings_inherit=strict`, form);
    const staged = report.targets[name];
    staged.version = uploaded.id;
    staged.state = "STAGED";
    await save("release", report);
    const candidate = await cf("GET", `/workers/scripts/${name}/versions/${uploaded.id}`);
    assert.equal(bindingsHash(candidate.resources.bindings), audit.targets[name].bindingsHash, "Binding parity failed");
    assert.equal(stable(candidate.resources.script_runtime), audit.targets[name].runtime, "Runtime/config parity failed");
    const readback = await remote(name, uploaded.id);
    assert.equal(readback.main, audit.targets[name].main);
    assert.equal(stable(manifest(readback.modules)), stable(staged.modules), "Uploaded bytes mismatch");
    staged.state = "VERIFIED_INACTIVE";
    await save("release", report);
  }
  report.state = "VERIFIED_INACTIVE";
  await save("release", report);
  console.log(JSON.stringify({ state: report.state, versions: Object.fromEntries(Object.entries(report.targets).map(([name, r]) => [name,r.version])) }));
} else if (action === "activate") {
  const report = await load("release");
  assert.equal(report.state, "VERIFIED_INACTIVE");
  assert.equal(await sourceGate(), report.validationHash);
  await guard(report);
  for (const [name] of targets) {
    await guard(report, true);
    const r = report.targets[name];
    const deployed = await cf("POST", `/workers/scripts/${name}/deployments`, JSON.stringify({
      strategy: "percentage", versions: [{ version_id: r.version, percentage: 100 }],
    }));
    r.deployment = deployed.id;
    r.activated = true;
    await save("release", report);
    assert.equal(await current(name), r.version, "Serving readback failed");
  }
  await guard(report, true);
  report.state = "ACTIVE";
  report.activatedAt = new Date().toISOString();
  await save("release", report);
  console.log(JSON.stringify({ state: report.state, versions: Object.fromEntries(Object.entries(report.targets).map(([name,r]) => [name,r.version])) }));
} else throw new Error("Use audit (GET only), stage, or activate. Never retry a failed stage/activation.");