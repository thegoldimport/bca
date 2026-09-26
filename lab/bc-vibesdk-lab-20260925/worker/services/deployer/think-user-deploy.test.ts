import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BranchDeploymentBundle } from '@space-do/space';
import { sanitizeWorkerName } from './think-user-deploy';
import { createImmutablePlatformScriptName } from './platform-deployment-identity';

const deployWithAssets = vi.fn();
const deploySimple = vi.fn();
const enableWorkersDev = vi.fn();
const getWorkersDevSubdomain = vi.fn();
const assertDispatchScriptDoesNotExist = vi.fn().mockResolvedValue(undefined);

vi.mock('./deployer', () => ({
	WorkerDeployer: vi.fn().mockImplementation(() => ({
		deployWithAssets,
		deploySimple,
	})),
}));

vi.mock('./api/cloudflare-api', () => ({
	CloudflareAPI: vi.fn().mockImplementation(() => ({
		assertDispatchScriptDoesNotExist,
		enableWorkersDev,
		getWorkersDevSubdomain,
	})),
}));

// Import after mocks are registered
const { deployThinkBundleToUserAccount, deployThinkBundleToPlatform } = await import('./think-user-deploy');

function makeBundle(overrides?: Partial<BranchDeploymentBundle>): BranchDeploymentBundle {
	return {
		modules: {
			'index.js': 'export class App {}\nexport default { fetch() { return new Response("ok"); } };',
		},
		mainModule: 'index.js',
		assets: { '/index.html': '<html><body>hi</body></html>' },
		assetConfig: {},
		compatibilityDate: '2025-01-01',
		commitHash: 'a'.repeat(40),
		...overrides,
	} as unknown as BranchDeploymentBundle;
}

describe('sanitizeWorkerName', () => {
	it('creates a stable Workers-compatible script name', () => {
		expect(sanitizeWorkerName(' Vibe: My New App! ')).toBe('vibe-my-new-app');
	});

	it('limits names and provides a fallback', () => {
		expect(sanitizeWorkerName('!@#$')).toBe('vibe-app');
		expect(sanitizeWorkerName('A'.repeat(100))).toHaveLength(63);
	});
});

describe('deployThinkBundleToPlatform', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('derives the immutable dispatch identity from agent ID and verified bundle revision', async () => {
		const agentId = '550e8400-e29b-41d4-a716-446655440000';
		const expectedRevision = 'a'.repeat(40);
		const scriptName = await createImmutablePlatformScriptName(agentId, expectedRevision);
		const result = await deployThinkBundleToPlatform({
			accountId: 'platform-account',
			apiToken: 'platform-token',
			dispatchNamespace: 'vibesdk-default-namespace',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: 'My App',
			bundle: makeBundle(),
			immutableRelease: { agentId, expectedRevision },
		});

		expect(result.deploymentId).toBe(scriptName);
		expect(result.deploymentUrl).toBe(`https://${scriptName}.build-preview.cloudflare.dev`);
		expect(assertDispatchScriptDoesNotExist).toHaveBeenCalledWith(
			scriptName,
			'vibesdk-default-namespace',
		);
		expect(deployWithAssets.mock.calls[0][0]).toBe(scriptName);
		expect(assertDispatchScriptDoesNotExist.mock.invocationCallOrder[0])
			.toBeLessThan(deployWithAssets.mock.invocationCallOrder[0]);
		expect(deployWithAssets.mock.calls[0][7]).toBe('vibesdk-default-namespace');
	});

	it.each([
		['malformed expected revision', 'A'.repeat(40), 'A'.repeat(40)],
		['bundle revision mismatch', 'b'.repeat(40), 'a'.repeat(40)],
	] as const)('rejects %s before invoking the uploader', async (_label, expectedRevision, bundleRevision) => {
		await expect(deployThinkBundleToPlatform({
			accountId: 'platform-account',
			apiToken: 'platform-token',
			dispatchNamespace: 'vibesdk-default-namespace',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: 'My App',
			bundle: makeBundle({ commitHash: bundleRevision }),
			immutableRelease: {
				agentId: '550e8400-e29b-41d4-a716-446655440000',
				expectedRevision,
			},
		})).rejects.toThrow(
			expectedRevision === bundleRevision
				? 'Invalid expected commit revision'
				: 'Deployment bundle revision does not match expected revision',
		);

		expect(deployWithAssets).not.toHaveBeenCalled();
	});

	it('refuses an occupied immutable script before invoking the uploader', async () => {
		assertDispatchScriptDoesNotExist.mockRejectedValueOnce(
			new Error('already exists; refusing to overwrite it'),
		);
		await expect(deployThinkBundleToPlatform({
			accountId: 'platform-account',
			apiToken: 'platform-token',
			dispatchNamespace: 'vibesdk-default-namespace',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: 'My App',
			bundle: makeBundle(),
			immutableRelease: {
				agentId: '550e8400-e29b-41d4-a716-446655440000',
				expectedRevision: 'a'.repeat(40),
			},
		})).rejects.toThrow('already exists');

		expect(deployWithAssets).not.toHaveBeenCalled();
		expect(deploySimple).not.toHaveBeenCalled();
	});

	it('isolates same-title apps by agent and revision while staying deterministic', async () => {
		const expectedRevision = 'c'.repeat(40);
		const agentA = '550e8400-e29b-41d4-a716-446655440000';
		const agentB = '550e8400-e29b-41d4-a716-446655440001';
		const sameTitle = 'My App';
		const deploy = (agentId: string, revision = expectedRevision) => deployThinkBundleToPlatform({
			accountId: 'platform-account',
			apiToken: 'platform-token',
			dispatchNamespace: 'vibesdk-default-namespace',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: sameTitle,
			bundle: makeBundle({ commitHash: revision }),
			immutableRelease: { agentId, expectedRevision: revision },
		});

		await deploy(agentA);
		const agentAName = deployWithAssets.mock.calls[0][0];
		await deploy(agentB);
		const agentBName = deployWithAssets.mock.calls[1][0];
		await deploy(agentA);
		const repeatedAgentAName = deployWithAssets.mock.calls[2][0];
		await deploy(agentA, 'd'.repeat(40));
		const newRevisionName = deployWithAssets.mock.calls[3][0];

		expect(agentAName).toMatch(/^bc-r-[a-f0-9]{56}$/);
		expect(agentAName).toHaveLength(61);
		expect(agentBName).not.toBe(agentAName);
		expect(repeatedAgentAName).toBe(agentAName);
		expect(newRevisionName).not.toBe(agentAName);
	});

	it('deploys into the dispatch namespace and returns a preview-domain URL', async () => {
		const result = await deployThinkBundleToPlatform({
			accountId: 'platform-account',
			apiToken: 'platform-token',
			dispatchNamespace: 'vibesdk-default-namespace',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: 'My App',
			bundle: makeBundle(),
		});

		expect(result.deploymentId).toBe('my-app');
		expect(result.deploymentUrl).toBe('https://my-app.build-preview.cloudflare.dev');
		expect(deployWithAssets).toHaveBeenCalledTimes(1);
		expect(assertDispatchScriptDoesNotExist).not.toHaveBeenCalled();
		// dispatchNamespace is the 8th positional arg of deployWithAssets
		expect(deployWithAssets.mock.calls[0][7]).toBe('vibesdk-default-namespace');
		// Platform deploys never touch workers.dev
		expect(enableWorkersDev).not.toHaveBeenCalled();
		expect(getWorkersDevSubdomain).not.toHaveBeenCalled();
	});

	it('falls back to a simple deploy when the bundle has no assets', async () => {
		await deployThinkBundleToPlatform({
			accountId: 'platform-account',
			apiToken: 'platform-token',
			dispatchNamespace: 'vibesdk-default-namespace',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: 'My App',
			bundle: makeBundle({ assets: {} }),
		});

		expect(deploySimple).toHaveBeenCalledTimes(1);
		// dispatchNamespace is the 6th positional arg of deploySimple
		expect(deploySimple.mock.calls[0][5]).toBe('vibesdk-default-namespace');
		expect(deployWithAssets).not.toHaveBeenCalled();
	});
});

describe('deployThinkBundleToUserAccount', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getWorkersDevSubdomain.mockResolvedValue('user-sub');
	});

	it('deploys without a dispatch namespace and enables workers.dev', async () => {
		const result = await deployThinkBundleToUserAccount({
			accountId: 'user-account',
			accessToken: 'user-token',
			appName: 'My App',
			bundle: makeBundle(),
		});

		expect(deployWithAssets).toHaveBeenCalledTimes(1);
		expect(deployWithAssets.mock.calls[0][7]).toBeUndefined();
		expect(enableWorkersDev).toHaveBeenCalledWith('my-app');
		expect(result.deploymentUrl).toBe('https://my-app.user-sub.workers.dev');
	});
});
