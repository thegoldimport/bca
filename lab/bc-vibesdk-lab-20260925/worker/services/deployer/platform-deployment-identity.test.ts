import { describe, expect, it, vi } from 'vitest';
import { InFlightLock } from './platform-deployment-identity';

describe('immutable platform deployment in-flight lock', () => {
	it('serializes requests and releases after the operation completes', async () => {
		const lock = new InFlightLock();
		let finishFirst!: () => void;
		const firstOperation = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		const operation = vi.fn(() => firstOperation);

		const first = lock.runExclusive(operation);
		await expect(lock.runExclusive(operation)).resolves.toEqual({ acquired: false });
		expect(operation).toHaveBeenCalledOnce();

		finishFirst();
		await expect(first).resolves.toEqual({ acquired: true, value: undefined });
		await expect(lock.runExclusive(operation)).resolves.toEqual({
			acquired: true,
			value: undefined,
		});
		expect(operation).toHaveBeenCalledTimes(2);
	});

	it('releases the lock when the operation fails', async () => {
		const lock = new InFlightLock();
		const failure = new Error('deployment failed');
		await expect(lock.runExclusive(async () => {
			throw failure;
		})).rejects.toBe(failure);
		await expect(lock.runExclusive(async () => 'retried')).resolves.toEqual({
			acquired: true,
			value: 'retried',
		});
	});
});