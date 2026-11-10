import { describe, expect, it } from 'vitest';
import { DatabaseService } from './database';

function makeD1(): D1Database {
    return {
        prepare() {
            const statement = {
                bind() {
                    return statement;
                },
                async first() {
                    return { value: 1 };
                },
                async run() {
                    return {
                        success: true,
                        meta: { duration: 0, rows_read: 0, rows_written: 1 },
                    };
                },
                async all() {
                    return {
                        success: true,
                        results: [],
                        meta: { duration: 0, rows_read: 0, rows_written: 0 },
                    };
                },
                async raw() {
                    return [];
                },
            };
            return statement;
        },
        async batch() {
            return [];
        },
        async exec() {
            return { count: 0, duration: 0 };
        },
        withSession() {
            return this;
        },
    } as unknown as D1Database;
}

describe('DatabaseService Sentry D1 instrumentation', () => {
    it('instruments a reused D1 binding once across repeated service initialization', async () => {
        const DB = makeD1();
        const env = { DB, ENABLE_READ_REPLICAS: 'false' } as Env;
        new DatabaseService(env);
        const instrumentedPrepare = DB.prepare;

        for (let index = 0; index < 20_000; index++) new DatabaseService(env);

        expect(DB.prepare).toBe(instrumentedPrepare);
        await expect(DB.prepare('SELECT 1').first()).resolves.toEqual({ value: 1 });
    });
});
