import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { SQLiteDialect } from 'drizzle-orm/sqlite-core';
import * as schema from '../schema';
import { AuthService, authAttemptWindowCondition } from './AuthService';

type BoundStatement = {
    sql: string;
    bindings: unknown[];
};

function makeService(
    user: schema.User | undefined,
    attempts: number | number[] = 0,
    authAttemptReadError?: Error
) {
    let tokenRow: { id: string; userId: string; hash: string; email: string; expiresAt: number } | undefined;
    let tokenUsed = false;
    let authAttemptReads = 0;
    const sends = vi.fn().mockResolvedValue(undefined);
    const database = {
        select: vi.fn(() => ({
            from: (table: unknown) => ({
                where: () => ({
                    get: async () => {
                        if (table !== schema.authAttempts) return user;
                        if (authAttemptReadError) throw authAttemptReadError;
                        const total = Array.isArray(attempts) ? attempts[authAttemptReads] ?? 0 : attempts;
                        authAttemptReads += 1;
                        return { total };
                    },
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
        get authAttemptReads() { return authAttemptReads; },
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

    it('uses a real 15-minute window for text and numeric D1 timestamps', async () => {
        const database = (env as unknown as { AUTH_TEST_DB: D1Database }).AUTH_TEST_DB;
        await database.prepare('DROP TABLE IF EXISTS auth_attempts').run();
        await database.prepare('CREATE TABLE auth_attempts (attempted_at INTEGER)').run();
        try {
            const insert = database.prepare('INSERT INTO auth_attempts (attempted_at) VALUES (?)');
            await insert.bind('2026-11-04 16:00:00').run();
            await insert.bind('2026-11-04 16:20:00').run();
            await insert.bind(Math.floor(Date.parse('2026-11-04T16:00:00Z') / 1000)).run();
            await insert.bind(Math.floor(Date.parse('2026-11-04T16:20:00Z') / 1000)).run();

            const condition = new SQLiteDialect().sqlToQuery(
                authAttemptWindowCondition(new Date('2026-11-04T16:15:00Z'))
            );
            const result = await database.prepare(
                `SELECT count(*) AS total FROM auth_attempts WHERE ${condition.sql}`
            ).bind(...condition.params as number[]).first<{ total: number }>();

            expect(result?.total).toBe(2);
        } finally {
            await database.prepare('DROP TABLE IF EXISTS auth_attempts').run();
        }
    });

    it('allows valid credentials to reach email verification when the IP is unknown', async () => {
        const test = makeService(unverifiedUser, [0, 282]);
        const verify = vi.fn().mockResolvedValue(true);
        const createSession = vi.fn();
        Object.assign(test.service, {
            passwordService: { verify },
            sessionService: { createSession },
        });

        await expect(test.service.login({
            email: unverifiedUser.email,
            password: 'StrongPassword123!',
        }, new Request('https://app.buildcustom.ai/api/auth/login')))
            .rejects.toThrow('EMAIL_VERIFICATION_REQUIRED');

        expect(test.authAttemptReads).toBe(1);
        expect(verify).toHaveBeenCalledOnce();
        expect(createSession).not.toHaveBeenCalled();
    });

    it('still enforces the per-account login limit when the IP is unknown', async () => {
        const test = makeService(unverifiedUser, 10);
        const verify = vi.fn().mockResolvedValue(true);
        Object.assign(test.service, { passwordService: { verify } });

        await expect(test.service.login({
            email: unverifiedUser.email,
            password: 'StrongPassword123!',
        }, new Request('https://app.buildcustom.ai/api/auth/login')))
            .rejects.toThrow('Too many authentication attempts');

        expect(test.authAttemptReads).toBe(1);
        expect(verify).not.toHaveBeenCalled();
    });

    it('logs only a fixed diagnostic code when the login rate-limit read fails', async () => {
        const internalError = new Error('sensitive database detail');
        const test = makeService(unverifiedUser, 0, internalError);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const requestId = 'trace-login-rate-limit-1';

        try {
            await expect(test.service.login({
                email: unverifiedUser.email,
                password: 'StrongPassword123!',
            }, new Request('https://app.buildcustom.ai/api/auth/login', {
                headers: { 'X-BuildCustom-Request-ID': requestId },
            })))
                .rejects.toThrow('Login failed');

            const output = JSON.stringify(log.mock.calls);
            expect(output).toContain('AUTH_DIAG_LOGIN_RATE_LIMIT_READ');
            expect(output).toContain(requestId);
            expect(output).not.toContain(unverifiedUser.email);
            expect(output).not.toContain('StrongPassword123!');
            expect(output).not.toContain('sensitive database detail');
        } finally {
            log.mockRestore();
        }
    });

    it('creates a session for valid credentials and never creates one for invalid credentials', async () => {
        const verifiedUser = {
            ...unverifiedUser,
            emailVerified: true,
            emailVerifiedAt: '2026-11-10T14:00:00.000Z',
        } as schema.User;
        const expiresAt = new Date('2026-11-13T14:00:00.000Z');
        const valid = makeService(verifiedUser);
        const validSession = vi.fn().mockResolvedValue({
            accessToken: 'test-access-token',
            session: { sessionId: 'test-session-id', expiresAt },
        });
        const validPassword = vi.fn().mockResolvedValue(true);
        Object.assign(valid.service, {
            passwordService: { verify: validPassword },
            sessionService: { createSession: validSession },
        });

        const infoLog = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const result = await valid.service.login({
                email: verifiedUser.email,
                password: 'StrongPassword123!',
            }, new Request('https://app.buildcustom.ai/api/auth/login', {
                headers: { 'X-BuildCustom-Request-ID': 'trace-valid-login-1' },
            }));

            expect(result.accessToken).toBe('test-access-token');
            expect(result.sessionId).toBe('test-session-id');
            expect(validPassword).toHaveBeenCalledOnce();
            expect(validSession).toHaveBeenCalledOnce();
            const output = JSON.stringify(infoLog.mock.calls);
            expect(output).toContain('trace-valid-login-1');
            expect(output).not.toContain(verifiedUser.email);
            expect(output).not.toContain(verifiedUser.id);
            expect(output).not.toContain('StrongPassword123!');
        } finally {
            infoLog.mockRestore();
        }

        const invalid = makeService(verifiedUser);
        const invalidSession = vi.fn();
        Object.assign(invalid.service, {
            passwordService: { verify: vi.fn().mockResolvedValue(false) },
            sessionService: { createSession: invalidSession },
        });
        await expect(invalid.service.login({
            email: verifiedUser.email,
            password: 'WrongPassword123!',
        }, new Request('https://app.buildcustom.ai/api/auth/login')))
            .rejects.toThrow('Invalid email or password');
        expect(invalidSession).not.toHaveBeenCalled();
    });

    it('handles concurrent valid logins without sharing session results', async () => {
        const verifiedUser = {
            ...unverifiedUser,
            emailVerified: true,
            emailVerifiedAt: '2026-11-10T14:00:00.000Z',
        } as schema.User;
        const test = makeService(verifiedUser);
        let sessionNumber = 0;
        const createSession = vi.fn(async () => {
            sessionNumber += 1;
            return {
                accessToken: `test-access-token-${sessionNumber}`,
                session: {
                    sessionId: `test-session-${sessionNumber}`,
                    expiresAt: new Date('2026-11-13T14:00:00.000Z'),
                },
            };
        });
        Object.assign(test.service, {
            passwordService: { verify: vi.fn().mockResolvedValue(true) },
            sessionService: { createSession },
        });

        const results = await Promise.all([
            test.service.login({
                email: verifiedUser.email,
                password: 'StrongPassword123!',
            }, new Request('https://app.buildcustom.ai/api/auth/login', {
                headers: { 'X-BuildCustom-Request-ID': 'trace-concurrent-login-a' },
            })),
            test.service.login({
                email: verifiedUser.email,
                password: 'StrongPassword123!',
            }, new Request('https://app.buildcustom.ai/api/auth/login', {
                headers: { 'X-BuildCustom-Request-ID': 'trace-concurrent-login-b' },
            })),
        ]);

        expect(createSession).toHaveBeenCalledTimes(2);
        expect(new Set(results.map((result) => result.sessionId)).size).toBe(2);
        expect(new Set(results.map((result) => result.accessToken)).size).toBe(2);
    });

    it('does not let a failed diagnostic sink replace the login error', async () => {
        const test = makeService(unverifiedUser, 0, new Error('database failure'));
        const log = vi.spyOn(console, 'error').mockImplementation(() => {
            throw new Error('log sink failure');
        });

        try {
            await expect(test.service.login({
                email: unverifiedUser.email,
                password: 'StrongPassword123!',
            }, new Request('https://app.buildcustom.ai/api/auth/login')))
                .rejects.toThrow('Login failed');
        } finally {
            log.mockRestore();
        }
    });
});
