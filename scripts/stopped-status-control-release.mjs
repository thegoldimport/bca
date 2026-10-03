import assert from "node:assert/strict";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { hash as assetHash } from "blake3-wasm";
const account = "03ef1e6e42498920987f07059e107538";
const worker = "buildcustom-control-plane-launch";
const previous = "01a0e626-fc88-4696-8945-88a5677142bf";
const runtimeWorker = "buildcustom-vibesdk-launch";
const runtimeVersion = "5ab138b7-75fa-4cd2-8146-494171468a2f";
const canonical = process.argv[2];
assert(/^[a-f0-9]{40}$/.test(canonical));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const stable = x => JSON.stringify(x);
const bindingHash = b => sha(stable([...b].sort((a, b) => a.name.localeCompare(b.name))));
async function cf(method, route, body, headers = {}) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${route}`, {
    method, body, headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, ...headers },
    signal: AbortSignal.timeout(120000),
  });
  const j = await r.json(); assert(r.ok && j.success, `Cloudflare request failed: ${r.status}`);
  return j.result;
}
async function current(name) {
  const d = await cf("GET", `/workers/scripts/${name}/deployments`);
  assert.equal(d.deployments[0].versions.length, 1);
  assert.equal(d.deployments[0].versions[0].percentage, 100);
  return d.deployments[0].versions[0].version_id;
}
async function remote(version) {
  return cf("GET", `/workers/workers/${worker}/versions/${version}?include=modules`);
}
const receiptPath = ".local/state/stopped-status/control-release.json";
await assert.rejects(readFile(receiptPath), { code: "ENOENT" });
assert.equal(await current(worker), previous);
assert.equal(await current(runtimeWorker), runtimeVersion);
const prior = await cf("GET", `/workers/scripts/${worker}/versions/${previous}`);
const old = await remote(previous);
const runtime = prior.resources.script_runtime;
const manifest = {};
for (const file of await readdir("dist/public", { recursive: true })) {
  const full = path.join("dist/public", file);
  if (!(await stat(full)).isFile() || file.endsWith(".map")) continue;
  const bytes = await readFile(full);
  manifest["/" + file.replaceAll("\\", "/")] = {
    hash: assetHash(bytes.toString("base64") + path.extname(file).slice(1)).toString("hex").slice(0, 32),
    size: bytes.length,
  };
}
const session = await cf("POST", `/workers/scripts/${worker}/assets-upload-session`,
  JSON.stringify({ manifest }), { "Content-Type": "application/json" });
let jwt = session.buckets.length ? null : session.jwt;
for (const bucket of session.buckets) {
  const form = new FormData();
  for (const hash of bucket) {
    const [file] = Object.entries(manifest).find(([, v]) => v.hash === hash);
    const bytes = await readFile(path.join("dist/public", file.slice(1)));
    const extension = path.extname(file);
    const type = extension === ".js" ? "application/javascript" : extension === ".css" ? "text/css"
      : extension === ".html" ? "text/html" : extension === ".svg" ? "image/svg+xml"
      : extension === ".png" ? "image/png" : "application/octet-stream";
    form.append(hash, new Blob([bytes.toString("base64")], { type }), hash);
  }
  const uploaded = await cf("POST", "/workers/assets/upload?base64=true", form, { Authorization: `Bearer ${session.jwt}` });
  jwt = uploaded.jwt ?? jwt;
}
assert(jwt);
const metadata = {
  main_module: old.main_module, compatibility_date: runtime.compatibility_date,
  compatibility_flags: runtime.compatibility_flags,
  bindings: prior.resources.bindings.map(b => b.name === "ASSETS" ? { name: "ASSETS", type: "assets" }
    : { name: b.name, type: "inherit", version_id: "latest" }),
  assets: { jwt, config: { not_found_handling: runtime.assets.not_found_handling,
    run_worker_first: runtime.assets.raw_run_worker_first } },
  annotations: { "workers/message": "Stopped editor status synchronization only; continuation implementation frozen" },
};
const form = new FormData(); form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
for (const m of old.modules) form.append(m.name, new Blob([Buffer.from(m.content_base64, "base64")],
  { type: "application/javascript+module" }), m.name);
const version = await cf("POST", `/workers/scripts/${worker}/versions`, form);
const candidate = await cf("GET", `/workers/scripts/${worker}/versions/${version.id}`);
assert.equal(bindingHash(candidate.resources.bindings), bindingHash(prior.resources.bindings));
assert.equal(stable(candidate.resources.script_runtime), stable(runtime));
const candidateModules = await remote(version.id);
assert.equal(candidateModules.main_module, old.main_module);
const moduleHashes = data => data.modules.map(m => ({ name: m.name, hash: sha(Buffer.from(m.content_base64, "base64")) }));
assert.equal(stable(moduleHashes(candidateModules)), stable(moduleHashes(old)));
const receipt = { state: "VERIFIED_INACTIVE", canonical, previous, version: version.id, rollback: previous,
  runtimeUnchanged: runtimeVersion, workerModuleBytesUnchanged: true, bindingsUnchanged: true, manifest };
await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
assert.equal(await current(worker), previous); assert.equal(await current(runtimeWorker), runtimeVersion);
const d = await cf("POST", `/workers/scripts/${worker}/deployments`, JSON.stringify({
  strategy: "percentage", versions: [{ version_id: version.id, percentage: 100 }],
  annotations: { "workers/message": "Activate verified stopped-status UI correction" },
}), { "Content-Type": "application/json" });
assert.equal(await current(worker), version.id); assert.equal(await current(runtimeWorker), runtimeVersion);
receipt.state = "ACTIVE"; receipt.deploymentId = d.id;
await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ state: receipt.state, canonical, previous, version: version.id, runtimeUnchanged: runtimeVersion }));