import test from "node:test";
import assert from "node:assert/strict";
import { publicRuntimeConfig, validateRuntimeConfig, VibeSdkAdapterError } from "../cloudflare/staging/vibesdk-adapter";

test("requires an HTTPS runtime and API key", () => {
  assert.throws(() => validateRuntimeConfig({}), (error: unknown) => error instanceof VibeSdkAdapterError && error.code === "RUNTIME_UNCONFIGURED");
  assert.throws(() => validateRuntimeConfig({ VIBESDK_RUNTIME_URL: "http://runtime.example", VIBESDK_API_KEY: "secret" }), /HTTPS/);
  assert.deepEqual(validateRuntimeConfig({ VIBESDK_RUNTIME_URL: "https://runtime.example/", VIBESDK_API_KEY: "secret" }), {
    runtimeUrl: "https://runtime.example",
    apiKey: "secret",
  });
});

test("public runtime metadata never includes the API key", () => {
  const result = publicRuntimeConfig({ VIBESDK_RUNTIME_URL: "https://runtime.example", VIBESDK_API_KEY: "super-secret" });
  assert.deepEqual(result, { runtimeUrl: "https://runtime.example", configured: true });
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
});