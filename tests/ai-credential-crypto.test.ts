import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptAiCredential,
  encryptAiCredential,
  protectAiCredentialForStorage,
} from "../vibesdk-candidate/shared/ai-credential-crypto";

const secret = "test-only-encryption-secret-never-used-in-production";
const fakeKeyForStorageTest = "fake-provider-key-for-think-storage";

test("AI credentials are encrypted and can be decrypted with the same secret", async () => {
  const plaintext = "fake-provider-key-for-tests";
  const encrypted = await encryptAiCredential(secret, plaintext);

  assert.notEqual(encrypted, plaintext);
  assert.equal(encrypted.includes(plaintext), false);
  assert.equal(await decryptAiCredential(secret, encrypted), plaintext);
});

test("AI credential ciphertext cannot be decrypted with another secret or after tampering", async () => {
  const encrypted = await encryptAiCredential(secret, "fake-provider-key-for-tests");

  await assert.rejects(
    decryptAiCredential("different-test-only-encryption-secret", encrypted),
    /could not be decrypted/,
  );
  await assert.rejects(
    decryptAiCredential(secret, `${encrypted.slice(0, -2)}AA`),
    /could not be decrypted/,
  );
});

test("AI credential encryption rejects short secrets and malformed values", async () => {
  await assert.rejects(encryptAiCredential("short", "fake-provider-key"));
  await assert.rejects(encryptAiCredential(secret, "short"));
  await assert.rejects(decryptAiCredential(secret, "not-an-envelope"));
});

test("ThinkAgent persistence receives a placeholder and ciphertext, never a provider key", async () => {
  const protectedKey = await protectAiCredentialForStorage(secret, fakeKeyForStorageTest);

  assert.equal(protectedKey.apiKey, "buildcustom-encrypted-key");
  assert.notEqual(protectedKey.encryptedApiKey, fakeKeyForStorageTest);
  assert.equal(protectedKey.encryptedApiKey.includes(fakeKeyForStorageTest), false);
  assert.equal(await decryptAiCredential(secret, protectedKey.encryptedApiKey), fakeKeyForStorageTest);
});

