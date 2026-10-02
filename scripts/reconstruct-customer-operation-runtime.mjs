import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Reconstruct and verify source only; no installation or production writes.
const directory = path.resolve(process.argv[2] ?? "");
assert(process.argv[2] && directory !== process.cwd(), "Pass a new reconstruction directory");
const receipt = JSON.parse(await readFile("production/vibesdk-launch/customer-operation-source.json", "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
execFileSync(process.execPath, ["scripts/reconstruct-d1-runtime.mjs", directory], { stdio: "inherit" });
const patch = path.resolve(receipt.patch.path);
assert.equal(sha(await readFile(patch)), receipt.patch.sha256, "Customer-operation patch identity changed");
execFileSync("git", ["apply", "--check", patch], { cwd: directory });
execFileSync("git", ["apply", patch], { cwd: directory });
const files = [];
for (const relative of await readdir(directory, { recursive: true })) {
  if ((await stat(path.join(directory, relative))).isFile()) files.push(relative);
}
assert.deepEqual(files.sort(), Object.keys(receipt.sourceHashes).sort(), "Unexpected source paths");
for (const [relative, expected] of Object.entries(receipt.sourceHashes)) {
  assert.equal(sha(await readFile(path.join(directory, relative))), expected, `Source mismatch: ${relative}`);
}
console.log(JSON.stringify({ status: "PASS", sourcePaths: files.length, directory, productionMutations: 0 }));