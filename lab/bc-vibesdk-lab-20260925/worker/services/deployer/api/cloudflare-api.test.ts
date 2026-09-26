import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareAPI } from './cloudflare-api';

const SCRIPT_NAME = `bc-r-${'a'.repeat(56)}`;
const NAMESPACE = 'namespace-1';

function lookupResponse(result: unknown, status = 200): Response {
	return new Response(JSON.stringify({ success: true, result }), { status });
}

describe('CloudflareAPI immutable dispatch preflight', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('treats authoritative 404 as an available script identity', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(new CloudflareAPI('account-1', 'token-1')
			.assertDispatchScriptDoesNotExist(SCRIPT_NAME, NAMESPACE))
			.resolves.toBeUndefined();

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledWith(
			`https://api.cloudflare.com/client/v4/accounts/account-1/workers/dispatch/namespaces/${NAMESPACE}/scripts/${SCRIPT_NAME}`,
			{ method: 'GET', headers: { Authorization: 'Bearer token-1' } },
		);
	});

	it('treats HTTP 200 with matching namespace metadata and no script as available', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(lookupResponse({
			dispatch_namespace: { name: NAMESPACE },
		})));

		await expect(new CloudflareAPI('account-1', 'token-1')
			.assertDispatchScriptDoesNotExist(SCRIPT_NAME, NAMESPACE))
			.resolves.toBeUndefined();
	});

	it('rejects HTTP 200 when the requested script exists', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(lookupResponse({
			dispatch_namespace: { name: NAMESPACE },
			script: { id: SCRIPT_NAME },
		})));

		await expect(new CloudflareAPI('account-1', 'token-1')
			.assertDispatchScriptDoesNotExist(SCRIPT_NAME, NAMESPACE))
			.rejects.toThrow('already exists; refusing to overwrite it');
	});

	it.each([
		['missing namespace metadata', { dispatch_namespace: null }],
		['namespace mismatch', { dispatch_namespace: { name: 'other-namespace' } }],
		['unexpected script metadata', {
			dispatch_namespace: { name: NAMESPACE },
			script: { id: 'some-other-script' },
		}],
	] as const)('fails closed on malformed success response: %s', async (_label, result) => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(lookupResponse(result)));

		await expect(new CloudflareAPI('account-1', 'token-1')
			.assertDispatchScriptDoesNotExist(SCRIPT_NAME, NAMESPACE))
			.rejects.toThrow('Could not verify immutable dispatch script');
	});

	it('fails closed on unexpected HTTP 500 status', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

		await expect(new CloudflareAPI('account-1', 'token-1')
			.assertDispatchScriptDoesNotExist(SCRIPT_NAME, NAMESPACE))
			.rejects.toThrow('unexpected status 500');
	});

	it('fails closed on malformed JSON and oversized responses', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce(new Response('{not-json', { status: 200 }))
			.mockResolvedValueOnce(new Response('x'.repeat(16 * 1024 + 1), { status: 200 })));

		const api = new CloudflareAPI('account-1', 'token-1');
		await expect(api.assertDispatchScriptDoesNotExist(SCRIPT_NAME, NAMESPACE))
			.rejects.toThrow('Could not verify immutable dispatch script response');
		await expect(api.assertDispatchScriptDoesNotExist(SCRIPT_NAME, NAMESPACE))
			.rejects.toThrow('Response exceeds');
	});

	it('fails closed on network errors', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));

		await expect(new CloudflareAPI('account-1', 'token-1')
			.assertDispatchScriptDoesNotExist(SCRIPT_NAME, NAMESPACE))
			.rejects.toThrow('network unavailable');
	});
});