import { describe, expect, it, vi } from 'vitest';
import * as schema from '../schema';
import { AuthService } from './AuthService';

function makeService(
    user: schema.User | undefined,
    send: ReturnType<typeof vi.fn>,
    authAttemptReadError?: Error
) {
    const deliveries: Promise<unknown>[] = [];
    let insertedToken: Record<string, unknown> | undefined;
    let tokenInvalidated = false;

    const database = {
        select: vi.fn(() => ({
            from: (table: unknown) => ({
                where: () => ({
                    get: async () => {
                        if (table === schema.authAttempts && authAttemptReadError) throw authAttemptReadError;
                        return table === schema.authAttempts ? { total: 0 } : user;
                    }
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
            text: expect.stringContaining('valid for 15 minutes'),
            html: expect.stringContaining('valid for 15 minutes')
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

    it('logs only a fixed diagnostic code when the reset rate-limit read fails', async () => {
        const internalError = new Error('sensitive database detail');
        const email = 'person@example.com';
        const test = makeService(undefined, vi.fn(), internalError);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            await expect(test.service.requestPasswordReset(
                email,
                new Request('https://app.example/'),
                test.context
            )).rejects.toBe(internalError);

            const output = JSON.stringify(log.mock.calls);
            expect(output).toContain('AUTH_DIAG_PASSWORD_RESET_RATE_LIMIT_READ');
            expect(output).not.toContain(email);
            expect(output).not.toContain('sensitive database detail');
            expect(test.context.waitUntil).not.toHaveBeenCalled();
        } finally {
            log.mockRestore();
        }
    });

    it('preserves the reset error if the diagnostic sink throws', async () => {
        const internalError = new Error('database failure');
        const test = makeService(undefined, vi.fn(), internalError);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {
            throw new Error('log sink failure');
        });

        try {
            await expect(test.service.requestPasswordReset(
                'person@example.com',
                new Request('https://app.example/'),
                test.context
            )).rejects.toBe(internalError);
        } finally {
            log.mockRestore();
        }
    });
});