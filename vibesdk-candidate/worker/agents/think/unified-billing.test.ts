import { describe, expect, it } from 'vitest';
import { getUnifiedBillingThinkModel, isUnifiedBillingEnabled } from './unified-billing';

const enabledEnv = {
	BUILDCUSTOM_UNIFIED_BILLING: 'true',
	CLOUDFLARE_ACCOUNT_ID: 'account-123',
	CLOUDFLARE_API_TOKEN: 'token-abc',
	CLOUDFLARE_AI_GATEWAY: 'staging-gateway',
};

describe('staging Unified Billing transport', () => {
	it('uses the Cloudflare Workers AI endpoint, catalog model, and bearer auth', () => {
		const model = getUnifiedBillingThinkModel(enabledEnv);

		expect(model.baseURL).toBe(
			'https://api.cloudflare.com/client/v4/accounts/account-123/ai/v1',
		);
		expect(model.modelName).toBe('google/gemini-3.6-flash');
		expect(model.apiKey).toBe('token-abc');
		expect(model.contextSize).toBe(1_048_576);
		expect(model.headers).toEqual({
			'cf-aig-gateway-id': 'staging-gateway',
		});
		expect(model.useStoredKeys).toBe(false);
		expect(model.headers).not.toHaveProperty('cf-aig-authorization');
	});

	it('is isolated behind the exact explicit flag', () => {
		expect(isUnifiedBillingEnabled({ ...enabledEnv, BUILDCUSTOM_UNIFIED_BILLING: 'false' })).toBe(
			false,
		);
		expect(isUnifiedBillingEnabled({ ...enabledEnv, BUILDCUSTOM_UNIFIED_BILLING: '1' })).toBe(
			false,
		);
		expect(isUnifiedBillingEnabled({ ...enabledEnv, BUILDCUSTOM_UNIFIED_BILLING: 'TRUE' })).toBe(
			false,
		);
		expect(() =>
			getUnifiedBillingThinkModel({ ...enabledEnv, BUILDCUSTOM_UNIFIED_BILLING: 'false' }),
		).toThrow('without BUILDCUSTOM_UNIFIED_BILLING=true');
	});

	it.each([
		['CLOUDFLARE_ACCOUNT_ID', { CLOUDFLARE_ACCOUNT_ID: '' }, 'CLOUDFLARE_ACCOUNT_ID'],
		['CLOUDFLARE_API_TOKEN', { CLOUDFLARE_API_TOKEN: '' }, 'CLOUDFLARE_API_TOKEN'],
		['CLOUDFLARE_AI_GATEWAY', { CLOUDFLARE_AI_GATEWAY: '' }, 'CLOUDFLARE_AI_GATEWAY'],
	])('fails closed when %s is missing', (_name, override, expected) => {
		expect(() => getUnifiedBillingThinkModel({ ...enabledEnv, ...override })).toThrow(expected);
	});
});