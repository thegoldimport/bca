#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAB_PACKAGE = path.join(ROOT, "lab/bc-vibesdk-lab-20260925/package.json");
const puppeteer = createRequire(LAB_PACKAGE)("puppeteer");
const EXPECTED_BASE = "https://buildcustom-control-plane-launch.thegoldimport.workers.dev";
const BASE = (process.env.TASK7_ACCEPTANCE_BASE_URL || EXPECTED_BASE).replace(/\/+$/, "");
const CHECKPOINT = "/tmp/buildcustom-task7-ui-acceptance.json";
const LOCK = `${CHECKPOINT}.lock`;
const PROFILE = process.env.TASK7_BROWSER_PROFILE || "/tmp/buildcustom-task7-ui-profile";
const MARKER = "BUILDCUSTOM_TASK7_UI_OK";
const EDIT_MARKER = "BUILDCUSTOM_TASK7_EDIT_OK";
const PRIVATE_GATEWAY_HOST = "buildcustom-apps-gateway-launch.thegoldimport.workers.dev";
const GENERATION_TIMEOUT = 8 * 60_000;
const UI_TIMEOUT = 90_000;

if (BASE !== EXPECTED_BASE || new URL(BASE).origin !== EXPECTED_BASE) {
  throw new Error("Refusing to run outside the exact private Task 7 control-plane canary.");
}

const args = process.argv.slice(2);
const phaseArg = args.find((arg) => arg.startsWith("--phase="))?.slice("--phase=".length) || "full";
const phase = phaseArg;
if (!["full", "resume", "replit-off"].includes(phase)) {
  throw new Error("Use --phase=full, --phase=resume, or --phase=replit-off.");
}
if (args.some((arg) => arg.startsWith("--base="))) {
  throw new Error("The private Task 7 canary base cannot be overridden on the command line.");
}

function report(stage, evidence = {}) {
  console.log(JSON.stringify({ stage, ...evidence }));
}

function stageError(error, fallback) {
  const message = safeErrorMessage(error);
  if (/timeout|timed out/i.test(message)) {
    return `${fallback}: ${message}; outcome may be unknown; inspect the checkpoint before any retry.`;
  }
  return `${fallback}: ${message}; inspect the checkpoint before any retry.`;
}

function safeErrorMessage(error) {
  let message = error instanceof Error ? error.message : String(error || "Unknown error");
  message = message
    .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
      try {
        const url = new URL(raw.replace(/[),.;]+$/, ""));
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[redacted-url]";
      }
    })
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:password|passwd|(?:access|refresh)[_-]?token|token|secret|authorization|cookie|csrf)\b["']?(\s*[:=]\s*)["']?([^"'\s,;}]+)/gi, "$1[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\btk_[a-f0-9]{24,}\b/gi, "[redacted-ticket]")
    .replace(/\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, "[redacted-token]")
    .replace(/\s+/g, " ")
    .trim();
  return (message || "Unknown error").slice(0, 500);
}

function requireStatus(result, expected, stage) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert(allowed.includes(result.status), `${stage}: expected HTTP ${allowed.join("/")} but received ${result.status}.`);
}

async function acquireLock() {
  const file = await open(LOCK, "wx", 0o600);
  await file.close();
  return async () => unlink(LOCK).catch(() => undefined);
}

function containsCredentialKey(value) {
  if (!value || typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value)) {
    if (/password|passwd|email|cookie|csrf|token|secret|authorization/i.test(key)) return true;
    if (containsCredentialKey(nested)) return true;
  }
  return false;
}

async function saveCheckpoint(state) {
  assert.equal(containsCredentialKey(state), false, "Refusing to persist credential-like data in the checkpoint.");
  const temporary = `${CHECKPOINT}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, CHECKPOINT);
    await chmod(CHECKPOINT, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function readCheckpoint() {
  let value;
  try {
    value = JSON.parse(await readFile(CHECKPOINT, "utf8"));
  } catch {
    throw new Error("Replit-off phase requires a completed full-acceptance checkpoint.");
  }
  if (containsCredentialKey(value) || value?.schema !== 1 || value?.phase !== "complete"
    || typeof value.userId !== "string" || !Number.isSafeInteger(value.projectId)
    || typeof value.agentId !== "string" || typeof value.editRevision !== "string"
    || typeof value.releaseId !== "string" || typeof value.slug !== "string"
    || typeof value.scriptName !== "string" || typeof value.deploymentUrl !== "string") {
    throw new Error("The local checkpoint is incomplete or contains disallowed fields; refusing a repeat acceptance run.");
  }
  return value;
}

async function readResumeCheckpoint() {
  let value;
  try {
    value = JSON.parse(await readFile(CHECKPOINT, "utf8"));
  } catch {
    throw new Error("Resume requires the existing signup-verified checkpoint.");
  }
  if (containsCredentialKey(value) || value?.schema !== 1 || value?.phase !== "aborted"
    || value?.stage !== "signup-verified" || value?.base !== BASE
    || typeof value.userId !== "string" || typeof value.runId !== "string"
    || value.projectId !== undefined || value.agentId !== undefined) {
    throw new Error("Resume is allowed only for the aborted signup-verified checkpoint before any project or inference.");
  }
  return value;
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

async function attachWebSocketEvidence(page) {
  const evidence = {
    connections: 0,
    receivedFrames: 0,
    streamingFrames: 0,
    completionFrames: 0,
    fileEvents: 0,
    markerFileEvents: 0,
    sentSuggestions: [],
    agentIds: [],
  };
  const client = await page.target().createCDPSession();
  const parsePayload = (payload) => {
    if (typeof payload !== "string") return null;
    try { return JSON.parse(payload); } catch { return null; }
  };
  await client.send("Network.enable");
  client.on("Network.webSocketCreated", ({ url }) => {
    if (typeof url === "string" && url.includes("/runtime/ws")) evidence.connections += 1;
  });
  client.on("Network.webSocketFrameSent", ({ response }) => {
    const frame = parsePayload(response?.payloadData);
    if (frame?.type === "user_suggestion") {
      evidence.sentSuggestions.push({
        initialMarker: typeof frame.message === "string" && frame.message.includes(MARKER),
        editMarker: typeof frame.message === "string" && frame.message.includes(EDIT_MARKER),
      });
    }
  });
  client.on("Network.webSocketFrameReceived", ({ response }) => {
    const frame = parsePayload(response?.payloadData);
    if (!frame) return;
    evidence.receivedFrames += 1;
    if (frame.type === "agent_connected" && typeof frame.agentId === "string") evidence.agentIds.push(frame.agentId);
    if (frame.type === "conversation_response" && frame.isStreaming === true) evidence.streamingFrames += 1;
    if (frame.type === "generation_complete") evidence.completionFrames += 1;
    if (frame.type === "file_generated" || frame.type === "file_deleted") {
      evidence.fileEvents += 1;
      if (frame.type === "file_generated" && JSON.stringify(frame.file || {}).includes(MARKER)) evidence.markerFileEvents += 1;
    }
  });
  return { evidence, ready: Promise.resolve() };
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
    try { body = await response.json(); } catch { /* No sensitive response is exposed to the harness. */ }
    return { status: response.status, authenticated: Boolean(body?.id), userId: body?.id || null };
  });
}

async function api(page, pathname, { method = "GET", body } = {}) {
  return page.evaluate(async ({ pathname, method, body }) => {
    const headers = new Headers({ Accept: "application/json" });
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
    if (unsafe) {
      const csrfResponse = await fetch("/api/auth/csrf-token", { credentials: "same-origin", cache: "no-store" });
      const csrf = await csrfResponse.json().catch(() => null);
      if (!csrfResponse.ok || typeof csrf?.token !== "string") {
        return { status: csrfResponse.status, body: null };
      }
      headers.set("X-CSRF-Token", csrf.token);
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(pathname, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* Keep only a safe status if a route is non-JSON. */ }
    return { status: response.status, body: payload };
  }, { pathname, method, body });
}

async function submitAuth(page, { signup, name, email, password }) {
  await page.goto(`${BASE}/app/${signup ? "signup" : "login"}`, { waitUntil: "domcontentloaded" });
  if (signup) await page.locator('[data-testid="input-name"]').fill(name);
  await page.locator('[data-testid="input-email"]').fill(email);
  await page.locator('[data-testid="input-password"]').fill(password);
  await page.locator('[data-testid="button-submit"]').click();
  await page.waitForFunction(() => location.pathname === "/app" || location.pathname === "/app/", { timeout: UI_TIMEOUT });
  const identity = await authMe(page);
  requireStatus(identity, 200, signup ? "UI signup" : "UI login");
  assert.equal(identity.authenticated, true, "UI authentication did not establish a verified product session.");
  return identity.userId;
}

async function maybeSkipOnboarding(page) {
  const skip = await page.$('[data-testid="button-skip-onboarding"]');
  if (skip) await skip.click({ timeout: 2_500 }).catch(() => undefined);
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
  const result = await getRuntime(page, projectId, "revision");
  const revision = result?.commitHash || result?.revision?.commitHash;
  assert.match(revision || "", /^[a-f0-9]{40}$/i, "The control plane did not return an authoritative committed Git revision.");
  return revision.toLowerCase();
}

async function getFiles(page, projectId) {
  const result = await getRuntime(page, projectId, "files");
  const files = Array.isArray(result) ? result : result?.files;
  assert(Array.isArray(files) && files.length > 0, "The runtime returned no authoritative workspace files.");
  return files;
}

async function getFileContent(page, projectId, filePath) {
  const result = await api(page, `/api/projects/${projectId}/runtime/files/content?path=${encodeURIComponent(filePath)}`);
  requireStatus(result, 200, `authoritative file ${filePath}`);
  assert.equal(result.body?.path, filePath);
  assert.equal(typeof result.body?.content, "string");
  return result.body.content;
}

async function ownerSnapshot(page, projectId, expectedAgentId) {
  const project = await getProject(page, projectId);
  const status = await getRuntime(page, projectId, "status");
  assert.equal(status.nativeThink, true, "The editor is not connected to native Think.");
  const linkedAgentId = project.agentId || status.agentId;
  assert.equal(linkedAgentId, expectedAgentId, "The reopened product project changed runtime Agent.");
  const revision = await getRevision(page, projectId);
  const files = await getFiles(page, projectId);
  return { project, status, revision, files };
}

async function waitForBuilderSuccess(page, timeout = GENERATION_TIMEOUT) {
  await page.waitForFunction(() => {
    const state = document.querySelector('[data-testid="native-completion-state"]')?.getAttribute("data-state");
    return state === "success" || state === "error";
  }, { timeout });
  const state = await page.$eval('[data-testid="native-completion-state"]', (element) => ({
    phase: element.getAttribute("data-state"),
    text: element.textContent || "",
  }));
  assert.equal(state.phase, "success", "BuildCustom did not reach native authoritative SUCCESS.");
  return state;
}

async function waitForPreview(page, status, marker) {
  let previewUrl = status.previewUrl || status.previewURL || status.state?.previewUrl || status.state?.previewURL || "";
  assert(previewUrl, "The native runtime did not provide a browser preview URL.");
  const target = new URL(previewUrl, BASE);
  assert.equal(target.protocol, "https:", "Preview did not use HTTPS.");
  await page.waitForFunction((expected) => {
    const frame = [...document.querySelectorAll("iframe")].find((item) => item.title.includes("project preview"));
    return Boolean(frame?.src && new URL(frame.src).href === expected);
  }, { timeout: 35_000 }, target.href).catch(() => undefined);
  const matchesPreview = (candidate) => {
    try {
      const actual = new URL(candidate.url());
      return actual.origin === target.origin
        && (actual.pathname === target.pathname || actual.pathname.startsWith(`${target.pathname.replace(/\/$/, "")}/`));
    } catch {
      return false;
    }
  };
  let frame = page.frames().find(matchesPreview);
  if (!frame) {
    await page.waitForFunction(() => [...document.querySelectorAll("iframe")].some((item) => item.title.includes("project preview") && item.src), { timeout: 20_000 });
    frame = page.frames().find(matchesPreview);
  }
  assert(frame, "The BuildCustom preview iframe did not navigate to the runtime preview.");
  await frame.waitForFunction(() => document.readyState === "interactive" || document.readyState === "complete", { timeout: 45_000 });
  const content = await frame.evaluate(() => document.body?.innerText || "");
  assert(content.includes(marker), "The runtime preview did not render the expected generated text.");
  return { url: target.href, markerVisible: true };
}

async function readRenderedFilesInProductUi(page, projectId, marker) {
  const authoritative = await getFileContent(page, projectId, "public/index.html");
  await page.goto(`${BASE}/app/project/${projectId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="tab-files"]', { visible: true, timeout: UI_TIMEOUT });
  await page.locator('[data-testid="tab-files"]').click();
  const htmlPath = "public/index.html";
  const fileRow = page.locator('[data-testid="file-row-index.html"]');
  await page.waitForSelector('[data-testid="file-row-index.html"]', { visible: true, timeout: UI_TIMEOUT });
  await fileRow.click();
  await page.waitForFunction(() => [...document.querySelectorAll("pre")].some((element) => element.textContent?.length));
  const rendered = await page.$eval("pre", (element) => element.textContent || "");
  assert(rendered.includes(marker), "BuildCustom's project Files view did not show the authoritative runtime HTML marker.");
  assert.equal(rendered.replace(/\r\n/g, "\n"), authoritative.replace(/\r\n/g, "\n"),
    "BuildCustom's Files UI content differs from the authoritative runtime Git file.");
  return htmlPath;
}

async function openEditorFromProjectUi(page, projectId) {
  await page.goto(`${BASE}/app/project/${projectId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="button-header-open-builder"]', { visible: true, timeout: UI_TIMEOUT });
  await page.locator('[data-testid="button-header-open-builder"]').click();
  await page.waitForFunction((id) => location.pathname === `/app/editor/${id}`, { timeout: UI_TIMEOUT }, projectId);
  await page.waitForSelector('[data-testid="button-open-native-publish"]', { visible: true, timeout: UI_TIMEOUT });
}

async function registerProjectThroughDashboard(page, checkpoint, wire) {
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  await maybeSkipOnboarding(page);
  const prompt = `Create a minimal single-page app by creating public/index.html and public/styles.css. Link /styles.css from the HTML, and render a prominent visible heading that reads exactly ${MARKER}. Keep all implementation simple and ready for a small text edit.`;
  const promptInput = page.locator('[data-testid="input-new-project-prompt"]');
  await promptInput.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(prompt, { delay: 1 });
  await page.waitForFunction((expected) => {
    const input = document.querySelector('[data-testid="input-new-project-prompt"]');
    const button = document.querySelector('[data-testid="button-start-project"]');
    return input?.value === expected && button instanceof HTMLButtonElement && !button.disabled;
  }, { timeout: UI_TIMEOUT }, prompt);
  checkpoint.stage = "project-create-and-first-generation-may-be-attempted";
  await saveCheckpoint(checkpoint);
  await page.locator('[data-testid="button-start-project"]').click();
  await page.waitForFunction(() => /^\/app\/(?:project|editor)\/\d+$/.test(location.pathname), { timeout: UI_TIMEOUT });
  const match = page.url().match(/\/app\/(?:project|editor)\/(\d+)$/);
  assert(match, "The BuildCustom dashboard did not open the newly created project.");
  const projectId = Number(match[1]);
  assert(Number.isSafeInteger(projectId) && projectId > 0);
  checkpoint.projectId = projectId;
  checkpoint.stage = "project-created";
  await saveCheckpoint(checkpoint);

  let project = await getProject(page, projectId);
  let status;
  let agentId;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      status = await getRuntime(page, projectId, "status");
      project = await getProject(page, projectId);
      agentId = project.agentId || status.agentId || wire.evidence.agentIds.at(-1);
      if (status.nativeThink === true && typeof agentId === "string" && agentId) break;
    } catch { /* A not-yet-initialized project is polled without repeating creation or inference. */ }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  assert.equal(status?.nativeThink, true, "Project initialization did not finish; no project or inference retry was made.");
  assert.equal(typeof agentId, "string", "BuildCustom did not expose its owner-specific ThinkAgent identity.");
  assert(agentId.length > 0);
  checkpoint.agentId = agentId;
  checkpoint.stage = "one-owner-agent-ready";
  await saveCheckpoint(checkpoint);

  if (!page.url().includes("/app/editor/")) await openEditorFromProjectUi(page, projectId);
  else await page.waitForSelector('[data-testid="button-open-native-publish"]', { visible: true, timeout: UI_TIMEOUT });
  await wire.ready;
  const promptDeadline = Date.now() + 25_000;
  while (wire.evidence.sentSuggestions.length === 0 && Date.now() < promptDeadline) {
    const state = await page.evaluate((id) => ({
      handedOff: sessionStorage.getItem(`buildcustom:first-prompt:${id}`) !== null,
      sending: Boolean(document.querySelector('[data-testid="button-stop-build"]')),
      error: document.querySelector('[data-testid="native-completion-state"]')?.getAttribute("data-state") === "error",
    }), projectId);
    if (state.error) break;
    if (!state.handedOff && !state.sending && Date.now() >= promptDeadline - 22_000) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (wire.evidence.sentSuggestions.length === 0) {
    const deliveryState = await page.evaluate((id) => ({
      handedOff: sessionStorage.getItem(`buildcustom:first-prompt:${id}`) !== null,
      sending: Boolean(document.querySelector('[data-testid="button-stop-build"]')),
      error: document.querySelector('[data-testid="native-completion-state"]')?.getAttribute("data-state") === "error",
    }), projectId);
    assert(!deliveryState.handedOff && !deliveryState.sending && !deliveryState.error,
      "The automatic first prompt may already have been attempted; refusing to send a duplicate.");
    const input = page.locator('[data-testid="input-editor-chat"]');
    await input.fill(prompt);
    checkpoint.stage = "initial-generation-send-about-to-be-attempted";
    await saveCheckpoint(checkpoint);
    await page.locator('[data-testid="button-send-chat"]').click();
  }
  await page.waitForFunction(() => {
    const phase = document.querySelector('[data-testid="native-completion-state"]')?.getAttribute("data-state");
    return phase === "success" || phase === "error";
  }, { timeout: GENERATION_TIMEOUT });
  const completion = await waitForBuilderSuccess(page);
  const initialSuggestions = wire.evidence.sentSuggestions.filter((item) => item.initialMarker);
  assert.equal(initialSuggestions.length, 1, "Expected exactly one UI-originated initial generation prompt.");
  assert(wire.evidence.streamingFrames > 0, "No native streaming frame was observed through the BuildCustom builder.");

  const snapshot = await ownerSnapshot(page, projectId, agentId);
  assert(snapshot.files.some((file) => file.path === "public/index.html"), "The authoritative runtime file list omitted public/index.html.");
  assert(snapshot.files.some((file) => file.path === "public/styles.css"), "The authoritative runtime file list omitted public/styles.css.");
  const initialHtml = await getFileContent(page, projectId, "public/index.html");
  const initialCss = await getFileContent(page, projectId, "public/styles.css");
  assert(initialHtml.includes(MARKER), "The committed authoritative runtime HTML omitted the generation marker.");
  assert.match(initialHtml, /href=["'][^"']*styles\.css/i, "The generated HTML did not reference its committed stylesheet.");
  assert(initialCss.length > 0, "The committed authoritative stylesheet is empty.");
  assert(wire.evidence.markerFileEvents > 0 || wire.evidence.fileEvents > 0, "The native WebSocket emitted no authoritative file activity.");
  checkpoint.initialRevision = snapshot.revision;
  checkpoint.initialGeneration = true;
  checkpoint.stage = "initial-generation-authoritatively-verified";
  await saveCheckpoint(checkpoint);
  report("initial-generation", {
    projectId,
    agentId,
    revision: snapshot.revision,
    streamFrames: wire.evidence.streamingFrames,
    fileEvents: wire.evidence.fileEvents,
    successState: completion.phase,
    markerInAuthoritativeFile: true,
  });
  return { projectId, agentId, initialHtml };
}

async function editOnceThroughBuilder(page, checkpoint, wire, projectId) {
  const priorSuggestions = wire.evidence.sentSuggestions.filter((item) => item.editMarker).length;
  await page.locator('[data-testid="input-editor-chat"]').fill(
    `Make one small edit: change the main visible heading to read exactly ${EDIT_MARKER}. Preserve the rest of the page and do not add another copy of the marker.`,
  );
  checkpoint.stage = "edit-send-about-to-be-attempted";
  await saveCheckpoint(checkpoint);
  await page.locator('[data-testid="button-send-chat"]').click();
  await waitForBuilderSuccess(page);
  const editSuggestions = wire.evidence.sentSuggestions.filter((item) => item.editMarker).length - priorSuggestions;
  assert.equal(editSuggestions, 1, "Expected exactly one UI-originated edit request.");
  const project = await getProject(page, projectId);
  const status = await getRuntime(page, projectId, "status");
  const agentId = project.agentId || status.agentId;
  assert.equal(agentId, checkpoint.agentId);
  const revision = await getRevision(page, projectId);
  assert.notEqual(revision, checkpoint.initialRevision, "The edit did not produce a new committed revision.");
  const html = await getFileContent(page, projectId, "public/index.html");
  const css = await getFileContent(page, projectId, "public/styles.css");
  assert(html.includes(EDIT_MARKER), "The edited marker is absent from authoritative committed HTML.");
  assert(!html.includes(MARKER) || html.includes(EDIT_MARKER), "The runtime HTML did not retain a visible project heading after the edit.");
  assert(css.length > 0, "The accepted edit removed the authoritative stylesheet.");
  checkpoint.editRevision = revision;
  checkpoint.stage = "edit-authoritatively-verified";
  await saveCheckpoint(checkpoint);
  return { agentId, revision, html };
}

async function assertPreviewThroughUi(page, projectId, marker) {
  const status = await getRuntime(page, projectId, "status");
  const evidence = await waitForPreview(page, status, marker);
  return evidence;
}

async function createSecondCustomer(browser, checkpoint) {
  const context = await browser.createBrowserContext();
  const page = await openPage(context);
  const email = `task7-isolation-${randomUUID()}@example.invalid`;
  const password = randomBytes(32).toString("base64url");
  try {
    checkpoint.phase = "running";
    checkpoint.stage = "second-customer-signup-about-to-be-attempted";
    await saveCheckpoint(checkpoint);
    const userId = await submitAuth(page, {
      signup: true,
      name: "Task 7 Isolation Check",
      email,
      password,
    });
    return { context, page, userId, email, password };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function verifyLogoutAndFreshLogin(session, expectedUserId) {
  const { page, email, password, userId } = session;
  assert.equal(userId, expectedUserId);
  const oldCookie = await readOldSessionCookie(page);
  await page.locator('[data-testid="button-logout"]').click();
  await page.waitForFunction(() => location.pathname === "/app/login", { timeout: UI_TIMEOUT });
  const oldSession = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: oldCookie },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const oldBody = await oldSession.json().catch(() => null);
  assert([200, 401].includes(oldSession.status));
  assert.equal(oldBody?.id || null, null, "The exact pre-logout session cookie remained accepted.");
  const freshUserId = await submitAuth(page, { signup: false, name: "", email, password });
  assert.equal(freshUserId, expectedUserId, "Fresh login changed the customer identity.");
  return true;
}

async function isolationThroughSecondCustomer(session, projectId, agentId) {
  const { page, userId } = session;
  {
    const dashboard = await api(page, "/api/projects");
    requireStatus(dashboard, 200, "second customer dashboard");
    assert(Array.isArray(dashboard.body) && !dashboard.body.some((item) => Number(item.id) === projectId),
      "User B dashboard exposed User A's project.");

    const projectPaths = [
      [`/api/projects/${projectId}`, "GET"],
      [`/api/projects/${projectId}/runtime/status`, "GET"],
      [`/api/projects/${projectId}/runtime/revision`, "GET"],
      [`/api/projects/${projectId}/runtime/files`, "GET"],
      [`/api/projects/${projectId}/runtime/files/content?path=public%2Findex.html`, "GET"],
      [`/api/projects/${projectId}/runtime/turns`, "GET"],
      [`/api/projects/${projectId}/runtime/publishing-settings`, "GET"],
      [`/api/projects/${projectId}/runtime/releases`, "GET"],
    ];
    const denied = [];
    for (const [pathname, method] of projectPaths) {
      const result = await api(page, pathname, { method });
      if (![401, 403, 404].includes(result.status)) {
        throw new Error(`User B project isolation failed at ${pathname} (HTTP ${result.status}).`);
      }
      denied.push(result.status);
    }
    const ticket = await api(page, "/api/ws-ticket", {
      method: "POST",
      body: { resourceType: "agent", resourceId: agentId },
    });
    if (![401, 403, 404].includes(ticket.status)) {
      throw new Error(`User B could obtain User A's owner-only runtime ticket (HTTP ${ticket.status}).`);
    }
    denied.push(ticket.status);

    await page.goto(`${BASE}/app/project/${projectId}`, { waitUntil: "domcontentloaded" });
    const apiNotFound = await page.waitForFunction(() => {
      const text = document.body?.innerText || "";
      return /project not found|not found|unable to load/i.test(text);
    }, { timeout: 15_000 }).then(() => true).catch(() => false);
    assert(apiNotFound, "User B's direct BuildCustom project URL did not show an access-denied/not-found UI state.");
    report("second-user-isolation", {
      userId,
      dashboardProjectHidden: true,
      ownerOnlyEndpointsDenied: denied.length,
      ownerOnlyTicketDenied: true,
      statuses: denied,
      directProjectUiDenied: true,
      ownerOnlyReadEndpointsDenied: denied.length === projectPaths.length,
    });
    return userId;
  }
}

async function readOldSessionCookie(page) {
  const cdp = await page.target().createCDPSession();
  try {
    await cdp.send("Network.enable");
    const result = await cdp.send("Network.getAllCookies");
    const host = new URL(BASE).hostname;
    const selected = (result.cookies || []).filter((cookie) =>
      cookie.domain.replace(/^\./, "") === host && cookie.value,
    );
    assert(selected.length > 0, "Could not verify the session cookie lifecycle.");
    return selected.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

function monitorPublishRequests(page) {
  const results = [];
  page.on("response", async (response) => {
    if (!response.url().includes("/runtime/publish-immutable-v2")) return;
    let body = null;
    try { body = await response.json(); } catch { /* Status remains useful if a non-JSON error occurred. */ }
    results.push({
      status: response.status(),
      alreadyPublished: body?.alreadyPublished === true,
      releaseId: body?.release?.id === undefined ? null : String(body.release.id),
      scriptName: body?.release?.scriptName || body?.release?.script_name || null,
      deploymentUrl: body?.deploymentUrl || null,
    });
  });
  return results;
}

async function protectLockedPublishingSettings(page) {
  let blockedWrites = 0;
  await page.setRequestInterception(true);
  const onRequest = (request) => {
    let isLockedSettingsWrite = false;
    try {
      const url = new URL(request.url());
      isLockedSettingsWrite = url.pathname.endsWith("/runtime/publishing-settings")
        && request.method().toUpperCase() === "PUT";
    } catch { /* Continue non-URL requests; the browser owns URL validation. */ }
    if (isLockedSettingsWrite) {
      blockedWrites += 1;
      void request.abort("blockedbyclient").catch(() => undefined);
    } else {
      void request.continue().catch(() => undefined);
    }
  };
  page.on("request", onRequest);
  return {
    get blockedWrites() { return blockedWrites; },
    async stop() {
      page.off("request", onRequest);
      await page.setRequestInterception(false).catch(() => undefined);
    },
  };
}

async function waitForArrayLength(array, length, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (array.length < length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(array.length >= length, "A BuildCustom publish response did not arrive before timeout.");
}

async function publishOnceAndRetry(page, checkpoint, projectId) {
  const requests = monitorPublishRequests(page);
  await page.locator('[data-testid="button-open-native-publish"]').click();
  await page.waitForSelector('[data-testid="publishing-drawer"]', { visible: true, timeout: UI_TIMEOUT });
  const slug = `task7${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  await page.locator('[data-testid="input-native-publish-slug"]').fill(slug);
  await page.waitForFunction((expected) =>
    document.querySelector('[data-testid="input-native-publish-slug"]')?.value === expected,
  { timeout: UI_TIMEOUT }, slug);
  checkpoint.slug = slug;
  checkpoint.stage = "customer-publish-about-to-be-attempted";
  checkpoint.publishAttempted = true;
  await saveCheckpoint(checkpoint);
  await page.locator('[data-testid="button-publish-native"]').click();
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-testid="native-publish-status"]')?.textContent || "";
    return status.includes("Published") || status.includes("Publish failed");
  }, { timeout: 300_000 });
  const firstStatus = await page.$eval('[data-testid="native-publish-status"]', (node) => node.textContent || "");
  assert.match(firstStatus, /Published/, "The normal BuildCustom customer Publish control did not complete.");
  await page.waitForFunction(() => document.querySelector('[data-testid="link-native-public-url"]')?.href, { timeout: 15_000 });
  await waitForArrayLength(requests, 1);
  const first = await page.$eval('[data-testid="link-native-public-url"]', (node) => node.href);
  const firstResult = requests[0];
  assert(firstResult && firstResult.status >= 200 && firstResult.status < 300, "The first Publish request did not return a successful API response.");
  assert.equal(requests.length, 1, "A single customer Publish click caused more than one immutable publish request.");
  const url = new URL(first);
  assert.equal(url.hostname, PRIVATE_GATEWAY_HOST, "Publish did not return the isolated private generated-app gateway.");
  assert(url.pathname.startsWith(`/p/${slug}/`), "Private release URL is not scoped to the stable slug.");
  assert(firstResult.releaseId, "Publish omitted the immutable release ID.");
  const scriptName = firstResult.scriptName;
  assert(typeof scriptName === "string" && /^bc-r-[a-f0-9]{56}$/.test(scriptName),
    "Publish omitted a collision-safe immutable script identity.");

  const routeCheckUrl = new URL("_buildcustom/route-check", first);
  const routeCheckResponse = await fetch(routeCheckUrl, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  requireStatus(routeCheckResponse, 200, "private gateway stable route check");
  const routeCheck = await routeCheckResponse.json();
  assert.equal(routeCheck.ok, true);
  assert.equal(routeCheck.project, slug);
  assert.equal(routeCheck.scriptName, scriptName, "The private gateway route-check did not identify the immutable script.");

  const appResponse = await fetch(first, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  requireStatus(appResponse, 200, "private generated-app route");
  assert((appResponse.headers.get("content-type") || "").includes("text/html"));
  assert.match(appResponse.headers.get("x-robots-tag") || "", /noindex/i, "Private canary response lacks noindex protection.");
  const appHtml = await appResponse.text();
  assert(appHtml.includes(EDIT_MARKER), "The immutable private route did not serve the edited marker.");
  const stylesheetLink = appHtml.match(/href=["']([^"']+\.css(?:\?[^"']*)?)["']/i)?.[1];
  assert(stylesheetLink, "The deployed page did not reference its stylesheet.");
  const stylesheetUrl = new URL(stylesheetLink, first);
  const cssResponse = await fetch(stylesheetUrl, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  requireStatus(cssResponse, 200, "private generated-app stylesheet");
  assert((cssResponse.headers.get("content-type") || "").includes("text/css"));

  const beforeRetry = await getRuntime(page, projectId, "releases");
  const releasesBefore = beforeRetry?.releases || [];
  assert(Array.isArray(releasesBefore) && releasesBefore.length === 1,
    "Expected exactly one immutable release after the customer Publish action.");

  checkpoint.releaseId = firstResult.releaseId;
  checkpoint.scriptName = scriptName;
  checkpoint.deploymentUrl = first;
  checkpoint.stage = "first-publish-verified";
  await saveCheckpoint(checkpoint);

  // Deliberate same-revision retry via the same visible Publish control. Never
  // retry after an ambiguous first result: this branch runs only after the
  // first request, route check, served HTML/CSS, and D1-backed release list passed.
  checkpoint.stage = "same-revision-idempotency-retry-about-to-be-attempted";
  checkpoint.idempotencyRetryAttempted = true;
  await saveCheckpoint(checkpoint);
  const settingsGuard = await protectLockedPublishingSettings(page);
  try {
    await page.locator('[data-testid="button-publish-native"]').click();
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-testid="native-publish-status"]')?.textContent || "";
      return status.includes("Published") || status.includes("Publish failed");
    }, { timeout: 300_000 });
    assert.equal(settingsGuard.blockedWrites, 0,
      "The same-revision Publish update tried to rewrite the locked project address.");
  } finally {
    await settingsGuard.stop();
  }
  await waitForArrayLength(requests, 2);
  const retryResult = requests[1];
  assert(retryResult && retryResult.status >= 200 && retryResult.status < 300,
    "The same-revision retry did not return successfully.");
  assert.equal(retryResult.alreadyPublished, true, "The same-revision retry was not acknowledged as already published.");
  assert.equal(retryResult.releaseId, firstResult.releaseId, "The retry changed immutable release identity.");
  assert.equal(retryResult.scriptName, scriptName, "The retry changed immutable script identity.");
  assert.equal(requests.length, 2, "One idempotency retry should issue exactly one additional control-plane request.");
  const afterRetry = await getRuntime(page, projectId, "releases");
  assert.equal(afterRetry.releases.length, releasesBefore.length, "Same-revision retry created another release row.");
  assert.equal(afterRetry.releases[0].id, releasesBefore[0].id, "Same-revision retry changed the release row.");
  assert.equal(afterRetry.releases[0].commitHash.toLowerCase(), checkpoint.editRevision,
    "The release row is not linked to the edited committed revision.");
  const finalRouteResponse = await fetch(routeCheckUrl, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  requireStatus(finalRouteResponse, 200, "post-retry private route check");
  const finalRoute = await finalRouteResponse.json();
  assert.equal(finalRoute.scriptName, scriptName, "Idempotency retry changed the stable route mapping.");

  checkpoint.stage = "publish-and-same-revision-idempotency-verified";
  await saveCheckpoint(checkpoint);
  report("customer-publish-and-idempotency", {
    publishControlClicks: 2,
    initialPublishRequests: 1,
    idempotencyRetryRequests: 1,
    releaseId: firstResult.releaseId,
    scriptName,
    slug,
    routeUrl: first,
    retryAlreadyPublished: true,
    releaseRowsAfterRetry: afterRetry.releases.length,
    routeStillPointsToSameScript: true,
    gatewayHtmlAndCssVerified: true,
  });
  return { slug, url: first, releaseId: firstResult.releaseId, scriptName };
}

async function continueAcceptance(page, checkpoint, wire, secondCustomerSession) {
  const userId = checkpoint.userId;
  const { projectId, agentId } = await registerProjectThroughDashboard(page, checkpoint, wire);
  checkpoint.projectId = projectId;
  checkpoint.agentId = agentId;

  const initialStatus = await getRuntime(page, projectId, "status");
  const initialPreview = await assertPreviewThroughUi(page, projectId, MARKER);
  await readRenderedFilesInProductUi(page, projectId, MARKER);
  await openEditorFromProjectUi(page, projectId);
  report("initial-authoritative-files-and-preview", {
    projectId,
    revision: checkpoint.initialRevision,
    previewUrl: initialPreview.url,
    previewMarkerVisible: initialPreview.markerVisible,
    runtimePreviewStatePresent: Boolean(initialStatus),
  });

  const edit = await editOnceThroughBuilder(page, checkpoint, wire, projectId);
  const editStatus = await getRuntime(page, projectId, "status");
  const editedPreview = await assertPreviewThroughUi(page, projectId, EDIT_MARKER);
  await readRenderedFilesInProductUi(page, projectId, EDIT_MARKER);
  assert(editStatus.nativeThink === true);
  assert.equal(edit.agentId, agentId);

  const sentBeforeReopen = wire.evidence.sentSuggestions.length;
  await openEditorFromProjectUi(page, projectId);
  const reopened = await ownerSnapshot(page, projectId, agentId);
  assert.equal(reopened.revision, checkpoint.editRevision, "Reopen changed or lost the latest committed revision.");
  assert.equal(wire.evidence.sentSuggestions.length, sentBeforeReopen, "Reopen unexpectedly sent another generation prompt.");
  const reopenedHtml = await getFileContent(page, projectId, "public/index.html");
  assert(reopenedHtml.includes(EDIT_MARKER), "Reopen did not restore the edited authoritative file.");
  const conversation = await getRuntime(page, projectId, "turns");
  const conversationText = JSON.stringify(conversation);
  assert(conversationText.includes(MARKER) && conversationText.includes(EDIT_MARKER),
    "The reopened project did not restore both accepted conversation prompts.");
  const reopenedPreview = await assertPreviewThroughUi(page, projectId, EDIT_MARKER);
  checkpoint.stage = "edit-preview-and-reopen-verified";
  await saveCheckpoint(checkpoint);
  report("edit-and-reopen", {
    projectId,
    agentId,
    initialRevision: checkpoint.initialRevision,
    editedRevision: checkpoint.editRevision,
    changedRevision: edit.revision !== checkpoint.initialRevision,
    reopenedSameAgent: true,
    reopenedSameRevision: true,
    conversationPromptsRestored: true,
    editedFileVisibleInProductUi: true,
    editedPreviewUrl: editedPreview.url,
    reopenedPreviewUrl: reopenedPreview.url,
  });

  const customerB = await isolationThroughSecondCustomer(secondCustomerSession, projectId, agentId);
  checkpoint.secondCustomerId = customerB;
  checkpoint.stage = "second-user-isolation-verified";
  await saveCheckpoint(checkpoint);

  const release = await publishOnceAndRetry(page, checkpoint, projectId);
  checkpoint.slug = release.slug;
  checkpoint.releaseId = release.releaseId;
  checkpoint.scriptName = release.scriptName;
  checkpoint.deploymentUrl = release.url;
  checkpoint.stage = "publish-verified";
  await saveCheckpoint(checkpoint);

  checkpoint.phase = "complete";
  checkpoint.stage = "complete";
  checkpoint.completedAt = new Date().toISOString();
  await saveCheckpoint(checkpoint);
  report("private-task7-ui-acceptance-complete", {
    base: BASE,
    userId,
    projectId,
    agentId,
    initialRevision: checkpoint.initialRevision,
    editedRevision: checkpoint.editRevision,
    initialGenerationSuggestions: wire.evidence.sentSuggestions.filter((item) => item.initialMarker).length,
    editSuggestions: wire.evidence.sentSuggestions.filter((item) => item.editMarker).length,
    streamingFrames: wire.evidence.streamingFrames,
    generationCompleteFrames: wire.evidence.completionFrames,
    releaseId: checkpoint.releaseId,
    scriptName: checkpoint.scriptName,
    slug: checkpoint.slug,
    privateUrl: checkpoint.deploymentUrl,
    checkpointPath: CHECKPOINT,
    checkpointContainsCredentials: false,
    browserSessionLeftAvailableForReplitOff: true,
  });
}

async function runFull() {
  try {
    await readFile(CHECKPOINT, "utf8");
    throw new Error("A Task 7 checkpoint already exists; refusing a second signup, generation, or publish run.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const browser = await launchBrowser();
  const context = browser.defaultBrowserContext();
  const page = await openPage(context);
  const wire = await attachWebSocketEvidence(page);
  const runId = randomUUID();
  const credentials = {
    email: `task7-ui-${runId}@example.invalid`,
    password: randomBytes(32).toString("base64url"),
    name: "Task 7 Disposable Customer",
  };
  const checkpoint = {
    schema: 1,
    phase: "running",
    stage: "signup-not-yet-attempted",
    base: BASE,
    runId,
    createdAt: new Date().toISOString(),
  };
  await saveCheckpoint(checkpoint);
  try {
    const userId = await submitAuth(page, { signup: true, ...credentials });
    checkpoint.userId = userId;
    checkpoint.stage = "signup-verified";
    await saveCheckpoint(checkpoint);
    await maybeSkipOnboarding(page);

    // Separate Puppeteer context proves stock same-user sessions are isolated.
    const sameUserContext = await browser.createBrowserContext();
    const sameUserPage = await openPage(sameUserContext);
    let secondCustomerSession;
    try {
      const secondSessionUserId = await submitAuth(sameUserPage, {
        signup: false,
        name: "",
        email: credentials.email,
        password: credentials.password,
      });
      assert.equal(secondSessionUserId, userId, "Fresh same-user login returned a different identity.");
      secondCustomerSession = await createSecondCustomer(browser, checkpoint);
      const otherUserId = secondCustomerSession.userId;
      assert.notEqual(otherUserId, userId, "Independent disposable customers unexpectedly share an identity.");
      await verifyLogoutAndFreshLogin(secondCustomerSession, otherUserId);
      checkpoint.secondCustomerId = otherUserId;
      checkpoint.stage = "second-customer-auth-lifecycle-verified";
      await saveCheckpoint(checkpoint);

      // Verify logout revocation before continuing with a fresh session in the
      // primary context. The independent browser context remains authenticated.
      const oldCookie = await readOldSessionCookie(page);
      await page.locator('[data-testid="button-logout"]').click();
      await page.waitForFunction(() => location.pathname === "/app/login", { timeout: UI_TIMEOUT });
      const oldSession = await fetch(`${BASE}/api/auth/me`, {
        headers: { Cookie: oldCookie },
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      const oldBody = await oldSession.json().catch(() => null);
      assert([200, 401].includes(oldSession.status));
      assert.equal(oldBody?.id || null, null, "Exact old session cookie was accepted after logout.");
      const independent = await authMe(sameUserPage);
      assert.equal(independent.userId, userId, "Logout invalidated a separate same-user session.");
      const otherCustomer = await authMe(secondCustomerSession.page);
      assert.equal(otherCustomer.userId, otherUserId, "Logout invalidated another customer's independent session.");
      const freshUserId = await submitAuth(page, { signup: false, name: "", email: credentials.email, password: credentials.password });
      assert.equal(freshUserId, userId);
      checkpoint.stage = "auth-login-logout-revocation-and-fresh-login-verified";
      await saveCheckpoint(checkpoint);
      report("auth-through-product-ui", {
        signup: true,
        login: true,
        csrfProjectRequestReady: true,
        exactOldSessionRejected: true,
        freshSessionAccepted: true,
        otherSameUserSessionUnaffected: true,
        otherCustomerSessionUnaffected: true,
        userId,
      });

      await continueAcceptance(page, checkpoint, wire, secondCustomerSession);
    } finally {
      await sameUserContext.close().catch(() => undefined);
      await secondCustomerSession?.context.close().catch(() => undefined);
    }
  } catch (error) {
    checkpoint.phase = "aborted";
    checkpoint.stage = checkpoint.stage || "unknown";
    await saveCheckpoint(checkpoint).catch(() => undefined);
    report("private-task7-ui-acceptance-aborted", {
      stage: checkpoint.stage,
      reason: stageError(error, "Full acceptance"),
      customerDataMayExist: Boolean(checkpoint.userId || checkpoint.projectId || checkpoint.agentId),
      doNotRerunFullPhase: true,
      checkpointContainsCredentials: false,
    });
    process.exitCode = 1;
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function runResume() {
  const checkpoint = await readResumeCheckpoint();
  const browser = await launchBrowser();
  const page = await openPage(browser.defaultBrowserContext());
  const wire = await attachWebSocketEvidence(page);
  let secondCustomerSession;
  try {
    await wire.ready;
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    const identity = await authMe(page);
    requireStatus(identity, 200, "resumed owner session");
    assert.equal(identity.authenticated, true, "The persisted owner browser session is not authenticated.");
    assert.equal(identity.userId, checkpoint.userId, "The persisted browser session does not match the signup-verified customer.");
    await maybeSkipOnboarding(page);

    secondCustomerSession = await createSecondCustomer(browser, checkpoint);
    assert.notEqual(secondCustomerSession.userId, checkpoint.userId,
      "The one disposable second customer unexpectedly shares the owner's identity.");
    await verifyLogoutAndFreshLogin(secondCustomerSession, secondCustomerSession.userId);
    checkpoint.secondCustomerId = secondCustomerSession.userId;
    checkpoint.stage = "second-customer-auth-lifecycle-verified";
    await saveCheckpoint(checkpoint);
    report("resumed-owner-and-second-customer-auth", {
      resumedExistingOwnerSession: true,
      ownerUserId: checkpoint.userId,
      secondCustomerId: checkpoint.secondCustomerId,
      secondCustomerSignupCount: 1,
      secondCustomerLogoutRevokedOldSession: true,
      secondCustomerFreshLoginAccepted: true,
      credentialsPersistedOrLogged: false,
    });

    await continueAcceptance(page, checkpoint, wire, secondCustomerSession);
  } catch (error) {
    checkpoint.phase = "aborted";
    await saveCheckpoint(checkpoint).catch(() => undefined);
    report("private-task7-ui-resume-aborted", {
      stage: checkpoint.stage,
      reason: stageError(error, "Resume"),
      doNotResumeUnlessCheckpointStageIsSignupVerified: true,
      checkpointContainsCredentials: false,
    });
    process.exitCode = 1;
  } finally {
    await secondCustomerSession?.context.close().catch(() => undefined);
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function runReplitOff() {
  const checkpoint = await readCheckpoint();
  const browser = await launchBrowser();
  const page = await openPage(browser.defaultBrowserContext());
  const wire = await attachWebSocketEvidence(page);
  try {
    await wire.ready;
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    const identity = await authMe(page);
    assert.equal(identity.authenticated, true, "No existing private browser session is available for the Replit-off phase.");
    assert.equal(identity.userId, checkpoint.userId, "The existing browser session is not the accepted disposable customer.");
    const dashboard = await api(page, "/api/projects");
    requireStatus(dashboard, 200, "Replit-off dashboard");
    assert(dashboard.body.some((project) => Number(project.id) === checkpoint.projectId), "The accepted project did not reopen from the dashboard.");

    const status = await getRuntime(page, checkpoint.projectId, "status");
    const revision = await getRevision(page, checkpoint.projectId);
    assert.equal(revision, checkpoint.editRevision, "Replit-off reopen did not return the accepted revision.");
    const files = await getFiles(page, checkpoint.projectId);
    const html = await getFileContent(page, checkpoint.projectId, "public/index.html");
    assert(html.includes(EDIT_MARKER), "Replit-off project files lost the accepted edited marker.");
    assert(files.some((file) => file.path === "public/index.html"));
    assert.equal(status.nativeThink, true);
    assert.equal((await getProject(page, checkpoint.projectId)).agentId, checkpoint.agentId);

    await openEditorFromProjectUi(page, checkpoint.projectId);
    const preview = await assertPreviewThroughUi(page, checkpoint.projectId, EDIT_MARKER);
    const requests = monitorPublishRequests(page);
    const releasesBefore = await getRuntime(page, checkpoint.projectId, "releases");
    assert.equal(releasesBefore.releases?.length, 1, "Replit-off phase expected the existing immutable release only.");
    await page.locator('[data-testid="button-open-native-publish"]').click();
    await page.waitForSelector('[data-testid="button-publish-native"]', { visible: true, timeout: UI_TIMEOUT });
    const settingsGuard = await protectLockedPublishingSettings(page);
    try {
      await page.locator('[data-testid="button-publish-native"]').click();
      await page.waitForFunction(() => {
        const content = document.querySelector('[data-testid="native-publish-status"]')?.textContent || "";
        return content.includes("Published") || content.includes("Publish failed");
      }, { timeout: 120_000 });
      assert.equal(settingsGuard.blockedWrites, 0,
        "Replit-off same-revision Publish tried to rewrite the locked project address.");
    } finally {
      await settingsGuard.stop();
    }
    await waitForArrayLength(requests, 1);
    assert.equal(requests.length, 1, "Replit-off idempotency check did not issue exactly one owner Publish retry.");
    assert.equal(requests[0].status >= 200 && requests[0].status < 300, true, "Replit-off publish retry failed.");
    assert.equal(requests[0].alreadyPublished, true, "Replit-off publish retry was not idempotent.");
    assert.equal(requests[0].releaseId, checkpoint.releaseId);
    assert.equal(requests[0].scriptName, checkpoint.scriptName);
    const releasesAfter = await getRuntime(page, checkpoint.projectId, "releases");
    assert.equal(releasesAfter.releases.length, 1, "Replit-off retry created another release.");
    assert.equal(wire.evidence.sentSuggestions.length, 0, "Replit-off phase sent an inference prompt.");
    report("replit-development-off-focused-check", {
      login: true,
      dashboard: true,
      existingProjectReopened: true,
      projectId: checkpoint.projectId,
      agentId: checkpoint.agentId,
      revision,
      authoritativeFiles: true,
      editedPreviewUrl: preview.url,
      sameRevisionPublishIdempotency: true,
      releaseId: checkpoint.releaseId,
      releasesBefore: releasesBefore.releases.length,
      releasesAfter: releasesAfter.releases.length,
      newInferencePrompts: 0,
      browserErrorsExposed: false,
    });
  } catch (error) {
    report("replit-development-off-check-aborted", {
      reason: stageError(error, "Replit-off focused check"),
      newInferencePrompts: wire.evidence.sentSuggestions.length,
    });
    process.exitCode = 1;
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

const releaseLock = await acquireLock();
try {
  if (phase === "full") await runFull();
  else if (phase === "resume") await runResume();
  else await runReplitOff();
} finally {
  await releaseLock();
}