import test from "node:test";
import assert from "node:assert/strict";
import { encryptAiCredential } from "../vibesdk-candidate/shared/ai-credential-crypto";
import {
  readAiCredentialForRuntime,
  shouldUseStoredProviderKeys,
} from "../vibesdk-candidate/shared/ai-credential-storage";

const secret = "test-only-ai-credential-secret-never-use-in-production";
const providerKey = "fake-provider-key-for-isolation-test";

function database(row: Record<string, unknown> | null) {
  return {
    prepare() {
      let userId = "";
      return {
        bind(value: string) {
          userId = value;
          return this;
        },
        async first() {
          return row?.user_id === userId ? row : null;
        },
      };
    },
  };
}

test("runtime credential lookup decrypts only the matching account's provider key", async () => {
  const encrypted = await encryptAiCredential(secret, providerKey);
  const db = database({
    user_id: "owner-a",
    mode: "byok",
    provider: "anthropic",
    model_id: "anthropic/claude-haiku-4-5",
    encrypted_api_key: encrypted,
  });

  assert.deepEqual(await readAiCredentialForRuntime(db, secret, "owner-a"), {
    provider: "anthropic",
    modelId: "anthropic/claude-haiku-4-5",
    apiKey: providerKey,
  });
  assert.equal(await readAiCredentialForRuntime(db, secret, "owner-b"), null);
});

test("managed tombstones and invalid provider records do not activate a key", async () => {
  const managed = database({
    user_id: "owner-a",
    mode: "managed",
    provider: null,
    model_id: null,
    encrypted_api_key: null,
  });
  assert.equal(await readAiCredentialForRuntime(managed, undefined, "owner-a"), null);

  const mismatched = database({
    user_id: "owner-a",
    mode: "byok",
    provider: "openai",
    model_id: "anthropic/claude-haiku-4-5",
    encrypted_api_key: "v1.unused",
  });
  await assert.rejects(readAiCredentialForRuntime(mismatched, secret, "owner-a"), /settings are invalid/);
});

test("customer-owned provider keys are never replaced by the gateway's stored-key mode", () => {
  assert.equal(shouldUseStoredProviderKeys(true, false), false);
  assert.equal(shouldUseStoredProviderKeys(true, true), false);
  assert.equal(shouldUseStoredProviderKeys(false, true), false);
  assert.equal(shouldUseStoredProviderKeys(false, false), true);
});
