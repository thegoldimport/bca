#!/usr/bin/env node

// Local-only bounded public signup and auth acceptance. Never run from production.
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyBoundedResponse,
  classifyRegistrationMatrix as classifyMatrixCore,
  evaluateLogoutAcceptance,
  evaluateSignupAcceptance,
  isExplicitExecute,
  parseJsonResponse,
  recordCaseResult,
  safeRawResponseText,
  safeMatrixBody,
  sanitizeError,
  sanitizeText,
  sanitizeValue,
  writeAtomicArtifact,
} from "./lib/task12u-registration-operator.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!isExplicitExecute(process.argv.slice(2))) {
  console.error("Refusing to run live registration acceptance without exactly one --execute argument.");
  process.exitCode = 2;
} else {
let puppeteer;
const product = "https://app.buildcustom.ai";
const runtime = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const account = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const productDb = "ca820baf-6973-4318-ac52-529d56293bb6";
const runtimeDb = "716c6600-8c60-408a-9446-3779979d5316";
const existingEmail = "cutover-test@buildcustom.ai";
const artifact = path.join(root, "production/vibesdk-launch",
  `task12r-registration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const disposableEmail = `task12r-${Date.now()}-${randomBytes(5).toString("hex")}@example.net`;
const disposableName = "Task 12R Acceptance";
const report = { startedAt: new Date().toISOString(), checks: {} };
let failed = false;
let browser;
let step = "preconditions";
let substep = "startup";
let caseIndex = null;
let caseSequence = 0;
let networkAuditChecked = false;
const boundedCaseNames = [
  "duplicate-existing-email", "case-variant-duplicate-existing-email", "invalid-email", "weak-password",
  "missing-password", "invalid-request-shape", ...[
    "valid-valid", "valid-missing", "valid-invalid", "invalid-valid", "invalid-missing",
    "invalid-invalid", "missing-valid", "missing-missing", "missing-invalid",
  ].map(pair => `registration-origin-${pair.split("-")[0]}-csrf-${pair.split("-")[1]}`),
  "single-public-ui-signup", "duplicate-new-account-exact", "duplicate-new-account-case-variant",
  "new-user-auth-authority", "new-user-logout-revocation", "existing-user-logout-regression",
];

async function persistArtifact() {
  report.current = { phase: step, substep, caseIndex };
  await writeAtomicArtifact(artifact, report);
}

async function transition(phase, nextSubstep, index = caseIndex) {
  step = phase;
  substep = nextSubstep;
  caseIndex = index;
  await persistArtifact();
}

async function beforeOperation(name) {
  substep = name;
  report.operations ||= [];
  report.operations.push({
    phase: step, substep: name, startedAt: new Date().toISOString(),
    status: "STARTED", fetchStarted: false, responseReceived: false,
  });
  await persistArtifact();
}

async function startFetch(name) {
  const operation = [...(report.operations || [])].reverse()
    .find(item => item.substep === name && item.status === "STARTED");
  if (operation) operation.fetchStarted = true;
  await persistArtifact();
}

async function markResponseReceived(name, response) {
  const operation = [...(report.operations || [])].reverse()
    .find(item => item.substep === name && item.status === "STARTED");
  if (operation) {
    operation.responseReceived = true;
    operation.statusCode = response.status;
    operation.safeHeaders = {
      cfRay: sanitizeText(response.headers?.get?.("cf-ray") || "", 200),
      contentType: sanitizeText(response.headers?.get?.("content-type") || "", 200),
    };
  }
  await persistArtifact();
}

async function afterOperation(name, evidence = undefined) {
  const operation = [...(report.operations || [])].reverse()
    .find(item => item.substep === name && item.status === "STARTED");
  if (operation) {
    operation.status = evidence?.responseReadError || evidence?.error ? "FAIL" : "COMPLETED";
    operation.completedAt = new Date().toISOString();
    if (evidence && typeof evidence === "object") {
      operation.fetchStarted ||= evidence.fetchStarted === true;
      operation.responseReceived ||= evidence.responseReceived === true;
      operation.statusCode = evidence.status ?? null;
      if (evidence.parseError) operation.parseError = evidence.parseError;
      if (evidence.responseReadError) operation.responseReadError = evidence.responseReadError;
      if (evidence.error) operation.error = sanitizeError(evidence.error);
    }
  }
  const current = report.diagnostics?.at(-1);
  if (current) {
    current.lastCompletedOperation = name;
    if (evidence !== undefined) {
      current[name] = evidence && typeof evidence === "object"
        ? {
          ...evidence,
          ...(evidence.error ? { error: sanitizeError(evidence.error) } : {}),
          ...(evidence.rawText ? { rawText: safeRawResponseText(evidence.rawText) } : {}),
          ...(evidence.parsedBody ? { parsedBody: sanitizeValue(evidence.parsedBody) } : {}),
        }
        : evidence;
    }
  }
  await persistArtifact();
}

async function readResponseTextFirst(operationName, response) {
  let rawText = "";
  let responseReadError = null;
  try {
    rawText = await response.text();
  } catch (error) {
    responseReadError = sanitizeError(error);
  }
  const parsed = parseJsonResponse(rawText);
  const evidence = {
    fetchStarted: true,
    responseReceived: true,
    status: response.status,
    contentType: sanitizeText(response.headers.get("content-type") || "", 200),
    cfRay: sanitizeText(response.headers.get("cf-ray") || "", 200),
    rawText: parsed.rawText,
    parsedBody: parsed.safeParsedBody,
    responseBodyParsed: parsed.parseError === null,
    parseError: parsed.parseError,
    responseReadError,
  };
  await afterOperation(operationName, evidence);
  return { ...parsed, responseReadError };
}

async function readBrowserResponseTextFirst(operationName, response) {
  const headers = response.headers();
  let rawText = "";
  let responseReadError = null;
  try {
    rawText = await response.text();
  } catch (error) {
    responseReadError = sanitizeError(error);
  }
  const parsed = parseJsonResponse(rawText);
  await afterOperation(operationName, {
    fetchStarted: true, responseReceived: true, status: response.status(),
    contentType: sanitizeText(headers["content-type"] || "", 200),
    cfRay: sanitizeText(headers["cf-ray"] || "", 200),
    rawText: parsed.rawText, parsedBody: parsed.safeParsedBody,
    responseBodyParsed: parsed.parseError === null,
    parseError: parsed.parseError, responseReadError,
  });
  return {
    status: response.status(), rawText: parsed.rawText,
    parsedBody: parsed.safeParsedBody, parseError: parsed.parseError,
    responseReadError, responseBodyReadable: responseReadError === null,
    contentType: sanitizeText(headers["content-type"] || "", 200),
    cfRay: sanitizeText(headers["cf-ray"] || "", 200),
  };
}

async function attemptDiagnosticRead(run) {
  try {
    return { value: await run(), error: null };
  } catch (error) {
    return { value: null, error: sanitizeError(error) };
  }
}

function beginDiagnosticCase(name, index, metadata = {}) {
  report.diagnostics ||= [];
  const entry = {
    phase: step, caseName: name, sequence: index, status: "RUNNING",
    startedAt: new Date().toISOString(), ...metadata,
  };
  report.diagnostics.push(entry);
  caseIndex = index;
  return entry;
}

function failDiagnosticCase(entry, error) {
  entry.status = "FAIL";
  entry.completedAt = new Date().toISOString();
  entry.error ||= sanitizeError(error);
}

function markRemainingNotRun(afterIndex) {
  report.diagnostics ||= [];
  for (let index = Math.max(1, afterIndex + 1); index <= boundedCaseNames.length; index += 1) {
    if (!report.diagnostics.some(item => item.sequence === index)) {
      report.diagnostics.push({
        phase: "acceptance", caseName: boundedCaseNames[index - 1], sequence: index,
        status: "NOT_RUN", startedAt: null, completedAt: null,
      });
    }
  }
}

function check(name, evidence, passed) {
  report.checks[name] = { at: new Date().toISOString(), status: passed ? "PASS" : "FAIL", evidence };
  if (!passed) failed = true;
  console.log(JSON.stringify({ name, status: report.checks[name].status, evidence }));
}

function requireCondition(condition, message) {
  if (!condition) {
    const error = new Error(`${step}/${caseIndex ?? "no-case"}: ${message}`, {
      cause: Object.assign(new Error("Acceptance condition evaluated false"), { name: "AcceptanceConditionError" }),
    });
    error.name = "AcceptanceAssertionError";
    error.phase = step;
    error.caseIndex = caseIndex;
    throw error;
  }
}

function safeError(error) {
  return {
    phase: step, substep, caseIndex,
    ...sanitizeError(error),
  };
}

function forbiddenCustomerHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const labels = host.split(".");
  const ipv4 = host.split(".").map(Number);
  const privateIpv4 = ipv4.length === 4 && ipv4.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    && (ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127 || ipv4[0] === 169 && ipv4[1] === 254
      || ipv4[0] === 192 && ipv4[1] === 168
      || ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31);
  const privateIpv6 = host === "::1" || host === "::"
    || host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host);
  return /(^|\.)replit\.(com|dev|app)$/.test(host)
    || /(^|\.)repl\.co$/.test(host)
    || labels.some(label => /(^|[-])(legacy|staging|lab)([-]|$)/.test(label))
    || host === "workers.dev" || host.endsWith(".workers.dev")
    || labels.some(label => /gateway|private|internal/.test(label))
    || host === "localhost" || host.endsWith(".localhost")
    || host.endsWith(".local") || host.endsWith(".internal")
    || privateIpv4 || privateIpv6;
}

const browserNetworkAudit = {
  currentPhase: "setup",
  forbiddenHosts: new Set(),
  phases: new Map(),
  record(hostname) {
    this.forbiddenHosts.add(hostname);
    if (!this.phases.has(this.currentPhase)) this.phases.set(this.currentPhase, new Set());
    this.phases.get(this.currentPhase).add(hostname);
  },
  evidence() {
    return {
      forbiddenHostnameCount: this.forbiddenHosts.size,
      forbiddenHostnameCountsByPhase: Object.fromEntries(
        [...this.phases].map(([phase, hosts]) => [phase, hosts.size]),
      ),
    };
  },
};

async function attachBrowserNetworkAudit(page) {
  await beforeOperation("browser-cdp-session-creation");
  const client = await page.target().createCDPSession();
  await afterOperation("browser-cdp-session-creation");
  await beforeOperation("browser-cdp-network-enable");
  await client.send("Network.enable");
  await afterOperation("browser-cdp-network-enable");
  const observe = urlValue => {
    try {
      const hostname = new URL(urlValue).hostname.toLowerCase();
      if (forbiddenCustomerHost(hostname)) browserNetworkAudit.record(hostname);
    } catch {
      // Do not retain malformed or opaque URLs.
    }
  };
  client.on("Network.requestWillBeSent", ({ request }) => observe(request.url));
  client.on("Network.webSocketCreated", ({ url }) => observe(url));
}

async function d1(database, sql, params = []) {
  const operationName = `d1-count-query:${database}`;
  await beforeOperation(operationName);
  await startFetch(operationName);
  const response = await fetch(`${account}/d1/database/${database}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  await markResponseReceived(operationName, response);
  const parsed = await readResponseTextFirst(operationName, response);
  const body = parsed.parsedBody;
  const operation = [...report.operations].reverse().find(item => item.substep === operationName);
  operation.resultRowCount = Array.isArray(body?.result?.[0]?.results) ? body.result[0].results.length : null;
  await persistArtifact();
  requireCondition(response.ok && body?.success === true && Array.isArray(body.result?.[0]?.results),
    `D1 read failed (${response.status})`);
  return body.result[0].results;
}

async function identityRows(email) {
  const [productRows, runtimeRows] = await Promise.all([
    d1(productDb,
      `SELECT id,email,legacy_password_hash FROM users WHERE lower(email)=lower(?)`, [email]),
    d1(runtimeDb, `SELECT id,email FROM users WHERE lower(email)=lower(?)`, [email]),
  ]);
  return { product: productRows, runtime: runtimeRows };
}

async function countEvidence(email) {
  const rows = await identityRows(email);
  return {
    product: { count: rows.product.length, legacyHashNull: rows.product.every(row => row.legacy_password_hash == null) },
    runtime: { count: rows.runtime.length },
  };
}

function countIsZero(value) {
  return value.product.count === 0 && value.runtime.count === 0;
}

function countIsOne(value) {
  return value.product.count === 1 && value.runtime.count === 1 && value.product.legacyHashNull;
}

async function apiRead(url, cookie) {
  const operationName = `api-read:${new URL(url).pathname}`;
  await beforeOperation(operationName);
  await startFetch(operationName);
  const response = await fetch(url, {
    headers: cookie ? { Cookie: cookie } : {},
    cache: "no-store",
    redirect: "manual",
  });
  await markResponseReceived(operationName, response);
  const parsed = await readResponseTextFirst(operationName, response);
  const body = parsed.parsedBody;
  const operation = [...report.operations].reverse().find(item => item.substep === operationName);
  operation.bodyKind = parsed.parseError || parsed.responseReadError ? "non-json" : Array.isArray(body) ? "array" : typeof body;
  await persistArtifact();
  return { status: response.status, body, parseError: parsed.parseError,
    responseReadError: parsed.responseReadError };
}

function cookieHeader(cookies) {
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
}

function cookieValue(cookies, name) {
  return cookies.find(cookie => cookie.name === name)?.value || null;
}

function accessCookie(cookies) {
  return cookies.find(cookie => cookie.name === "accessToken")?.value || null;
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("base64");
}

async function runtimeCheck(cookie) {
  await beforeOperation("runtime-identity-check");
  await startFetch("runtime-identity-check");
  const response = await fetch(`${runtime}/api/auth/check`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });
  await markResponseReceived("runtime-identity-check", response);
  const parsed = await readResponseTextFirst("runtime-identity-check", response);
  const body = parsed.parsedBody;
  return { status: response.status, authenticated: body?.data?.authenticated === true,
    authenticatedValue: body?.data?.authenticated,
    userId: body?.data?.user?.id ?? null, parseError: parsed.parseError,
    responseReadError: parsed.responseReadError };
}

async function sessionEvidence(database, userId, token) {
  const rows = await d1(database,
    `SELECT id,user_id,is_revoked FROM sessions WHERE access_token_hash=? ORDER BY created_at DESC LIMIT 1`,
    [tokenHash(token)]);
  const session = rows[0] || null;
  return {
    exists: !!session,
    ownerMatches: !!session && String(session.user_id) === String(userId),
    revoked: session?.is_revoked == null ? null : Number(session.is_revoked) === 1,
    sessionId: session?.id ?? null,
  };
}

async function productLocalSessionCount(database, userId) {
  const rows = await d1(database, `SELECT count(*) AS total FROM sessions WHERE user_id=?`, [userId]);
  return Number(rows[0]?.total ?? -1);
}

async function getCsrfToken(page) {
  await beforeOperation("csrf-token-acquisition");
  await startFetch("csrf-token-acquisition");
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/auth/csrf-token", { credentials: "same-origin", cache: "no-store" });
    let raw = "";
    let readError = null;
    try { raw = await response.text(); } catch (error) {
      readError = {
        name: error?.name || "ResponseReadError",
        message: error?.message || "response text read failed",
        stack: error?.stack || "",
      };
    }
    return { status: response.status, rawText: raw, readError,
      contentType: response.headers.get("content-type"), cfRay: response.headers.get("cf-ray") };
  });
  const parsed = parseJsonResponse(result.rawText);
  const token = parsed.parsedBody?.token ?? parsed.parsedBody?.data?.token ?? null;
  await afterOperation("csrf-token-acquisition", {
    fetchStarted: true, responseReceived: true, status: result.status, tokenPresent: !!token,
    parseError: parsed.parseError,
    responseReadError: sanitizeError(result.readError),
    contentType: sanitizeText(result.contentType || "", 200),
    cfRay: sanitizeText(result.cfRay || "", 200),
    rawText: parsed.rawText,
    parsedBody: parsed.safeParsedBody,
  });
  return { ...result, token, parsedBody: parsed.parsedBody, parseError: parsed.parseError };
}

async function submitBounded(page, kind, body, expectedIdentityCount = 0, requireNoLogin = false) {
  const entry = beginDiagnosticCase(kind, ++caseSequence, {
    request: { method: "POST", path: "/api/auth/register" },
    payloadCategory: kind,
    originState: "same-origin",
    csrfState: "valid",
    csrfSource: "public csrf-token endpoint",
    cookieState: "browser-managed same-origin cookies",
    fetchStarted: false,
    responseReceived: false,
  });
  await persistArtifact();
  const targetEmail = typeof body.email === "string" ? body.email : null;
  let countsBefore = null;
  if (targetEmail) {
    await beforeOperation(`counts-before:${kind}`);
    countsBefore = await countEvidence(targetEmail);
    entry.countsBefore = countsBefore;
    await persistArtifact();
  }
  const csrf = await getCsrfToken(page);
  requireCondition(csrf.status === 200 && typeof csrf.token === "string" && csrf.token.length > 0,
    `CSRF token unavailable for ${kind}`);
  const boundedOperation = `bounded-request:${kind}`;
  await beforeOperation(boundedOperation);
  await startFetch(boundedOperation);
  const rawResult = await page.evaluate(async ({ body, token }) => {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify(body),
    });
    let rawText = "";
    let readError = null;
    try { rawText = await response.text(); } catch (error) {
      readError = {
        name: error?.name || "ResponseReadError",
        message: error?.message || "response text read failed",
        stack: error?.stack || "",
      };
    }
    return {
      status: response.status,
      rawText,
      readError,
      contentType: response.headers.get("content-type"),
      cfRay: response.headers.get("cf-ray"),
    };
  }, { body, token: csrf.token });
  const boundedResponse = {
    status: rawResult.status,
    headers: { get: name => name.toLowerCase() === "content-type" ? rawResult.contentType
      : name.toLowerCase() === "cf-ray" ? rawResult.cfRay : null },
  };
  await markResponseReceived(boundedOperation, boundedResponse);
  const parsedResponse = parseJsonResponse(rawResult.rawText);
  const payload = parsedResponse.parsedBody;
  const parseError = rawResult.readError ? sanitizeError(rawResult.readError) : parsedResponse.parseError;
  const result = {
    status: rawResult.status,
    json: payload !== null && typeof payload === "object",
    safeMessage: typeof (payload?.message ?? payload?.error) === "string"
      && (payload.message ?? payload.error).length > 0
      && (payload.message ?? payload.error).length <= 200
      && JSON.stringify(payload).length <= 2048
      && !/stack|exception|token|secret|authorization|cookie/i.test(JSON.stringify(payload)),
  };
  const diag = entry;
  if (diag) {
    diag.fetchStarted = true;
    diag.responseReceived = true;
    diag.httpStatus = rawResult.status;
    diag.safeHeaders = {
      contentType: sanitizeText(rawResult.contentType || "", 200),
      cfRay: sanitizeText(rawResult.cfRay || "", 200),
    };
    diag.rawText = parsedResponse.rawText;
    diag.parsedBody = payload && typeof payload === "object" ? sanitizeValue(payload) : null;
    diag.parseError = parseError ? sanitizeError(parseError) : null;
    diag.responseReadError = rawResult.readError ? sanitizeError(rawResult.readError) : null;
  }
  await afterOperation(boundedOperation, {
    fetchStarted: true, responseReceived: true, status: rawResult.status,
    rawText: parsedResponse.rawText,
    parsedBody: diag.parsedBody,
    parseError,
    responseReadError: rawResult.readError ? sanitizeError(rawResult.readError) : null,
  });
  const identityAfter = requireNoLogin
    ? (await beforeOperation(`auth-identity-after:${kind}`), await publicAuthIdentity(page))
    : null;
  const counts = targetEmail ? await countEvidence(targetEmail) : null;
  const identityUnchanged = expectedIdentityCount === 0
    ? !!counts && countIsZero(counts)
    : !!counts && counts.product.count === expectedIdentityCount
      && counts.runtime.count === expectedIdentityCount && counts.product.legacyHashNull;
  await beforeOperation(`evaluation:${kind}`);
  const classification = classifyBoundedResponse({
    status: result.status, parsedBody: payload, parseError,
    expectedCount: expectedIdentityCount,
    observedCount: counts ? Math.max(counts.product.count, counts.runtime.count) : -1,
    noAutomaticLogin: !requireNoLogin || !identityAfter.present,
  });
  const passed = classification === "PASS" && result.json && result.safeMessage && identityUnchanged;
  if (diag) {
    diag.countsBefore = countsBefore;
    diag.countsAfter = counts;
    recordCaseResult(diag, {
      classification, status: passed ? "PASS" : "FAIL", httpStatus: result.status,
      error: passed ? null : {
      name: "BoundedResponseAssertionError",
      message: `Expected bounded validation response and unchanged identity count; observed HTTP ${result.status}`,
      stack: null, cause: null,
      },
    });
    await persistArtifact();
  }
  await persistArtifact();
  check(kind, { status: result.status, safeJsonValidation: result.json && result.safeMessage,
    identity: counts, expectedIdentityCount, noAutomaticLogin: requireNoLogin ? !identityAfter.present : null }, passed);
  requireCondition(passed, `Bounded registration case ${kind} failed (${classification})`);
}

function safeResponseBody(raw) {
  return safeMatrixBody(raw);
}

function classifyRegistrationMatrix(originState, csrfState, status, body) {
  return classifyMatrixCore(originState, csrfState, status, body);
}

async function registrationMatrixAttempt({ originState, csrfState, csrfToken, csrfCookie, email, password }) {
  const headers = { "Content-Type": "application/json" };
  if (originState === "valid") headers.Origin = product;
  if (originState === "invalid") headers.Origin = "https://not-buildcustom.example";
  if (csrfCookie) headers.Cookie = `csrf-token=${csrfCookie}`;
  if (csrfState === "valid") headers["X-CSRF-Token"] = csrfToken;
  if (csrfState === "invalid") headers["X-CSRF-Token"] = "invalid-task12r-csrf";
  let status = null;
  let body = { classification: "UNKNOWN", exactBody: null, message: null };
  const evidence = { fetchStarted: false, responseReceived: false, status: null };
  try {
    const operationName = `matrix-fetch:${originState}-${csrfState}`;
    await beforeOperation(operationName);
    await startFetch(operationName);
    evidence.fetchStarted = true;
    const response = await fetch(`${product}/api/auth/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: disposableName, email, password }),
      redirect: "manual",
    });
    await markResponseReceived(operationName, response);
    evidence.responseReceived = true;
    status = response.status;
    evidence.status = status;
    evidence.safeHeaders = {
      cfRay: sanitizeText(response.headers.get("cf-ray") || "", 200),
      contentType: sanitizeText(response.headers.get("content-type") || "", 200),
    };
    const raw = await response.text();
    const parsed = parseJsonResponse(raw);
    evidence.rawText = parsed.rawText;
    body = safeResponseBody(raw);
    evidence.parsedBody = body.classification === "SAFE_JSON" ? { message: body.message } : null;
    evidence.parseError = parsed.parseError;
    await afterOperation(`matrix-fetch:${originState}-${csrfState}`, evidence);
  } catch (error) {
    evidence.error = sanitizeError(error);
    body = { classification: "UNKNOWN", exactBody: evidence.rawText || null, message: null };
    await persistArtifact();
  }
  return { status, body, evidence };
}

async function publicAuthIdentity(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    const raw = await response.text();
    let body = null;
    try { body = JSON.parse(raw); } catch {}
    return { present: !!body?.id };
  });
}

async function login(page, email, password) {
  await beforeOperation("login-page-navigation");
  await page.goto(`${product}/app/login`, { waitUntil: "domcontentloaded" });
  await afterOperation("login-page-navigation");
  requireCondition(new URL(page.url()).origin === product, "Login navigation left the public product origin");
  await beforeOperation("login-email-entry");
  await page.locator('[data-testid="input-email"]').fill(email);
  await afterOperation("login-email-entry");
  await beforeOperation("login-password-entry");
  await page.locator('[data-testid="input-password"]').fill(password);
  await afterOperation("login-password-entry");
  await beforeOperation("login-response-wait-registration");
  const responsePromise = page.waitForResponse(response =>
    response.url().includes("/api/auth/login") && response.request().method() === "POST", { timeout: 30000 });
  await afterOperation("login-response-wait-registration");
  await beforeOperation("login-submit-click");
  await page.locator('[data-testid="button-submit"]').click();
  await afterOperation("login-submit-click");
  await beforeOperation("login-response-receive");
  let response = null;
  let responseError = null;
  try { response = await responsePromise; } catch (error) { responseError = sanitizeError(error); }
  await afterOperation("login-response-receive", {
    status: response?.status() ?? null, responseReceived: !!response,
    error: responseError,
  });
  await beforeOperation("login-dashboard-navigation-wait");
  const dashboardReached = await page.waitForFunction(() => location.pathname === "/app" || location.pathname === "/app/", {
    timeout: 45000,
  }).then(() => true).catch(() => false);
  await afterOperation("login-dashboard-navigation-wait", { dashboardReached });
  const me = await apiRead(`${product}/api/auth/me`, cookieHeader(await page.cookies(product)));
  const projects = await apiRead(`${product}/api/projects`, cookieHeader(await page.cookies(product)));
  return {
    loginStatus: response?.status() ?? null,
    responseError,
    dashboardReached,
    me,
    projects,
  };
}

async function logout(page) {
  await beforeOperation("logout-app-navigation");
  await page.goto(`${product}/app`, { waitUntil: "domcontentloaded" });
  await afterOperation("logout-app-navigation");
  await beforeOperation("logout-button-wait");
  await page.waitForSelector('[data-testid="button-logout"]', { timeout: 30000 });
  await afterOperation("logout-button-wait");
  await beforeOperation("logout-response-wait-registration");
  const responsePromise = page.waitForResponse(response =>
    response.url().includes("/api/auth/logout") && response.request().method() === "POST", { timeout: 30000 });
  await afterOperation("logout-response-wait-registration");
  await beforeOperation("logout-submit-click");
  await startFetch("logout-submit-click");
  await page.locator('[data-testid="button-logout"]').click();
  await afterOperation("logout-submit-click", { fetchStarted: true });
  await beforeOperation("logout-response-receive");
  const response = await responsePromise;
  const headers = response.headers();
  await markResponseReceived("logout-response-receive", {
    status: response.status(), headers: { get: name => headers[name.toLowerCase()] || null },
  });
  const responseEvidence = await readBrowserResponseTextFirst("logout-response-receive", response);
  await beforeOperation("logout-login-redirect-wait");
  await page.waitForFunction(() => location.pathname === "/app/login" || location.pathname === "/app/login/", {
    timeout: 45000,
  }).catch(() => undefined);
  await afterOperation("logout-login-redirect-wait");
  return { status: response.status(), rawText: responseEvidence.rawText,
    responseBodyReadable: responseEvidence.responseBodyReadable,
    parseError: responseEvidence.parseError,
    contentType: responseEvidence.contentType, cfRay: responseEvidence.cfRay,
    cookies: await page.cookies(product) };
}

async function assertLogoutFlow({ label, page, email, password, identity, projectsBefore }) {
  const logoutDiagnostic = beginDiagnosticCase(`${label}-logout-revocation-and-fresh-login`, ++caseSequence, {
    requestPath: "/api/auth/logout", method: "POST", fetchStarted: false, responseReceived: false,
  });
  await persistArtifact();
  browserNetworkAudit.currentPhase = `${label}-logout-and-old-session-replay`;
  await transition(`${label}-login-before-logout`, "login-navigation-and-ui");
  const initialLogin = await login(page, email, password);
  const beforeCookies = await page.cookies(product);
  const oldAccessToken = accessCookie(beforeCookies);
  requireCondition(oldAccessToken, `${label}: runtime credential absent`);
  const oldCookie = cookieHeader(beforeCookies);
  const runtimeBefore = await runtimeCheck(oldCookie);
  const sessionBefore = await sessionEvidence(runtimeDb, identity.runtime[0].id, oldAccessToken);
  const localSessions = await productLocalSessionCount(productDb, identity.product[0].id);
  const preLogoutEvaluation = evaluateLogoutAcceptance({
    stage: "pre-logout",
    loginStatus: initialLogin.loginStatus,
    dashboardReached: initialLogin.dashboardReached,
    dashboardStatus: initialLogin.projects.status,
    projectsArray: Array.isArray(initialLogin.projects.body),
    productIdentityPresent: initialLogin.me.status === 200 && !!initialLogin.me.body?.id,
    productIdentityMatches: String(initialLogin.me.body?.id) === String(identity.product[0].id),
    runtimeAuthenticated: runtimeBefore.authenticated,
    runtimeIdentityMatches: String(runtimeBefore.userId) === String(identity.runtime[0].id),
    sessionExists: sessionBefore.exists,
    sessionOwnerMatches: sessionBefore.ownerMatches,
    sessionRevoked: sessionBefore.revoked,
    productLocalSessionCount: localSessions,
  });
  logoutDiagnostic.preLogoutEvaluation = preLogoutEvaluation;
  if (!preLogoutEvaluation.passed) {
    recordCaseResult(logoutDiagnostic, {
      classification: "FAIL", status: "FAIL",
      error: { name: preLogoutEvaluation.errorName, message: preLogoutEvaluation.errorMessage },
    });
    await persistArtifact();
  }
  requireCondition(preLogoutEvaluation.passed, `${label}: ${preLogoutEvaluation.errorMessage || "logout precondition failed"}`);

  await transition(`${label}-logout`, "logout-navigation-and-ui");
  await beforeOperation(`${label}:logout-request-via-ui`);
  const logoutResult = await logout(page);
  logoutDiagnostic.fetchStarted = true;
  logoutDiagnostic.responseReceived = true;
  logoutDiagnostic.logoutStatus = logoutResult.status;
  await persistArtifact();
  const browserCredentialCleared = !logoutResult.cookies.some(cookie =>
    cookie.name === "accessToken" && cookie.value === oldAccessToken);
  const sessionAfter = await sessionEvidence(runtimeDb, identity.runtime[0].id, oldAccessToken);
  const oldProduct = await apiRead(`${product}/api/auth/me`, oldCookie);
  const oldRuntime = await runtimeCheck(oldCookie);
  const oldProductCredentialReturnsNull = oldProduct.status === 200
    && oldProduct.parseError === null && !oldProduct.responseReadError && oldProduct.body === null;
  const oldRuntimeCredentialUnauthenticated = oldRuntime.status === 200
    && oldRuntime.parseError === null && !oldRuntime.responseReadError
    && oldRuntime.authenticatedValue === false;
  const postLogoutEvidence = {
    logoutStatus: logoutResult.status, browserCredentialCleared,
    responseBodyReadable: logoutResult.responseBodyReadable,
    sessionExists: sessionAfter.exists, sessionOwnerMatches: sessionAfter.ownerMatches,
    sessionRevoked: sessionAfter.revoked,
    oldProductStatus: oldProduct.status,
    oldProductParseSucceeded: oldProduct.parseError === null && !oldProduct.responseReadError,
    oldProductBodyIsNull: oldProduct.body === null,
    oldRuntimeStatus: oldRuntime.status,
    oldRuntimeParseSucceeded: oldRuntime.parseError === null && !oldRuntime.responseReadError,
    oldRuntimeAuthenticated: oldRuntime.authenticatedValue,
  };
  const postLogoutEvaluation = evaluateLogoutAcceptance({ stage: "after-logout", ...postLogoutEvidence });
  logoutDiagnostic.postLogoutEvaluation = postLogoutEvaluation;
  logoutDiagnostic.sessionRevoked = sessionAfter.revoked;
  logoutDiagnostic.oldProductCredentialReturnsNull = oldProductCredentialReturnsNull;
  logoutDiagnostic.oldRuntimeCredentialUnauthenticated = oldRuntimeCredentialUnauthenticated;
  await persistArtifact();
  if (!postLogoutEvaluation.passed) {
    recordCaseResult(logoutDiagnostic, {
      classification: "FAIL", status: "FAIL", httpStatus: logoutResult.status,
      error: { name: postLogoutEvaluation.errorName, message: postLogoutEvaluation.errorMessage },
    });
    await persistArtifact();
  }
  requireCondition(postLogoutEvaluation.passed, `${label}: ${postLogoutEvaluation.errorMessage || "logout evaluation failed"}`);

  browserNetworkAudit.currentPhase = `${label}-fresh-login`;
  await transition(`${label}-fresh-login`, "fresh-login-navigation-and-ui");
  const fresh = await login(page, email, password);
  const freshRuntime = await runtimeCheck(cookieHeader(await page.cookies(product)));
  const currentCounts = await countEvidence(email);
  let ownershipStable = true;
  if (projectsBefore) {
    ownershipStable = JSON.stringify((fresh.projects.body || []).map(project => Number(project.id)).sort())
      === JSON.stringify(projectsBefore.map(project => Number(project.id)).sort());
  }
  const freshEvaluation = evaluateLogoutAcceptance({
    stage: "complete", ...postLogoutEvidence,
    freshProductIdentityPresent: fresh.me.status === 200 && !!fresh.me.body?.id,
    freshProductIdentityMatches: String(fresh.me.body?.id) === String(identity.product[0].id),
    freshDashboardReached: fresh.dashboardReached && fresh.projects.status === 200 && Array.isArray(fresh.projects.body),
    freshRuntimeAuthenticated: freshRuntime.authenticated
      && String(freshRuntime.userId) === String(identity.runtime[0].id),
    countsOne: countIsOne(currentCounts),
    projectOwnershipStable: ownershipStable,
  });
  logoutDiagnostic.freshLoginEvaluation = freshEvaluation;
  recordCaseResult(logoutDiagnostic, {
    classification: freshEvaluation.passed ? "PASS" : "FAIL",
    status: freshEvaluation.passed ? "PASS" : "FAIL",
    httpStatus: logoutResult.status,
    error: freshEvaluation.passed ? null : {
      name: freshEvaluation.errorName, message: freshEvaluation.errorMessage,
    },
  });
  await persistArtifact();
  requireCondition(freshEvaluation.passed, `${label}: ${freshEvaluation.errorMessage || "fresh login failed"}`);
  check(`${label}-logout-revocation-and-fresh-login`, {
    logoutStatus: logoutResult.status,
    browserCredentialCleared,
    runtimeSessionRevoked: sessionAfter.revoked,
    oldProductCredentialReturnsNull,
    oldRuntimeCredentialUnauthenticated,
    freshLogin: freshEvaluation.assertions.freshLoginSucceeded,
    dashboardLoaded: freshEvaluation.assertions.freshLoginSucceeded,
    existingProjectOwnershipStable: ownershipStable,
    identityCounts: currentCounts,
  }, true);
  return fresh;
}

try {
  await transition("startup", "puppeteer-module-load");
  puppeteer = createRequire(path.join(root, "lab/bc-vibesdk-lab-20260925/package.json"))("puppeteer");
  const handoffPath = process.env.TASK12T_CREDENTIAL_HANDOFF_PATH;
  requireCondition(typeof handoffPath === "string" && path.isAbsolute(handoffPath)
    && handoffPath === path.resolve(handoffPath) && path.dirname(handoffPath) === "/tmp",
  "TASK12T_CREDENTIAL_HANDOFF_PATH must name a fresh absolute file directly under /tmp");
  requireCondition(!!process.env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN is required for read-only D1 evidence");
  requireCondition(!!process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD,
    "BUILDCUSTOM_CUTOVER_TESTER_PASSWORD is required for existing-user logout regression");

  await transition("existing-identity-precondition", "existing-identity-counts");
  const existingBefore = await identityRows(existingEmail);
  requireCondition(existingBefore.product.length === 1 && existingBefore.runtime.length === 1
    && existingBefore.product[0].legacy_password_hash == null,
  "Existing acceptance identity must exist once in both D1 databases with a null legacy password hash");
  requireCondition(String(existingBefore.product[0].id) === String(existingBefore.runtime[0].id),
    "Existing product/runtime identity mapping differs");

  await transition("bounded-registration-validation", "initial-identity-counts");
  const beforeExisting = await countEvidence(existingEmail);
  const beforeDisposable = await countEvidence(disposableEmail);
  requireCondition(countIsZero(beforeDisposable), "Generated disposable email already exists; refusing signup");
  await beforeOperation("browser-launch");
  browser = await puppeteer.launch({
    executablePath: "/repl/tools/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  await afterOperation("browser-launch", { launched: true });
  await beforeOperation("browser-new-page");
  const page = await browser.newPage();
  await afterOperation("browser-new-page", { created: true });
  await attachBrowserNetworkAudit(page);
  page.setDefaultTimeout(30000);
  browserNetworkAudit.currentPhase = "anonymous-signup";
  await beforeOperation("signup-page-navigation");
  await page.goto(`${product}/app/signup`, { waitUntil: "domcontentloaded" });
  await afterOperation("signup-page-navigation");
  await beforeOperation("signup-ui-ready-wait");
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="button-submit"]')?.textContent?.includes("Create Account"),
  { timeout: 20000 });
  await afterOperation("signup-ui-ready-wait");
  await beforeOperation("public-capabilities-and-runtime-providers");
  const [productCapabilities, runtimeProviders] = await Promise.all([
    apiRead(`${product}/api/public/capabilities`),
    apiRead(`${runtime}/api/auth/providers`),
  ]);
  await afterOperation("public-capabilities-and-runtime-providers", {
    productStatus: productCapabilities.status,
    runtimeStatus: runtimeProviders.status,
    productRegistrationEnabled: productCapabilities.body?.registrationEnabled === true,
    runtimeRegistrationEnabled: runtimeProviders.body?.registrationEnabled === true,
    runtimeEmailEnabled: runtimeProviders.body?.email === true,
  });
  requireCondition(productCapabilities.status === 200
    && productCapabilities.body?.registrationEnabled === true
    && runtimeProviders.status === 200
    && runtimeProviders.body?.registrationEnabled === true
    && runtimeProviders.body?.email === true,
  "Origin/CSRF matrix requires both public and runtime registration enabled with email authentication");
  check("security-matrix-open-preconditions", {
    productRegistration: true, runtimeRegistration: true, runtimeEmailAuthentication: true,
  }, true);

  const ephemeralPassword = `Qa9!${randomBytes(20).toString("hex")}`;
  const csrf = await getCsrfToken(page);
  requireCondition(csrf.status === 200 && csrf.token, "Public registration CSRF token unavailable");
  const csrfCookie = cookieValue(await page.cookies(product), "csrf-token");
  requireCondition(csrfCookie, "Public registration CSRF cookie unavailable");
  browserNetworkAudit.currentPhase = "security-matrix";
  await submitBounded(page, "duplicate-existing-email", {
    name: disposableName, email: existingEmail, password: ephemeralPassword,
  }, 1, true);
  await submitBounded(page, "case-variant-duplicate-existing-email", {
    name: disposableName, email: existingEmail.toUpperCase(), password: ephemeralPassword,
  }, 1, true);
  await submitBounded(page, "invalid-email", {
    name: disposableName, email: "not-an-email", password: ephemeralPassword,
  });
  await submitBounded(page, "weak-password", {
    name: disposableName, email: `task12r-weak-${Date.now()}@example.net`, password: "short",
  });
  await submitBounded(page, "missing-password", {
    name: disposableName, email: `task12r-missing-${Date.now()}@example.net`,
  });
  await submitBounded(page, "invalid-request-shape", {
    name: ["wrong-type"], email: `task12r-shape-${Date.now()}-${randomBytes(3).toString("hex")}@example.net`,
    password: true,
  });

  await transition("origin-csrf-rejections", "matrix-case-start");
  const matrixEmail = "not-an-email";
  const matrixCases = [];
  for (const originState of ["valid", "invalid", "missing"]) {
    for (const csrfState of ["valid", "missing", "invalid"]) {
      const caseName = `registration-origin-${originState}-csrf-${csrfState}`;
      const entry = beginDiagnosticCase(caseName, ++caseSequence, {
        originState, csrfState, request: { method: "POST", path: "/api/auth/register" },
        cookieState: csrfCookie ? "csrf cookie present" : "csrf cookie missing",
        payloadCategory: "invalid-email-with-strong-password",
        fetchStarted: false, responseReceived: false,
      });
      await persistArtifact();
      await beforeOperation(`${caseName}:counts-before`);
      const before = {
        invalidEmail: await countEvidence(matrixEmail),
        existing: await countEvidence(existingEmail),
        disposable: await countEvidence(disposableEmail),
      };
      entry.countsBefore = before;
      await persistArtifact();
      const result = await registrationMatrixAttempt({
        originState, csrfState, csrfToken: csrf.token, csrfCookie,
        email: matrixEmail, password: ephemeralPassword,
      });
      const after = {
        invalidEmail: await countEvidence(matrixEmail),
        existing: await countEvidence(existingEmail),
        disposable: await countEvidence(disposableEmail),
      };
      entry.fetchStarted = result.evidence.fetchStarted;
      entry.responseReceived = result.evidence.responseReceived;
      entry.httpStatus = result.status;
      entry.safeHeaders = result.evidence.safeHeaders || null;
      entry.rawText = result.evidence.rawText || null;
      entry.parsedBody = result.evidence.parsedBody || null;
      entry.error = result.evidence.error || null;
      entry.countsAfter = after;
      await persistArtifact();
      await beforeOperation(`${caseName}:evaluation`);
      const classification = classifyRegistrationMatrix(originState, csrfState, result.status, result.body);
      const expectedNextStage = originState !== "valid" ? "control Origin guard stops before runtime"
        : csrfState === "valid" ? "runtime email schema rejects before identity mutation"
          : "runtime CSRF middleware stops before auth controller";
      const observedStage = originState !== "valid" && result.status === 400
        && result.body.message === "ORIGIN_REJECTED" ? "control Origin-specific response"
        : originState === "valid" && result.status === 400
          && result.body.message === "Could not create your account. Check your details."
          ? "runtime client rejection mapped by control"
          : originState === "valid" && result.status === 403
            && result.body.message === "Could not create your account. Check your details."
            ? "runtime 403 mapped by control; CSRF provenance is source/test-backed, not exposed in public body"
            : "UNKNOWN";
      const countsUnchanged = JSON.stringify(before) === JSON.stringify(after);
      const countEvidenceValid = countIsZero(before.invalidEmail) && countIsZero(after.invalidEmail)
        && countIsOne(before.existing) && countIsOne(after.existing)
        && countIsZero(before.disposable) && countIsZero(after.disposable);
      const passed = classification === "PASS" && countsUnchanged && countEvidenceValid;
      const name = `registration-origin-${originState}-csrf-${csrfState}`;
      const evidence = {
        origin: {
          state: originState,
        },
        csrf: {
          state: csrfState,
        },
        payloadCategory: { name: "string", password: "strong" },
        status: result.status,
        responseClassification: result.body.classification,
        safeResponseBody: result.body.exactBody,
        expectedNextStage,
        observedStage,
        classification: passed ? "PASS" : classification === "PASS" ? "FAIL" : classification,
        countsBefore: before,
        countsAfter: after,
        countsUnchanged,
        localMiddlewareOrderProof: {
          source: "cloudflare/worker.ts and tests/cloudflare-launch-registration-origin.test.ts",
          detail: "assertOrigin precedes dispatch; launch-boundary tests prove rejection before runtime, and runtime createApp/CsrfService tests prove CSRF rejects before the auth controller.",
          limitation: "The public control response maps a runtime 403 to a generic message. CSRF attribution also depends on the independently version-traced runtime and the verified open/email-enabled prerequisites; this response alone is not proof.",
        },
      };
      matrixCases.push({ name, ...evidence });
      check(name, evidence, passed);
      const finalClassification = passed ? "PASS" : classification;
      if (!passed) entry.error ||= {
        name: "RegistrationMatrixAssertionError",
        message: `Expected ${originState} Origin / ${csrfState} CSRF response; observed ${result.status ?? "no response"}`,
        stack: null, cause: null,
      };
      recordCaseResult(entry, {
        classification: finalClassification,
        status: passed ? "PASS" : "FAIL",
        httpStatus: result.status,
      });
      await persistArtifact();
      requireCondition(passed, `${caseName} failed (${classification})`);
    }
  }
  const afterRejectedExisting = await countEvidence(existingEmail);
  const afterRejectedDisposable = await countEvidence(disposableEmail);
  check("rejected-registration-identities-unchanged", {
    existingBefore: beforeExisting, existingAfter: afterRejectedExisting,
    disposableBefore: beforeDisposable, disposableAfter: afterRejectedDisposable,
    matrixCases: matrixCases.map(({ name, classification }) => ({ name, classification })),
  }, countIsOne(afterRejectedExisting) && countIsZero(afterRejectedDisposable)
    && matrixCases.every(testCase => testCase.classification === "PASS"));
  requireCondition(!failed, "At least one bounded registration validation check failed");

  await transition("single-public-ui-signup", "signup-ui-navigation");
  const signupDiagnostic = beginDiagnosticCase("single-public-ui-signup", ++caseSequence, {
    method: "single-public-ui-submit", requestPath: "/api/auth/register",
    originState: "same-origin product UI", csrfState: "valid UI-managed",
    cookieState: "browser-managed same-origin cookies",
    fetchStarted: false, responseReceived: false, retryPolicy: "never",
  });
  signupDiagnostic.countsBefore = beforeDisposable;
  await persistArtifact();
  browserNetworkAudit.currentPhase = "successful-single-signup";
  await beforeOperation("signup-page-navigation");
  await page.goto(`${product}/app/signup`, { waitUntil: "domcontentloaded" });
  await afterOperation("signup-page-navigation");
  await beforeOperation("signup-ui-ready-wait");
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="button-submit"]')?.textContent?.includes("Create Account"),
  { timeout: 20000 });
  await afterOperation("signup-ui-ready-wait");
  requireCondition(new URL(page.url()).origin === product, "Signup navigation left the public product origin");
  await beforeOperation("signup-name-entry");
  await page.locator('[data-testid="input-name"]').fill(disposableName);
  await afterOperation("signup-name-entry");
  await beforeOperation("signup-email-entry");
  await page.locator('[data-testid="input-email"]').fill(disposableEmail);
  await afterOperation("signup-email-entry");
  await beforeOperation("signup-password-entry");
  await page.locator('[data-testid="input-password"]').fill(ephemeralPassword);
  await afterOperation("signup-password-entry");
  await beforeOperation("signup-response-wait-registration");
  const signupResponsePromise = page.waitForResponse(response =>
    new URL(response.url()).origin === product && new URL(response.url()).pathname === "/api/auth/register"
      && response.request().method() === "POST",
    { timeout: 30000 }).then(async response => {
      const headers = response.headers();
      await markResponseReceived("signup-submit-click", {
        status: response.status(),
        headers: {
          get: name => name.toLowerCase() === "content-type" ? headers["content-type"]
            : name.toLowerCase() === "cf-ray" ? headers["cf-ray"] : null,
        },
      });
      return readBrowserResponseTextFirst("signup-submit-click", response);
    }).catch(error => ({ responseError: sanitizeError(error) }));
  await afterOperation("signup-response-wait-registration");
  let signupRequestCount = 0;
  const countSignupRequest = request => {
    try {
      const url = new URL(request.url());
      if (url.origin === product && url.pathname === "/api/auth/register" && request.method() === "POST") {
        signupRequestCount += 1;
      }
    } catch { /* Ignore malformed non-registration requests. */ }
  };
  page.on("request", countSignupRequest);
  let signupClickCount = 0;
  let signupResponseStatus = null;
  let signupResponseEvidence = null;
  let signupClickError = null;
  try {
    await beforeOperation("signup-submit-click");
    await startFetch("signup-submit-click");
    signupClickCount += 1;
    signupDiagnostic.clickAttempted = true;
    signupDiagnostic.fetchStarted = true;
    await persistArtifact();
    try {
      await page.locator('[data-testid="button-submit"]').click();
    } catch (error) {
      signupClickError = sanitizeError(error);
      signupDiagnostic.clickError = signupClickError;
      await afterOperation("signup-submit-click", { fetchStarted: true, error });
    }
    signupResponseEvidence = await signupResponsePromise;
    if (signupResponseEvidence.responseError) {
      signupDiagnostic.responseError = signupResponseEvidence.responseError;
      if (!signupClickError) {
        await afterOperation("signup-submit-click", {
          fetchStarted: true, error: signupResponseEvidence.responseError,
        });
      }
    } else {
      signupResponseStatus = signupResponseEvidence.status;
      signupDiagnostic.rawText = signupResponseEvidence.rawText;
      signupDiagnostic.parsedBody = signupResponseEvidence.parsedBody;
      signupDiagnostic.parseError = signupResponseEvidence.parseError;
      signupDiagnostic.responseReadError = signupResponseEvidence.responseReadError;
      signupDiagnostic.safeHeaders = {
        contentType: signupResponseEvidence.contentType, cfRay: signupResponseEvidence.cfRay,
      };
      signupDiagnostic.responseReceived = true;
      signupDiagnostic.httpStatus = signupResponseStatus;
    }
    await persistArtifact();
  } catch (error) {
    if (signupClickCount !== 1) throw error;
    signupClickError ||= sanitizeError(error);
    signupDiagnostic.clickError = signupClickError;
    signupResponseEvidence ||= await signupResponsePromise;
    if (signupResponseEvidence.responseError) {
      signupDiagnostic.responseError = signupResponseEvidence.responseError;
    } else {
      signupResponseStatus = signupResponseEvidence.status;
      signupDiagnostic.rawText = signupResponseEvidence.rawText;
      signupDiagnostic.parsedBody = signupResponseEvidence.parsedBody;
      signupDiagnostic.parseError = signupResponseEvidence.parseError;
      signupDiagnostic.responseReadError = signupResponseEvidence.responseReadError;
      signupDiagnostic.safeHeaders = {
        contentType: signupResponseEvidence.contentType, cfRay: signupResponseEvidence.cfRay,
      };
      signupDiagnostic.responseReceived = true;
      signupDiagnostic.httpStatus = signupResponseStatus;
    }
    await persistArtifact();
  } finally {
    page.off("request", countSignupRequest);
  }
  // Never retry an uncertain signup; every attempted click is followed by one reconciliation pass.
  await beforeOperation("signup-post-submit-dashboard-reconciliation");
  const dashboardReached = signupClickCount === 1 ? await page.waitForFunction(() =>
    location.pathname === "/app" || location.pathname === "/app/",
  { timeout: 45000 }).then(() => true).catch(() => false) : false;
  const productRowsRead = await attemptDiagnosticRead(() => d1(productDb,
    `SELECT id,email,legacy_password_hash FROM users WHERE lower(email)=lower(?)`, [disposableEmail]));
  const runtimeRowsRead = await attemptDiagnosticRead(() => d1(runtimeDb,
    `SELECT id,email FROM users WHERE lower(email)=lower(?)`, [disposableEmail]));
  const authCookies = await attemptDiagnosticRead(() => page.cookies(product));
  const cookie = authCookies.value ? cookieHeader(authCookies.value) : "";
  const signupMeRead = await attemptDiagnosticRead(() => apiRead(`${product}/api/auth/me`, cookie));
  const runtimeCheckRead = await attemptDiagnosticRead(() => runtimeCheck(cookie));
  const productRows = productRowsRead.value || [];
  const runtimeRows = runtimeRowsRead.value || [];
  const newIdentity = { product: productRows, runtime: runtimeRows };
  const newCounts = {
    product: {
      count: productRowsRead.error ? -1 : productRows.length,
      legacyHashNull: !productRowsRead.error && productRows.every(row => row.legacy_password_hash == null),
    },
    runtime: { count: runtimeRowsRead.error ? -1 : runtimeRows.length },
  };
  const signupMe = signupMeRead.value || { status: null, body: null, parseError: null, responseReadError: null };
  const runtimeAfterSignup = runtimeCheckRead.value
    || { status: null, authenticated: false, authenticatedValue: null, userId: null };
  const productLocalSessionRead = productRows[0]?.id == null ? { value: null, error: null }
    : await attemptDiagnosticRead(() => productLocalSessionCount(productDb, productRows[0].id));
  const productLocalSessions = productLocalSessionRead.value ?? -1;
  const reconciliationErrors = {
    productD1: productRowsRead.error,
    runtimeD1: runtimeRowsRead.error,
    browserCookies: authCookies.error,
    productMe: signupMeRead.error,
    runtimeCheck: runtimeCheckRead.error,
    productLocalSessionCount: productLocalSessionRead.error,
  };
  const reconciliationSucceeded = Object.values(reconciliationErrors).every(error => error === null);
  signupDiagnostic.countsAfter = newCounts;
  signupDiagnostic.clickError = signupClickError;
  signupDiagnostic.responseError = signupResponseEvidence?.responseError || null;
  signupDiagnostic.reconciliationErrors = reconciliationErrors;
  await persistArtifact();
  await beforeOperation("signup-identity-and-authority-evaluation");
  const signupEvaluation = evaluateSignupAcceptance({
    clickCount: signupClickCount, requestCount: signupRequestCount,
    responseStatus: signupResponseStatus, dashboardReached,
    responseBodyReadable: signupResponseEvidence?.responseBodyReadable,
    reconciliationSucceeded,
    productCount: newCounts.product.count, runtimeCount: newCounts.runtime.count,
    legacyHashNull: newCounts.product.legacyHashNull,
    productStatus: signupMe.status,
    productD1Id: newIdentity.product[0]?.id, runtimeD1Id: newIdentity.runtime[0]?.id,
    productMeId: signupMe.body?.id,
    runtimeAuthenticated: runtimeAfterSignup.authenticated, runtimeCheckId: runtimeAfterSignup.userId,
    productLocalSessionCount: productLocalSessions,
  });
  const signupSuccess = signupEvaluation.passed;
  check("one-public-ui-signup-and-identity-authority", {
    status: signupResponseStatus,
    uiClickCount: signupClickCount,
    registrationPostCount: signupRequestCount,
    dashboardReached,
    productCount: newCounts.product.count,
    runtimeCount: newCounts.runtime.count,
    identityMappingMatches: String(newIdentity.product[0]?.id) === String(newIdentity.runtime[0]?.id),
    legacyHashNull: newCounts.product.legacyHashNull,
    productIdentityPresent: signupMe.status === 200 && !!signupMe.body?.id,
    runtimeAuthenticated: runtimeAfterSignup.authenticated,
    productLocalSessionCount: productLocalSessions,
    evaluation: signupEvaluation,
  }, signupSuccess);
  signupDiagnostic.countsAfter = newCounts;
  signupDiagnostic.runtimeIdentityPresent = runtimeAfterSignup.authenticated;
  signupDiagnostic.productIdentityPresent = signupMe.status === 200 && !!signupMe.body?.id;
  signupDiagnostic.evaluation = signupEvaluation;
  recordCaseResult(signupDiagnostic, {
    classification: signupSuccess ? "PASS" : "FAIL",
    status: signupSuccess ? "PASS" : "FAIL",
    httpStatus: signupResponseStatus,
    error: signupSuccess ? null : {
      name: signupEvaluation.errorName,
      message: signupEvaluation.errorMessage,
    },
  });
  await persistArtifact();
  requireCondition(signupSuccess, "Public signup failed its identity/authentication acceptance checks");

  await transition("new-user-dashboard", "authenticated-dashboard");
  browserNetworkAudit.currentPhase = "new-user-dashboard";
  const newDashboard = await apiRead(`${product}/api/projects`, cookieHeader(await page.cookies(product)));
  requireCondition(newDashboard.status === 200 && Array.isArray(newDashboard.body),
    "New user's authenticated dashboard did not load");
  check("new-user-dashboard-loads", { status: newDashboard.status, projectCount: newDashboard.body.length }, true);

  await transition("new-user-duplicate-rejection", "duplicate-new-user-cases");
  for (const [label, email] of [
    ["duplicate-new-account-exact", disposableEmail],
    ["duplicate-new-account-case-variant", disposableEmail.toUpperCase()],
  ]) {
    await submitBounded(page, label, {
      name: disposableName, email, password: ephemeralPassword,
    }, 1);
  }
  const afterDuplicateNew = await countEvidence(disposableEmail);
  check("new-account-duplicate-counts", afterDuplicateNew, countIsOne(afterDuplicateNew));
  requireCondition(!failed, "New-account duplicate registration check failed");

  await transition("new-user-auth-authority", "runtime-session-authority");
  const authorityDiagnostic = beginDiagnosticCase("new-user-auth-authority", ++caseSequence, {
    fetchStarted: false, responseReceived: false,
  });
  await persistArtifact();
  const newSessionToken = accessCookie(await page.cookies(product));
  requireCondition(newSessionToken, "New user runtime credential unavailable");
  const newSession = await sessionEvidence(runtimeDb, newIdentity.runtime[0].id, newSessionToken);
  const newLocalSessionCount = await productLocalSessionCount(productDb, newIdentity.product[0].id);
  const finalNewCounts = await countEvidence(disposableEmail);
  const authorityEvaluation = evaluateSignupAcceptance({
    clickCount: signupClickCount, requestCount: signupRequestCount,
    responseStatus: signupResponseStatus, dashboardReached,
    productCount: finalNewCounts.product.count, runtimeCount: finalNewCounts.runtime.count,
    legacyHashNull: finalNewCounts.product.legacyHashNull,
    productStatus: signupMe.status,
    productD1Id: newIdentity.product[0]?.id, runtimeD1Id: newIdentity.runtime[0]?.id,
    productMeId: signupMe.body?.id,
    runtimeAuthenticated: runtimeAfterSignup.authenticated, runtimeCheckId: runtimeAfterSignup.userId,
    productLocalSessionCount: newLocalSessionCount,
    sessionEvidenceAvailable: true,
    runtimeSessionExists: newSession.exists,
    runtimeSessionOwnerMatches: newSession.ownerMatches,
    runtimeSessionActive: newSession.revoked === false,
  });
  check("new-user-runtime-session-authority", {
    productCount: finalNewCounts.product.count,
    runtimeCount: finalNewCounts.runtime.count,
    legacyHashNull: finalNewCounts.product.legacyHashNull,
    runtimeSessionExists: newSession.exists,
    runtimeSessionOwnerMatches: newSession.ownerMatches,
    runtimeSessionActive: newSession.revoked === false,
    productLocalSessionCount: newLocalSessionCount,
  }, authorityEvaluation.passed);
  authorityDiagnostic.evidence = {
    counts: finalNewCounts, sessionExists: newSession.exists,
    sessionOwnerMatches: newSession.ownerMatches, productLocalSessionCount: newLocalSessionCount,
    evaluation: authorityEvaluation,
  };
  recordCaseResult(authorityDiagnostic, {
    classification: authorityEvaluation.passed ? "PASS" : "FAIL",
    status: authorityEvaluation.passed ? "PASS" : "FAIL",
    httpStatus: signupResponseStatus,
    error: authorityEvaluation.passed ? null : {
      name: authorityEvaluation.errorName, message: authorityEvaluation.errorMessage,
    },
  });
  await persistArtifact();
  requireCondition(authorityEvaluation.passed, authorityEvaluation.errorMessage || "New user authority precondition failed");

  await transition("new-user-logout-revocation", "logout-and-revocation");
  await assertLogoutFlow({
    label: "new-user",
    page,
    email: disposableEmail,
    password: ephemeralPassword,
    identity: newIdentity,
  });

  await transition("existing-user-logout-regression-precondition", "existing-user-session-and-project-counts");
  const existingProjectsRows = await d1(productDb,
    `SELECT id FROM projects WHERE user_id=? ORDER BY id`, [existingBefore.product[0].id]);
  const existingProjects = existingProjectsRows.map(project => Number(project.id));
  requireCondition(existingProjects.length > 0, "Existing acceptance user has no project ownership evidence");
  await beforeOperation("existing-user-browser-new-page");
  const existingPage = await browser.newPage();
  await afterOperation("existing-user-browser-new-page", { created: true });
  await attachBrowserNetworkAudit(existingPage);
  existingPage.setDefaultTimeout(30000);
  browserNetworkAudit.currentPhase = "existing-user";
  await assertLogoutFlow({
    label: "existing-user",
    page: existingPage,
    email: existingEmail,
    password: process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD,
    identity: existingBefore,
    projectsBefore: existingProjects.map(id => ({ id })),
  });
  check("existing-user-project-ownership-regression", {
    projectCount: existingProjects.length,
    ownershipStableAfterLogoutAndLogin: true,
  }, true);
  const networkEvidence = browserNetworkAudit.evidence();
  check("browser-cdp-forbidden-customer-dependencies", networkEvidence,
    networkEvidence.forbiddenHostnameCount === 0);
  networkAuditChecked = true;
  requireCondition(!failed, "Acceptance checks failed; credential handoff withheld");
  await transition("credential-handoff", "credential-handoff-file-write");
  await writeFile(handoffPath, `${JSON.stringify({
    email: disposableEmail,
    password: ephemeralPassword,
  })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  check("credential-handoff", { written: true, permissions: "0600" }, true);
} catch (error) {
  failed = true;
  report.error = safeError(error);
  const current = report.diagnostics?.at(-1);
  if (current?.status === "RUNNING") {
    failDiagnosticCase(current, error);
    current.phase ||= step;
    current.substep ||= substep;
  }
  const runningOperation = [...(report.operations || [])].reverse()
    .find(item => item.status === "STARTED");
  if (runningOperation) {
    runningOperation.status = "FAIL";
    runningOperation.completedAt = new Date().toISOString();
    runningOperation.error = sanitizeError(error);
  }
  markRemainingNotRun(caseSequence);
  await persistArtifact().catch(writeError => {
    report.error.artifactCheckpointError = sanitizeError(writeError);
  });
} finally {
  if (browser) {
    try {
      await beforeOperation("browser-cleanup-close");
      await browser.close();
      await afterOperation("browser-cleanup-close", { closed: true });
    } catch (error) {
      failed = true;
      report.cleanupError = sanitizeError(error);
    }
  }
  if (!networkAuditChecked) {
    const networkEvidence = browserNetworkAudit.evidence();
    check("browser-cdp-forbidden-customer-dependencies", networkEvidence,
      networkEvidence.forbiddenHostnameCount === 0);
    networkAuditChecked = true;
  }
  report.completedAt = new Date().toISOString();
  report.status = failed ? "FAIL" : "PASS";
  try {
    await writeAtomicArtifact(artifact, report);
    console.log(JSON.stringify({ artifact: path.relative(root, artifact), status: report.status }));
  } catch (error) {
    console.error(JSON.stringify({ status: "FAIL", artifactWritten: false, reason: "artifact_write_failed" }));
    report.artifactWriteError = sanitizeError(error);
    failed = true;
  }
  if (failed) process.exitCode = 1;
}
}