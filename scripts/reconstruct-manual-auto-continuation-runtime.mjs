import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

const directory = path.resolve(process.argv[2] ?? "");
assert(process.argv[2] && directory !== process.cwd(), "Pass a new reconstruction directory");
const receipt = JSON.parse(await readFile("production/vibesdk-launch/manual-auto-continuation-source.json", "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
execFileSync(process.execPath, ["scripts/reconstruct-user-approved-continuation-runtime.mjs", directory], { stdio: "inherit" });
assert.equal(sha(await readFile(receipt.patch.path)), receipt.patch.sha256);
execFileSync("git", ["apply", "--check", path.resolve(receipt.patch.path)], { cwd: directory });
execFileSync("git", ["apply", path.resolve(receipt.patch.path)], { cwd: directory });
for (const [relative, expected] of Object.entries(receipt.sourceHashes)) {
  assert.equal(sha(await readFile(path.join(directory, relative))), expected, `Source mismatch: ${relative}`);
}
console.log(JSON.stringify({ status: "PASS", sourcePaths: Object.keys(receipt.sourceHashes).length, directory, productionMutations: 0 }));