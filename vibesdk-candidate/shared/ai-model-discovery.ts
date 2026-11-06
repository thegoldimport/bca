export type AiProviderId = "anthropic" | "openai" | "google-ai-studio" | "grok";

export type DiscoveredAiModel = {
  id: string;
  provider: AiProviderId;
  providerModelId: string;
  label: string;
};

export type UnavailableAiModel = {
  providerModelId: string;
  label: string;
  reason: string;
};

export type AiModelDiscoveryResult = {
  models: DiscoveredAiModel[];
  unavailable: UnavailableAiModel[];
};

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "google-ai-studio": "Google AI Studio",
  grok: "xAI",
};

const PROVIDER_API: Record<AiProviderId, { url: string; headers: (key: string) => HeadersInit }> = {
  openai: {
    url: "https://api.openai.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  "google-ai-studio": {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: (key) => ({ "x-goog-api-key": key }),
  },
  grok: {
    url: "https://api.x.ai/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
};

const EXCLUDED_MODEL_ID = /(?:embedding|dall[-_ ]?e|imagen|veo|whisper|text-to-speech|speech|transcri(?:be|ption)|moderation|image[-_ ]?(?:gen|generation)|audio|realtime|computer[-_ ]?use|sora)/i;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

type ProviderModel = Record<string, unknown> & {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  displayName?: unknown;
  supportedGenerationMethods?: unknown;
  input_modalities?: unknown;
  output_modalities?: unknown;
  modalities?: unknown;
  created?: unknown;
  created_at?: unknown;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function modelArray(provider: AiProviderId, payload: unknown): ProviderModel[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const value = provider === "google-ai-studio" ? record.models : record.data;
  return Array.isArray(value)
    ? value.filter((item): item is ProviderModel => Boolean(item) && typeof item === "object")
    : [];
}

function providerModelId(provider: AiProviderId, model: ProviderModel): string | null {
  const raw = stringValue(provider === "google-ai-studio" ? model.name : model.id);
  if (!raw) return null;
  const normalized = provider === "google-ai-studio" ? raw.replace(/^models\//, "") : raw;
  if (!MODEL_ID_PATTERN.test(normalized) || normalized.includes("://") || normalized.includes("..")) return null;
  return normalized;
}

function explicitTextCapability(model: ProviderModel): boolean | null {
  const generationMethods = model.supportedGenerationMethods;
  if (Array.isArray(generationMethods)) {
    return generationMethods.includes("generateContent");
  }

  const input = model.input_modalities ?? model.modalities;
  const output = model.output_modalities ?? model.modalities;
  if (Array.isArray(input) && input.length > 0 && !input.some((item) => String(item).toLowerCase() === "text")) {
    return false;
  }
  if (Array.isArray(output) && output.length > 0 && !output.some((item) => String(item).toLowerCase() === "text")) {
    return false;
  }
  return null;
}

function modelDisplayName(provider: AiProviderId, model: ProviderModel, modelId: string): string {
  const display = stringValue(provider === "anthropic" ? model.display_name : model.displayName);
  return display && display.length <= 160 ? display : modelId;
}

function runtimeCompatibilityReason(
  provider: AiProviderId,
  model: ProviderModel,
  modelId: string,
): string | null {
  if (EXCLUDED_MODEL_ID.test(modelId)) {
    return "Image, audio, embedding, and other non-chat models are not supported by the coding agent.";
  }
  if (explicitTextCapability(model) === false) {
    return "The provider identifies this model as having no text capability.";
  }
  if (provider === "google-ai-studio") {
    if (!Array.isArray(model.supportedGenerationMethods)
      || !model.supportedGenerationMethods.includes("generateContent")
      || !/^gemini-/i.test(modelId)) {
      return "This model has not been verified for the Gemini text-generation adapter.";
    }
    return null;
  }
  if (provider === "anthropic") {
    return /^claude-/i.test(modelId)
      ? null
      : "This model has not been verified for the Anthropic chat adapter.";
  }
  if (provider === "openai") {
    return /^(?:gpt-|o[1-9](?:-|$)|chatgpt-)/i.test(modelId)
      ? null
      : "This model has not been verified for the OpenAI chat-completions adapter.";
  }
  return /^grok-/i.test(modelId)
    ? null
    : "This model has not been verified for the xAI chat-completions adapter.";
}

function sortModels(models: Array<{ item: ProviderModel; model: DiscoveredAiModel }>): void {
  models.sort((left, right) => {
    const leftCreated = typeof left.item.created === "number"
      ? left.item.created
      : Date.parse(stringValue(left.item.created_at) || "");
    const rightCreated = typeof right.item.created === "number"
      ? right.item.created
      : Date.parse(stringValue(right.item.created_at) || "");
    const a = Number.isFinite(leftCreated) ? leftCreated : 0;
    const b = Number.isFinite(rightCreated) ? rightCreated : 0;
    if (a !== b) return b - a;
    return right.model.providerModelId.localeCompare(left.model.providerModelId);
  });
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && Object.hasOwn(AI_PROVIDER_LABELS, value);
}

export function isValidProviderModelId(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 256) return false;
  const separator = value.indexOf("/");
  if (separator <= 0) return false;
  const provider = value.slice(0, separator);
  const modelId = value.slice(separator + 1);
  return isAiProviderId(provider)
    && MODEL_ID_PATTERN.test(modelId)
    && !modelId.includes("://")
    && !modelId.includes("..")
    && !EXCLUDED_MODEL_ID.test(modelId)
    && (provider === "google-ai-studio" ? /^gemini-/i.test(modelId)
      : provider === "anthropic" ? /^claude-/i.test(modelId)
        : provider === "openai" ? /^(?:gpt-|o[1-9](?:-|$)|chatgpt-)/i.test(modelId)
          : /^grok-/i.test(modelId));
}

export function aiProviderLabel(value: string): string {
  return isAiProviderId(value) ? AI_PROVIDER_LABELS[value] : value;
}

export async function discoverAiModels(
  provider: AiProviderId,
  apiKey: string,
  providerFetch: typeof fetch = fetch,
): Promise<AiModelDiscoveryResult> {
  const config = PROVIDER_API[provider];
  let response: Response;
  try {
    response = await providerFetch(config.url, {
      method: "GET",
      headers: config.headers(apiKey),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error("The provider’s model list could not be reached. Check your connection and try again.");
  }

  if (!response.ok) {
    if (response.status === 401) throw new Error("The provider rejected this API key. Check whether it is valid, active, and copied correctly.");
    if (response.status === 403) throw new Error("The provider denied permission to list models. Check this key’s account or model-list access.");
    if (response.status === 400) throw new Error("The provider rejected the model-list request. Check the key and provider account settings.");
    if (response.status === 429) {
      throw new Error("The provider is rate-limiting model-list requests. Wait a moment and try again.");
    }
    if (response.status >= 500) {
      throw new Error("The provider’s model service is temporarily unavailable. Try again later.");
    }
    throw new Error(`The provider could not list models (HTTP ${response.status}).`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The provider returned an unreadable model list. Try again later.");
  }

  const available: Array<{ item: ProviderModel; model: DiscoveredAiModel }> = [];
  const unavailable: UnavailableAiModel[] = [];
  for (const item of modelArray(provider, payload).slice(0, 500)) {
    const rawId = stringValue(provider === "google-ai-studio" ? item.name : item.id);
    if (!rawId) continue;
    const modelId = providerModelId(provider, item);
    const unsupportedReason = modelId
      ? runtimeCompatibilityReason(provider, item, modelId)
      : "The provider returned a model identifier that is not safe to use.";
    if (!modelId || unsupportedReason) {
      if (
        unavailable.length < 100
        && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(rawId)
        && !rawId.includes("://")
      ) {
        unavailable.push({
          providerModelId: provider === "google-ai-studio" ? rawId.replace(/^models\//, "") : rawId,
          label: stringValue(item.display_name) || stringValue(item.displayName) || rawId,
          reason: unsupportedReason || "This model is not compatible with BuildCustom’s coding agent.",
        });
      }
      continue;
    }
    available.push({
      item,
      model: {
        id: `${provider}/${modelId}`,
        provider,
        providerModelId: modelId,
        label: modelDisplayName(provider, item, modelId),
      },
    });
  }

  sortModels(available);
  if (available.length === 0) {
    throw new Error("The key was accepted, but no compatible text model was found for this account.");
  }
  return { models: available.map(({ model }) => model), unavailable };
}
