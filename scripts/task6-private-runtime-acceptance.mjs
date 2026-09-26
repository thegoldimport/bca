#!/usr/bin/env node

import { randomBytes, randomUUID } from 'node:crypto';
import { access, chmod, open, rename, unlink } from 'node:fs/promises';
import WebSocket from 'ws';

const BASE = 'https://buildcustom-vibesdk-launch.thegoldimport.workers.dev';
const REQUIRED_BASE = 'https://buildcustom-vibesdk-launch.thegoldimport.workers.dev';
const MARKER = 'BUILDCUSTOM_PROD_RUNTIME_OK';
const CHECKPOINT_PATH = '/tmp/buildcustom-task6-private-runtime-checkpoint.json';
const CHECKPOINT_LOCK_PATH = `${CHECKPOINT_PATH}.lock`;
const REQUEST_TIMEOUT_MS = 30_000;
const AGENT_INIT_TIMEOUT_MS = 120_000;
const WS_CONNECT_TIMEOUT_MS = 20_000;
const GENERATION_TIMEOUT_MS = 8 * 60_000;

if (BASE !== REQUIRED_BASE || new URL(BASE).origin !== REQUIRED_BASE) {
  throw new Error('Refusing to run: private Task 6 base URL must match exactly.');
}

const origin = new URL(BASE).origin;
if (
  origin !== 'https://buildcustom-vibesdk-launch.thegoldimport.workers.dev'
  || origin.includes('buildcustom.ai')
  || origin.includes('.apps.buildcustom.ai')
) {
  throw new Error('Refusing to run against a non-private runtime origin.');
}

function report(stage, details = {}) {
  console.log(JSON.stringify({ stage, ...details }));
}

function fail(stage, message, details = {}) {
  report(stage, { status: 'aborted', reason: message, ...details });
  process.exitCode = 1;
}

class RuntimeSession {
  constructor(label) {
    this.label = label;
    this.cookies = new Map();
    this.csrfToken = undefined;
    this.csrfHeader = 'X-CSRF-Token';
  }

  cookieHeader() {
    return [...this.cookies.entries()]
      .filter(([, value]) => value !== '')
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  absorbCookies(response) {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      const cookieValue = pair.slice(separator + 1);
      this.cookies.set(name, cookieValue);
    }
  }

  async request(path, { method = 'GET', body, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const url = new URL(path, BASE);
    if (url.origin !== origin) throw new Error('Refusing to send a request off the private runtime origin.');

    const headers = new Headers();
    const cookie = this.cookieHeader();
    if (cookie) headers.set('cookie', cookie);
    if (body !== undefined) headers.set('content-type', 'application/json');

    const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
    if (unsafeMethod && this.csrfToken) headers.set(this.csrfHeader, this.csrfToken);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    this.absorbCookies(response);
    return response;
  }

  async json(path, options) {
    const response = await this.request(path, options);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`${this.label}: ${options?.method ?? 'GET'} ${path} returned non-JSON HTTP ${response.status}.`);
    }
    return { response, payload };
  }

  async refreshCsrf() {
    const { response, payload } = await this.json('/api/auth/csrf-token');
    if (!response.ok || payload?.success !== true || !payload.data?.token) {
      throw new Error(`${this.label}: CSRF bootstrap failed with HTTP ${response.status}.`);
    }
    this.csrfToken = payload.data.token;
    this.csrfHeader = payload.data.headerName || 'X-CSRF-Token';
    return response.status;
  }
}

async function requireStatus(response, expected, stage) {
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(response.status)) {
    throw new Error(`${stage}: expected HTTP ${statuses.join('/')} but received HTTP ${response.status}.`);
  }
}

async function registerUser(session, label, email, password) {
  await session.refreshCsrf();
  let response;
  try {
    ({ response } = await session.json('/api/auth/register', {
      method: 'POST',
      body: { email, password, name: `Private launch ${label}` },
    }));
  } catch {
    throw new Error(`${label} registration outcome is unknown; no retry was sent.`);
  }
  await requireStatus(response, 200, `${label} registration`);
  await session.refreshCsrf();

  const profile = await session.json('/api/auth/profile');
  await requireStatus(profile.response, 200, `${label} profile`);
  const userId = profile.payload?.data?.user?.id;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error(`${label}: registration did not produce an authenticated user identity.`);
  }
  const sessionId = profile.payload?.data?.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error(`${label}: profile did not expose the active server session ID.`);
  }
  return { userId, sessionId };
}

async function loginUser(session, label, email, password, expectedUserId) {
  await session.refreshCsrf();
  const login = await session.json('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  await requireStatus(login.response, 200, `${label} login`);
  const expiresAt = login.payload?.data?.expiresAt;
  if (
    typeof expiresAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(expiresAt)
  ) {
    throw new Error(`${label}: login response omitted a valid session expiresAt.`);
  }
  const expirationMs = Date.parse(expiresAt);
  if (!Number.isFinite(expirationMs) || expirationMs <= Date.now()) {
    throw new Error(`${label}: login response session expiresAt is malformed or already expired.`);
  }
  const sessionExpiresAt = new Date(expirationMs).toISOString();
  await session.refreshCsrf();

  const profile = await session.json('/api/auth/profile');
  await requireStatus(profile.response, 200, `${label} profile`);
  const userId = profile.payload?.data?.user?.id;
  const sessionId = profile.payload?.data?.sessionId;
  if (userId !== expectedUserId) throw new Error(`${label}: login returned a different owner identity.`);
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error(`${label}: profile did not expose the active server session ID.`);
  }
  return { sessionId, sessionExpiresAt };
}

async function expectAuthCheck(session, expectedAuthenticated, stage, expectedUserId) {
  const { response, payload } = await session.json('/api/auth/check');
  await requireStatus(response, 200, stage);
  const authenticated = payload?.data?.authenticated;
  if (authenticated !== expectedAuthenticated) {
    throw new Error(`${stage}: expected authenticated=${expectedAuthenticated}, received ${String(authenticated)}.`);
  }
  if (expectedAuthenticated && expectedUserId && payload?.data?.user?.id !== expectedUserId) {
    throw new Error(`${stage}: authenticated check returned a different user identity.`);
  }
  return authenticated;
}

async function verifyLogoutAndRelogin(
  session,
  sameUserSession,
  otherUserSession,
  email,
  password,
  userId,
  otherUserId,
  sessionId,
  sameUserSessionId,
) {
  if (sessionId === sameUserSessionId) {
    throw new Error('User A primary and independent sessions unexpectedly share a server session ID.');
  }

  await expectAuthCheck(session, true, 'User A pre-logout auth/check', userId);
  await expectAuthCheck(sameUserSession, true, 'User A second session pre-logout auth/check', userId);
  await expectAuthCheck(otherUserSession, true, 'User B pre-logout auth/check', otherUserId);

  await session.refreshCsrf();
  const oldSession = new RuntimeSession('revoked-session');
  oldSession.cookies = new Map(session.cookies);
  oldSession.csrfToken = session.csrfToken;
  oldSession.csrfHeader = session.csrfHeader;
  await expectAuthCheck(oldSession, true, 'Exact pre-logout cookie auth/check', userId);

  const logoutResponse = await session.request('/api/auth/logout', { method: 'POST' });
  await requireStatus(logoutResponse, 200, 'User A logout');

  await expectAuthCheck(oldSession, false, 'Revoked User A auth/check');
  const revoked = await oldSession.json('/api/auth/profile');
  await requireStatus(revoked.response, [401, 403], 'revoked User A session');
  const logoutBody = await logoutResponse.json();
  if (logoutBody?.success !== true) throw new Error('User A logout did not confirm success.');

  session.cookies.clear();
  session.csrfToken = undefined;
  const freshSession = await loginUser(session, 'User A fresh login', email, password, userId);
  await expectAuthCheck(session, true, 'User A fresh-session auth/check', userId);
  await expectAuthCheck(oldSession, false, 'Revoked User A auth/check after fresh login');
  await expectAuthCheck(sameUserSession, true, 'User A independent-session auth/check after logout', userId);
  await expectAuthCheck(otherUserSession, true, 'User B auth/check after User A logout', otherUserId);

  const profile = await session.json('/api/auth/profile');
  await requireStatus(profile.response, 200, 'User A fresh-login profile');
  if (profile.payload?.data?.user?.id !== userId) {
    throw new Error('User A fresh login returned a different owner identity.');
  }
  return freshSession;
}

async function acquireCheckpointLock() {
  let lock;
  try {
    lock = await open(CHECKPOINT_LOCK_PATH, 'wx', 0o600);
    await lock.close();
    await access(CHECKPOINT_PATH);
    await unlink(CHECKPOINT_LOCK_PATH);
    throw new Error('A private acceptance checkpoint already exists; refusing to register users or create another agent.');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('A private acceptance run or checkpoint already exists; refusing to create more test data.');
    }
    if (error?.code !== 'ENOENT') throw error;
  }
  return async () => {
    await unlink(CHECKPOINT_LOCK_PATH).catch(() => undefined);
  };
}

async function writeCheckpoint(session, userId, sessionId, sessionExpiresAt, agentId, stage) {
  const temporaryPath = `${CHECKPOINT_PATH}.${process.pid}.${randomUUID()}.tmp`;
  const payload = {
    base: BASE,
    stage,
    recordedAt: new Date().toISOString(),
    sessionExpiresAt,
    userId,
    sessionId,
    cookies: [...session.cookies.entries()],
    csrfToken: session.csrfToken,
    csrfHeader: session.csrfHeader,
    agentId: agentId ?? null,
    passwordsPersisted: false,
  };
  const file = await open(temporaryPath, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporaryPath, CHECKPOINT_PATH);
    await chmod(CHECKPOINT_PATH, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function readNdjsonAgentId(response, timeoutMs) {
  async function readChunk() {
    let timer;
    try {
      return await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Agent initialization stream timed out; outcome is unknown; do not retry.')),
            Math.max(1, deadline - Date.now()),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  if (!response.body) throw new Error('Agent creation returned no response stream; outcome is unknown.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  let agentId;

  while (Date.now() < deadline) {
    const next = await readChunk();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });

    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error('Agent creation returned malformed NDJSON; outcome is unknown.');
      }
      if (event.agentId && !agentId) {
        agentId = event.agentId;
        report('agent-created', { agentId });
      }
      if (event.error) {
        throw new Error(`Agent initialization failed after creation (${agentId ?? 'ID not received'}); do not retry.`);
      }
    }
  }

  if (!agentId) throw new Error('Agent creation outcome is unknown because no streamed agent ID arrived; do not retry.');
  return agentId;
}

async function getAgentTicket(session, agentId) {
  const { response, payload } = await session.json('/api/ws-ticket', {
    method: 'POST',
    body: { resourceType: 'agent', resourceId: agentId },
  });
  await requireStatus(response, 200, 'owner WebSocket ticket');
  if (typeof payload?.data?.ticket !== 'string' || payload.data.ticket.length === 0) {
    throw new Error('Owner WebSocket ticket response omitted its ticket.');
  }
  return payload.data.ticket;
}

function connectWebSocket(agentId, ticket) {
  const url = new URL(`/api/agent/${encodeURIComponent(agentId)}/ws`, BASE);
  url.protocol = 'wss:';
  url.searchParams.set('ticket', ticket);
  if (url.origin !== origin.replace(/^https:/, 'wss:')) {
    throw new Error('Refusing to open a WebSocket outside the private runtime origin.');
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { maxPayload: 2 * 1024 * 1024 });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.terminate();
      reject(new Error('WebSocket did not connect before timeout.'));
    }, WS_CONNECT_TIMEOUT_MS);
    socket.once('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('unexpected-response', (_request, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      response.resume();
      reject(new Error(`WebSocket upgrade was rejected with HTTP ${response.statusCode ?? 'unknown'}.`));
    });
    socket.once('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('WebSocket connection failed; abort without retrying any generation request.'));
    });
  });
}

async function runSingleGeneration(session, agentId) {
  const ticket = await getAgentTicket(session, agentId);
  const socket = await connectWebSocket(agentId, ticket);

  return new Promise((resolve, reject) => {
    let suggestionSent = false;
    let completed = false;
    let fileEvents = 0;
    let markerObservedInGeneratedFile = false;
    let successfulToolEvents = 0;
    const timer = setTimeout(() => {
      if (completed) return;
      completed = true;
      socket.close();
      reject(new Error('Generation did not reach a terminal response; outcome is unknown and no retry was sent.'));
    }, GENERATION_TIMEOUT_MS);

    socket.on('message', (wireMessage) => {
      let event;
      try {
        event = JSON.parse(wireMessage.toString());
      } catch {
        return;
      }

      if (event.type === 'error') {
        clearTimeout(timer);
        if (!completed) {
          completed = true;
          socket.close();
          reject(new Error('Runtime returned a WebSocket error during the one allowed generation.'));
        }
        return;
      }

      if (event.type === 'file_generated' || event.type === 'file_deleted') fileEvents += 1;
      if (event.type === 'file_generated' && JSON.stringify(event.file ?? {}).includes(MARKER)) {
        markerObservedInGeneratedFile = true;
      }
      if (event.type === 'conversation_response' && event.tool?.status === 'success') successfulToolEvents += 1;

      if (event.type === 'agent_connected' && !suggestionSent) {
        suggestionSent = true;
        socket.send(JSON.stringify({
          type: 'user_suggestion',
          message: [
            'Create a minimal, valid, locally runnable Vite React application.',
            `Render this exact marker prominently on the page: ${MARKER}.`,
            'Keep the implementation tiny; use only local assets and do not add unrelated features.',
          ].join(' '),
        }));
        report('generation-started', { agentId, suggestionsSent: 1 });
        return;
      }

      if (event.type === 'conversation_response' && suggestionSent && event.isStreaming === false && !event.tool && !completed) {
        completed = true;
        clearTimeout(timer);
        setTimeout(() => {
          socket.close();
          report('generation-stream-ended-authority-unverified', {
            agentId,
            textResponseEnded: true,
            fileEvents,
            markerObservedInGeneratedFile,
            successfulToolEvents,
            authoritativeGitAndPreviewStillRequired: true,
          });
          resolve({ fileEvents, successfulToolEvents });
        }, 1500);
      }
    });

    socket.once('close', () => {
      if (!suggestionSent && !completed) {
        clearTimeout(timer);
        completed = true;
        reject(new Error('WebSocket closed before the one allowed suggestion was sent.'));
      } else if (suggestionSent && !completed) {
        clearTimeout(timer);
        completed = true;
        reject(new Error('WebSocket closed before generation completion; outcome is unknown and no retry was sent.'));
      }
    });
  });
}

async function verifyReconnect(session, agentId, expectedUserId) {
  const connect = await session.json(`/api/agent/${encodeURIComponent(agentId)}/connect`);
  await requireStatus(connect.response, 200, 'owner reconnect');
  if (connect.payload?.data?.agentId !== agentId) {
    throw new Error('Owner reconnect did not return the original agent identity.');
  }

  const ownerProfile = await session.json('/api/auth/profile');
  await requireStatus(ownerProfile.response, 200, 'owner after reconnect');
  if (ownerProfile.payload?.data?.user?.id !== expectedUserId) {
    throw new Error('Reconnect owner identity changed unexpectedly.');
  }

  const branches = await session.json(`/api/agent/${encodeURIComponent(agentId)}/branches`);
  await requireStatus(branches.response, 200, 'owner branch state');
  report('reconnect-verified', {
    agentId,
    initialized: true,
    currentBranchPresent: typeof branches.payload?.data?.current === 'string',
    branchCount: Array.isArray(branches.payload?.data?.branches) ? branches.payload.data.branches.length : 0,
  });

  const ticket = await getAgentTicket(session, agentId);
  const socket = await connectWebSocket(agentId, ticket);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Reconnect WebSocket did not restore agent state before timeout.'));
    }, WS_CONNECT_TIMEOUT_MS);
    socket.on('message', (wireMessage) => {
      let event;
      try {
        event = JSON.parse(wireMessage.toString());
      } catch {
        return;
      }
      if (event.type !== 'agent_connected') return;
      clearTimeout(timer);
      socket.close();
      resolve();
    });
    socket.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Reconnect WebSocket failed.'));
    });
  });
  report('reconnect-state-restored', { agentId, agentConnected: true });
}

async function main() {
  let releaseCheckpointLock;
  let userAId;
  let agentId;
  let authVerified = false;
  let generationStreamEnded = false;
  let reconnectVerified = false;
  try {
    releaseCheckpointLock = await acquireCheckpointLock();

    const health = await fetch(new URL('/health', BASE), {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await requireStatus(health, 200, 'private runtime health');
    report('health', { status: health.status });

    const runId = randomUUID();
    const userA = new RuntimeSession('user-a');
    const userB = new RuntimeSession('user-b');
    const userASecondSession = new RuntimeSession('user-a-second-session');
    const emailA = `launch-a-${runId}@example.invalid`;
    const emailB = `launch-b-${runId}@example.invalid`;
    const passwordA = randomBytes(32).toString('base64url');
    const passwordB = randomBytes(32).toString('base64url');

    const userAAuth = await registerUser(userA, 'User A', emailA, passwordA);
    userAId = userAAuth.userId;
    report('user-a-registration-profile', { authenticated: true, userId: userAId });

    const userBAuth = await registerUser(userB, 'User B', emailB, passwordB);
    const userBId = userBAuth.userId;
    if (userAId === userBId) throw new Error('Disposable users unexpectedly share an identity.');
    report('user-b-registration-profile', { authenticated: true, independentIdentity: true, userId: userBId });

    const userASecondSessionId = await loginUser(
      userASecondSession,
      'User A independent session',
      emailA,
      passwordA,
      userAId,
    );
    const freshSession = await verifyLogoutAndRelogin(
      userA,
      userASecondSession,
      userB,
      emailA,
      passwordA,
      userAId,
      userBId,
      userAAuth.sessionId,
      userASecondSessionId,
    );
    const { sessionId: freshSessionId, sessionExpiresAt } = freshSession;
    if (freshSessionId === userAAuth.sessionId) {
      throw new Error('Fresh User A login reused the revoked session ID.');
    }
    await expectAuthCheck(userASecondSession, true, 'User A second session after relogin', userAId);
    await expectAuthCheck(userB, true, 'User B session after User A relogin', userBId);
    authVerified = true;
    report('logout-session-isolation', {
      csrfPass: true,
      registrationPass: true,
      loginPass: true,
      oldSessionRejected: true,
      freshSessionAccepted: true,
      revokedSessionStayedInvalid: true,
      sameUserOtherSessionUnaffected: true,
      otherUserSessionUnaffected: true,
      deploysSent: 0,
    });

    await writeCheckpoint(userA, userAId, freshSessionId, sessionExpiresAt, null, 'auth-verified-agent-not-created');

    const createResponse = await userA.request('/api/agent', {
      method: 'POST',
      timeoutMs: AGENT_INIT_TIMEOUT_MS,
      body: {
        behaviorType: 'think',
        projectType: 'app',
        query: 'Private BuildCustom runtime acceptance app',
      },
    });
    await requireStatus(createResponse, 200, 'one Think-agent creation');
    agentId = await readNdjsonAgentId(createResponse, AGENT_INIT_TIMEOUT_MS);
    await writeCheckpoint(userA, userAId, freshSessionId, sessionExpiresAt, agentId, 'agent-created-generation-not-started');

    const owner = await userA.json(`/api/agent/${encodeURIComponent(agentId)}/connect`);
    await requireStatus(owner.response, 200, 'User A owner access');
    const nonOwner = await userB.json(`/api/agent/${encodeURIComponent(agentId)}/connect`);
    await requireStatus(nonOwner.response, [403, 404], 'User B owner isolation');
    const nonOwnerTicket = await userB.json('/api/ws-ticket', {
      method: 'POST',
      body: { resourceType: 'agent', resourceId: agentId },
    });
    await requireStatus(nonOwnerTicket.response, [403, 404], 'User B owner-only ticket isolation');
    report('owner-isolation', { agentId, ownerAllowed: true, nonOwnerDenied: true, nonOwnerTicketDenied: true });

    await writeCheckpoint(userA, userAId, freshSessionId, sessionExpiresAt, agentId, 'generation-starting');
    await runSingleGeneration(userA, agentId);
    generationStreamEnded = true;
    await writeCheckpoint(userA, userAId, freshSessionId, sessionExpiresAt, agentId, 'generation-stream-ended-authority-unverified');
    await verifyReconnect(userA, agentId, userAId);
    reconnectVerified = true;
    await writeCheckpoint(userA, userAId, freshSessionId, sessionExpiresAt, agentId, 'reconnect-verified-authority-unverified');
    report('private-runtime-harness-finished', {
      agentId,
      csrfVerified: authVerified,
      authVerified,
      ownershipIsolationVerified: true,
      generationStreamEnded,
      generationCompleted: false,
      reconnectVerified,
      authoritativeFilesVerified: false,
      previewVerified: false,
      immutableDeploymentVerified: false,
      task6Accepted: false,
      disposableUsersCreatedThisRun: 2,
      thinkAgentsCreated: 1,
      generationSuggestionsSent: 1,
      deploysSent: 0,
      ownerCookieCheckpointSaved: true,
      checkpointPermissions: '0600',
      passwordsPersisted: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected acceptance failure.';
    fail('acceptance-harness-aborted', message, {
      ...(userAId ? { userAId } : {}),
      ...(agentId ? { agentId } : {}),
      authVerified,
      generationStreamEnded,
      reconnectVerified,
      deploysSent: 0,
    });
  } finally {
    await releaseCheckpointLock?.();
  }
}

await main();