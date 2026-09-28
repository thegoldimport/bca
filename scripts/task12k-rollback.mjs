#!/usr/bin/env node

// Exact accepted-version emergency restore for Task 12K only. Invoke once
// after a required acceptance failure; never use it to retry the cutover.
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.length !== 3 || process.argv[2] !== "--failure") {
  throw new Error("Usage: node scripts/task12k-rollback.mjs --failure");
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const parts = [
  ["buildcustom-control-plane-launch", "8d07cbf8-c7ad-423e-b592-268e538e3410"],
  ["buildcustom-vibesdk-launch", "8e28025f-e415-4405-9b1f-67d93eff7fd8"],
];
const artifact = path.join(root, "production/vibesdk-launch",
  `task12k-rollback-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const report = { startedAt: new Date().toISOString(), deployments: [], status: "PENDING" };
async function save() {
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("Cloudflare credential unavailable");
for (const [worker, version] of parts) {
  try {
    const response = await fetch(`${base}/workers/scripts/${worker}/deployments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        strategy: "percentage",
        versions: [{ version_id: version, percentage: 100 }],
        annotations: { "workers/message": "Task 12K failed acceptance: restore closed signup" },
      }),
    });
    const body = await response.json();
    report.deployments.push({
      at: new Date().toISOString(), worker, version, status: response.status,
      success: body.success === true, deployment: body.result ?? null,
      errorCodes: body.errors?.map((item) => item.code) ?? [],
    });
  } catch (error) {
    report.deployments.push({ at: new Date().toISOString(), worker, version, error: error.message });
  }
  await save();
}
const probe = spawnSync(process.execPath,
  [path.join(root, "scripts/task12j-control-cutover-probe.mjs"), "--phase=closed"],
  { encoding: "utf8", timeout: 110000, maxBuffer: 2 * 1024 * 1024 });
const lastLine = probe.stdout?.trim().split("\n").at(-1);
try { report.closedProbe = { exitCode: probe.status, ...JSON.parse(lastLine) }; }
catch { report.closedProbe = { exitCode: probe.status, error: probe.error?.message ?? "No observation artifact" }; }
report.status = report.deployments.every((d) => d.success) && probe.status === 0 ? "CLOSED" : "ROLLBACK_UNVERIFIED";
report.completedAt = new Date().toISOString();
await save();
console.log(JSON.stringify({ artifact: path.relative(root, artifact), status: report.status, ...report.closedProbe }));
if (report.status !== "CLOSED") process.exitCode = 1;