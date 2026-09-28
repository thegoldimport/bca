#!/usr/bin/env node
// One separately authorized runtime-only activation. Never uploads versions,
// changes bindings, deploys control, or leaves the diagnostic candidate serving.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = "buildcustom-vibesdk-launch";
const control = "buildcustom-control-plane-launch";
const gateway = "buildcustom-apps-gateway";
const accepted = "8e28025f-e415-4405-9b1f-67d93eff7fd8";
const candidate = "95da88fe-fe8a-4ce3-9c62-4565d7f279c2";
const controlAccepted = "8d07cbf8-c7ad-423e-b592-268e538e3410";
const gatewayAccepted = "9d80432b-4e53-4fe7-950a-2b53f0213eff";
const base = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const journalPath = path.join(root, "production/vibesdk-launch",
  `task12q-operation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const journal = { startedAt: new Date().toISOString(), status: "PRECHECK", events: [] };
const files = process.argv.slice(2);
if (files.length !== 5 || files[4] !== "--execute"
  || !files[0].startsWith("production/vibesdk-launch/task12n-runtime-observation-")
  || !files[1].startsWith("production/vibesdk-launch/task12j-observation-")
  || !files[2].startsWith("production/vibesdk-launch/task12m-precheck-")
  || !files[3].startsWith("production/vibesdk-launch/task12l-regression-")) {
  throw new Error("Usage: node scripts/task12q-guarded-runtime-diagnostic.mjs <runtime-closed> <control-closed> <parity> <regression> --execute");
}
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("Cloudflare credential unavailable");

async function log(stage, evidence) {
  journal.events.push({ at: new Date().toISOString(), stage, evidence });
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ stage, evidence }));
}
async function cf(method, pathname, input) {
  const response = await fetch(base + pathname, {
    method, headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      ...(input ? { "Content-Type": "application/json" } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}), cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true)
    throw new Error(`Cloudflare ${method} returned HTTP ${response.status}: ${(body.errors ?? []).map(e => e.code).join(",")}`);
  return body.result;
}
const deployments = name => cf("GET", `/workers/scripts/${name}/deployments`)
  .then(result => result.deployments?.[0]);
function exact(row, version) {
  return row?.versions?.length === 1 && row.versions[0].version_id === version
    && row.versions[0].percentage === 100;
}
async function controlClosed() {
  const [deployed, version, cap] = await Promise.all([
    deployments(control),
    cf("GET", `/workers/scripts/${control}/versions/${controlAccepted}`),
    fetch("https://app.buildcustom.ai/api/public/capabilities", { cache: "no-store", signal: AbortSignal.timeout(15000) }),
  ]);
  const body = await cap.json();
  assert(exact(deployed, controlAccepted) && version.resources?.bindings?.find(b =>
    b.name === "STAGING_REGISTRATION_ENABLED")?.text === "false");
  assert.equal(cap.status, 200);
  assert.equal(body.registrationEnabled, false);
  assert.equal(body.publicGeneratedAppsEnabled, true);
  return { deployment: deployed, registration: false, publicApps: true };
}
function probe(phase) {
  const run = spawnSync(process.execPath, [
    path.join(root, "scripts/task12n-runtime-capability-probe.mjs"), `--expect=${phase}`,
  ], { cwd: root, encoding: "utf8", timeout: 150000, maxBuffer: 1024 * 1024 });
  const lines = run.stdout?.trim().split("\n") ?? [];
  let outcome = null;
  try { outcome = JSON.parse(lines.at(-1)); } catch { /* missing artifact is a failure */ }
  return { exitCode: run.status, error: run.error?.message ?? null, artifact: outcome?.artifact ?? null,
    status: outcome?.status ?? "UNKNOWN" };
}
async function evidence(outcome) {
  if (!outcome.artifact?.startsWith("production/vibesdk-launch/task12n-runtime-observation-"))
    return null;
  return JSON.parse(await readFile(path.join(root, outcome.artifact), "utf8"));
}
async function setVersion(version, label) {
  const input = { strategy: "percentage",
    versions: [{ version_id: version, percentage: 100 }],
    annotations: { "workers/message": `Task 12Q ${label}` } };
  await log(`request-${label}`, { worker, input });
  const result = await cf("POST", `/workers/scripts/${worker}/deployments`, input);
  await log(`deployment-${label}`, { worker, response: result, requestedAt: new Date().toISOString() });
  return result;
}

let touched = false;
try {
  const [runtimePre, controlPre, parity, regression] = await Promise.all(files.slice(0, 4)
    .map(file => readFile(path.join(root, file), "utf8").then(JSON.parse)));
  const fresh = data => Date.now() - Date.parse(data.completedAt) < 15 * 60 * 1000;
  assert(runtimePre.status === "PASS" && runtimePre.mode === "closed-read-only"
    && runtimePre.checks.A_deployment?.candidatePercentage === 0
    && runtimePre.checks.B_candidateMetadata?.registration === "true"
    && runtimePre.checks.B_candidateMetadata?.emailAuth !== "false"
    && runtimePre.checks.C_targeted?.evaluation?.version === "PASS"
    && runtimePre.checks.D_ordinaryLive?.evaluation?.version === "PASS"
    && runtimePre.checks.C_targeted?.evaluation?.http === "PASS"
    && runtimePre.checks.D_ordinaryLive?.evaluation?.http === "PASS"
    && fresh(runtimePre), "Fresh version-traced closed runtime required");
  assert(controlPre.status === "PASS" && controlPre.perRequestVersionIdentity === controlAccepted
    && fresh(controlPre), "Fresh version-traced closed control required");
  assert(parity.status === "PASS" && parity.runtime?.version === candidate
    && parity.runtime.moduleHashes?.find(m => m.name === "index.js")?.sha256
      === "db3fa64dd2b56a4d3f336919bc45cf9c7ee02bf6bda98035fd012dabdebd4432"
    && parity.runtime.otherFiveMatch && parity.runtime.bindings === 29
    && parity.runtime.assetRoutingMatches && fresh(parity), "Fresh candidate parity required");
  assert(regression.status === "PASS" && regression.results.closed?.claims === 0
    && fresh(regression), "Fresh closed-production regression required");
  const [before, controlBefore, gatewayBefore] = await Promise.all([
    deployments(worker), controlClosed(), deployments(gateway),
  ]);
  assert(exact(before, accepted) && exact(controlBefore.deployment, controlAccepted)
    && exact(gatewayBefore, gatewayAccepted), "Production deployment changed; no activation");
  await log("precheck-passed", { before, control: controlBefore, gateway: gatewayBefore,
    parity: files[2], runtimeClosed: files[0], controlClosed: files[1], regression: files[3] });
  // A POST can succeed even if its response is lost. Roll back from this point
  // onward, including on network or evidence failures.
  touched = true;
  await setVersion(candidate, "activate-runtime-candidate");
  const active = await deployments(worker);
  const controlDuring = await controlClosed();
  await log("candidate-readback", { active, control: controlDuring });
  assert(exact(active, candidate), "Candidate not the only 100% runtime version");
  const run = probe("candidate");
  const observed = await evidence(run);
  await log("candidate-observer", {
    ...run,
    observations: observed?.observations ?? null,
    targeted: observed?.checks?.C_targeted ? {
      request: observed.checks.C_targeted.request, response: observed.checks.C_targeted.response,
      tail: observed.checks.C_targeted.tail, evaluation: observed.checks.C_targeted.evaluation } : null,
    ordinary: observed?.checks?.D_ordinaryLive ? {
      request: observed.checks.D_ordinaryLive.request, response: observed.checks.D_ordinaryLive.response,
      tail: observed.checks.D_ordinaryLive.tail, evaluation: observed.checks.D_ordinaryLive.evaluation } : null,
    auth: observed?.checks?.E_existingUserAuth ?? null,
  });
  assert(run.exitCode === 0 && observed?.status === "PASS"
    && observed.checks.C_targeted?.evaluation?.version === "PASS"
    && observed.checks.D_ordinaryLive?.evaluation?.version === "PASS"
    && observed.checks.C_targeted?.evaluation?.http === "PASS"
    && observed.checks.D_ordinaryLive?.evaluation?.http === "PASS"
    && observed.checks.E_existingUserAuth?.status === "PASS", "Candidate diagnostic gate failed");
  journal.status = "CANDIDATE_OBSERVED_ROLLBACK_REQUIRED";
} catch (error) {
  await log("diagnostic-failed", { message: error.message });
  journal.status = "FAILED_ROLLBACK_REQUIRED";
  process.exitCode = 1;
} finally {
  if (touched) {
    let restored = false;
    for (let n = 0; n < 3 && !restored; n++) {
      try {
        const rollback = await setVersion(accepted, `restore-accepted-runtime-${n + 1}`);
        const [readback, controlState] = await Promise.all([deployments(worker), controlClosed()]);
        restored = exact(readback, accepted);
        await log("rollback-readback", { deploymentId: rollback.id, readback, control: controlState,
          restored });
      } catch (error) {
        await log("rollback-attempt-failed", { attempt: n + 1, message: error.message });
      }
    }
    if (!restored) {
      journal.status = "CRITICAL_ROLLBACK_UNVERIFIED";
      process.exitCode = 1;
    } else {
      const closed = probe("closed");
      let observed = null;
      try { observed = await evidence(closed); } catch (error) {
        await log("rollback-observer-read-failed", { message: error.message });
      }
      await log("rollback-observer", { ...closed,
        targeted: observed?.checks?.C_targeted?.evaluation ?? null,
        ordinary: observed?.checks?.D_ordinaryLive?.evaluation ?? null,
        targetedVersion: observed?.checks?.C_targeted?.tail?.versionId ?? null,
        ordinaryVersion: observed?.checks?.D_ordinaryLive?.tail?.versionId ?? null,
        targetedBody: observed?.checks?.C_targeted?.response?.redactedRawBody ?? null,
        ordinaryBody: observed?.checks?.D_ordinaryLive?.response?.redactedRawBody ?? null });
      if (closed.exitCode !== 0 || observed?.status !== "PASS") {
        journal.status = "CLOSED_DEPLOYMENT_RESTORED_OBSERVER_FAILED";
        process.exitCode = 1;
      } else if (journal.status === "CANDIDATE_OBSERVED_ROLLBACK_REQUIRED") {
        journal.status = "CANDIDATE_OBSERVED_CLOSED_RESTORED";
      } else journal.status = "DIAGNOSTIC_FAILED_CLOSED_RESTORED";
    }
  } else if (journal.status === "PRECHECK") journal.status = "PRECHECK_FAILED_NO_DEPLOYMENT";
  journal.completedAt = new Date().toISOString();
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ journal: path.relative(root, journalPath), status: journal.status }));
}