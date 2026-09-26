import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BranchDeploymentBundle } from '@space-do/space';
import { deployThinkBundleToPlatform } from './think-user-deploy';
import { createImmutablePlatformScriptName } from './platform-deployment-identity';

const REVISION = 'a'.repeat(40);
const CLOUDFLARE_MIGRATION_ERROR = JSON.stringify({
	errors: [{ code: 10074, message: "class 'App' already exists" }],
});

function makeBundle(withAssets = false): BranchDeploymentBundle {
	return {
		modules: {
			'index.js': 'export class App {}\nexport default { fetch() { return new Response("ok"); } };',
		},
		mainModule: 'index.js',
		assets: withAssets ? { '/index.html': '<html>immutable</html>' } : {},
		assetConfig: {},
		compatibilityDate: '2025-01-01',
		commitHash: REVISION,
	} as unknown as BranchDeploymentBundle;
}

function mockFetchForMigrationError() {
	let putCount = 0;
	const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
		if (init?.method === 'GET') {
			return new Response(null, { status: 404 });
		}
		if (init?.method === 'POST') {
			return new Response(JSON.stringify({ result: { jwt: 'asset-jwt', buckets: [] } }), {
				status: 200,
			});
		}
		if (init?.method === 'PUT') {
			putCount += 1;
			return putCount === 1
				? new Response(CLOUDFLARE_MIGRATION_ERROR, { status: 400 })
				: new Response(null, { status: 200 });
		}
		throw new Error(`Unexpected Cloudflare request method: ${String(init?.method)}`);
	});
	vi.stubGlobal('fetch', fetchMock);
	return { fetchMock, getPutCount: () => putCount };
}

describe('immutable script PUT retry policy', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('issues exactly one script PUT on immutable publish and returns the full Cloudflare error', async () => {
		const { fetchMock, getPutCount } = mockFetchForMigrationError();

		await expect(deployThinkBundleToPlatform({
			accountId: 'account-1',
			apiToken: 'token-1',
			dispatchNamespace: 'namespace-1',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: 'My App',
			bundle: makeBundle(),
			immutableRelease: {
				agentId: '550e8400-e29b-41d4-a716-446655440000',
				expectedRevision: REVISION,
			},
		})).rejects.toThrow(`Failed to deploy worker: 400 - ${CLOUDFLARE_MIGRATION_ERROR}`);

		expect(getPutCount()).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('also disables script PUT retries through the asset uploader path', async () => {
		const { fetchMock, getPutCount } = mockFetchForMigrationError();

		await expect(deployThinkBundleToPlatform({
			accountId: 'account-1',
			apiToken: 'token-1',
			dispatchNamespace: 'namespace-1',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: 'My App',
			bundle: makeBundle(true),
			immutableRelease: {
				agentId: '550e8400-e29b-41d4-a716-446655440000',
				expectedRevision: REVISION,
			},
		})).rejects.toThrow(`Failed to deploy worker: 400 - ${CLOUDFLARE_MIGRATION_ERROR}`);

		expect(getPutCount()).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('keeps legacy platform migration retry behavior', async () => {
		const { fetchMock, getPutCount } = mockFetchForMigrationError();

		await expect(deployThinkBundleToPlatform({
			accountId: 'account-1',
			apiToken: 'token-1',
			dispatchNamespace: 'namespace-1',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: 'My App',
			bundle: makeBundle(),
		})).resolves.toMatchObject({ deploymentId: 'my-app' });

		expect(getPutCount()).toBe(2);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('allows an HTTP 200 preflight response with matching namespace and no script', async () => {
		const agentId = '550e8400-e29b-41d4-a716-446655440000';
		const scriptName = await createImmutablePlatformScriptName(agentId, REVISION);
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'GET') {
				return new Response(JSON.stringify({
					success: true,
					result: { dispatch_namespace: { name: 'namespace-1' } },
				}), { status: 200 });
			}
			if (init?.method === 'PUT') return new Response(null, { status: 200 });
			throw new Error(`Unexpected Cloudflare request method: ${String(init?.method)}`);
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(deployThinkBundleToPlatform({
			accountId: 'account-1',
			apiToken: 'token-1',
			dispatchNamespace: 'namespace-1',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: 'My App',
			bundle: makeBundle(),
			immutableRelease: { agentId, expectedRevision: REVISION },
		})).resolves.toMatchObject({ deploymentId: scriptName });

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'PUT']);
	});

	it.each(['occupied script', 'malformed success', 'server error'] as const)(
		'does not upload on preflight %s',
		async (scenario) => {
			const agentId = '550e8400-e29b-41d4-a716-446655440000';
			const scriptName = await createImmutablePlatformScriptName(agentId, REVISION);
			const status = scenario === 'server error' ? 500 : 200;
			const payload = scenario === 'occupied script'
				? {
					success: true,
					result: {
						dispatch_namespace: { name: 'namespace-1' },
						script: { id: scriptName },
					},
				}
				: scenario === 'malformed success'
					? { success: true, result: {} }
					: { success: false };
			const fetchMock = vi.fn().mockResolvedValue(
				new Response(JSON.stringify(payload), { status }),
			);
			vi.stubGlobal('fetch', fetchMock);

			await expect(deployThinkBundleToPlatform({
				accountId: 'account-1',
				apiToken: 'token-1',
				dispatchNamespace: 'namespace-1',
				previewDomain: 'build-preview.cloudflare.dev',
				appName: 'My App',
				bundle: makeBundle(),
				immutableRelease: { agentId, expectedRevision: REVISION },
			})).rejects.toThrow();

			expect(fetchMock).toHaveBeenCalledOnce();
			expect(fetchMock.mock.calls[0][0]).toContain(`/scripts/${scriptName}`);
			expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
		},
	);
});