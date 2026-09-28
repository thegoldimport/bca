#!/usr/bin/env node
// One-use Task 12R operator. Deploys existing versions only. If either gate
// fails, restores both accepted versions and verifies their serving identity.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = "production/vibesdk-launch/";
const args = process.argv.slice(2);
const prefixes = ["task12n-runtime-observation-", "task12j-observation-", "task12l-regression-", "task12m-precheck-"];
if (args.length !== 5 || args[4] !== "--execute"
  || args.slice(0, 4).some((v, i) => !v.startsWith(directory + prefixes[i]))) {
  throw new Error("Usage: node scripts/task12r-final-cutover.mjs <closed-runtime> <closed-control> <closed-regression> <candidate-parity> --execute");
}
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("Cloudflare credential unavailable");
const base = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const parts = {
  runtime: { name: "buildcustom-vibesdk-launch", closed: "8e28025f-e415-4405-9b1f-67d93eff7fd8", open: "95da88fe-fe8a-4ce3-9c62-4565d7f279c2" },
  control: { name: "buildcustom-control-plane-launch", closed: "8d07cbf8-c7ad-423e-b592-268e538e3410", open: "754a3a04-91f9-49e2-b9a8-614aa183a13c" },
  gateway: { name: "buildcustom-apps-gateway", closed: "9d80432b-4e53-4fe7-950a-2b53f0213eff" },
};
const artifact = path.join(root, directory, `task12r-operation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const report = { startedAt: new Date().toISOString(), status: "PRECHECK", inputs: args.slice(0, 4), events: [] };
async function log(stage, evidence) {
  report.events.push({ at: new Date().toISOString(), stage, evidence });
  await writeFile(artifact, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ stage, evidence }));
}
async function cf(method, uri, input) {
  const response = await fetch(base + uri, {
    method, headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      ...(input ? { "Content-Type": "application/json" } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}), cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(`${method} ${uri}: HTTP ${response.status}, codes ${(json.errors ?? []).map(e => e.code)}`);
  return json.result;
}
async function deployment(part) {
  const response = await cf("GET", `/workers/scripts/${part.name}/deployments`);
  return response.deployments?.[0];
}
function exact(row, id) {
  return row?.versions?.length === 1 && row.versions[0].version_id === id && row.versions[0].percentage === 100;
}
async function deploy(part, id, label) {
  const input = { strategy: "percentage", versions: [{ version_id: id, percentage: 100 }],
    annotations: { "workers/message": `Task 12R ${label}` } };
  await log(`request-${label}`, { worker: part.name, input });
  const result = await cf("POST", `/workers/scripts/${part.name}/deployments`, input);
  await log(`deployed-${label}`, { worker: part.name, result, at: new Date().toISOString() });
  return result;
}
function probe(file, flag) {
  const run = spawnSync(process.execPath, [path.join(root, "scripts", file), flag], {
    cwd: root, encoding: "utf8", timeout: 150000, maxBuffer: 2 * 1024 * 1024,
  });
  let result = null;
  try { result = JSON.parse(run.stdout.trim().split("\n").at(-1)); } catch { /* unknown means failure */ }
  return { code: run.status, error: run.error?.message ?? null, artifact: result?.artifact ?? null, status: result?.status ?? "UNKNOWN" };
}
async function observed(result) {
  if (!result.artifact?.startsWith(directory)) return null;
  return JSON.parse(await readFile(path.join(root, result.artifact), "utf8"));
}
async function runtimeGate(flag, id) {
  const run = probe("task12n-runtime-capability-probe.mjs", `--expect=${flag}`);
  const evidence = await observed(run);
  await log(`runtime-${flag}-gate`, { ...run,
    targeted: evidence?.checks?.C_targeted ?? null, ordinary: evidence?.checks?.D_ordinaryLive ?? null,
    existingUser: evidence?.checks?.E_existingUserAuth ?? null });
  assert(run.code === 0 && evidence?.status === "PASS"
    && evidence.checks.A_deployment?.expected
    && evidence.checks.C_targeted?.tail?.versionId === id
    && evidence.checks.D_ordinaryLive?.tail?.versionId === id
    && evidence.checks.C_targeted?.evaluation?.http === "PASS"
    && evidence.checks.D_ordinaryLive?.evaluation?.http === "PASS"
    && evidence.checks.C_targeted?.evaluation?.version === "PASS"
    && evidence.checks.D_ordinaryLive?.evaluation?.version === "PASS"
    && evidence.checks.E_existingUserAuth?.status === "PASS", `Runtime ${flag} gate failed`);
}
async function controlGate(flag, id) {
  const run = probe("task12j-control-cutover-probe.mjs", `--phase=${flag}`);
  const evidence = await observed(run);
  await log(`control-${flag}-gate`, { ...run, checks: evidence?.checks ?? null,
    versionIdentity: evidence?.perRequestVersionIdentity ?? "UNKNOWN" });
  assert(run.code === 0 && evidence?.status === "PASS"
    && Object.keys(evidence.checks).length === 7
    && Object.values(evidence.checks).every(row => row.status === "PASS")
    && evidence.perRequestVersionIdentity === id
    && evidence.versionCorrelation?.correlation?.scriptName === parts.control.name,
  `Control ${flag} gate failed`);
}
let touchedRuntime = false, touchedControl = false;
try {
  const [runtimePre, controlPre, regression, parity] = await Promise.all(args.slice(0, 4).map(
    file => readFile(path.join(root, file), "utf8").then(JSON.parse)));
  const fresh = data => Date.now() - Date.parse(data.completedAt) < 15 * 60 * 1000;
  assert(runtimePre.status === "PASS" && fresh(runtimePre)
    && runtimePre.mode === "closed-read-only"
    && runtimePre.checks.C_targeted?.tail?.versionId === parts.runtime.closed
    && runtimePre.checks.D_ordinaryLive?.tail?.versionId === parts.runtime.closed
    && runtimePre.checks.C_targeted?.evaluation?.http === "PASS"
    && runtimePre.checks.D_ordinaryLive?.evaluation?.http === "PASS");
  assert(controlPre.status === "PASS" && fresh(controlPre)
    && controlPre.perRequestVersionIdentity === parts.control.closed
    && Object.values(controlPre.checks).every(row => row.status === "PASS"));
  assert(regression.status === "PASS" && fresh(regression) && regression.results.closed?.claims === 0);
  assert(parity.status === "PASS" && fresh(parity)
    && parity.runtime?.version === parts.runtime.open
    && parity.runtime.moduleHashes?.find(m => m.name === "index.js")?.sha256 === "db3fa64dd2b56a4d3f336919bc45cf9c7ee02bf6bda98035fd012dabdebd4432"
    && parity.runtime.otherFiveMatch && parity.runtime.bindings === 29
    && parity.runtime.assetRoutingMatches && parity.runtime.validationFixPresent
    && parity.control?.version === parts.control.open && parity.control.modulesMatch
    && parity.control.bindingsMatchExceptGate && parity.control.assetRoutingMatches);
  const [r, c, g] = await Promise.all(Object.values(parts).map(deployment));
  assert(exact(r, parts.runtime.closed) && exact(c, parts.control.closed) && exact(g, parts.gateway.closed),
    "Live state changed; no cutover");
  await log("precheck-passed-rollback-prepared", { runtime: r, control: c, gateway: g, parity: args[3] });
  // A lost POST response may still mean a successful deployment.
  touchedRuntime = true;
  await deploy(parts.runtime, parts.runtime.open, "activate-runtime");
  assert(exact(await deployment(parts.runtime), parts.runtime.open), "Runtime readback failed");
  await runtimeGate("candidate", parts.runtime.open);
  touchedControl = true;
  await deploy(parts.control, parts.control.open, "activate-control");
  assert(exact(await deployment(parts.control), parts.control.open), "Control readback failed");
  await controlGate("open", parts.control.open);
  report.status = "OPEN_GATES_PASS_ACCEPTANCE_PENDING";
} catch (error) {
  await log("cutover-failed", { message: error.message });
  report.status = "FAILED_ROLLBACK_REQUIRED";
  process.exitCode = 1;
  if (touchedRuntime || touchedControl) {
    let closed = false;
    for (let attempt = 1; attempt <= 3 && !closed; attempt++) {
      try {
        // Close the public registration gate first.
        if (touchedControl) await deploy(parts.control, parts.control.closed, `rollback-control-${attempt}`);
        await deploy(parts.runtime, parts.runtime.closed, `rollback-runtime-${attempt}`);
        const [r, c, g] = await Promise.all(Object.values(parts).map(deployment));
        closed = exact(r, parts.runtime.closed) && exact(c, parts.control.closed) && exact(g, parts.gateway.closed);
        await log("rollback-readback", { attempt, runtime: r, control: c, gateway: g, closed });
      } catch (rollbackError) { await log("rollback-attempt-failed", { attempt, error: rollbackError.message }); }
    }
    if (closed) {
      try {
        await runtimeGate("closed", parts.runtime.closed);
        await controlGate("closed", parts.control.closed);
        report.status = "FAILED_CLOSED_RESTORED";
      } catch (error) {
        report.status = "CRITICAL_ROLLBACK_OBSERVATION_FAILED";
        await log("rollback-observation-failed", { message: error.message });
      }
    } else report.status = "CRITICAL_ROLLBACK_UNVERIFIED";
  } else report.status = "PRECHECK_FAILED_NO_DEPLOYMENT";
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(artifact, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ artifact: path.relative(root, artifact), status: report.status }));
}