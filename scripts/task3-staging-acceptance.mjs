#!/usr/bin/env node

/**
 * Cautious, explicitly phased live-staging acceptance harness for Task 3.
 *
 * This script is intentionally inert until a phase is named:
 *   node scripts/task3-staging-acceptance.mjs smoke
 *   node scripts/task3-staging-acceptance.mjs initial
 *   node scripts/task3-staging-acceptance.mjs reconcile-initial
 *   node scripts/task3-staging-acceptance.mjs edit
 *   node scripts/task3-staging-acceptance.mjs reconcile-edit
 *   node scripts/task3-staging-acceptance.mjs reopen
 *
 * `smoke` creates disposable accounts/projects but sends no prompts.
 * `initial` and `edit` each make one irreversible inference attempt; their
 * attempted flags are persisted before the corresponding native WS frame.
 */
import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const STAGING_ORIGIN = "https://buildcustom-control-plane-staging.thegoldimport.workers.dev";
const STOCK_ORIGIN = "https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev";
const STATE_PATH = "/tmp/buildcustom-task3-acceptance.json";
const STATE_MODE = 0o600;
const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;
const INITIAL_PROMPT = "Create a minimal website for a fictional coffee shop called Northstar Coffee. The homepage must display the exact heading BUILDCUSTOM_TASK3_INITIAL_OK. Include a stylesheet and keep the application small.";
const EDIT_PROMPT = "Change the main heading to exactly BUILDCUSTOM_TASK3_EDIT_OK and add a short line beneath it that says Fresh coffee. Simple mornings.";

const configPath = new URL("../wrangler.staging.jsonc", import.meta.url);
const configText = await readFile(configPath, "utf8");
if (!configText.includes(`"STAGING_ALLOWED_ORIGIN": "${STAGING_ORIGIN}"`)
  || !configText.includes(`"AUTH_RUNTIME_URL": "${STOCK_ORIGIN}"`)) {
  throw new Error("Configured staging/runtime endpoints differ from wrangler.staging.jsonc; refusing to run.");
}

const phase = process.argv[2];
const validPhases = ["smoke", "initial", "reconcile-initial", "edit", "reconcile-edit", "reopen"];
if (!validPhases.includes(phase)) {
  console.error(JSON.stringify({
    usage: `node ${fileURLToPath(import.meta.url)} <${validPhases.join("|")}>`,
    phases: validPhases,
    warning: "Live staging only. Initial/edit each send exactly one inference request.",
  }, null, 2));
  process.exit(2);
}

const newState = () => ({
  schemaVersion: 1,
  endpoints: { stagingOrigin: STAGING_ORIGIN, stockOrigin: STOCK_ORIGIN },
  createdAt: new Date().toISOString(),
  users: {},
  projects: {},
  phases: {},
});

async function loadState() {
  try {
    const value = JSON.parse(await readFile(STATE_PATH, "utf8"));
    if (value?.schemaVersion !== 1 || !value.users || !value.projects || !value.phases) {
      throw new Error("The saved acceptance state has an unsupported shape.");
    }
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return newState();
    throw error;
  }
}

let state = await loadState();
const secrets = new Set();

function rememberJar(jar) {
  for (const value of Object.values(jar || {})) if (value) secrets.add(String(value));
}

function refreshSecrets() {
  secrets.clear();
  for (const user of Object.values(state.users || {})) {
    if (user.password) secrets.add(String(user.password));
    rememberJar(user.cookieJar);
  }
}

function safeFrameType(value) {
  if (typeof value !== "string") return "unknown";
  if (/^[a-z][a-z0-9_-]{0,99}$/i.test(value)) return value;
  if (value.startsWith("{")) {
    try {
      const nested = JSON.parse(value);
      if (typeof nested?.type === "string" && /^cf_agent_/i.test(nested.type)) {
        return "filtered_cf_agent_envelope";
      }
    } catch { /* Unknown framework envelope; never retain its contents. */ }
  }
  return "unrecognized_frame_type";
}

function safeFrameCounts(counts) {
  const result = {};
  for (const [type, count] of Object.entries(counts || {})) {
    const safeType = safeFrameType(type);
    result[safeType] = (result[safeType] || 0) + (Number(count) || 0);
  }
  return result;
}

async function saveState() {
  for (const entry of Object.values(state.phases || {})) {
    if (entry.frameCounts) entry.frameCounts = safeFrameCounts(entry.frameCounts);
    if (entry.result?.nativeFrameCounts) entry.result.nativeFrameCounts = safeFrameCounts(entry.result.nativeFrameCounts);
  }
  refreshSecrets();
  const tempPath = `${STATE_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: STATE_MODE });
  await chmod(tempPath, STATE_MODE);
  await rename(tempPath, STATE_PATH);
  await chmod(STATE_PATH, STATE_MODE);
}

function sanitize(value) {
  let text = String(value ?? "");
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(/(accessToken|csrf-token|__Host-cf_oauth_token|sessionId)=([^;\s]+)/gi, "$1=[REDACTED]")
    .replace(/\btk_[a-f0-9]{16,}\b/gi, "[REDACTED_TICKET]")
    .replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{5,}\b/g, "[REDACTED_TOKEN]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
      try {
        const url = new URL(raw);
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[REDACTED_URL]";
      }
    });
}

function errorText(error) {
  return sanitize(error instanceof Error ? error.message : error);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookiesFrom(response) {
  const headers = response.headers;
  const setCookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : (headers.get("set-cookie") ? [headers.get("set-cookie")] : []);
  const result = [];
  for (const header of setCookies) {
    const match = header.match(/^\s*(accessToken|csrf-token)=([^;]*)/i);
    if (match && match[2]) result.push([match[1], match[2]]);
  }
  return result;
}

function jarHeader(jar) {
  return Object.entries(jar || {}).map(([name, value]) => `${name}=${value}`).join("; ");
}

async function request(path, { jar, csrf, method = "GET", body, headers = {}, base = STAGING_ORIGIN } = {}) {
  const outgoing = new Headers({ Accept: "application/json", Origin: STAGING_ORIGIN, ...headers });
  if (jar && Object.keys(jar).length) outgoing.set("Cookie", jarHeader(jar));
  if (csrf) outgoing.set("X-CSRF-Token", csrf);
  if (body !== undefined) outgoing.set("Content-Type", "application/json");
  let response;
  try {
    response = await fetch(new URL(path, base), {
      method,
      headers: outgoing,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    throw new Error(`Request failed (${method} ${path}): ${errorText(error)}`);
  }
  for (const [name, value] of cookiesFrom(response)) {
    if (jar) jar[name] = value;
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* report status without body */ }
  return { response, data, text };
}

async function api(path, options = {}) {
  const result = await request(path, options);
  if (!result.response.ok) {
    const detail = typeof result.data?.message === "string" ? result.data.message : `HTTP ${result.response.status}`;
    throw new Error(`${options.method || "GET"} ${path} returned ${result.response.status}: ${sanitize(detail)}`);
  }
  return { ...result, status: result.response.status };
}

async function csrfToken(jar) {
  const result = await api("/api/auth/csrf-token", { jar });
  const token = result.data?.token;
  assert(typeof token === "string" && token.length > 0, "CSRF endpoint did not return a token.");
  return token;
}

function generatedUser(label) {
  const suffix = randomBytes(8).toString("hex");
  return {
    name: `Task 3 disposable ${label}`,
    email: `buildcustom-task3-${label.toLowerCase()}-${suffix}@example.com`,
    password: `T3-${randomBytes(24).toString("base64url")}!`,
    cookieJar: {},
  };
}

async function authenticate(user, mode = "register") {
  user.cookieJar ||= {};
  const csrf = await csrfToken(user.cookieJar);
  const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
  const payload = mode === "register"
    ? { name: user.name, email: user.email, password: user.password }
    : { email: user.email, password: user.password };
  const result = await api(path, { method: "POST", jar: user.cookieJar, csrf, body: payload });
  const me = await api("/api/auth/me", { jar: user.cookieJar });
  assert(me.data && typeof me.data.id === "string", "Authenticated user identity was not returned.");
  user.id = me.data.id;
  user.displayName = me.data.username || user.name;
  return { csrf, user: result.data };
}

async function createLinkedProject(user, name, creationKey) {
  const csrf = await csrfToken(user.cookieJar);
  const result = await api("/api/projects", {
    method: "POST",
    jar: user.cookieJar,
    csrf,
    headers: { "Idempotency-Key": creationKey },
    body: { name, type: "website", description: "Disposable Task 3 staging acceptance project.", framework: "React + TailwindCSS" },
  });
  const project = result.data;
  assert(Number.isSafeInteger(Number(project?.id)), `Project creation returned no project ID (HTTP ${result.status}).`);
  const id = Number(project.id);
  const deadline = Date.now() + 180_000;
  let current = project;
  while ((!current.agentId || current.runtimeStatus !== "ready") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const refreshed = await api(`/api/projects/${id}`, { jar: user.cookieJar });
    current = refreshed.data;
  }
  assert(current?.agentId && current.runtimeStatus === "ready", `Task 2 project ${id} did not become linked and ready.`);
  return { id, agentId: String(current.agentId), name, status: result.status };
}

function runtimePath(project, operation) {
  return `/api/projects/${project.id}/runtime/${operation}`;
}

async function runtimeGet(user, project, operation) {
  return api(runtimePath(project, operation), { jar: user.cookieJar });
}

function wsAddress(path, origin = STAGING_ORIGIN) {
  const url = new URL(path, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function openSocket(url, { jar, origin = STAGING_ORIGIN } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Origin: origin };
    if (jar && Object.keys(jar).length) headers.Cookie = jarHeader(jar);
    let settled = false;
    const socket = new WebSocket(url, { headers, handshakeTimeout: 15_000, perMessageDeflate: false });
    const timeout = setTimeout(() => finish(new Error("WebSocket handshake timed out.")), 16_000);
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        try { socket.terminate(); } catch { /* socket may not exist */ }
        reject(error);
      } else resolve(value);
    }
    socket.once("open", () => finish(null, socket));
    socket.once("unexpected-response", (_request, response) => {
      const status = response.statusCode || 0;
      response.resume();
      finish(Object.assign(new Error(`WebSocket handshake rejected with HTTP ${status}.`), { status }));
    });
    socket.once("error", (error) => finish(new Error(`WebSocket connection failed: ${error.message}`)));
  });
}

async function wsProbe(path, { jar, sendFrame, waitForType, timeoutMs = 20_000 } = {}) {
  const socket = await openSocket(wsAddress(path), { jar });
  const counts = {};
  let sawAgentConnected = false;
  const messages = [];
  try {
    const done = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebSocket response timed out.")), timeoutMs);
      socket.on("message", (data) => {
        let frame;
        try { frame = JSON.parse(data.toString()); } catch { return; }
        const type = safeFrameType(frame?.type);
        counts[type] = (counts[type] || 0) + 1;
        if (type === "agent_connected") sawAgentConnected = true;
        if (type === waitForType) {
          clearTimeout(timeout);
          resolve(frame);
        }
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket stream failed: ${error.message}`));
      });
    });
    if (sendFrame) socket.send(JSON.stringify(sendFrame));
    const frame = await done;
    messages.push(frame.type);
    return { counts, sawAgentConnected, received: messages };
  } finally {
    try { socket.close(1000, "Acceptance read complete."); } catch { /* already closed */ }
  }
}

async function unauthenticatedWsStatus(project) {
  try {
    const socket = await openSocket(wsAddress(runtimePath(project, "ws")));
    try { socket.close(1000, "Unauthenticated access probe."); } catch { /* noop */ }
    return { status: 101, denied: false };
  } catch (error) {
    return { status: Number(error.status) || null, denied: error.status !== 101 };
  }
}

async function fileSnapshot(user, project) {
  const listed = await runtimeGet(user, project, "files");
  assert(Array.isArray(listed.data), "Authoritative files endpoint did not return a list.");
  const files = [];
  for (const entry of listed.data) {
    if (typeof entry?.path !== "string") continue;
    const result = await api(`${runtimePath(project, "files/content")}?path=${encodeURIComponent(entry.path)}`, { jar: user.cookieJar });
    files.push({ path: entry.path, content: typeof result.data?.content === "string" ? result.data.content : "" });
  }
  return files;
}

function markerSummary(files, marker) {
  const matchingFiles = files.filter((file) => file.content.includes(marker)).map((file) => file.path);
  return { found: matchingFiles.length > 0, paths: matchingFiles };
}

async function directStockRequest(path, { jar, csrf, method = "GET", body } = {}) {
  return request(path, { base: STOCK_ORIGIN, jar, csrf, method, body });
}

async function directTicketSmoke(projectA, projectB, userA, csrfA) {
  const summary = {
    scope: { attempted: false, denied: null },
    reuse: { attempted: false, firstHandshake: null, secondDenied: null },
    expiry: { attempted: false, expectedDelayMs: 16_500, denied: null },
  };
  try {
    const scope = await directStockRequest("/api/ws-ticket", {
      jar: userA.cookieJar, csrf: csrfA, method: "POST",
      body: { resourceType: "agent", resourceId: projectB.agentId },
    });
    summary.scope.attempted = true;
    summary.scope.denied = !scope.response.ok;
    summary.scope.httpStatus = scope.response.status;
  } catch (error) {
    summary.scope.attempted = true;
    summary.scope.error = errorText(error);
  }

  try {
    const ticketResponse = await directStockRequest("/api/ws-ticket", {
      jar: userA.cookieJar, csrf: csrfA, method: "POST",
      body: { resourceType: "agent", resourceId: projectA.agentId },
    });
    summary.reuse.attempted = true;
    summary.reuse.ticketHttpStatus = ticketResponse.response.status;
    const ticket = ticketResponse.data?.data?.ticket ?? ticketResponse.data?.ticket;
    if (!ticketResponse.response.ok || typeof ticket !== "string") {
      summary.reuse.error = `Ticket issuance returned HTTP ${ticketResponse.response.status}.`;
    } else {
      const connectOnce = async () => {
        const path = `/api/agent/${encodeURIComponent(projectA.agentId)}/ws?ticket=${encodeURIComponent(ticket)}`;
        try {
          const socket = await openSocket(wsAddress(path, STOCK_ORIGIN), { jar: userA.cookieJar, origin: STOCK_ORIGIN });
          socket.close(1000, "One-time ticket probe complete.");
          return { connected: true, status: 101 };
        } catch (error) {
          return { connected: false, status: Number(error.status) || null };
        }
      };
      const first = await connectOnce();
      summary.reuse.firstHandshake = first.status;
      const second = await connectOnce();
      summary.reuse.secondDenied = !second.connected;
      summary.reuse.secondHandshake = second.status;
    }
  } catch (error) {
    summary.reuse.attempted = true;
    summary.reuse.error = errorText(error);
  }

  try {
    summary.expiry.attempted = true;
    const issued = await directStockRequest("/api/ws-ticket", {
      jar: userA.cookieJar, csrf: csrfA, method: "POST",
      body: { resourceType: "agent", resourceId: projectA.agentId },
    });
    summary.expiry.ticketHttpStatus = issued.response.status;
    const ticket = issued.data?.data?.ticket ?? issued.data?.ticket;
    if (!issued.response.ok || typeof ticket !== "string") {
      summary.expiry.error = `Ticket issuance returned HTTP ${issued.response.status}.`;
    } else {
      await new Promise((resolve) => setTimeout(resolve, summary.expiry.expectedDelayMs));
      const path = `/api/agent/${encodeURIComponent(projectA.agentId)}/ws?ticket=${encodeURIComponent(ticket)}`;
      try {
        const socket = await openSocket(wsAddress(path, STOCK_ORIGIN), { jar: userA.cookieJar, origin: STOCK_ORIGIN });
        summary.expiry.denied = false;
        summary.expiry.handshakeStatus = 101;
        socket.close(1000, "Expired-ticket probe complete.");
      } catch (error) {
        summary.expiry.denied = true;
        summary.expiry.handshakeStatus = Number(error.status) || null;
      }
    }
  } catch (error) {
    summary.expiry.attempted = true;
    summary.expiry.error = errorText(error);
  }
  return summary;
}

async function phaseSmoke() {
  const resumeAfterMissingKey = state.phases.smoke?.status === "failed"
    && state.phases.smoke.error?.includes("A project creation key is required.")
    && Object.keys(state.projects).length === 0
    && state.users.A?.id && state.users.B?.id;
  const resumeLinkedProjects = state.phases.smoke?.status === "failed"
    && state.projects.A?.id && state.projects.A?.agentId
    && state.projects.B?.id && state.projects.B?.agentId
    && !state.phases.initial && !state.phases.edit;
  assert(!state.phases.smoke || resumeAfterMissingKey || resumeLinkedProjects,
    "The smoke phase was already attempted; it will not create duplicate disposable accounts/projects.");
  if (!resumeAfterMissingKey && !resumeLinkedProjects) state.users = { A: generatedUser("A"), B: generatedUser("B") };
  state.phases.smoke = { status: "running", startedAt: new Date().toISOString() };
  await saveState();
  const results = {};
  try {
    if (resumeLinkedProjects) {
      for (const label of ["A", "B"]) {
        const user = state.users[label];
        const project = state.projects[label];
        const [identity, existing] = await Promise.all([
          api("/api/auth/me", { jar: user.cookieJar }),
          api(`/api/projects/${project.id}`, { jar: user.cookieJar }),
        ]);
        assert(identity.data?.id === user.id && Number(existing.data?.id) === project.id
          && existing.data?.agentId === project.agentId,
        `Disposable ${label} ownership or linked agent changed before resuming.`);
      }
    } else if (resumeAfterMissingKey) {
      for (const label of ["A", "B"]) {
        const user = state.users[label];
        const [identity, existing] = await Promise.all([
          api("/api/auth/me", { jar: user.cookieJar }),
          api("/api/projects", { jar: user.cookieJar }),
        ]);
        assert(identity.data?.id === user.id, `Disposable ${label} session changed before resuming.`);
        assert(Array.isArray(existing.data) && !existing.data.some((project) =>
          project.name === `Task 3 Acceptance ${label}`),
        `Disposable ${label} already has a matching project; refusing ambiguous creation.`);
      }
    } else {
      await authenticate(state.users.A, "register");
      await saveState();
      await authenticate(state.users.B, "register");
      await saveState();
    }
    if (!resumeLinkedProjects) {
      state.projectKeys ||= {};
      state.projectKeys.A ||= randomBytes(16).toString("hex");
      await saveState();
      const projectA = await createLinkedProject(state.users.A, "Task 3 Acceptance A", state.projectKeys.A);
      state.projects.A = projectA;
      await saveState();
      state.projectKeys.B ||= randomBytes(16).toString("hex");
      await saveState();
      const projectB = await createLinkedProject(state.users.B, "Task 3 Acceptance B", state.projectKeys.B);
      state.projects.B = projectB;
      await saveState();
    }

    const reads = {};
    for (const label of ["A", "B"]) {
      const user = state.users[label];
      const project = state.projects[label];
      const status = await runtimeGet(user, project, "status");
      const revision = await runtimeGet(user, project, "revision");
      const turns = await runtimeGet(user, project, "turns");
      reads[label] = {
        status: status.status,
        runtimeStatus: status.data?.runtimeStatus,
        connected: status.data?.connected,
        generation: status.data?.state?.generation?.status,
        revision: revision.data?.commitHash ?? null,
        turns: Array.isArray(turns.data?.turns) ? turns.data.turns.length : null,
      };
    }
    const readOnlyWs = await wsProbe(runtimePath(state.projects.A, "ws"), {
      jar: state.users.A.cookieJar,
      sendFrame: { type: "get_conversation_state" },
      waitForType: "conversation_state",
    });
    const wrongOwnerFiles = await request(runtimePath(state.projects.A, "files"), { jar: state.users.B.cookieJar });
    const wrongOwnerPreview = await request(runtimePath(state.projects.A, "previews"), {
      method: "POST",
      jar: state.users.B.cookieJar,
      csrf: (await csrfToken(state.users.B.cookieJar)),
      body: {},
    });
    const substitutedAgent = await request(runtimePath(state.projects.B, `agent/${state.projects.A.agentId}`), {
      jar: state.users.B.cookieJar,
    });
    const unauthWs = await unauthenticatedWsStatus(state.projects.A);
    const ticketTests = await directTicketSmoke(state.projects.A, state.projects.B, state.users.A, await csrfToken(state.users.A.cookieJar));
    assert(readOnlyWs.counts.conversation_state > 0, "Read-only native WebSocket did not return conversation state.");
    results.users = { A: state.users.A.id, B: state.users.B.id };
    results.projects = {
      A: { id: state.projects.A.id, agentId: state.projects.A.agentId },
      B: { id: state.projects.B.id, agentId: state.projects.B.agentId },
    };
    results.readOnly = reads;
    results.websocket = {
      AReadOnly: { frameCounts: readOnlyWs.counts, agentConnectedObserved: readOnlyWs.sawAgentConnected },
      unauthenticated: unauthWs,
    };
    results.ownerIsolation = {
      BReadingAFiles: { httpStatus: wrongOwnerFiles.response.status, denied: !wrongOwnerFiles.response.ok },
      BPreviewingA: { httpStatus: wrongOwnerPreview.response.status, denied: !wrongOwnerPreview.response.ok },
      BSubstitutingAAgentOnBProject: { httpStatus: substitutedAgent.response.status, denied: !substitutedAgent.response.ok },
      directStockTickets: ticketTests,
    };
    state.phases.smoke = { status: "complete", completedAt: new Date().toISOString(), result: results };
    await saveState();
    return results;
  } catch (error) {
    state.phases.smoke = { ...state.phases.smoke, status: "failed", failedAt: new Date().toISOString(), error: errorText(error) };
    await saveState();
    throw error;
  }
}

function phaseStarted(name, attemptedKey) {
  assert(state.phases.smoke?.status === "complete", "Run and complete the smoke phase first.");
  const phaseState = state.phases[name];
  assert(!phaseState, `The ${name} phase already started; prompts are never retried automatically.`);
  if (attemptedKey) {
    const previous = state.phases[name];
    assert(!previous?.[attemptedKey], `The ${name} inference attempt was already recorded.`);
  }
}

async function generationRun(name, prompt, marker, expectedLine) {
  phaseStarted(name);
  const project = state.projects.A;
  assert(project?.id && project?.agentId, "User A's Task 2 project/agent is missing from acceptance state.");
  const owner = state.users.A;
  state.phases[name] = {
    status: "running",
    startedAt: new Date().toISOString(),
    promptAttempted: false,
    projectId: project.id,
    agentId: project.agentId,
    prompt,
    baselineRevision: null,
    frameCounts: {},
  };
  await saveState();
  let socket;
  let closeWasIntentional = false;
  let observedCounts = {};
  let observedProgress = {};
  try {
    const before = await runtimeGet(owner, project, "revision");
    const baselineRevision = before.data?.commitHash ?? null;
    state.phases[name].baselineRevision = baselineRevision;
    const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
    socket = await openSocket(wsAddress(runtimePath(project, "ws")), { jar: owner.cookieJar });
    const counts = {};
    const progress = {
      agentConnected: 0,
      generationStarted: 0,
      generationComplete: 0,
      generationStopped: 0,
      errors: 0,
      activityFrames: 0,
    };
    observedCounts = counts;
    observedProgress = progress;
    let lastFrameAt = Date.now();
    let terminalError = null;
    let generationComplete = false;
    let sawIdleStatus = false;
    let resolveCompletion;
    let rejectCompletion;
    const completionWait = new Promise((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const completionTimeout = setTimeout(() => {
      const error = new Error(`${name} native generation timed out before completion; no prompt retry will be attempted.`);
      terminalError = errorText(error);
      rejectCompletion(error);
    }, Math.max(1, deadline - Date.now()));
    const failStream = (error) => {
      if (terminalError) return;
      terminalError = errorText(error);
      clearTimeout(completionTimeout);
      rejectCompletion(error);
    };
    socket.on("message", async (data) => {
      let frame;
      try { frame = JSON.parse(data.toString()); } catch { return; }
      lastFrameAt = Date.now();
      const type = safeFrameType(frame?.type);
      counts[type] = (counts[type] || 0) + 1;
      if (type === "agent_connected") progress.agentConnected += 1;
      if (type === "generation_started") progress.generationStarted += 1;
      if (type === "generation_complete") progress.generationComplete += 1;
      if (type === "generation_stopped") progress.generationStopped += 1;
      if (type === "error" || type.endsWith("_failed") || type.endsWith("_error")) progress.errors += 1;
      if (/^(tool|file_|deployment_|cloudflare_deployment_|generation_)/.test(type)) progress.activityFrames += 1;

      if (type === "agent_connected" && !state.phases[name].promptAttempted) {
        try {
          assert(frame?.state?.shouldBeGenerating !== true, "The existing agent is already generating; refusing to send a prompt.");
          state.phases[name].promptAttempted = true;
          state.phases[name].promptAttemptedAt = new Date().toISOString();
          state.phases[name].frameCounts = { ...counts };
          await saveState();
          // The durable attempted guard is set before the sole native suggestion send.
          socket.send(JSON.stringify({ type: "user_suggestion", message: prompt }), (error) => {
            if (error) failStream(new Error(`${name} native prompt send failed: ${error.message}`));
          });
        } catch (error) {
          failStream(error);
        }
      }
      if (type === "generation_complete") {
        generationComplete = true;
        clearTimeout(completionTimeout);
        resolveCompletion();
      }
      if (type === "generation_stopped") failStream(new Error(`${name} generation stopped before verified idle.`));
      if (type === "error") {
        const details = typeof frame.error === "string" ? frame.error
          : typeof frame.message === "string" ? frame.message : "unspecified native runtime error";
        failStream(new Error(`${name} terminal runtime error: ${sanitize(details)}`));
      }
      // deployment_failed and other progress/activity frames are observations,
      // not terminal signals; keep observing the autonomous runtime.
    });
    socket.on("error", (error) => failStream(new Error(`${name} WebSocket failed: ${error.message}`)));
    socket.on("close", (code, reason) => {
      if (!closeWasIntentional) {
        failStream(new Error(`${name} WebSocket closed before stable idle verification (code ${code}${reason?.length ? `, ${reason.toString()}` : ""}).`));
      }
    });
    if (socket.readyState !== WebSocket.OPEN) failStream(new Error(`${name} WebSocket closed before prompt send.`));
    try {
      await completionWait;
    } catch (error) {
      throw error;
    }
    assert(state.phases[name].promptAttempted, `${name} prompt was not sent; refusing implicit retry.`);

    let latestRevision = null;
    let latestStatus = null;
    let candidateRevision = null;
    let candidateCheckCount = 0;
    let candidateLastCheckAt = 0;
    while (Date.now() < deadline) {
      if (terminalError) throw new Error(terminalError);
      const [status, revision] = await Promise.all([
        runtimeGet(owner, project, "status"),
        runtimeGet(owner, project, "revision"),
      ]);
      if (terminalError) throw new Error(terminalError);
      latestStatus = status.data;
      latestRevision = revision.data?.commitHash ?? null;
      const checkedAt = Date.now();
      const idle = latestStatus?.state?.generation?.status === "idle"
        && latestStatus?.state?.shouldBeGenerating === false;
      if (idle && latestRevision && latestRevision !== baselineRevision) {
        if (candidateRevision !== latestRevision) {
          candidateRevision = latestRevision;
          candidateCheckCount = 1;
          candidateLastCheckAt = checkedAt;
        } else if (checkedAt - candidateLastCheckAt >= 5_000) {
          candidateCheckCount += 1;
          candidateLastCheckAt = checkedAt;
        }
        if (candidateCheckCount >= 2 && checkedAt - lastFrameAt >= 5_000) {
          sawIdleStatus = true;
          break;
        }
      } else {
        candidateRevision = null;
        candidateCheckCount = 0;
        candidateLastCheckAt = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    if (terminalError) throw new Error(terminalError);
    assert(generationComplete, `${name} did not report generation completion.`);
    assert(sawIdleStatus, `${name} did not reach stable idle with a new authoritative revision and five seconds of native-frame quiet before timeout.`);
    assert(candidateRevision === latestRevision, `${name} authoritative revision changed before stable idle verification.`);
    closeWasIntentional = true;
    try { socket.close(1000, "Stable idle and revision verified."); } catch { /* already closed */ }
    state.phases[name].frameCounts = { ...counts };
    state.phases[name].progress = progress;
    state.phases[name].stableRevisionChecks = candidateCheckCount;
    state.phases[name].nativeFrameQuietMs = Date.now() - lastFrameAt;
    await saveState();

    const [files, turnsResult] = await Promise.all([
      fileSnapshot(owner, project),
      runtimeGet(owner, project, "turns"),
    ]);
    const markerResult = markerSummary(files, marker);
    assert(markerResult.found, `${name} authoritative files lack the required acceptance marker.`);
    if (expectedLine) assert(files.some((file) => file.content.includes(expectedLine)), `${name} authoritative files lack the requested supporting line.`);
    if (name === "edit") {
      assert(files.some((file) => file.content.includes("BUILDCUSTOM_TASK3_EDIT_OK")), "Edited marker is absent from authoritative files.");
      assert(!files.some((file) => /<h[1-6][^>]*>\s*BUILDCUSTOM_TASK3_INITIAL_OK\s*<\/h[1-6]>/i.test(file.content)),
        "The old marker remains as a main heading in authoritative files.");
    }

    const csrf = await csrfToken(owner.cookieJar);
    const preview = await api(runtimePath(project, "previews"), {
      method: "POST",
      jar: owner.cookieJar,
      csrf,
      body: {},
    });
    const previewUrl = preview.data?.url;
    assert(typeof previewUrl === "string", `${name} preview endpoint returned no signed preview URL.`);
    let previewHttpStatus = null;
    let previewContainsMarker = null;
    let previewContainsLine = expectedLine ? null : undefined;
    try {
      const response = await fetch(previewUrl, { redirect: "follow", signal: AbortSignal.timeout(45_000) });
      previewHttpStatus = response.status;
      const html = await response.text();
      // Raw HTML is informational only: SPA previews can render after JavaScript.
      previewContainsMarker = html.includes(marker);
      if (expectedLine) previewContainsLine = html.includes(expectedLine);
    } catch (error) {
      throw new Error(`${name} signed preview request failed: ${errorText(error)}`);
    }
    assert(previewHttpStatus >= 200 && previewHttpStatus < 300, `${name} preview returned HTTP ${previewHttpStatus}.`);

    const result = {
      projectId: project.id,
      agentId: project.agentId,
      baselineRevision,
      revision: latestRevision,
      idle: sawIdleStatus,
      fileCount: files.length,
      marker: markerResult,
      supportingLine: expectedLine ? files.some((file) => file.content.includes(expectedLine)) : undefined,
      turnCount: Array.isArray(turnsResult.data?.turns) ? turnsResult.data.turns.length : null,
      nativeFrameCounts: counts,
      progress,
      previewPostHttpStatus: preview.status,
      previewHttpStatus,
      rawHtmlContainsMarker: previewContainsMarker,
      ...(expectedLine ? { rawHtmlContainsLine: previewContainsLine } : {}),
      stableRevisionChecks: candidateCheckCount,
      nativeFrameQuietMs: Date.now() - lastFrameAt,
    };
    state.phases[name] = {
      ...state.phases[name],
      status: "complete",
      completedAt: new Date().toISOString(),
      promptAttempted: true,
      revision: latestRevision,
      previewUrl,
      result,
    };
    await saveState();
    return result;
  } catch (error) {
    if (socket && !closeWasIntentional) {
      closeWasIntentional = true;
      try { socket.close(1000, "Acceptance phase stopped."); } catch { /* already closed */ }
    }
    if (state.phases[name].promptAttempted) {
      state.phases[name].frameCounts = { ...observedCounts };
      state.phases[name].progress = { ...observedProgress };
    }
    state.phases[name] = {
      ...state.phases[name],
      status: "failed",
      failedAt: new Date().toISOString(),
      error: errorText(error),
    };
    await saveState();
    throw error;
  }
}

async function reconcileGeneration(name, marker, expectedLine) {
  const previous = state.phases[name];
  assert(previous?.status === "failed" && previous.promptAttempted === true && !previous.reconciledAt,
    `Only a failed ${name} stream with one recorded prompt can be reconciled.`);
  assert(state.phases.smoke?.status === "complete", "Complete the no-inference smoke phase first.");
  if (name === "edit") assert(state.phases.initial?.status === "complete", "Initial generation is not verified.");
  const project = state.projects.A;
  const owner = state.users.A;
  assert(previous.projectId === project.id && previous.agentId === project.agentId,
    "The existing project and agent must match the attempted prompt.");
  assert(typeof previous.baselineRevision === "string" || previous.baselineRevision === null,
    "The previous authoritative revision is unknown.");
  const checks = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const [status, revision] = await Promise.all([
      runtimeGet(owner, project, "status"),
      runtimeGet(owner, project, "revision"),
    ]);
    assert(status.data?.state?.generation?.status === "idle"
      && status.data?.state?.shouldBeGenerating === false,
    `${name} is not durably idle; do not reconcile yet.`);
    const hash = revision.data?.commitHash;
    assert(typeof hash === "string" && hash.length === 40 && hash !== previous.baselineRevision,
      `${name} has no new authoritative commit after the attempted prompt.`);
    checks.push(hash);
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  assert(checks[0] === checks[1], `${name} revision changed during reconciliation.`);
  const [files, turns] = await Promise.all([
    fileSnapshot(owner, project),
    runtimeGet(owner, project, "turns"),
  ]);
  const found = markerSummary(files, marker);
  assert(found.found, `${name} marker is absent from committed files.`);
  if (expectedLine) {
    assert(files.some((file) => file.content.includes(expectedLine)), `${name} supporting line is absent.`);
    assert(!files.some((file) => /<h[1-6][^>]*>\s*BUILDCUSTOM_TASK3_INITIAL_OK\s*<\/h[1-6]>/i.test(file.content)),
      "The initial heading is still present in the edited project.");
  }
  const turnCount = Array.isArray(turns.data?.turns) ? turns.data.turns.length : 0;
  assert(turnCount >= (name === "edit" ? 2 : 1), `${name} conversation turn did not persist.`);
  const csrf = await csrfToken(owner.cookieJar);
  const preview = await api(runtimePath(project, "previews"), {
    method: "POST", jar: owner.cookieJar, csrf, body: {},
  });
  const previewUrl = preview.data?.url;
  assert(typeof previewUrl === "string", `${name} stock preview did not return a signed URL.`);
  const previewResponse = await fetch(previewUrl, { redirect: "follow", signal: AbortSignal.timeout(45_000) });
  assert(previewResponse.ok, `${name} preview returned HTTP ${previewResponse.status}.`);
  const html = await previewResponse.text();
  const result = {
    projectId: project.id,
    agentId: project.agentId,
    baselineRevision: previous.baselineRevision,
    revision: checks[1],
    idle: true,
    stableRevisionChecks: 2,
    fileCount: files.length,
    marker: found,
    supportingLine: expectedLine ? files.some((file) => file.content.includes(expectedLine)) : undefined,
    turnCount,
    nativeFrameCounts: previous.frameCounts || {},
    progress: previous.progress || {},
    streamInterrupted: true,
    streamError: previous.error,
    previewPostHttpStatus: preview.status,
    previewHttpStatus: previewResponse.status,
    rawHtmlContainsMarker: html.includes(marker),
    ...(expectedLine ? { rawHtmlContainsLine: html.includes(expectedLine) } : {}),
  };
  state.phases[name] = {
    ...previous, status: "complete", completedAt: new Date().toISOString(),
    reconciledAt: new Date().toISOString(), revision: checks[1], previewUrl, result,
  };
  await saveState();
  return result;
}

async function phaseInitial() {
  return generationRun("initial", INITIAL_PROMPT, "BUILDCUSTOM_TASK3_INITIAL_OK");
}

async function phaseEdit() {
  assert(state.phases.initial?.status === "complete", "Initial generation must complete before the edit phase.");
  assert(state.phases.initial.result?.projectId === state.projects.A.id
    && state.phases.initial.result?.agentId === state.projects.A.agentId, "Initial phase project/agent identity changed.");
  return generationRun("edit", EDIT_PROMPT, "BUILDCUSTOM_TASK3_EDIT_OK", "Fresh coffee. Simple mornings.");
}

async function phaseReopen() {
  assert(state.phases.edit?.status === "complete", "The edit phase must complete before reopen.");
  assert(!state.phases.reopen, "The reopen phase was already attempted.");
  state.phases.reopen = { status: "running", startedAt: new Date().toISOString() };
  await saveState();
  try {
    const freshUser = {
      email: state.users.A.email,
      password: state.users.A.password,
      cookieJar: {},
    };
    await authenticate(freshUser, "login");
    const project = state.projects.A;
    const current = await api(`/api/projects/${project.id}`, { jar: freshUser.cookieJar });
    const revision = await runtimeGet(freshUser, project, "revision");
    const status = await runtimeGet(freshUser, project, "status");
    const turns = await runtimeGet(freshUser, project, "turns");
    const files = await fileSnapshot(freshUser, project);
    const editedMarker = markerSummary(files, "BUILDCUSTOM_TASK3_EDIT_OK");
    const linePresent = files.some((file) => file.content.includes("Fresh coffee. Simple mornings."));
    assert(Number(current.data?.id) === project.id, "Fresh login did not reopen the same project.");
    assert(String(current.data?.agentId) === project.agentId, "Fresh login did not reopen the same agent.");
    assert(revision.data?.commitHash === state.phases.edit.result.revision, "Edited revision did not persist after reopen.");
    assert(editedMarker.found && linePresent, "Edited authoritative files did not persist after reopen.");
    assert(status.data?.state?.generation?.status === "idle", "Reopened runtime is not idle.");
    const previewUrlAvailable = typeof status.data?.previewUrl === "string";
    assert(previewUrlAvailable, "Reopened status did not return the owner-scoped signed preview.");
    const result = {
      projectId: Number(current.data.id),
      agentId: String(current.data.agentId),
      revision: revision.data.commitHash,
      fileCount: files.length,
      editedMarker,
      supportingLine: linePresent,
      turnCount: Array.isArray(turns.data?.turns) ? turns.data.turns.length : null,
      generationStatus: status.data?.state?.generation?.status,
      signedPreviewAvailable: previewUrlAvailable,
      freshSession: true,
      promptSent: false,
      previewCreated: false,
    };
    state.users.A.reopenCookieJar = freshUser.cookieJar;
    state.phases.reopen = {
      status: "complete",
      completedAt: new Date().toISOString(),
      previewUrl: status.data.previewUrl,
      result,
    };
    await saveState();
    return result;
  } catch (error) {
    state.phases.reopen = { ...state.phases.reopen, status: "failed", failedAt: new Date().toISOString(), error: errorText(error) };
    await saveState();
    throw error;
  }
}

const runners = {
  smoke: phaseSmoke,
  initial: phaseInitial,
  "reconcile-initial": () => reconcileGeneration("initial", "BUILDCUSTOM_TASK3_INITIAL_OK"),
  edit: phaseEdit,
  "reconcile-edit": () => reconcileGeneration("edit", "BUILDCUSTOM_TASK3_EDIT_OK", "Fresh coffee. Simple mornings."),
  reopen: phaseReopen,
};
try {
  const result = await runners[phase]();
  console.log(JSON.stringify({ phase, status: "complete", result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    phase,
    status: "failed",
    error: errorText(error),
    stateFile: STATE_PATH,
    note: "Review saved phase guards before proceeding; failed inference phases are never automatically retried.",
  }, null, 2));
  process.exitCode = 1;
}