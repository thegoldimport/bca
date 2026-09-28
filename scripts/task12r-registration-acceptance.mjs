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

async function publicAuthIdentity(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    const body = await response.json().catch(() => null);
    return { present: !!body?.id };
  });
}

async function directRegisterAttempt(kind, origin, csrfToken, cookie, email, password) {
  const response = await fetch(`${product}/api/auth/register`, {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body: JSON.stringify({ name: disposableName, email, password }),
    redirect: "manual",
  });
  check(kind, { status: response.status }, response.status === 403);
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
  page.setDefaultTimeout(30000);
  await page.goto(`${product}/app/signup`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="button-submit"]')?.textContent?.includes("Create Account"),
  { timeout: 20000 });

  const ephemeralPassword = `Qa9!${randomBytes(20).toString("hex")}`;
  const csrf = await getCsrfToken(page);
  requireCondition(csrf.status === 200 && csrf.token, "Public registration CSRF token unavailable");
  const csrfCookies = cookieHeader(await page.cookies(product));
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

  step = "origin-csrf-rejections";
  await directRegisterAttempt("invalid-origin", "https://not-buildcustom.example", csrf.token,
    csrfCookies, existingEmail, ephemeralPassword);
  await directRegisterAttempt("missing-csrf", product, null, csrfCookies, existingEmail, ephemeralPassword);
  await directRegisterAttempt("invalid-csrf", product, "invalid", csrfCookies, existingEmail, ephemeralPassword);
  const afterRejectedExisting = await countEvidence(existingEmail);
  const afterRejectedDisposable = await countEvidence(disposableEmail);
  check("rejected-registration-identities-unchanged", {
    existingBefore: beforeExisting, existingAfter: afterRejectedExisting,
    disposableBefore: beforeDisposable, disposableAfter: afterRejectedDisposable,
  }, countIsOne(afterRejectedExisting) && countIsZero(afterRejectedDisposable));
  requireCondition(!failed, "At least one bounded registration validation check failed");

  step = "single-public-ui-signup";
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
  existingPage.setDefaultTimeout(30000);
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
} catch (error) {
  failed = true;
  report.error = safeError(error);
} finally {
  if (browser) await browser.close().catch(() => undefined);
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