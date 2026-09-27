#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAB_PACKAGE = path.join(ROOT, "lab/bc-vibesdk-lab-20260925/package.json");
const puppeteer = createRequire(LAB_PACKAGE)("puppeteer");
const BASE = "https://buildcustom-control-plane-launch.thegoldimport.workers.dev";
const CHECKPOINT = "/tmp/buildcustom-task8e-private-acceptance.json";
const LOCK = `${CHECKPOINT}.lock`;
const PROFILE = "/tmp/buildcustom-task8e-private-profile";
const EMAIL = "cutover-test@buildcustom.ai";
const MARKER = "BUILDCUSTOM_CUTOVER_TESTER_OK";
const UI_TIMEOUT = 90_000;
const GENERATION_TIMEOUT = 8 * 60_000;

const mode = process.argv[2];
if (!["create", "inspect"].includes(mode) || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/task8e-private-acceptance.mjs create|inspect");
}
assert.equal(new URL(BASE).origin, BASE, "Control-plane origin must remain exact.");

function report(stage, evidence = {}) {
  console.log(JSON.stringify({ stage, ...evidence }));
}

function safeErrorMessage(error) {
  let message = error instanceof Error ? error.message : String(error || "Unknown error");
  message = message
    .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
      try { return `${new URL(raw.replace(/[),.;]+$/, "")).origin}`; } catch { return "[redacted-url]"; }
    })
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:password|passwd|(?:access|refresh)[_-]?token|token|secret|authorization|cookie|csrf)\b["']?(\s*[:=]\s*)["']?([^"'\s,;}]+)/gi, "$1[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return (message || "Unknown error").slice(0, 400);
}

function requireStatus(result, expected, stage) {
  assert.equal(result.status, expected, `${stage}: expected HTTP ${expected}, received ${result.status}.`);
}

function containsForbiddenCheckpointKey(value) {
  if (!value || typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value)) {
    if (/password|passwd|email|cookie|csrf|token|secret|authorization/i.test(key)) return true;
    if (containsForbiddenCheckpointKey(nested)) return true;
  }
  return false;
}

async function saveCheckpoint(state) {
  assert.equal(containsForbiddenCheckpointKey(state), false, "Refusing credentials in checkpoint.");
  const temp = `${CHECKPOINT}.${process.pid}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, CHECKPOINT);
    await chmod(CHECKPOINT, 0o600);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

async function readCheckpoint() {
  const value = JSON.parse(await readFile(CHECKPOINT, "utf8"));
  assert.equal(containsForbiddenCheckpointKey(value), false, "Checkpoint contains a forbidden field.");
  assert.equal(value?.schema, 1);
  assert(["create-complete", "inspect-complete"].includes(value?.stage),
    "Checkpoint is incomplete/ambiguous; do not repeat create or generation.");
  assert.equal(typeof value.userId, "string");
  assert(Number.isSafeInteger(value.projectId) && value.projectId > 0);
  assert.equal(typeof value.agentId, "string");
  assert.match(value.revision || "", /^[a-f0-9]{40}$/i);
  return value;
}

async function acquireLock() {
  const handle = await open(LOCK, "wx", 0o600);
  await handle.close();
  return () => unlink(LOCK).catch(() => undefined);
}

async function launchBrowser() {
  await mkdir(PROFILE, { recursive: true, mode: 0o700 });
  await chmod(PROFILE, 0o700);
  return puppeteer.launch({
    executablePath: "/repl/tools/bin/chromium",
    headless: true,
    userDataDir: PROFILE,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1440, height: 1000 },
  });
}

async function openPage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(UI_TIMEOUT);
  page.setDefaultNavigationTimeout(UI_TIMEOUT);
  return page;
}

async function authMe(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    let body = null;
    try { body = await response.json(); } catch { /* Keep only safe identity/status. */ }
    return { status: response.status, userId: body?.id || null };
  });
}

async function login(page) {
  const password = process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD;
  assert(typeof password === "string" && password.length > 0,
    "BUILDCUSTOM_CUTOVER_TESTER_PASSWORD is required; no password is logged or persisted.");
  await page.goto(`${BASE}/app/login`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="input-email"]').fill(EMAIL);
  await page.locator('[data-testid="input-password"]').fill(password);
  await page.locator('[data-testid="button-submit"]').click();
  await page.waitForFunction(() => location.pathname === "/app" || location.pathname === "/app/", { timeout: UI_TIMEOUT });
  const identity = await authMe(page);
  requireStatus(identity, 200, "private UI login");
  assert(identity.userId, "Login did not establish an authenticated identity.");
  return identity.userId;
}

async function api(page, pathname) {
  return page.evaluate(async (path) => {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    let body = null;
    try { body = await response.json(); } catch { /* Only status is exposed for non-JSON responses. */ }
    return { status: response.status, body };
  }, pathname);
}

async function getProject(page, projectId) {
  const result = await api(page, `/api/projects/${projectId}`);
  requireStatus(result, 200, "owner project");
  assert.equal(Number(result.body?.id), projectId);
  return result.body;
}

async function getRuntime(page, projectId, operation) {
  const result = await api(page, `/api/projects/${projectId}/runtime/${operation}`);
  requireStatus(result, 200, `owner runtime ${operation}`);
  return result.body;
}

async function getRevision(page, projectId) {
  const body = await getRuntime(page, projectId, "revision");
  const revision = body?.commitHash || body?.revision?.commitHash;
  assert.match(revision || "", /^[a-f0-9]{40}$/i,
    "Control plane did not return an authoritative committed Git revision.");
  return revision.toLowerCase();
}

async function getFiles(page, projectId) {
  const body = await getRuntime(page, projectId, "files");
  const files = Array.isArray(body) ? body : body?.files;
  assert(Array.isArray(files), "Runtime returned no authoritative file list.");
  return files;
}

async function getFileContent(page, projectId, filePath) {
  const result = await api(page, `/api/projects/${projectId}/runtime/files/content?path=${encodeURIComponent(filePath)}`);
  requireStatus(result, 200, `authoritative file ${filePath}`);
  assert.equal(result.body?.path, filePath);
  assert.equal(typeof result.body?.content, "string");
  return result.body.content;
}

function attachEvidence(page) {
  const evidence = {
    websocketConnections: 0,
    websocketHandshakes: 0,
    agentConnectedFrames: 0,
    conversationStateFrames: 0,
    sentSuggestions: 0,
    markerSuggestions: 0,
    streamingFrames: 0,
    completionFrames: 0,
    agentIds: [],
  };
  const cdpPromise = page.target().createCDPSession();
  const ready = cdpPromise.then(async (client) => {
    const runtimeSocketRequests = new Set();
    const parse = (payload) => {
      if (typeof payload !== "string") return null;
      try { return JSON.parse(payload); } catch { return null; }
    };
    await client.send("Network.enable");
    client.on("Network.webSocketCreated", ({ requestId, url }) => {
      try {
        if (new URL(url).pathname.includes("/runtime/ws")) {
          evidence.websocketConnections += 1;
          runtimeSocketRequests.add(requestId);
        }
      } catch { /* Ignore malformed URL. */ }
    });
    client.on("Network.webSocketHandshakeResponseReceived", ({ requestId, response }) => {
      if (runtimeSocketRequests.has(requestId) && response?.status === 101) evidence.websocketHandshakes += 1;
    });
    client.on("Network.webSocketFrameSent", ({ response }) => {
      const frame = parse(response?.payloadData);
      if (frame?.type === "user_suggestion") {
        evidence.sentSuggestions += 1;
        if (typeof frame.message === "string" && frame.message.includes(MARKER)) evidence.markerSuggestions += 1;
      }
    });
    client.on("Network.webSocketFrameReceived", ({ response }) => {
      const frame = parse(response?.payloadData);
      if (!frame) return;
      if (frame.type === "agent_connected") {
        evidence.agentConnectedFrames += 1;
        if (typeof frame.agentId === "string") evidence.agentIds.push(frame.agentId);
      }
      if (frame.type === "conversation_state") evidence.conversationStateFrames += 1;
      if (frame.type === "conversation_response" && frame.isStreaming === true) evidence.streamingFrames += 1;
      if (frame.type === "generation_complete") evidence.completionFrames += 1;
    });
    return client;
  });
  return { evidence, ready };
}

async function waitForSuccess(page) {
  await page.waitForFunction(() => {
    const state = document.querySelector('[data-testid="native-completion-state"]')?.getAttribute("data-state");
    return state === "success" || state === "error";
  }, { timeout: GENERATION_TIMEOUT });
  const state = await page.$eval('[data-testid="native-completion-state"]', (node) => node.getAttribute("data-state"));
  assert.equal(state, "success", "Native generation did not reach authoritative SUCCESS.");
}

async function waitForPreview(page, status) {
  const rawPreview = status.previewUrl || status.previewURL || status.state?.previewUrl || status.state?.previewURL;
  assert(rawPreview, "Runtime status did not provide a browser preview URL.");
  const target = new URL(rawPreview, BASE);
  assert.equal(target.protocol, "https:");
  await page.waitForFunction((expected) => [...document.querySelectorAll("iframe")]
    .some((item) => item.title.includes("project preview") && item.src === expected),
  { timeout: 35_000 }, target.href).catch(() => undefined);
  const matchesPreview = (candidate) => {
    try {
      const actual = new URL(candidate.url());
      return actual.origin === target.origin
        && (actual.pathname === target.pathname || actual.pathname.startsWith(`${target.pathname.replace(/\/$/, "")}/`));
    } catch { return false; }
  };
  let frame = page.frames().find(matchesPreview);
  const deadline = Date.now() + 45_000;
  while (!frame && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    frame = page.frames().find(matchesPreview);
  }
  assert(frame, "Project preview iframe did not load.");
  await frame.waitForFunction(() => document.readyState === "interactive" || document.readyState === "complete");
  await frame.waitForFunction(() => (document.body?.innerText || "").includes("BUILDCUSTOM_CUTOVER_TESTER_OK")
    && [...document.querySelectorAll('link[rel="stylesheet"]')]
      .some((link) => new URL(link.href).pathname.endsWith("/styles.css") && Boolean(link.sheet)),
  { timeout: 45_000 });
  const preview = await frame.evaluate(() => ({
    text: document.body?.innerText || "",
    stylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => ({
      href: link.href,
      loaded: Boolean(link.sheet),
    })),
  }));
  assert(preview.text.includes(MARKER), "Browser-rendered preview omitted the exact marker.");
  assert(preview.stylesheets.some((sheet) => new URL(sheet.href).pathname.endsWith("/styles.css") && sheet.loaded),
    "Browser preview did not load public/styles.css.");
  return { markerVisible: true, stylesheetLoaded: true };
}

const FORBIDDEN_HOST = /(^|\.)replit\.(?:com|dev|app)$|(^|\.)apps\.buildcustom\.ai$|^app\.buildcustom\.ai$|^vibesdk\.|(^|[-.])(legacy|staging|lab)([-.]|$)|^buildcustom-control-plane(?:\.|$)/i;

function startNetworkAudit(page) {
  const audit = { requests: 0, forbiddenRequests: 0, forbiddenHosts: [], previewHttpStatuses: [] };
  let previewOrigin = null;
  const cdpPromise = page.target().createCDPSession();
  const ready = cdpPromise.then(async (client) => {
    await client.send("Network.enable");
    client.on("Network.requestWillBeSent", ({ request }) => {
      audit.requests += 1;
      try {
        const host = new URL(request.url).hostname.toLowerCase();
        if (FORBIDDEN_HOST.test(host)) {
          audit.forbiddenRequests += 1;
          if (!audit.forbiddenHosts.includes(host)) audit.forbiddenHosts.push(host);
        }
      } catch { /* Invalid URL is not exposed or retained. */ }
    });
    client.on("Network.webSocketCreated", ({ url }) => {
      try {
        const host = new URL(url).hostname.toLowerCase();
        if (FORBIDDEN_HOST.test(host)) {
          audit.forbiddenRequests += 1;
          if (!audit.forbiddenHosts.includes(host)) audit.forbiddenHosts.push(host);
        }
      } catch { /* Invalid URL is not exposed or retained. */ }
    });
    client.on("Network.responseReceived", ({ response, type }) => {
      try {
        const url = new URL(response.url);
        if (previewOrigin && url.origin === previewOrigin
          && (type === "Document" || url.pathname.endsWith("/styles.css"))) {
          audit.previewHttpStatuses.push({
            resource: url.pathname.endsWith("/styles.css") ? "styles.css" : "document",
            status: response.status,
          });
        }
      } catch { /* URLs are not retained or logged. */ }
    });
    return client;
  });
  return {
    audit,
    ready,
    setPreviewOrigin(url) { previewOrigin = new URL(url, BASE).origin; },
  };
}

async function protectPublishing(page) {
  let blockedPublishRequests = 0;
  await page.setRequestInterception(true);
  const handler = (request) => {
    let block = false;
    try {
      const url = new URL(request.url());
      block = /\/runtime\/(?:publish|publish-immutable)|\/publish(?:\/|$)/i.test(url.pathname)
        && !["GET", "HEAD", "OPTIONS"].includes(request.method().toUpperCase());
    } catch { /* Browser validates request URL. */ }
    if (block) {
      blockedPublishRequests += 1;
      void request.abort("blockedbyclient").catch(() => undefined);
    } else {
      void request.continue().catch(() => undefined);
    }
  };
  page.on("request", handler);
  return {
    get blockedPublishRequests() { return blockedPublishRequests; },
    async stop() {
      page.off("request", handler);
      await page.setRequestInterception(false).catch(() => undefined);
    },
  };
}

async function openEditor(page, projectId) {
  await page.goto(`${BASE}/app/project/${projectId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="button-header-open-builder"]', { visible: true, timeout: UI_TIMEOUT });
  await page.locator('[data-testid="button-header-open-builder"]').click();
  await page.waitForFunction((id) => location.pathname === `/app/editor/${id}`, { timeout: UI_TIMEOUT }, projectId);
  await page.waitForSelector('[data-testid="button-open-native-publish"]', { visible: true, timeout: UI_TIMEOUT });
}

async function createMode() {
  let prior = null;
  try {
    prior = JSON.parse(await readFile(CHECKPOINT, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (prior) {
    assert.equal(containsForbiddenCheckpointKey(prior), false);
    assert.equal(prior.schema, 1);
    assert.equal(prior.stage, "aborted-login-verified",
      "Creation may already have been attempted; refusing to rerun.");
    assert.equal(typeof prior.userId, "string");
    assert.equal(prior.projectId, undefined);
    assert.equal(prior.agentId, undefined);
  }
  const browser = await launchBrowser();
  const page = await openPage(browser.defaultBrowserContext());
  const wire = attachEvidence(page);
  const checkpoint = prior || { schema: 1, stage: "login-not-yet-verified" };
  try {
    const userId = await login(page);
    if (prior) assert.equal(userId, prior.userId, "Authenticated tester differs from the safe pre-click checkpoint.");
    checkpoint.userId = userId;
    checkpoint.stage = "login-verified";
    await saveCheckpoint(checkpoint);

    await page.goto(`${BASE}/app`, { waitUntil: "networkidle2" });
    const skip = await page.$('[data-testid="button-skip-onboarding"]');
    if (skip) await skip.click({ timeout: 2_500 }).catch(() => undefined);
    const dashboard = await api(page, "/api/projects");
    requireStatus(dashboard, 200, "owner dashboard");
    assert(Array.isArray(dashboard.body), "Dashboard did not return a project list.");
    assert.equal(dashboard.body.length, 0, "Tester account already has a project; refusing duplicate project creation.");

    const prompt = `Create a minimal public app by creating public/index.html and public/styles.css. Link /styles.css from the HTML and display one prominent heading whose exact text is ${MARKER}.`;
    const input = page.locator('[data-testid="input-new-project-prompt"]');
    await input.fill(prompt);
    await input.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" ");
    await page.keyboard.press("Backspace");
    await page.waitForFunction((expected) => {
      const field = document.querySelector('[data-testid="input-new-project-prompt"]');
      const button = document.querySelector('[data-testid="button-start-project"]');
      return field?.value === expected && button instanceof HTMLButtonElement && !button.disabled;
    }, { timeout: UI_TIMEOUT }, prompt);

    checkpoint.stage = "project-create-outcome-unknown-do-not-rerun";
    await saveCheckpoint(checkpoint);
    await page.locator('[data-testid="button-start-project"]').click();
    await page.waitForFunction(() => /^\/app\/(?:project|editor)\/\d+$/.test(location.pathname), { timeout: UI_TIMEOUT });
    const match = page.url().match(/\/app\/(?:project|editor)\/(\d+)$/);
    assert(match, "Dashboard did not open the newly created project.");
    const projectId = Number(match[1]);
    assert(Number.isSafeInteger(projectId) && projectId > 0);
    checkpoint.projectId = projectId;
    checkpoint.stage = "project-created-generation-outcome-unknown-do-not-rerun";
    await saveCheckpoint(checkpoint);

    let project;
    let status;
    let agentId;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        status = await getRuntime(page, projectId, "status");
        project = await getProject(page, projectId);
        agentId = project.agentId || status.agentId || wire.evidence.agentIds.at(-1);
        if (status.nativeThink === true && typeof agentId === "string" && agentId) break;
      } catch { /* Wait for project initialization without repeating project creation. */ }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    assert.equal(status?.nativeThink, true, "Project initialization did not finish.");
    assert.equal(typeof agentId, "string");
    checkpoint.agentId = agentId;
    checkpoint.stage = "agent-ready";
    await saveCheckpoint(checkpoint);

    if (!page.url().includes("/app/editor/")) await openEditor(page, projectId);
    await wire.ready;

    // First inspect the automatic dashboard handoff. Only send the prompt manually
    // if the builder is positively idle and no automatic handoff is recorded.
    const observationDeadline = Date.now() + 25_000;
    while (Date.now() < observationDeadline && wire.evidence.sentSuggestions === 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const handoff = await page.evaluate((id) => ({
      handedOff: sessionStorage.getItem(`buildcustom:first-prompt:${id}`) !== null,
      sending: Boolean(document.querySelector('[data-testid="button-stop-build"]')),
      completion: document.querySelector('[data-testid="native-completion-state"]')?.getAttribute("data-state") || null,
    }), projectId);
    if (wire.evidence.sentSuggestions > 0 || handoff.handedOff || handoff.sending || handoff.completion === "success"
      || handoff.completion === "error") {
      assert.equal(wire.evidence.sentSuggestions, 1, "Automatic first prompt outcome is ambiguous; refusing another generation.");
      assert.equal(wire.evidence.markerSuggestions, 1, "Automatic prompt was not uniquely associated with the requested marker.");
    } else {
      const editorInput = page.locator('[data-testid="input-editor-chat"]');
      await editorInput.fill(prompt);
      checkpoint.stage = "generation-outcome-unknown-do-not-rerun";
      await saveCheckpoint(checkpoint);
      await page.locator('[data-testid="button-send-chat"]').click();
    }
    await waitForSuccess(page);
    assert.equal(wire.evidence.sentSuggestions, 1, "Expected exactly one user-originated generation.");
    assert.equal(wire.evidence.markerSuggestions, 1, "Expected one generation prompt containing the exact marker.");
    assert(wire.evidence.streamingFrames > 0, "No native streaming response was observed.");

    const latestProject = await getProject(page, projectId);
    const latestStatus = await getRuntime(page, projectId, "status");
    assert.equal(latestProject.agentId || latestStatus.agentId, agentId, "Project changed owner-specific ThinkAgent.");
    const revision = await getRevision(page, projectId);
    const files = await getFiles(page, projectId);
    assert(files.some((file) => file.path === "public/index.html"));
    assert(files.some((file) => file.path === "public/styles.css"));
    const html = await getFileContent(page, projectId, "public/index.html");
    const css = await getFileContent(page, projectId, "public/styles.css");
    assert(html.includes(MARKER), "Authoritative committed HTML omitted the exact marker.");
    assert.match(html, /href=["'][^"']*styles\.css/i, "Generated HTML does not reference styles.css.");
    assert(css.length > 0, "Authoritative committed CSS is empty.");

    const projectsAfter = await api(page, "/api/projects");
    requireStatus(projectsAfter, 200, "post-create owner dashboard");
    assert.equal(projectsAfter.body.filter((item) => Number(item.id) === projectId).length, 1);
    assert.equal(projectsAfter.body.length, 1, "Tester dashboard should contain exactly one project.");
    checkpoint.revision = revision;
    checkpoint.stage = "create-complete";
    await saveCheckpoint(checkpoint);
    report("task8e-create-verified", {
      userId,
      projectId,
      agentId,
      revision,
      dashboardProjects: projectsAfter.body.length,
      generatedFiles: 2,
      markerVerified: true,
      generationSuggestions: wire.evidence.sentSuggestions,
      streamingFrames: wire.evidence.streamingFrames,
      completionFrames: wire.evidence.completionFrames,
      checkpointContainsCredentials: false,
    });
  } catch (error) {
    if (checkpoint.stage !== "create-complete") {
      if (!checkpoint.stage.includes("unknown") && checkpoint.stage !== "login-not-yet-verified") {
        checkpoint.stage = `aborted-${checkpoint.stage}`;
      }
      await saveCheckpoint(checkpoint).catch(() => undefined);
    }
    report("task8e-create-aborted", {
      stage: checkpoint.stage,
      reason: safeErrorMessage(error),
      doNotRetryCreateOrGeneration: true,
      userId: checkpoint.userId || null,
      projectId: checkpoint.projectId || null,
      agentId: checkpoint.agentId || null,
      credentialsPersistedOrLogged: false,
    });
    process.exitCode = 1;
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function inspectMode() {
  const checkpoint = await readCheckpoint();
  const browser = await launchBrowser();
  const page = await openPage(browser.defaultBrowserContext());
  const wire = attachEvidence(page);
  const audit = startNetworkAudit(page);
  const publishGuard = await protectPublishing(page);
  try {
    await wire.ready;
    await audit.ready;
    const userId = await login(page);
    assert.equal(userId, checkpoint.userId, "Authenticated browser identity differs from the checkpoint owner.");
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    const dashboard = await api(page, "/api/projects");
    requireStatus(dashboard, 200, "inspect owner dashboard");
    const matches = dashboard.body.filter((item) => Number(item.id) === checkpoint.projectId);
    assert.equal(matches.length, 1, "Checkpoint project is not uniquely present in the owner dashboard.");
    assert.equal(dashboard.body.length, 1, "Dashboard does not contain exactly the single tester project.");

    const project = await getProject(page, checkpoint.projectId);
    const status = await getRuntime(page, checkpoint.projectId, "status");
    assert.equal(status.nativeThink, true);
    assert.equal(project.agentId || status.agentId, checkpoint.agentId, "Reopened project changed owner-specific agent.");
    const revision = await getRevision(page, checkpoint.projectId);
    assert.equal(revision, checkpoint.revision, "Reopened project revision differs from the accepted Git revision.");
    const files = await getFiles(page, checkpoint.projectId);
    assert(files.some((file) => file.path === "public/index.html"));
    assert(files.some((file) => file.path === "public/styles.css"));
    const html = await getFileContent(page, checkpoint.projectId, "public/index.html");
    const css = await getFileContent(page, checkpoint.projectId, "public/styles.css");
    const releasesBefore = await getRuntime(page, checkpoint.projectId, "releases");
    assert(html.includes(MARKER), "Reopened authoritative HTML omitted the marker.");
    assert.match(html, /href=["'][^"']*styles\.css/i);
    assert(css.length > 0);

    const sentBeforeOpen = wire.evidence.sentSuggestions;
    audit.setPreviewOrigin(status.previewUrl || status.previewURL || status.state?.previewUrl || status.state?.previewURL);
    await openEditor(page, checkpoint.projectId);
    const turns = await getRuntime(page, checkpoint.projectId, "turns");
    assert(JSON.stringify(turns).includes(MARKER), "Owner conversation does not retain the generation prompt/marker.");
    const previewEvidence = await waitForPreview(page, status);
    const socketDeadline = Date.now() + 20_000;
    while ((wire.evidence.agentConnectedFrames === 0 || wire.evidence.conversationStateFrames === 0)
      && Date.now() < socketDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const reopenedRevision = await getRevision(page, checkpoint.projectId);
    const reopenedStatus = await getRuntime(page, checkpoint.projectId, "status");
    const releasesAfter = await getRuntime(page, checkpoint.projectId, "releases");
    assert.equal(reopenedRevision, checkpoint.revision, "Idle reopen changed the authoritative revision.");
    assert.equal(reopenedStatus?.state?.shouldBeGenerating, false, "Idle reopen triggered runtime inference.");
    assert.deepEqual(releasesAfter, releasesBefore, "Idle reopen created a release.");
    assert.equal(wire.evidence.sentSuggestions, sentBeforeOpen, "Reopening project sent an unexpected conversation prompt.");
    assert.equal(wire.evidence.sentSuggestions, 0, "Inspect mode must not send any generation prompt.");
    const liveStatus = await page.evaluate(() => ({
      completion: document.querySelector('[data-testid="native-completion-state"]')?.getAttribute("data-state") || null,
      stopButton: Boolean(document.querySelector('[data-testid="button-stop-build"]')),
    }));
    assert.notEqual(liveStatus.completion, "streaming");
    assert.equal(liveStatus.stopButton, false, "Reopened WebSocket conversation is not idle.");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const previewStatuses = audit.audit.previewHttpStatuses;
    assert(previewStatuses.some((item) => item.resource === "document" && item.status >= 200 && item.status < 300),
      "Browser-rendered preview document did not return successful HTTP.");
    assert(previewStatuses.some((item) => item.resource === "styles.css" && item.status >= 200 && item.status < 300),
      "Browser-rendered preview stylesheet did not return successful HTTP.");

    await page.locator('[data-testid="button-open-native-publish"]').click();
    await page.waitForSelector('[data-testid="publishing-drawer"]', { visible: true, timeout: UI_TIMEOUT });
    const publishState = await page.evaluate(() => {
      const button = document.querySelector('[data-testid="button-publish-native"]');
      const drawer = document.querySelector('[data-testid="publishing-drawer"]');
      const text = drawer?.innerText || "";
      return {
        buttonPresent: button instanceof HTMLButtonElement,
        buttonDisabled: button instanceof HTMLButtonElement ? button.disabled : null,
        publicAppsDisabledText: /public generated apps are not enabled yet/i.test(text),
        reservedNotLive: /reserved project address \(not live\)/i.test(text),
        futurePublicDomain: text.includes(".apps.buildcustom.ai"),
        privateUrlShown: /workers\.dev/i.test(text),
        openSiteAvailable: [...(drawer?.querySelectorAll("a,button") || [])]
          .some((node) => /open site/i.test(node.textContent || "")),
      };
    });
    assert(publishState.buttonPresent, "Publish UI did not expose its action control for inspection.");
    assert.equal(publishState.publicAppsDisabledText, true,
      "Publish UI did not visibly confirm public generated apps are disabled.");
    assert.equal(publishState.reservedNotLive, true, "Reserved project address was not labeled as not live.");
    assert.equal(publishState.futurePublicDomain, true, "Reserved future public domain was not shown.");
    assert.equal(publishState.privateUrlShown, false, "Private workers.dev URL was exposed in the Publish UI.");
    assert.equal(publishState.openSiteAvailable, false, "A public Open Site action was exposed while public apps are disabled.");
    assert.equal(publishGuard.blockedPublishRequests, 0, "A publish mutation was attempted and blocked during inspection.");
    assert.equal(audit.audit.forbiddenRequests, 0,
      `Forbidden legacy/Replit/staging/lab/old-control-plane hosts were contacted (${audit.audit.forbiddenRequests}).`);

    const idleWebSocketConnected = wire.evidence.websocketConnections > 0
      && wire.evidence.websocketHandshakes > 0
      && wire.evidence.agentConnectedFrames > 0
      && wire.evidence.conversationStateFrames > 0;
    report("task8e-inspect-evidence", {
      userId,
      projectId: checkpoint.projectId,
      agentId: checkpoint.agentId,
      revision,
      ownerProjectVisible: true,
      authoritativeHtmlAndCssVerified: true,
      markerVerified: true,
      previewMarkerVisible: previewEvidence.markerVisible,
      previewStylesheetLoaded: previewEvidence.stylesheetLoaded,
      websocketConnections: wire.evidence.websocketConnections,
      websocketHandshakes: wire.evidence.websocketHandshakes,
      agentConnectedFrames: wire.evidence.agentConnectedFrames,
      conversationStateFrames: wire.evidence.conversationStateFrames,
      ownerLinkedAgentMatched: true,
      idleWebSocketConnected,
      runtimeStayedIdle: true,
      revisionUnchanged: true,
      releasesUnchanged: true,
      sentSuggestionsDuringInspect: wire.evidence.sentSuggestions,
      streamingFramesDuringInspect: wire.evidence.streamingFrames,
      conversationContainsMarker: true,
      publishButtonDisabled: publishState.buttonDisabled,
      publicAppsDisabledUi: publishState.publicAppsDisabledText,
      reservedAddressNotLive: publishState.reservedNotLive,
      privateUrlHidden: !publishState.privateUrlShown,
      publicOpenSiteUnavailable: !publishState.openSiteAvailable,
      publishMutations: publishGuard.blockedPublishRequests,
      networkRequestsAudited: audit.audit.requests,
      previewHttpResponses: previewStatuses.filter((item) => item.resource === "document" || item.resource === "styles.css").length,
      forbiddenHostRequests: audit.audit.forbiddenRequests,
      forbiddenHosts: audit.audit.forbiddenHosts.length,
      checkpointContainsCredentials: false,
    });
    assert(idleWebSocketConnected, "Normal project reopen does not initiate an idle WebSocket; authenticated acceptance is incomplete.");
    checkpoint.stage = "inspect-complete";
    await saveCheckpoint(checkpoint);
  } catch (error) {
    report("task8e-inspect-aborted", {
      reason: safeErrorMessage(error),
      projectId: checkpoint.projectId,
      userId: checkpoint.userId,
      credentialsPersistedOrLogged: false,
      publishActionInvoked: false,
    });
    process.exitCode = 1;
  } finally {
    await publishGuard.stop();
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

const releaseLock = await acquireLock();
try {
  if (mode === "create") await createMode();
  else await inspectMode();
} finally {
  releaseLock();
}