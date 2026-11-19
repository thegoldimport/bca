import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Source reconstruction only. Never installs, deploys, or calls a model.
const directory = path.resolve(process.argv[2] ?? "");
assert(process.argv[2] && directory !== process.cwd(), "Pass a new reconstruction directory");
const receiptPath = "production/vibesdk-launch/development-restore-source.json";
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
const parentBytes = await readFile(receipt.parentReceipt);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(sha(parentBytes), receipt.parentReceiptSha256, "Parent runtime receipt changed");
execFileSync(process.execPath, ["scripts/reconstruct-manual-auto-continuation-runtime.mjs", directory], { stdio: "inherit" });
const patchBytes = await readFile(receipt.patch.path);
assert.equal(sha(patchBytes), receipt.patch.sha256, "Development restore patch changed");
execFileSync("git", ["apply", "--check", path.resolve(receipt.patch.path)], { cwd: directory });
execFileSync("git", ["apply", path.resolve(receipt.patch.path)], { cwd: directory });
for (const [relative, expected] of Object.entries(receipt.sourceHashes)) {
  assert.equal(sha(await readFile(path.join(directory, relative))), expected, `Source mismatch: ${relative}`);
}
console.log(JSON.stringify({
  status: "PASS",
  changedSourcePaths: Object.keys(receipt.sourceHashes).length,
  directory,
  productionMutations: 0,
}));
