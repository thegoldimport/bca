import assert from "node:assert/strict";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { hash as assetHash } from "blake3-wasm";

// Explicitly authorized infrastructure release, never a generated-project Publish.
const account = "03ef1e6e42498920987f07059e107538";
const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const prefix = "production/vibesdk-launch/resource-envelope";
const checkpoint = `${prefix}-release.json`;
const targets = [
  ["buildcustom-vibesdk-launch", "/tmp/buildcustom-resource-runtime-upload"],
  ["buildcustom-control-plane-launch", "/tmp/buildcustom-resource-control-upload"],
];
const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
const sha = value => createHash("sha256").update(value).digest("hex");
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const load = async file => JSON.parse(await readFile(file, "utf8"));
const save = async report => writeFile(checkpoint, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });

async function cf(method, route, body, customHeaders = {}) {
  const response = await fetch(api + route, {
    method, headers: { ...headers, ...customHeaders }, body,
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  assert(response.ok && result.success, `Cloudflare ${method} failed: HTTP ${response.status}; codes ${
    (result.errors ?? []).map(error => error.code).join(",")}`);
  return result.result;
}
async function current(name) {
  const data = await cf("GET", `/workers/scripts/${name}/deployments`);
  const versions = data.deployments[0]?.versions;
  assert(versions?.length === 1 && versions[0].percentage === 100, "Expected a single serving version");
  return versions[0].version_id;
}
async function version(name, id) {
  return cf("GET", `/workers/scripts/${name}/versions/${id}`);
}
async function remoteModules(name, id) {
  const data = await cf("GET", `/workers/workers/${name}/versions/${id}?include=modules`);
  assert(Array.isArray(data.modules) && typeof data.main_module === "string", "Missing module provenance");
  return { main: data.main_module, modules: data.modules.map(item => ({
    name: item.name, sha256: sha(Buffer.from(item.content_base64, "base64")),
  })).sort((a, b) => a.name.localeCompare(b.name)) };
}
async function modules(directory) {
  const files = (await readdir(directory, { recursive: true })).filter(name => /\.(js|wasm)$/.test(name)).sort();
  return Promise.all(files.map(async name => ({ name, bytes: await readFile(path.join(directory, name)) })));
}
const manifest = items => items.map(item => ({ name: item.name, sha256: sha(item.bytes) }))
  .sort((a, b) => a.name.localeCompare(b.name));
const bindingFingerprint = bindings => sha(stable([...bindings].sort((a, b) => a.name.localeCompare(b.name))));
async function assertBaselines(baseline, report, activated = false) {
  for (const [name, expected] of Object.entries(baseline.workers)) {
    const staged = report?.targets?.[name];
    assert.equal(await current(name), activated && staged?.activated ? staged.version : expected.version,
      `Serving version changed for ${name}`);
  }
}
async function checkGate() {
  const validation = await load(`${prefix}-validation.json`);
  assert.equal(validation.status, "PASS", "Release validation is not PASS");
  for (const [file, expected] of Object.entries(validation.sourceHashes)) {
    assert.equal(sha(await readFile(file)), expected, `Validated source changed: ${file}`);
  }
  for (const [directory, expected] of Object.entries(validation.moduleManifests)) {
    assert.equal(stable(manifest(await modules(directory))), stable(expected), "Validated modules changed");
  }
  return validation;
}
async function assetFiles(directory) {
  const result = {};
  for (const relative of await readdir(directory, { recursive: true })) {
    const filename = path.join(directory, relative);
    if (!(await stat(filename)).isFile() || relative.endsWith(".map")) continue;
    const bytes = await readFile(filename);
    result["/" + relative.replaceAll("\\", "/")] = {
      hash: assetHash(bytes.toString("base64") + path.extname(relative).slice(1)).toString("hex").slice(0, 32),
      size: bytes.length,
    };
  }
  return result;
}
async function uploadAssets(name, expectedManifest) {
  const directory = "dist/public";
  const actual = await assetFiles(directory);
  assert.equal(stable(actual), stable(expectedManifest), "Validated frontend assets changed");
  const session = await cf("POST", `/workers/scripts/${name}/assets-upload-session`,
    JSON.stringify({ manifest: actual }), { "Content-Type": "application/json" });
  let completeJwt = session.buckets.length ? null : session.jwt;
  for (const bucket of session.buckets) {
    const form = new FormData();
    for (const hash of bucket) {
      const entry = Object.entries(actual).find(([, file]) => file.hash === hash);
      assert(entry, "Unrecognized requested asset hash");
      const [relative] = entry;
      const bytes = await readFile(path.join(directory, relative.slice(1)));
      const extension = path.extname(relative);
      const type = extension === ".js" ? "application/javascript"
        : extension === ".css" ? "text/css" : extension === ".html" ? "text/html"
        : extension === ".svg" ? "image/svg+xml" : extension === ".png" ? "image/png" : "application/octet-stream";
      form.append(hash, new Blob([bytes.toString("base64")], { type }), hash);
    }
    const uploaded = await cf("POST", "/workers/assets/upload?base64=true", form,
      { Authorization: `Bearer ${session.jwt}` });
    completeJwt = uploaded.jwt || completeJwt;
  }
  assert(completeJwt, "Asset completion not established");
  return completeJwt; // Never persisted or logged.
}
const action = process.argv[2];
const baseline = await load(`${prefix}-production-baseline.json`);
if (action === "manifest") {
  const assets = await assetFiles("dist/public");
  await writeFile(`${prefix}-assets.json`, JSON.stringify(assets, null, 2) + "\n");
  console.log(JSON.stringify({ assets: Object.keys(assets).length, hash: sha(stable(assets)) }));
} else if (action === "stage") {
  let existing;
  try { existing = await load(checkpoint); } catch (error) { if (error.code !== "ENOENT") throw error; }
  assert(!existing, "A release checkpoint exists; reconcile it rather than uploading again");
  const validation = await checkGate();
  const report = { state: "STAGING", startedAt: new Date().toISOString(), validationSha256: sha(stable(validation)), targets: {} };
  await assertBaselines(baseline, report);
  await save(report);
  try {
    for (const [name, directory] of targets) {
      await assertBaselines(baseline, report);
      const previous = baseline.workers[name].version;
      const list = await cf("GET", `/workers/scripts/${name}/versions`);
      assert.equal(list.items[0].id, previous, "Latest binding source is not the accepted serving version");
      const prior = await version(name, previous);
      const oldModules = await remoteModules(name, previous);
      const local = await modules(directory);
      const expected = manifest(local);
      assert.equal(stable(expected.filter(item => item.name !== oldModules.main)),
        stable(oldModules.modules.filter(item => item.name !== oldModules.main)), "Only the main JS module may change");
      const runtime = JSON.parse(JSON.stringify(prior.resources.script_runtime));
      const expectedBindings = JSON.parse(JSON.stringify(prior.resources.bindings));
      const bindings = prior.resources.bindings.map(binding => ({ name: binding.name, type: "inherit", version_id: "latest" }));
      const metadata = {
        main_module: oldModules.main,
        compatibility_date: runtime.compatibility_date, compatibility_flags: runtime.compatibility_flags,
        bindings, keep_assets: true, ...(runtime.containers ? { containers: runtime.containers } : {}),
        annotations: { "workers/message": "250-credit envelope and existing native resource-terminal status; no generated-project changes" },
      };
      if (name === targets[0][0]) {
        const cost = { name: "THINK_OPERATION_MAX_CREDITS", type: "plain_text", text: "250" };
        metadata.bindings = bindings.filter(binding => binding.name !== cost.name).concat(cost);
        const index = expectedBindings.findIndex(binding => binding.name === cost.name);
        if (index >= 0) expectedBindings.splice(index, 1);
        expectedBindings.push(cost);
      } else {
        metadata.bindings = bindings.map(binding => binding.name === "ASSETS" ? { name: "ASSETS", type: "assets" } : binding);
        metadata.keep_assets = false;
        metadata.assets = {
          jwt: await uploadAssets(name, await load(`${prefix}-assets.json`)),
          config: { not_found_handling: runtime.assets.not_found_handling, run_worker_first: runtime.assets.raw_run_worker_first },
        };
      }
      const staged = { previousVersion: previous, rollbackVersion: previous, state: "UPLOAD_RESERVED",
        main: oldModules.main, modules: expected, expectedRuntime: stable(runtime),
        // Store hashes only, never binding plaintext or credentials.
        expectedBindingsSha256: bindingFingerprint(expectedBindings), activated: false };
      report.targets[name] = staged;
      await save(report);
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      for (const module of local) form.append(module.name, new Blob([module.bytes], {
        type: module.name.endsWith(".wasm") ? "application/wasm" : "application/javascript+module",
      }), module.name);
      const uploaded = await cf("POST", `/workers/scripts/${name}/versions?bindings_inherit=strict`, form);
      staged.version = uploaded.id;
      staged.state = "STAGED";
      await save(report);
      const candidate = await version(name, staged.version);
      assert.equal(bindingFingerprint(candidate.resources.bindings), staged.expectedBindingsSha256, "Binding parity failed");
      assert.equal(stable(candidate.resources.script_runtime), staged.expectedRuntime, "Runtime/container/assets configuration parity failed");
      const remote = await remoteModules(name, staged.version);
      assert.equal(remote.main, staged.main, "Main module name changed");
      assert.equal(stable(remote.modules), stable(staged.modules), "Candidate module identity failed");
      staged.state = "VERIFIED_INACTIVE";
      await save(report);
    }
    report.state = "VERIFIED_INACTIVE";
    await save(report);
  } catch (error) {
    report.state = "STAGING_FAILED_OR_UNKNOWN";
    report.failure = String(error.message).slice(0, 600);
    await save(report);
    throw error;
  }
  console.log(JSON.stringify({ state: report.state, versions: Object.fromEntries(Object.entries(report.targets).map(([k,v])=>[k,v.version])) }));
} else if (action === "activate") {
  await checkGate();
  const report = await load(checkpoint);
  assert.equal(report.state, "VERIFIED_INACTIVE", "Candidate not ready");
  await assertBaselines(baseline, report);
  for (const [name] of targets) {
    const staged = report.targets[name];
    const candidate = await version(name, staged.version);
    assert.equal(bindingFingerprint(candidate.resources.bindings), staged.expectedBindingsSha256, "Binding parity failed");
    assert.equal(stable(candidate.resources.script_runtime), staged.expectedRuntime, "Runtime configuration changed");
    const remote = await remoteModules(name, staged.version);
    assert.equal(remote.main, staged.main);
    assert.equal(stable(remote.modules), stable(staged.modules), "Modules changed");
    staged.state = "ACTIVATION_RESERVED";
    await save(report);
    await cf("POST", `/workers/scripts/${name}/deployments`, JSON.stringify({
      strategy: "percentage", versions: [{ version_id: staged.version, percentage: 100 }],
    }), { "Content-Type": "application/json" });
    assert.equal(await current(name), staged.version, "Activation not observed");
    staged.activated = true;
    staged.state = "ACTIVE";
    await save(report);
    await assertBaselines(baseline, report, true);
  }
  report.state = "ACTIVE";
  report.activatedAt = new Date().toISOString();
  await save(report);
  console.log(JSON.stringify({ state: report.state, versions: Object.fromEntries(Object.entries(report.targets).map(([k,v])=>[k,v.version])) }));
} else throw new Error("Use manifest, stage, or activate");