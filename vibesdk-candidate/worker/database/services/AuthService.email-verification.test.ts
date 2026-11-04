import { describe, expect, it, vi } from 'vitest';
import * as schema from '../schema';
import { AuthService } from './AuthService';

type BoundStatement = {
    sql: string;
    bindings: unknown[];
};

function makeService(user: schema.User | undefined, attempts = 0) {
    let tokenRow: { id: string; userId: string; hash: string; email: string; expiresAt: number } | undefined;
    let tokenUsed = false;
    const sends = vi.fn().mockResolvedValue(undefined);
    const database = {
        select: vi.fn(() => ({
            from: (table: unknown) => ({
                where: () => ({
                    get: async () => table === schema.authAttempts ? { total: attempts } : user,
                }),
            }),
        })),
    };
    const rawDb = {
        prepare(sql: string) {
            const statement: BoundStatement & {
                bind: (...values: unknown[]) => typeof statement;
                first: () => Promise<unknown>;
                run: () => Promise<unknown>;
            } = {
                sql,
                bindings: [],
                bind(...values) {
                    this.bindings = values;
                    return this;
                },
                async first() {
                    if (!sql.startsWith('SELECT id,user_id,email FROM email_verification_tokens')
                        || !tokenRow || tokenUsed || this.bindings[0] !== tokenRow.hash
                        || Number(this.bindings[1]) >= tokenRow.expiresAt) return null;
                    return { id: tokenRow.id, user_id: tokenRow.userId, email: tokenRow.email };
                },
                async run() {
                    if (sql.includes('UPDATE email_verification_tokens SET used=1')) tokenUsed = true;
                    return { meta: { changes: 1 } };
                },
            };
            return statement;
        },
        async batch(statements: BoundStatement[]) {
            const insert = statements.find((statement) =>
                statement.sql.startsWith('INSERT INTO email_verification_tokens'));
            if (insert) {
                tokenRow = {
                    id: String(insert.bindings[0]),
                    userId: String(insert.bindings[1]),
                    hash: String(insert.bindings[2]),
                    email: String(insert.bindings[3]),
                    expiresAt: Number(insert.bindings[4]),
                };
                tokenUsed = false;
                return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
            }
            const canConsume = !!tokenRow && !tokenUsed;
            tokenUsed = tokenUsed || canConsume;
            return [
                { meta: { changes: canConsume ? 1 : 0 } },
                { meta: { changes: canConsume ? 1 : 0 } },
            ];
        },
    };
    const service = Object.assign(Object.create(AuthService.prototype), {
        db: { db: database },
        env: {
            ALLOWED_EMAIL: '',
            DB: rawDb,
            EMAIL: { send: sends },
        },
        logAuthAttempt: vi.fn().mockResolvedValue(undefined),
    }) as AuthService;
    return {
        service,
        sends,
        database,
        get storedTokenHash() { return tokenRow?.hash; },
        get tokenUsed() { return tokenUsed; },
    };
}

const unverifiedUser = {
    id: 'user-1',
    email: 'person@example.com',
    passwordHash: 'stored-hash',
    displayName: 'Person',
    provider: 'email',
    providerId: 'user-1',
    emailVerified: false,
    emailVerifiedAt: null,
    isActive: true,
    isSuspended: false,
    deletedAt: null,
} as schema.User;

const request = new Request('https://app.buildcustom.ai/api/auth/request-verification', {
    headers: { 'CF-Connecting-IP': '203.0.113.10' },
});

describe('AuthService email verification', () => {
    it('sends a short-lived token in the URL fragment and stores only its hash', async () => {
        const test = makeService(unverifiedUser);

        await test.service.requestEmailVerification(unverifiedUser.email, request);

        expect(test.sends).toHaveBeenCalledTimes(1);
        const email = test.sends.mock.calls[0][0] as { text: string };
        expect(email.text).toContain('valid for 15 minutes');
        expect(email.text).toMatch(/\/verify-email#token=/);
        const rawToken = decodeURIComponent(email.text.match(/#token=([^\s]+)/)![1]);
        expect(test.storedTokenHash).toBeDefined();
        expect(test.storedTokenHash === rawToken).toBe(false);
    });

    it('does not send mail for unknown accounts and enforces resend limits', async () => {
        const unknown = makeService(undefined);
        await unknown.service.requestEmailVerification('unknown@example.com', request);
        expect(unknown.sends.mock.calls.length).toBe(0);

        const limited = makeService(unverifiedUser, 3);
        await expect(limited.service.requestEmailVerification(unverifiedUser.email, request))
            .rejects.toThrow('Too many authentication attempts');
        expect(limited.sends.mock.calls.length).toBe(0);
    });

    it('consumes a valid verification token once', async () => {
        const test = makeService(unverifiedUser);
        await test.service.requestEmailVerification(unverifiedUser.email, request);
        const email = test.sends.mock.calls[0][0] as { text: string };
        const token = decodeURIComponent(email.text.match(/#token=([^\s]+)/)![1]);

        await expect(test.service.verifyEmail(token, request)).resolves.toBe(true);
        expect(test.tokenUsed).toBe(true);
        await expect(test.service.verifyEmail(token, request)).resolves.toBe(false);
    });

    it('refuses password login for legacy email flags without a fresh verification timestamp', async () => {
        const test = makeService({
            ...unverifiedUser,
            emailVerified: true,
            emailVerifiedAt: null,
        } as schema.User);
        const createSession = vi.fn();
        Object.assign(test.service, {
            passwordService: { verify: vi.fn().mockResolvedValue(true) },
            sessionService: { createSession },
        });

        await expect(test.service.login({
            email: unverifiedUser.email,
            password: 'StrongPassword123!',
        }, request)).rejects.toThrow('EMAIL_VERIFICATION_REQUIRED');
        expect(createSession.mock.calls.length).toBe(0);
    });
});
