import test from "node:test";
import assert from "node:assert/strict";
import { canPublishInStaging, isReadOnlyRuntimeOperation, projectIdFromPath, serializeProject, serializeRelease, serializeTurn, serializeUser } from "../cloudflare/worker";
import { authHeaders } from "../client/src/lib/auth";

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

test("serializes D1 project rows to the frontend contract", () => {
  const result = serializeProject({ id: 3, user_id: "u", name: "Demo", type: "website", status: "draft", description: "", framework: "React", url: null, created_at: "c", updated_at: "u", agent_id: "a", preview_url: "p", deployment_url: "d" });
  assert.deepEqual(result, { id: 3, userId: "u", name: "Demo", type: "website", status: "draft", description: "", framework: "React", url: null, createdAt: "c", updatedAt: "u", agentId: "a", previewUrl: "p", deploymentUrl: "d" });
});

test("serializes turn JSON columns and release names", () => {
  assert.deepEqual(serializeTurn({ id: 1, project_id: 3, mode: "build", prompt: "p", response: "r", changed_files: '[{\"path\":\"a\"}]', activity: "[]", commit_hash: "abc", created_at: "now" }), {
    id: 1, projectId: 3, mode: "build", prompt: "p", response: "r", changedFiles: [{ path: "a" }], activity: [], commitHash: "abc", createdAt: "now",
  });
  assert.deepEqual(serializeRelease({ id: 2, project_id: 3, commit_hash: "def", deployment_url: "https://example.test", created_at: "now" }), {
    id: 2, projectId: 3, commitHash: "def", deploymentUrl: "https://example.test", createdAt: "now",
  });
});

test("only the canonical super administrator role can publish staging projects", () => {
  assert.equal(canPublishInStaging("super_admin"), true);
  assert.equal(canPublishInStaging("user"), false);
  assert.equal(canPublishInStaging("admin"), false);
  assert.equal(canPublishInStaging(undefined), false);
});

test("the closed runtime gate allows reads but blocks mutations and restores", () => {
  for (const operation of ["status", "files", "files/content", "turns", "publishing-settings", "releases"]) {
    assert.equal(isReadOnlyRuntimeOperation("GET", operation), true);
  }
  for (const operation of ["messages", "previews", "stop", "deployments", "turns/4/restore", "releases/6/restore"]) {
    assert.equal(isReadOnlyRuntimeOperation("POST", operation), false);
  }
  assert.equal(isReadOnlyRuntimeOperation("PUT", "publishing-settings"), false);
});

test("browser authentication relies only on the secure session cookie", () => {
  assert.deepEqual(authHeaders(), {});
});

test("serializes every user response to the canonical camelCase contract", () => {
  assert.deepEqual(serializeUser({ id: "u", username: "User", email: "u@example.test", plan: "free", role: "user", created_at: "now" }), {
    id: "u", username: "User", email: "u@example.test", plan: "free", role: "user", createdAt: "now",
  });
});