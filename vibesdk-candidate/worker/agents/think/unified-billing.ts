import type { ThinkAgentConfig } from './ThinkAgent';

const UNIFIED_BILLING_MODEL = 'google/gemini-3.6-flash';

type UnifiedBillingEnv = {
	BUILDCUSTOM_UNIFIED_BILLING?: string;
	CLOUDFLARE_ACCOUNT_ID?: string;
	CLOUDFLARE_API_TOKEN?: string;
	CLOUDFLARE_AI_GATEWAY?: string;
};

/** The staging-only switch is deliberately opt-in; all other routing is unchanged. */
export function isUnifiedBillingEnabled(env: UnifiedBillingEnv): boolean {
	return env.BUILDCUSTOM_UNIFIED_BILLING === 'true';
}

/**
 * Build the direct Cloudflare Workers AI OpenAI-compatible coordinates.
 *
 * This is intentionally separate from getConfigurationForModel: Unified Billing
 * must not resolve (or forward) a Google key or an AI Gateway stored-key header.
 */
export function getUnifiedBillingThinkModel(env: UnifiedBillingEnv): ThinkAgentConfig['model'] {
	if (!isUnifiedBillingEnabled(env)) {
		throw new Error('Unified Billing transport requested without BUILDCUSTOM_UNIFIED_BILLING=true');
	}

	const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
	const token = env.CLOUDFLARE_API_TOKEN?.trim();
	const gatewayId = env.CLOUDFLARE_AI_GATEWAY?.trim();
	if (!accountId) throw new Error('BUILDCUSTOM_UNIFIED_BILLING requires CLOUDFLARE_ACCOUNT_ID');
	if (!token) throw new Error('BUILDCUSTOM_UNIFIED_BILLING requires CLOUDFLARE_API_TOKEN');
	if (!gatewayId) throw new Error('BUILDCUSTOM_UNIFIED_BILLING requires CLOUDFLARE_AI_GATEWAY');

	return {
		baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
		apiKey: token,
		modelName: UNIFIED_BILLING_MODEL,
		contextSize: 1_048_576,
		headers: {
			'cf-aig-gateway-id': gatewayId,
		},
		useStoredKeys: false,
	};
}