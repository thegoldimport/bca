import { AI_MODEL_CONFIG } from "../vibesdk-candidate/worker/agents/inferutils/config.types";

const PROVIDER_LABELS: Record<string, string> = {
  "google-ai-studio": "Google AI Studio",
  openai: "OpenAI",
  anthropic: "Anthropic",
  grok: "xAI",
};

export type AiProviderOption = {
  id: string;
  label: string;
};

export const AI_PROVIDER_OPTIONS: AiProviderOption[] = Object.keys(PROVIDER_LABELS).map((id) => ({
  id,
  label: PROVIDER_LABELS[id],
}));

export const AI_MODEL_OPTIONS = Object.entries(AI_MODEL_CONFIG)
  .filter(([, config]) => Object.hasOwn(PROVIDER_LABELS, config.provider))
  .map(([id, config]) => ({
    id,
    label: config.name,
    provider: config.provider,
  }))
  .sort((left, right) =>
    left.provider.localeCompare(right.provider) || left.label.localeCompare(right.label),
  );

export function getSupportedAiModel(modelId: unknown): (typeof AI_MODEL_OPTIONS)[number] | null {
  if (typeof modelId !== "string") return null;
  return AI_MODEL_OPTIONS.find((model) => model.id === modelId) ?? null;
}
