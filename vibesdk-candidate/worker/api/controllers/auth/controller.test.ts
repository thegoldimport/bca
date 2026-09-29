import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthController } from './controller';
import type { RouteContext } from '../../types/route-context';

const {
mockGetOAuthAuthorizationUrl,
mockHandleOAuthCallback,
mockGetPendingLinkUserId,
mockProvisionFromToken,
mockRequestPasswordReset,
mockResetPassword
} =
	vi.hoisted(() => ({
		mockGetOAuthAuthorizationUrl: vi.fn(),
		mockHandleOAuthCallback: vi.fn(),
		mockGetPendingLinkUserId: vi.fn(),
		mockProvisionFromToken: vi.fn(),
mockRequestPasswordReset: vi.fn(),
mockResetPassword: vi.fn(),
	}));

vi.mock('../../../database/services/AuthService', () => ({
	AuthService: vi.fn().mockImplementation(() => ({
		getOAuthAuthorizationUrl: mockGetOAuthAuthorizationUrl,
		handleOAuthCallback: mockHandleOAuthCallback,
		getPendingLinkUserId: mockGetPendingLinkUserId,
requestPasswordReset: mockRequestPasswordReset,
resetPassword: mockResetPassword,
	})),
}));

vi.mock('../../../services/cloudflare/CloudflareProvisioningService', () => ({
	CloudflareProvisioningService: vi.fn().mockImplementation(() => ({
		provisionFromToken: mockProvisionFromToken,
	})),
}));

const BASE_URL = 'https://app.local';

const testEnv = {
	ENVIRONMENT: 'dev',
	ENABLE_CLOUDFLARE_LIMITS: 'true',
	CF_OAUTH_ENCRYPTION_KEY: 'test-oauth-encryption-key-0123456789abcdef',
	CLOUDFLARE_OAUTH_CLIENT_ID: 'cf-client-id',
	CLOUDFLARE_OAUTH_CLIENT_SECRET: 'cf-client-secret',
	JWT_SECRET: 'Test-Secret-1234567890-abcdefghijklmnop-!@#$',
} as unknown as Env;

function makeContext(overrides: Partial<RouteContext> = {}): RouteContext {
	return {
		user: { id: 'user-1', email: 'user@example.com' },
		sessionId: 'session-1',
		config: {},
		pathParams: {},
		queryParams: new URLSearchParams(),
		...overrides,
	} as unknown as RouteContext;
}

function makeCsrfRequest(path: string, body: unknown, headers: Record<string, string> = {}): Request {
const token = 'reset-csrf-test-token';
const csrfCookie = encodeURIComponent(JSON.stringify({ token, timestamp: Date.now() }));
return new Request(`${BASE_URL}${path}`, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
Origin: BASE_URL,
Cookie: `csrf-token=${csrfCookie}`,
'X-CSRF-Token': token,
...headers,
},
body: JSON.stringify(body),
});
}

describe('password reset endpoints', () => {
beforeEach(() => {
vi.clearAllMocks();
mockRequestPasswordReset.mockResolvedValue(undefined);
mockResetPassword.mockResolvedValue(undefined);
});

it('returns the same generic response for known and unknown emails', async () => {
const responses = await Promise.all(['known@example.com', 'unknown@example.com'].map((email) =>
AuthController.forgotPassword(
makeCsrfRequest('/api/auth/forgot-password', { email }),
testEnv,
{} as ExecutionContext,
makeContext(),
)
));

expect(responses.map((response) => response.status)).toEqual([200, 200]);
expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
{ success: true, data: { message: 'If an account exists for that email, password reset instructions will be sent.' } },
{ success: true, data: { message: 'If an account exists for that email, password reset instructions will be sent.' } },
]);
expect(mockRequestPasswordReset).toHaveBeenCalledTimes(2);
});

it('requires a valid CSRF token before requesting a reset', async () => {
const response = await AuthController.forgotPassword(
makeCsrfRequest('/api/auth/forgot-password', { email: 'user@example.com' }, { 'X-CSRF-Token': 'incorrect' }),
testEnv,
{} as ExecutionContext,
makeContext(),
);

expect(response.status).toBe(403);
expect(mockRequestPasswordReset).not.toHaveBeenCalled();
});

it('rejects requests with an untrusted Origin', async () => {
const response = await AuthController.resetPassword(
makeCsrfRequest('/api/auth/reset-password', {
token: 'opaque-token',
newPassword: 'Strong-but-not-a-real-password-52!',
confirmPassword: 'Strong-but-not-a-real-password-52!',
}, { Origin: 'https://attacker.example' }),
testEnv,
{} as ExecutionContext,
makeContext(),
);

expect(response.status).toBe(403);
expect(mockResetPassword).not.toHaveBeenCalled();
});

it('passes reset token and new password to the existing auth service', async () => {
const response = await AuthController.resetPassword(
makeCsrfRequest('/api/auth/reset-password', {
token: 'opaque-token',
newPassword: 'Strong-but-not-a-real-password-52!',
confirmPassword: 'Strong-but-not-a-real-password-52!',
}),
testEnv,
{} as ExecutionContext,
makeContext(),
);

expect(response.status).toBe(200);
expect(mockResetPassword).toHaveBeenCalledWith('opaque-token', 'Strong-but-not-a-real-password-52!', expect.any(Request));
});
});

describe('AuthController.initiateOAuth failure', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns a structured error response', async () => {
		mockGetOAuthAuthorizationUrl.mockRejectedValue(new Error('provider misconfigured'));

		const response = await AuthController.initiateOAuth(
			new Request(`${BASE_URL}/api/auth/oauth/cloudflare`),
			testEnv,
			{} as ExecutionContext,
			makeContext({ pathParams: { provider: 'cloudflare' } }),
		);

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			success: false,
			message: 'An error occurred',
		});
	});
});

describe('AuthController.initiateProviderLink failure', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns a structured error response', async () => {
		mockGetOAuthAuthorizationUrl.mockRejectedValue(new Error('provider misconfigured'));

		const response = await AuthController.initiateProviderLink(
			new Request(`${BASE_URL}/api/auth/link/cloudflare`),
			testEnv,
			{} as ExecutionContext,
			makeContext({ pathParams: { provider: 'cloudflare' } }),
		);

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			success: false,
			message: 'An error occurred',
		});
	});
});

describe('AuthController.handleOAuthCallback Cloudflare auto-connect failure', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetPendingLinkUserId.mockResolvedValue(null);
		mockHandleOAuthCallback.mockResolvedValue({
			user: { id: 'user-1', email: 'user@example.com' },
			accessToken: 'session-jwt',
			redirectUrl: null,
			oauthTokens: { accessToken: 'cf-access-token', tokenType: 'Bearer', expiresIn: 3600 },
		});
	});

	it('preserves the login redirect and auth cookies', async () => {
		mockProvisionFromToken.mockRejectedValue(new Error('Cloudflare API down'));

		const response = await AuthController.handleOAuthCallback(
			new Request(`${BASE_URL}/api/auth/callback/cloudflare?code=abc&state=xyz`),
			testEnv,
			{} as ExecutionContext,
			makeContext({
				sessionId: null,
				pathParams: { provider: 'cloudflare' },
				queryParams: new URLSearchParams({ code: 'abc', state: 'xyz' }),
			}),
		);

		expect(response.status).toBe(302);
		const location = new URL(response.headers.get('Location')!);
		expect(location.searchParams.get('gateway')).toBeNull();
		// Identity login must still succeed: auth cookie + nonce cleanup are set.
		const setCookie = response.headers.get('Set-Cookie') ?? '';
		expect(setCookie.length).toBeGreaterThan(0);
	});

	it('does not flag the redirect when auto-connect succeeds', async () => {
		mockProvisionFromToken.mockResolvedValue({ accountCount: 1, hasActiveGateway: true });

		const response = await AuthController.handleOAuthCallback(
			new Request(`${BASE_URL}/api/auth/callback/cloudflare?code=abc&state=xyz`),
			testEnv,
			{} as ExecutionContext,
			makeContext({
				sessionId: null,
				pathParams: { provider: 'cloudflare' },
				queryParams: new URLSearchParams({ code: 'abc', state: 'xyz' }),
			}),
		);

		expect(response.status).toBe(302);
		const location = new URL(response.headers.get('Location')!);
		expect(location.searchParams.get('gateway')).toBeNull();
	});
});
