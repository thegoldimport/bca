import { ModelSize, type AIModelConfig } from '../inferutils/config.types';

export const THINK_MODEL_ID = 'google-ai-studio/gemini-3.6-flash';

/** The Gateway compat endpoint routes by provider/model, unlike native APIs. */
export function getThinkTransportModelName(modelId: string, baseURL: string): string {
const pathname = new URL(baseURL).pathname.replace(/\/+$/, '');
if (pathname.endsWith('/compat')) return modelId;
return modelId.slice(modelId.indexOf('/') + 1);
}

export const THINK_MODEL_CONFIG: AIModelConfig = {
	name: 'Gemini 3.6 Flash',
	size: ModelSize.REGULAR,
	provider: 'google-ai-studio',
	creditCost: 2,
	contextSize: 1_048_576,
};
