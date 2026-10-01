#!/usr/bin/env node
// One-shot, owner-bound observability fixture. Never lists projects or publishes.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  chmod, mkdir, open, readFile, rename, rm, stat,
} from "node:fs/promises";
import path from "node:path";
import { resolve } from "node:path";
import {
  parseOwnerRevision,
  runtimeRevisionMatchesSnapshot,
  summarizeNativeRevision,
  summarizeNativeStatus,
  validateDurableSelectResult,
  validateFreshProjectPreflight,
  validateOwnerProjectMapping,
} from "./lib/task13-owner-contracts.mjs";

const APP = "https://app.buildcustom.ai";
const RUNTIME = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const ACCOUNT = "03ef1e6e42498920987f07059e107538";
const D1_DATABASE = "ca820baf-6973-4318-ac52-529d56293bb6";
const THINK_NAMESPACE = "5d1e8716e75e4e1884458127f83c7f1c";
const SPACE_NAMESPACE = "bd1438931f1e489b89439e66b385837e";
const REPORT_FILE = "production/vibesdk-launch/observability-fixture.json";
const SESSION_FILE = "/tmp/buildcustom-observability-fixture-session.json";
const PROFILE_DIR = "/tmp/buildcustom-observability-fixture-chromium-profile";
const CHROMIUM = "/repl/tools/bin/chromium";
const action = process.argv[2];
assert(["setup", "run", "observe", "evidence", "self-test"].includes(action),
  "Use setup, run, observe, evidence, or self-test.");

const digest = value => createHash("sha256").update(value).digest("hex");
let phase = "startup";
let report;
let session;
let sessionReserved = false;
let browser;
let requestClickIssued = false;
let terminalReconciled = false;
let saveQueue = Promise.resolve();
let saveFailure = false;

function ensureProjectId(value) {
  const id = Number(value);
  assert(Number.isSafeInteger(id) && id > 0);
  assert(id !== 5 && id !== 6, "Protected production project ID rejected.");
  return id;
}

function safeScalar(value, max = 120) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= max
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
    ? value : undefined;
}

function safeTimestamp(value) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function safeInteger(value, maximum = 1000000) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : undefined;
}

async function atomicWrite(file, content) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  await chmod(file, 0o600);
}

async function saveReport() {
  if (!report) return;
  await atomicWrite(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
}

async function reserveReport() {
  const directory = path.dirname(REPORT_FILE);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const handle = await open(REPORT_FILE, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(REPORT_FILE, 0o600);
}

async function reserveSession() {
  const handle = await open(SESSION_FILE, "wx", 0o600);
  session = { cookies: [], csrf: null };
  try {
    await handle.writeFile(JSON.stringify(session));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(SESSION_FILE, 0o600);
  sessionReserved = true;
}

async function saveSession() {
  assert(sessionReserved, "Session reservation is absent.");
  await atomicWrite(SESSION_FILE, JSON.stringify(session));
}

async function loadReport() {
  report = JSON.parse(await readFile(REPORT_FILE, "utf8"));
  assert(report && typeof report === "object");
  if (report.projectId !== undefined) report.projectId = ensureProjectId(report.projectId);
}

async function loadSession() {
  const metadata = await stat(SESSION_FILE);
  assert((metadata.mode & 0o777) === 0o600, "Protected session file permissions are not 0600.");
  session = JSON.parse(await readFile(SESSION_FILE, "utf8"));
  assert(Array.isArray(session.cookies) && session.csrf);
  sessionReserved = true;
}

function cookieHeader() {
  return session.cookies.map(([name, value]) => `${name}=${value}`).join("; ");
}

function forbiddenProjectPath(uri) {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    return true;
  }
  return /\/api\/projects\/(?:5|6)(?:\/|$)/.test(decoded);
}

function projectRequestAllowed(uri, method, projectId = report?.projectId) {
  let pathname;
  try {
    pathname = new URL(uri, APP).pathname;
  } catch {
    return false;
  }
  if (pathname !== "/api/projects" && !pathname.startsWith("/api/projects/")) return true;
  const requestMethod = String(method || "GET").toUpperCase();
  if (pathname === "/api/projects") {
    return requestMethod === "POST" && phase === "project-creation" && projectId === undefined;
  }
  const match = pathname.match(/^\/api\/projects\/(\d+)(\/.*)?$/);
  if (!match || projectId === undefined || Number(match[1]) !== Number(projectId)) return false;
  if (requestMethod === "GET" || requestMethod === "HEAD") return true;
  return requestMethod === "POST" && match[2] === "/runtime/previews";
}

async function appRequest(uri, { method = "GET", body, headers = {} } = {}) {
  assert(uri.startsWith("/") && !uri.startsWith("//"));
  assert(!forbiddenProjectPath(uri), "Protected production project path rejected.");
  assert(projectRequestAllowed(uri, method), "Non-owner project request rejected.");
  const response = await fetch(`${APP}${uri}`, {
    method,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(60000),
    headers: {
      Cookie: cookieHeader(),
      Origin: APP,
      ...headers,
      ...(body === undefined ? {} : {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrf,
      }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0];
    const equals = pair.indexOf("=");
    if (equals > 0) session.cookies = [
      ...session.cookies.filter(([name]) => name !== pair.slice(0, equals)),
      [pair.slice(0, equals), pair.slice(equals + 1)],
    ];
  }
  if (response.headers.getSetCookie().length) await saveSession();
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Bodies are not retained or emitted.
  }
  return { status: response.status, data };
}

async function refreshCsrf() {
  const result = await appRequest("/api/auth/csrf-token");
  assert.equal(result.status, 200);
  assert(typeof result.data?.token === "string" && result.data.token.length > 0);
  session.csrf = result.data.token;
  await saveSession();
}

async function cloudflare(uri, body) {
  assert(process.env.CLOUDFLARE_API_TOKEN, "Cloudflare API token is unavailable.");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${uri}`,
    {
      method: body ? "POST" : "GET",
      signal: AbortSignal.timeout(60000),
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  assert(response.ok && data?.success === true, "Cloudflare read request failed.");
  return data.result;
}

async function d1Select(sql, params) {
  assert(/^\s*SELECT\b/i.test(sql), "Only read-only D1 SELECT is permitted.");
  const result = await cloudflare(`/d1/database/${D1_DATABASE}/query`, { sql, params });
  assertReadOnlyD1Results(result);
  return result;
}

function assertReadOnlyD1Results(result) {
  assert(Array.isArray(result) && result.length > 0, "D1 SELECT result metadata is missing.");
  for (const queryResult of result) {
    assert(queryResult && queryResult.success === true, "D1 SELECT did not report nested success.");
    assert(queryResult.error === undefined || queryResult.error === null,
      "D1 SELECT reported a nested error.");
    assert(queryResult.meta && queryResult.meta.rows_written === 0,
      "D1 SELECT metadata is missing or indicates a write.");
  }
}

function assertReadOnlyDurableResults(result, expectedQueryCount) {
  validateDurableSelectResult(result, expectedQueryCount);
}

function ownerIdentityKey(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return `n:${value}`;
  if (typeof value !== "string" || !value || value.length > 120) return null;
  if (/^\d+$/.test(value)) {
    try { return `n:${BigInt(value).toString()}`; } catch { return null; }
  }
  return safeScalar(value, 120) ? `s:${value}` : null;
}

async function readRuntime(kind) {
  assert(["status", "turns", "revision"].includes(kind));
  const projectId = ensureProjectId(report.projectId);
  const response = await appRequest(`/api/projects/${projectId}/runtime/${kind}`);
  assert.equal(response.status, 200, `Owner runtime ${kind} read failed.`);
  return response.data;
}

async function readRuntimeRevision() {
  const projectId = ensureProjectId(report.projectId);
  const response = await appRequest(`/api/projects/${projectId}/runtime/revision`);
  return runtimeRevisionSummary(response);
}

function runtimeRevisionSummary(response) {
  return parseOwnerRevision(response);
}

function walk(value, callback, depth = 0, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || depth > 10 || seen.has(value)) return;
  seen.add(value);
  callback(value);
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 5000)) walk(item, callback, depth + 1, seen);
  } else {
    const excluded = /^(?:args|arguments|toolArgs|tool_args|toolArguments|tool_arguments|toolInput|tool_input|input|parameters|function|functionCall|function_call|output|result|results|content|message|text|source|body|prompt|reasoning|tokens|headers|cookie|requestBody|responseBody)$/i;
    for (const [key, item] of Object.entries(value)) {
      if (!excluded.test(key)) walk(item, callback, depth + 1, seen);
    }
  }
}

function safeCommitHash(value) {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/i.test(value)
    ? value.toLowerCase() : null;
}

function statusSummary(data, ownerMappingVerified = false) {
  return summarizeNativeStatus(data, { ownerMappingVerified });
}

function exactlyOneNativeSuggestion(observed) {
  return observed.userSuggestionFrames === 1
    && observed.matchingPromptFrames === 1
    && !observed.unexpectedSuggestionFrame
    && !observed.suggestionBeforeClick;
}

function canReconcileNativeOperation(snapshot, baselineRevision, observed) {
  const idle = snapshot.status.idleNoGeneration || snapshot.status.terminalNoGeneration;
  const revisionChanged = snapshot.revision.committedHeadVerified
    && snapshot.revision.headCommitHash !== baselineRevision.headCommitHash;
  return idle && exactlyOneNativeSuggestion(observed)
    && (observed.terminalFrames.size > 0 || revisionChanged);
}

function turnsSummary(data) {
  const turnList = Array.isArray(data?.turns) ? data.turns : Array.isArray(data) ? data : null;
  if (!turnList) {
    return {
      available: false, schemaValid: false, total: null,
      customerTurnCount: null, matchingCustomerPromptCount: null,
    };
  }
  const schemaValid = turnList.every(turn => turn && typeof turn === "object"
    && typeof turn.prompt === "string"
    && typeof turn.response === "string"
    && Array.isArray(turn.activity));
  const expectedPromptHash = digest(ACCEPTANCE_PROMPT);
  const matchingCustomerTurns = turnList.filter(turn =>
    typeof turn?.prompt === "string" && digest(turn.prompt) === expectedPromptHash);
  const matchingCustomerPromptCount = matchingCustomerTurns.length;
  const matchingCustomerPromptCommitHash = matchingCustomerTurns.length === 1
    ? safeCommitHash(matchingCustomerTurns[0].commitHash) : null;
  return {
    available: true,
    schemaValid,
    total: turnList.length,
    customerTurnCount: turnList.length,
    matchingCustomerPromptCount,
    unmatchedPromptCount: turnList.length - matchingCustomerPromptCount,
    promptSha256: matchingCustomerPromptCount ? expectedPromptHash : null,
    matchingCustomerPromptCommitHash,
  };
}

function revisionSummary(ownerRevision) {
  return summarizeNativeRevision(ownerRevision);
}

async function ownerSnapshot() {
  const ownerMappingVerified = await identifyAgent();
  assert(ownerMappingVerified, "Owner-bound runtime mapping is unavailable.");
  const [status, turns, ownerRevision] = await Promise.all([
    readRuntime("status"),
    readRuntime("turns"),
    readRuntimeRevision(),
  ]);
  return {
    at: new Date().toISOString(),
    status: statusSummary(status, ownerMappingVerified),
    revision: revisionSummary(ownerRevision),
    ownerRuntimeRevision: ownerRevision,
    turns: turnsSummary(turns),
  };
}

async function gatesPass() {
  const release = JSON.parse(await readFile(
    "production/vibesdk-launch/observability-release-operation.json",
    "utf8",
  ));
  const smoke = JSON.parse(await readFile(
    "production/vibesdk-launch/observability-smoke.json",
    "utf8",
  ));
  return release?.state === "ACTIVE" && smoke?.status === "PASS";
}

async function identifyAgent() {
  const projectId = ensureProjectId(report.projectId);
  const project = await appRequest(`/api/projects/${projectId}`);
  const detail = project.data?.project ?? project.data;
  assert.equal(project.status, 200, "Owner project lookup failed.");
  const rows = await d1Select(
    "SELECT p.user_id, l.agent_id, p.status, l.initialization_status FROM projects p JOIN runtime_project_links l ON l.project_id=p.id WHERE p.id=? AND p.user_id=?",
    [projectId, report.ownerId],
  );
  const row = rows?.[0]?.results?.[0];
  const mapping = validateOwnerProjectMapping({
    httpStatus: project.status, detail, row, projectId,
    ownerId: report.ownerId, expectedAgentId: report.agentId,
  });
  if (mapping.ready) report.agentId = mapping.agentId;
  return mapping.ready;
}

async function assertFreshProjectState() {
  const projectId = ensureProjectId(report.projectId);
  const project = await appRequest(`/api/projects/${projectId}`);
  assert.equal(project.status, 200, "Owner project preflight read failed.");
  const detail = project.data?.project ?? project.data;
  const rows = await d1Select(
    "SELECT COUNT(r.id) AS release_count, COUNT(p.id) AS project_rows FROM projects p LEFT JOIN runtime_releases r ON r.project_id=p.id WHERE p.id=? AND p.user_id=?",
    [projectId, report.ownerId],
  );
  const row = rows?.[0]?.results?.[0];
  assert.equal(Number(row?.project_rows), 1, "Fresh project owner is missing or has an existing release.");
  validateFreshProjectPreflight(detail, row.release_count);
  assert.equal(detail.agentId, report.agentId, "Fresh project agent mapping changed.");
}

async function setup() {
  phase = "setup-gates";
  assert(await gatesPass(), "Active observability release and passing smoke are required.");
  assert(process.env.BUILDCUSTOM_NEW_USER_ACCEPTANCE_PASSWORD, "New-user acceptance password is unavailable.");
  assert(process.env.CLOUDFLARE_API_TOKEN, "Cloudflare API token is unavailable.");
  report = {
    startedAt: new Date().toISOString(),
    state: "REGISTRATION_RESERVED",
    registrationRequestsSent: 0,
    projectCreationRequestsSent: 0,
    customerRequestsSent: 0,
    publishRequestsSent: 0,
    requestKey: `observability-fixture-${randomUUID()}`,
    safeFrameMetadata: [],
  };
  await reserveReport();
  await reserveSession();

  phase = "registration";
  await refreshCsrf();
  report.registrationReservationAt = new Date().toISOString();
  report.registrationRequestsSent = 1;
  await saveReport();
  const email = `observability-${report.requestKey.slice(-12)}@buildcustom.ai`;
  let registered;
  try {
    registered = await appRequest("/api/auth/register", {
      method: "POST",
      body: {
        name: "Observability acceptance",
        email,
        password: process.env.BUILDCUSTOM_NEW_USER_ACCEPTANCE_PASSWORD,
      },
    });
  } catch {
    report.state = "REGISTRATION_UNKNOWN";
    await saveReport();
    throw new Error();
  }
  if (registered.status !== 200) {
    report.state = "REGISTRATION_UNKNOWN";
    report.registrationHttpStatus = registered.status;
    await saveReport();
    throw new Error();
  }
  report.state = "REGISTERED";
  report.registrationHttpStatus = registered.status;
  await saveReport();

  phase = "owner-identification";
  const identity = await appRequest("/api/auth/me");
  assert.equal(identity.status, 200);
  assert(ownerIdentityKey(identity.data?.id), "New owner identifier is invalid.");
  report.ownerId = String(identity.data.id);
  await saveReport();

  phase = "project-creation";
  await refreshCsrf();
  report.state = "PROJECT_CREATION_RESERVED";
  report.projectCreationReservationAt = new Date().toISOString();
  report.projectCreationRequestsSent = 1;
  await saveReport();
  let created;
  try {
    created = await appRequest("/api/projects", {
      method: "POST",
      headers: { "Idempotency-Key": report.requestKey },
      body: {
        name: "Isolated observability acceptance",
        description: "Disposable preview-only fixture; never production Publish.",
        type: "website",
        framework: "react",
      },
    });
  } catch {
    report.state = "PROJECT_CREATION_UNKNOWN";
    await saveReport();
    throw new Error();
  }
  if (![200, 201, 202].includes(created.status)) {
    report.state = "PROJECT_CREATION_UNKNOWN";
    report.projectCreationHttpStatus = created.status;
    await saveReport();
    throw new Error();
  }
  const createdId = created.data?.id ?? created.data?.project?.id;
  const numericProjectId = Number(createdId);
  if (numericProjectId === 5 || numericProjectId === 6) {
    report.state = "PROJECT_CREATION_REJECTED_ID";
    report.forbiddenProjectIdObserved = true;
    await saveReport();
    throw new Error();
  }
  if (!Number.isSafeInteger(numericProjectId) || numericProjectId <= 0) {
    report.state = "PROJECT_CREATION_UNKNOWN";
    report.projectIdReturned = false;
    await saveReport();
    throw new Error();
  }
  report.projectId = ensureProjectId(numericProjectId);
  report.projectCreationHttpStatus = created.status;
  report.state = "PROJECT_CREATED";
  await saveReport();

  phase = "agent-identification";
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    ready = await identifyAgent();
    if (ready) break;
    await saveReport();
    await new Promise(resolveDelay => setTimeout(resolveDelay, 3000));
  }
  assert(ready, "Owner-bound runtime initialization was not confirmed; project creation is not repeated.");
  report.initialSnapshot = await ownerSnapshot();
  report.baselineRevision = report.initialSnapshot.revision;
  assert.equal(report.initialSnapshot.status.idleNoGeneration, true, "New runtime is not proven idle.");
  assert.equal(report.initialSnapshot.turns.available, true, "Initial runtime turns are unavailable.");
  assert.equal(report.initialSnapshot.turns.schemaValid, true, "BuildCustom turn schema is unavailable.");
  assert.equal(report.initialSnapshot.turns.customerTurnCount, 0, "The new owner project already has customer turns.");
  assert.equal(report.initialSnapshot.revision.baselineKnown, true,
    "Initial revision baseline is unavailable or inconsistent; no coding operation is sent.");
  await assertFreshProjectState();
  let ownerRuntimeRevision;
  try {
    ownerRuntimeRevision = await readRuntimeRevision();
  } catch {
    ownerRuntimeRevision = {
      httpStatus: null, schemaValid: false, commitHash: null, source: "NULL", valid: false,
    };
  }
  const revisionMatchesBaseline = runtimeRevisionMatchesSnapshot(
    ownerRuntimeRevision,
    report.initialSnapshot.revision,
  );
  report.ownerRuntimeRevision = {
    ...ownerRuntimeRevision,
    matchesInitialSnapshot: revisionMatchesBaseline,
  };
  if (!ownerRuntimeRevision.valid || !revisionMatchesBaseline) {
    report.state = "SETUP_BLOCKED_RUNTIME_REVISION";
    report.runtimeRevisionFailure = ownerRuntimeRevision.httpStatus !== 200
      ? "HTTP_STATUS" : !ownerRuntimeRevision.schemaValid
        ? "INVALID_CONTRACT" : "REVISION_MISMATCH";
    await saveReport();
    throw new Error();
  }
  report.state = "READY_WITHOUT_GENERATION";
  report.preGenerationVerifiedAt = new Date().toISOString();
  await saveReport();
  console.log(JSON.stringify({
    state: report.state,
    ownerId: report.ownerId,
    projectId: report.projectId,
    agentId: report.agentId,
    baselineRevision: report.baselineRevision,
    customerTurns: report.initialSnapshot.turns.customerTurnCount,
    idleNoGeneration: report.initialSnapshot.status.idleNoGeneration,
  }));
}

const ACCEPTANCE_PROMPT = [
  "Build a modest, complete static contact-directory demo in the current initialized app.",
  "Inspect the existing files and configuration first. This is ONE preview-only customer coding operation.",
  "Use plain HTML/CSS/ES modules and no external services, database changes, credentials or production Publish.",
  "Provide a responsive dark-navy contact dashboard with 24 clearly labeled synthetic demo contacts.",
  "Implement search by name/company/email, status filters, sortable columns, 6-row pagination, and a read-only contact-detail dialog.",
  "Make the filters work together, reset pagination when filtering, preserve the query/filter/sort state in the URL, and support browser back/forward.",
  "Include a recent-contacts panel containing exactly the five newest IDs, plus accurate counts and a filtered-empty state.",
  "Keep the directory state/data, filtering/sorting, table rendering, dialog, URL state and app wiring in small separate ES modules.",
  "Add a Node-executable deterministic test script covering combined filters, case-insensitive search, sorting, pagination boundaries, newest-five and URL round-trips.",
  "Use semantic labels, keyboard dialog dismissal/focus return, readable contrast and a mobile layout.",
  "Retain valid Worker/assets configuration. No packages or external image/font/CDN dependencies are needed.",
  "After implementation, run the deterministic tests and working-tree preflight before creating a coherent revision.",
  "Deploy only the preview, and use browser/runtime verification to actually exercise search, status filter, pagination, detail dialog, browser history, recent-five and mobile layout.",
  "If any verification fails, repair it in this SAME operation. Call finish_task only after verified completion and a clean working tree.",
  "Do not create a production release or invoke production Publish.",
].join("\n");

const KNOWN_FRAME_TYPES = new Set([
  "agent_connected", "generation_started", "generation_progress", "generation_complete",
  "generation_stopped", "error", "operation_state", "tool_call", "tool_result",
  "tool_start", "tool_end", "user_suggestion", "think_diagnostic",
]);
const KNOWN_TOOL_NAMES = new Set([
  "read", "write", "edit", "list", "find", "grep", "delete", "ask_questions",
  "browser_console_logs", "deploy_space", "commit", "set_title", "finish_task",
]);
const TERMINAL_FRAME_TYPES = new Set(["generation_complete", "generation_stopped", "error"]);
const SAFE_RESULT_STATES = new Set(["complete", "completed", "success", "failed", "error", "stopped"]);

function pickScalar(root, keys, predicate) {
  let found;
  walk(root, object => {
    if (found !== undefined) return;
    for (const [key, value] of Object.entries(object)) {
      if (keys.has(key) && predicate(value)) {
        found = value;
        return;
      }
    }
  });
  return found;
}

function safeFrameMetadata(frame, direction) {
  if (!frame || typeof frame !== "object" || !KNOWN_FRAME_TYPES.has(frame.type)) return null;
  const metadata = {
    at: new Date().toISOString(),
    direction,
    type: frame.type,
  };
  const conversationId = pickScalar(
    frame,
    new Set(["conversationId", "conversation_id"]),
    value => typeof value === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(value),
  );
  const callId = pickScalar(
    frame,
    new Set(["toolCallId", "tool_call_id", "callId", "call_id"]),
    value => typeof value === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(value),
  );
  const turn = pickScalar(frame, new Set(["turn", "turnNumber", "turn_number"]), value => safeInteger(value));
  const step = pickScalar(frame, new Set(["step", "stepNumber", "step_number"]), value => safeInteger(value));
  const continuation = pickScalar(
    frame,
    new Set(["continuationCount", "continuation_count", "continuations"]),
    value => safeInteger(value, 1000),
  );
  const toolObject = frame.tool && typeof frame.tool === "object" ? frame.tool : null;
  const rawToolName = frame.toolName ?? frame.tool_name ?? toolObject?.name;
  const toolName = ["tool_call", "tool_result", "tool_start", "tool_end"].includes(frame.type)
    && typeof rawToolName === "string"
    && KNOWN_TOOL_NAMES.has(rawToolName)
    ? rawToolName : undefined;
  if (conversationId) metadata.conversationId = conversationId;
  if (callId) metadata.toolCallId = callId;
  if (turn !== undefined) metadata.turn = turn;
  if (step !== undefined) metadata.step = step;
  if (continuation !== undefined) metadata.continuationCount = continuation;
  if (toolName) metadata.toolName = toolName;
  if (toolName === "finish_task") {
    const finishResult = frame.result && typeof frame.result === "object"
      ? frame.result
      : frame.data?.result && typeof frame.data.result === "object" ? frame.data.result : {};
    const resultStatus = pickScalar(
      finishResult,
      new Set(["status", "state", "resultStatus", "result_status"]),
      value => typeof value === "string" && SAFE_RESULT_STATES.has(value.toLowerCase()),
    );
    if (resultStatus) metadata.finishTaskResultStatus = resultStatus.toLowerCase();
    const evidence = {};
    for (const key of ["preflightPassed", "previewVerified", "cleanWorkingTree", "commitCreated", "productionPublish"]) {
      const value = pickScalar(finishResult, new Set([key]), item => typeof item === "boolean");
      if (value !== undefined) evidence[key] = value;
    }
    if (Object.keys(evidence).length) metadata.finishTaskEvidence = evidence;
  }
  return metadata;
}

function extractSentMessage(frame) {
  return typeof frame?.message === "string" ? frame.message : undefined;
}

async function markSafeFailure(kind) {
  if (!report) return;
  report.lastFailure = { phase, kind };
  try {
    await saveReport();
  } catch {
    saveFailure = true;
  }
}

function scheduleReportSave() {
  saveQueue = saveQueue.then(() => saveReport()).catch(() => {
    saveFailure = true;
  });
}

function isPublishPath(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname.startsWith("/api/")
      && /(?:^|\/)(?:publish|publishing)(?:\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function installBrowserRequestGuards(page) {
  await page.setRequestInterception(true);
  page.on("request", request => {
    let blocked = false;
    let publishAttempt = false;
    try {
      const parsed = new URL(request.url());
      publishAttempt = isPublishPath(request.url());
      blocked = forbiddenProjectPath(parsed.pathname)
        || !projectRequestAllowed(request.url(), request.method())
        || publishAttempt;
    } catch {
      blocked = true;
    }
    if (blocked) {
      report.browserGuardViolations = (report.browserGuardViolations ?? 0) + 1;
      report.unexpectedBrowserRequestObserved = true;
      if (publishAttempt) report.blockedPublishAttempts = (report.blockedPublishAttempts ?? 0) + 1;
      scheduleReportSave();
      request.abort().catch(() => {});
      return;
    }
    request.continue().catch(() => {});
  });
}

function safeCdpRequestId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(value) ? value : null;
}

function safeCloseCodeFromPayload(payloadData) {
  if (typeof payloadData !== "string" || payloadData.length > 1_000_000) return null;
  const encoded = Buffer.from(payloadData, "base64");
  const encodedCode = encoded.length >= 2 ? encoded.readUInt16BE(0) : null;
  if (encodedCode !== null && encodedCode >= 1000 && encodedCode <= 4999) return encodedCode;
  const bytes = Buffer.from(payloadData, "utf8");
  if (bytes.length < 2) return null;
  const code = bytes.readUInt16BE(0);
  return code >= 1000 && code <= 4999 ? code : null;
}

function isOwnerRuntimeWebSocket(rawUrl, projectId) {
  if (typeof rawUrl !== "string" || rawUrl.length > 4096) return false;
  try {
    const target = new URL(rawUrl);
    return (target.protocol === "wss:" || target.protocol === "ws:")
      && target.origin === new URL(APP).origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
      && target.pathname === `/api/projects/${projectId}/runtime/ws`
      && !target.username && !target.password && !target.search && !target.hash;
  } catch {
    return false;
  }
}

function registerSocketLifecycle(client, observed, projectId) {
  client.on("Network.webSocketCreated", params => {
    observed.webSocketCreatedCount++;
    const requestId = safeCdpRequestId(params?.requestId);
    if (requestId && isOwnerRuntimeWebSocket(params?.url, projectId)) {
      observed.ownerRuntimeWebSocketRequestIds.add(requestId);
      observed.ownerRuntimeSocketCreatedCount++;
    }
    scheduleReportSave();
  });
  client.on("Network.webSocketClosed", params => {
    observed.webSocketClosedCount++;
    const requestId = safeCdpRequestId(params?.requestId);
    if (requestId && observed.webSocketClosedRequestIds.length < 500) {
      observed.webSocketClosedRequestIds.push(requestId);
    } else if (requestId) {
      observed.webSocketLifecycleRecordsDropped++;
    }
    scheduleReportSave();
  });
  client.on("Network.webSocketFrameError", params => {
    observed.webSocketFrameErrorCount++;
    const requestId = safeCdpRequestId(params?.requestId);
    if (requestId && observed.webSocketErrorRequestIds.length < 500) {
      observed.webSocketErrorRequestIds.push(requestId);
    } else if (requestId) {
      observed.webSocketLifecycleRecordsDropped++;
    }
    // CDP errorMessage is intentionally never read or retained.
    scheduleReportSave();
  });
}

function registerSocketListener(client, direction, prompt, observed) {
  const event = direction === "sent" ? "Network.webSocketFrameSent" : "Network.webSocketFrameReceived";
  client.on(event, params => {
    try {
      if (params?.response?.opcode === 8) {
        observed.webSocketCloseFrameCount++;
        const closeCode = safeCloseCodeFromPayload(params.response.payloadData);
        const requestId = safeCdpRequestId(params?.requestId);
        const record = { direction, closeCode };
        if (requestId) record.requestId = requestId;
        if (observed.webSocketCloseFrames.length < 500) {
          observed.webSocketCloseFrames.push(record);
        } else {
          observed.webSocketLifecycleRecordsDropped++;
        }
        scheduleReportSave();
        return;
      }
      const payload = params?.response?.payloadData;
      if (typeof payload !== "string" || payload.length > 4_000_000) return;
      let frame;
      try {
        frame = JSON.parse(payload);
      } catch {
        return;
      }
      if (direction === "sent" && frame?.type === "user_suggestion") {
        observed.userSuggestionFrames++;
        const requestId = safeCdpRequestId(params?.requestId);
        const ownerRuntimeSocket = requestId
          && observed.ownerRuntimeWebSocketRequestIds.has(requestId);
        if (ownerRuntimeSocket && extractSentMessage(frame) === prompt) {
          observed.matchingPromptFrames++;
          observed.userSuggestionRequestIds.add(requestId);
        } else {
          observed.unexpectedSuggestionFrame = true;
        }
        if (!requestClickIssued) observed.suggestionBeforeClick = true;
      }
      const metadata = safeFrameMetadata(frame, direction);
      if (metadata && report.safeFrameMetadata.length < 5000) {
        report.safeFrameMetadata.push(metadata);
      } else if (metadata) {
        report.safeFrameMetadataDropped = (report.safeFrameMetadataDropped ?? 0) + 1;
      }
      if (direction === "received" && TERMINAL_FRAME_TYPES.has(frame?.type)) {
        const requestId = safeCdpRequestId(params?.requestId);
        if (requestId && observed.userSuggestionRequestIds.has(requestId)) {
          observed.terminalFrames.add(frame.type);
        }
      }
      scheduleReportSave();
    } catch {
      observed.frameParseErrors++;
    }
  });
}

async function setControlledText(element, value) {
  return element.evaluate((node, text) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter || node.tagName !== "TEXTAREA") return false;
    setter.call(node, text);
    node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return node.value === text;
  }, value);
}

async function setControlledInputValue(element, value) {
  return element.evaluate((node, text) => {
    const prototype = node.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : node.tagName === "INPUT" ? HTMLInputElement.prototype : null;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return false;
    setter.call(node, text);
    node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return node.value === text;
  }, value);
}

async function firstPromptSessionKeyPresent(page) {
  return page.evaluate(() => Object.keys(sessionStorage).some(key =>
    /first.*prompt|prompt.*first|initial.*prompt|prompt.*initial/i.test(key)));
}

function generatedPreviewLocation(rawUrl, projectId, agentId) {
  if (typeof rawUrl !== "string" || rawUrl.length > 4096) return null;
  try {
    const target = new URL(rawUrl, APP);
    if (target.protocol !== "https:" || target.username || target.password || target.hash) return null;
    const appOrigin = new URL(APP).origin;
    const runtimeOrigin = new URL(RUNTIME).origin;
    const privatePrefix = `/_private_preview/${encodeURIComponent(agentId)}/`;
    const apiPrefix = `/api/projects/${projectId}/runtime/preview`;
    const spacePrefix = `/space/${encodeURIComponent(agentId)}/preview/`;
    const sameOriginPreview = target.origin === appOrigin
      && (target.pathname.startsWith(privatePrefix)
        || target.pathname === apiPrefix
        || target.pathname.startsWith(`${apiPrefix}/`));
    const spacePreview = (target.origin === runtimeOrigin || target.origin === appOrigin)
      && target.pathname.startsWith(spacePrefix);
    const appPreview = target.hostname.endsWith(".apps.buildcustom.ai");
    if (!sameOriginPreview && !spacePreview && !appPreview) return null;
    return `${target.origin}${target.pathname}`;
  } catch {
    return null;
  }
}

function normalizedLocation(rawUrl) {
  try {
    const target = new URL(rawUrl, APP);
    return `${target.origin}${target.pathname}`;
  } catch {
    return null;
  }
}

async function appPreviewFrame(page, rawPreviewUrl, projectId, agentId) {
  const expectedLocation = generatedPreviewLocation(rawPreviewUrl, projectId, agentId);
  if (!expectedLocation) return null;
  const iframeHandles = await page.$$('iframe[title="App Preview"]');
  for (const iframe of iframeHandles) {
    try {
      const element = await iframe.evaluate(node => ({
        src: node.getAttribute("src"),
        sandbox: node.getAttribute("sandbox") || "",
        ariaHidden: node.getAttribute("aria-hidden"),
      }));
      const sandbox = element.sandbox.split(/\s+/);
      if (element.ariaHidden === "true"
        || !sandbox.includes("allow-scripts")
        || !sandbox.includes("allow-same-origin")
        || normalizedLocation(element.src) !== expectedLocation) continue;
      const frame = await iframe.contentFrame();
      if (frame) return frame;
    } finally {
      await iframe.dispose();
    }
  }
  return null;
}

async function browserVerification(page) {
  const verification = {
    previewIframeFound: false,
    search: "UNKNOWN",
    statusFilter: "UNKNOWN",
    pagination: "UNKNOWN",
    sorting: "UNKNOWN",
    dialog: "UNKNOWN",
    urlHistory: "UNKNOWN",
    recentFive: "UNKNOWN",
    mobileLayout: "UNKNOWN",
  };
  const runtimeStatus = await readRuntime("status");
  const previewUrl = runtimeStatus?.previewUrl ?? runtimeStatus?.previewURL
    ?? runtimeStatus?.state?.previewUrl ?? null;
  const frame = await appPreviewFrame(
    page,
    previewUrl,
    ensureProjectId(report.projectId),
    report.agentId,
  );
  if (!frame) return verification;
  verification.previewIframeFound = true;

  try {
    const search = await frame.evaluateHandle(() => {
      const candidates = [...document.querySelectorAll("input[type=search],input,textarea")];
      return candidates.find(element => {
        const label = [
          element.getAttribute("aria-label"),
          element.getAttribute("placeholder"),
          element.getAttribute("name"),
          element.labels?.[0]?.textContent,
        ].filter(Boolean).join(" ").toLowerCase();
        return label.includes("search") || element.type === "search";
      }) ?? null;
    });
    const searchElement = search.asElement();
    if (searchElement) {
      const original = await searchElement.evaluate(element => element.value);
      const noMatch = `__observability_no_match_${randomUUID()}__`;
      const inputUpdated = await setControlledInputValue(searchElement, noMatch);
      await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
      const emptyRows = await frame.evaluate(() => {
        const tableRows = document.querySelectorAll("tbody tr").length;
        const listRows = document.querySelectorAll('[role="row"]').length;
        return tableRows === 0 && listRows <= 1;
      });
      verification.search = inputUpdated && emptyRows ? "PASS" : "FAIL";
      await setControlledInputValue(searchElement, original);
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250));

      const beforeHistory = await frame.evaluate(() => `${location.pathname}${location.search}${location.hash}`);
      await setControlledInputValue(searchElement, "__history_probe__");
      await new Promise(resolveDelay => setTimeout(resolveDelay, 300));
      const afterHistory = await frame.evaluate(() => `${location.pathname}${location.search}${location.hash}`);
      if (afterHistory !== beforeHistory) {
        await frame.evaluate(() => history.back());
        await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
        const restored = await frame.evaluate(() => `${location.pathname}${location.search}${location.hash}`);
        verification.urlHistory = restored === beforeHistory ? "PASS" : "FAIL";
      } else {
        verification.urlHistory = "FAIL";
      }
      await setControlledInputValue(searchElement, original);
      await searchElement.dispose();
    } else {
      verification.search = "FAIL";
      verification.urlHistory = "FAIL";
    }
  } catch {
    verification.search = "FAIL";
    verification.urlHistory = "FAIL";
  }

  try {
    verification.recentFive = await frame.evaluate(() => {
      const labels = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")]
        .filter(node => /recent/i.test(node.textContent ?? ""));
      return labels.some(label => {
        let parent = label.parentElement;
        for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
          const count = parent.querySelectorAll("li,[role=listitem]").length;
          if (count === 5) return true;
        }
        return false;
      });
    }) ? "PASS" : "FAIL";
  } catch {
    verification.recentFive = "FAIL";
  }

  try {
    verification.statusFilter = await frame.evaluate(async () => {
      const rowCount = () => document.querySelectorAll("tbody tr").length;
      const before = rowCount();
      const select = [...document.querySelectorAll("select")].find(node => {
        const label = `${node.getAttribute("aria-label") ?? ""} ${node.name ?? ""} ${node.labels?.[0]?.textContent ?? ""}`.toLowerCase();
        return label.includes("status") || [...node.options].some(option => /status/i.test(option.textContent ?? ""));
      });
      if (select) {
        const option = [...select.options].find(item =>
          item.value && !/^(all|any|all-statuses)$/i.test(item.value));
        if (!option) return false;
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 300));
        return select.value === option.value && rowCount() <= before;
      }
      const button = [...document.querySelectorAll("button,[role=button]")]
        .find(node => /status|active|inactive|archived/i.test(`${node.getAttribute("aria-label") ?? ""} ${node.textContent ?? ""}`)
          && !/^all\b/i.test(node.textContent ?? ""));
      if (!button) return false;
      button.click();
      await new Promise(resolve => setTimeout(resolve, 300));
      return rowCount() <= before;
    }) ? "PASS" : "FAIL";
    await new Promise(resolveDelay => setTimeout(resolveDelay, 300));
  } catch {
    verification.statusFilter = "FAIL";
  }

  try {
    verification.pagination = await frame.evaluate(async () => {
      const rows = () => [...document.querySelectorAll("tbody tr")];
      const before = rows();
      const next = [...document.querySelectorAll("button,[role=button]")].find(node => {
        const label = `${node.getAttribute("aria-label") ?? ""} ${node.title ?? ""} ${node.textContent ?? ""}`.trim().toLowerCase();
        return /^(next|next page|›|→)$/.test(label);
      });
      if (!next || next.disabled || before.length === 0) return false;
      const beforeFirst = before[0]?.textContent ?? "";
      next.click();
      await new Promise(resolve => setTimeout(resolve, 400));
      const after = rows();
      return after.length > 0 && after[0]?.textContent !== beforeFirst;
    }) ? "PASS" : "FAIL";
  } catch {
    verification.pagination = "FAIL";
  }

  try {
    verification.sorting = await frame.evaluate(async () => {
      const header = [...document.querySelectorAll("th,[role=columnheader]")].find(node =>
        node.querySelector("button") || node.tabIndex >= 0);
      if (!header) return false;
      const before = header.getAttribute("aria-sort") ?? "";
      const firstBefore = document.querySelector("tbody tr")?.textContent ?? "";
      (header.querySelector("button") ?? header).click();
      await new Promise(resolve => setTimeout(resolve, 350));
      return (header.getAttribute("aria-sort") ?? "") !== before
        || (document.querySelector("tbody tr")?.textContent ?? "") !== firstBefore;
    }) ? "PASS" : "FAIL";
  } catch {
    verification.sorting = "FAIL";
  }

  try {
    verification.dialog = await frame.evaluate(async () => {
      const firstRow = document.querySelector("tbody tr,[role=row]");
      const action = firstRow?.querySelector("button,[role=button]") ?? firstRow;
      if (!action) return false;
      action.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      const dialog = [...document.querySelectorAll('dialog[open],[role=dialog]')]
        .find(node => node.getAttribute("aria-hidden") !== "true"
          && node.getBoundingClientRect().width > 0
          && node.getBoundingClientRect().height > 0);
      if (!dialog) return false;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 150));
      const closed = ![...document.querySelectorAll('dialog[open],[role=dialog]')].some(node =>
        node.getAttribute("aria-hidden") !== "true"
        && node.getBoundingClientRect().width > 0
        && node.getBoundingClientRect().height > 0);
      return closed && document.activeElement === action;
    }) ? "PASS" : "FAIL";
  } catch {
    verification.dialog = "FAIL";
  }

  try {
    const viewport = page.viewport();
    await page.setViewport({ width: 390, height: 844 });
    await new Promise(resolveDelay => setTimeout(resolveDelay, 300));
    verification.mobileLayout = await frame.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1
      && document.documentElement.clientWidth > 0) ? "PASS" : "FAIL";
    if (viewport) await page.setViewport(viewport);
  } catch {
    verification.mobileLayout = "FAIL";
  }
  return verification;
}

async function startBrowserRun() {
  phase = "browser-preflight";
  assert(await gatesPass(), "Release and smoke gates are no longer passing.");
  assert.equal(report.state, "READY_WITHOUT_GENERATION");
  assert.equal(report.customerRequestsSent, 0);
  assert.equal(report.initialSnapshot?.turns?.customerTurnCount, 0);
  assert(await identifyAgent());
  const before = await ownerSnapshot();
  assert.equal(before.status.idleNoGeneration, true);
  assert.equal(before.turns.available, true);
  assert.equal(before.turns.schemaValid, true);
  assert.equal(before.turns.customerTurnCount, 0);
  assert.deepEqual(before.revision, report.baselineRevision);
  await assertFreshProjectState();
  let preBrowserRuntimeRevision;
  try {
    preBrowserRuntimeRevision = await readRuntimeRevision();
  } catch {
    preBrowserRuntimeRevision = {
      httpStatus: null, schemaValid: false, commitHash: null, source: "NULL", valid: false,
    };
  }
  const revisionMatchesPreBrowserSnapshot = runtimeRevisionMatchesSnapshot(
    preBrowserRuntimeRevision,
    before.revision,
  ) && preBrowserRuntimeRevision.commitHash === report.ownerRuntimeRevision?.commitHash;
  report.preBrowserRuntimeRevision = {
    ...preBrowserRuntimeRevision,
    matchesInitialSnapshot: revisionMatchesPreBrowserSnapshot,
  };
  if (!preBrowserRuntimeRevision.valid || !revisionMatchesPreBrowserSnapshot) {
    report.state = "RUN_BLOCKED_RUNTIME_REVISION";
    report.runtimeRevisionFailure = preBrowserRuntimeRevision.httpStatus !== 200
      ? "HTTP_STATUS" : !preBrowserRuntimeRevision.schemaValid
        ? "INVALID_CONTRACT" : "REVISION_MISMATCH";
    await saveReport();
    throw new Error();
  }
  report.preBrowserSnapshot = before;
  await saveReport();

  phase = "browser-profile";
  await mkdir(PROFILE_DIR, { mode: 0o700 });
  await chmod(PROFILE_DIR, 0o700);
  assert.equal((await stat(PROFILE_DIR)).mode & 0o777, 0o700);

  phase = "browser-launch";
  const packageRequire = createRequire(resolve("lab/bc-vibesdk-lab-20260925/package.json"));
  const puppeteer = packageRequire("puppeteer");
  browser = await puppeteer.launch({
    headless: true,
    executablePath: resolve(CHROMIUM),
    userDataDir: PROFILE_DIR,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  report.state = "BROWSER_READY";
  await saveReport();
  const page = await browser.newPage();
  await page.setDefaultTimeout(30000);
  await installBrowserRequestGuards(page);
  const cookies = session.cookies.map(([name, value]) => ({
    name,
    value,
    domain: "app.buildcustom.ai",
    path: "/",
    secure: true,
    httpOnly: name.toLowerCase().includes("token"),
    sameSite: "Lax",
  }));
  await page.setCookie(...cookies);
  const client = await page.target().createCDPSession();
  await client.send("Network.enable");
  const observed = {
    userSuggestionFrames: 0,
    matchingPromptFrames: 0,
    unexpectedSuggestionFrame: false,
    suggestionBeforeClick: false,
    frameParseErrors: 0,
    terminalFrames: new Set(),
    ownerRuntimeWebSocketRequestIds: new Set(),
    userSuggestionRequestIds: new Set(),
    ownerRuntimeSocketCreatedCount: 0,
    webSocketCreatedCount: 0,
    webSocketClosedCount: 0,
    webSocketFrameErrorCount: 0,
    webSocketCloseFrameCount: 0,
    webSocketCloseFrames: [],
    webSocketClosedRequestIds: [],
    webSocketErrorRequestIds: [],
    webSocketLifecycleRecordsDropped: 0,
  };
  registerSocketLifecycle(client, observed, report.projectId);
  registerSocketListener(client, "sent", ACCEPTANCE_PROMPT, observed);
  registerSocketListener(client, "received", ACCEPTANCE_PROMPT, observed);

  phase = "editor-navigation";
  const projectId = ensureProjectId(report.projectId);
  await page.goto(`${APP}/app/editor/${projectId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="input-editor-chat"]', { visible: true, timeout: 60000 });
  await page.waitForSelector('[data-testid="button-send-chat"]', { visible: true, timeout: 60000 });
  assert.equal(await firstPromptSessionKeyPresent(page), false, "First-prompt sessionStorage key already exists.");
  assert.equal(observed.userSuggestionFrames, 0, "Unexpected user_suggestion frame before the one-shot click.");
  assert.equal(report.unexpectedBrowserRequestObserved, undefined, "Unexpected protected or Publish request observed.");

  const composer = await page.$('[data-testid="input-editor-chat"]');
  const sendButton = await page.$('[data-testid="button-send-chat"]');
  assert(composer && sendButton);
  assert.equal(await setControlledText(composer, ACCEPTANCE_PROMPT), true);
  assert.equal(await sendButton.evaluate(element => !element.disabled), true);

  phase = "customer-request";
  report.state = "CODING_REQUEST_RESERVED";
  report.customerRequestReservationAt = new Date().toISOString();
  report.promptSha256 = digest(ACCEPTANCE_PROMPT);
  await saveReport();
  assert.equal(report.unexpectedBrowserRequestObserved, undefined, "Unexpected protected or Publish request observed before send.");
  assert.equal(observed.userSuggestionFrames, 0);
  requestClickIssued = true;
  report.customerRequestClickIssuedAt = new Date().toISOString();
  await saveReport();
  try {
    await sendButton.click();
  } catch {
    report.sendClickOutcome = "UNKNOWN";
  }
  await composer.dispose();
  await sendButton.dispose();
  report.state = "CODING_REQUEST_SENT_OR_UNKNOWN";
  await saveQueue;
  await saveReport();

  phase = "operation-observation";
  const started = Date.now();
  let deadlineRecorded = false;
  while (!terminalReconciled) {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 8000));
    try {
      const snapshot = await ownerSnapshot();
      report.latestSnapshot = snapshot;
      report.customerRequestsSent = observed.matchingPromptFrames;
      report.webSocketUserSuggestionFrames = observed.userSuggestionFrames;
      report.terminalFrames = [...observed.terminalFrames];
      report.unexpectedSuggestionFrame = observed.unexpectedSuggestionFrame;
      report.safeFrameMetadataPersistenceFailure = saveFailure;
      terminalReconciled = canReconcileNativeOperation(snapshot, report.baselineRevision, observed);
      if (terminalReconciled) {
        report.terminalReconciledAt = new Date().toISOString();
        report.state = observed.terminalFrames.has("generation_complete")
          && !observed.terminalFrames.has("error")
          && !observed.terminalFrames.has("generation_stopped")
          ? "TERMINAL_GENERATION_COMPLETE"
          : observed.terminalFrames.has("error") ? "TERMINAL_ERROR"
            : observed.terminalFrames.has("generation_stopped") ? "TERMINAL_STOPPED"
              : "TERMINAL_OWNER_RECONCILED";
        report.customerRequestsSent = observed.matchingPromptFrames;
        report.webSocketUserSuggestionFrames = observed.userSuggestionFrames;
        report.terminalFrames = [...observed.terminalFrames];
        report.observationSeconds = Math.round((Date.now() - started) / 1000);
        await saveQueue;
        await saveReport();
        break;
      }
    } catch {
      report.ownerReconciliationFailures = (report.ownerReconciliationFailures ?? 0) + 1;
      scheduleReportSave();
    }
    if (!deadlineRecorded && Date.now() - started >= 960000) {
      deadlineRecorded = true;
      report.observationDeadlineReachedAt = new Date().toISOString();
      report.observationDeadlineSeconds = 960;
      report.state = "INCOMPLETE_OBSERVATION_DEADLINE";
      report.finishedAt = new Date().toISOString();
      report.observabilityResult = {
        exactlyOneCustomerRequest: exactlyOneNativeSuggestion(observed),
        terminalObservedOrReconciled: false,
        noAutomaticRetry: true,
        browserKeptOpen: true,
      };
      report.browserVerification = { previewIframeFound: false, result: "NOT_RUN_OPERATION_INCOMPLETE" };
      report.webSocketBehavior = {
        browserKeptOpenThroughTerminal: false,
        browserKeptOpenAtDeadline: true,
        userSuggestionFrames: observed.userSuggestionFrames,
        matchingPromptFrames: observed.matchingPromptFrames,
        terminalFrames: [...observed.terminalFrames],
        ownerRuntimeSocketCreatedCount: observed.ownerRuntimeSocketCreatedCount,
        cdpWebSocketCreatedCount: observed.webSocketCreatedCount,
        cdpWebSocketClosedCount: observed.webSocketClosedCount,
        cdpWebSocketFrameErrorCount: observed.webSocketFrameErrorCount,
        cdpWebSocketCloseFrameCount: observed.webSocketCloseFrameCount,
        cdpWebSocketCloseFrames: observed.webSocketCloseFrames,
        cdpWebSocketClosedRequestIds: observed.webSocketClosedRequestIds,
        cdpWebSocketErrorRequestIds: observed.webSocketErrorRequestIds,
        cdpWebSocketLifecycleRecordsDropped: observed.webSocketLifecycleRecordsDropped,
      };
      await saveQueue;
      await saveReport();
      return;
    }
  }

  phase = "terminal-browser-verification";
  report.webSocketBehavior = {
    browserKeptOpenThroughTerminal: true,
    userSuggestionFrames: observed.userSuggestionFrames,
    matchingPromptFrames: observed.matchingPromptFrames,
    terminalFrames: [...observed.terminalFrames],
    ownerRuntimeSocketCreatedCount: observed.ownerRuntimeSocketCreatedCount,
    cdpWebSocketCreatedCount: observed.webSocketCreatedCount,
    cdpWebSocketClosedCount: observed.webSocketClosedCount,
    cdpWebSocketFrameErrorCount: observed.webSocketFrameErrorCount,
    cdpWebSocketCloseFrameCount: observed.webSocketCloseFrameCount,
    cdpWebSocketCloseFrames: observed.webSocketCloseFrames,
    cdpWebSocketClosedRequestIds: observed.webSocketClosedRequestIds,
    cdpWebSocketErrorRequestIds: observed.webSocketErrorRequestIds,
    cdpWebSocketLifecycleRecordsDropped: observed.webSocketLifecycleRecordsDropped,
  };
  report.browserVerification = report.state === "TERMINAL_GENERATION_COMPLETE"
    ? await browserVerification(page)
    : { previewIframeFound: false, result: "NOT_RUN_OPERATION_NOT_COMPLETE" };
  report.observabilityResult = {
    exactlyOneCustomerRequest: exactlyOneNativeSuggestion(observed),
    nativeBuilderTurnsRemainZero: report.initialSnapshot?.turns?.customerTurnCount === 0
      && report.latestSnapshot?.turns?.customerTurnCount === 0,
    noPublishRequests: report.publishRequestsSent === 0
      && (report.blockedPublishAttempts ?? 0) === 0,
    noProtectedProjectRequests: !report.unexpectedBrowserRequestObserved,
    terminalObservedOrReconciled: terminalReconciled,
    coherentRevisionCreated: report.latestSnapshot?.revision?.committedHeadVerified === true
      && typeof report.latestSnapshot.revision.headCommitHash === "string"
      && report.latestSnapshot.revision.headCommitHash !== report.baselineRevision?.headCommitHash,
  };
  report.state = report.state === "TERMINAL_GENERATION_COMPLETE"
    && report.observabilityResult.exactlyOneCustomerRequest
    && report.observabilityResult.nativeBuilderTurnsRemainZero
    && report.observabilityResult.noPublishRequests
    && report.observabilityResult.noProtectedProjectRequests
    && report.observabilityResult.coherentRevisionCreated
    && Object.values(report.browserVerification).every(value => value === "PASS" || value === true)
    ? "COMPLETE"
    : report.state === "TERMINAL_ERROR" ? "FAILED_TERMINAL_ERROR"
      : report.state === "TERMINAL_STOPPED" ? "FAILED_TERMINAL_STOPPED"
        : "TERMINAL_INCOMPLETE_OR_UNPROVEN";
  report.finishedAt = new Date().toISOString();
  await saveQueue;
  await saveReport();

  terminalReconciled = true;
  if (browser) {
    await browser.close();
    browser = undefined;
  }
  await saveQueue;
  report.webSocketBehavior.cdpWebSocketCreatedCount = observed.webSocketCreatedCount;
  report.webSocketBehavior.cdpWebSocketClosedCount = observed.webSocketClosedCount;
  report.webSocketBehavior.cdpWebSocketFrameErrorCount = observed.webSocketFrameErrorCount;
  report.webSocketBehavior.cdpWebSocketCloseFrameCount = observed.webSocketCloseFrameCount;
  report.webSocketBehavior.cdpWebSocketCloseFrames = observed.webSocketCloseFrames;
  report.webSocketBehavior.cdpWebSocketClosedRequestIds = observed.webSocketClosedRequestIds;
  report.webSocketBehavior.cdpWebSocketErrorRequestIds = observed.webSocketErrorRequestIds;
  report.webSocketBehavior.cdpWebSocketLifecycleRecordsDropped = observed.webSocketLifecycleRecordsDropped;
  await saveReport();
  await rm(PROFILE_DIR, { recursive: true, force: true });
  console.log(JSON.stringify({
    state: report.state,
    ownerId: report.ownerId,
    projectId: report.projectId,
    agentId: report.agentId,
    customerRequestsSent: report.customerRequestsSent,
    webSocketUserSuggestionFrames: report.webSocketUserSuggestionFrames,
    terminalFrames: report.terminalFrames,
    browserVerification: report.browserVerification,
    productionPublishRequests: report.publishRequestsSent,
    blockedPublishAttempts: report.blockedPublishAttempts ?? 0,
  }));
}

async function observe() {
  phase = "owner-observation";
  assert(report.ownerId && report.projectId && report.agentId);
  assert(await identifyAgent());
  report.observations = report.observations ?? [];
  const snapshot = await ownerSnapshot();
  report.observations.push(snapshot);
  report.latestSnapshot = snapshot;
  await saveReport();
  console.log(JSON.stringify({
    state: report.state,
    ownerId: report.ownerId,
    projectId: report.projectId,
    agentId: report.agentId,
    status: snapshot.status,
    revision: snapshot.revision,
    turns: snapshot.turns,
  }));
}

function queryRows(result, index = 0) {
  const cursor = result?.results?.[index];
  if (!cursor) return [];
  return cursor.rows.map(row => Object.fromEntries(cursor.columns.map((column, i) => [column, row[i]])));
}

async function durableSelect(namespace, agentId, queries) {
  assert(Array.isArray(queries) && queries.length > 0
    && queries.every(query => /^\s*SELECT\b/i.test(query.sql)));
  const result = await cloudflare(`/workers/durable_objects/namespaces/${namespace}/query/v2`, {
    durable_object_name: agentId,
    jurisdiction: "none",
    queries,
  });
  assertReadOnlyDurableResults(result, queries.length);
  return result;
}

async function readOwnAgentGitHead() {
  assert(safeScalar(report.agentId, 120), "Owner-bound runtime agent identifier is invalid.");
  const result = await durableSelect(SPACE_NAMESPACE, report.agentId, [{
    sql: "SELECT path,content_encoding,content FROM cf_workspace_default WHERE type='file' AND (path='.git/HEAD' OR path LIKE '%/.git/HEAD' OR path LIKE '.git/refs/heads/%' OR path LIKE '%/.git/refs/heads/%' OR path='.git/packed-refs' OR path LIKE '%/.git/packed-refs') ORDER BY path LIMIT 1000",
  }]);
  const rows = queryRows(result);
  const headFiles = [];
  const looseRefs = [];
  const packedRefs = [];
  try {
    for (const row of rows) {
      const pathname = typeof row.path === "string" ? row.path : "";
      const isHead = pathname === ".git/HEAD" || pathname.endsWith("/.git/HEAD");
      const isLooseRef = pathname.includes("/.git/refs/heads/")
        || pathname.startsWith(".git/refs/heads/");
      const isPackedRefs = pathname === ".git/packed-refs" || pathname.endsWith("/.git/packed-refs");
      if (!isHead && !isLooseRef && !isPackedRefs) continue;
      const content = row.content_encoding === "base64"
        ? Buffer.from(String(row.content ?? ""), "base64")
        : Buffer.from(row.content ?? "");
      const contentSha256 = digest(content);
      const text = content.toString("utf8").trim();
      if (isHead) {
        headFiles.push({ text, contentSha256 });
      } else if (isLooseRef) {
        looseRefs.push({ path: pathname, text, contentSha256 });
      } else {
        packedRefs.push({ text, contentSha256 });
      }
      content.fill(0);
    }
  } finally {
    for (const row of rows) row.content = null;
    const cursor = result.results[0];
    const contentIndex = cursor.columns.indexOf("content");
    if (contentIndex >= 0) {
      for (const row of cursor.rows) row[contentIndex] = null;
    }
  }
  if (rows.length >= 1000) return { state: "AMBIGUOUS_HEAD", headCommitHash: null };
  if (headFiles.length === 0) return { state: "NO_HEAD", headCommitHash: null };
  if (headFiles.length !== 1) return { state: "AMBIGUOUS_HEAD", headCommitHash: null };

  const headText = headFiles[0].text;
  const directHead = safeCommitHash(headText);
  if (directHead) {
    return {
      state: "VERIFIED",
      headCommitHash: directHead,
      headFileSha256: headFiles[0].contentSha256,
    };
  }
  const symbolicHead = headText.match(/^ref: refs\/heads\/([A-Za-z0-9._/-]{1,120})$/);
  if (!symbolicHead) return { state: "INVALID_HEAD", headCommitHash: null };
  const branch = symbolicHead[1];
  if (branch.startsWith("/") || branch.endsWith("/") || branch.includes("..")
    || branch.includes("//") || branch.endsWith(".lock")) {
    return { state: "INVALID_HEAD", headCommitHash: null };
  }
  const refSuffix = `.git/refs/heads/${branch}`;
  const matchingLooseRefs = looseRefs.filter(ref =>
    ref.path === refSuffix || ref.path.endsWith(`/${refSuffix}`));
  let refHashes = matchingLooseRefs
    .map(ref => ({ hash: safeCommitHash(ref.text), contentSha256: ref.contentSha256 }))
    .filter(ref => ref.hash);
  if (refHashes.length > 1) return { state: "AMBIGUOUS_HEAD", headCommitHash: null };
  if (refHashes.length === 0) {
    const packedHeadRefs = [];
    for (const file of packedRefs) {
      for (const line of file.text.split(/\r?\n/)) {
        const match = line.match(/^([a-f0-9]{40,64}) refs\/heads\/([A-Za-z0-9._/-]{1,120})$/i);
        if (match && match[2] === branch) {
          packedHeadRefs.push({ hash: safeCommitHash(match[1]), contentSha256: file.contentSha256 });
        }
      }
    }
    refHashes = packedHeadRefs.filter(ref => ref.hash);
  }
  if (refHashes.length !== 1 || !refHashes[0].hash) {
    return { state: "UNRESOLVED_HEAD", headCommitHash: null };
  }
  return {
    state: "VERIFIED",
    headCommitHash: refHashes[0].hash,
    headFileSha256: headFiles[0].contentSha256,
    refFileSha256: refHashes[0].contentSha256,
  };
}

function safeRole(role) {
  return ["user", "assistant", "tool", "system"].includes(role) ? role : "other";
}

function evidenceFileSummary(row) {
  const pathname = typeof row.path === "string" ? row.path : "";
  assert(pathname.length > 0 && pathname.length <= 300
    && /^[A-Za-z0-9._/-]+$/.test(pathname));
  assert(!pathname.includes("://") && !/[\u0000-\u001f]/.test(pathname));
  const content = row.content_encoding === "base64"
    ? Buffer.from(row.content ?? "", "base64")
    : Buffer.from(row.content ?? "");
  const result = { path: pathname, length: content.length, sha256: digest(content) };
  content.fill(0);
  return result;
}

async function evidence() {
  phase = "read-only-agent-evidence";
  assert(report.ownerId && report.projectId && report.agentId);
  ensureProjectId(report.projectId);
  assert(await identifyAgent());
  const think = await durableSelect(THINK_NAMESPACE, report.agentId, [{
    sql: "SELECT id,role,created_at,length(content) AS bytes FROM assistant_messages ORDER BY created_at,id",
  }]);
  const space = await durableSelect(SPACE_NAMESPACE, report.agentId, [{
    sql: "SELECT path,content_encoding,content FROM cf_workspace_default WHERE type='file' AND (path LIKE '%/public/%' OR path LIKE '%/src/%' OR path LIKE 'public/%' OR path LIKE 'src/%' OR path LIKE '%.git/HEAD' OR path LIKE '%.git/refs/heads/%') ORDER BY path",
  }]);
  const spaceRows = queryRows(space);
  const files = spaceRows.map(evidenceFileSummary);
  for (const row of spaceRows) row.content = null;
  const contentIndex = space.results[0].columns.indexOf("content");
  if (contentIndex >= 0) {
    for (const row of space.results[0].rows) row[contentIndex] = null;
  }
  const deployments = await durableSelect(SPACE_NAMESPACE, report.agentId, [{
    sql: "SELECT branch,commit_hash,deployed_at FROM deployments",
  }]);
  const messageRows = queryRows(think).map(row => ({
    id: safeScalar(String(row.id ?? ""), 120) ?? "unavailable",
    role: safeRole(typeof row.role === "string" ? row.role.toLowerCase() : ""),
    createdAt: safeTimestamp(row.created_at) ?? "unavailable",
    bytes: safeInteger(Number(row.bytes), Number.MAX_SAFE_INTEGER) ?? null,
  }));
  const userMessages = messageRows.filter(row => row.role === "user").length;
  const toolMessages = messageRows.filter(row => row.role === "tool").length;
  const receivedMetadata = report.safeFrameMetadata
    .filter(frame => frame.direction === "received");
  const turnNumbers = new Set(receivedMetadata
    .map(frame => frame.turn)
    .filter(Number.isSafeInteger));
  const stepKeys = new Set(receivedMetadata
    .filter(frame => Number.isSafeInteger(frame.step))
    .map(frame => `${frame.turn ?? "?"}:${frame.step}:${frame.toolCallId ?? frame.toolName ?? ""}`));
  const continuationCounts = receivedMetadata
    .map(frame => frame.continuationCount)
    .filter(Number.isSafeInteger);
  const deploymentRows = queryRows(deployments).map(row => ({
    branch: /^[A-Za-z0-9._/-]{1,120}$/.test(String(row.branch ?? ""))
      ? String(row.branch) : "unavailable",
    commitHash: /^[a-f0-9]{40,64}$/i.test(String(row.commit_hash ?? ""))
      ? String(row.commit_hash) : "unavailable",
    deployedAt: safeTimestamp(row.deployed_at) ?? "unavailable",
  }));
  const sample = {
    at: new Date().toISOString(),
    messageMetadata: messageRows,
    thinkTurnCount: turnNumbers.size || null,
    assistantMessageCount: messageRows.filter(row => row.role === "assistant").length,
    thinkUserMessageCount: userMessages,
    toolMessageCount: toolMessages,
    toolStepCount: stepKeys.size || null,
    continuationCount: continuationCounts.length ? Math.max(...continuationCounts) : null,
    crossed25StepBoundary: stepKeys.size
      ? receivedMetadata.some(frame => Number.isSafeInteger(frame.step) && frame.step > 25)
      : null,
    files,
    deployments: deploymentRows,
    rowsWritten: 0,
    protectedLifecycleState: "Not queried; Cloudflare SQL authorizer remains enabled.",
    tailCollection: "NOT_RUN; no global customer logs queried.",
  };
  report.evidence = sample;
  await saveReport();
  console.log(JSON.stringify({
    state: report.state,
    ownerId: report.ownerId,
    projectId: report.projectId,
    agentId: report.agentId,
    evidence: sample,
  }));
}

function selfTestContracts() {
  const expectedHash = digest(ACCEPTANCE_PROMPT);
  const idleStatus = {
    nativeThink: true,
    runtimeStatus: "ready",
    connected: true,
    state: {
      shouldBeGenerating: false,
      generation: { status: "idle" },
    },
  };
  const idleState = statusSummary(idleStatus, true);
  assert.equal(idleState.idleNoGeneration, true);
  assert.equal(statusSummary(idleStatus, false).idleNoGeneration, false);
  assert.equal(statusSummary({ ...idleStatus, nativeThink: false }, true).idleNoGeneration, false);
  assert.equal(statusSummary({
    ...idleStatus,
    state: {
      ...idleStatus.state,
      shouldBeGenerating: true,
      generation: { status: "running" },
    },
  }, true).idleNoGeneration, false);
  assert.equal(statusSummary({
    configured: true, provider: "vibesdk", agentId: "old-agent",
    connected: true,
    state: { shouldBeGenerating: false, generation: { status: "idle" } },
  }, true).idleNoGeneration, false);

  const emptyTurns = turnsSummary({ turns: [] });
  assert.equal(emptyTurns.available, true);
  assert.equal(emptyTurns.customerTurnCount, 0);
  const oneTurn = turnsSummary({ turns: [{
    id: 1,
    mode: "build",
    prompt: ACCEPTANCE_PROMPT,
    response: "private response text",
    changedFiles: [],
    activity: [{ message: "private activity text" }],
    commitHash: "a".repeat(40),
    createdAt: "2026-01-01T00:00:00.000Z",
  }] });
  assert.equal(oneTurn.schemaValid, true);
  assert.equal(oneTurn.customerTurnCount, 1);
  assert.equal(oneTurn.matchingCustomerPromptCount, 1);
  assert.equal(oneTurn.promptSha256, expectedHash);
  assert(!JSON.stringify(oneTurn).includes("private"));

  const nullRuntimeRevision = runtimeRevisionSummary({
    status: 200,
    data: { branch: null, commitHash: null },
  });
  const baselineRevision = revisionSummary(nullRuntimeRevision);
  const committedHash = "b".repeat(40);
  const committedRuntimeRevision = runtimeRevisionSummary({
    status: 200,
    data: { branch: "main", commitHash: committedHash },
  });
  const afterRevision = revisionSummary(committedRuntimeRevision);
  assert.equal(nullRuntimeRevision.valid, true);
  assert.equal(runtimeRevisionMatchesSnapshot(nullRuntimeRevision, baselineRevision), true);
  assert.equal(committedRuntimeRevision.valid, true);
  assert.equal(runtimeRevisionMatchesSnapshot(committedRuntimeRevision, afterRevision), true);
  assert.equal(runtimeRevisionMatchesSnapshot(runtimeRevisionSummary({
    status: 404, data: { branch: "main", commitHash: committedHash },
  }), afterRevision), false);
  assert.equal(runtimeRevisionSummary({
    status: 200,
    data: { branch: null, commitHash: committedHash },
  }).valid, false);
  assert.equal(runtimeRevisionSummary({ status: 200, data: {} }).valid, false);
  const mockObserved = {
    userSuggestionFrames: 1,
    matchingPromptFrames: 1,
    unexpectedSuggestionFrame: false,
    suggestionBeforeClick: false,
    terminalFrames: new Set(["generation_complete"]),
  };
  const successfulNativeOperation = {
    status: idleState,
    revision: afterRevision,
    turns: emptyTurns,
  };
  assert.equal(emptyTurns.customerTurnCount, 0, "Native WebSocket operation must not create a builder turn.");
  assert.equal(baselineRevision.headCommitHash, null);
  assert.equal(afterRevision.committedHeadVerified, true);
  assert.equal(afterRevision.headCommitHash, committedHash);
  assert.equal(canReconcileNativeOperation(successfulNativeOperation, baselineRevision, mockObserved), true);
  assert.equal(exactlyOneNativeSuggestion({ ...mockObserved, userSuggestionFrames: 2 }), false);
  assert.equal(extractSentMessage({ message: ACCEPTANCE_PROMPT }), ACCEPTANCE_PROMPT);
  assert.equal(extractSentMessage({ payload: { message: ACCEPTANCE_PROMPT } }), undefined);
  assert.equal(ownerIdentityKey(42), ownerIdentityKey("00042"));
  const priorPhase = phase;
  phase = "project-creation";
  assert.equal(projectRequestAllowed("/api/projects", "POST", undefined), true);
  assert.equal(projectRequestAllowed("/api/projects", "GET", undefined), false);
  assert.equal(projectRequestAllowed("/api/projects/700/runtime/status", "GET", 700), true);
  assert.equal(projectRequestAllowed("/api/projects/700/runtime/revision", "GET", 700), true);
  assert.equal(projectRequestAllowed("/api/projects/701/runtime/status", "GET", 700), false);
  assert.equal(projectRequestAllowed("/api/projects/700/runtime/messages", "POST", 700), false);
  assert.equal(projectRequestAllowed("/api/projects/700/runtime/previews", "POST", 700), true);
  const appWebSocketOrigin = new URL(APP).origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  assert.equal(isOwnerRuntimeWebSocket(
    `${appWebSocketOrigin}/api/projects/700/runtime/ws`,
    700,
  ), true);
  assert.equal(isOwnerRuntimeWebSocket(
    `${appWebSocketOrigin}/api/projects/701/runtime/ws`,
    700,
  ), false);
  phase = priorPhase;

  assert.doesNotThrow(() => assertReadOnlyD1Results([{
    success: true, error: null, meta: { rows_written: 0 },
  }]));
  assert.throws(() => assertReadOnlyD1Results([{
    error: null, meta: { rows_written: 0 },
  }]));
  assert.throws(() => assertReadOnlyD1Results([{
    success: true, error: null, meta: {},
  }]));
  assert.doesNotThrow(() => assertReadOnlyDurableResults({
    error: null,
    results: [{ columns: [], rows: [], error: null, meta: { rows_written: 0 } }],
  }, 1));
  assert.throws(() => assertReadOnlyDurableResults({
    error: null,
    results: [{ columns: [], rows: [], success: false, error: null, meta: { rows_written: 0 } }],
  }, 1));
  assert.throws(() => assertReadOnlyDurableResults({
    error: null,
    results: [{ columns: [], rows: [], error: null, meta: {} }],
  }, 1));

  const proxyLocation = generatedPreviewLocation(
    "https://app.buildcustom.ai/_private_preview/agent-123/main/?t=private-token",
    77,
    "agent-123",
  );
  assert.equal(proxyLocation, "https://app.buildcustom.ai/_private_preview/agent-123/main/");
  assert.equal(generatedPreviewLocation(
    "https://app.buildcustom.ai/app/editor/77",
    77,
    "agent-123",
  ), null);
  assert.equal(safeCloseCodeFromPayload(Buffer.from([0x03, 0xe8]).toString("base64")), 1000);
  assert.equal(safeCloseCodeFromPayload("arbitrary error text"), null);
  assert.equal(safeFrameMetadata({ type: "tool_call", toolName: "read" }, "received")?.toolName, "read");
  assert.equal(safeFrameMetadata({
    type: "tool_call",
    toolName: "arbitrary-user-value",
    name: "sensitive-name",
  }, "received")?.toolName, undefined);
  console.log(JSON.stringify({
    status: "PASS",
    checks: ["runtime-contracts", "buildcustom-turns", "revision-contracts",
      "runtime-revision-route-contract", "native-websocket-attribution",
      "owner-project-request-guard", "owner-id-normalization", "read-only-sql-contracts",
      "preview-frame-target", "websocket-close-code", "tool-name-allowlist"],
  }));
}

try {
  if (action === "self-test") {
    selfTestContracts();
  } else if (action === "setup") {
    await setup();
  } else {
    phase = "load-owned-fixture";
    await loadReport();
    if (action !== "evidence") await loadSession();
    if (action === "run") await startBrowserRun();
    else if (action === "observe") await observe();
    else await evidence();
  }
} catch {
  await markSafeFailure("operation-failed");
  if (report) {
    console.error(JSON.stringify({
      state: report.state ?? "BLOCKED",
      phase,
      failure: "See protected checkpoint for sanitized phase record.",
    }));
  } else {
    console.error(JSON.stringify({ state: "BLOCKED", phase }));
  }
  process.exitCode = 1;
} finally {
  // Never close Chromium on an in-flight customer operation. The observer waits
  // for terminal evidence and owner-side read-only reconciliation before cleanup.
  if (browser && (!requestClickIssued || terminalReconciled)) {
    try {
      await browser.close();
      browser = undefined;
    } catch {
      // No generation was sent; no diagnostic text is emitted.
    }
  }
}