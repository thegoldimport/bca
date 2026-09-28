#!/usr/bin/env node

// Stage one code-only runtime version. No deployment or serving-traffic change.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const name = "buildcustom-vibesdk-launch";
const accepted = "8e28025f-e415-4405-9b1f-67d93eff7fd8";
const priorCandidate = "946f5b87-be42-45f1-adf6-67c67ced0dd6";
const control = "8d07cbf8-c7ad-423e-b592-268e538e3410";
const gateway = "9d80432b-4e53-4fe7-950a-2b53f0213eff";
const artifact = path.join(root, "production/vibesdk-launch",
  `task12l-candidate-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const report = { createdAt: new Date().toISOString(), state: "PRECHECK" };
const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("Cloudflare credential unavailable");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function get(url) {
  const response = await fetch(`${api}${url}`, { headers });
  const body = await response.json();
  if (!response.ok || body.success !== true) throw new Error(`Cloudflare read failed: HTTP ${response.status}`);
  return body.result;
}
async function deployment(worker) {
  return (await get(`/workers/scripts/${worker}/deployments`)).deployments[0]?.versions;
}
async function readVersion(id, worker = name) {
  return get(`/workers/scripts/${worker}/versions/${id}`);
}
function hashes(modules) {
  return modules.map(m => ({ name: m.name, sha256: digest(Buffer.from(m.content_base64, "base64")) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function compareResources(a, b) {
  const differences = [];
  for (const key of ["bindings", "script_runtime"]) {
    if (JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key])) differences.push(key);
  }
  return differences;
}
try {
  const [beforeRuntime, beforeControl, beforeGateway, versions, version, acceptedVersion, existing] =
    await Promise.all([
      deployment(name), deployment("buildcustom-control-plane-launch"),
      deployment("buildcustom-apps-gateway"),
      get(`/workers/scripts/${name}/versions`), readVersion(priorCandidate),
      readVersion(accepted), get(`/workers/workers/${name}/versions/${priorCandidate}?include=modules`),
    ]);
  assert.deepEqual(beforeRuntime, [{ version_id: accepted, percentage: 100 }]);
  assert.deepEqual(beforeControl, [{ version_id: control, percentage: 100 }]);
  assert.deepEqual(beforeGateway, [{ version_id: gateway, percentage: 100 }]);
  assert.equal(versions.items?.[0]?.id, priorCandidate, "Cannot safely inherit bindings from a different latest version");
  assert.equal(version.resources.bindings.find(b => b.name === "REGISTRATION_ENABLED")?.text, "true");
  assert.equal(acceptedVersion.resources.bindings.find(b => b.name === "REGISTRATION_ENABLED")?.text, "false");
  assert.deepEqual(version.resources.script_runtime, acceptedVersion.resources.script_runtime);
  assert.equal(version.resources.bindings.length, 29);
  assert.equal(existing.modules.length, 6);
  assert.deepEqual(version.resources.script_runtime.containers,
    [{ class_name: "UserAppSandboxService" }]);
  const dry = await readFile("/tmp/task12l-dry/index.js", "utf8");
  const entry = existing.modules.find(m => m.name === "index.js");
  assert(entry, "Version is missing its main module");
  const baseline = Buffer.from(entry.content_base64, "base64").toString("utf8");
  const marker = '      return _AuthController.handleError(error52, "register user");';
  const start = baseline.indexOf("static async register(");
  const end = baseline.indexOf("static async login(", start);
  assert(start > 0 && end > start);
  const prefix = baseline.slice(0, start);
  const region = baseline.slice(start, end);
  const suffix = baseline.slice(end);
  const oldCatch = `    } catch (error52) {
      if (error52 instanceof SecurityError) {`;
  assert.equal(region.split(oldCatch).length, 2, "Registration catch is not unique");
  assert(region.includes(marker));
  const dryStart = dry.indexOf("static async register(");
  const dryEnd = dry.indexOf("static async login(", dryStart);
  const dryRegion = dry.slice(dryStart, dryEnd);
  const catchStart = dryRegion.indexOf("    } catch (error52) {");
  const securityStart = dryRegion.indexOf("      if (error52 instanceof SecurityError) {", catchStart);
  assert(catchStart > 0 && securityStart > catchStart);
  const validationBranch = dryRegion.slice(catchStart, securityStart);
  assert(validationBranch.includes("error52 instanceof ZodError"));
  assert(validationBranch.includes("createErrorResponse(message2, 400)"));
  assert(baseline.includes("var ZodError = "), "Built validation class not in verified baseline");
  const replacement = `${validationBranch}      if (error52 instanceof SecurityError) {`;
  const patched = prefix + region.replace(oldCatch, replacement) + suffix;
  assert.equal(patched.replace(replacement, oldCatch), baseline,
    "Normalized main-module diff must be only the reviewed validation branch");
  const modules = existing.modules.map(m => ({
    name: m.name,
    bytes: m.name === "index.js" ? Buffer.from(patched) : Buffer.from(m.content_base64, "base64"),
  }));
  report.baseline = { version: priorCandidate, moduleHashes: hashes(existing.modules) };
  report.expected = { moduleHashes: modules.map(m => ({ name: m.name, sha256: digest(m.bytes) })),
    changedMainOnly: true };
  const metadata = {
    main_module: "index.js",
    compatibility_date: version.resources.script_runtime.compatibility_date,
    compatibility_flags: version.resources.script_runtime.compatibility_flags,
    bindings: version.resources.bindings.map(b => ({ type: "inherit", name: b.name, version_id: "latest" })),
    containers: version.resources.script_runtime.containers,
    keep_assets: true,
    annotations: { "workers/message": "Task 12L inactive runtime registration validation fix" },
  };
  const boundary = "----Task12LRuntimeVersion";
  const chunks = [];
  function append(header, bytes) {
    chunks.push(Buffer.from(`--${boundary}\r\n${header}\r\n\r\n`), bytes, Buffer.from("\r\n"));
  }
  append('Content-Disposition: form-data; name="metadata"\r\nContent-Type: application/json',
    Buffer.from(JSON.stringify(metadata)));
  for (const module of modules) {
    const type = module.name.endsWith(".wasm") ? "application/wasm" :
      module.name.endsWith(".md") ? "text/plain" : "application/javascript+module";
    append(`Content-Disposition: form-data; name="${module.name}"; filename="${module.name}"\r\nContent-Type: ${type}`,
      module.bytes);
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  report.state = "UPLOAD_REQUESTED";
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const upload = await fetch(`${api}/workers/scripts/${name}/versions?bindings_inherit=strict`, {
    method: "POST",
    headers: { ...headers, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(chunks),
    signal: AbortSignal.timeout(120000),
  });
  const result = await upload.json();
  if (!upload.ok || result.success !== true || !result.result?.id) {
    throw new Error(`Inactive version upload failed: HTTP ${upload.status}, codes ${JSON.stringify(result.errors?.map(e => e.code))}`);
  }
  report.version = result.result.id;
  report.state = "UPLOADED_UNVERIFIED";
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const [newVersion, newModules, afterRuntime, afterControl, afterGateway] = await Promise.all([
    readVersion(report.version),
    get(`/workers/workers/${name}/versions/${report.version}?include=modules`),
    deployment(name), deployment("buildcustom-control-plane-launch"),
    deployment("buildcustom-apps-gateway"),
  ]);
  const actualHashes = hashes(newModules.modules);
  assert.deepEqual(actualHashes, report.expected.moduleHashes.sort((a, b) => a.name.localeCompare(b.name)));
  assert.deepEqual(compareResources(newVersion.resources, version.resources), []);
  assert.deepEqual(newVersion.resources.bindings, version.resources.bindings);
  assert.deepEqual(newVersion.resources.script_runtime, version.resources.script_runtime);
  assert.deepEqual(afterRuntime, beforeRuntime, "Runtime serving deployment changed");
  assert.deepEqual(afterControl, beforeControl, "Control serving deployment changed");
  assert.deepEqual(afterGateway, beforeGateway, "Gateway serving deployment changed");
  report.parity = { modules: true, bindings: true, runtimeResources: true, trafficUnchanged: true,
    assets: "reused via keep_assets; individual asset hashes not exposed by version readback" };
  report.state = "VERIFIED_INACTIVE";
} catch (error) {
  report.state = "FAILED_OR_UNVERIFIED";
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ artifact: path.relative(root, artifact), state: report.state,
    version: report.version ?? null, error: report.error ?? null }));
}