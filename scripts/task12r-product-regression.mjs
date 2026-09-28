#!/usr/bin/env node

// Read-only Task 12R product regression. This script never signs up, generates,
// edits, publishes, or logs out. Browser interception blocks every mutation
// except ordinary existing-account login requests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAB_PACKAGE = path.join(ROOT, "lab/bc-vibesdk-lab-20260925/package.json");
const BASE = "https://app.buildcustom.ai";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const PRODUCT_DATABASE = "ca820baf-6973-4318-ac52-529d56293bb6";
const GATEWAY_VERSION = "9d80432b-4e53-4fe7-950a-2b53f0213eff";
const PROJECTS = [
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
const report = { at: new Date().toISOString(), results: {} };

function safeError(error) {
  return String(error instanceof Error ? error.message : error || "Unknown failure")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (value) => {
      try { return new URL(value.replace(/[),.;]+$/, "")).origin; } catch { return "[url]"; }
    })
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:password|passwd|(?:access|refresh)[_-]?token|token|secret|authorization|cookie|csrf)\b["']?(\s*[:=]\s*)["']?([^"'\s,;}]+)/gi, "$1[redacted]")
    .replace(/\btk_[a-f0-9]{24,}\b/gi, "[ticket]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function forbiddenHost(host) {
  const value = host.toLowerCase();
  return /(^|\.)replit\.(com|dev|app)$/.test(value)
    || /(^|[-.])(legacy|staging|lab)([-.]|$)/.test(value)
    || value.endsWith(".workers.dev")
    || value === "workers.dev";
}

function createNetworkAudit(page) {
  const audit = {
    requestCount: 0,
    forbiddenHosts: new Set(),
    blockedMutations: 0,
    websocketAttempts: 0,
    websocketHandshakes: 0,
    idleSuggestionFrames: 0,
    failedDocumentAssets: 0,
    ignoredTelemetryAssetFailures: 0,
    ignoredNavigationCancellations: 0,
    failedAssetTypes: {},
    failedAssetReasons: {},
  };
  const sockets = new Set();
  const acceptedSockets = new Set();
  const telemetryRequestIds = new Set();
  const clientPromise = page.target().createCDPSession();
  const interceptionPromise = page.setRequestInterception(true);

  page.on("request", (request) => {
    const method = request.method().toUpperCase();
    let permitted = ["GET", "HEAD", "OPTIONS"].includes(method);
    if (method === "POST") {
      try {
        const url = new URL(request.url());
        const telemetry = url.origin === BASE && url.pathname === "/cdn-cgi/rum";
        permitted = url.origin === BASE
          && ["/api/auth/login", "/api/auth/logout"].includes(url.pathname);
        if (telemetry) {
          void request.abort("blockedbyclient").catch(() => undefined);
          return;
        }
      } catch { permitted = false; }
    }
    if (permitted) {
      void request.continue().catch(() => undefined);
    } else {
      audit.blockedMutations += 1;
      void request.abort("blockedbyclient").catch(() => undefined);
    }
  });

  const ready = Promise.all([clientPromise, interceptionPromise]).then(async ([client]) => {
    await client.send("Network.enable");
    client.on("Network.requestWillBeSent", ({ requestId, request }) => {
      audit.requestCount += 1;
      try {
        const url = new URL(request.url);
        if (forbiddenHost(url.hostname)) audit.forbiddenHosts.add(url.hostname.toLowerCase());
        if (request.method.toUpperCase() === "POST" && url.origin === BASE
          && url.pathname === "/cdn-cgi/rum") {
          // Cloudflare RUM POSTs are intentionally aborted by this read-only audit.
          telemetryRequestIds.add(requestId);
        }
      } catch { /* Never retain malformed or opaque request URLs. */ }
    });
    client.on("Network.loadingFailed", ({ requestId, type, errorText, blockedReason, canceled }) => {
      if (type === "Document" || type === "Stylesheet" || type === "Script") {
        const explicitlyBlockedTelemetry = telemetryRequestIds.has(requestId)
          && (errorText === "net::ERR_BLOCKED_BY_CLIENT" || blockedReason === "inspector");
        if (explicitlyBlockedTelemetry) {
          audit.ignoredTelemetryAssetFailures += 1;
        } else if (canceled === true && errorText === "net::ERR_ABORTED") {
          // A page.goto intentionally abandons the previous document's pending work.
          audit.ignoredNavigationCancellations += 1;
        } else {
          audit.failedDocumentAssets += 1;
          audit.failedAssetTypes[type] = (audit.failedAssetTypes[type] || 0) + 1;
          const safeReason = ["net::ERR_ABORTED", "net::ERR_BLOCKED_BY_CLIENT", "net::ERR_FAILED"].includes(errorText)
            ? errorText : "other";
          audit.failedAssetReasons[safeReason] = (audit.failedAssetReasons[safeReason] || 0) + 1;
        }
      }
      telemetryRequestIds.delete(requestId);
    });
    client.on("Network.loadingFinished", ({ requestId }) => {
      telemetryRequestIds.delete(requestId);
    });
    client.on("Network.webSocketCreated", ({ requestId, url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "wss:" && parsed.hostname === new URL(BASE).hostname
          && parsed.pathname.endsWith("/runtime/ws")) {
          audit.websocketAttempts += 1;
          sockets.add(requestId);
        }
        if (forbiddenHost(parsed.hostname)) audit.forbiddenHosts.add(parsed.hostname.toLowerCase());
      } catch { /* Do not retain socket URLs, which may contain credentials. */ }
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
    return client;
  });
  return { audit, ready };
}

async function browserApi(page, pathname) {
  return page.evaluate(async (url) => {
    const response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    return {
      status: response.status,
      payload: await response.json().catch(() => null),
    };
  }, pathname);
}

async function queryProductD1(sql, params = []) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  assert(typeof token === "string" && token.length > 0,
    "CLOUDFLARE_API_TOKEN is required for read-only project-owner lookup.");
  const response = await fetch(
    `${CLOUDFLARE_API}/d1/database/${PRODUCT_DATABASE}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  assert(response.ok && body?.success === true && body.result?.[0]?.results,
    "Read-only product D1 owner lookup failed.");
  return body.result[0].results;
}

async function login(page, owner) {
  assert(typeof owner.email === "string" && owner.email.length > 0,
    `${owner.label} owner email lookup was empty.`);
  assert(typeof owner.password === "string" && owner.password.length > 0,
    `${owner.label} password environment variable is required.`);
  await page.goto(`${BASE}/app/login`, { waitUntil: "domcontentloaded" });
  assert.equal(new URL(page.url()).origin, BASE, "Login page left the public product origin.");
  await page.locator('[data-testid="input-email"]').fill(owner.email);
  await page.locator('[data-testid="input-password"]').fill(owner.password);
  await page.locator('[data-testid="button-submit"]').click();
  await page.waitForFunction(() => location.pathname === "/app" || location.pathname === "/app/",
    { timeout: 60_000 });
  assert.equal(new URL(page.url()).origin, BASE, "Login navigation left the public product origin.");
  const me = await browserApi(page, "/api/auth/me");
  assert.equal(me.status, 200, `${owner.label} existing-account login failed.`);
  assert(me.payload?.id, `${owner.label} authenticated identity was absent.`);
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
  assert(fileList.some((file) => file.path === "public/index.html"),
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
  return {
    project: projectResponse.payload,
    status,
    revision: commitHash,
    files: fileList,
    turns: turnList,
    rawTurns: turns,
    releases: releaseList,
  };
}

async function inspectEditorAndPreview(page, project, baseline, network) {
  const expectedPreview = baseline.status?.previewUrl || baseline.status?.previewURL
    || baseline.status?.state?.previewUrl || baseline.status?.state?.previewURL;
  assert(expectedPreview, `${project.label} owner status did not expose a preview URL.`);
  const previewTarget = new URL(expectedPreview, BASE);
  assert.equal(previewTarget.protocol, "https:", `${project.label} preview URL was not HTTPS.`);
  await page.goto(`${BASE}/app/project/${project.id}`, { waitUntil: "domcontentloaded" });
  assert.equal(new URL(page.url()).origin, BASE, `${project.label} project page left product origin.`);
  await page.waitForSelector('[data-testid="button-header-open-builder"]', {
    visible: true, timeout: 60_000,
  });
  await page.locator('[data-testid="button-header-open-builder"]').click();
  await page.waitForFunction((id) => location.pathname === `/app/editor/${id}`, {
    timeout: 60_000,
  }, project.id);
  await page.waitForSelector('[data-testid="button-open-native-publish"]', {
    visible: true, timeout: 60_000,
  });
  assert.equal(new URL(page.url()).origin, BASE, `${project.label} editor left product origin.`);

  await page.goto(`${BASE}/app/project/${project.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="tab-files"]', { visible: true, timeout: 60_000 });
  await page.locator('[data-testid="tab-files"]').click();
  await page.waitForSelector('[data-testid="file-row-index.html"]', {
    visible: true, timeout: 60_000,
  });
  await page.locator('[data-testid="file-row-index.html"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll("pre")]
    .some((element) => element.textContent?.length));
  const authoritativeHtml = await browserApi(page,
    `/api/projects/${project.id}/runtime/files/content?path=public%2Findex.html`);
  assert.equal(authoritativeHtml.status, 200, `${project.label} index file read failed.`);
  const renderedHtml = await page.$eval("pre", (element) => element.textContent || "");
  assert.equal(renderedHtml.replace(/\r\n/g, "\n"),
    String(authoritativeHtml.payload?.content || "").replace(/\r\n/g, "\n"),
    `${project.label} Files view did not match the saved index file.`);

  // Reopen the editor after Files, so preview and its idle runtime socket are observed.
  const priorHandshakes = network.audit.websocketHandshakes;
  await page.goto(`${BASE}/app/project/${project.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="button-header-open-builder"]', {
    visible: true, timeout: 60_000,
  });
  await page.locator('[data-testid="button-header-open-builder"]').click();
  await page.waitForFunction((id) => location.pathname === `/app/editor/${id}`, {
    timeout: 60_000,
  }, project.id);
  await page.waitForSelector('[data-testid="button-open-native-publish"]', {
    visible: true, timeout: 60_000,
  });

  await page.waitForFunction((expected) => [...document.querySelectorAll("iframe")]
    .some((candidate) => candidate.title.includes("project preview") && candidate.src === expected),
  { timeout: 35_000 }, previewTarget.href).catch(() => undefined);
  const frame = await (async () => {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const found = page.frames().find((candidate) => {
        try {
          return candidate !== page.mainFrame()
            && new URL(candidate.url()).origin === previewTarget.origin
            && new URL(candidate.url()).pathname.startsWith(previewTarget.pathname);
        } catch { return false; }
      });
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  })();
  assert(frame, `${project.label} preview did not load.`);
  await frame.waitForFunction(() => document.readyState === "interactive"
    || document.readyState === "complete", { timeout: 45_000 });
  const previewEvidence = await frame.evaluate((marker) => ({
    markerVisible: (document.body?.innerText || "").includes(marker),
    stylesheetLoaded: [...document.querySelectorAll('link[rel="stylesheet"]')]
      .some((link) => new URL(link.href).pathname.endsWith("/styles.css") && Boolean(link.sheet)),
  }), project.marker);
  assert(previewEvidence.markerVisible, `${project.label} preview marker was not visible.`);
  // Existing releases/revision/conversation must remain byte-for-byte stable through read-only reopen.
  await new Promise(resolve => setTimeout(resolve, 15_000));
  assert(network.audit.websocketHandshakes > priorHandshakes,
    `${project.label} idle runtime WebSocket did not complete a 101 handshake.`);
  assert.equal(network.audit.idleSuggestionFrames, 0,
    `${project.label} unexpectedly sent a conversation suggestion while idle.`);
  const after = await snapshot(page, project);
  assert.equal(after.revision, baseline.revision, `${project.label} committed revision changed.`);
  assert.deepEqual(after.releases, baseline.releases, `${project.label} releases changed.`);
  assert.deepEqual(after.rawTurns, baseline.rawTurns, `${project.label} conversation changed.`);
  return {
    projectId: project.id,
    fileCount: baseline.files.length,
      conversationTurns: baseline.turns?.length ?? null,
    releaseCount: baseline.releases.length,
    revisionPresent: Boolean(baseline.revision),
    preview: previewEvidence,
    idleWebSocket: true,
    idleSuggestionFrames: 0,
    releaseAndConversationUnchanged: true,
  };
}

async function inspectOwner(browser, owner) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(60_000);
  const network = createNetworkAudit(page);
  try {
    await network.ready;
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    assert.equal(new URL(page.url()).origin, BASE, "Anonymous application left product origin.");
    // Signup is intentionally observed but never submitted.
    await page.goto(`${BASE}/app/signup`, { waitUntil: "domcontentloaded" });
    assert.equal(new URL(page.url()).origin, BASE, "Signup page left product origin.");
    await login(page, owner);
    const dashboard = await browserApi(page, "/api/projects");
    assert.equal(dashboard.status, 200, `${owner.label} dashboard failed.`);
    assert(Array.isArray(dashboard.payload), `${owner.label} dashboard was not a project list.`);
    assert.deepEqual(dashboard.payload.map((item) => Number(item.id)), [owner.id],
      `${owner.label} dashboard exposed unexpected projects.`);
    const crossOwner = await browserApi(page, `/api/projects/${owner.other}`);
    assert([403, 404].includes(crossOwner.status),
      `${owner.label} cross-owner project request was not denied.`);
    const crossOwnerFiles = await browserApi(page,
      `/api/projects/${owner.other}/runtime/files`);
    assert([403, 404].includes(crossOwnerFiles.status),
      `${owner.label} cross-owner Files request was not denied.`);
    const baseline = await snapshot(page, owner);
    const productRegression = await inspectEditorAndPreview(page, owner, baseline, network);
    assert.equal(network.audit.blockedMutations, 0,
      `${owner.label} app attempted a blocked mutation during read-only inspection.`);
    assert.equal(network.audit.forbiddenHosts.size, 0,
      `${owner.label} customer page contacted a forbidden runtime host.`);
    assert.equal(network.audit.failedDocumentAssets, 0,
      `${owner.label} page had failed document/script/style assets: ${JSON.stringify({
        types: network.audit.failedAssetTypes, reasons: network.audit.failedAssetReasons,
      })}.`);
    return {
      login: true,
      dashboardProjectIds: [owner.id],
      crossOwnerStatuses: {
        project: crossOwner.status,
        files: crossOwnerFiles.status,
      },
      productRegression,
      signupPageObservedWithoutSubmission: true,
      customerNetwork: {
        requestCount: network.audit.requestCount,
        websocketAttempts: network.audit.websocketAttempts,
        websocketHandshakes: network.audit.websocketHandshakes,
        blockedMutations: network.audit.blockedMutations,
        forbiddenHosts: [...network.audit.forbiddenHosts],
        failedDocumentAssets: network.audit.failedDocumentAssets,
        ignoredTelemetryAssetFailures: network.audit.ignoredTelemetryAssetFailures,
        failedAssetTypes: network.audit.failedAssetTypes,
      },
    };
  } finally {
    await context.close();
  }
}

async function checkGatewayVersion() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  assert(typeof token === "string" && token.length > 0,
    "CLOUDFLARE_API_TOKEN is required for the read-only gateway version check.");
  const response = await fetch(`${CLOUDFLARE_API}/workers/scripts/buildcustom-apps-gateway/deployments`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  assert.equal(response.status, 200, "Gateway deployment metadata read failed.");
  assert(body?.success === true, "Gateway deployment metadata was not successful.");
  const versions = body.result?.deployments?.[0]?.versions;
  assert.deepEqual(versions, [{ version_id: GATEWAY_VERSION, percentage: 100 }],
    "Public apps gateway version or traffic allocation changed.");
  return { worker: "buildcustom-apps-gateway", version: GATEWAY_VERSION, percentage: 100 };
}

async function checkPublicEndpoints() {
  const results = {};
  for (const project of PROJECTS) {
    const response = await fetch(`https://${project.publicHost}/`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const html = await response.text();
    assert.equal(response.status, 200, `${project.label} generated app was unavailable.`);
    assert(html.includes(project.marker), `${project.label} public marker was absent.`);
    results[project.label] = { status: 200, markerPresent: true };
  }
  const unknown = await fetch(`https://task12r-not-a-release-${Date.now()}.apps.buildcustom.ai/`, {
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(unknown.status, 404, "Unknown generated-app slug did not return 404.");
  const marketing = await fetch("https://buildcustom.ai/", {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(marketing.status, 200, "Marketing site was unavailable.");
  return { generatedApps: results, unknownSlugStatus: 404, marketingStatus: 200 };
}

async function main() {
  assert.equal(process.env.TASK12R_RUN_READ_ONLY, "1",
    "Set TASK12R_RUN_READ_ONLY=1 only when intentionally running this read-only production regression.");
  assert(typeof process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD === "string"
    && process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD.length > 0,
  "BUILDCUSTOM_CUTOVER_TESTER_PASSWORD is required.");
  assert(typeof process.env.BUILDCUSTOM_NEW_USER_ACCEPTANCE_PASSWORD === "string"
    && process.env.BUILDCUSTOM_NEW_USER_ACCEPTANCE_PASSWORD.length > 0,
  "BUILDCUSTOM_NEW_USER_ACCEPTANCE_PASSWORD is required.");

  const project3Owner = await queryProductD1(
    "SELECT u.email FROM users u JOIN projects p ON p.user_id=u.id WHERE p.id=? LIMIT 1",
    [3],
  );
  assert.equal(project3Owner.length, 1, "Project 3 owner was unavailable.");
  PROJECTS[1].email = project3Owner[0].email;
  assert(typeof PROJECTS[1].email === "string" && PROJECTS[1].email.length > 0,
    "Project 3 owner email was absent.");

  const puppeteer = createRequire(LAB_PACKAGE)("puppeteer");
  const browser = await puppeteer.launch({
    executablePath: "/repl/tools/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1440, height: 1000 },
  });
  try {
    for (const owner of PROJECTS) {
      report.results[owner.label] = await inspectOwner(browser, owner);
    }
    report.results.public = await checkPublicEndpoints();
    report.results.gateway = await checkGatewayVersion();
    report.status = "PASS";
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  report.status = "FAIL";
  report.error = safeError(error);
}).finally(() => {
  report.completedAt = new Date().toISOString();
  console.log(JSON.stringify(report));
  if (report.status !== "PASS") process.exitCode = 1;
});