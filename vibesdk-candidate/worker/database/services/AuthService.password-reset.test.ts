import { describe, expect, it, vi } from 'vitest';
import * as schema from '../schema';
import { AuthService } from './AuthService';

function makeService(user: schema.User | undefined, send: ReturnType<typeof vi.fn>) {
    const deliveries: Promise<unknown>[] = [];
    let insertedToken: Record<string, unknown> | undefined;
    let tokenInvalidated = false;

    const database = {
        select: vi.fn(() => ({
            from: (table: unknown) => ({
                where: () => ({
                    get: async () => table === schema.authAttempts ? { total: 0 } : user
                })
            })
        })),
        update: vi.fn(() => ({
            set: (values: { used?: boolean }) => ({
                where: async () => {
                    if (values.used) tokenInvalidated = true;
                }
            })
        })),
        insert: vi.fn(() => ({
            values: async (values: Record<string, unknown>) => {
                insertedToken = values;
            }
        }))
    };
    const env = { EMAIL: { send } } as unknown as Env;
    const service = Object.assign(Object.create(AuthService.prototype), {
        db: { db: database },
        env,
        logAuthAttempt: vi.fn().mockResolvedValue(undefined)
    }) as AuthService;
    const context = {
        waitUntil: vi.fn((promise: Promise<unknown>) => deliveries.push(promise))
    } as unknown as ExecutionContext;

    return {
        service,
        context,
        deliveries,
        database,
        get insertedToken() { return insertedToken; },
        get tokenInvalidated() { return tokenInvalidated; }
    };
}

describe('AuthService.requestPasswordReset', () => {
    it('does not disclose a failed email delivery and invalidates the undelivered token', async () => {
        const send = vi.fn().mockRejectedValue(new Error('provider rejection'));
        const test = makeService({
            id: 'user-1',
            email: 'person@example.com',
            passwordHash: 'existing-password-hash',
            displayName: 'Person',
            provider: 'email',
            providerId: 'user-1',
            isActive: true,
            deletedAt: null
        } as schema.User, send);

        await expect(
            test.service.requestPasswordReset('person@example.com', new Request('https://app.example/'), test.context)
        ).resolves.toBeUndefined();
        await expect(test.deliveries[0]).resolves.toBeUndefined();

        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            from: { email: 'security@buildcustom.ai', name: 'BuildCustom' },
            to: 'person@example.com',
            text: expect.stringContaining('valid for 60 minutes'),
            html: expect.stringContaining('valid for 60 minutes')
        }));
        expect(test.insertedToken).toMatchObject({ used: false, userId: 'user-1' });
        expect(test.tokenInvalidated).toBe(true);
    });

    it('queues no email for an unknown address while returning normally', async () => {
        const send = vi.fn();
        const test = makeService(undefined, send);

        await expect(
            test.service.requestPasswordReset('unknown@example.com', new Request('https://app.example/'), test.context)
        ).resolves.toBeUndefined();
        await expect(test.deliveries[0]).resolves.toBeUndefined();
        expect(send).not.toHaveBeenCalled();
        expect(test.insertedToken).toBeUndefined();
    });
});