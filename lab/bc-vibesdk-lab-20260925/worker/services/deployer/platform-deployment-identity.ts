const COMMIT_REVISION = /^[a-f0-9]{40}$/;

export class InFlightLock {
	private inFlight = false;

	async runExclusive<T>(
		operation: () => Promise<T>,
	): Promise<{ acquired: true; value: T } | { acquired: false }> {
		if (this.inFlight) return { acquired: false };
		this.inFlight = true;
		try {
			return { acquired: true, value: await operation() };
		} finally {
			this.inFlight = false;
		}
	}
}

export function isCommitRevision(value: unknown): value is string {
	return typeof value === 'string' && COMMIT_REVISION.test(value);
}

export async function createImmutablePlatformScriptName(
	agentId: string,
	commitHash: string,
): Promise<string> {
	if (!agentId || !isCommitRevision(commitHash)) {
		throw new Error('Immutable platform deployment requires an agent ID and a 40-character lowercase commit revision');
	}
	const input = new TextEncoder().encode(`${agentId.toLowerCase()}:${commitHash.toLowerCase()}`);
	const digest = await crypto.subtle.digest('SHA-256', input);
	const digestHex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `bc-r-${digestHex.slice(0, 56)}`;
}