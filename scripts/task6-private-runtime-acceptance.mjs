#!/usr/bin/env node

import { randomBytes, randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const BASE = 'https://buildcustom-vibesdk-launch.thegoldimport.workers.dev';
const REQUIRED_BASE = 'https://buildcustom-vibesdk-launch.thegoldimport.workers.dev';
const MARKER = 'BUILDCUSTOM_PROD_RUNTIME_OK';
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
  return userId;
}

async function verifyLogoutAndRelogin(session, email, password, userId) {
  await session.refreshCsrf();
  const oldSession = new RuntimeSession('revoked-session');
  oldSession.cookies = new Map(session.cookies);

  const logoutResponse = await session.request('/api/auth/logout', { method: 'POST' });
  await requireStatus(logoutResponse, 200, 'User A logout');

  const revoked = await oldSession.json('/api/auth/profile');
  await requireStatus(revoked.response, [401, 403], 'revoked User A session');

  session.cookies.clear();
  session.csrfToken = undefined;
  await session.refreshCsrf();
  const login = await session.json('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  await requireStatus(login.response, 200, 'User A relogin');
  await session.refreshCsrf();
  const profile = await session.json('/api/auth/profile');
  await requireStatus(profile.response, 200, 'User A relogin profile');
  if (profile.payload?.data?.user?.id !== userId) {
    throw new Error('User A relogin returned a different owner identity.');
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

      if (event.type === 'conversation_response' && suggestionSent && event.isStreaming === false && !completed) {
        completed = true;
        clearTimeout(timer);
        setTimeout(() => {
          socket.close();
          report('generation-finished', {
            agentId,
            terminalResponse: true,
            fileEvents,
            markerObservedInGeneratedFile,
            successfulToolEvents,
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
  const health = await fetch(new URL('/health', BASE), {
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await requireStatus(health, 200, 'private runtime health');
  report('health', { status: health.status });

  const runId = randomUUID();
  const userA = new RuntimeSession('user-a');
  const userB = new RuntimeSession('user-b');
  const emailA = `launch-a-${runId}@example.invalid`;
  const emailB = `launch-b-${runId}@example.invalid`;
  const passwordA = randomBytes(32).toString('base64url');
  const passwordB = randomBytes(32).toString('base64url');

  let userAId;
  try {
    userAId = await registerUser(userA, 'User A', emailA, passwordA);
    report('user-a-registration-profile', { authenticated: true, userId: userAId });
    await verifyLogoutAndRelogin(userA, emailA, passwordA, userAId);
    report('user-a-logout-relogin', { sessionRejectedAfterLogout: true, relogin: true });

    const userBId = await registerUser(userB, 'User B', emailB, passwordB);
    if (userAId === userBId) throw new Error('Disposable users unexpectedly share an identity.');
    report('user-b-registration-profile', { authenticated: true, independentIdentity: true, userId: userBId });

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
    const agentId = await readNdjsonAgentId(createResponse, AGENT_INIT_TIMEOUT_MS);

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

    await runSingleGeneration(userA, agentId);
    await verifyReconnect(userA, agentId, userAId);
    report('acceptance-harness-finished', {
      agentId,
      disposableUsers: 2,
      thinkAgentsCreated: 1,
      generationSuggestionsSent: 1,
      deploysSent: 0,
      credentialsOrCookiesPersisted: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected acceptance failure.';
    fail('acceptance-harness-aborted', message, userAId ? { userAId } : {});
  }
}

await main();