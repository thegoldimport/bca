import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Generates patch/receipt artifacts from the tested checkout, not source edits.
const baseline = "/tmp/buildcustom-approved-continuation-baseline";
const current = "production/vibesdk-launch/runtime-source";
const parent = JSON.parse(await readFile("production/vibesdk-launch/customer-operation-source.json", "utf8"));
const names = [...Object.keys(parent.sourceHashes),
  "worker/agents/think/user-approved-continuation.ts",
  "worker/agents/think/user-approved-continuation.test.ts",
].sort();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceHashes = {};
const changed = [];
let patch = "";
for (const name of names) {
  const bytes = await readFile(path.join(current, name));
  sourceHashes[name] = sha(bytes);
  if (parent.sourceHashes[name]) {
    assert.equal(sha(await readFile(path.join(baseline, name))), parent.sourceHashes[name]);
    if (sourceHashes[name] === parent.sourceHashes[name]) continue;
  }
  changed.push(name);
  const result = spawnSync("git", ["diff", "--no-index",
    parent.sourceHashes[name] ? path.join(baseline, name) : "/dev/null",
    path.join(current, name)], { encoding: "utf8" });
  assert.equal(result.status, 1, `Unable to generate diff for ${name}`);
  patch += result.stdout.split("\n").map(line => {
    if (line.startsWith("diff --git ")) return `diff --git a/${name} b/${name}`;
    if (line.startsWith("--- ") && line !== "--- /dev/null") return `--- a/${name}`;
    if (line.startsWith("+++ ")) return `+++ b/${name}`;
    return line;
  }).join("\n");
}
const patchPath = "production/patches/user-approved-continuation.patch";
await writeFile(patchPath, patch);
const receipt = {
  canonicalBaseline: "aaaa1749c96d3c6f2a80f77a71c550d6db362b51",
  parentReceipt: "production/vibesdk-launch/customer-operation-source.json",
  previousRuntimeVersion: "2ce0e373-1a98-471c-b21f-3b66d28c4d73",
  previousControlVersion: "c5e18eab-1b8b-49d4-adc0-62dfb0e5e6ac",
  deploymentScope: ["buildcustom-vibesdk-launch", "buildcustom-control-plane-launch"],
  limits: { maxSteps: 25, thinkTurns: 5, maxContinuations: 4, maxCredits: 250, maxElapsedMs: 900000 },
  patch: { path: patchPath, sha256: sha(patch) }, changed, sourceHashes,
};
await writeFile("production/vibesdk-launch/user-approved-continuation-source.json", JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ status: "GENERATED", sourcePaths: names.length, changed, patchSha256: receipt.patch.sha256 }));