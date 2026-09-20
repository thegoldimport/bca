import test from "node:test";
import assert from "node:assert/strict";
import { projectIdFromPath } from "../cloudflare/worker";

test("extracts project ownership IDs from project and nested runtime routes", () => {
  assert.equal(projectIdFromPath("/api/projects/42"), 42);
  assert.equal(projectIdFromPath("/api/projects/42/runtime/messages"), 42);
  assert.equal(projectIdFromPath("/api/projects/42/runtime/files/content"), 42);
});

test("does not treat unrelated or malformed paths as project routes", () => {
  assert.equal(projectIdFromPath("/api/projects"), null);
  assert.equal(projectIdFromPath("/api/projects/not-a-number/runtime/status"), null);
  assert.equal(projectIdFromPath("/api/projects/42evil"), null);
});