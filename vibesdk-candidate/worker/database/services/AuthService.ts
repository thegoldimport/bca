/**
 * Main Authentication Service
 * Orchestrates all auth operations including login, registration, and OAuth
 */

import * as schema from '../schema';
import { eq, and, sql, or, lt, isNull, count } from 'drizzle-orm';
import { JWTUtils } from '../../utils/jwtUtils';
import { generateSecureToken, sha256Hash } from '../../utils/cryptoUtils';
import { SessionService } from './SessionService';
import { ApiKeyService } from './ApiKeyService';
import { PasswordService } from '../../utils/passwordService';
import { GoogleOAuthProvider } from '../../services/oauth/google';
import { GitHubOAuthProvider } from '../../services/oauth/github';
import { CloudflareConnectOAuthProvider } from '../../services/oauth/cloudflare-connect';
import { BaseOAuthProvider } from '../../services/oauth/base';
import { readOAuthNonceCookie } from '../../utils/oauthCookie';
import { 
    SecurityError, 
    SecurityErrorType 
} from 'shared/types/errors';
import { AuthResult, AuthUserSession, OAuthUserInfo } from '../../types/auth-types';
import { generateId } from '../../utils/idGenerator';
import {
    AuthUser, 
    OAuthProvider
} from '../../types/auth-types';
import { mapUserResponse, validateRedirectUrl, enforceAllowedEmail } from '../../utils/authUtils';
import { createLogger } from '../../logger';
import { validateEmail, validatePassword } from '../../utils/validationUtils';
import { extractRequestMetadata } from '../../utils/authUtils';
import { BaseService } from './BaseService';

const logger = createLogger('AuthService');

const LOGIN_DIAGNOSTIC_MESSAGES = {
    rate_limit_read: 'AUTH_DIAG_LOGIN_RATE_LIMIT_READ',
    allowlist: 'AUTH_DIAG_LOGIN_ALLOWLIST',
    account_lookup: 'AUTH_DIAG_LOGIN_ACCOUNT_LOOKUP',
    password_verification: 'AUTH_DIAG_LOGIN_PASSWORD_VERIFICATION',
    session_creation: 'AUTH_DIAG_LOGIN_SESSION_CREATION',
} as const;

const PASSWORD_RESET_DIAGNOSTIC_MESSAGES = {
    request_metadata: 'AUTH_DIAG_PASSWORD_RESET_REQUEST_METADATA',
    rate_limit_read: 'AUTH_DIAG_PASSWORD_RESET_RATE_LIMIT_READ',
    attempt_audit: 'AUTH_DIAG_PASSWORD_RESET_ATTEMPT_AUDIT',
    email_binding: 'AUTH_DIAG_PASSWORD_RESET_EMAIL_BINDING',
    delivery_schedule: 'AUTH_DIAG_PASSWORD_RESET_DELIVERY_SCHEDULE',
    delivery_processing: 'AUTH_DIAG_PASSWORD_RESET_DELIVERY_PROCESSING',
    background_failure: 'AUTH_DIAG_PASSWORD_RESET_BACKGROUND_FAILURE',
} as const;

export function authAttemptWindowCondition(windowStart: Date) {
    const attemptedAt = schema.authAttempts.attemptedAt;
    const windowStartSeconds = Math.floor(windowStart.getTime() / 1000);
    // D1 stores CURRENT_TIMESTAMP defaults as text even though this column has INTEGER affinity.
    // Normalize legacy text rows and timestamp-mode epoch values before comparing the window.
    return sql`CASE
        WHEN typeof(${attemptedAt}) = 'integer' THEN ${attemptedAt}
        ELSE unixepoch(${attemptedAt})
    END >= ${windowStartSeconds}`;
}

/**
 * Login credentials
 */
export interface LoginCredentials {
    email: string;
    password: string;
}

/**
 * Registration data
 */
export interface RegistrationData {
    email: string;
    password: string;
    name?: string;
}

export interface RegistrationResult {
    email: string;
    verificationRequired: true;
}

/**
 * Human-friendly label for a stored auth provider, used in user-facing messages.
 */
export function providerLabel(provider: string | null | undefined): string {
    switch (provider) {
        case 'google':
            return 'Google';
        case 'github':
            return 'GitHub';
        case 'cloudflare':
            return 'Cloudflare';
        default:
            return 'a different sign-in method';
    }
}


/**
 * Main Authentication Service
 */
export class AuthService extends BaseService {
    private readonly sessionService: SessionService;
    private readonly apiKeyService: ApiKeyService;
    private readonly passwordService: PasswordService;
    
    constructor(
        env: Env,
    ) {
        super(env);
        this.sessionService = new SessionService(env);
        this.apiKeyService = new ApiKeyService(env);
        this.passwordService = new PasswordService();
    }
    
    /**
     * Register a new user
     */
    async register(data: RegistrationData, request: Request): Promise<RegistrationResult> {
        const normalizedEmail = data.email.trim().toLowerCase();
        try {
            await this.enforceAuthAttemptLimit('register', normalizedEmail, request, 5, 60);

            // Deployment-level admission gate (ALLOWED_EMAIL)
            enforceAllowedEmail(this.env, normalizedEmail, 'register');

            if (!this.env.EMAIL) {
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    'Email verification is temporarily unavailable. Please try again later.',
                    503
                );
            }

            // Validate email format using centralized utility
            const emailValidation = validateEmail(normalizedEmail);
            if (!emailValidation.valid) {
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    emailValidation.error || 'Invalid email format',
                    400
                );
            }
            
            // Validate password using centralized utility
            const passwordValidation = validatePassword(data.password, undefined, {
                email: normalizedEmail,
                name: data.name
            });
            if (!passwordValidation.valid) {
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    passwordValidation.errors!.join(', '),
                    400
                );
            }
            
            // Check if user already exists
            const existingUser = await this.database
                .select()
                .from(schema.users)
                .where(eq(schema.users.email, normalizedEmail))
                .get();
            
            if (existingUser) {
                // OAuth-only account: guide the user to their provider instead of
                // implying they can create a password-based account for this email.
                if (!existingUser.passwordHash) {
                    const label = providerLabel(existingUser.provider);
                    throw new SecurityError(
                        SecurityErrorType.CONFLICT,
                        `This email is registered with ${label}. Please sign in with ${label}.`,
                        409
                    );
                }
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    'An account with this email already exists. Please sign in.',
                    400
                );
            }
            
            // Hash password
            const passwordHash = await this.passwordService.hash(data.password);
            
            // Create user
            const userId = generateId();
            const now = new Date();
            
            // A password-based account is not trusted until the user confirms a
            // single-use link sent to the mailbox.
            await this.database.insert(schema.users).values({
                id: userId,
                email: normalizedEmail,
                passwordHash,
                displayName: data.name || normalizedEmail.split('@')[0],
                emailVerified: false,
                provider: 'email',
                providerId: userId,
                createdAt: now,
                updatedAt: now
            });
            
            // Get the created user
            const newUser = await this.database
                .select()
                .from(schema.users)
                .where(eq(schema.users.id, userId))
                .get();
            
            if (!newUser) {
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    'Failed to retrieve created user',
                    500
                );
            }
            
            await this.issueEmailVerificationEmail(newUser, now);
            await this.logAuthAttempt(normalizedEmail, 'register', true, request);
            logger.info('Unverified email/password account registered', { userId });
            return { email: normalizedEmail, verificationRequired: true };
        } catch (error) {
            await this.logAuthAttempt(normalizedEmail, 'register', false, request);
            
            if (error instanceof SecurityError) {
                throw error;
            }
            
            logger.error('Registration error', error);
            throw new SecurityError(
                SecurityErrorType.INVALID_INPUT,
                'Registration failed',
                500
            );
        }
    }
    
    /**
     * Login with email and password
     */
    async login(credentials: LoginCredentials, request: Request): Promise<AuthResult> {
        const normalizedEmail = credentials.email.trim().toLowerCase();
        let diagnosticStage: keyof typeof LOGIN_DIAGNOSTIC_MESSAGES = 'rate_limit_read';
        try {
            diagnosticStage = 'rate_limit_read';
            await this.enforceAuthAttemptLimit('login', normalizedEmail, request, 10, 120);

            // Deployment-level admission gate (ALLOWED_EMAIL)
            diagnosticStage = 'allowlist';
            enforceAllowedEmail(this.env, normalizedEmail, 'login');

            // Find user
            diagnosticStage = 'account_lookup';
            const user = await this.database
                .select()
                .from(schema.users)
                .where(
                    and(
                        eq(schema.users.email, normalizedEmail),
                        sql`${schema.users.deletedAt} IS NULL`
                    )
                )
                .get();
            
            if (!user) {
                await this.logAuthAttempt(normalizedEmail, 'login', false, request);
                throw new SecurityError(
                    SecurityErrorType.UNAUTHORIZED,
                    'Invalid email or password',
                    401
                );
            }

            // The email belongs to an OAuth-only account (no password set). Tell the
            // user which provider to use instead of a misleading credentials error.
            if (!user.passwordHash) {
                await this.logAuthAttempt(normalizedEmail, 'login', false, request);
                const label = providerLabel(user.provider);
                throw new SecurityError(
                    SecurityErrorType.CONFLICT,
                    `This account uses ${label} to sign in. Please continue with ${label}.`,
                    409
                );
            }
            
            // Verify password
            diagnosticStage = 'password_verification';
            const passwordValid = await this.passwordService.verify(
                credentials.password,
                user.passwordHash
            );
            
            if (!passwordValid) {
                await this.logAuthAttempt(normalizedEmail, 'login', false, request);
                throw new SecurityError(
                    SecurityErrorType.UNAUTHORIZED,
                    'Invalid email or password',
                    401
                );
            }

            if (!user.isActive || user.isSuspended) {
                await this.logAuthAttempt(normalizedEmail, 'login', false, request);
                throw new SecurityError(
                    SecurityErrorType.UNAUTHORIZED,
                    'Account access is unavailable.',
                    403
                );
            }

            if (user.provider === 'email'
                && (user.emailVerified !== true || !user.emailVerifiedAt)) {
                await this.logAuthAttempt(normalizedEmail, 'login', false, request);
                throw new SecurityError(
                    SecurityErrorType.UNAUTHORIZED,
                    'EMAIL_VERIFICATION_REQUIRED',
                    403
                );
            }
            
            // Create session
            diagnosticStage = 'session_creation';
            const { accessToken, session } = await this.sessionService.createSession(
                user.id,
                request
            );
            
            // Log successful attempt
            await this.logAuthAttempt(normalizedEmail, 'login', true, request);
            
            logger.info('User logged in', { userId: user.id, email: user.email });
            
            return {
                user: mapUserResponse(user),
                accessToken,
                sessionId: session.sessionId,
                expiresAt: session.expiresAt,
            };
        } catch (error) {
            if (error instanceof SecurityError) {
                if (error.statusCode >= 500) {
                    logger.error(LOGIN_DIAGNOSTIC_MESSAGES[diagnosticStage]);
                }
                throw error;
            }

            // Keep production diagnostics useful without logging credentials,
            // user identifiers, request data, or exception text.
            logger.error(LOGIN_DIAGNOSTIC_MESSAGES[diagnosticStage]);
            throw new SecurityError(
                SecurityErrorType.UNAUTHORIZED,
                'Login failed',
                500
            );
        }
    }

    /**
     * Create a hashed, single-use password reset token and deliver it through
     * Cloudflare Email Service. Unknown and OAuth-only accounts receive the
     * same successful API response as local accounts.
     */
    async requestPasswordReset(
        email: string,
        request: Request,
        context?: ExecutionContext
    ): Promise<void> {
        const normalizedEmail = email.trim().toLowerCase();
        let diagnosticStage: keyof typeof PASSWORD_RESET_DIAGNOSTIC_MESSAGES = 'request_metadata';
        try {
            const metadata = extractRequestMetadata(request);
            const now = new Date();
            const windowStart = new Date(now.getTime() - 15 * 60 * 1000);

            diagnosticStage = 'rate_limit_read';
            const [emailAttempts, ipAttempts] = await Promise.all([
                this.database.select({ total: count() }).from(schema.authAttempts).where(and(
                    eq(schema.authAttempts.attemptType, 'reset_password'),
                    eq(schema.authAttempts.identifier, normalizedEmail),
                    authAttemptWindowCondition(windowStart)
                )).get(),
                metadata.ipAddress !== 'unknown'
                    ? this.database.select({ total: count() }).from(schema.authAttempts).where(and(
                        eq(schema.authAttempts.attemptType, 'reset_password'),
                        eq(schema.authAttempts.ipAddress, metadata.ipAddress),
                        authAttemptWindowCondition(windowStart)
                    )).get()
                    : Promise.resolve({ total: 0 })
            ]);

            if ((emailAttempts?.total ?? 0) >= 3 || (ipAttempts?.total ?? 0) >= 15) {
                diagnosticStage = 'attempt_audit';
                await this.logAuthAttempt(normalizedEmail, 'reset_password', false, request);
                throw new SecurityError(SecurityErrorType.RATE_LIMITED, 'Too many password reset requests. Please try again later.', 429);
            }

            diagnosticStage = 'attempt_audit';
            await this.logAuthAttempt(normalizedEmail, 'reset_password', false, request);
            diagnosticStage = 'email_binding';
            if (!this.env.EMAIL) {
                throw new SecurityError(SecurityErrorType.INVALID_INPUT, 'Password reset email service is unavailable.', 503);
            }

            diagnosticStage = 'delivery_schedule';
            const processing = this.issuePasswordResetEmail(normalizedEmail, now);
            if (context) {
                context.waitUntil(processing.catch(() => {
                    logger.error(PASSWORD_RESET_DIAGNOSTIC_MESSAGES.background_failure);
                }));
                return;
            }

            diagnosticStage = 'delivery_processing';
            await processing;
        } catch (error) {
            if (error instanceof SecurityError && error.statusCode < 500) {
                throw error;
            }

            // This allowlisted stage code carries no account or exception data.
            logger.error(PASSWORD_RESET_DIAGNOSTIC_MESSAGES[diagnosticStage]);
            throw error;
        }
    }

    private async enforceAuthAttemptLimit(
        attemptType: 'login' | 'register' | 'email_verification',
        identifier: string,
        request: Request,
        maxPerEmail: number,
        maxPerIp: number
    ): Promise<void> {
        const metadata = extractRequestMetadata(request);
        const windowStart = new Date(Date.now() - 15 * 60 * 1000);
        const [emailAttempts, ipAttempts] = await Promise.all([
            maxPerEmail > 0
                ? this.database.select({ total: count() }).from(schema.authAttempts).where(and(
                    eq(schema.authAttempts.attemptType, attemptType),
                    eq(schema.authAttempts.identifier, identifier),
                    authAttemptWindowCondition(windowStart)
                )).get()
                : Promise.resolve({ total: 0 }),
            // Never combine unrelated callers into a shared "unknown" IP bucket.
            maxPerIp > 0 && metadata.ipAddress !== 'unknown'
                ? this.database.select({ total: count() }).from(schema.authAttempts).where(and(
                    eq(schema.authAttempts.attemptType, attemptType),
                    eq(schema.authAttempts.ipAddress, metadata.ipAddress),
                    authAttemptWindowCondition(windowStart)
                )).get()
                : Promise.resolve({ total: 0 })
        ]);

        if ((maxPerEmail > 0 && (emailAttempts?.total ?? 0) >= maxPerEmail)
            || (maxPerIp > 0 && (ipAttempts?.total ?? 0) >= maxPerIp)) {
            await this.logAuthAttempt(identifier, attemptType, false, request);
            throw new SecurityError(
                SecurityErrorType.RATE_LIMITED,
                'Too many authentication attempts. Please wait and try again.',
                429
            );
        }
    }

    /**
     * Public, enumeration-resistant request used by signup and the resend screen.
     * Only accounts created with email/password can receive this verification.
     */
    async requestEmailVerification(email: string, request: Request): Promise<void> {
        const normalizedEmail = email.trim().toLowerCase();
        await this.enforceAuthAttemptLimit('email_verification', normalizedEmail, request, 3, 30);
        await this.logAuthAttempt(normalizedEmail, 'email_verification', false, request);
        if (!this.env.EMAIL) {
            throw new SecurityError(
                SecurityErrorType.INVALID_INPUT,
                'Email verification is temporarily unavailable. Please try again later.',
                503
            );
        }

        const user = await this.database.select().from(schema.users).where(and(
            eq(schema.users.email, normalizedEmail),
            eq(schema.users.provider, 'email'),
            eq(schema.users.isActive, true),
            isNull(schema.users.deletedAt)
        )).get();
        if (!user?.passwordHash || user.emailVerified) return;
        await this.issueEmailVerificationEmail(user, new Date());
    }

    /**
     * Consume a verification token once. The link is only consumed by this
     * explicit POST, never by the email link's initial GET.
     */
    async verifyEmail(token: string, request: Request): Promise<boolean> {
        await this.enforceAuthAttemptLimit('email_verification', '__verification_link__', request, 0, 20);
        await this.logAuthAttempt('__verification_link__', 'email_verification', false, request);
        if (!token || token.length > 256) return false;

        const tokenHash = await sha256Hash(token);
        const nowSeconds = Math.floor(Date.now() / 1000);
        const record = await this.env.DB.prepare(
            'SELECT id,user_id,email FROM email_verification_tokens WHERE token_hash=? AND used=0 AND expires_at>? LIMIT 1'
        ).bind(tokenHash, nowSeconds).first<{ id: string; user_id: string; email: string }>();
        if (!record) return false;

        const now = nowSeconds;
        const results = await this.env.DB.batch([
            this.env.DB.prepare(
                'UPDATE email_verification_tokens SET used=1 WHERE id=? AND used=0 AND expires_at>?'
            ).bind(record.id, nowSeconds),
            this.env.DB.prepare(
                `UPDATE users SET email_verified=1,email_verified_at=?,updated_at=?
                 WHERE id=? AND email=? AND email_verified=0 AND deleted_at IS NULL AND is_active=1
                 AND EXISTS (
                   SELECT 1 FROM email_verification_tokens
                   WHERE id=? AND token_hash=? AND used=1 AND expires_at>?
                 )`
            ).bind(now, now, record.user_id, record.email, record.id, tokenHash, nowSeconds)
        ]);
        const verified = (results[0]?.meta.changes ?? 0) === 1
            && (results[1]?.meta.changes ?? 0) === 1;
        if (verified) await this.logAuthAttempt(record.email, 'email_verification', true, request);
        return verified;
    }

    private async issueEmailVerificationEmail(
        user: typeof schema.users.$inferSelect,
        now: Date
    ): Promise<void> {
        const rawToken = generateSecureToken(32);
        const tokenHash = await sha256Hash(rawToken);
        const tokenId = generateId();
        const nowSeconds = Math.floor(now.getTime() / 1000);
        const expiresAt = nowSeconds + 15 * 60;
        await this.env.DB.batch([
            this.env.DB.prepare(
                'UPDATE email_verification_tokens SET used=1 WHERE user_id=? AND used=0'
            ).bind(user.id),
            this.env.DB.prepare(
                'INSERT INTO email_verification_tokens(id,user_id,token_hash,email,expires_at,used,created_at) VALUES(?,?,?,?,?,0,?)'
            ).bind(tokenId, user.id, tokenHash, user.email, expiresAt, nowSeconds)
        ]);

        const verifyUrl = `https://app.buildcustom.ai/verify-email#token=${encodeURIComponent(rawToken)}`;
        const text = `Confirm your BuildCustom email address using this link (valid for 15 minutes):\n${verifyUrl}\n\nIf you did not create this account, you can ignore this email.`;
        const html = `<p>Confirm your BuildCustom email address.</p><p><a href="${verifyUrl}">Confirm email</a> (valid for 15 minutes).</p><p>If you did not create this account, you can ignore this email.</p>`;
        try {
            const message = {
                from: { email: 'security@buildcustom.ai', name: 'BuildCustom' },
                to: user.email,
                subject: 'Confirm your BuildCustom email',
                text,
                html
            };
            await this.env.EMAIL!.send(
                message as unknown as Parameters<Env['EMAIL']['send']>[0]
            );
        } catch {
            await this.env.DB.prepare(
                'UPDATE email_verification_tokens SET used=1 WHERE id=? AND used=0'
            ).bind(tokenId).run().catch(() => undefined);
            logger.error('Email verification delivery failed');
            throw new SecurityError(
                SecurityErrorType.UNAUTHORIZED,
                'Your account was created, but the verification email could not be sent. Please request a new link.',
                503
            );
        }
    }

    private async issuePasswordResetEmail(normalizedEmail: string, now: Date): Promise<void> {
        const user = await this.database.select().from(schema.users).where(and(
            eq(schema.users.email, normalizedEmail),
            isNull(schema.users.deletedAt),
            eq(schema.users.isActive, true)
        )).get();

        if (!user?.passwordHash) return;

        const rawToken = generateSecureToken(32);
        const tokenHash = await sha256Hash(rawToken);
        const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

        await this.database.update(schema.passwordResetTokens)
            .set({ used: true })
            .where(and(
                eq(schema.passwordResetTokens.userId, user.id),
                eq(schema.passwordResetTokens.used, false)
            ));
        await this.database.insert(schema.passwordResetTokens).values({
            id: generateId(),
            userId: user.id,
            tokenHash,
            expiresAt,
            used: false,
            createdAt: now
        });

        const resetUrl = `https://app.buildcustom.ai/reset-password#token=${encodeURIComponent(rawToken)}`;
        const text = `We received a request to reset your password.\n\nReset your password using this link (valid for 15 minutes):\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`;
        const html = `<p>We received a request to reset your password.</p><p><a href="${resetUrl}">Reset your password</a> (valid for 15 minutes).</p><p>If you did not request this, you can ignore this email.</p>`;
        try {
            // Cloudflare Email Service's documented builder accepts a named
            // sender, while the installed workers-types describes the raw
            // SMTP-envelope EmailMessage (`from: string`). Keep the documented
            // runtime payload and bridge only that stale type declaration here.
            const message = {
                from: { email: 'security@buildcustom.ai', name: 'BuildCustom' },
                to: normalizedEmail,
                subject: 'Reset your BuildCustom password',
                text,
                html
            };
            await this.env.EMAIL.send(
                message as unknown as Parameters<Env['EMAIL']['send']>[0]
            );
        } catch {
            try {
                await this.database.update(schema.passwordResetTokens)
                    .set({ used: true })
                    .where(eq(schema.passwordResetTokens.tokenHash, tokenHash));
            } catch {
                logger.error('Failed to invalidate undelivered password reset token');
            }
            logger.error('Password reset email delivery failed');
        }
    }

    /**
     * Validate the reset password and atomically consume its token, update the
     * password, and revoke the account's sessions.
     */
    async resetPassword(token: string, newPassword: string, request: Request): Promise<void> {
        const tokenHash = await sha256Hash(token);
        const resetRow = await this.database.select()
            .from(schema.passwordResetTokens)
            .where(eq(schema.passwordResetTokens.tokenHash, tokenHash))
            .get();
        const user = resetRow
            ? await this.database.select().from(schema.users).where(and(
                eq(schema.users.id, resetRow.userId),
                isNull(schema.users.deletedAt),
                eq(schema.users.isActive, true)
            )).get()
            : undefined;
        const validation = this.passwordService.validatePassword(newPassword, {
            email: user?.email
        });
        if (!validation.valid) {
            throw new SecurityError(
                SecurityErrorType.INVALID_INPUT,
                validation.errors?.join(', ') || 'Invalid password',
                400
            );
        }

        if (!user?.passwordHash) {
            throw new SecurityError(SecurityErrorType.INVALID_INPUT, 'Invalid or expired password reset token.', 400);
        }

        const now = new Date();
        const passwordHash = await this.passwordService.hash(newPassword);
        await this.sessionService.changePasswordAndRevokeSessions(user.id, tokenHash, passwordHash, now);
        await this.logAuthAttempt(user.email, 'reset_password', true, request);
    }
    
    /**
     * Logout
     */
    async logout(sessionId: string): Promise<void> {
        try {
            await this.sessionService.revokeSessionId(sessionId);
            logger.info('User logged out', { sessionId });
        } catch (error) {
            logger.error('Logout error', error);
            throw new SecurityError(
                SecurityErrorType.UNAUTHORIZED,
                'Logout failed',
                500
            );
        }
    }

    async getOauthProvider(provider: OAuthProvider, request: Request): Promise<BaseOAuthProvider> {
        const url = new URL(request.url).origin;
        
        switch (provider) {
            case 'google':
                return GoogleOAuthProvider.create(this.env, url);
            case 'github':
                return GitHubOAuthProvider.create(this.env, url);
            case 'cloudflare':
                return CloudflareConnectOAuthProvider.createForLogin(this.env, url);
            default:
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    `OAuth provider ${provider} not configured`,
                    400
                );
        }
    }
    
    /**
     * Get OAuth authorization URL
     */
    async getOAuthAuthorizationUrl(
        provider: OAuthProvider,
        request: Request,
        intendedRedirectUrl?: string,
        linkUserId?: string
    ): Promise<{ authUrl: string; nonce: string }> {
        const oauthProvider = await this.getOauthProvider(provider, request);
        if (!oauthProvider) {
            throw new SecurityError(
                SecurityErrorType.INVALID_INPUT,
                `OAuth provider ${provider} not configured`,
                400
            );
        }
        
        // Clean up expired OAuth states first
        await this.cleanupExpiredOAuthStates();
        
        // Validate and sanitize intended redirect URL
        let validatedRedirectUrl: string | null = null;
        if (intendedRedirectUrl) {
            validatedRedirectUrl = validateRedirectUrl(intendedRedirectUrl, request);
        }
        
        // Generate state for CSRF protection
        const state = generateSecureToken();
        
        // Generate PKCE code verifier
        const codeVerifier = BaseOAuthProvider.generateCodeVerifier();

        // Generate a nonce that binds this state to the initiating browser. It is
        // stored here and also set as an HttpOnly cookie by the controller; the
        // callback rejects any request whose cookie nonce does not match. This is
        // the core defense against login CSRF / session fixation.
        const nonce = generateSecureToken();
        
        // Store OAuth state with intended redirect URL
        await this.database.insert(schema.oauthStates).values({
            id: generateId(),
            state,
            provider,
            codeVerifier,
            redirectUri: validatedRedirectUrl || oauthProvider['redirectUri'],
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 600000), // 10 minutes
            isUsed: false,
            scopes: [],
            userId: linkUserId ?? null,
            nonce
        });
        
        // Get authorization URL
        const authUrl = await oauthProvider.getAuthorizationUrl(state, codeVerifier);
        
        logger.info('OAuth authorization initiated', { provider });
        
        return { authUrl, nonce };
    }
    
    /**
     * Clean up expired OAuth states
     */
    private async cleanupExpiredOAuthStates(): Promise<void> {
        try {
            const now = new Date();
            await this.database
                .delete(schema.oauthStates)
                .where(
                    or(
                        lt(schema.oauthStates.expiresAt, now),
                        eq(schema.oauthStates.isUsed, true)
                    )
                );
            
            logger.debug('Cleaned up expired OAuth states');
        } catch (error) {
            logger.error('Error cleaning up OAuth states', error);
        }
    }
    
    /**
     * Validate an OAuth state row (existence, expiry, browser nonce) and mark it as
     * used. Shared by the login callback and the account-link callback.
     */
    private async validateAndConsumeOAuthState(
        provider: OAuthProvider,
        state: string,
        request: Request
    ): Promise<schema.OAuthState> {
        const now = new Date();
        const oauthState = await this.database
            .select()
            .from(schema.oauthStates)
            .where(
                and(
                    eq(schema.oauthStates.state, state),
                    eq(schema.oauthStates.provider, provider),
                    eq(schema.oauthStates.isUsed, false)
                )
            )
            .get();

        if (!oauthState || new Date(oauthState.expiresAt) < now) {
            throw new SecurityError(
                SecurityErrorType.CSRF_VIOLATION,
                'Invalid or expired OAuth state',
                400
            );
        }

        // Bind the state to the initiating browser via the nonce cookie. A callback
        // replayed in a different browser (login CSRF / session fixation) will not
        // carry the matching nonce and is rejected here.
        const cookieNonce = readOAuthNonceCookie(request, this.env);
        if (!oauthState.nonce || !cookieNonce || cookieNonce !== oauthState.nonce) {
            logger.warn('OAuth callback nonce mismatch - possible login CSRF', {
                provider,
                hasStoredNonce: !!oauthState.nonce,
                hasCookieNonce: !!cookieNonce,
            });
            throw new SecurityError(
                SecurityErrorType.CSRF_VIOLATION,
                'Invalid or expired OAuth state',
                400
            );
        }

        // Mark state as used
        await this.database
            .update(schema.oauthStates)
            .set({ isUsed: true })
            .where(eq(schema.oauthStates.id, oauthState.id));

        return oauthState;
    }

    /**
     * Look up whether a still-valid, unused OAuth state is bound to a user (i.e. an
     * account-link flow). Returns the bound userId or null. Does not consume state.
     */
    async getPendingLinkUserId(
        provider: OAuthProvider,
        state: string
    ): Promise<string | null> {
        const row = await this.database
            .select({ userId: schema.oauthStates.userId })
            .from(schema.oauthStates)
            .where(
                and(
                    eq(schema.oauthStates.state, state),
                    eq(schema.oauthStates.provider, provider),
                    eq(schema.oauthStates.isUsed, false)
                )
            )
            .get();
        return row?.userId ?? null;
    }

    /**
     * Handle OAuth callback
     */
    async handleOAuthCallback(
        provider: OAuthProvider,
        code: string,
        state: string,
        request: Request
    ): Promise<AuthResult> {
        try {
            const oauthProvider = await this.getOauthProvider(provider, request);
            if (!oauthProvider) {
                throw new SecurityError(
                    SecurityErrorType.INVALID_INPUT,
                    `OAuth provider ${provider} not configured`,
                    400
                );
            }
            
            // Validate the state (existence, expiry, browser nonce) and mark it used.
            const oauthState = await this.validateAndConsumeOAuthState(provider, state, request);

            // A state bound to a user is an account-link flow and must go through
            // completeOAuthLink (which re-checks the session), never the login path.
            if (oauthState.userId) {
                throw new SecurityError(
                    SecurityErrorType.CSRF_VIOLATION,
                    'Invalid OAuth state for login',
                    400
                );
            }
            
            // Exchange code for tokens
            const tokens = await oauthProvider.exchangeCodeForTokens(
                code,
                oauthState.codeVerifier || undefined
            );
            
            // Get user info
            const oauthUserInfo = await oauthProvider.getUserInfo(tokens.accessToken);

            // Deployment-level admission gate (ALLOWED_EMAIL). Enforced BEFORE any
            // user row or session is created so a rejected email never gets admitted.
            enforceAllowedEmail(this.env, oauthUserInfo.email, 'oauth');

            // Find or create user
            const user = await this.findOrCreateOAuthUser(provider, oauthUserInfo);
            
            // Create session
            const { accessToken: sessionAccessToken, session } = await this.sessionService.createSession(
                user.id,
                request
            );
            
            // Log auth attempt
            await this.logAuthAttempt(user.email, `oauth_${provider}`, true, request);
            
            logger.info('OAuth login successful', { userId: user.id, provider });
            
            return {
                user: mapUserResponse(user),
                accessToken: sessionAccessToken,
                sessionId: session.sessionId,
                expiresAt: session.expiresAt,
                redirectUrl: oauthState.redirectUri || undefined,
                // Surface raw provider tokens only for Cloudflare so the controller can
                // best-effort auto-connect the AI Gateway in the same round-trip.
                oauthTokens: provider === 'cloudflare' ? tokens : undefined,
            };
        } catch (error) {
            await this.logAuthAttempt('', `oauth_${provider}`, false, request);
            
            if (error instanceof SecurityError) {
                throw error;
            }
            
            logger.error('OAuth callback error', error);
            throw new SecurityError(
                SecurityErrorType.UNAUTHORIZED,
                'OAuth authentication failed',
                500
            );
        }
    }
    
    /**
     * Resolve the user for an OAuth login.
     *
     * An OAuth login is a request to authenticate as a (provider, providerId)
     * identity, NOT as an email address. Lookup therefore happens against the
     * user_oauth_identities table. Binding an OAuth identity to an existing
     * account only happens through the authenticated link flow (linkOAuthIdentity),
     * never implicitly by email match — that implicit bind was the account-takeover
     * vector this method previously had.
     */
    private async findOrCreateOAuthUser(
        provider: OAuthProvider,
        oauthUserInfo: OAuthUserInfo
    ): Promise<schema.User> {
        // Fail closed unless the provider asserts the email is verified.
        if (oauthUserInfo.emailVerified !== true) {
            throw new SecurityError(
                SecurityErrorType.UNAUTHORIZED,
                'OAuth provider did not verify the email address',
                401
            );
        }

        const email = oauthUserInfo.email.toLowerCase();

        // 1. Identity-first lookup: match by (provider, providerId).
        const identity = await this.database
            .select()
            .from(schema.userOauthIdentities)
            .where(
                and(
                    eq(schema.userOauthIdentities.provider, provider),
                    eq(schema.userOauthIdentities.providerId, oauthUserInfo.id)
                )
            )
            .get();

        if (identity) {
            const now = new Date();
            // Refresh the identity's cached email/verification.
            await this.database
                .update(schema.userOauthIdentities)
                .set({ email, emailVerified: true, updatedAt: now })
                .where(eq(schema.userOauthIdentities.id, identity.id));

            // Refresh profile fields on the user, but never the primary
            // provider/providerId binding.
            await this.database
                .update(schema.users)
                .set({
                    displayName: oauthUserInfo.name || undefined,
                    avatarUrl: oauthUserInfo.picture || undefined,
                    emailVerified: true,
                    emailVerifiedAt: now,
                    updatedAt: now
                })
                .where(and(
                    eq(schema.users.id, identity.userId),
                    eq(schema.users.email, email)
                ));

            const user = await this.database
                .select()
                .from(schema.users)
                .where(eq(schema.users.id, identity.userId))
                .get();

            if (!user) {
                throw new SecurityError(
                    SecurityErrorType.UNAUTHORIZED,
                    'OAuth authentication failed',
                    500
                );
            }
            return user;
        }

        // 2. No identity match, but a user already exists with this email (local
        //    signup or a different provider). The provider has asserted the email
        //    is verified (checked above), so attach this provider to the existing
        //    account and sign the user into it instead of failing.
        const emailRow = await this.database
            .select()
            .from(schema.users)
            .where(eq(schema.users.email, email))
            .get();

        if (emailRow) {
            await this.linkOAuthIdentity(emailRow.id, provider, oauthUserInfo);
            logger.info('Auto-linked OAuth provider to existing account', {
                userId: emailRow.id,
                provider
            });
            return await this.database
                .select()
                .from(schema.users)
                .where(eq(schema.users.id, emailRow.id))
                .get() ?? emailRow;
        }

        // 3. Brand-new identity: create the user and its first identity row.
        return this.createOAuthUser(provider, oauthUserInfo);
    }

    /**
     * Create a new user from a verified OAuth identity, writing both the users
     * row (primary identity, for display/back-compat) and its user_oauth_identities row.
     */
    private async createOAuthUser(
        provider: OAuthProvider,
        oauthUserInfo: OAuthUserInfo
    ): Promise<schema.User> {
        const userId = generateId();
        const now = new Date();
        const email = oauthUserInfo.email.toLowerCase();

        await this.database.insert(schema.users).values({
            id: userId,
            email,
            displayName: oauthUserInfo.name || email.split('@')[0],
            avatarUrl: oauthUserInfo.picture,
            emailVerified: true,
            emailVerifiedAt: now,
            provider,
            providerId: oauthUserInfo.id,
            createdAt: now,
            updatedAt: now
        });

        await this.database.insert(schema.userOauthIdentities).values({
            id: generateId(),
            userId,
            provider,
            providerId: oauthUserInfo.id,
            email,
            emailVerified: true,
            createdAt: now,
            updatedAt: now
        });

        const user = await this.database
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, userId))
            .get();

        return user!;
    }

    /**
     * Complete an authenticated account-link callback: validate the state, verify
     * it is bound to the acting user, and attach the (provider, providerId) identity.
     */
    async completeOAuthLink(
        provider: OAuthProvider,
        code: string,
        state: string,
        request: Request,
        sessionUserId: string
    ): Promise<{ userId: string; provider: OAuthProvider; redirectUrl?: string }> {
        const oauthProvider = await this.getOauthProvider(provider, request);
        if (!oauthProvider) {
            throw new SecurityError(
                SecurityErrorType.INVALID_INPUT,
                `OAuth provider ${provider} not configured`,
                400
            );
        }

        const oauthState = await this.validateAndConsumeOAuthState(provider, state, request);

        // The state must have been created by (and for) the acting session's user.
        if (!oauthState.userId || oauthState.userId !== sessionUserId) {
            throw new SecurityError(
                SecurityErrorType.CSRF_VIOLATION,
                'Invalid account-link state',
                403
            );
        }

        const tokens = await oauthProvider.exchangeCodeForTokens(
            code,
            oauthState.codeVerifier || undefined
        );
        const oauthUserInfo = await oauthProvider.getUserInfo(tokens.accessToken);

        await this.linkOAuthIdentity(oauthState.userId, provider, oauthUserInfo);

        return {
            userId: oauthState.userId,
            provider,
            redirectUrl: oauthState.redirectUri || undefined
        };
    }

    /**
     * Attach a verified OAuth identity to an existing user. Rejects if the identity
     * is already bound to a different user.
     */
    async linkOAuthIdentity(
        userId: string,
        provider: OAuthProvider,
        oauthUserInfo: OAuthUserInfo
    ): Promise<void> {
        if (oauthUserInfo.emailVerified !== true) {
            throw new SecurityError(
                SecurityErrorType.UNAUTHORIZED,
                'OAuth provider did not verify the email address',
                401
            );
        }

        const email = oauthUserInfo.email.toLowerCase();
        const now = new Date();

        const existing = await this.database
            .select()
            .from(schema.userOauthIdentities)
            .where(
                and(
                    eq(schema.userOauthIdentities.provider, provider),
                    eq(schema.userOauthIdentities.providerId, oauthUserInfo.id)
                )
            )
            .get();

        if (existing) {
            if (existing.userId !== userId) {
                throw new SecurityError(
                    SecurityErrorType.CONFLICT,
                    'This provider account is already linked to another user.',
                    409
                );
            }
            // Already linked to this user; just refresh the cached email.
            await this.database
                .update(schema.userOauthIdentities)
                .set({ email, emailVerified: true, updatedAt: now })
                .where(eq(schema.userOauthIdentities.id, existing.id));
            await this.database
                .update(schema.users)
                .set({ emailVerified: true, emailVerifiedAt: now, updatedAt: now })
                .where(and(eq(schema.users.id, userId), eq(schema.users.email, email)));
            return;
        }

        await this.database.insert(schema.userOauthIdentities).values({
            id: generateId(),
            userId,
            provider,
            providerId: oauthUserInfo.id,
            email,
            emailVerified: true,
            createdAt: now,
            updatedAt: now
        });

        await this.database
            .update(schema.users)
            .set({ emailVerified: true, emailVerifiedAt: now, updatedAt: now })
            .where(and(eq(schema.users.id, userId), eq(schema.users.email, email)));

        logger.info('OAuth identity linked', { userId, provider });
    }

    /**
     * List the OAuth identities linked to a user.
     */
    async getUserIdentities(userId: string): Promise<schema.UserOauthIdentity[]> {
        return this.database
            .select()
            .from(schema.userOauthIdentities)
            .where(eq(schema.userOauthIdentities.userId, userId))
            .all();
    }

    /**
     * Remove a linked OAuth identity. Refuses to remove the user's only remaining
     * login method (must keep at least one identity or a password).
     */
    async unlinkOAuthIdentity(userId: string, provider: OAuthProvider): Promise<void> {
        const identities = await this.getUserIdentities(userId);
        const target = identities.find((i) => i.provider === provider);

        if (!target) {
            throw new SecurityError(
                SecurityErrorType.INVALID_INPUT,
                'No linked identity found for this provider.',
                404
            );
        }

        const user = await this.database
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, userId))
            .get();

        const hasPassword = !!user?.passwordHash;
        const remainingIdentities = identities.length - 1;
        if (remainingIdentities < 1 && !hasPassword) {
            throw new SecurityError(
                SecurityErrorType.INVALID_INPUT,
                'Cannot remove your only login method.',
                400
            );
        }

        await this.database
            .delete(schema.userOauthIdentities)
            .where(eq(schema.userOauthIdentities.id, target.id));

        // If the removed identity was the primary one on the users row, repoint the
        // primary to another remaining identity so display/back-compat stays coherent.
        if (user && user.provider === provider) {
            const next = identities.find((i) => i.provider !== provider);
            if (next) {
                await this.database
                    .update(schema.users)
                    .set({ provider: next.provider, providerId: next.providerId, updatedAt: new Date() })
                    .where(eq(schema.users.id, userId));
            }
        }

        logger.info('OAuth identity unlinked', { userId, provider });
    }
    
    /**
     * Log authentication attempt
     */
    private async logAuthAttempt(
        identifier: string,
        attemptType: string,
        success: boolean,
        request: Request
    ): Promise<void> {
        try {
            const requestMetadata = extractRequestMetadata(request);
            
            await this.database.insert(schema.authAttempts).values({
                identifier: identifier.toLowerCase(),
                attemptType: attemptType as 'login' | 'register' | 'oauth_google' | 'oauth_github' | 'oauth_cloudflare' | 'refresh' | 'reset_password' | 'email_verification',
                success: success,
                ipAddress: requestMetadata.ipAddress
            });
        } catch (error) {
            logger.error('Failed to log auth attempt', error);
        }
    }
    
    /**
     * Get user for authentication (for middleware)
     */
    async getUserForAuth(userId: string): Promise<AuthUser | null> {
        try {
            const user = await this.database
                .select({
                    id: schema.users.id,
                    email: schema.users.email,
                    displayName: schema.users.displayName,
                    username: schema.users.username,
                    avatarUrl: schema.users.avatarUrl,
                    bio: schema.users.bio,
                    timezone: schema.users.timezone,
                    provider: schema.users.provider,
                    emailVerified: schema.users.emailVerified,
                    emailVerifiedAt: schema.users.emailVerifiedAt,
                    createdAt: schema.users.createdAt,
                })
                .from(schema.users)
                .where(
                    and(
                        eq(schema.users.id, userId),
                        isNull(schema.users.deletedAt),
                        eq(schema.users.isActive, true),
                        eq(schema.users.isSuspended, false),
                        or(
                            isNull(schema.users.lockedUntil),
                            lt(schema.users.lockedUntil, new Date())
                        )
                    )
                )
                .get()
                .catch((error: unknown) => {
                    logger.error('getUserForAuth query failed', {
                        errorMessage: error instanceof Error ? error.message : String(error),
                        errorName: error instanceof Error ? error.name : 'UnknownError',
                        errorCause: (error as any)?.cause,
                        errorStack: error instanceof Error ? error.stack?.split('\n').slice(0, 5).join('\n') : undefined,
                        userId
                    });
                    throw error;
                });
            
            if (!user) {
                logger.debug('User not found or not eligible for auth', { userId });
                return null;
            }
            
            return mapUserResponse(user);
        } catch (error: unknown) {
            logger.error('Error getting user for auth', {
                errorMessage: error instanceof Error ? error.message : String(error),
                errorName: error instanceof Error ? error.name : 'UnknownError',
                errorCause: (error as any)?.cause,
                userId
            });
            return null;
        }
    }

    /**
     * Whether an API key id still corresponds to an active, unexpired key.
     */
    private async isApiKeyActive(apiKeyId: string): Promise<boolean> {
        const apiKey = await this.apiKeyService.getApiKeyById(apiKeyId);
        if (!apiKey || !apiKey.isActive) {
            return false;
        }
        if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) {
            return false;
        }
        return true;
    }
    
    /**
     * Validate token and return user (for middleware).
     *
     * Treats the JWT as a pointer, not a self-contained credential: every token
     * is cross-checked against the live session / API key behind it, so logout,
     * session revoke, and API-key revoke all take effect immediately rather than
     * at token exp.
     */
    async validateTokenAndGetUser(token: string, env: Env): Promise<AuthUserSession | null> {
        try {
            const jwtUtils = JWTUtils.getInstance(env);
            const payload = await jwtUtils.verifyToken(token);
            
            if (!payload || payload.type !== 'access') {
                return null;
            }
            
            // Check if token is expired
            if (payload.exp * 1000 < Date.now()) {
                logger.debug('Token expired', { exp: payload.exp });
                return null;
            }

            if (!payload.sessionId) {
                return null;
            }

            // Cross-check the session / API key behind this token is still live.
            if (payload.sessionId.startsWith('api_key:')) {
                // API-key-derived token: resolve the synthetic sessionId back to the
                // source key and require it to still be active.
                const apiKeyId = payload.sessionId.slice('api_key:'.length);
                if (!(await this.isApiKeyActive(apiKeyId))) {
                    return null;
                }
            } else {
                const session = await this.sessionService.getSessionById(payload.sessionId);
                if (!session || session.isRevoked) {
                    return null;
                }
                if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
                    return null;
                }
            }
            
            // Get user (also enforces account status)
            const user = await this.getUserForAuth(payload.sub);
            if (!user) {
                return null;
            }
            
            return {
                user,
                sessionId: payload.sessionId,
            };
        } catch (error) {
            logger.error('Token validation error', error);
            return null;
        }
    }
    
}