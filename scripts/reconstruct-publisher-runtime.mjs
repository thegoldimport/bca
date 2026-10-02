import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Source reconstruction only. Never installs, publishes or modifies production.
const directory = path.resolve(process.argv[2] ?? "");
assert(process.argv[2] && directory !== process.cwd(), "Pass a new reconstruction directory");
const receipt = JSON.parse(await readFile("production/vibesdk-launch/publisher-routing-source-parity.json", "utf8"));
execFileSync(process.execPath, ["scripts/reconstruct-resource-runtime.mjs", directory], { stdio: "inherit" });
const sha = value => createHash("sha256").update(value).digest("hex");
const patch = path.resolve(receipt.patch.path);
assert.equal(sha(await readFile(patch)), receipt.patch.sha256, "Publisher patch identity changed");
execFileSync("git", ["apply", "--check", patch], { cwd: directory });
execFileSync("git", ["apply", patch], { cwd: directory });
const paths = [];
for (const relative of await readdir(directory, { recursive: true })) {
  if ((await stat(path.join(directory, relative))).isFile()) paths.push(relative);
}
assert.deepEqual(paths.sort(), Object.keys(receipt.sourceHashes).sort(), "Unexpected publisher source paths");
for (const [relative, hash] of Object.entries(receipt.sourceHashes)) {
  assert.equal(sha(await readFile(path.join(directory, relative))), hash, `Publisher source mismatch: ${relative}`);
}
console.log(JSON.stringify({ status: "PASS", publisherArtifactVersion: receipt.publisherArtifactVersion,
  exactSourcePaths: paths.length, directory }));