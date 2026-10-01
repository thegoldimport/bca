import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Reconstruct source only. No dependency install, generation, upload or deployment.
const root = process.cwd();
const directory = path.resolve(process.argv[2] ?? "");
assert(process.argv[2] && directory !== root, "Pass a new, empty reconstruction directory");
assert(!await stat(directory).catch(() => null), "Reconstruction directory already exists");
const prefix = "production/vibesdk-launch/resource-envelope";
const receipt = JSON.parse(await readFile(`${prefix}-source-parity.json`, "utf8"));
const validation = JSON.parse(await readFile(`${prefix}-validation.json`, "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const patches = [...receipt.reconstruction.acceptedPatchChain, receipt.releasePatch];
assert.equal(patches.length, 10);
await mkdir(directory, { recursive: true });
const archive = directory + ".tar.gz";
const response = await fetch(`https://codeload.github.com/cloudflare/vibesdk/tar.gz/${receipt.reconstruction.upstreamCommit}`,
  { signal: AbortSignal.timeout(180000) });
assert(response.ok, `Pinned upstream download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(sha(bytes), receipt.reconstruction.fetchedArchiveSha256, "Pinned archive identity changed");
await writeFile(archive, bytes);
execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", directory]);
for (const patch of patches) {
  const filename = path.join(root, patch.path);
  assert.equal(sha(await readFile(filename)), patch.sha256, `Patch hash changed: ${patch.path}`);
  execFileSync("git", ["apply", "--check", filename], { cwd: directory });
  execFileSync("git", ["apply", filename], { cwd: directory });
}
const expected = Object.fromEntries(Object.entries(validation.sourceHashes)
  .filter(([file]) => file.startsWith("production/vibesdk-launch/runtime-source/"))
  .map(([file, hash]) => [file.slice("production/vibesdk-launch/runtime-source/".length), hash]));
assert.equal(Object.keys(expected).length, 860);
for (const [file, hash] of Object.entries(expected)) {
  assert.equal(sha(await readFile(path.join(directory, file))), hash, `Executable/source identity mismatch: ${file}`);
}
const excluded = file => /(^|\/)(node_modules|dist|\.git|\.wrangler)(\/|$)/.test(file)
  || /^(space\/(?:build|\.build)|\.husky\/_)\//.test(file)
  || ["wrangler.launch.jsonc", ".dev.vars", ".env"].includes(file) || file.startsWith(".env.");
const files = [];
for (const file of await readdir(directory, { recursive: true })) {
  if (!excluded(file) && (await stat(path.join(directory, file))).isFile()) files.push(file);
}
assert.deepEqual(files.sort(), Object.keys(expected).sort(), "Unexpected canonical source paths");
assert.equal(sha(await readFile(path.join(directory, "bun.lock"))), receipt.reconstruction.baselineBunLockSha256);
console.log(JSON.stringify({ status: "PASS", upstream: receipt.reconstruction.upstreamCommit,
  patches: patches.length, exactSourcePaths: files.length, directory }));