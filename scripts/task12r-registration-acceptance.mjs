#!/usr/bin/env node

// Local-only bounded public signup and auth acceptance. Never run from production.
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const puppeteer = createRequire(path.join(root, "lab/bc-vibesdk-lab-20260925/package.json"))("puppeteer");
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
let networkAuditChecked = false;

function check(name, evidence, passed) {
  report.checks[name] = { at: new Date().toISOString(), status: passed ? "PASS" : "FAIL", evidence };
  if (!passed) failed = true;
  console.log(JSON.stringify({ name, status: report.checks[name].status, evidence }));
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function safeError(error) {
  return { step, reason: error?.name || "acceptance_failure" };
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
  const client = await page.target().createCDPSession();
  await client.send("Network.enable");
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
  const response = await fetch(`${account}/d1/database/${database}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const body = await response.json().catch(() => null);
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
  const response = await fetch(url, {
    headers: cookie ? { Cookie: cookie } : {},
    cache: "no-store",
    redirect: "manual",
  });
  return { status: response.status, body: await response.json().catch(() => null) };
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
  const response = await fetch(`${runtime}/api/auth/check`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, authenticated: body?.data?.authenticated === true,
    userId: body?.data?.user?.id ?? null };
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
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/csrf-token", { credentials: "same-origin", cache: "no-store" });
    const body = await response.json().catch(() => null);
    return { status: response.status, token: body?.token ?? body?.data?.token ?? null };
  });
}

async function submitBounded(page, kind, body, expectedIdentityCount = 0, requireNoLogin = false) {
  const csrf = await getCsrfToken(page);
  requireCondition(csrf.status === 200 && typeof csrf.token === "string" && csrf.token.length > 0,
    `CSRF token unavailable for ${kind}`);
  const result = await page.evaluate(async ({ body, token }) => {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    const message = payload?.message ?? payload?.error;
    const serialized = payload === null ? "" : JSON.stringify(payload);
    return {
      status: response.status,
      json: payload !== null && typeof payload === "object",
      safeMessage: typeof message === "string" && message.length > 0 && message.length <= 200
        && serialized.length <= 2048
        && !/stack|exception|token|secret|authorization|cookie/i.test(serialized),
    };
  }, { body, token: csrf.token });
  const identityAfter = requireNoLogin
    ? await publicAuthIdentity(page)
    : null;
  const targetEmail = typeof body.email === "string" ? body.email : null;
  const counts = targetEmail ? await countEvidence(targetEmail) : null;
  const identityUnchanged = expectedIdentityCount === 0
    ? !!counts && countIsZero(counts)
    : !!counts && counts.product.count === expectedIdentityCount
      && counts.runtime.count === expectedIdentityCount && counts.product.legacyHashNull;
  const passed = result.status >= 400 && result.status < 500 && result.status !== 500
    && result.status !== 502 && result.json && result.safeMessage && identityUnchanged
    && (!requireNoLogin || !identityAfter.present);
  check(kind, { status: result.status, safeJsonValidation: result.json && result.safeMessage,
    identity: counts, expectedIdentityCount, noAutomaticLogin: requireNoLogin ? !identityAfter.present : null }, passed);
}

function safeResponseBody(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { classification: "UNKNOWN", exactBody: null, message: null };
  }
  const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : [];
  const message = keys.length === 1 && keys[0] === "message" ? parsed.message : null;
  const allowedMessages = new Set([
    "ORIGIN_REJECTED",
    "Could not create your account. Check your details.",
  ]);
  if (typeof message !== "string" || !allowedMessages.has(message)
    || /stack|exception|token|secret|authorization|cookie/i.test(raw)
    || raw.length > 2048) {
    return { classification: "UNKNOWN", exactBody: null, message: null };
  }
  return { classification: "SAFE_JSON", exactBody: raw, message };
}

function classifyRegistrationMatrix(originState, csrfState, status, body) {
  if (status === null || body.classification !== "SAFE_JSON") return "UNKNOWN";
  const expected = originState !== "valid"
    ? { status: 400, message: "ORIGIN_REJECTED" }
    : csrfState === "valid"
      ? { status: 400, message: "Could not create your account. Check your details." }
      : { status: 403, message: "Could not create your account. Check your details." };
  return status === expected.status && body.message === expected.message ? "PASS" : "FAIL";
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
  try {
    const response = await fetch(`${product}/api/auth/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: disposableName, email, password }),
      redirect: "manual",
    });
    status = response.status;
    body = safeResponseBody(await response.text());
  } catch {
    // Keep request failures as UNKNOWN without leaking request or credential data.
  }
  return { status, body };
}

async function publicAuthIdentity(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    const body = await response.json().catch(() => null);
    return { present: !!body?.id };
  });
}

async function login(page, email, password, expectedId) {
  await page.goto(`${product}/app/login`, { waitUntil: "domcontentloaded" });
  requireCondition(new URL(page.url()).origin === product, "Login navigation left the public product origin");
  await page.locator('[data-testid="input-email"]').fill(email);
  await page.locator('[data-testid="input-password"]').fill(password);
  const responsePromise = page.waitForResponse(response =>
    response.url().includes("/api/auth/login") && response.request().method() === "POST", { timeout: 30000 });
  await page.locator('[data-testid="button-submit"]').click();
  const response = await responsePromise;
  requireCondition(response.status() === 200, "Public login did not succeed");
  await page.waitForFunction(() => location.pathname === "/app" || location.pathname === "/app/", { timeout: 45000 });
  const me = await apiRead(`${product}/api/auth/me`, cookieHeader(await page.cookies(product)));
  requireCondition(me.status === 200 && me.body?.id && String(me.body.id) === String(expectedId),
    "Product identity did not match expected user after login");
  const projects = await apiRead(`${product}/api/projects`, cookieHeader(await page.cookies(product)));
  requireCondition(projects.status === 200 && Array.isArray(projects.body), "Authenticated dashboard failed");
  return { me: me.body, projects: projects.body };
}

async function logout(page) {
  await page.goto(`${product}/app`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="button-logout"]', { timeout: 30000 });
  const responsePromise = page.waitForResponse(response =>
    response.url().includes("/api/auth/logout") && response.request().method() === "POST", { timeout: 30000 });
  await page.locator('[data-testid="button-logout"]').click();
  const response = await responsePromise;
  await page.waitForFunction(() => location.pathname === "/app/login" || location.pathname === "/app/login/", {
    timeout: 45000,
  }).catch(() => undefined);
  return { status: response.status(), cookies: await page.cookies(product) };
}

async function assertLogoutFlow({ label, page, email, password, identity, projectsBefore }) {
  browserNetworkAudit.currentPhase = `${label}-logout-and-old-session-replay`;
  step = `${label}-login-before-logout`;
  await login(page, email, password, identity.product[0].id);
  const beforeCookies = await page.cookies(product);
  const oldAccessToken = accessCookie(beforeCookies);
  requireCondition(oldAccessToken, `${label}: runtime credential absent`);
  const oldCookie = cookieHeader(beforeCookies);
  const productBefore = await apiRead(`${product}/api/auth/me`, oldCookie);
  const runtimeBefore = await runtimeCheck(oldCookie);
  const sessionBefore = await sessionEvidence(runtimeDb, identity.runtime[0].id, oldAccessToken);
  const localSessions = await productLocalSessionCount(productDb, identity.product[0].id);
  requireCondition(!!productBefore.body?.id && String(productBefore.body.id) === String(identity.product[0].id),
    `${label}: product identity missing before logout`);
  requireCondition(runtimeBefore.authenticated && String(runtimeBefore.userId) === String(identity.runtime[0].id),
    `${label}: runtime authentication missing before logout`);
  requireCondition(sessionBefore.exists && sessionBefore.ownerMatches && sessionBefore.revoked === false,
    `${label}: runtime D1 session precondition failed`);
  requireCondition(localSessions === 0, `${label}: product D1 has local session authority`);

  step = `${label}-logout`;
  const logoutResult = await logout(page);
  const browserCredentialCleared = !logoutResult.cookies.some(cookie =>
    cookie.name === "accessToken" && cookie.value === oldAccessToken);
  const sessionAfter = await sessionEvidence(runtimeDb, identity.runtime[0].id, oldAccessToken);
  const oldProduct = await apiRead(`${product}/api/auth/me`, oldCookie);
  const oldRuntime = await runtimeCheck(oldCookie);
  requireCondition(logoutResult.status === 204 && browserCredentialCleared,
    `${label}: public logout response or cookie clearing failed`);
  requireCondition(sessionAfter.exists && sessionAfter.ownerMatches && sessionAfter.revoked === true,
    `${label}: runtime session was not revoked`);
  requireCondition(oldProduct.body === null, `${label}: old product credential replay did not return null`);
  requireCondition(!oldRuntime.authenticated, `${label}: old runtime credential replay remained authenticated`);

  browserNetworkAudit.currentPhase = `${label}-fresh-login`;
  step = `${label}-fresh-login`;
  const fresh = await login(page, email, password, identity.product[0].id);
  const freshRuntime = await runtimeCheck(cookieHeader(await page.cookies(product)));
  const currentCounts = await countEvidence(email);
  let ownershipStable = true;
  if (projectsBefore) {
    ownershipStable = JSON.stringify(fresh.projects.map(project => Number(project.id)).sort())
      === JSON.stringify(projectsBefore.map(project => Number(project.id)).sort());
  }
  requireCondition(freshRuntime.authenticated
    && String(freshRuntime.userId) === String(identity.runtime[0].id),
  `${label}: fresh runtime login failed`);
  requireCondition(countIsOne(currentCounts), `${label}: identity counts changed after fresh login`);
  requireCondition(ownershipStable, `${label}: existing project ownership changed`);
  check(`${label}-logout-revocation-and-fresh-login`, {
    logoutStatus: logoutResult.status,
    browserCredentialCleared,
    runtimeSessionRevoked: sessionAfter.revoked,
    oldProductCredentialReturnsNull: oldProduct.body === null,
    oldRuntimeCredentialUnauthenticated: !oldRuntime.authenticated,
    freshLogin: true,
    dashboardLoaded: true,
    existingProjectOwnershipStable: ownershipStable,
    identityCounts: currentCounts,
  }, true);
  return fresh;
}

try {
  const handoffPath = process.env.TASK12T_CREDENTIAL_HANDOFF_PATH;
  requireCondition(typeof handoffPath === "string" && path.isAbsolute(handoffPath)
    && handoffPath === path.resolve(handoffPath) && path.dirname(handoffPath) === "/tmp",
  "TASK12T_CREDENTIAL_HANDOFF_PATH must name a fresh absolute file directly under /tmp");
  requireCondition(!!process.env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN is required for read-only D1 evidence");
  requireCondition(!!process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD,
    "BUILDCUSTOM_CUTOVER_TESTER_PASSWORD is required for existing-user logout regression");

  step = "existing-identity-precondition";
  const existingBefore = await identityRows(existingEmail);
  requireCondition(existingBefore.product.length === 1 && existingBefore.runtime.length === 1
    && existingBefore.product[0].legacy_password_hash == null,
  "Existing acceptance identity must exist once in both D1 databases with a null legacy password hash");
  requireCondition(String(existingBefore.product[0].id) === String(existingBefore.runtime[0].id),
    "Existing product/runtime identity mapping differs");

  step = "bounded-registration-validation";
  const beforeExisting = await countEvidence(existingEmail);
  const beforeDisposable = await countEvidence(disposableEmail);
  requireCondition(countIsZero(beforeDisposable), "Generated disposable email already exists; refusing signup");
  browser = await puppeteer.launch({
    executablePath: "/repl/tools/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await attachBrowserNetworkAudit(page);
  page.setDefaultTimeout(30000);
  browserNetworkAudit.currentPhase = "anonymous-signup";
  await page.goto(`${product}/app/signup`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="button-submit"]')?.textContent?.includes("Create Account"),
  { timeout: 20000 });
  const [productCapabilities, runtimeProviders] = await Promise.all([
    apiRead(`${product}/api/public/capabilities`),
    apiRead(`${runtime}/api/auth/providers`),
  ]);
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

  step = "origin-csrf-rejections";
  const matrixEmail = "not-an-email";
  const matrixCases = [];
  for (const originState of ["valid", "invalid", "missing"]) {
    for (const csrfState of ["valid", "missing", "invalid"]) {
      const before = {
        invalidEmail: await countEvidence(matrixEmail),
        existing: await countEvidence(existingEmail),
        disposable: await countEvidence(disposableEmail),
      };
      const result = await registrationMatrixAttempt({
        originState, csrfState, csrfToken: csrf.token, csrfCookie,
        email: matrixEmail, password: ephemeralPassword,
      });
      const after = {
        invalidEmail: await countEvidence(matrixEmail),
        existing: await countEvidence(existingEmail),
        disposable: await countEvidence(disposableEmail),
      };
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

  step = "single-public-ui-signup";
  browserNetworkAudit.currentPhase = "successful-single-signup";
  await page.goto(`${product}/app/signup`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="button-submit"]')?.textContent?.includes("Create Account"),
  { timeout: 20000 });
  requireCondition(new URL(page.url()).origin === product, "Signup navigation left the public product origin");
  await page.locator('[data-testid="input-name"]').fill(disposableName);
  await page.locator('[data-testid="input-email"]').fill(disposableEmail);
  await page.locator('[data-testid="input-password"]').fill(ephemeralPassword);
  const signupResponsePromise = page.waitForResponse(response =>
    new URL(response.url()).origin === product && new URL(response.url()).pathname === "/api/auth/register"
      && response.request().method() === "POST",
    { timeout: 30000 }).then(response => response.status()).catch(() => null);
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
  try {
    await page.locator('[data-testid="button-submit"]').click();
    signupClickCount += 1;
    signupResponseStatus = await signupResponsePromise;
  } finally {
    page.off("request", countSignupRequest);
  }
  // Never retry an uncertain signup: reconcile the single click against both D1s and auth state.
  const dashboardReached = await page.waitForFunction(() =>
    location.pathname === "/app" || location.pathname === "/app/",
  { timeout: 45000 }).then(() => true).catch(() => false);
  const newIdentity = await identityRows(disposableEmail);
  const signupMe = await apiRead(`${product}/api/auth/me`, cookieHeader(await page.cookies(product)));
  const newCounts = await countEvidence(disposableEmail);
  const runtimeAfterSignup = await runtimeCheck(cookieHeader(await page.cookies(product)));
  const productLocalSessions = newIdentity.product.length === 1
    ? await productLocalSessionCount(productDb, newIdentity.product[0].id) : -1;
  const signupSuccess = signupClickCount === 1 && signupRequestCount === 1
    && signupResponseStatus !== null && signupResponseStatus >= 200 && signupResponseStatus < 300
    && dashboardReached
    && countIsOne(newCounts)
    && String(newIdentity.product[0]?.id) === String(newIdentity.runtime[0]?.id)
    && signupMe.status === 200 && String(signupMe.body?.id) === String(newIdentity.product[0]?.id)
    && runtimeAfterSignup.authenticated
    && String(runtimeAfterSignup.userId) === String(newIdentity.runtime[0]?.id)
    && productLocalSessions === 0;
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
  }, signupSuccess);
  requireCondition(signupSuccess, "Public signup failed its identity/authentication acceptance checks");

  step = "new-user-dashboard";
  browserNetworkAudit.currentPhase = "new-user-dashboard";
  const newDashboard = await apiRead(`${product}/api/projects`, cookieHeader(await page.cookies(product)));
  requireCondition(newDashboard.status === 200 && Array.isArray(newDashboard.body),
    "New user's authenticated dashboard did not load");
  check("new-user-dashboard-loads", { status: newDashboard.status, projectCount: newDashboard.body.length }, true);

  step = "new-user-duplicate-rejection";
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

  step = "new-user-auth-authority";
  const newSessionToken = accessCookie(await page.cookies(product));
  requireCondition(newSessionToken, "New user runtime credential unavailable");
  const newSession = await sessionEvidence(runtimeDb, newIdentity.runtime[0].id, newSessionToken);
  const newLocalSessionCount = await productLocalSessionCount(productDb, newIdentity.product[0].id);
  const finalNewCounts = await countEvidence(disposableEmail);
  check("new-user-runtime-session-authority", {
    productCount: finalNewCounts.product.count,
    runtimeCount: finalNewCounts.runtime.count,
    legacyHashNull: finalNewCounts.product.legacyHashNull,
    runtimeSessionExists: newSession.exists,
    runtimeSessionOwnerMatches: newSession.ownerMatches,
    runtimeSessionActive: newSession.revoked === false,
    productLocalSessionCount: newLocalSessionCount,
  }, countIsOne(finalNewCounts) && newSession.exists && newSession.ownerMatches
    && newSession.revoked === false && newLocalSessionCount === 0);
  requireCondition(!failed, "New user authority precondition failed");

  step = "new-user-logout-revocation";
  await assertLogoutFlow({
    label: "new-user",
    page,
    email: disposableEmail,
    password: ephemeralPassword,
    identity: newIdentity,
  });

  step = "existing-user-logout-regression-precondition";
  const existingProjectsRows = await d1(productDb,
    `SELECT id FROM projects WHERE user_id=? ORDER BY id`, [existingBefore.product[0].id]);
  const existingProjects = existingProjectsRows.map(project => Number(project.id));
  requireCondition(existingProjects.length > 0, "Existing acceptance user has no project ownership evidence");
  const existingPage = await browser.newPage();
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
  step = "credential-handoff";
  await writeFile(handoffPath, `${JSON.stringify({
    email: disposableEmail,
    password: ephemeralPassword,
  })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  check("credential-handoff", { written: true, permissions: "0600" }, true);
} catch (error) {
  failed = true;
  report.error = safeError(error);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (!networkAuditChecked) {
    const networkEvidence = browserNetworkAudit.evidence();
    check("browser-cdp-forbidden-customer-dependencies", networkEvidence,
      networkEvidence.forbiddenHostnameCount === 0);
    networkAuditChecked = true;
  }
  report.completedAt = new Date().toISOString();
  report.status = failed ? "FAIL" : "PASS";
  try {
    await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ artifact: path.relative(root, artifact), status: report.status }));
  } catch {
    console.error(JSON.stringify({ status: "FAIL", artifactWritten: false, reason: "artifact_write_failed" }));
    failed = true;
  }
  if (failed) process.exitCode = 1;
}