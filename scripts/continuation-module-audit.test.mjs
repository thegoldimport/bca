import test from "node:test";
import assert from "node:assert/strict";
import { prepareContinuationModules } from "./continuation-module-audit.mjs";

const textName = "a".repeat(40) + "-SKILL.md";
const baseline = [
  { name: "index.js", bytes: Buffer.from("export default {};") },
  { name: "./test.wasm", bytes: Buffer.from([0, 1]) },
  { name: "./" + textName, bytes: Buffer.from("Keep these instructions unchanged.") },
];
const candidate = baseline.map(item => ({ ...item, name: item.name.replace(/^\.\//, "") }));
test("preserves exact deployed text and wasm names without dropping skill imports", () => {
  const result = prepareContinuationModules(baseline, candidate, "index.js");
  assert.equal(result.audit.status, "PASS");
  assert.equal(result.preservedTextModules, 1);
  assert.deepEqual(result.candidate.map(item => item.name), baseline.map(item => item.name));
});
test("rejects changed or missing text modules before upload", () => {
  assert.throws(() => prepareContinuationModules(baseline, candidate.slice(0, 2), "index.js"));
  assert.throws(() => prepareContinuationModules(baseline, candidate.map(item => item.name === textName
    ? { ...item, bytes: Buffer.from("Altered instructions") } : item), "index.js"));
});