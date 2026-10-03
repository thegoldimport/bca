import assert from "node:assert/strict";
import { auditModuleSets } from "./resource-envelope-module-audit.mjs";

const executable = item => /\.(js|wasm)$/.test(item.name);
const normalized = name => name.replace(/^\.\//, "");

// Wrangler writes local files without the optional deployed "./" prefix.
// Keep the deployed upload names, and audit non-executable imports separately.
export function prepareContinuationModules(oldModules, candidateModules, main) {
  const oldNames = new Map();
  for (const item of oldModules) {
    assert(!oldNames.has(normalized(item.name)), "Ambiguous deployed module name");
    oldNames.set(normalized(item.name), item.name);
  }
  const candidate = candidateModules.map(item => ({
    ...item, name: oldNames.get(normalized(item.name)) ?? item.name,
  }));
  const beforeText = oldModules.filter(item => !executable(item));
  const afterText = candidate.filter(item => !executable(item));
  assert(beforeText.every(item => /^[.]?\/?[a-f0-9]{40}-SKILL\.md$/.test(item.name)), "Unexpected deployed non-executable module");
  assert.deepEqual(afterText.map(item => item.name).sort(), beforeText.map(item => item.name).sort(), "Text module set changed");
  for (const item of beforeText) {
    assert(item.bytes.equals(afterText.find(other => other.name === item.name).bytes), `Text module changed: ${item.name}`);
  }
  const audit = auditModuleSets(oldModules.filter(executable), candidate.filter(executable), main);
  return { candidate, audit, preservedTextModules: beforeText.length };
}