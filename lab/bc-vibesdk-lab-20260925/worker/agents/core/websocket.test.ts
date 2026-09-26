import { describe, expect, it, vi } from 'vitest';
import { handleWebSocketMessage } from './websocket';

const EXPECTED_REVISION = 'a'.repeat(40);

function setup(behaviorType = 'think', userAccountDeploy = false) {
	const deployToCloudflare = vi.fn().mockResolvedValue({
		deploymentUrl: 'https://verified.example/',
	});
	const sent: string[] = [];
	const agent = {
		state: { behaviorType },
		env: { ENABLE_USER_ACCOUNT_DEPLOY: userAccountDeploy ? 'true' : 'false' },
		deployToCloudflare,
	} as any;
	const connection = {
		id: 'test-connection',
		send(value: string) {
			sent.push(value);
		},
	} as any;
	return { agent, connection, deployToCloudflare, sent };
}

async function sendDeploy(
	fixture: ReturnType<typeof setup>,
	message: Record<string, unknown>,
) {
	await handleWebSocketMessage(fixture.agent, fixture.connection, JSON.stringify({
		type: 'deploy',
		...message,
	}));
}

describe('platform immutable-release deploy WebSocket', () => {
	it('forwards an expected revision only to explicit Think platform deployment', async () => {
		const fixture = setup();
		await sendDeploy(fixture, {
			target: 'platform',
			immutableRelease: true,
			expectedRevision: EXPECTED_REVISION,
		});
		expect(fixture.deployToCloudflare).toHaveBeenCalledOnce();
		expect(fixture.deployToCloudflare).toHaveBeenCalledWith('platform', {
			immutableRelease: true,
			expectedRevision: EXPECTED_REVISION,
		});
		expect(fixture.sent).toEqual([]);
	});

	it.each([
		['missing platform target', { immutableRelease: true, expectedRevision: EXPECTED_REVISION }],
		['user target', { target: 'user', immutableRelease: true, expectedRevision: EXPECTED_REVISION }],
		['invalid revision', { target: 'platform', immutableRelease: true, expectedRevision: 'A'.repeat(40) }],
		['short revision', { target: 'platform', immutableRelease: true, expectedRevision: 'a'.repeat(39) }],
		['missing revision', { target: 'platform', immutableRelease: true }],
		['missing opt-in', { target: 'platform', expectedRevision: EXPECTED_REVISION }],
		['false opt-in', { target: 'platform', immutableRelease: false, expectedRevision: EXPECTED_REVISION }],
	] as const)('rejects %s before invoking deploy', async (_label, request) => {
		const fixture = setup();
		await sendDeploy(fixture, request);
		expect(fixture.deployToCloudflare).not.toHaveBeenCalled();
		expect(JSON.parse(fixture.sent[0]).type).toBe('error');
	});

	it('rejects every caller-supplied scriptName, even a plausible one', async () => {
		const fixture = setup();
		await sendDeploy(fixture, {
			target: 'platform',
			scriptName: `bc-r-${'b'.repeat(56)}`,
		});
		expect(fixture.deployToCloudflare).not.toHaveBeenCalled();
		expect(JSON.parse(fixture.sent[0]).type).toBe('error');
	});

	it('rejects a scriptName even when a valid immutable release is also requested', async () => {
		const fixture = setup();
		await sendDeploy(fixture, {
			target: 'platform',
			scriptName: `bc-r-${'b'.repeat(56)}`,
			immutableRelease: true,
			expectedRevision: EXPECTED_REVISION,
		});
		expect(fixture.deployToCloudflare).not.toHaveBeenCalled();
		expect(JSON.parse(fixture.sent[0]).type).toBe('error');
	});

	it('rejects immutable release requests for non-Think agents', async () => {
		const fixture = setup('agentic');
		await sendDeploy(fixture, {
			target: 'platform',
			immutableRelease: true,
			expectedRevision: EXPECTED_REVISION,
		});
		expect(fixture.deployToCloudflare).not.toHaveBeenCalled();
		expect(JSON.parse(fixture.sent[0]).type).toBe('error');
	});

	it('rejects immutable release requests when user-account deploy is enabled', async () => {
		const fixture = setup('think', true);
		await sendDeploy(fixture, {
			target: 'platform',
			immutableRelease: true,
			expectedRevision: EXPECTED_REVISION,
		});
		expect(fixture.deployToCloudflare).not.toHaveBeenCalled();
		expect(JSON.parse(fixture.sent[0]).type).toBe('error');
	});

	it('preserves default Think user deployment without immutable release', async () => {
		const fixture = setup();
		await sendDeploy(fixture, {});
		expect(fixture.deployToCloudflare).toHaveBeenCalledOnce();
		expect(fixture.deployToCloudflare).toHaveBeenCalledWith('user');
		expect(fixture.sent).toEqual([]);
	});
});