import { beforeEach, describe, expect, it, vi } from 'vitest';

const testModules = vi.hoisted(() => ({
	getGlobalConfigurableSettings: vi.fn(async () => ({
		security: { rateLimit: {} },
	})),
}));

vi.mock('../../config/security', () => ({
	getCORSConfig: () => ({ origin: '*' }),
	getCSRFConfig: () => ({
		origin: () => true,
		tokenTTL: 2 * 60 * 60 * 1000,
		rotateOnAuth: true,
		cookieName: 'csrf-token',
		headerName: 'X-CSRF-Token',
	}),
	getSecureHeadersConfig: () => ({}),
}));

vi.mock('../../config', () => ({
	getGlobalConfigurableSettings: testModules.getGlobalConfigurableSettings,
}));

vi.mock('../../services/rate-limit/rateLimits', () => ({
	RateLimitService: { enforceGlobalApiRateLimit: vi.fn(async () => undefined) },
}));

vi.mock('../../middleware/auth/routeAuth', () => ({
	AuthConfig: { ownerOnly: 'ownerOnly' },
	setAuthLevel: () => async (_context: unknown, next: () => Promise<void>) => next(),
}));

// Keep the test local and isolated: this route is a controller/identity-mutation
// sentinel, not the production AuthController or a real persistence layer.
vi.mock('../../api/routes', () => ({
	setupRoutes(app: {
		get: (path: string, handler: (context: any) => Response) => void;
		post: (path: string, handler: (context: any) => Response) => void;
	}) {
app.get('/api/auth/csrf-token', (context) => context.json({ ok: true }));
app.post('/api/auth/register', (context) => {
			context.env.testMutationCounts.controllerCalls += 1;
			context.env.testMutationCounts.identityMutations += 1;
			return context.json({ success: true });
		});
	},
}));

import { createApp } from '../../app';
import { CsrfService } from './CsrfService';

type TestEnv = {
	ENVIRONMENT: string;
	CUSTOM_DOMAIN: string;
	ASSETS: { fetch: () => Promise<Response> };
	testMutationCounts: { controllerCalls: number; identityMutations: number };
};

function testEnv(): TestEnv {
	return {
		ENVIRONMENT: 'development',
		CUSTOM_DOMAIN: 'localhost',
		ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
		testMutationCounts: { controllerCalls: 0, identityMutations: 0 },
	};
}

async function generateCookieToken() {
	const response = new Response();
await CsrfService.enforce(new Request('https://app.example.test/api/auth/csrf-token'), response);
	const setCookie = response.headers.get('Set-Cookie');
	expect(setCookie).toContain(`${CsrfService.COOKIE_NAME}=`);
	const encodedValue = setCookie!.match(/csrf-token=([^;]+)/)?.[1];
	expect(encodedValue).toBeDefined();
	const tokenData = JSON.parse(decodeURIComponent(encodedValue!)) as {
		token: string;
		timestamp: number;
	};
	return { cookieValue: encodedValue!, tokenData };
}

describe('candidate worker CSRF guard (local Workers test pool)', () => {
	beforeEach(() => {
		testModules.getGlobalConfigurableSettings.mockClear();
	});

	it('generates a fresh 32-byte token and establishes it in the CSRF cookie', async () => {
		const firstToken = CsrfService.generateToken();
		const secondToken = CsrfService.generateToken();
		expect(firstToken).toMatch(/^[a-f0-9]{64}$/);
		expect(secondToken).toMatch(/^[a-f0-9]{64}$/);
		expect(secondToken).not.toBe(firstToken);

		const { cookieValue, tokenData } = await generateCookieToken();
		expect(tokenData.token).toMatch(/^[a-f0-9]{64}$/);
		expect(tokenData.timestamp).toBeGreaterThan(0);
		expect(cookieValue).toContain(encodeURIComponent(tokenData.token));
	});

	it('allows a matching double-submit token through the real app CSRF middleware', async () => {
		const { cookieValue, tokenData } = await generateCookieToken();
		const env = testEnv();
		const response = await createApp(env as never).fetch(
new Request('https://app.example.test/api/auth/register', {
				method: 'POST',
				headers: {
					Cookie: `${CsrfService.COOKIE_NAME}=${cookieValue}`,
					[CsrfService.HEADER_NAME]: tokenData.token,
				},
			}),
			env as never,
		);

		expect(response.status).toBe(200);
		expect(env.testMutationCounts).toEqual({ controllerCalls: 1, identityMutations: 1 });
	});

	it.each([
		['missing', {}],
		[
			'invalid',
			{
				Cookie: 'csrf-token=%7B%22token%22%3A%22cookie-token%22%2C%22timestamp%22%3A9999999999999%7D',
				'X-CSRF-Token': 'different-token',
			},
		],
	])('rejects %s CSRF and never invokes the identity controller or mutation', async (_label, headers) => {
		const env = testEnv();
		const response = await createApp(env as never).fetch(
new Request('https://app.example.test/api/auth/register', {
				method: 'POST',
				headers,
			}),
			env as never,
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: { message: 'CSRF validation failed', type: 'CSRF_VIOLATION' },
		});
		expect(env.testMutationCounts).toEqual({ controllerCalls: 0, identityMutations: 0 });
	});
});