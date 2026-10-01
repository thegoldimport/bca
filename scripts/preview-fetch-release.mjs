#!/usr/bin/env node
// Operator-only helper for a narrowly scoped control-plane preview-fetch fix.
// No generation, project data, asset upload, Publish, or automatic retries.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const account = "03ef1e6e42498920987f07059e107538";
const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const worker = "buildcustom-control-plane-launch";
const workers = [
  worker,
  "buildcustom-vibesdk-launch",
  "buildcustom-apps-gateway",
  "buildcustom-apps-gateway-launch",
];
const acceptedVersions = {
  "buildcustom-control-plane-launch": "0e01f7dc-51c4-4736-9873-ea431abc823c",
  "buildcustom-vibesdk-launch": "f4488693-4424-46a3-9834-30b214645449",
  "buildcustom-apps-gateway": "9d80432b-4e53-4fe7-950a-2b53f0213eff",
  "buildcustom-apps-gateway-launch": "26ac7a8c-695f-49d9-845a-8fe79ec2c28e",
};
const acceptedSourceCommit = "6cea62eacf8ba4eb17fd53fbfc8872e4eed14b8b";
const modulesDirectory = "/tmp/buildcustom-preview-fetch-upload";
const baselineModulesDirectory = "/tmp/buildcustom-preview-fetch-baseline";

function receiptPaths(prefix) {
  const base = `production/vibesdk-launch/${prefix}`;
  return {
    baselineFile: `${base}-production-baseline.json`,
    validationFile: `${base}-validation.json`,
    parityFile: `${base}-source-parity.json`,
    checkpoint: `${base}-release-operation.json`,
  };
}

function command(action, prefix = receiptPrefix) {
  assert(["observe", "verify-baseline", "stage", "stage-latest", "activate", "rollback", "reconcile", "self-test"].includes(action),
    `Unsupported release-helper command: ${action}`);
  return `node scripts/preview-fetch-release.mjs ${action}${
    prefix === "preview-fetch" ? "" : ` --receipt-prefix=${prefix}`
  }`;
}

function parseCommandLine(args) {
  const [action, ...options] = args;
  assert(["observe", "verify-baseline", "stage", "stage-latest", "activate", "rollback", "reconcile", "self-test"].includes(action),
    "Usage: node scripts/preview-fetch-release.mjs <action> [--receipt-prefix=<safe-name>]");
  let receiptPrefix = "preview-fetch";
  let prefixSeen = false;
  for (const option of options) {
    assert(option.startsWith("--receipt-prefix="), `Unknown argument: ${option}`);
    assert(!prefixSeen, "--receipt-prefix may be specified only once");
    prefixSeen = true;
    receiptPrefix = option.slice("--receipt-prefix=".length);
    assert(/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(receiptPrefix),
      "Receipt prefix must contain only letters, digits, and dashes and may not be empty");
  }
  return { action, receiptPrefix };
}

const { action, receiptPrefix } = parseCommandLine(process.argv.slice(2));
const { baselineFile, validationFile, parityFile, checkpoint } = receiptPaths(receiptPrefix);
if (action !== "self-test") assert(process.env.CLOUDFLARE_API_TOKEN, "Cloudflare credential unavailable");

const originalReceiptPaths = receiptPaths("preview-fetch");

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const authHeaders = () => ({ Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` });

async function cf(method, uri, body) {
  const response = await fetch(api + uri, {
    method,
    headers: { ...authHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(method === "POST" ? 120000 : 60000),
  });
  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(`Cloudflare ${method} returned a non-JSON response (HTTP ${response.status})`);
  }
  if (!response.ok || json.success !== true) {
    const error = new Error(
      `Cloudflare ${method} failed (HTTP ${response.status}; codes ${(json.errors ?? []).map(item => item.code).join(",")})`,
    );
    error.status = response.status;
    error.codes = (json.errors ?? []).map(item => item.code);
    throw error;
  }
  return json.result;
}

async function current(name) {
  const data = await cf("GET", `/workers/scripts/${name}/deployments`);
  const row = data.deployments?.[0];
  assert(row, `${name} has no active deployment`);
  assert.equal(row.versions?.length, 1, `${name} has a split deployment`);
  assert.equal(row.versions[0].percentage, 100, `${name} is not at 100%`);
  return { version: row.versions[0].version_id, deployment: row.id };
}

async function allCurrent() {
  return Object.fromEntries(await Promise.all(workers.map(async name => [name, await current(name)])));
}

async function versionInfo(name, version) {
  return cf("GET", `/workers/scripts/${name}/versions/${version}`);
}

function bindingSummary(bindings = []) {
  return [...bindings]
    .map(binding => ({
      name: binding.name,
      type: binding.type,
      ...(binding.namespace_id ? { namespace_id: binding.namespace_id } : {}),
      ...(binding.class_name ? { class_name: binding.class_name } : {}),
      ...(binding.script_name ? { script_name: binding.script_name } : {}),
      ...(binding.entrypoint ? { entrypoint: binding.entrypoint } : {}),
      ...(binding.database_id ? { database_id: binding.database_id } : {}),
      ...(binding.database_name ? { database_name: binding.database_name } : {}),
      ...(binding.bucket_name ? { bucket_name: binding.bucket_name } : {}),
      ...(binding.service ? { service: binding.service } : {}),
      ...(binding.environment ? { environment: binding.environment } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function runtimeSummary(runtime = {}) {
  return JSON.parse(JSON.stringify(runtime));
}

function assetsConfiguration(version) {
  const resources = version?.resources ?? {};
  return resources.script_runtime?.assets
    ?? resources.script_assets
    ?? resources.assets
    ?? null;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertJsonEqualWithoutValues(actual, expected, message) {
  assert(stableJson(actual) === stableJson(expected), message);
}

async function moduleInfo(name, version) {
  const data = await cf("GET", `/workers/workers/${name}/versions/${version}?include=modules`);
  assert(Array.isArray(data.modules), `Cloudflare did not return modules for ${name}@${version}`);
  assert(typeof data.main_module === "string" && data.main_module.length > 0,
    `Cloudflare did not return main_module provenance for ${name}@${version}`);
  return {
    mainModule: data.main_module,
    modules: data.modules.map(module => ({
      name: module.name,
      sha256: hash(Buffer.from(module.content_base64, "base64")),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function currentHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

async function loadJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function save(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function loadCheckpoint() {
  try {
    return await loadJson(checkpoint);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function priorReceiptPointer() {
  if (receiptPrefix === "preview-fetch") return null;
  const previous = await loadJson(originalReceiptPaths.checkpoint);
  assert.equal(previous.state, "ROLLED_BACK",
    "A new receipt prefix requires the original attempt to be recorded as ROLLED_BACK");
  assert.equal(previous.worker, worker);
  assert.equal(previous.previousVersion, acceptedVersions[worker]);
  assert(typeof previous.newVersion === "string" && previous.newVersion.length > 0,
    "Original failed candidate version is missing from the prior receipt");
  assert.equal(previous.after?.[worker]?.version, acceptedVersions[worker],
    "Original receipt does not prove the accepted control-plane version was restored");
  for (const name of workers) {
    assert.equal(previous.after?.[name]?.version, acceptedVersions[name],
      `Original rollback receipt does not show accepted ${name} serving`);
  }
  return {
    path: originalReceiptPaths.checkpoint,
    state: previous.state,
    failedCandidateVersion: previous.newVersion,
    restoredVersion: previous.previousVersion,
    rollbackDeployment: previous.after[worker].deployment,
    rolledBackAt: previous.updatedAt,
  };
}

async function verifyFreshBaselineAgainstOriginal(baseline, pointer) {
  if (!pointer) return;
  const previous = await loadJson(originalReceiptPaths.baselineFile);
  assert.equal(baseline.receiptPrefix, receiptPrefix);
  for (const name of workers) {
    const fresh = baseline.serving[name];
    const original = previous.serving[name];
    assert.equal(fresh.version, acceptedVersions[name], `${name} no longer serves its accepted version`);
    assert.equal(fresh.version, original.version, `${name} differs from the original accepted-version baseline`);
    assert.deepEqual(fresh.bindings, original.bindings, `${name} binding descriptors changed`);
    assert.deepEqual(fresh.scriptRuntime, original.scriptRuntime, `${name} runtime settings changed`);
    assert.deepEqual(fresh.assets, original.assets, `${name} asset routing configuration changed`);
    if (name !== worker) {
      assert.equal(fresh.deployment, original.deployment, `${name} deployment changed after rollback`);
    }
  }
  const freshControl = baseline.serving[worker];
  const originalControl = previous.serving[worker];
  assert.equal(freshControl.deployment, pointer.rollbackDeployment,
    "Fresh control-plane deployment does not match the original rollback receipt");
  assert.equal(freshControl.mainModule, originalControl.mainModule,
    "Accepted control-plane main module changed");
  assert.deepEqual(freshControl.modules, originalControl.modules,
    "Accepted control-plane module bytes changed");
}

async function captureBaseline() {
  const sourceCommit = currentHead();
  if (receiptPrefix === "preview-fetch") {
    assert.equal(sourceCommit, acceptedSourceCommit,
      "Git HEAD differs from the original stated source baseline");
  }
  const priorReceipt = await priorReceiptPointer();
  const serving = await allCurrent();
  for (const name of workers) {
    assert.equal(serving[name].version, acceptedVersions[name],
      `${name} differs from the operator-provided accepted baseline; stop and investigate`);
  }
  const entries = await Promise.all(workers.map(async name => {
    const version = await versionInfo(name, serving[name].version);
    const moduleProvenance = name === worker
      ? await moduleInfo(name, serving[name].version)
      : null;
    return [name, {
      version: serving[name].version,
      deployment: serving[name].deployment,
      ...(moduleProvenance ? { mainModule: moduleProvenance.mainModule } : {}),
      bindings: bindingSummary(version.resources?.bindings),
      scriptRuntime: runtimeSummary(version.resources?.script_runtime),
      assets: assetsConfiguration(version),
      ...(moduleProvenance ? { modules: moduleProvenance.modules } : {}),
    }];
  }));
  const baseline = {
    capturedAt: new Date().toISOString(),
    account,
    sourceCommit,
    receiptPrefix,
    controlPlaneWorker: worker,
    acceptedVersions,
    serving: Object.fromEntries(entries),
    ...(priorReceipt ? { priorReceipt } : {}),
    notes: {
      scope: "Read-only production provenance snapshot; no serving changes.",
      assets: "Captured ASSETS binding and runtime asset-routing configuration. The versions API did not expose an immutable deployed-asset inventory/hash; candidate upload must use keep_assets=true, and asset bytes are not claimed as rehashed.",
      modules: "Control-plane serving module SHA-256 values are captured for baseline source parity.",
    },
  };
  assert.equal(baseline.serving[worker].version, acceptedVersions[worker]);
  await verifyFreshBaselineAgainstOriginal(baseline, priorReceipt);
  return baseline;
}

async function modulesFrom(directory) {
  async function namesIn(relativeDirectory = "") {
    const result = [];
    for (const entry of await readdir(path.join(directory, relativeDirectory), { withFileTypes: true })) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) result.push(...await namesIn(relative));
      else if (/\.(js|wasm)$/.test(entry.name)) result.push(relative);
      else if (entry.isSymbolicLink()) throw new Error("Worker module directory must not contain symlinks");
    }
    return result;
  }
  const names = await namesIn();
  assert(names.length > 0, `Worker module directory is empty: ${directory}`);
  return Promise.all(names.map(async name => ({ name, bytes: await readFile(path.join(directory, name)) })));
}

async function candidateModules() {
  return modulesFrom(modulesDirectory);
}

async function verifyUntouchedBaseline() {
  assert(!(await loadCheckpoint()), "Cannot re-record baseline parity after release reservation");
  const baseline = await loadJson(baselineFile);
  assert.equal(baseline.receiptPrefix ?? "preview-fetch", receiptPrefix,
    "Baseline receipt prefix differs from the selected run");
  assert.equal(currentHead(), baseline.sourceCommit, "Git HEAD changed since provenance capture");
  const priorReceipt = await priorReceiptPointer();
  if (priorReceipt) {
    assert.deepEqual(baseline.priorReceipt, priorReceipt,
      "Prior failed-attempt receipt pointer changed since baseline capture");
    await verifyFreshBaselineAgainstOriginal(baseline, priorReceipt);
  }
  const serving = await assertBaselineCurrent(baseline);
  const live = await moduleInfo(worker, baseline.serving[worker].version);
  assert.equal(baseline.serving[worker].mainModule, live.mainModule,
    "Baseline mainModule does not match Cloudflare accepted-version provenance");
  assert.deepEqual(baseline.serving[worker].modules, live.modules,
    "Baseline module hashes do not match Cloudflare accepted-version provenance");
  const reconstructedModules = moduleManifest(await modulesFrom(baselineModulesDirectory));
  const expected = baseline.serving[worker].modules;
  const expectedByName = new Map(expected.map(item => [item.name, item.sha256]));
  const reconstructedByName = new Map(reconstructedModules.map(item => [item.name, item.sha256]));
  const allNames = [...new Set([...expectedByName.keys(), ...reconstructedByName.keys()])].sort();
  const differences = allNames.filter(name => expectedByName.get(name) !== reconstructedByName.get(name));
  const report = {
    verifiedAt: new Date().toISOString(),
    status: differences.length === 0 ? "PASS" : "FAIL",
    worker,
    receiptPrefix,
    sourceCommit: baseline.sourceCommit,
    servingVersion: baseline.serving[worker].version,
    mainModule: live.mainModule,
    differences,
    reconstructedModules,
  };
  await save(parityFile, report);
  assert.equal(report.status, "PASS",
    "Untouched source bundle does not byte-match the accepted production modules; do not stage");
  console.log(JSON.stringify({
    state: "BASELINE_SOURCE_PARITY_PASS",
    worker,
    servingVersion: report.servingVersion,
    mainModule: report.mainModule,
    modules: reconstructedModules.length,
    parityFile,
  }));
}

function moduleManifest(modules) {
  return modules.map(module => ({ name: module.name, sha256: hash(module.bytes) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function validateGate(validation, baseline, modules) {
  assert.equal(baseline.receiptPrefix ?? "preview-fetch", receiptPrefix,
    "Production baseline receipt prefix differs from the selected run");
  assert.equal(validation.status, "PASS", "preview-fetch validation status must be PASS");
  if (receiptPrefix !== "preview-fetch") {
    assert.equal(validation.receiptPrefix, receiptPrefix,
      "Fresh validation must belong to the selected release receipt prefix");
  }
  assert.equal(validation.worker, worker, "Validation must target the control-plane launch worker");
  assert.equal(validation.sourceCommit, baseline.sourceCommit, "Validation source commit differs from captured baseline");
  assert.equal(validation.safetyReview, "PASS", "Safety review must be PASS");
  assert.equal(validation.rootCause?.status, "PROVEN", "Root cause must be explicitly proven");
  assert.equal(validation.rootCause?.component, "control-plane-preview-proxy",
    "Root cause must identify the control-plane preview proxy");
  assert(typeof validation.rootCause?.summary === "string" && validation.rootCause.summary.trim(),
    "Root-cause summary is required");
  assert(Array.isArray(validation.rootCause?.evidence) && validation.rootCause.evidence.length > 0,
    "Root-cause evidence is required");
  for (const check of ["focusedTests", "regressionTests", "typecheck", "build"]) {
    assert.equal(validation.checks?.[check], "PASS", `Required validation check ${check} must be PASS`);
  }
  assert.deepEqual(validation.candidateModules, moduleManifest(modules),
    `Candidate modules differ from ${validationFile}`);
}

function validateSourceParity(parity, baseline) {
  const expected = baseline.serving[worker].modules;
  assert.equal(parity.receiptPrefix ?? "preview-fetch", receiptPrefix,
    "Source-parity receipt prefix differs from the selected run");
  assert(typeof baseline.serving[worker].mainModule === "string" && baseline.serving[worker].mainModule.length > 0,
    "Accepted-version baseline is missing its live-provenance mainModule");
  assert.equal(parity.status, "PASS", "Accepted-version source parity must be PASS before staging");
  assert.equal(parity.worker, worker);
  assert.equal(parity.sourceCommit, baseline.sourceCommit);
  assert.equal(parity.servingVersion, baseline.serving[worker].version);
  assert.equal(parity.mainModule, baseline.serving[worker].mainModule,
    "Reconstructed source parity mainModule differs from live accepted-version provenance");
  assert.deepEqual(parity.differences, [], "Reconstructed untouched source must byte-match the accepted serving bundle");
  assert.deepEqual(parity.reconstructedModules, expected,
    "Reconstructed baseline module hashes do not match the accepted live version");
}

async function assertBaselineCurrent(baseline) {
  const observed = await allCurrent();
  for (const name of workers) {
    assert.deepEqual(observed[name], {
      version: baseline.serving[name].version,
      deployment: baseline.serving[name].deployment,
    }, `${name} serving baseline changed; stop and investigate`);
  }
  return observed;
}

function changedModules(baselineModules, candidateManifest) {
  const before = new Map(baselineModules.map(item => [item.name, item.sha256]));
  const after = new Map(candidateManifest.map(item => [item.name, item.sha256]));
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(),
    "Candidate module set differs from the accepted live module set");
  return candidateManifest.filter(item => before.get(item.name) !== item.sha256).map(item => item.name);
}

function assertNarrowCandidateDiff(baselineModules, candidateManifest, mainModule) {
  assert(typeof mainModule === "string" && mainModule.length > 0,
    "Live accepted-version mainModule provenance is required");
  const changed = changedModules(baselineModules, candidateManifest);
  assert.deepEqual(changed, [mainModule],
    "Only the control-plane worker entry module may differ from the accepted bundle");
  return changed;
}

function assertLatestRollbackVersion({
  versionList,
  originalReceipt,
  priorReceipt,
  baseline,
  acceptedVersion,
  latestVersion,
  latestModules,
}) {
  assert.equal(originalReceipt?.state, "ROLLED_BACK",
    "Latest inheritance exception requires the original attempt to be ROLLED_BACK");
  assert.equal(originalReceipt.worker, worker);
  assert.equal(originalReceipt.newVersion, priorReceipt?.failedCandidateVersion,
    "Latest candidate does not match the original rollback receipt pointer");
  assert.equal(originalReceipt.previousVersion, baseline.serving[worker].version,
    "Original rollback receipt does not restore the accepted baseline version");
  assert.equal(originalReceipt.assetsRetentionMode, "keep_assets=true",
    "Original candidate was not uploaded with keep_assets=true");
  assert.equal(originalReceipt.assetsUploaded, false,
    "Original candidate unexpectedly uploaded assets");
  assert.equal(originalReceipt.modulesVerified, true);
  assert.equal(originalReceipt.bindingsVerified, true);
  assert.equal(originalReceipt.runtimeSettingsVerified, true);
  assert.deepEqual(originalReceipt.changedModules, [baseline.serving[worker].mainModule],
    "Original candidate was not limited to the control-plane entry module");
  assert(Array.isArray(originalReceipt.expected) && originalReceipt.expected.length > 0,
    "Original receipt is missing the uploaded candidate module hashes");
  assert.deepEqual(
    assertNarrowCandidateDiff(
      baseline.serving[worker].modules,
      originalReceipt.expected,
      baseline.serving[worker].mainModule,
    ),
    [baseline.serving[worker].mainModule],
    "Original candidate module hashes are not a narrow entry-module change",
  );

  assert(Array.isArray(versionList?.items) && versionList.items.length > 0,
    "Cloudflare returned no worker versions");
  assert.equal(versionList.items[0]?.id, originalReceipt.newVersion,
    "Cloudflare latest is not the exact original rolled-back candidate");
  assert.equal(versionList.items.filter(item => item.id === originalReceipt.newVersion).length, 1,
    "Original candidate version is missing or duplicated in Cloudflare's version list");

  assert.deepEqual(bindingSummary(acceptedVersion.resources?.bindings), baseline.serving[worker].bindings,
    "Accepted-version bindings differ from the fresh production baseline");
  assertJsonEqualWithoutValues(runtimeSummary(acceptedVersion.resources?.script_runtime),
    baseline.serving[worker].scriptRuntime,
    "Accepted-version runtime settings differ from the fresh production baseline");
  assertJsonEqualWithoutValues(assetsConfiguration(acceptedVersion), baseline.serving[worker].assets,
    "Accepted-version assets configuration differs from the fresh production baseline");

  const acceptedBindings = [...(acceptedVersion.resources?.bindings ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name));
  const latestBindings = [...(latestVersion.resources?.bindings ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name));
  assertJsonEqualWithoutValues(latestBindings, acceptedBindings,
    "Original latest-candidate bindings differ from the accepted serving version");
  assertJsonEqualWithoutValues(latestVersion.resources?.script_runtime,
    acceptedVersion.resources?.script_runtime,
    "Original latest-candidate runtime settings differ from the accepted serving version");
  assertJsonEqualWithoutValues(assetsConfiguration(latestVersion), baseline.serving[worker].assets,
    "Original latest-candidate assets configuration differs from the accepted production baseline");
  assert.equal(latestModules.mainModule, baseline.serving[worker].mainModule,
    "Original latest-candidate main module differs from accepted provenance");
  assert.deepEqual(latestModules.modules, originalReceipt.expected,
    "Original latest-candidate module hashes differ from the original receipt");
}

function reconciliationOutcome(operation, observed, release) {
  if (!observed) return "ACTIVATION_STATE_AMBIGUOUS";
  for (const name of workers.filter(name => name !== worker)) {
    if (stableJson(observed[name]) !== stableJson(release.before[name])) {
      return "ACTIVATION_STATE_AMBIGUOUS";
    }
  }
  if (observed[worker].version === release.newVersion) return "ACTIVE_RECONCILED";
  if (observed[worker].version === release.previousVersion) {
    return operation === "rollback" ? "ROLLED_BACK_RECONCILED" : "ACTIVATION_NOT_APPLIED";
  }
  return "ACTIVATION_STATE_AMBIGUOUS";
}

function assertRollbackReady(state, observed, release) {
  assert(
    state === "ACTIVE" || state === "ACTIVE_RECONCILED",
    "Rollback requires ACTIVE or read-only ACTIVE_RECONCILED state",
  );
  assert(observed, "Rollback requires a complete live-serving observation");
  assert.equal(observed[worker]?.version, release.newVersion,
    "Rollback requires the exact verified candidate to be serving");
  for (const name of workers.filter(name => name !== worker)) {
    assert.deepEqual(observed[name], release.before[name],
      `${name} changed; refusing rollback`);
  }
  return release.previousVersion;
}

function reconciliationOperation(state) {
  if (["ACTIVATION_RESERVED", "ACTIVATION_FAILED_OR_UNKNOWN", "ACTIVATION_STATE_AMBIGUOUS"].includes(state)) {
    return "activate";
  }
  if (["ROLLBACK_RESERVED", "ROLLBACK_FAILED_OR_UNKNOWN", "ROLLBACK_STATE_AMBIGUOUS"].includes(state)) {
    return "rollback";
  }
  return null;
}

function selfTest() {
  assert.deepEqual(parseCommandLine(["observe"]), { action: "observe", receiptPrefix: "preview-fetch" });
  assert.deepEqual(receiptPaths("preview-fetch"), {
    baselineFile: "production/vibesdk-launch/preview-fetch-production-baseline.json",
    validationFile: "production/vibesdk-launch/preview-fetch-validation.json",
    parityFile: "production/vibesdk-launch/preview-fetch-source-parity.json",
    checkpoint: "production/vibesdk-launch/preview-fetch-release-operation.json",
  });
  assert.deepEqual(
    parseCommandLine(["observe", "--receipt-prefix=preview-fetch-corrected"]),
    { action: "observe", receiptPrefix: "preview-fetch-corrected" },
  );
  assert.deepEqual(receiptPaths("preview-fetch-corrected"), {
    baselineFile: "production/vibesdk-launch/preview-fetch-corrected-production-baseline.json",
    validationFile: "production/vibesdk-launch/preview-fetch-corrected-validation.json",
    parityFile: "production/vibesdk-launch/preview-fetch-corrected-source-parity.json",
    checkpoint: "production/vibesdk-launch/preview-fetch-corrected-release-operation.json",
  });
  assert.throws(() => parseCommandLine(["observe", "--receipt-prefix="]), /letters, digits, and dashes/);
  assert.throws(() => parseCommandLine(["observe", "--receipt-prefix=../escape"]), /letters, digits, and dashes/);
  assert.throws(() => parseCommandLine(["observe", "--receipt-prefix=a/b"]), /letters, digits, and dashes/);
  assert.throws(() => parseCommandLine([
    "observe", "--receipt-prefix=preview-fetch-corrected", "--receipt-prefix=other",
  ]), /only once/);
  assert.throws(() => parseCommandLine(["observe", "--unexpected"]), /Unknown argument/);
  for (const prefix of ["preview-fetch", "preview-fetch-corrected"]) {
    const advertised = command("rollback", prefix).split(/\s+/).slice(2);
    const selected = parseCommandLine(advertised);
    assert.equal(receiptPaths(selected.receiptPrefix).checkpoint, receiptPaths(prefix).checkpoint);
  }
  const fallbackBindings = [{ name: "DB", type: "d1", database_id: "accepted-db" }];
  const fallbackRuntime = { compatibility_date: "2026-09-20", compatibility_flags: ["nodejs_compat"] };
  const fallbackAssets = { base_path: "/", serve_directly: false };
  const fallbackModules = [{ name: "worker.js", sha256: "failed-candidate-hash" }];
  const fallbackBaseline = {
    serving: {
      [worker]: {
        version: acceptedVersions[worker],
        mainModule: "worker.js",
        modules: [{ name: "worker.js", sha256: "accepted-module-hash" }],
        bindings: bindingSummary(fallbackBindings),
        scriptRuntime: runtimeSummary(fallbackRuntime),
        assets: fallbackAssets,
      },
    },
  };
  const fallbackAcceptedVersion = {
    resources: {
      bindings: fallbackBindings,
      script_runtime: fallbackRuntime,
      script_assets: fallbackAssets,
    },
  };
  const fallbackLatestVersion = structuredClone(fallbackAcceptedVersion);
  const fallbackReceipt = {
    state: "ROLLED_BACK",
    worker,
    previousVersion: acceptedVersions[worker],
    newVersion: "30e77330-6998-4d09-8fb6-4cbb70b3f8a7",
    assetsRetentionMode: "keep_assets=true",
    assetsUploaded: false,
    modulesVerified: true,
    bindingsVerified: true,
    runtimeSettingsVerified: true,
    changedModules: ["worker.js"],
    expected: fallbackModules,
  };
  const fallbackPointer = { failedCandidateVersion: fallbackReceipt.newVersion };
  const fallbackVersionList = {
    items: [{ id: fallbackReceipt.newVersion }, { id: acceptedVersions[worker] }],
  };
  const fallbackProvenance = { mainModule: "worker.js", modules: fallbackModules };
  const validateFallback = overrides => assertLatestRollbackVersion({
    versionList: fallbackVersionList,
    originalReceipt: fallbackReceipt,
    priorReceipt: fallbackPointer,
    baseline: fallbackBaseline,
    acceptedVersion: fallbackAcceptedVersion,
    latestVersion: fallbackLatestVersion,
    latestModules: fallbackProvenance,
    ...overrides,
  });
  validateFallback();
  assert.throws(() => validateFallback({
    versionList: { items: [{ id: "unrelated-newest" }, ...fallbackVersionList.items] },
  }), /exact original rolled-back candidate/);
  assert.throws(() => validateFallback({
    originalReceipt: { ...fallbackReceipt, state: "ACTIVE" },
  }), /ROLLED_BACK/);
  assert.throws(() => validateFallback({
    originalReceipt: {
      ...fallbackReceipt,
      expected: [...fallbackModules, { name: "unrelated.js", sha256: "unrelated-hash" }],
    },
  }), /Candidate module set differs/);
  assert.throws(() => validateFallback({
    latestVersion: {
      resources: {
        ...fallbackLatestVersion.resources,
        bindings: [{ name: "DB", type: "d1", database_id: "unrelated-db" }],
      },
    },
  }), /bindings differ/);
  assert.throws(() => validateFallback({
    latestVersion: {
      resources: {
        ...fallbackLatestVersion.resources,
        script_runtime: { ...fallbackRuntime, compatibility_date: "2020-01-01" },
      },
    },
  }), /runtime settings differ/);
  assert.throws(() => validateFallback({
    latestVersion: {
      resources: {
        ...fallbackLatestVersion.resources,
        script_assets: { base_path: "/unrelated", serve_directly: false },
      },
    },
  }), /assets configuration differs/);
  assert.throws(() => validateFallback({
    latestModules: {
      mainModule: "worker.js",
      modules: [{ name: "worker.js", sha256: "unrelated-hash" }],
    },
  }), /module hashes differ/);
  const before = Object.fromEntries(workers.map((name, index) => [name, {
    version: `baseline-version-${index}`,
    deployment: `baseline-deployment-${index}`,
  }]));
  const release = {
    before,
    newVersion: "verified-candidate-version",
    previousVersion: before[worker].version,
  };
  const candidateServing = {
    ...before,
    [worker]: { version: release.newVersion, deployment: "candidate-deployment" },
  };
  const priorServing = before;
  for (const state of ["ACTIVATION_RESERVED", "ACTIVATION_FAILED_OR_UNKNOWN"]) {
    const operation = reconciliationOperation(state);
    assert.equal(operation, "activate");
    const reconciled = reconciliationOutcome(operation, candidateServing, release);
    assert.equal(reconciled, "ACTIVE_RECONCILED");
    assert.equal(assertRollbackReady(reconciled, candidateServing, release), release.previousVersion);
  }
  assert.equal(reconciliationOutcome("activate", priorServing, release), "ACTIVATION_NOT_APPLIED");
  assert.equal(reconciliationOutcome("rollback", priorServing, release), "ROLLED_BACK_RECONCILED");
  for (const state of ["ROLLBACK_RESERVED", "ROLLBACK_FAILED_OR_UNKNOWN"]) {
    const operation = reconciliationOperation(state);
    assert.equal(operation, "rollback");
    const reconciled = reconciliationOutcome(operation, candidateServing, release);
    assert.equal(reconciled, "ACTIVE_RECONCILED");
    assert.equal(assertRollbackReady(reconciled, candidateServing, release), release.previousVersion);
  }
  const changedOtherWorker = {
    ...candidateServing,
    "buildcustom-vibesdk-launch": {
      ...candidateServing["buildcustom-vibesdk-launch"],
      deployment: "unexpected-deployment",
    },
  };
  assert.equal(reconciliationOutcome("activate", changedOtherWorker, release), "ACTIVATION_STATE_AMBIGUOUS");
  assert.equal(reconciliationOutcome("activate", null, release), "ACTIVATION_STATE_AMBIGUOUS");
  assert.throws(() => assertRollbackReady("ACTIVATION_STATE_AMBIGUOUS", candidateServing, release),
    /ACTIVE_RECONCILED state/);
  assert.throws(() => assertRollbackReady("ACTIVE_RECONCILED", changedOtherWorker, release),
    /changed; refusing rollback/);
  assert.throws(() => assertRollbackReady("ACTIVE_RECONCILED", priorServing, release),
    /exact verified candidate/);
  const acceptedModules = [{ name: "worker.js", sha256: "old-hash" }];
  const candidate = [{ name: "worker.js", sha256: "new-hash" }];
  assert.deepEqual(assertNarrowCandidateDiff(acceptedModules, candidate, "worker.js"), ["worker.js"]);
  assert.throws(() => assertNarrowCandidateDiff(acceptedModules, candidate, undefined),
    /mainModule provenance is required/);
  console.log(JSON.stringify({ state: "SELF_TEST_PASS", cases: 40 }));
}

async function stage(useLatestBindings) {
  const existing = await loadCheckpoint();
  if (useLatestBindings) {
    assert(
      receiptPrefix === "preview-fetch" || receiptPrefix === "preview-fetch-corrected",
      "Latest binding inheritance is disabled for this receipt prefix",
    );
    assert.equal(existing?.state, "UPLOAD_FAILED_OR_UNKNOWN");
    assert.equal(existing.uploadResponse?.status, 400);
    assert(existing.uploadResponse.codes.length > 0 &&
      existing.uploadResponse.codes.every(code => code === 10057),
    "Latest binding inheritance is allowed only after a strict-inheritance 10057 response");
    assert.equal(existing.latestBindingRetryUsed, undefined, "Latest binding fallback is single-use");
  } else {
    assert(!existing, "A release reservation/checkpoint already exists; do not repeat the upload");
  }

  const baseline = await loadJson(baselineFile);
  const validation = await loadJson(validationFile);
  const parity = await loadJson(parityFile);
  const priorReceipt = await priorReceiptPointer();
  if (priorReceipt) {
    assert.deepEqual(baseline.priorReceipt, priorReceipt,
      "Prior failed-attempt receipt pointer changed since fresh baseline capture");
    await verifyFreshBaselineAgainstOriginal(baseline, priorReceipt);
  }
  const modules = await candidateModules();
  const expected = moduleManifest(modules);
  validateGate(validation, baseline, modules);
  validateSourceParity(parity, baseline);
  const changed = assertNarrowCandidateDiff(
    baseline.serving[worker].modules,
    expected,
    baseline.serving[worker].mainModule,
  );
  const before = await assertBaselineCurrent(baseline);
  assert.equal(currentHead(), baseline.sourceCommit, "Git HEAD changed since provenance capture");

  const priorModuleInfo = await moduleInfo(worker, baseline.serving[worker].version);
  assert.equal(priorModuleInfo.mainModule, baseline.serving[worker].mainModule,
    "Accepted-version mainModule changed since baseline capture");
  assert.deepEqual(priorModuleInfo.modules, baseline.serving[worker].modules,
    "Accepted-version module hashes changed since baseline capture");
  const priorVersion = await versionInfo(worker, baseline.serving[worker].version);
  const list = await cf("GET", `/workers/scripts/${worker}/versions`);
  if (useLatestBindings) {
    if (receiptPrefix === "preview-fetch") {
      assert.equal(list.items?.[0]?.id, baseline.serving[worker].version,
        "Cloudflare latest is not the accepted serving version; refusing binding fallback");
    } else {
      assert(priorReceipt, "Corrected-prefix latest inheritance requires the original rollback receipt");
      const originalReceipt = await loadJson(originalReceiptPaths.checkpoint);
      const latestVersion = await versionInfo(worker, originalReceipt.newVersion);
      const latestModules = await moduleInfo(worker, originalReceipt.newVersion);
      assertLatestRollbackVersion({
        versionList: list,
        originalReceipt,
        priorReceipt,
        baseline,
        acceptedVersion: priorVersion,
        latestVersion,
        latestModules,
      });
    }
  }
  const inheritedFrom = useLatestBindings ? "latest" : baseline.serving[worker].version;
  const metadata = {
    main_module: priorModuleInfo.mainModule,
    compatibility_date: priorVersion.resources.script_runtime.compatibility_date,
    compatibility_flags: priorVersion.resources.script_runtime.compatibility_flags,
    bindings: priorVersion.resources.bindings.map(binding => ({
      type: "inherit",
      name: binding.name,
      version_id: inheritedFrom,
    })),
    ...(priorVersion.resources.script_runtime.containers
      ? { containers: priorVersion.resources.script_runtime.containers }
      : {}),
    keep_assets: true,
    annotations: {
      "workers/message": "Narrow control-plane preview-fetch fix; unchanged runtime, bindings, and ASSETS",
    },
  };

  const report = useLatestBindings
    ? existing
    : {
        startedAt: new Date().toISOString(),
        state: "UPLOAD_RESERVED",
        worker,
        account,
        receiptPrefix,
        ...(priorReceipt ? { priorReceipt } : {}),
        before,
        previousVersion: baseline.serving[worker].version,
        unaffectedBaselines: Object.fromEntries(workers.filter(name => name !== worker)
          .map(name => [name, baseline.serving[name]])),
        expected,
        changedModules: changed,
        sourceCommit: baseline.sourceCommit,
        sourceParity: parity,
        validation: {
          status: validation.status,
          safetyReview: validation.safetyReview,
          rootCauseComponent: validation.rootCause.component,
          checkNames: Object.keys(validation.checks),
        },
        retainedBindings: true,
        retainedAssets: "keep_assets=true required",
        retainedRuntimeSettings: true,
        assetsUploaded: false,
        assetBytesRehashed: false,
        rollbackCommand: command("rollback"),
        ...(useLatestBindings ? { latestBindingRetryUsed: true } : {}),
      };
  if (useLatestBindings) {
    report.state = "UPLOAD_RESERVED";
    report.latestBindingRetryUsed = true;
    report.uploadResponse = undefined;
  }
  await save(checkpoint, report);

  const boundary = "----BuildCustomPreviewFetchCandidate";
  const chunks = [];
  function part(header, content) {
    chunks.push(Buffer.from(`--${boundary}\r\n${header}\r\n\r\n`), content, Buffer.from("\r\n"));
  }
  part('Content-Disposition: form-data; name="metadata"\r\nContent-Type: application/json',
    Buffer.from(JSON.stringify(metadata)));
  for (const module of modules) {
    const contentType = module.name.endsWith(".wasm") ? "application/wasm" : "application/javascript+module";
    part(`Content-Disposition: form-data; name="${module.name}"; filename="${module.name}"\r\nContent-Type: ${contentType}`,
      module.bytes);
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  let response;
  let json;
  try {
    response = await fetch(`${api}/workers/scripts/${worker}/versions?bindings_inherit=strict`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(120000),
    });
    json = await response.json();
  } catch {
    report.state = "UPLOAD_FAILED_OR_UNKNOWN";
    report.uploadResponse = { status: null, codes: [], detail: "Network/response error; do not retry automatically." };
    await save(checkpoint, report);
    throw new Error("Upload failed or is unknown; checkpoint reserved. Do not retry automatically.");
  }
  if (!response.ok || json.success !== true || !json.result?.id) {
    report.state = "UPLOAD_FAILED_OR_UNKNOWN";
    report.uploadResponse = {
      status: response.status,
      codes: (json.errors ?? []).map(item => item.code),
    };
    await save(checkpoint, report);
    throw new Error(`Upload failed or is unknown (HTTP ${response.status}); checkpoint reserved.`);
  }

  report.newVersion = json.result.id;
  report.state = "UPLOADED_UNVERIFIED";
  await save(checkpoint, report);
  const next = await versionInfo(worker, report.newVersion);
  assertJsonEqualWithoutValues(
    [...next.resources.bindings].sort((a, b) => a.name.localeCompare(b.name)),
    [...priorVersion.resources.bindings].sort((a, b) => a.name.localeCompare(b.name)),
    "Candidate bindings differ from the inherited accepted version",
  );
  assertJsonEqualWithoutValues(next.resources.script_runtime, priorVersion.resources.script_runtime,
    "Candidate runtime settings differ from the accepted version");
  const stored = await moduleInfo(worker, report.newVersion);
  assert.equal(stored.mainModule, priorModuleInfo.mainModule, "Candidate main module changed unexpectedly");
  assert.deepEqual(stored.modules, expected, "Cloudflare-stored candidate module hashes differ from the uploaded bytes");
  assert.deepEqual(await allCurrent(), before, "Serving versions changed during staging");
  report.state = "STAGED_VERIFIED";
  report.modulesVerified = true;
  report.bindingsVerified = true;
  report.runtimeSettingsVerified = true;
  report.assetsRetentionMode = "keep_assets=true";
  report.assetBytesRehashed = false;
  report.verifiedAt = new Date().toISOString();
  await save(checkpoint, report);
  console.log(JSON.stringify({
    state: report.state,
    worker,
    previousVersion: report.previousVersion,
    newVersion: report.newVersion,
    rollout: "not activated",
    changedModules: report.changedModules,
    moduleCount: expected.length,
    rollbackCommand: report.rollbackCommand,
  }));
}

async function changeServingVersion(rollback) {
  const existing = await loadCheckpoint();
  const baseline = await loadJson(baselineFile);
  assert.equal(existing?.receiptPrefix ?? "preview-fetch", receiptPrefix,
    "Release checkpoint receipt prefix differs from the selected run");
  if (rollback) {
    assert(
      existing?.state === "ACTIVE" || existing?.state === "ACTIVE_RECONCILED",
      "Only an active or read-only reconciled verified candidate can be rolled back",
    );
  } else {
    assert.equal(existing?.state, "STAGED_VERIFIED", "Only a verified candidate can be activated");
  }
  const before = rollback ? await allCurrent() : await assertBaselineCurrent(baseline);
  let target;
  if (rollback) {
    target = assertRollbackReady(existing.state, before, existing);
  } else {
    assert.equal(before[worker].version, existing.previousVersion);
    for (const name of workers.filter(name => name !== worker)) {
      assert.deepEqual(before[name], existing.before[name], `${name} changed; refusing target deployment`);
    }
    target = existing.newVersion;
  }

  existing.state = rollback ? "ROLLBACK_RESERVED" : "ACTIVATION_RESERVED";
  await save(checkpoint, existing);
  let result;
  try {
    result = await cf("POST", `/workers/scripts/${worker}/deployments`, {
      strategy: "percentage",
      versions: [{ version_id: target, percentage: 100 }],
      annotations: {
        "workers/message": rollback
          ? "Rollback narrow control-plane preview-fetch candidate"
          : "Activate verified narrow control-plane preview-fetch candidate",
      },
    });
  } catch (error) {
    existing.state = rollback ? "ROLLBACK_FAILED_OR_UNKNOWN" : "ACTIVATION_FAILED_OR_UNKNOWN";
    existing.operationError = {
      status: error.status ?? null,
      codes: error.codes ?? [],
      detail: "Deployment outcome must be reconciled read-only before another action.",
    };
    await save(checkpoint, existing);
    throw new Error(`${rollback ? "Rollback" : "Activation"} outcome is unknown; reconcile before any further action.`);
  }
  const after = await allCurrent();
  assert.equal(after[worker].version, target);
  for (const name of workers.filter(name => name !== worker)) {
    assert.deepEqual(after[name], existing.before[name], `${name} changed during target deployment`);
  }
  existing.state = rollback ? "ROLLED_BACK" : "ACTIVE";
  existing.rolloutPercentage = 100;
  existing.deployment = result.id;
  existing.updatedAt = new Date().toISOString();
  existing.after = after;
  await save(checkpoint, existing);
  console.log(JSON.stringify({
    state: existing.state,
    worker,
    version: target,
    rollout: 100,
    ...(rollback ? {} : { rollbackCommand: existing.rollbackCommand }),
  }));
}

async function reconcile() {
  const existing = await loadCheckpoint();
  assert.equal(existing?.receiptPrefix ?? "preview-fetch", receiptPrefix,
    "Release checkpoint receipt prefix differs from the selected run");
  const operation = reconciliationOperation(existing?.state);
  assert(operation, "Reconcile is only for reserved/unknown activation or rollback checkpoints");

  let observed = null;
  let readFailure = false;
  try {
    observed = await allCurrent();
  } catch {
    readFailure = true;
  }
  const nextState = reconciliationOutcome(operation, observed, existing);
  if (readFailure && operation === "rollback") {
    existing.state = "ROLLBACK_STATE_AMBIGUOUS";
  } else if (readFailure) {
    existing.state = "ACTIVATION_STATE_AMBIGUOUS";
  } else if (operation === "rollback" && nextState === "ACTIVATION_STATE_AMBIGUOUS") {
    existing.state = "ROLLBACK_STATE_AMBIGUOUS";
  } else {
    existing.state = nextState;
  }
  existing.reconciliation = {
    readOnly: true,
    at: new Date().toISOString(),
    observed,
    outcome: existing.state,
    ...(readFailure ? { detail: "Could not establish a single 100% serving version for every worker." } : {}),
  };
  await save(checkpoint, existing);
  console.log(JSON.stringify({
    state: existing.state,
    readOnly: true,
    serving: observed,
    ...(existing.state === "ACTIVE_RECONCILED"
      ? { rollbackCommand: command("rollback") }
      : {}),
  }));
  assert(!existing.state.endsWith("AMBIGUOUS"),
    "Serving state is ambiguous; no deployment action is permitted");
}

const existing = await loadCheckpoint();
if (action === "self-test") {
  selfTest();
} else if (action === "reconcile") {
  await reconcile();
} else if (action === "observe") {
  const observed = await allCurrent();
  if (!existing && !(await (async () => {
    try { await readFile(baselineFile); return true; } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  })())) {
    const baseline = await captureBaseline();
    assert.deepEqual(observed, Object.fromEntries(workers.map(name => [name, {
      version: baseline.serving[name].version,
      deployment: baseline.serving[name].deployment,
    }])), "Serving versions changed during baseline capture");
    await save(baselineFile, baseline);
    console.log(JSON.stringify({ state: "BASELINE_CAPTURED", file: baselineFile, serving: observed }));
  } else {
    console.log(JSON.stringify({ state: existing?.state ?? "BASELINE_EXISTS", current: observed }));
  }
} else if (action === "verify-baseline") {
  await verifyUntouchedBaseline();
} else if (action === "stage") {
  await stage(false);
} else if (action === "stage-latest") {
  await stage(true);
} else if (action === "activate") {
  await changeServingVersion(false);
} else if (action === "rollback") {
  await changeServingVersion(true);
}