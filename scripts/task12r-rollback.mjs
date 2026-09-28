#!/usr/bin/env node
// Invoke only after a Task 12R acceptance failure. Never retries the cutover.
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.argv.length !== 3 || process.argv[2] !== "--failure") throw new Error("Usage: node scripts/task12r-rollback.mjs --failure");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const parts = [
  ["buildcustom-control-plane-launch", "8d07cbf8-c7ad-423e-b592-268e538e3410"],
  ["buildcustom-vibesdk-launch", "8e28025f-e415-4405-9b1f-67d93eff7fd8"],
];
const artifact = path.join(root, "production/vibesdk-launch",
  `task12r-rollback-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const report = { startedAt: new Date().toISOString(), status: "ROLLBACK_REQUIRED", events: [] };
const save = async () => writeFile(artifact, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("Cloudflare credential unavailable");
async function api(method, uri, input) {
  const response = await fetch(base + uri, {
    method, headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      ...(input ? { "Content-Type": "application/json" } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) throw new Error(`Cloudflare ${method} HTTP ${response.status}`);
  return body.result;
}
let restored = false;
for (let attempt = 1; attempt <= 3 && !restored; attempt++) {
  try {
    for (const [name, id] of parts) {
      const result = await api("POST", `/workers/scripts/${name}/deployments`, {
        strategy: "percentage", versions: [{ version_id: id, percentage: 100 }],
        annotations: { "workers/message": `Task 12R failed acceptance rollback ${attempt}` },
      });
      report.events.push({ at: new Date().toISOString(), attempt, worker: name, result });
      await save();
    }
    const states = await Promise.all([...parts,
      ["buildcustom-apps-gateway", "9d80432b-4e53-4fe7-950a-2b53f0213eff"]].map(async ([name, id]) => {
      const result = await api("GET", `/workers/scripts/${name}/deployments`);
      return { name, deployment: result.deployments?.[0],
        matches: result.deployments?.[0]?.versions?.length === 1
          && result.deployments[0].versions[0].version_id === id
          && result.deployments[0].versions[0].percentage === 100 };
    }));
    restored = states.every(s => s.matches);
    report.events.push({ at: new Date().toISOString(), attempt, states, restored });
  } catch (error) {
    report.events.push({ at: new Date().toISOString(), attempt, error: error.message });
  }
  await save();
}
if (restored) {
  for (const [script, flag] of [
    ["task12n-runtime-capability-probe.mjs", "--expect=closed"],
    ["task12j-control-cutover-probe.mjs", "--phase=closed"],
    ["task12l-production-regression.mjs", null],
  ]) {
    const run = spawnSync(process.execPath, [path.join(root, "scripts", script), ...(flag ? [flag] : [])], {
      cwd: root, encoding: "utf8", timeout: 150000, maxBuffer: 2 * 1024 * 1024,
    });
    let result = null;
    try { result = JSON.parse(run.stdout.trim().split("\n").at(-1)); } catch {}
    report.events.push({ at: new Date().toISOString(), script, code: run.status,
      artifact: result?.artifact ?? null, status: result?.status ?? "UNKNOWN" });
    await save();
  }
}
report.status = restored && report.events.filter(e => e.script).length === 3
  && report.events.filter(e => e.script).every(e => e.code === 0 && e.status === "PASS")
  ? "CLOSED_VERIFIED" : "CRITICAL_ROLLBACK_UNVERIFIED";
report.completedAt = new Date().toISOString();
await save();
console.log(JSON.stringify({ artifact: path.relative(root, artifact), status: report.status }));
if (report.status !== "CLOSED_VERIFIED") process.exitCode = 1;