#!/usr/bin/env node

// Bounded production acceptance while the development workflow is stopped.
// Requires an explicit --execute; never signs up, creates, edits, generates,
// or publishes. One existing-user logout is intentionally exercised.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open as openFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAB_PACKAGE = path.join(ROOT, "lab/bc-vibesdk-lab-20260925/package.json");
const PRODUCT = "https://app.buildcustom.ai";
const RUNTIME = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const PRODUCT_DATABASE = "ca820baf-6973-4318-ac52-529d56293bb6";
const RUNTIME_DATABASE = "716c6600-8c60-408a-9446-3779979d5316";
const HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const OWNERS = [
  {
    label: "project2",
    id: 2,
    other: 3,
    email: "cutover-test@buildcustom.ai",
    password: process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD,
    publicHost: "create-a-minimal-public-app-by-creating-public-index-html-and-p.apps.buildcustom.ai",
    marker: "BUILDCUSTOM_CUTOVER_TESTER_OK",
  },
  {
    label: "project3",
    id: 3,
    other: 2,
    email: null,
    password: process.env.BUILDCUSTOM_NEW_USER_ACCEPTANCE_PASSWORD,
    publicHost: "create-a-tiny-single-page-website-with-a-heading-that-says-buil.apps.buildcustom.ai",
    marker: "BUILDCUSTOM_NEW_USER_OK",
  },
];
const report = { startedAt: new Date().toISOString(), checks: {} };
let step = "preconditions";

function record(name, evidence, passed = true) {
  report.checks[name] = { status: passed ? "PASS" : "FAIL", evidence };
  assert(passed, `${name} failed.`);
}

function safeError(error) {
  // Intentionally omit error messages: request errors can contain secrets,
  // cookies, or credential-bearing URLs.
  return { step, reason: error?.name || "acceptance_failure" };
}

function cookieHeader(cookies) {
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

function accessCookie(cookies) {
  return cookies.find(cookie => cookie.name === "accessToken")?.value || null;
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("base64");
}

async function d1(database, sql, params = []) {
  const response = await fetch(`${CLOUDFLARE_API}/d1/database/${database}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  assert(response.ok && body?.success === true && Array.isArray(body.result?.[0]?.results),
    "Read-only D1 query failed.");
  return body.result[0].results;
}

async function apiRead(url, cookie) {
  const response = await fetch(url, {
    headers: cookie ? { Cookie: cookie } : {},
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function browserApi(page, pathname) {
  return page.evaluate(async url => {
    const response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    return { status: response.status, payload: await response.json().catch(() => null) };
  }, pathname);
}

function createNetworkAudit(page) {
  const audit = {
    blockedMutations: 0,
    forbiddenHosts: new Set(),
    websocketAttempts: 0,
    websocketHandshakes: 0,
    idleSuggestionFrames: 0,
  };
  const sockets = new Set();
  const acceptedSockets = new Set();
  const clientPromise = page.target().createCDPSession();
  const interceptionPromise = page.setRequestInterception(true);

  page.on("request", request => {
    const method = request.method().toUpperCase();
    let permitted = ["GET", "HEAD", "OPTIONS"].includes(method);
    let expectedTelemetry = false;
    if (method === "POST") {
      try {
        const url = new URL(request.url());
        permitted = url.origin === PRODUCT
          && ["/api/auth/login", "/api/auth/logout"].includes(url.pathname);
        expectedTelemetry = url.origin === PRODUCT && url.pathname === "/cdn-cgi/rum";
      } catch { permitted = false; }
    }
    if (permitted) void request.continue().catch(() => undefined);
    else {
      if (!expectedTelemetry) audit.blockedMutations += 1;
      void request.abort("blockedbyclient").catch(() => undefined);
    }
  });

  const ready = Promise.all([clientPromise, interceptionPromise]).then(async ([client]) => {
    await client.send("Network.enable");
    client.on("Network.webSocketCreated", ({ requestId, url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "wss:" && parsed.hostname === new URL(PRODUCT).hostname
          && parsed.pathname.endsWith("/runtime/ws")) {
          audit.websocketAttempts += 1;
          sockets.add(requestId);
        }
        if (parsed.hostname.endsWith(".workers.dev") || parsed.hostname.endsWith(".replit.dev")
          || parsed.hostname.endsWith(".replit.app")) {
          audit.forbiddenHosts.add(parsed.hostname.toLowerCase());
        }
      } catch { /* Do not retain opaque socket URLs. */ }
    });
    client.on("Network.webSocketHandshakeResponseReceived", ({ requestId, response }) => {
      if (sockets.has(requestId) && response?.status === 101) {
        audit.websocketHandshakes += 1;
        acceptedSockets.add(requestId);
      }
    });
    client.on("Network.webSocketFrameSent", ({ requestId, response }) => {
      if (!acceptedSockets.has(requestId)) return;
      try {
        const frame = JSON.parse(response?.payloadData || "null");
        if (frame?.type === "user_suggestion") audit.idleSuggestionFrames += 1;
      } catch { /* Do not retain WebSocket payloads. */ }
    });
    client.on("Network.requestWillBeSent", ({ request }) => {
      try {
        const host = new URL(request.url).hostname.toLowerCase();
        if (host.endsWith(".workers.dev") || host.endsWith(".replit.dev")
          || host.endsWith(".replit.app")) audit.forbiddenHosts.add(host);
      } catch { /* Ignore malformed/opaque URLs. */ }
    });
  });
  return { audit, ready };
}

async function identityFor(email) {
  const [productRows, runtimeRows] = await Promise.all([
    d1(PRODUCT_DATABASE,
      "SELECT id,email,legacy_password_hash FROM users WHERE lower(email)=lower(?)", [email]),
    d1(RUNTIME_DATABASE, "SELECT id,email FROM users WHERE lower(email)=lower(?)", [email]),
  ]);
  assert.equal(productRows.length, 1, "Existing product identity was not unique.");
  assert.equal(runtimeRows.length, 1, "Existing runtime identity was not unique.");
  assert.equal(String(productRows[0].id), String(runtimeRows[0].id),
    "Product/runtime identity mapping differed.");
  assert.equal(productRows[0].legacy_password_hash, null,
    "Existing product identity had a legacy password hash.");
  return { product: productRows[0], runtime: runtimeRows[0] };
}

async function readCredentialHandoff() {
  const handoffPath = process.env.TASK12T_CREDENTIAL_HANDOFF_PATH;
  assert(typeof handoffPath === "string" && path.isAbsolute(handoffPath),
    "TASK12T_CREDENTIAL_HANDOFF_PATH must name an absolute /tmp file.");
  const resolvedPath = await realpath(handoffPath);
  assert(resolvedPath.startsWith("/tmp/"),
    "Credential handoff must resolve to a file under /tmp.");
  const handle = await openFile(resolvedPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    assert(metadata.isFile(), "Credential handoff must be a regular file.");
    assert.equal(metadata.mode & 0o777, 0o600,
      "Credential handoff file permissions must be exactly 0600.");
    const age = Date.now() - metadata.mtimeMs;
    assert(age >= 0 && age <= HANDOFF_MAX_AGE_MS,
      "Credential handoff file is stale or has an invalid timestamp.");
    assert(metadata.size > 0 && metadata.size <= 16_384,
      "Credential handoff file size was invalid.");
    const handoff = JSON.parse(await handle.readFile({ encoding: "utf8" }));
    assert(handoff && typeof handoff === "object" && !Array.isArray(handoff),
      "Credential handoff JSON must be an object.");
    assert(typeof handoff.email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(handoff.email),
      "Credential handoff email was invalid.");
    assert(typeof handoff.password === "string" && handoff.password.length > 0,
      "Credential handoff password was missing.");
    return { email: handoff.email, password: handoff.password };
  } finally {
    await handle.close();
  }
}

async function runtimeCheck(cookie) {
  const response = await fetch(`${RUNTIME}/api/auth/check`, {
    headers: { Cookie: cookie },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  return {
    status: response.status,
    authenticated: body?.data?.authenticated === true,
    userId: body?.data?.user?.id ?? null,
  };
}

async function sessionEvidence(userId, token) {
  const rows = await d1(RUNTIME_DATABASE,
    "SELECT user_id,is_revoked FROM sessions WHERE access_token_hash=? ORDER BY created_at DESC LIMIT 1",
    [tokenHash(token)]);
  const session = rows[0] || null;
  return {
    exists: !!session,
    ownerMatches: !!session && String(session.user_id) === String(userId),
    revoked: session?.is_revoked == null ? null : Number(session.is_revoked) === 1,
  };
}

async function login(page, owner) {
  assert(typeof owner.email === "string" && owner.email.length > 0,
    `${owner.label} existing owner email was unavailable.`);
  assert(typeof owner.password === "string" && owner.password.length > 0,
    `${owner.label} existing-user password environment variable is required.`);
  await page.goto(`${PRODUCT}/app/login`, { waitUntil: "domcontentloaded" });
  assert.equal(new URL(page.url()).origin, PRODUCT, "Login navigation left the product origin.");
  await page.locator('[data-testid="input-email"]').fill(owner.email);
  await page.locator('[data-testid="input-password"]').fill(owner.password);
  const responsePromise = page.waitForResponse(response =>
    response.url().includes("/api/auth/login") && response.request().method() === "POST",
  { timeout: 30_000 });
  await page.locator('[data-testid="button-submit"]').click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, `${owner.label} public login failed.`);
  await page.waitForFunction(() => location.pathname === "/app" || location.pathname === "/app/",
    { timeout: 45_000 });
  const me = await browserApi(page, "/api/auth/me");
  assert.equal(me.status, 200, `${owner.label} authenticated identity read failed.`);
  assert(me.payload?.id, `${owner.label} authenticated identity was absent.`);
  return me.payload;
}

async function readRuntime(page, project, operation) {
  const response = await browserApi(page, `/api/projects/${project.id}/runtime/${operation}`);
  assert.equal(response.status, 200, `${project.label} runtime ${operation} read failed.`);
  return response.payload;
}

async function snapshot(page, project) {
  const [projectResponse, status, revision, files, turns, releases] = await Promise.all([
    browserApi(page, `/api/projects/${project.id}`),
    readRuntime(page, project, "status"),
    readRuntime(page, project, "revision"),
    readRuntime(page, project, "files"),
    readRuntime(page, project, "turns"),
    readRuntime(page, project, "releases"),
  ]);
  assert.equal(projectResponse.status, 200, `${project.label} owner project reopen failed.`);
  const fileList = Array.isArray(files) ? files : files?.files;
  assert(Array.isArray(fileList) && fileList.length > 0, `${project.label} Files list was empty.`);
  assert(fileList.some(file => file.path === "public/index.html"),
    `${project.label} project index file was absent.`);
  const serializedTurns = JSON.stringify(turns);
  const turnList = Array.isArray(turns) ? turns
    : Array.isArray(turns?.turns) ? turns.turns
      : Array.isArray(turns?.data) ? turns.data : null;
  assert(turns != null && serializedTurns !== "[]" && serializedTurns !== "{}",
    `${project.label} conversation did not load.`);
  const releaseList = Array.isArray(releases) ? releases : releases?.releases;
  assert(Array.isArray(releaseList), `${project.label} release list was unavailable.`);
  const commitHash = revision?.commitHash || revision?.revision?.commitHash || null;
  assert(commitHash, `${project.label} committed revision was unavailable.`);
  return { status, revision: commitHash, files: fileList, turns: turnList, rawTurns: turns, releases: releaseList };
}

async function inspectProject(page, owner, baseline, network) {
  const expectedPreview = baseline.status?.previewUrl || baseline.status?.previewURL
    || baseline.status?.state?.previewUrl || baseline.status?.state?.previewURL;
  assert(expectedPreview, `${owner.label} status did not expose a preview URL.`);
  const previewTarget = new URL(expectedPreview, PRODUCT);
  assert.equal(previewTarget.protocol, "https:", `${owner.label} preview was not HTTPS.`);

  await page.goto(`${PRODUCT}/app/project/${owner.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="button-header-open-builder"]', { visible: true });
  await page.locator('[data-testid="button-header-open-builder"]').click();
  await page.waitForFunction(id => location.pathname === `/app/editor/${id}`, { timeout: 60_000 }, owner.id);
  await page.waitForSelector('[data-testid="button-open-native-publish"]', { visible: true });

  await page.goto(`${PRODUCT}/app/project/${owner.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="tab-files"]', { visible: true });
  await page.locator('[data-testid="tab-files"]').click();
  await page.waitForSelector('[data-testid="file-row-index.html"]', { visible: true });
  await page.locator('[data-testid="file-row-index.html"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll("pre")]
    .some(element => element.textContent?.length));
  const authoritativeHtml = await browserApi(page,
    `/api/projects/${owner.id}/runtime/files/content?path=public%2Findex.html`);
  assert.equal(authoritativeHtml.status, 200, `${owner.label} saved index file read failed.`);
  const renderedHtml = await page.$eval("pre", element => element.textContent || "");
  assert.equal(renderedHtml.replace(/\r\n/g, "\n"),
    String(authoritativeHtml.payload?.content || "").replace(/\r\n/g, "\n"),
    `${owner.label} Files view did not match the saved file.`);

  const priorHandshakes = network.audit.websocketHandshakes;
  await page.goto(`${PRODUCT}/app/project/${owner.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="button-header-open-builder"]', { visible: true });
  await page.locator('[data-testid="button-header-open-builder"]').click();
  await page.waitForFunction(id => location.pathname === `/app/editor/${id}`, { timeout: 60_000 }, owner.id);
  await page.waitForSelector('[data-testid="button-open-native-publish"]', { visible: true });
  const frame = await (async () => {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const found = page.frames().find(candidate => {
        try {
          return candidate !== page.mainFrame()
            && new URL(candidate.url()).origin === previewTarget.origin
            && new URL(candidate.url()).pathname.startsWith(previewTarget.pathname);
        } catch { return false; }
      });
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return null;
  })();
  assert(frame, `${owner.label} preview did not load.`);
  await frame.waitForFunction(() => document.readyState === "interactive"
    || document.readyState === "complete", { timeout: 45_000 });
  const previewEvidence = await frame.evaluate(marker => ({
    markerVisible: (document.body?.innerText || "").includes(marker),
    stylesheetLoaded: [...document.querySelectorAll('link[rel="stylesheet"]')]
      .some(link => new URL(link.href).pathname.endsWith("/styles.css") && Boolean(link.sheet)),
  }), owner.marker);
  assert(previewEvidence.markerVisible, `${owner.label} preview content marker was absent.`);

  // Keep the editor idle to verify the runtime socket stays healthy without
  // causing an unsolicited suggestion or any project mutation.
  await new Promise(resolve => setTimeout(resolve, 15_000));
  assert(network.audit.websocketHandshakes > priorHandshakes,
    `${owner.label} idle runtime WebSocket did not complete a 101 handshake.`);
  assert.equal(network.audit.idleSuggestionFrames, 0,
    `${owner.label} sent a suggestion while idle.`);
  const after = await snapshot(page, owner);
  assert.equal(after.revision, baseline.revision, `${owner.label} revision changed during read-only inspection.`);
  assert.deepEqual(after.releases, baseline.releases, `${owner.label} releases changed.`);
  assert.deepEqual(after.rawTurns, baseline.rawTurns, `${owner.label} conversation changed.`);
  return {
    projectId: owner.id,
    fileCount: baseline.files.length,
    conversationTurns: baseline.turns?.length ?? null,
    releaseCount: baseline.releases.length,
    preview: previewEvidence,
    idleWebSocket: true,
    idleSuggestionFrames: 0,
    readOnlyStateUnchanged: true,
  };
}

async function inspectOwner(browser, owner, identity, logoutRegression = false) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(60_000);
  const network = createNetworkAudit(page);
  try {
    await network.ready;
    const authenticatedId = await login(page, owner);
    assert.equal(String(authenticatedId.id), String(identity.product.id),
      `${owner.label} login mapped to an unexpected identity.`);
    const dashboard = await browserApi(page, "/api/projects");
    assert.equal(dashboard.status, 200, `${owner.label} dashboard failed.`);
    assert(Array.isArray(dashboard.payload), `${owner.label} dashboard was not a project list.`);
    assert.deepEqual(dashboard.payload.map(item => Number(item.id)), [owner.id],
      `${owner.label} dashboard exposed unexpected projects.`);
    const crossOwner = await browserApi(page, `/api/projects/${owner.other}`);
    assert([403, 404].includes(crossOwner.status),
      `${owner.label} cross-owner project request was not denied.`);
    const crossOwnerFiles = await browserApi(page, `/api/projects/${owner.other}/runtime/files`);
    assert([403, 404].includes(crossOwnerFiles.status),
      `${owner.label} cross-owner Files request was not denied.`);
    const baseline = await snapshot(page, owner);
    const projectEvidence = await inspectProject(page, owner, baseline, network);
    assert.equal(network.audit.blockedMutations, 0,
      `${owner.label} attempted a blocked mutation during the read-only review.`);
    assert.equal(network.audit.forbiddenHosts.size, 0,
      `${owner.label} customer page contacted a forbidden runtime host.`);

    let logoutEvidence = null;
    if (logoutRegression) {
      step = "existing-user-logout-revocation";
      const cookiesBefore = await page.cookies(PRODUCT);
      const oldToken = accessCookie(cookiesBefore);
      assert(oldToken, "Existing user's runtime credential was absent.");
      const exactOldCookie = cookieHeader(cookiesBefore);
      const productBefore = await apiRead(`${PRODUCT}/api/auth/me`, exactOldCookie);
      const runtimeBefore = await runtimeCheck(exactOldCookie);
      const sessionBefore = await sessionEvidence(identity.runtime.id, oldToken);
      assert.equal(productBefore.status, 200, "Product cookie was not authenticated before logout.");
      assert.equal(String(productBefore.body?.id), String(identity.product.id),
        "Product cookie mapped to an unexpected user before logout.");
      assert(runtimeBefore.authenticated
        && String(runtimeBefore.userId) === String(identity.runtime.id),
      "Runtime cookie was not authenticated before logout.");
      assert(sessionBefore.exists && sessionBefore.ownerMatches && sessionBefore.revoked === false,
        "Runtime D1 active-session precondition failed.");

      await page.goto(`${PRODUCT}/app`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="button-logout"]', { timeout: 30_000 });
      const logoutResponsePromise = page.waitForResponse(response =>
        response.url().includes("/api/auth/logout") && response.request().method() === "POST",
      { timeout: 30_000 });
      await page.locator('[data-testid="button-logout"]').click();
      const logoutResponse = await logoutResponsePromise;
      await page.waitForFunction(() => location.pathname === "/app/login"
        || location.pathname === "/app/login/", { timeout: 45_000 }).catch(() => undefined);

      const cookiesAfter = await page.cookies(PRODUCT);
      const browserCredentialCleared = !cookiesAfter.some(cookie =>
        cookie.name === "accessToken" && cookie.value === oldToken);
      const sessionAfter = await sessionEvidence(identity.runtime.id, oldToken);
      // Replay the exact captured cookie string to both old public services.
      const productReplay = await apiRead(`${PRODUCT}/api/auth/me`, exactOldCookie);
      const runtimeReplay = await runtimeCheck(exactOldCookie);
      assert.equal(logoutResponse.status(), 204, "Public logout did not return 204.");
      assert(browserCredentialCleared, "Public logout did not clear the browser runtime credential.");
      assert(sessionAfter.exists && sessionAfter.ownerMatches && sessionAfter.revoked === true,
        "Runtime D1 session was not marked revoked after logout.");
      assert(productReplay.body === null, "Replayed product cookie remained authenticated.");
      assert(!runtimeReplay.authenticated, "Replayed runtime cookie remained authenticated.");

      step = "existing-user-fresh-login-after-logout";
      await login(page, owner);
      const freshDashboard = await browserApi(page, "/api/projects");
      const freshCookies = cookieHeader(await page.cookies(PRODUCT));
      const freshRuntime = await runtimeCheck(freshCookies);
      assert.equal(freshDashboard.status, 200, "Fresh login dashboard failed.");
      assert.deepEqual(freshDashboard.payload.map(item => Number(item.id)), [owner.id],
        "Fresh login changed existing project ownership.");
      assert(freshRuntime.authenticated
        && String(freshRuntime.userId) === String(identity.runtime.id),
      "Fresh login did not establish runtime authentication.");
      logoutEvidence = {
        logoutStatus: logoutResponse.status(),
        browserCredentialCleared,
        runtimeSessionRevoked: sessionAfter.revoked,
        oldProductCookieUnauthenticated: productReplay.body === null,
        oldRuntimeCookieUnauthenticated: !runtimeReplay.authenticated,
        freshLogin: true,
        dashboardProjectIds: [owner.id],
      };
    }
    return {
      login: true,
      dashboardProjectIds: [owner.id],
      crossOwnerStatuses: { project: crossOwner.status, files: crossOwnerFiles.status },
      project: projectEvidence,
      logout: logoutEvidence,
      network: {
        websocketAttempts: network.audit.websocketAttempts,
        websocketHandshakes: network.audit.websocketHandshakes,
        blockedMutations: network.audit.blockedMutations,
        forbiddenHostCount: network.audit.forbiddenHosts.size,
      },
    };
  } finally {
    await context.close();
  }
}

async function inspectFreshDisposableUser(browser, credentials, identity) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(60_000);
  const network = createNetworkAudit(page);
  const owner = { label: "fresh-disposable-user", email: credentials.email, password: credentials.password };
  try {
    await network.ready;
    const authenticatedId = await login(page, owner);
    assert.equal(String(authenticatedId.id), String(identity.product.id),
      "Fresh user product identity did not match its D1 mapping.");
    const dashboard = await browserApi(page, "/api/projects");
    assert.equal(dashboard.status, 200, "Fresh user dashboard read failed.");
    assert(Array.isArray(dashboard.payload) && dashboard.payload.length === 0,
      "Fresh user dashboard was not empty.");

    const freshCookie = cookieHeader(await page.cookies(PRODUCT));
    const runtime = await runtimeCheck(freshCookie);
    const token = accessCookie(await page.cookies(PRODUCT));
    assert(runtime.authenticated
      && String(runtime.userId) === String(identity.runtime.id),
    "Fresh user runtime identity did not match its D1 mapping.");
    assert(token, "Fresh user runtime credential was unavailable.");
    const session = await sessionEvidence(identity.runtime.id, token);
    assert(session.exists && session.ownerMatches && session.revoked === false,
      "Fresh user runtime session did not match the read-only D1 identity mapping.");
    assert.equal(network.audit.blockedMutations, 0,
      "Fresh user page attempted a blocked mutation.");
    assert.equal(network.audit.forbiddenHosts.size, 0,
      "Fresh user page contacted a forbidden runtime host.");
    return {
      publicLogin: true,
      productRuntimeD1MappingMatches: true,
      runtimeSessionOwnerMatches: true,
      emptyDashboard: true,
      blockedMutations: 0,
    };
  } finally {
    await context.close();
  }
}

async function checkPublicAppsAndMarketing() {
  const apps = {};
  for (const owner of OWNERS) {
    const response = await fetch(`https://${owner.publicHost}/`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const html = await response.text();
    assert.equal(response.status, 200, `${owner.label} public app was unavailable.`);
    assert(html.includes(owner.marker), `${owner.label} public app marker was absent.`);
    apps[owner.label] = { status: response.status, markerPresent: true };
  }
  const marketing = await fetch("https://buildcustom.ai/", {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(marketing.status, 200, "Marketing site was unavailable.");
  return { generatedApps: apps, marketingStatus: marketing.status };
}

async function main() {
  assert.equal(process.argv.length, 3,
    "Run only with: node scripts/task12t-development-off.mjs --execute");
  assert.equal(process.argv[2], "--execute",
    "Explicit --execute is required; no production checks were started.");
  assert.equal(process.env.TASK12T_DEVELOPMENT_WORKFLOW_STOPPED, "1",
    "Confirm the development workflow is already stopped with TASK12T_DEVELOPMENT_WORKFLOW_STOPPED=1.");
  assert(typeof process.env.CLOUDFLARE_API_TOKEN === "string"
    && process.env.CLOUDFLARE_API_TOKEN.length > 0,
  "CLOUDFLARE_API_TOKEN is required for read-only D1 evidence.");
  const disposableCredentials = await readCredentialHandoff();
  assert(typeof OWNERS[0].password === "string" && OWNERS[0].password.length > 0,
    "BUILDCUSTOM_CUTOVER_TESTER_PASSWORD is required.");
  assert(typeof OWNERS[1].password === "string" && OWNERS[1].password.length > 0,
    "BUILDCUSTOM_NEW_USER_ACCEPTANCE_PASSWORD is required.");

  step = "anonymous-open-capabilities";
  const [productCapabilities, runtimeProviders] = await Promise.all([
    apiRead(`${PRODUCT}/api/public/capabilities`),
    apiRead(`${RUNTIME}/api/auth/providers`),
  ]);
  assert.equal(productCapabilities.status, 200, "Anonymous product capabilities read failed.");
  assert.equal(productCapabilities.body?.registrationEnabled, true,
    "Anonymous product capability did not report registration open.");
  assert.equal(runtimeProviders.status, 200, "Anonymous runtime providers read failed.");
  assert(runtimeProviders.body?.registrationEnabled === true
    && runtimeProviders.body?.email === true,
  "Anonymous runtime providers did not report open email registration.");
  record("anonymous-open-capabilities", {
    productStatus: productCapabilities.status,
    productRegistrationOpen: true,
    runtimeStatus: runtimeProviders.status,
    runtimeRegistrationOpen: true,
    runtimeEmailProvider: true,
  });

  step = "existing-owner-identity-preconditions";
  const project3Owner = await d1(PRODUCT_DATABASE,
    "SELECT u.email FROM users u JOIN projects p ON p.user_id=u.id WHERE p.id=? LIMIT 1", [3]);
  assert.equal(project3Owner.length, 1, "Project 3 owner lookup was unavailable.");
  OWNERS[1].email = project3Owner[0].email;
  const identities = await Promise.all(OWNERS.map(owner => identityFor(owner.email)));
  assert(!OWNERS.some(owner => owner.email.toLowerCase() === disposableCredentials.email.toLowerCase()),
    "Credential handoff email must be separate from the existing owners.");
  for (let index = 0; index < OWNERS.length; index += 1) {
    OWNERS[index].identity = identities[index];
  }
  record("existing-owner-identities", { ownerCount: identities.length, projectIds: [2, 3] });
  step = "fresh-disposable-user-d1-identity";
  const disposableIdentity = await identityFor(disposableCredentials.email);
  record("fresh-disposable-user-d1-identity", {
    productRuntimeMappingMatches: true,
    legacyPasswordHashNull: true,
  });

  step = "existing-owner-product-regression";
  const puppeteer = createRequire(LAB_PACKAGE)("puppeteer");
  const browser = await puppeteer.launch({
    executablePath: "/repl/tools/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1440, height: 1000 },
  });
  try {
    for (const [index, owner] of OWNERS.entries()) {
      report.checks[`${owner.label}-existing-owner-regression`] = {
        status: "PASS",
        evidence: await inspectOwner(browser, owner, identities[index], index === 0),
      };
    }
    step = "fresh-disposable-user-login-and-dashboard";
    report.checks["fresh-disposable-user-login-and-empty-dashboard"] = {
      status: "PASS",
      evidence: await inspectFreshDisposableUser(browser, disposableCredentials, disposableIdentity),
    };
  } finally {
    await browser.close();
  }

  step = "public-apps-and-marketing";
  record("two-public-apps-and-marketing", await checkPublicAppsAndMarketing());
  report.status = "PASS";
}

if (process.argv[2] !== "--execute" || process.argv.length !== 3) {
  console.error("Not run. Production execution requires the explicit --execute argument.");
  process.exitCode = 2;
} else {
  main().catch(error => {
    report.status = "FAIL";
    report.error = safeError(error);
  }).finally(() => {
    report.completedAt = new Date().toISOString();
    console.log(JSON.stringify(report));
    if (report.status !== "PASS") process.exitCode = 1;
  });
}