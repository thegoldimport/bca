import test from "node:test";
import assert from "node:assert/strict";
import { handleAiCredentialRoute } from "../cloudflare/ai-credential-routes";

const testSecret = "test-only-ai-credential-secret-never-use-in-production";
const fakeKey = "fake-provider-key-for-tests";

function createDb(initial: Record<string, unknown> | null = null) {
  let row: Record<string, unknown> | null = initial;
  const writes: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          args = values;
          return this;
        },
        async first() {
          if (sql.includes("FROM user_ai_credentials")) {
            if (!row || row.user_id !== args[0]) return null;
            return { ...row };
          }
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          writes.push(args);
          if (sql.startsWith("INSERT INTO user_ai_credentials")) {
            const byok = sql.includes("VALUES(?,'byok'");
            row = {
              user_id: args[0],
              mode: byok ? "byok" : "managed",
              provider: byok ? args[1] : null,
              model_id: byok ? args[2] : null,
              encrypted_api_key: byok ? args[3] : null,
              updated_at: "2026-11-05 00:00:00",
            };
          }
          return { success: true };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, writes, getRow: () => row };
}

function secureRequest(method: string, body?: Record<string, unknown>): Request {
  return new Request("https://app.buildcustom.ai/api/ai-credentials", {
    method,
    headers: {
      Origin: "https://app.buildcustom.ai",
      Cookie: "csrf-token=test-csrf-token",
      "X-CSRF-Token": "test-csrf-token",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("BYOK status never returns the saved key or ciphertext and is scoped to the user", async () => {
  const { db } = createDb({
    user_id: "user-a",
    mode: "byok",
    provider: "openai",
    model_id: "openai/gpt-5-mini",
    encrypted_api_key: "v1.encrypted-test-ciphertext",
    updated_at: "2026-11-05 00:00:00",
  });
  const response = await handleAiCredentialRoute(
    { DB: db, BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET: testSecret },
    secureRequest("GET"),
    "/api/ai-credentials",
    {},
    { id: "user-b" },
  );
  assert.ok(response);
  const body = await response.json();
  assert.equal(body.mode, "managed");
  assert.equal(body.keySaved, false);
  assert.equal(JSON.stringify(body).includes("encrypted-test-ciphertext"), false);
  assert.equal(JSON.stringify(body).includes(fakeKey), false);
});

test("BYOK save stores only ciphertext and does not return the submitted key", async () => {
  const { db, getRow } = createDb();
  const response = await handleAiCredentialRoute(
    { DB: db, BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET: testSecret },
    secureRequest("PUT", { modelId: "openai/gpt-5-mini", apiKey: fakeKey }),
    "/api/ai-credentials",
    { modelId: "openai/gpt-5-mini", apiKey: fakeKey },
    { id: "user-a" },
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "byok");
  assert.equal(body.keySaved, true);
  assert.equal(JSON.stringify(body).includes(fakeKey), false);
  assert.equal(getRow()?.encrypted_api_key === fakeKey, false);
  assert.equal(getRow()?.provider, "openai");
  assert.equal(getRow()?.model_id, "openai/gpt-5-mini");
});

test("BYOK save requires CSRF, a supported model, and the server encryption secret", async () => {
  const { db, writes } = createDb();
  const invalidCsrf = new Request("https://app.buildcustom.ai/api/ai-credentials", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId: "openai/gpt-5-mini", apiKey: fakeKey }),
  });
  const csrfResponse = await handleAiCredentialRoute(
    { DB: db, BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET: testSecret },
    invalidCsrf,
    "/api/ai-credentials",
    { modelId: "openai/gpt-5-mini", apiKey: fakeKey },
    { id: "user-a" },
  );
  assert.equal(csrfResponse?.status, 403);

  const invalidModel = await handleAiCredentialRoute(
    { DB: db, BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET: testSecret },
    secureRequest("PUT", { modelId: "https://attacker.invalid/model", apiKey: fakeKey }),
    "/api/ai-credentials",
    { modelId: "https://attacker.invalid/model", apiKey: fakeKey },
    { id: "user-a" },
  );
  assert.equal(invalidModel?.status, 400);

  const missingSecret = await handleAiCredentialRoute(
    { DB: db },
    secureRequest("PUT", { modelId: "openai/gpt-5-mini", apiKey: fakeKey }),
    "/api/ai-credentials",
    { modelId: "openai/gpt-5-mini", apiKey: fakeKey },
    { id: "user-a" },
  );
  assert.equal(missingSecret?.status, 503);
  assert.equal(writes.length, 0);
});

test("switching back to managed mode removes the saved credential", async () => {
  const { db, getRow } = createDb({
    user_id: "user-a",
    provider: "openai",
    model_id: "openai/gpt-5-mini",
    encrypted_api_key: "v1.encrypted-test-ciphertext",
    updated_at: "2026-11-05 00:00:00",
  });
  const response = await handleAiCredentialRoute(
    { DB: db, BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET: testSecret },
    secureRequest("DELETE"),
    "/api/ai-credentials",
    {},
    { id: "user-a" },
  );
  assert.equal(response?.status, 200);
  assert.equal((await response?.json()).mode, "managed");
  assert.equal(getRow()?.mode, "managed");
  assert.equal(getRow()?.encrypted_api_key, null);
});
