import { describe, expect, it, vi } from 'vitest';
import { SessionService } from './SessionService';

function makeSessionService(batch: ReturnType<typeof vi.fn>) {
    const preparedStatements: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
        prepare: vi.fn((sql: string) => ({
            bind: vi.fn((...values: unknown[]) => {
                preparedStatements.push({ sql, values });
                return { sql, values };
            })
        })),
        batch
    };
    const service = Object.assign(Object.create(SessionService.prototype), {
        env: { DB: db }
    }) as SessionService;

    return { service, db, preparedStatements };
}

type MemoryState = {
    token: { tokenHash: string; userId: string; used: boolean; expiresAt: number };
    users: Record<string, { passwordHash: string | null; passwordChangedAt?: number }>;
    sessions: Array<{ userId: string; isRevoked: boolean }>;
};

function makeStatefulSessionService(state: MemoryState, failAtStatement?: number) {
    const now = 1_800_000_000;
    const batch = vi.fn(async (statements: Array<{ sql: string; values: unknown[] }>) => {
        const draft = structuredClone(state);
        const results: Array<{ meta: { changes: number } }> = [];
        let previousChanges = 0;

        for (const [index, statement] of statements.entries()) {
            if (index === failAtStatement) throw new Error('D1 batch failed');
            let changes = 0;
            if (index === 0) {
                const [tokenHash, userId, expiryCutoff] = statement.values as [string, string, number];
                if (
                    draft.token.tokenHash === tokenHash &&
                    draft.token.userId === userId &&
                    !draft.token.used &&
                    draft.token.expiresAt >= expiryCutoff
                ) {
                    draft.token.used = true;
                    changes = 1;
                }
            } else if (index === 1 && previousChanges === 1) {
                const [passwordHash, passwordChangedAt, _updatedAt, userId] = statement.values as [string, number, number, string];
                const user = draft.users[userId];
                if (user?.passwordHash) {
                    user.passwordHash = passwordHash;
                    user.passwordChangedAt = passwordChangedAt;
                    changes = 1;
                }
            } else if (index === 2 && previousChanges === 1) {
                const [userId] = statement.values.slice(1) as [string];
                for (const session of draft.sessions) {
                    if (session.userId === userId && !session.isRevoked) {
                        session.isRevoked = true;
                        changes++;
                    }
                }
            }
            results.push({ meta: { changes } });
            previousChanges = changes;
        }

        Object.assign(state, draft);
        return results;
    });
    const setup = makeSessionService(batch);
    return { ...setup, now };
}

describe('SessionService.changePasswordAndRevokeSessions', () => {
    it('updates the password and revokes sessions in one D1 batch', async () => {
        const batch = vi.fn().mockResolvedValue([
            { meta: { changes: 1 } },
            { meta: { changes: 1 } },
            { meta: { changes: 2 } }
        ]);
        const { service, db, preparedStatements } = makeSessionService(batch);
        const changedAt = new Date('2026-04-10T12:00:00.000Z');

        await service.changePasswordAndRevokeSessions('user-1', 'token-hash', 'password-hash', changedAt);

        expect(db.prepare).toHaveBeenCalledTimes(3);
        expect(batch).toHaveBeenCalledTimes(1);
        expect(batch.mock.calls[0][0]).toHaveLength(3);
        expect(preparedStatements[0].sql).toContain('UPDATE password_reset_tokens SET used = 1');
        expect(preparedStatements[0].sql).toContain('used = 0 AND expires_at >= ?');
        expect(preparedStatements[1].sql).toContain('UPDATE users SET password_hash');
        expect(preparedStatements[1].sql).toContain('changes() = 1');
        expect(preparedStatements[2].sql).toContain('UPDATE sessions SET is_revoked = 1');
        expect(preparedStatements[2].sql).toContain('changes() = 1');
        expect(preparedStatements[0].values).toEqual([
            'token-hash',
            'user-1',
            Math.floor(changedAt.getTime() / 1000)
        ]);
        expect(preparedStatements[1].values).toEqual([
            'password-hash',
            Math.floor(changedAt.getTime() / 1000),
            Math.floor(changedAt.getTime() / 1000),
            'user-1'
        ]);
        expect(preparedStatements[2].values).toEqual([
            Math.floor(changedAt.getTime() / 1000),
            'user-1'
        ]);
    });

    it('leaves token, password, and sessions unchanged when a batched write fails', async () => {
        const state: MemoryState = {
            token: { tokenHash: 'token-hash', userId: 'owner-1', used: false, expiresAt: 1_900_000_000 },
            users: { 'owner-1': { passwordHash: 'old-hash' } },
            sessions: [{ userId: 'owner-1', isRevoked: false }]
        };
        const { service } = makeStatefulSessionService(state, 2);
        await expect(
            service.changePasswordAndRevokeSessions('owner-1', 'token-hash', 'password-hash', new Date())
        ).rejects.toThrow('D1 batch failed');
        expect(state.token.used).toBe(false);
        expect(state.users['owner-1'].passwordHash).toBe('old-hash');
        expect(state.sessions[0].isRevoked).toBe(false);
    });

    it('rejects replay after the single-use token has already been consumed', async () => {
        const state: MemoryState = {
            token: { tokenHash: 'token-hash', userId: 'owner-1', used: false, expiresAt: 1_900_000_000 },
            users: { 'owner-1': { passwordHash: 'old-hash' } },
            sessions: [{ userId: 'owner-1', isRevoked: false }]
        };
        const { service, now } = makeStatefulSessionService(state);

        await service.changePasswordAndRevokeSessions('owner-1', 'token-hash', 'first-new-hash', new Date(now * 1000));
        await expect(
            service.changePasswordAndRevokeSessions('owner-1', 'token-hash', 'replayed-hash', new Date(now * 1000))
        ).rejects.toThrow('Invalid or expired password reset token.');

        expect(state.token.used).toBe(true);
        expect(state.users['owner-1'].passwordHash).toBe('first-new-hash');
        expect(state.sessions[0].isRevoked).toBe(true);
    });

    it('does not let a token change another owner or revoke their sessions', async () => {
        const state: MemoryState = {
            token: { tokenHash: 'owner-1-token', userId: 'owner-1', used: false, expiresAt: 1_900_000_000 },
            users: {
                'owner-1': { passwordHash: 'owner-1-old-hash' },
                'owner-2': { passwordHash: 'owner-2-old-hash' }
            },
            sessions: [
                { userId: 'owner-1', isRevoked: false },
                { userId: 'owner-2', isRevoked: false }
            ]
        };
        const { service, now } = makeStatefulSessionService(state);

        await expect(
            service.changePasswordAndRevokeSessions('owner-2', 'owner-1-token', 'attacker-hash', new Date(now * 1000))
        ).rejects.toThrow('Invalid or expired password reset token.');

        expect(state.token.used).toBe(false);
        expect(state.users['owner-1'].passwordHash).toBe('owner-1-old-hash');
        expect(state.users['owner-2'].passwordHash).toBe('owner-2-old-hash');
        expect(state.sessions.map(({ isRevoked }) => isRevoked)).toEqual([false, false]);
    });
});