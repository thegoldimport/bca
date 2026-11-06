import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverAiModels,
  isValidProviderModelId,
} from "../vibesdk-candidate/shared/ai-model-discovery";
import { getRuntimeAiModelConfig } from "../vibesdk-candidate/shared/ai-provider-catalog";

test("OpenAI discovery uses the fixed models endpoint and filters non-chat models", async () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return Response.json({
      data: [
        { id: "gpt-4.1", created: 2 },
        { id: "text-embedding-3-large", created: 4 },
        { id: "dall-e-3", created: 3 },
        { id: "babbage-002", created: 5 },
        { id: "gpt-4o-mini", created: 1 },
      ],
    });
  };
  const result = await discoverAiModels("openai", "fake-provider-key", fetcher);
  assert.equal(calls[0].url, "https://api.openai.com/v1/models");
  assert.equal(calls[0].headers.get("Authorization"), "Bearer fake-provider-key");
  assert.deepEqual(result.models.map((model) => model.id), ["openai/gpt-4.1", "openai/gpt-4o-mini"]);
  assert.ok(result.unavailable.some((model) => model.providerModelId === "text-embedding-3-large"));
  assert.ok(result.unavailable.some((model) => model.providerModelId === "dall-e-3"));
  assert.ok(result.unavailable.some((model) => model.providerModelId === "babbage-002"));
});

test("Google discovery normalizes official model names and requires text generation", async () => {
  let requestHeaders: Headers | undefined;
  const fetcher: typeof fetch = async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return Response.json({
      models: [
        { name: "models/gemini-2.5-flash", displayName: "Gemini Flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      ],
    });
  };
  const result = await discoverAiModels("google-ai-studio", "fake-google-key", fetcher);
  assert.equal(requestHeaders?.get("x-goog-api-key"), "fake-google-key");
  assert.equal(result.models[0].id, "google-ai-studio/gemini-2.5-flash");
  assert.equal(result.models[0].label, "Gemini Flash");
  assert.equal(result.unavailable[0].providerModelId, "text-embedding-004");
});

test("Anthropic and xAI discovery use their fixed endpoints and provider-specific authentication", async () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const payloads: Record<string, unknown> = {
    "https://api.anthropic.com/v1/models": {
      data: [{ id: "claude-sonnet-4-7", display_name: "Claude Sonnet 4.7" }],
    },
    "https://api.x.ai/v1/models": {
      data: [{ id: "grok-4.1", owned_by: "xai", input_modalities: ["text"], output_modalities: ["text"] }],
    },
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    return Response.json(payloads[url]);
  };
  const anthropic = await discoverAiModels("anthropic", "fake-anthropic-key", fetcher);
  const xai = await discoverAiModels("grok", "fake-xai-key", fetcher);
  assert.equal(anthropic.models[0].id, "anthropic/claude-sonnet-4-7");
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/models");
  assert.equal(calls[0].headers.get("x-api-key"), "fake-anthropic-key");
  assert.equal(calls[0].headers.get("anthropic-version"), "2023-06-01");
  assert.equal(xai.models[0].id, "grok/grok-4.1");
  assert.equal(calls[1].url, "https://api.x.ai/v1/models");
  assert.equal(calls[1].headers.get("Authorization"), "Bearer fake-xai-key");
});

test("provider errors are categorized without exposing raw response details", async () => {
  const fetcher: typeof fetch = async () => new Response("secret error detail", { status: 403 });
  await assert.rejects(
    discoverAiModels("anthropic", "fake-key", fetcher),
    /denied permission to list models/,
  );
  await assert.rejects(
    discoverAiModels("anthropic", "fake-key", async () => new Response("raw detail", { status: 401 })),
    /rejected this API key/,
  );
});

test("dynamic model IDs accept only approved providers and safe model identifiers", () => {
  assert.equal(isValidProviderModelId("anthropic/claude-sonnet-4-7"), true);
  assert.equal(isValidProviderModelId("grok/grok-4.1"), true);
  assert.equal(isValidProviderModelId("attacker.invalid/model"), false);
  assert.equal(isValidProviderModelId("openai/https://attacker.invalid"), false);
  assert.equal(isValidProviderModelId("openai/text-embedding-3-small"), false);
});

test("dynamic runtime config gives discovered models zero platform credit cost", () => {
  const config = getRuntimeAiModelConfig("anthropic/claude-sonnet-4-7");
  assert.equal(config?.provider, "anthropic");
  assert.equal(config?.name, "anthropic/claude-sonnet-4-7");
  assert.equal(config?.creditCost, 0);
  assert.equal(getRuntimeAiModelConfig("attacker.invalid/model"), undefined);
});
