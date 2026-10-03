import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Export only the recovered candidate delta over the accepted release.
const baseline = process.argv[2];
assert(baseline, "Pass the reconstructed accepted runtime directory");
const current = "production/vibesdk-launch/runtime-source";
const parentPath = "production/vibesdk-launch/user-approved-continuation-source.json";
const parent = JSON.parse(await readFile(parentPath, "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceHashes = {};
const changed = [];
let patch = "";
for (const name of Object.keys(parent.sourceHashes).sort()) {
  assert.equal(sha(await readFile(path.join(baseline, name))), parent.sourceHashes[name], `Accepted source mismatch: ${name}`);
  const bytes = await readFile(path.join(current, name));
  sourceHashes[name] = sha(bytes);
  if (sourceHashes[name] === parent.sourceHashes[name]) continue;
  changed.push(name);
  const result = spawnSync("git", ["diff", "--no-index", path.join(baseline, name), path.join(current, name)], { encoding: "utf8" });
  assert.equal(result.status, 1);
  patch += result.stdout.split("\n").map(line =>
    line.startsWith("diff --git ") ? `diff --git a/${name} b/${name}`
      : line.startsWith("--- ") ? `--- a/${name}`
        : line.startsWith("+++ ") ? `+++ b/${name}` : line).join("\n");
}
const patchPath = "production/patches/manual-auto-continuation.patch";
await writeFile(patchPath, patch);
const receipt = {
  canonicalBaseline: "208f97099ae297d3d205fec0e813ae87427e6269",
  parentReceipt: parentPath,
  previousRuntimeVersion: "4d45172a-4d55-4f36-989f-b938706a31a5",
  previousControlVersion: "fc92c145-4435-4507-bce1-2857127cb7ab",
  deploymentScope: ["buildcustom-vibesdk-launch", "buildcustom-control-plane-launch"],
  limits: parent.limits,
  patch: { path: patchPath, sha256: sha(patch) }, changed, sourceHashes,
};
await writeFile("production/vibesdk-launch/manual-auto-continuation-source.json", JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS", sourcePaths: Object.keys(sourceHashes).length, changed, patchSha256: receipt.patch.sha256 }));