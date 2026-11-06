import { AI_MODEL_CONFIG, ModelSize, type AIModelConfig, type AIModels } from "../worker/agents/inferutils/config.types";
import { AI_PROVIDER_LABELS, isAiProviderId, isValidProviderModelId } from "./ai-model-discovery";

export type AiProviderOption = {
  id: string;
  label: string;
};

export const AI_PROVIDER_OPTIONS: AiProviderOption[] = Object.entries(AI_PROVIDER_LABELS).map(([id, label]) => ({
  id,
  label,
}));

export const AI_MODEL_OPTIONS = Object.entries(AI_MODEL_CONFIG)
  .filter(([, config]) => isAiProviderId(config.provider))
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

export function isValidAiModelId(modelId: unknown): modelId is string {
  return Boolean(getSupportedAiModel(modelId)) || isValidProviderModelId(modelId);
}

export function getRuntimeAiModelConfig(modelId: string): AIModelConfig | undefined {
  const configured = AI_MODEL_CONFIG[modelId as AIModels];
  if (configured) return configured;
  if (!isValidProviderModelId(modelId)) return undefined;
  const separator = modelId.indexOf("/");
  return {
    name: modelId,
    size: ModelSize.REGULAR,
    provider: modelId.slice(0, separator),
    creditCost: 0,
    contextSize: 32_768,
  };
}
