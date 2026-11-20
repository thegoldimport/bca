import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Rebuilds the exact current workspace runtime snapshot from the pinned
// upstream source, accepted resource patches, and a checked-in source patch.
// This is source reconstruction only; it never installs, deploys, or calls a model.
const root = process.cwd();
const directory = path.resolve(process.argv[2] ?? "");
assert(process.argv[2] && directory !== root, "Pass a new, empty reconstruction directory");
const rootRelativeDirectory = path.relative(root, directory);
assert(
  rootRelativeDirectory === ".."
    || rootRelativeDirectory.startsWith(`..${path.sep}`)
    || path.isAbsolute(rootRelativeDirectory),
  "Use a reconstruction directory outside the repository",
);
assert(!await stat(directory).catch(() => null), "Reconstruction directory already exists");

const sourceReceiptPath = "production/vibesdk-launch/workspace-runtime-baseline-source.json";
const sourceReceiptBytes = await readFile(sourceReceiptPath);
const sourceReceipt = JSON.parse(sourceReceiptBytes);
const validationPath = sourceReceipt.input.validationReceipt;
const parityPath = sourceReceipt.input.sourceParityReceipt;
const validationBytes = await readFile(validationPath);
const parityBytes = await readFile(parityPath);
const validation = JSON.parse(validationBytes);
const parity = JSON.parse(parityBytes);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

assert.equal(sha(validationBytes), sourceReceipt.input.validationReceiptSha256);
assert.equal(sha(parityBytes), sourceReceipt.input.sourceParityReceiptSha256);
assert.equal(parity.reconstruction.upstreamCommit, sourceReceipt.input.upstreamCommit);
assert.equal(parity.reconstruction.fetchedArchiveSha256, sourceReceipt.input.upstreamArchiveSha256);
const rawHashes = Object.fromEntries(Object.entries(validation.sourceHashes)
  .filter(([file]) => file.startsWith("production/vibesdk-launch/runtime-source/"))
  .map(([file, hash]) => [file.slice("production/vibesdk-launch/runtime-source/".length), hash])
  .sort(([a], [b]) => a.localeCompare(b)));
assert.equal(Object.keys(rawHashes).length, sourceReceipt.input.rawSourceCount);
assert.equal(sha(Buffer.from(JSON.stringify(rawHashes))), sourceReceipt.input.rawSourceHashesSha256);

const parentBytes = await readFile(sourceReceipt.parentReceipt);
assert.equal(sha(parentBytes), sourceReceipt.parentReceiptSha256);
const parent = JSON.parse(parentBytes);
assert.deepEqual(sourceReceipt.sourceHashes, parent.sourceHashes);

execFileSync(process.execPath, ["scripts/reconstruct-resource-runtime.mjs", directory], {
  stdio: "inherit",
});

const patchBytes = await readFile(sourceReceipt.patch.path);
assert.equal(sha(patchBytes), sourceReceipt.patch.sha256, "Workspace baseline patch changed");
execFileSync("git", ["apply", "--check", path.resolve(sourceReceipt.patch.path)], {
  cwd: directory,
});
execFileSync("git", ["apply", path.resolve(sourceReceipt.patch.path)], {
  cwd: directory,
});

const excluded = file => /(^|\/)(node_modules|dist|\.git|\.wrangler)(\/|$)/.test(file)
  || /^(space\/(?:build|\.build)|\.husky\/_)\//.test(file)
  || ["wrangler.launch.jsonc", ".dev.vars", ".env"].includes(file)
  || file.startsWith(".env.");
const files = [];
for (const file of await readdir(directory, { recursive: true })) {
  if (!excluded(file) && (await stat(path.join(directory, file))).isFile()) files.push(file);
}
assert.deepEqual(files.sort(), Object.keys(sourceReceipt.sourceHashes).sort(), "Unexpected baseline source paths");
for (const [relative, expected] of Object.entries(sourceReceipt.sourceHashes)) {
  assert.equal(sha(await readFile(path.join(directory, relative))), expected, `Baseline source mismatch: ${relative}`);
}
assert.equal(sha(await readFile(path.join(directory, "bun.lock"))), sourceReceipt.bunLockSha256);

console.log(JSON.stringify({
  status: "PASS",
  sourceFiles: files.length,
  baselinePatchSha256: sourceReceipt.patch.sha256,
  directory,
  productionMutations: 0,
}));
