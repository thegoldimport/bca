import test from "node:test";
import assert from "node:assert/strict";
import { handleAiCredentialRoute } from "../cloudflare/ai-credential-routes";
import { encryptAiCredential } from "../vibesdk-candidate/shared/ai-credential-crypto";

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
          } else if (sql.startsWith("UPDATE user_ai_credentials") && row?.user_id === args[1]) {
            row = { ...row, model_id: args[0], updated_at: "2026-11-05 00:00:00" };
          }
          return { success: true };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, writes, getRow: () => row };
}

function secureRequest(method: string, body?: Record<string, unknown>, path = "/api/ai-credentials"): Request {
  return new Request(`https://app.buildcustom.ai${path}`, {
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

function modelListFetcher(status = 200) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return Response.json({
      data: [
        { id: "gpt-4.1", created: 1740000000 },
        { id: "gpt-4o-mini", created: 1730000000 },
        { id: "text-embedding-3-small", created: 1720000000 },
        { id: "dall-e-3", created: 1710000000 },
      ],
    }, { status });
  };
  return { fetcher, calls };
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
  assert.deepEqual(body.providers.map((provider: { id: string }) => provider.id), [
    "anthropic", "openai", "google-ai-studio", "grok",
  ]);
});

test("provider connection validates via official model list and stores only ciphertext", async () => {
  const { db, getRow } = createDb();
  const { fetcher, calls } = modelListFetcher();
  const response = await handleAiCredentialRoute(
    { DB: db, BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET: testSecret },
    secureRequest("POST", { provider: "openai", apiKey: fakeKey }, "/api/ai-credentials/connect"),
    "/api/ai-credentials/connect",
    { provider: "openai", apiKey: fakeKey },
    { id: "user-a" },
    fetcher,
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "byok");
  assert.equal(body.keySaved, true);
  assert.equal(body.validation, "model-list-access");
  assert.equal(body.modelId, "openai/gpt-4.1");
  assert.equal(JSON.stringify(body).includes(fakeKey), false);
  assert.equal(getRow()?.encrypted_api_key === fakeKey, false);
  assert.equal(getRow()?.provider, "openai");
  assert.equal(getRow()?.model_id, "openai/gpt-4.1");
  assert.equal(calls[0].url, "https://api.openai.com/v1/models");
  assert.equal(calls[0].headers.get("Authorization"), `Bearer ${fakeKey}`);
  assert.equal(body.models.some((model: { providerModelId: string }) => model.providerModelId === "text-embedding-3-small"), false);
  assert.ok(body.unavailable.some((model: { providerModelId: string }) => model.providerModelId === "text-embedding-3-small"));
});

test("provider connection requires CSRF, a supported provider, and the encryption secret", async () => {
  const { db, writes } = createDb();
  const invalidCsrf = new Request("https://app.buildcustom.ai/api/ai-credentials/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId: "openai/gpt-5-mini", apiKey: fakeKey }),
  });
  const csrfResponse = await handleAiCredentialRoute(
    { DB: db, BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET: testSecret },
    invalidCsrf,
    "/api/ai-credentials/connect",
    { provider: "openai", apiKey: fakeKey },
    { id: "user-a" },
  );
  assert.equal(csrfResponse?.status, 403);

  const invalidProvider = await handleAiCredentialRoute(
    { DB: db, BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET: testSecret },
    secureRequest("POST", { provider: "https://attacker.invalid", apiKey: fakeKey }, "/api/ai-credentials/connect"),
    "/api/ai-credentials/connect",
    { provider: "https://attacker.invalid", apiKey: fakeKey },
    { id: "user-a" },
  );
  assert.equal(invalidProvider?.status, 400);

  const missingSecret = await handleAiCredentialRoute(
    { DB: db },
    secureRequest("POST", { provider: "openai", apiKey: fakeKey }, "/api/ai-credentials/connect"),
    "/api/ai-credentials/connect",
    { provider: "openai", apiKey: fakeKey },
    { id: "user-a" },
  );
  assert.equal(missingSecret?.status, 503);
  assert.equal(writes.length, 0);
});

test("provider authentication failures do not save the key or expose provider response bodies", async () => {
  const { db, writes } = createDb();
  const fetcher: typeof fetch = async () => new Response("sensitive provider error detail", { status: 401 });
  const response = await handleAiCredentialRoute(
    { DB: db, BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET: testSecret },
    secureRequest("POST", { provider: "anthropic", apiKey: fakeKey }, "/api/ai-credentials/connect"),
    "/api/ai-credentials/connect",
    { provider: "anthropic", apiKey: fakeKey },
    { id: "user-a" },
    fetcher,
  );
  assert.equal(response?.status, 422);
  const body = await response?.json();
  assert.match(body.message, /rejected this API key/i);
  assert.equal(JSON.stringify(body).includes("sensitive provider error detail"), false);
  assert.equal(writes.length, 0);
});

test("refresh and model selection use only the saved account credential and persist compatible models", async () => {
  const encrypted = await encryptAiCredential(testSecret, fakeKey);
  const { db, getRow } = createDb({
    user_id: "user-a",
    mode: "byok",
    provider: "openai",
    model_id: "openai/gpt-4o-mini",
    encrypted_api_key: encrypted,
    updated_at: "2026-11-05 00:00:00",
  });
  const { fetcher, calls } = modelListFetcher();
  const refresh = await handleAiCredentialRoute(
    { DB: db, BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET: testSecret },
    secureRequest("POST", {}, "/api/ai-credentials/models"),
    "/api/ai-credentials/models",
    {},
    { id: "user-a" },
    fetcher,
  );
  assert.equal(refresh?.status, 200);
  const refreshBody = await refresh?.json();
  assert.equal(refreshBody.keySaved, true);
  assert.equal(JSON.stringify(refreshBody).includes(fakeKey), false);
  assert.equal(calls[0].headers.get("Authorization"), `Bearer ${fakeKey}`);

  const selected = await handleAiCredentialRoute(
    { DB: db, BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET: testSecret },
    secureRequest("PUT", { modelId: "openai/gpt-4.1" }, "/api/ai-credentials/model"),
    "/api/ai-credentials/model",
    { modelId: "openai/gpt-4.1" },
    { id: "user-a" },
    fetcher,
  );
  assert.equal(selected?.status, 200);
  assert.equal((await selected?.json()).modelId, "openai/gpt-4.1");
  assert.equal(getRow()?.model_id, "openai/gpt-4.1");
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
