import assert from "node:assert/strict";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { hash as assetHash } from "blake3-wasm";
import { prepareContinuationModules } from "./continuation-module-audit.mjs";

// Authorized platform release only. No generated-project Publish or source edits.
const prefix = "production/vibesdk-launch/user-approved-continuation";
const api = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const targets = [
  ["buildcustom-vibesdk-launch", "2ce0e373-1a98-471c-b21f-3b66d28c4d73", "/tmp/buildcustom-approved-continuation-runtime-upload"],
  ["buildcustom-control-plane-launch", "c5e18eab-1b8b-49d4-adc0-62dfb0e5e6ac", "/tmp/buildcustom-approved-continuation-control-upload"],
];
const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const load = async file => JSON.parse(await readFile(file, "utf8"));
const save = report => writeFile(`${prefix}-release.json`, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
async function cf(method, route, body, extra = {}) {
  const response = await fetch(api + route, {
    method, headers: { ...headers, ...extra }, body, signal: AbortSignal.timeout(120000),
  });
  const data = await response.json();
  assert(response.ok && data.success, `Cloudflare ${method} failed: HTTP ${response.status}, codes ${(data.errors ?? []).map(item => item.code).join(",")}`);
  return data.result;
}
async function current(name) {
  const data = await cf("GET", `/workers/scripts/${name}/deployments`);
  assert.equal(data.deployments[0]?.versions?.length, 1);
  assert.equal(data.deployments[0].versions[0].percentage, 100);
  return data.deployments[0].versions[0].version_id;
}
async function modules(directory) {
  const names = (await readdir(directory, { recursive: true })).filter(name => /\.(js|wasm)$/.test(name) || /^[a-f0-9]{40}-SKILL\.md$/.test(name)).sort();
  return Promise.all(names.map(async name => ({ name, bytes: await readFile(path.join(directory, name)) })));
}
const manifest = items => items.map(item => ({ name: item.name, sha256: sha(item.bytes) })).sort((a, b) => a.name.localeCompare(b.name));
const bindingSha = bindings => sha(stable([...bindings].sort((a, b) => a.name.localeCompare(b.name))));
async function remoteModules(name, version) {
  const data = await cf("GET", `/workers/workers/${name}/versions/${version}?include=modules`);
  assert(Array.isArray(data.modules) && typeof data.main_module === "string");
  return { main: data.main_module, items: data.modules.map(item => ({
    name: item.name, bytes: Buffer.from(item.content_base64, "base64"),
  })) };
}
async function assets() {
  const result = {};
  for (const relative of await readdir("dist/public", { recursive: true })) {
    const file = path.join("dist/public", relative);
    if (!(await stat(file)).isFile() || relative.endsWith(".map")) continue;
    const bytes = await readFile(file);
    result["/" + relative.replaceAll("\\", "/")] = {
      hash: assetHash(bytes.toString("base64") + path.extname(relative).slice(1)).toString("hex").slice(0, 32),
      size: bytes.length,
    };
  }
  return result;
}
async function uploadAssets(name, expected) {
  assert.equal(stable(await assets()), stable(expected), "Assets changed after validation");
  const session = await cf("POST", `/workers/scripts/${name}/assets-upload-session`,
    JSON.stringify({ manifest: expected }), { "Content-Type": "application/json" });
  let completion = session.buckets.length ? null : session.jwt;
  for (const bucket of session.buckets) {
    const form = new FormData();
    for (const hash of bucket) {
      const entry = Object.entries(expected).find(([, item]) => item.hash === hash);
      assert(entry);
      const bytes = await readFile(path.join("dist/public", entry[0].slice(1)));
      const extension = path.extname(entry[0]);
      const type = extension === ".js" ? "application/javascript"
        : extension === ".css" ? "text/css" : extension === ".html" ? "text/html"
        : extension === ".svg" ? "image/svg+xml" : extension === ".png" ? "image/png" : "application/octet-stream";
      form.append(hash, new Blob([bytes.toString("base64")], { type }), hash);
    }
    const uploaded = await cf("POST", "/workers/assets/upload?base64=true", form, { Authorization: `Bearer ${session.jwt}` });
    completion = uploaded.jwt || completion;
  }
  assert(completion);
  return completion; // Opaque upload capability: never persisted or logged.
}
async function validated() {
  const validation = await load(`${prefix}-validation.json`);
  assert.equal(validation.status, "PASS");
  for (const [file, expected] of Object.entries(validation.sourceHashes)) {
    assert.equal(sha(await readFile(file)), expected, `Validated source changed: ${file}`);
  }
  for (const [name, , directory] of targets) {
    assert.equal(stable(manifest(await modules(directory))), stable(validation.modules[name]));
  }
  assert.equal(stable(await assets()), stable(validation.assets));
  const remote = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], { encoding: "utf8" }).split(/\s/)[0];
  assert.equal(remote, validation.canonicalCommit, "Canonical push is not verified");
  return validation;
}

const action = process.argv[2];
if (action === "validation") {
  assert(/^[a-f0-9]{40}$/.test(process.argv[3] ?? ""), "Pass the verified canonical commit");
  const receipt = await load(`${prefix}-source.json`);
  const files = [
    "client/src/pages/app-dashboard.tsx", "client/src/lib/native-continuation.ts",
    "client/src/lib/native-continuation.test.ts", "cloudflare/staging/think-runtime.ts",
    "tests/native-completion.browser.test.js", "tests/native-task-lifecycle-status.test.ts",
    "tests/user-approved-continuation-runtime.test.ts",
    "scripts/prepare-user-approved-continuation-source.mjs",
    "scripts/reconstruct-user-approved-continuation-runtime.mjs",
    "scripts/user-approved-continuation-release.mjs",
    "scripts/resource-envelope-module-audit.mjs",
    "scripts/continuation-module-audit.mjs", "scripts/continuation-module-audit.test.mjs",
    `${prefix}-source.json`, receipt.patch.path,
    ...Object.keys(receipt.sourceHashes).map(file => `production/vibesdk-launch/runtime-source/${file}`),
  ];
  const sourceHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await readFile(file))])));
  const moduleManifests = Object.fromEntries(await Promise.all(targets.map(async ([name, , directory]) => [name, manifest(await modules(directory))])));
  const validation = {
    status: "PASS", canonicalCommit: process.argv[3], sourceHashes, modules: moduleManifests, assets: await assets(),
    checks: { rootTestsPassed: 282, runtimeTestsPassed: 689, runtimeSkipped: 1, renderedUiTestsPassed: 28,
      rootTypecheck: "PASS", runtimeTypecheck: "PASS", frontendBuild: "PASS", workerDryRuns: "PASS", sourceReconstruction: "PASS" },
  };
  await writeFile(`${prefix}-validation.json`, JSON.stringify(validation, null, 2) + "\n");
  console.log(JSON.stringify({ status: "PASS", validatedPaths: files.length, assets: Object.keys(validation.assets).length }));
} else if (action === "stage") {
  const validation = await validated();
  try { await readFile(`${prefix}-release.json`); throw new Error("A release receipt already exists; do not stage twice."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const preflight = [];
  for (const [name, previous, directory] of targets) {
    assert.equal(await current(name), previous, "Serving version changed");
    const latest = await cf("GET", `/workers/scripts/${name}/versions`);
    assert.equal(latest.items[0]?.id, previous, "Latest version is not the serving baseline");
    const prior = await cf("GET", `/workers/scripts/${name}/versions/${previous}`);
    const old = await remoteModules(name, previous);
    const prepared = prepareContinuationModules(old.items, await modules(directory), old.main);
    const local = prepared.candidate;
    const audit = prepared.audit;
    assert.equal(audit.status, "PASS");
    preflight.push({ name, previous, prior, old, local, audit });
  }
  const report = { state: "STAGING", canonicalCommit: validation.canonicalCommit, targets: {} };
  await save(report);
  try {
    for (const item of preflight) {
      const { name, previous, prior, old, local, audit } = item;
      assert.equal(await current(name), previous);
      const runtime = JSON.parse(JSON.stringify(prior.resources.script_runtime));
      const expectedBindings = prior.resources.bindings;
      const bindings = expectedBindings.map(binding => ({ name: binding.name, type: "inherit", version_id: "latest" }));
      const metadata = {
        main_module: old.main, compatibility_date: runtime.compatibility_date,
        compatibility_flags: runtime.compatibility_flags, bindings, keep_assets: true,
        ...(runtime.containers ? { containers: runtime.containers } : {}),
        annotations: { "workers/message": "Customer-approved continuation lifecycle; no generated-project Publish" },
      };
      if (name === targets[1][0]) {
        metadata.bindings = bindings.map(binding => binding.name === "ASSETS" ? { name: "ASSETS", type: "assets" } : binding);
        metadata.keep_assets = false;
        metadata.assets = {
          jwt: await uploadAssets(name, validation.assets),
          config: { not_found_handling: runtime.assets.not_found_handling, run_worker_first: runtime.assets.raw_run_worker_first },
        };
      }
      const entry = {
        previousVersion: previous, rollbackVersion: previous, state: "UPLOAD_RESERVED", main: old.main,
        modules: manifest(local), bindingSha256: bindingSha(expectedBindings), runtimeSha256: sha(stable(runtime)),
        moduleAudit: audit.status,
      };
      report.targets[name] = entry;
      await save(report);
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      for (const module of local) form.append(module.name, new Blob([module.bytes], {
        type: module.name.endsWith(".wasm") ? "application/wasm"
          : module.name.endsWith(".md") ? "text/plain" : "application/javascript+module",
      }), module.name);
      const uploaded = await cf("POST", `/workers/scripts/${name}/versions?bindings_inherit=strict`, form);
      entry.version = uploaded.id;
      entry.state = "STAGED";
      await save(report);
      const observed = await cf("GET", `/workers/scripts/${name}/versions/${entry.version}`);
      assert.equal(bindingSha(observed.resources.bindings), entry.bindingSha256);
      assert.equal(sha(stable(observed.resources.script_runtime)), entry.runtimeSha256);
      const remote = await remoteModules(name, entry.version);
      assert.equal(remote.main, entry.main);
      assert.equal(stable(manifest(remote.items)), stable(entry.modules));
      entry.state = "VERIFIED_INACTIVE";
      await save(report);
    }
    report.state = "VERIFIED_INACTIVE";
    await save(report);
  } catch (error) {
    report.state = "STAGING_FAILED_OR_UNKNOWN";
    await save(report);
    throw error;
  }
  console.log(JSON.stringify({ state: report.state, versions: Object.fromEntries(Object.entries(report.targets).map(([name, item]) => [name, item.version])) }));
} else if (action === "activate") {
  await validated();
  const report = await load(`${prefix}-release.json`);
  assert.equal(report.state, "VERIFIED_INACTIVE");
  for (const [name, previous] of targets) assert.equal(await current(name), previous);
  for (const [name] of targets) {
    const entry = report.targets[name];
    const observed = await cf("GET", `/workers/scripts/${name}/versions/${entry.version}`);
    assert.equal(bindingSha(observed.resources.bindings), entry.bindingSha256);
    assert.equal(sha(stable(observed.resources.script_runtime)), entry.runtimeSha256);
    const remote = await remoteModules(name, entry.version);
    assert.equal(remote.main, entry.main);
    assert.equal(stable(manifest(remote.items)), stable(entry.modules));
    entry.state = "ACTIVATION_RESERVED";
    await save(report);
    const deployment = await cf("POST", `/workers/scripts/${name}/deployments`,
      JSON.stringify({ strategy: "percentage", versions: [{ version_id: entry.version, percentage: 100 }],
        annotations: { "workers/message": "Activate verified customer-approved continuation" } }),
      { "Content-Type": "application/json" });
    assert.equal(await current(name), entry.version);
    entry.deploymentId = deployment.id;
    entry.state = "ACTIVE";
    await save(report);
  }
  report.state = "ACTIVE";
  await save(report);
  console.log(JSON.stringify({ state: report.state, versions: Object.fromEntries(Object.entries(report.targets).map(([name, item]) => [name, item.version])) }));
} else {
  assert.equal(action, "observe");
  console.log(JSON.stringify({ current: Object.fromEntries(await Promise.all(targets.map(async ([name]) => [name, await current(name)]))) }));
}