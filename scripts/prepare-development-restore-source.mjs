import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Create a reproducible patch from the accepted runtime to a tested restore candidate.
const [baselineArg, candidateArg] = process.argv.slice(2);
assert(baselineArg && candidateArg, "Pass the reconstructed baseline and tested candidate directories");
const baseline = path.resolve(baselineArg);
const candidate = path.resolve(candidateArg);
const parentPath = "production/vibesdk-launch/workspace-runtime-baseline-source.json";
const parent = JSON.parse(await readFile(parentPath, "utf8"));
const upstream = JSON.parse(await readFile("production/vibesdk-launch/resource-envelope-source-parity.json", "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const addedFiles = [
  "space/test/artifacts-restore.test.ts",
  "space/test/development-restore.test.ts",
  "space/test/development-restore-compatibility.test.ts",
  "worker/agents/core/behaviors/think-restore-sync.ts",
  "worker/agents/core/behaviors/think.restore.test.ts",
  "worker/agents/services/implementations/FileManager.restore.test.ts",
];
const sourceFiles = [...new Set([...Object.keys(parent.sourceHashes), ...addedFiles])].sort();
const changed = [];
const sourceHashes = {};
let patch = "";

for (const name of sourceFiles) {
  const baselinePath = path.join(baseline, name);
  const candidatePath = path.join(candidate, name);
  const isAddition = addedFiles.includes(name);
  if (!isAddition) {
    const baselineBytes = await readFile(baselinePath);
    assert.equal(sha(baselineBytes), parent.sourceHashes[name], `Accepted source mismatch: ${name}`);
  }
  const candidateBytes = await readFile(candidatePath);
  sourceHashes[name] = sha(candidateBytes);
  if (!isAddition && sourceHashes[name] === parent.sourceHashes[name]) continue;
  changed.push(name);
  const result = spawnSync("git", [
    "diff", "--no-index", "--no-ext-diff",
    isAddition ? "/dev/null" : baselinePath,
    candidatePath,
  ], { encoding: "utf8" });
  assert.equal(result.status, 1, `Unable to generate diff for ${name}`);
  patch += result.stdout.split("\n").map(line => {
    if (line.startsWith("diff --git ")) return `diff --git a/${name} b/${name}`;
    if (line.startsWith("--- ") && line !== "--- /dev/null") return `--- a/${name}`;
    if (line.startsWith("+++ ") && line !== "+++ /dev/null") return `+++ b/${name}`;
    return line;
  }).join("\n");
}

const patchPath = "production/patches/development-restore.patch";
await writeFile(patchPath, patch);
const sourceReceipt = {
  parentReceipt: parentPath,
  parentReceiptSha256: sha(await readFile(parentPath)),
  canonicalBaseline: parent.canonicalBaseline,
  upstreamCommit: upstream.reconstruction.upstreamCommit,
  runtimePackageVersion: JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8")).version,
  runtimeLockSha256: sha(await readFile(path.join(candidate, "bun.lock"))),
  patch: { path: patchPath, sha256: sha(patch) },
  changed,
  sourceHashes: Object.fromEntries(changed.map(name => [name, sourceHashes[name]])),
  compatibility: {
    workerChanges: "VibeSDK runtime only; existing control-plane restore route is reused",
    productionIsolation: "Development main branch only; no Production deployment or binding changes",
    restoreUi: "Native Restore remains unavailable until separately approved",
  },
};
const receiptPath = "production/vibesdk-launch/development-restore-source.json";
await writeFile(receiptPath, JSON.stringify(sourceReceipt, null, 2) + "\n");
console.log(JSON.stringify({
  status: "GENERATED",
  changed,
  patchSha256: sourceReceipt.patch.sha256,
  runtimePackageVersion: sourceReceipt.runtimePackageVersion,
  runtimeLockSha256: sourceReceipt.runtimeLockSha256,
}));
