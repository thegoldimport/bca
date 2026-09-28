#!/usr/bin/env node

// One authorized attempt only. This operator creates deployments of existing
// versions, never versions or bindings. On a failed gate it restores the exact
// accepted versions and records closed-state verification.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const precheckPath = process.argv[2];
const task12m = process.env.TASK12M_RUNTIME_CANDIDATE === "95da88fe-fe8a-4ce3-9c62-4565d7f279c2";
if (process.argv.length !== 4 || process.argv[3] !== "--execute"
  || !precheckPath?.startsWith("production/vibesdk-launch/task12j-observation-")) {
  throw new Error("Usage: node scripts/task12k-final-cutover.mjs <closed-precheck-artifact> --execute");
}
const base = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const versions = {
  runtime: {
    name: "buildcustom-vibesdk-launch",
    accepted: "8e28025f-e415-4405-9b1f-67d93eff7fd8",
    candidate: task12m ? process.env.TASK12M_RUNTIME_CANDIDATE : "946f5b87-be42-45f1-adf6-67c67ced0dd6",
  },
  control: {
    name: "buildcustom-control-plane-launch",
    accepted: "8d07cbf8-c7ad-423e-b592-268e538e3410",
    candidate: "754a3a04-91f9-49e2-b9a8-614aa183a13c",
  },
  gateway: { name: "buildcustom-apps-gateway", accepted: "9d80432b-4e53-4fe7-950a-2b53f0213eff" },
};
const journalPath = path.join(root, "production/vibesdk-launch",
  `${task12m ? "task12m" : "task12k"}-operation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const journal = { startedAt: new Date().toISOString(), precheckPath, events: [] };
let runtimeTouched = false, controlTouched = false;

async function log(stage, evidence) {
  journal.events.push({ at: new Date().toISOString(), stage, evidence });
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ stage, evidence }));
}
async function cf(method, pathname, input) {
  const response = await fetch(base + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      ...(input ? { "Content-Type": "application/json" } : {}),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok || !body.success) {
    throw new Error(`Cloudflare ${method} ${pathname} failed HTTP ${response.status}; error codes: ${(body.errors ?? []).map(x => x.code).join(",")}`);
  }
  return body.result;
}
async function deployment(part) {
  const result = await cf("GET", `/workers/scripts/${part.name}/deployments`);
  return result.deployments?.[0];
}
function exact(deployed, version) {
  return deployed?.versions?.length === 1
    && deployed.versions[0].version_id === version
    && deployed.versions[0].percentage === 100;
}
async function setVersion(part, version, label) {
  const input = {
    strategy: "percentage",
    versions: [{ version_id: version, percentage: 100 }],
    annotations: { "workers/message": `Task ${task12m ? "12M" : "12K"} ${label}` },
  };
  await log(`request-${label}`, { worker: part.name, input });
  const result = await cf("POST", `/workers/scripts/${part.name}/deployments`, input);
  await log(`deployed-${label}`, { worker: part.name, deployment: result });
  return result;
}
function runProbe(file, phase) {
  const result = spawnSync(process.execPath, [path.join(root, `scripts/${file}`), `--phase=${phase}`], {
    cwd: root, encoding: "utf8", timeout: 105000, maxBuffer: 2 * 1024 * 1024,
  });
  const lines = result.stdout?.trim().split("\n").filter(Boolean) ?? [];
  const objects = lines.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  return { exitCode: result.status, error: result.error?.message ?? null,
    observations: objects.filter((row) => row.check)
      .map(({ check, status, observed }) => ({ check, status,
        observedVersionId: observed?.versionEvidence?.observedVersionId ?? null })),
    artifact: objects.at(-1)?.artifact ?? null };
}
function hashModules(detail) {
  return detail.modules?.map(m => ({
    name: m.name,
    sha256: createHash("sha256").update(Buffer.from(m.content_base64, "base64")).digest("hex"),
  })).sort((a, b) => a.name.localeCompare(b.name));
}
async function parity() {
  const part = versions.control;
  const [oldVersion, candidateVersion, oldDetail, candidateDetail] = await Promise.all([
    cf("GET", `/workers/scripts/${part.name}/versions/${part.accepted}`),
    cf("GET", `/workers/scripts/${part.name}/versions/${part.candidate}`),
    cf("GET", `/workers/workers/${part.name}/versions/${part.accepted}?include=modules`),
    cf("GET", `/workers/workers/${part.name}/versions/${part.candidate}?include=modules`),
  ]);
  const oldBindings = Object.fromEntries(oldVersion.resources.bindings.map(b => [b.name, b]));
  const newBindings = Object.fromEntries(candidateVersion.resources.bindings.map(b => [b.name, b]));
  const differences = [];
  for (const name of new Set([...Object.keys(oldBindings), ...Object.keys(newBindings)])) {
    if (name === "STAGING_REGISTRATION_ENABLED") {
      if (oldBindings[name]?.text !== "false" || newBindings[name]?.text !== "true") differences.push("registration gate");
    } else if (JSON.stringify(oldBindings[name]) !== JSON.stringify(newBindings[name])) differences.push(`binding ${name}`);
  }
  for (const key of ["script", "script_runtime"]) {
    if (JSON.stringify(oldVersion.resources[key]) !== JSON.stringify(candidateVersion.resources[key])) differences.push(`resource ${key}`);
  }
  for (const key of ["assets", "compatibility_date", "compatibility_flags", "main_module", "usage_model"]) {
    if (JSON.stringify(oldDetail[key]) !== JSON.stringify(candidateDetail[key])) differences.push(key);
  }
  const oldEnv = { ...oldDetail.env };
  const candidateEnv = { ...candidateDetail.env };
  delete oldEnv.STAGING_REGISTRATION_ENABLED;
  delete candidateEnv.STAGING_REGISTRATION_ENABLED;
  if (JSON.stringify(oldEnv) !== JSON.stringify(candidateEnv)) differences.push("version environment");
  const hashes = { accepted: hashModules(oldDetail), candidate: hashModules(candidateDetail) };
  if (JSON.stringify(hashes.accepted) !== JSON.stringify(hashes.candidate)) differences.push("module bytes");
  const required = {
    profile: newBindings.CONTROL_PLANE_PROFILE?.text,
    environment: newBindings.ENVIRONMENT?.text,
    publicApps: newBindings.PUBLIC_GENERATED_APPS_ENABLED?.text,
    authRuntime: newBindings.AUTH_RUNTIME?.service,
  };
  if (required.profile !== "launch" || required.environment !== "production"
    || required.publicApps !== "true" || required.authRuntime !== versions.runtime.name) {
    differences.push("required candidate binding");
  }
  await log("control-parity", { differences, hashes, required,
    assetConfiguration: candidateDetail.assets?.config,
    note: "Version-specific preview URLs and env registration flag intentionally excluded; every other binding and resource is compared." });
  if (differences.length) throw new Error(`Control candidate parity failed: ${differences.join(", ")}`);
}
async function rollback() {
  journal.rollbackStartedAt = new Date().toISOString();
  // Restore both on any failure after control activation, even if the control
  // POST's network outcome was unknown.
  for (const [key, touched] of [["control", controlTouched], ["runtime", runtimeTouched]]) {
    if (!touched) continue;
    try {
      const result = await setVersion(versions[key], versions[key].accepted, `rollback-${key}`);
      await log(`rollback-${key}-result`, { deploymentId: result.id });
    } catch (error) {
      await log(`rollback-${key}-FAILED`, { message: error.message });
    }
  }
  const closed = runProbe("task12j-control-cutover-probe.mjs", "closed");
  await log("rollback-closed-probe", closed);
  const [control, runtime, gateway] = await Promise.all([
    deployment(versions.control), deployment(versions.runtime), deployment(versions.gateway),
  ]);
  await log("rollback-readback", {
    control, runtime, gateway,
    safe: exact(control, versions.control.accepted) && exact(runtime, versions.runtime.accepted)
      && exact(gateway, versions.gateway.accepted) && closed.exitCode === 0,
  });
}

if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("Cloudflare credential unavailable");
const precheck = JSON.parse(await readFile(path.join(root, precheckPath), "utf8"));
if (task12m) {
  const parityPath = process.env.TASK12M_PARITY_ARTIFACT;
  if (!parityPath?.startsWith("production/vibesdk-launch/task12m-precheck-")) {
    throw new Error("Task 12M fresh candidate parity artifact required");
  }
  const parity = JSON.parse(await readFile(path.join(root, parityPath), "utf8"));
  if (parity.status !== "PASS" || Date.now() - Date.parse(parity.completedAt) > 15 * 60 * 1000
    || parity.runtime?.version !== versions.runtime.candidate
    || parity.control?.version !== versions.control.candidate) {
    throw new Error("Task 12M candidate parity not fresh or not verified");
  }
}
if (precheck.phase !== "closed" || precheck.status !== "PASS"
  || Object.keys(precheck.checks).length !== 7
  || Object.values(precheck.checks).some(row => row.status !== "PASS")
  || precheck.perRequestVersionIdentity !== versions.control.accepted
  || Date.now() - Date.parse(precheck.completedAt) > 15 * 60 * 1000) {
  throw new Error("Fresh closed precheck A–G and accepted serving version required");
}
try {
  const [runtime, control, gateway] = await Promise.all([
    deployment(versions.runtime), deployment(versions.control), deployment(versions.gateway),
  ]);
  if (!exact(runtime, versions.runtime.accepted)
    || !exact(control, versions.control.accepted) || !exact(gateway, versions.gateway.accepted)) {
    throw new Error("Closed deployment preconditions changed; no cutover executed");
  }
  await log("closed-deployment-readback", { runtime, control, gateway });
  // Check candidate parity and exact rollback targets BEFORE any mutation.
  await parity();
  runtimeTouched = true;
  await setVersion(versions.runtime, versions.runtime.candidate, "runtime-candidate");
  const runtimeProbe = runProbe("task12g-runtime-cutover-probe.mjs", "candidate");
  await log("runtime-gate", runtimeProbe);
  if (runtimeProbe.exitCode !== 0 || runtimeProbe.observations.length !== 5
    || runtimeProbe.observations.some(row => row.status !== "PASS")) {
    throw new Error("Runtime A–E gate failed");
  }
  await parity(); // Reconfirm after runtime activation as specified.
  controlTouched = true;
  await setVersion(versions.control, versions.control.candidate, "control-candidate");
  const openProbe = runProbe("task12j-control-cutover-probe.mjs", "open");
  await log("open-gate", openProbe);
  if (openProbe.exitCode !== 0 || !openProbe.artifact) throw new Error("Control A–G gate failed");
  const evidence = JSON.parse(await readFile(path.join(root, openProbe.artifact), "utf8"));
  if (evidence.status !== "PASS" || Object.keys(evidence.checks).length !== 7
    || Object.values(evidence.checks).some(row => row.status !== "PASS")
    || evidence.perRequestVersionIdentity !== versions.control.candidate
    || evidence.versionCorrelation?.correlation?.scriptName !== versions.control.name) {
    throw new Error("Control A–G version-traced gate failed");
  }
  await log("gate-accepted", { runtimeVersion: versions.runtime.candidate,
    controlVersion: versions.control.candidate, openArtifact: openProbe.artifact });
  journal.status = "GATES_PASS_FURTHER_ACCEPTANCE_REQUIRED";
} catch (error) {
  await log("attempt-failed", { message: error.message });
  if (runtimeTouched || controlTouched) {
    try { await rollback(); }
    catch (rollbackError) { await log("rollback-verification-FAILED", { message: rollbackError.message }); }
  }
  journal.status = "FAILED_NO_RETRY";
  process.exitCode = 1;
} finally {
  journal.completedAt = new Date().toISOString();
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ journal: path.relative(root, journalPath), status: journal.status }));
}