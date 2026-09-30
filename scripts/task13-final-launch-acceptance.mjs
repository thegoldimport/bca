#!/usr/bin/env node

// Separately resumable, one-way customer-journey phases. This runner is
// intentionally live-capable but is never invoked as part of its creation.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasReadableScriptSource, isPreviewAuditRequest, safeObservedUrl } from "./preview-request-scope.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://app.buildcustom.ai";
const CONTROL = "https://buildcustom-control-plane-launch.thegoldimport.workers.dev";
const RUNTIME = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const PRIVATE_DIR = "/tmp/buildcustom-task13-final-acceptance";
const CHECKPOINT = path.join(PRIVATE_DIR, "state.json");
const LOCK = path.join(PRIVATE_DIR, "state.lock");
const PROFILE = path.join(PRIVATE_DIR, "browser-profile");
const RECOVERED_PROFILE = "/tmp/buildcustom-task13-recovered-profile";
const RECOVERY_CHECKPOINT = path.join(ROOT_DIR, "production/vibesdk-launch/task13-project5-recovery-checkpoint.json");
const LAB_PACKAGE = path.join(ROOT_DIR, "lab/bc-vibesdk-lab-20260925/package.json");
const PROMPT = "Build me a simple CRM for a roofing company. I need a dashboard showing total leads, estimates sent, jobs won, and revenue. Add a leads page with customer name, phone, email, project type, lead status, estimated value, and notes. Make it clean and professional.";
const EDIT1_PROMPT = "Change the dashboard to a dark navy theme and add a recent leads section showing the five newest leads.";
const EDIT2_PROMPT = "Add a green New Lead button in the top-right of the leads page.";
const TESTER_EMAIL = "cutover-test@buildcustom.ai";
const TESTER_ID = "3f730b86-bc16-4954-b3fd-db22aea136b7";
const UI_TIMEOUT = 90_000;
const GENERATION_TIMEOUT = 8 * 60_000;
const phase = process.argv[2];
const EXTENDED_PHASES = [
  "signup", "generate", "reconcileGeneration", "preview", "approvedLead",
  "verifyRecoveredForm", "approvedRecoveredLead",
  "edit1", "reopen", "publish1", "publishSame", "edit2", "publishUpdate",
  "returning", "isolation",
];

if (!EXTENDED_PHASES.includes(phase)) {
  throw new Error(`Usage: node scripts/task13-final-launch-acceptance.mjs <${EXTENDED_PHASES.join("|")}>`);
}
if (process.argv.length !== 3) {
  throw new Error(`Pass exactly one phase: ${EXTENDED_PHASES.join(", ")}.`);
}

const puppeteer = createRequire(LAB_PACKAGE)("puppeteer");

function report(stage, evidence = {}) {
  console.log(JSON.stringify({ stage, ...evidence }));
}

function safeError(error) {
  return String(error?.message ?? error ?? "Unknown error")
    .replace(/https?:\/\/[^\s"'<>]+/gi, raw => {
      try {
        const url = new URL(raw.replace(/[),.;]+$/, ""));
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[redacted-url]";
      }
    })
    .replace(/([?&]t=)[^&\s"'<>]+/gi, "$1[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(password|passwd|token|secret|authorization|cookie|csrf)\b["']?(\s*[:=]\s*)["']?([^"'\s,;}]+)/gi,
      "$1$2[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function baseState() {
  return {
    schema: 1,
    base: BASE,
    control: CONTROL,
    runtime: RUNTIME,
    stage: "signup-prepared",
    identity: {
      email: makeMailbox(),
      password: `Qa9!${randomBytes(30).toString("base64url")}`,
      name: "Task 13 Roofing Acceptance",
    },
    userId: null,
    projectId: null,
    agentId: null,
    initialRevision: null,
    generationDurationMs: null,
    promptStartedAt: null,
    leadMarker: `Task13 disposable lead ${randomBytes(8).toString("hex")}`,
    leadOutcome: null,
    actionCounts: { signup: 0, projectStart: 0, initialPrompt: 0, leadSubmit: 0 },
  };
}

function makeMailbox() {
  const template = process.env.TASK13_EMAIL_TEMPLATE;
  assert(typeof template === "string" && template.includes("{tag}"),
    "Set TASK13_EMAIL_TEMPLATE to an accessible mailbox template containing {tag}.");
  const tag = `task13-${Date.now()}-${randomBytes(5).toString("hex")}`;
  const email = template.replaceAll("{tag}", tag).trim().toLowerCase();
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "TASK13_EMAIL_TEMPLATE did not produce a valid email address.");
  assert(!/(?:10minutemail|tempmail\.org|example\.com|example\.net)$/i.test(email.split("@")[1]),
    "Use an accessible non-disposable mailbox template; blocked or example domains are not accepted.");
  return email;
}

async function acquireLock() {
  await mkdir(PRIVATE_DIR, { recursive: true, mode: 0o700 });
  await chmod(PRIVATE_DIR, 0o700);
  const handle = await open(LOCK, "wx", 0o600);
  await handle.close();
  return () => unlink(LOCK).catch(() => undefined);
}

async function saveCheckpoint(state) {
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
    await chmod(PRIVATE_DIR, 0o700);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function saveRecoveredCheckpoint(checkpoint) {
  const temporary = `${RECOVERY_CHECKPOINT}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, RECOVERY_CHECKPOINT);
    await chmod(RECOVERY_CHECKPOINT, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function readCheckpoint({ required = true } = {}) {
  try {
    const info = await import("node:fs/promises").then(({ stat }) => stat(CHECKPOINT));
    assert.equal(info.mode & 0o077, 0, "Checkpoint permissions must remain private (0600).");
    const state = JSON.parse(await readFile(CHECKPOINT, "utf8"));
    assert.equal(state.schema, 1);
    assert.equal(state.base, BASE);
    assert.equal(state.control, CONTROL);
    assert.equal(state.runtime, RUNTIME);
    assert.equal(typeof state.identity?.email, "string");
    assert.equal(typeof state.identity?.password, "string");
    assert(state.actionCounts && Object.values(state.actionCounts).every(value => Number.isInteger(value) && value >= 0 && value <= 1),
      "Checkpoint action counters exceed one; refusing to continue.");
    assert.equal(state.actionCounts.signup <= 1, true);
    assert.equal(state.actionCounts.projectStart <= 1, true);
    assert.equal(state.actionCounts.initialPrompt <= 1, true);
    assert.equal(state.actionCounts.leadSubmit <= 1, true);
    return state;
  } catch (error) {
    if (!required && error?.code === "ENOENT") return null;
    throw new Error(`Checkpoint is unavailable, unsafe, or invalid: ${safeError(error)}`);
  }
}

// The owner-only stock database inspector reads the same branch-specific App
// Facet as the generated preview. Never use a preview capability for this.
async function authoritativeLeadRows(page, state) {
  const cookies = (await page.cookies(BASE))
    .filter(cookie => ["accessToken", "csrf-token"].includes(cookie.name))
    .map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
  assert(cookies.includes("accessToken="), "Owner session is unavailable for the read-only database check.");
  const url = new URL(`/api/agent/${state.agentId}/db/query`, RUNTIME);
  for (const [key, value] of Object.entries({
    branch: "main", table: "leads", limit: "100", offset: "0", orderBy: "id", orderDir: "asc",
  })) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: "GET", headers: { Accept: "application/json", Cookie: cookies },
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, "Owner-only database inspector was unavailable.");
  const body = await response.json();
  assert.equal(body?.success, true, "Owner-only database inspection failed.");
  assert.equal(body?.data?.branch, "main");
  assert.equal(body?.data?.table, "leads");
  const rows = body.data.rows;
  assert(Array.isArray(rows) && rows.length === body.data.totalCount,
    "Authoritative database result was incomplete; do not mutate.");
  return rows;
}

function assertApprovedLeadBaseline(rows, state) {
  const ids = rows.map(row => Number(row.id)).sort((a, b) => a - b);
  assert.equal(rows.length, 12, "Lead baseline changed; stop without submitting.");
  assert.deepEqual(ids, Array.from({ length: 12 }, (_, index) => index + 1),
    "Lead IDs differ from the verified seed-only baseline; stop without submitting.");
  assert(!rows.some(row => Object.values(row).some(value => value === state.leadMarker)),
    "The marker already exists in the authoritative database.");
  return { count: rows.length, highestId: ids.at(-1), ids };
}

async function launchBrowser(profile = PROFILE) {
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await chmod(profile, 0o700);
  return puppeteer.launch({
    executablePath: "/repl/tools/bin/chromium",
    headless: true,
    userDataDir: profile,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

async function browserApi(page, pathname) {
  assert(pathname.startsWith("/") && !pathname.startsWith("//"), "Refusing a non-local product API path.");
  return page.evaluate(async route => {
    const response = await fetch(route, { credentials: "same-origin", cache: "no-store" });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }, pathname);
}

async function apiGet(page, pathname, stage) {
  const result = await browserApi(page, pathname);
  assert.equal(result.status, 200, `${stage} returned HTTP ${result.status}.`);
  return result.body;
}

async function authMe(page) {
  const result = await browserApi(page, "/api/auth/me");
  const userId = result.body?.id;
  return { status: result.status, userId: userId == null ? null : String(userId) };
}

async function clearProductSession(page) {
  const cookies = await page.cookies(BASE);
  if (cookies.length) await page.deleteCookie(...cookies);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  }).catch(() => undefined);
}

async function loginNormally(page, state) {
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  const existing = await authMe(page);
  if (state.userId && existing.status === 200 && existing.userId === state.userId) {
    return existing;
  }
  await clearProductSession(page);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="input-email"]').fill(state.identity.email);
  await page.locator('[data-testid="input-password"]').fill(state.identity.password);
  await page.locator('[data-testid="button-submit"]').click();
  await page.waitForFunction(() => location.pathname === "/app" || location.pathname === "/app/", { timeout: UI_TIMEOUT });
  const identity = await authMe(page);
  assert.equal(identity.status, 200, "Normal UI login did not establish a customer session.");
  if (state.userId) {
    assert.equal(identity.userId, state.userId, "Login resolved to a different customer than the saved checkpoint.");
  }
  return identity;
}

async function ensureIdentity(page, state) {
  if (!page.url().startsWith(BASE)) {
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  }
  const current = await authMe(page);
  if (current.status === 200 && current.userId === state.userId) return current;
  return loginNormally(page, state);
}

async function readSignupCapabilities() {
  const [productResponse, runtimeResponse] = await Promise.all([
    fetch(`${BASE}/api/public/capabilities`, { cache: "no-store", signal: AbortSignal.timeout(15_000) }),
    fetch(`${RUNTIME}/api/auth/providers`, { cache: "no-store", signal: AbortSignal.timeout(15_000) }),
  ]);
  const product = await productResponse.json().catch(() => null);
  const runtime = await runtimeResponse.json().catch(() => null);
  assert.equal(productResponse.status, 200, "Product signup capability request failed.");
  assert.equal(product?.registrationEnabled, true, "Public product signup is closed.");
  assert.equal(runtimeResponse.status, 200, "Runtime email-provider capability request failed.");
  // Product registration forwards through the runtime service binding and
  // still requires the runtime registration gate to be open.
  assert.equal(runtime?.data?.registrationEnabled, true,
    "Runtime registration is closed even though the product advertises signup.");
  assert(runtime?.data?.providers?.email === true || runtime?.data?.email === true,
    "Runtime email/password authentication is unavailable.");
  return { productRegistrationEnabled: true, runtimeEmailEnabled: true };
}

async function signupPhase() {
  let state = await readCheckpoint({ required: false });
  const newCheckpoint = state === null;
  if (newCheckpoint) {
    state = baseState();
    await saveCheckpoint(state);
  }
  assert(["signup-prepared", "signup-submit-pending", "signup-complete"].includes(state.stage),
    `Signup phase cannot continue from checkpoint stage ${state.stage}.`);

  let browser;
  try {
    const capability = await readSignupCapabilities();
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(UI_TIMEOUT);
    page.setDefaultNavigationTimeout(UI_TIMEOUT);

    if (state.stage === "signup-submit-pending") {
      // A prior submit may have succeeded. Reconcile only by normal login;
      // never issue a second registration POST.
      try {
        const identity = await loginNormally(page, state);
        state.userId = String(identity.userId);
      } catch {
        state.stage = "signup-outcome-uncertain";
        await saveCheckpoint(state);
        throw new Error("Signup outcome is uncertain; login did not reconcile it, and registration will not be retried.");
      }
      state.stage = "signup-complete";
      const dashboard = await apiGet(page, "/api/projects", "Owner dashboard project list");
      assert.equal(projectsArray(dashboard).length, 0, "A newly signed-up customer unexpectedly owns a project.");
      await saveCheckpoint(state);
      report("signup-reconciled", { userId: state.userId, email: state.identity.email });
      return;
    }

    if (state.stage === "signup-complete") {
      await ensureIdentity(page, state);
      report("signup-already-verified", { userId: state.userId, email: state.identity.email });
      return;
    }

    assert.equal(newCheckpoint || state.actionCounts.signup === 0, true,
      "Signup action was already attempted; refusing a second registration.");
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    await clearProductSession(page);
    await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" });
    assert.equal(new URL(page.url()).pathname, "/signup", "Signup UI did not stay on the exact /signup route.");
    await page.waitForSelector('[data-testid="button-submit"]', { visible: true, timeout: UI_TIMEOUT });
    await page.locator('[data-testid="input-name"]').fill(state.identity.name);
    await page.locator('[data-testid="input-email"]').fill(state.identity.email);
    await page.locator('[data-testid="input-password"]').fill(state.identity.password);
    const submitResponse = page.waitForResponse(response =>
      new URL(response.url()).origin === BASE
      && new URL(response.url()).pathname === "/api/auth/register"
      && response.request().method() === "POST", { timeout: 30_000 });
    state.stage = "signup-submit-pending";
    state.actionCounts.signup = 1;
    await saveCheckpoint(state);
    await page.locator('[data-testid="button-submit"]').click();
    const response = await submitResponse;
    if (response.status() < 200 || response.status() >= 300) {
      state.stage = "signup-failed";
      await saveCheckpoint(state);
      throw new Error(`Normal UI signup returned HTTP ${response.status()}; stopping without retry.`);
    }
    await page.waitForFunction(() => location.pathname === "/app" || location.pathname === "/app/", { timeout: UI_TIMEOUT });
    const identity = await authMe(page);
    assert.equal(identity.status, 200, "Signup POST succeeded but the normal product session is unavailable.");
    assert(identity.userId, "Product session did not identify the new customer.");
    state.userId = String(identity.userId);
    state.stage = "signup-complete";
    const dashboard = await apiGet(page, "/api/projects", "New-customer dashboard");
    assert.equal(projectsArray(dashboard).length, 0, "New customer dashboard is not empty.");
    await saveCheckpoint(state);
    report("signup-complete", { ...capability, userId: state.userId, email: state.identity.email, projectCount: 0 });
  } catch (error) {
    report("signup-failed", { error: safeError(error), checkpointPath: CHECKPOINT });
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

function projectsArray(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.projects)) return body.projects;
  if (Array.isArray(body?.data?.projects)) return body.data.projects;
  return null;
}

function findStrings(value, output = [], depth = 0) {
  if (depth > 14 || value == null) return output;
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) findStrings(item, output, depth + 1);
  } else if (typeof value === "object") {
    for (const nested of Object.values(value)) findStrings(nested, output, depth + 1);
  }
  return output;
}

async function runtimeGet(page, projectId, operation) {
  return apiGet(page, `/api/projects/${projectId}/runtime/${operation}`, `Runtime ${operation}`);
}

async function openEditor(page, projectId) {
  if (new URL(page.url()).pathname !== `/app/editor/${projectId}`) {
    await page.goto(`${BASE}/app/project/${projectId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="button-header-open-builder"]', { visible: true, timeout: UI_TIMEOUT });
    await page.locator('[data-testid="button-header-open-builder"]').click();
    await page.waitForFunction(id => location.pathname === `/app/editor/${id}`, { timeout: UI_TIMEOUT }, projectId);
  }
  await page.waitForSelector('[data-testid="button-open-native-publish"]', { visible: true, timeout: UI_TIMEOUT });
}

async function resolveProject(page, state, startingStage) {
  report("generate-step", { at: "project-list-read" });
  let projects = projectsArray(await apiGet(page, "/api/projects", "Owner dashboard project list"));
  assert(projects, "Owner dashboard project response is not a project array.");
  if (startingStage === "signup-complete") {
    assert.equal(projects.length, 0, "Dashboard is not empty; refusing to create a second customer project.");
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    report("generate-step", { at: "dashboard-loaded" });
    const skip = await page.$('[data-testid="button-skip-onboarding"]');
    if (skip) await skip.click({ timeout: 2_000 }).catch(() => undefined);
    const input = page.locator('[data-testid="input-new-project-prompt"]');
    await input.fill("");
    await input.click();
    // Real key events keep the controlled React state in sync with the DOM.
    await page.keyboard.type(PROMPT, { delay: 2 });
    report("generate-step", {
      at: "prompt-entered",
      ...(await page.evaluate(expected => {
        const input = document.querySelector('[data-testid="input-new-project-prompt"]');
        const button = document.querySelector('[data-testid="button-start-project"]');
        return { exact: input?.value === expected, enabled: button instanceof HTMLButtonElement && !button.disabled };
      }, PROMPT)),
    });
    await page.waitForFunction(expected => {
      const field = document.querySelector('[data-testid="input-new-project-prompt"]');
      const button = document.querySelector('[data-testid="button-start-project"]');
      return field?.value === expected && button instanceof HTMLButtonElement && !button.disabled;
    }, { timeout: UI_TIMEOUT }, PROMPT);
    state.stage = "project-start-pending";
    state.actionCounts.projectStart = 1;
    state.actionCounts.initialPrompt = 1;
    state.promptStartedAt = Date.now();
    await saveCheckpoint(state);
    await page.locator('[data-testid="button-start-project"]').click();
    const routeReady = await page.waitForFunction(() =>
      /^\/app\/(?:project|editor)\/\d+$/.test(location.pathname), { timeout: UI_TIMEOUT })
      .then(() => true).catch(() => false);
    if (!routeReady) {
      state.stage = "project-start-outcome-uncertain";
      await saveCheckpoint(state);
      throw new Error("Project-start outcome is uncertain; no retry was made.");
    }
    const id = Number(new URL(page.url()).pathname.match(/\/(\d+)$/)?.[1]);
    assert(Number.isSafeInteger(id) && id > 0, "The UI did not navigate to a valid new project.");
    state.projectId = id;
    state.stage = "project-created";
    await saveCheckpoint(state);
    return id;
  }

  // Pending project creation is resolved from the owner's project list. It is
  // never repeated, even when no project appears.
  if (startingStage === "project-start-pending") {
    if (projects.length !== 1) {
      state.stage = "project-start-outcome-uncertain";
      await saveCheckpoint(state);
      throw new Error("Project-start outcome is uncertain; expected exactly one owner project and will not retry.");
    }
    state.projectId = Number(projects[0]?.id);
    assert(Number.isSafeInteger(state.projectId) && state.projectId > 0);
    state.stage = "project-created";
    await saveCheckpoint(state);
  } else {
    assert.equal(projects.length, 1, "Expected exactly one customer project.");
    assert.equal(String(projects[0]?.id), String(state.projectId));
  }
  return state.projectId;
}

async function waitForGeneration(page, projectId, state) {
  const deadline = Date.now() + GENERATION_TIMEOUT;
  let exactPromptCount = 0;
  let uiState = null;
  while (Date.now() < deadline) {
    const turns = await runtimeGet(page, projectId, "turns");
    exactPromptCount = findStrings(turns).filter(value => value === PROMPT).length;
    assert(exactPromptCount <= 1, "Conversation contains duplicate copies of the exact requested prompt.");
    if (exactPromptCount === 1) break;
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  if (exactPromptCount !== 1) {
    state.stage = "generation-outcome-uncertain";
    await saveCheckpoint(state);
    throw new Error("The exact initial prompt is not authoritatively present; refusing any replacement generation.");
  }

  await page.waitForFunction(() => {
    const current = document.querySelector('[data-testid="native-completion-state"]')?.getAttribute("data-state");
    return current === "success" || current === "error";
  }, { timeout: GENERATION_TIMEOUT });
  uiState = await page.$eval('[data-testid="native-completion-state"]', element => ({
    state: element.getAttribute("data-state"),
    text: (element.textContent || "").slice(0, 200),
  }));
  assert.equal(uiState.state, "success", `Native UI generation failed: ${uiState.text || "no success state"}`);

  const project = await apiGet(page, `/api/projects/${projectId}`, "Owner project");
  const status = await runtimeGet(page, projectId, "status");
  assert.equal(status.nativeThink, true, "Generated project is not attached to native Think.");
  const revisionBody = await runtimeGet(page, projectId, "revision");
  const revision = revisionBody?.commitHash || revisionBody?.revision?.commitHash;
  assert.match(revision || "", /^[a-f0-9]{40}$/i, "Generation did not produce an authoritative committed revision.");
  state.agentId = String(project.agentId || status.agentId || "");
  assert(state.agentId, "Generated project has no linked runtime agent.");
  state.initialRevision = revision.toLowerCase();
  state.generationDurationMs = state.promptStartedAt ? Date.now() - state.promptStartedAt : null;
  state.stage = "generation-verified";
  await saveCheckpoint(state);
  return { agentId: state.agentId, revision: state.initialRevision, durationMs: state.generationDurationMs };
}

async function generatePhase() {
  const state = await readCheckpoint();
  assert(["signup-complete", "project-start-pending", "project-created", "generation-prompt-pending", "generation-verified"].includes(state.stage),
    "Run signup phase first; uncertain/failure checkpoints are intentionally non-resumable.");
  let browser;
  const startingStage = state.stage;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(UI_TIMEOUT);
    page.setDefaultNavigationTimeout(UI_TIMEOUT);
    report("generate-step", { at: "browser-ready" });
    await ensureIdentity(page, state);
    report("generate-step", { at: "identity-ready" });
    const projectId = await resolveProject(page, state, startingStage);
    assert.equal(state.actionCounts.projectStart, 1);
    assert.equal(state.actionCounts.initialPrompt, 1);
    if (state.stage === "generation-verified") {
      report("generation-already-verified", {
        userId: state.userId, projectId, agentId: state.agentId,
        revision: state.initialRevision, generationDurationMs: state.generationDurationMs,
      });
      return;
    }
    await openEditor(page, projectId);
    const generation = await waitForGeneration(page, projectId, state);
    const projects = projectsArray(await apiGet(page, "/api/projects", "Final owner project list"));
    assert.equal(projects?.length, 1, "Expected exactly one customer project after generation.");
    assert.equal(String(projects[0]?.id), String(projectId));
    report("generation-verified", {
      userId: state.userId, projectId, agentId: generation.agentId,
      revision: generation.revision, generationDurationMs: generation.durationMs,
      exactPromptCopies: 1, nativeUiState: "success",
    });
  } catch (error) {
    if (state.stage === "generation-prompt-pending" || state.stage === "project-created") {
      state.stage = "generation-failed";
      await saveCheckpoint(state);
    }
    report("generation-failed", { error: safeError(error), checkpointPath: CHECKPOINT });
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function reconcileGenerationPhase() {
  const state = await readCheckpoint();
  assert.equal(state.stage, "generation-failed", "Only a stopped generation wait can be reconciled.");
  assert.equal(state.actionCounts.projectStart, 1);
  assert.equal(state.actionCounts.initialPrompt, 1);
  assert(Number.isSafeInteger(state.projectId) && state.projectId > 0);
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await ensureIdentity(page, state);
    const projects = projectsArray(await apiGet(page, "/api/projects", "Owner projects"));
    assert.equal(projects?.length, 1, "Generation reconciliation expected one owner project.");
    assert.equal(String(projects[0]?.id), String(state.projectId));
    const project = await apiGet(page, `/api/projects/${state.projectId}`, "Owner project");
    const [turnData, status, revisionData, fileData] = await Promise.all([
      runtimeGet(page, state.projectId, "turns"),
      runtimeGet(page, state.projectId, "status"),
      runtimeGet(page, state.projectId, "revision"),
      runtimeGet(page, state.projectId, "files"),
    ]);
    const turns = turnData?.turns;
    assert(Array.isArray(turns) && turns.length === 1 && turns[0].prompt === PROMPT,
      "The initial prompt was not persisted exactly once.");
    assert(typeof turns[0].response === "string" && turns[0].response.length > 100,
      "Native Think has not persisted a complete response.");
    assert.equal(status.nativeThink, true);
    assert.equal(status.runtimeStatus, "ready");
    assert.equal(status.state?.shouldBeGenerating, false);
    assert.equal(status.state?.generation?.status, "idle");
    const files = Array.isArray(fileData) ? fileData : fileData?.files;
    assert(Array.isArray(files) && files.some(file => file.path === "public/app.jsx")
      && files.some(file => file.path === "public/index.html"),
    "The generated CRM source files are missing.");
    const source = await apiGet(page,
      `/api/projects/${state.projectId}/runtime/files/content?path=public%2Fapp.jsx`,
      "Generated CRM source");
    assert(typeof source?.content === "string" && source.content.length > 1000
      && /roof/i.test(source.content) && /lead/i.test(source.content),
    "The generated CRM source is not the requested roofing/leads app.");
    const revision = revisionData?.commitHash || revisionData?.revision?.commitHash;
    assert.match(revision || "", /^[a-f0-9]{40}$/i);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const second = await runtimeGet(page, state.projectId, "revision");
    assert.equal(second?.commitHash || second?.revision?.commitHash, revision,
      "The generation revision is not stable.");
    assert(typeof project?.agentId === "string" && project.agentId,
      "The owner project is missing its native Think agent.");
    state.agentId = project.agentId;
    state.initialRevision = revision.toLowerCase();
    state.generationObservationUpperBoundMs = Date.now() - state.promptStartedAt;
    state.generationStreamObserved = false;
    state.stage = "generation-verified";
    await saveCheckpoint(state);
    report("generation-reconciled", {
      projectId: state.projectId, agentId: state.agentId, revision: state.initialRevision,
      fileCount: files.length, exactPromptCopies: 1, nativeResponsePersisted: true,
      generationIdle: true, streamObserved: false,
      durationUpperBoundMs: state.generationObservationUpperBoundMs,
    });
  } finally {
    if (browser) await browser.close();
  }
}

function attachPreviewRequestAudit(page, expectedPreviewUrl) {
  const requests = [];
  const failed = [];
  const corsErrors = [];
  const platformTelemetryErrors = [];
  const parentPageHttpErrors = [];
  const requestsByObject = new WeakMap();
  const parentRequestsByObject = new WeakMap();
  let nextRequestId = 0;
  const expectedOrigin = new URL(expectedPreviewUrl, BASE).origin;
  page.on("request", request => {
    try {
      const url = new URL(request.url());
      // Cloudflare's RUM beacon is platform telemetry, not a generated-app
      // resource. Its optional preflight can return 404 on the product route.
      if (url.pathname.startsWith("/cdn-cgi/rum")) return;
      let initiatorFrameUrl = "";
      try { initiatorFrameUrl = request.frame()?.url() || ""; } catch { /* Detached frame. */ }
      const redirectChain = request.redirectChain();
      const redirectedFromPreview = redirectChain.some(previous => requestsByObject.has(previous));
      if (!redirectedFromPreview
        && !isPreviewAuditRequest(expectedPreviewUrl, request.url(), initiatorFrameUrl)) {
        if (url.origin === expectedOrigin && initiatorFrameUrl) {
          parentRequestsByObject.set(request, {
            method: request.method(), path: url.pathname,
            initiatorPath: new URL(initiatorFrameUrl).pathname,
          });
        }
        return;
      }
      const headers = request.headers();
      const item = {
        requestId: ++nextRequestId,
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
        redirectSourceUrls: redirectChain.map(previous => previous.url()),
        initiatorFrameUrl,
        headerNames: Object.keys(headers).map(name => name.toLowerCase()),
        headers: {
          origin: headers.origin || null,
          contentType: headers["content-type"] || null,
          accessControlRequestMethod: headers["access-control-request-method"] || null,
          accessControlRequestHeaders: headers["access-control-request-headers"] || null,
        },
        ...(request.postData() ? { bodyText: request.postData().slice(0, 100_000) } : {}),
      };
      requests.push(item);
      requestsByObject.set(request, item);
    } catch { /* Ignore non-HTTP browser-internal URLs. */ }
  });
  page.on("requestfailed", request => {
    try {
      const url = new URL(request.url());
      const item = requestsByObject.get(request);
      if (!item) return;
      if (url.pathname.startsWith("/cdn-cgi/rum")) return;
      const failure = request.failure()?.errorText || "request failed";
      failed.push({
        requestId: item?.requestId ?? null, method: request.method(), resourceType: request.resourceType(),
        url: request.url(), failure,
      });
      if (/cors|cross.?origin|access.?control|failed to fetch/i.test(failure)) {
        corsErrors.push({ requestId: item?.requestId ?? null, resourceType: request.resourceType(), failure });
      }
    } catch { /* Ignore non-HTTP browser-internal URLs. */ }
  });
  page.on("response", response => {
    try {
      const url = new URL(response.url());
      const found = requestsByObject.get(response.request());
      const parent = parentRequestsByObject.get(response.request());
      if (parent && response.status() >= 400) {
        parentPageHttpErrors.push({ ...parent, status: response.status() });
      }
      if (found) {
        const headers = response.headers();
        found.status = response.status();
        found.responseHeaders = {
          contentType: headers["content-type"] || null,
          accessControlAllowOrigin: headers["access-control-allow-origin"] || null,
          accessControlAllowMethods: headers["access-control-allow-methods"] || null,
          accessControlAllowHeaders: headers["access-control-allow-headers"] || null,
        };
        if (found.method === "POST" && url.pathname.endsWith("/api/leads")) {
          void response.text().then(text => {
            found.leadResponseBody = redactedLeadFields(text);
            found.responseBodyReadable = true;
          }).catch(() => { found.responseBodyReadable = false; });
        }
        if (response.status() >= 200 && response.status() < 400
          && ["document", "stylesheet", "script", "fetch", "xhr"].includes(found.resourceType)
          && !(found.method === "POST" && url.pathname.endsWith("/api/leads"))) {
          void response.text().then(text => {
            found.responseBodyReadable = true;
            found.responseBodyLength = text.length;
          }).catch(() => { found.responseBodyReadable = false; });
        }
      }
      if (url.pathname.startsWith("/cdn-cgi/rum")) return;
    } catch { /* Ignore non-HTTP browser-internal URLs. */ }
  });
  page.on("console", message => {
    if (message.type() === "error" && /cors|cross.?origin|access.?control|failed to fetch/i.test(message.text())) {
      const failure = safeError(message.text());
      if (message.text().includes("/cdn-cgi/rum")) platformTelemetryErrors.push(failure);
      else corsErrors.push({ requestId: null, resourceType: "console", failure });
    }
  });
  page.on("pageerror", error => {
    const text = String(error?.message || error || "page error");
    if (/cors|cross.?origin|access.?control|failed to fetch/i.test(text)) {
      const failure = safeError(text);
      if (text.includes("/cdn-cgi/rum")) platformTelemetryErrors.push(failure);
      else corsErrors.push({ requestId: null, resourceType: "page", failure });
    }
  });
  return { requests, failed, corsErrors, parentPageHttpErrors, platformTelemetryErrors, previewUrl: expectedPreviewUrl };
}

function attachPreviewAudit(page, expectedPreviewUrl = null) {
  const requests = [];
  const failed = [];
  const corsErrors = [];
  const requestsByObject = new WeakMap();
  let nextRequestId = 0;
  const expectedOrigin = expectedPreviewUrl ? new URL(expectedPreviewUrl, BASE).origin : null;
  page.on("request", request => {
    try {
      const url = new URL(request.url());
      let initiatorFrameUrl = "";
      try { initiatorFrameUrl = request.frame()?.url() || ""; } catch { /* Detached frame. */ }
      let initiatorOrigin = "";
      try { initiatorOrigin = new URL(initiatorFrameUrl).origin; } catch { /* Worker request. */ }
      if (url.origin !== expectedOrigin && initiatorOrigin !== expectedOrigin
        && !url.hostname.endsWith("apps.buildcustom.ai") && !url.hostname.includes("preview")) return;
      const headers = request.headers();
      const item = {
        requestId: ++nextRequestId,
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
        initiatorFrameUrl,
        headerNames: Object.keys(headers).map(name => name.toLowerCase()),
        headers: {
          origin: headers.origin || null,
          contentType: headers["content-type"] || null,
          accessControlRequestMethod: headers["access-control-request-method"] || null,
          accessControlRequestHeaders: headers["access-control-request-headers"] || null,
        },
        ...(request.postData() ? { bodyText: request.postData().slice(0, 20_000) } : {}),
      };
      requests.push(item);
      requestsByObject.set(request, item);
    } catch { /* Ignore non-HTTP browser-internal URLs. */ }
  });
  page.on("requestfailed", request => {
    try {
      const url = new URL(request.url());
      const item = requestsByObject.get(request);
      if (!item && url.origin !== expectedOrigin && !url.hostname.endsWith("apps.buildcustom.ai")
        && !url.hostname.includes("preview")) return;
      if (url.pathname.startsWith("/cdn-cgi/rum")) return;
      const failure = request.failure()?.errorText || "request failed";
      failed.push({
        requestId: item?.requestId ?? null, method: request.method(), resourceType: request.resourceType(),
        url: request.url(), failure,
      });
      if (/cors|cross.?origin|access.?control|failed to fetch/i.test(failure)) {
        corsErrors.push({ requestId: item?.requestId ?? null, resourceType: request.resourceType(), failure });
      }
    } catch { /* Ignore non-HTTP browser-internal URLs. */ }
  });
  page.on("response", response => {
    try {
      const url = new URL(response.url());
      const found = requestsByObject.get(response.request());
      if (found) {
        const headers = response.headers();
        found.status = response.status();
        found.responseHeaders = {
          contentType: headers["content-type"] || null,
          accessControlAllowOrigin: headers["access-control-allow-origin"] || null,
          accessControlAllowMethods: headers["access-control-allow-methods"] || null,
          accessControlAllowHeaders: headers["access-control-allow-headers"] || null,
        };
        if (response.status() >= 200 && response.status() < 400
          && ["document", "stylesheet", "script", "fetch", "xhr"].includes(found.resourceType)) {
          void response.text().then(text => {
            found.responseBodyReadable = true;
            found.responseBodyLength = text.length;
          }).catch(() => { found.responseBodyReadable = false; });
        }
      }
      if (url.pathname.startsWith("/cdn-cgi/rum")) return;
    } catch { /* Ignore non-HTTP browser-internal URLs. */ }
  });
  page.on("console", message => {
    if (message.type() === "error" && /cors|cross.?origin|access.?control|failed to fetch/i.test(message.text())) {
      corsErrors.push({ requestId: null, resourceType: "console", failure: message.text().slice(0, 300) });
    }
  });
  page.on("pageerror", error => {
    const text = String(error?.message || error || "page error");
    if (/cors|cross.?origin|access.?control|failed to fetch/i.test(text)) {
      corsErrors.push({ requestId: null, resourceType: "page", failure: text.slice(0, 300) });
    }
  });
  return { requests, failed, corsErrors };
}

async function previewFrame(page, previewUrl) {
  const expected = new URL(previewUrl, BASE);
  assert.equal(expected.protocol, "https:", "Runtime preview URL must use HTTPS.");
  const deadline = Date.now() + 60_000;
  let found;
  while (Date.now() < deadline) {
    found = page.frames().find(frame => {
      try {
        const actual = new URL(frame.url());
        return actual.origin === expected.origin
          && (actual.pathname === expected.pathname
            || actual.pathname.startsWith(`${expected.pathname.replace(/\/$/, "")}/`));
      } catch {
        return false;
      }
    });
    if (found) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(found, "BuildCustom preview UI did not load the runtime preview iframe.");
  await found.waitForFunction(() => document.readyState === "interactive" || document.readyState === "complete",
    { timeout: 45_000 });
  return found;
}

async function renderedPreviewWithAppliedStyles(page, frame) {
  const rendered = await frame.evaluate(async () => {
    const visible = element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const candidates = [...document.querySelectorAll("main,h1,h2,header,button,[role=heading],body,section,nav,table,input")]
      .filter(visible).slice(0, 12);
    const snapshot = element => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(), display: style.display, fontFamily: style.fontFamily,
        fontSize: style.fontSize, color: style.color, backgroundColor: style.backgroundColor,
        width: Math.round(box.width), height: Math.round(box.height),
      };
    };
    const computedStyles = candidates.slice(0, 5).map(snapshot);
    const sheets = [...document.styleSheets];
    const priorDisabled = sheets.map(sheet => sheet.disabled);
    let stylesheetApplied = false;
    try {
      for (const sheet of sheets) {
        try { sheet.disabled = true; } catch { /* Cross-origin rules remain unreadable, but disabled is best-effort. */ }
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      stylesheetApplied = candidates.some((element, index) => {
        const withoutSheets = snapshot(element);
        return ["display", "fontFamily", "fontSize", "color", "backgroundColor"]
          .some(key => withoutSheets[key] !== computedStyles[index]?.[key]);
      });
    } finally {
      sheets.forEach((sheet, index) => {
        try { sheet.disabled = priorDisabled[index]; } catch { /* Preserve the original rendering if a sheet is detached. */ }
      });
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    let inlineStyleApplied = false;
    const inlineCandidate = candidates.find(element => element.hasAttribute("style"));
    if (inlineCandidate) {
      const inlineValue = inlineCandidate.getAttribute("style");
      const before = snapshot(inlineCandidate);
      inlineCandidate.removeAttribute("style");
      await new Promise(resolve => requestAnimationFrame(resolve));
      const after = snapshot(inlineCandidate);
      inlineStyleApplied = ["display", "fontFamily", "fontSize", "color", "backgroundColor"]
        .some(key => before[key] !== after[key]);
      inlineCandidate.setAttribute("style", inlineValue);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return {
      text: document.body?.innerText?.trim() || "",
      title: document.title || "",
      htmlLength: document.documentElement?.outerHTML?.length || 0,
      stylesheets: sheets.length,
      loadedStylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')].filter(link => Boolean(link.sheet)).length,
      stylesheetUrls: [...document.querySelectorAll('link[rel="stylesheet"]')]
        .filter(link => Boolean(link.sheet)).map(link => link.href),
      inlineStylesheets: [...document.querySelectorAll("style")].filter(node => (node.textContent || "").trim()).length,
      scripts: [...document.scripts].length,
      externalScripts: [...document.scripts].filter(script => Boolean(script.src)).length,
      scriptUrls: [...document.scripts].filter(script => Boolean(script.src)).map(script => script.src),
      inlineScripts: [...document.scripts].filter(script => !script.src && (script.textContent || "").trim()).length,
      computedStyles,
      stylesheetApplied,
      inlineStyleApplied,
      appError: /application error|failed to load|something went wrong/i.test(document.body?.innerText || ""),
    };
  });
  assert(rendered.htmlLength > 500, "Preview returned an empty or truncated document.");
  assert(rendered.text.length > 0, "Preview rendered no visible application content.");
  assert.equal(rendered.appError, false, "Preview displays an application error.");
  assert(rendered.computedStyles.length > 0 && rendered.computedStyles.some(item =>
    item.display && item.fontFamily && item.fontSize && item.width > 0 && item.height > 0),
  "Preview did not produce computed-style/layout evidence for visible application elements.");
  assert(rendered.stylesheetApplied || rendered.inlineStyleApplied,
    "Computed styles were present, but disabling/removing authored styles did not change visible-element CSS.");
  return rendered;
}

async function renderedPreview(page, frame) {
  const rendered = await frame.evaluate(() => ({
    text: document.body?.innerText?.trim() || "",
    title: document.title || "",
    htmlLength: document.documentElement?.outerHTML?.length || 0,
    stylesheets: [...document.styleSheets].length,
    loadedStylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')].filter(link => Boolean(link.sheet)).length,
    inlineStylesheets: [...document.querySelectorAll("style")].filter(node => (node.textContent || "").trim()).length,
    scripts: [...document.scripts].length,
    externalScripts: [...document.scripts].filter(script => Boolean(script.src)).length,
    inlineScripts: [...document.scripts].filter(script => !script.src && (script.textContent || "").trim()).length,
    computedStyles: (() => {
      const candidates = [...document.querySelectorAll("main,h1,h2,header,button,[role=heading],body")]
        .filter(element => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        });
      return candidates.slice(0, 5).map(element => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          display: style.display,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          color: style.color,
          backgroundColor: style.backgroundColor,
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      });
    })(),
    appError: /application error|failed to load|something went wrong/i.test(document.body?.innerText || ""),
  }));
  assert(rendered.htmlLength > 500, "Preview returned an empty or truncated document.");
  assert(rendered.text.length > 0, "Preview rendered no visible application content.");
  assert.equal(rendered.appError, false, "Preview displays an application error.");
  assert(rendered.computedStyles.length > 0 && rendered.computedStyles.some(item =>
    item.display && item.fontFamily && item.fontSize && item.width > 0 && item.height > 0),
  "Preview did not produce computed-style/layout evidence for visible application elements.");
  return rendered;
}

function isDynamicRequestUrl(value) {
  try {
    const url = new URL(value);
    return /\/(?:\d+|[a-f0-9]{8}-[a-f0-9-]{27}|[a-f0-9]{16,})(?:\/|$)/i.test(url.pathname)
      || [...url.searchParams.values()].some(item => /^\d{2,}$/.test(item)
        || /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(item));
  } catch { return false; }
}

function previewRequestEvidence(audit) {
  const requests = audit.requests.filter(item => item.resourceType !== "other");
  const queryBearing = requests.filter(item => {
    try { return new URL(item.url).search.length > 0; } catch { return false; }
  });
  const dynamic = requests.filter(item => ["document", "fetch", "xhr"].includes(item.resourceType)
    && isDynamicRequestUrl(item.url));
  return {
    observedRequestCount: requests.length,
    observedRequests: requests.slice(0, 80).map(item => ({
      requestId: item.requestId, method: item.method, resourceType: item.resourceType,
      url: safeObservedUrl(item.url), status: item.status ?? null,
      contentType: item.responseHeaders?.contentType || null,
      responseBodyReadable: item.responseBodyReadable === true,
      ...(item.method === "OPTIONS" ? {
        preflightMethod: item.headers.accessControlRequestMethod,
        preflightHeaders: item.headers.accessControlRequestHeaders,
      } : {}),
    })),
    queryBearingRequestCount: queryBearing.length,
    queryBearingUrls: queryBearing.slice(0, 40).map(item => safeObservedUrl(item.url)),
    dynamicUrlCoverage: dynamic.length
      ? { exercised: true, observedCount: dynamic.length, urls: dynamic.slice(0, 40).map(item => safeObservedUrl(item.url)) }
      : { exercised: false, reason: "No request with an observed numeric/UUID-like dynamic path or query value." },
  };
}

async function browserReadableJsonGets(frame, audit, marker = null) {
  const urls = [...new Set(audit.requests.filter(item =>
    item.method === "GET" && item.status >= 200 && item.status < 300
      && /json/i.test(item.responseHeaders?.contentType || "")
      && /^https?:/i.test(item.url)).map(item => item.url))].slice(0, 40);
  if (!urls.length) return [];
  return frame.evaluate(async (observedUrls, exactMarker) => {
    function exactMarkerRecords(value, marker) {
      const records = [];
      const contains = (node, depth = 0) => {
        if (depth > 12 || node == null) return false;
        if (typeof node === "string") return node === marker;
        if (Array.isArray(node)) return node.some(child => contains(child, depth + 1));
        if (typeof node === "object") return Object.values(node).some(child => contains(child, depth + 1));
        return false;
      };
      const visitArrays = (node, depth = 0) => {
        if (depth > 12 || node == null) return;
        if (Array.isArray(node)) {
          const matching = node.filter(item => item && typeof item === "object" && contains(item));
          if (matching.length) records.push(matching.length);
          for (const item of node) visitArrays(item, depth + 1);
        } else if (typeof node === "object") {
          for (const child of Object.values(node)) visitArrays(child, depth + 1);
        }
      };
      if (marker) visitArrays(value);
      return records;
    }
    const result = [];
    for (const url of observedUrls) {
      try {
        const response = await fetch(url, {
          method: "GET", credentials: "omit", cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const contentType = response.headers.get("content-type") || "";
        const text = await response.text();
        let body = null;
        let parsed = false;
        if (/json/i.test(contentType)) {
          try { body = JSON.parse(text); parsed = true; } catch { /* A 200 non-JSON body is not a readable JSON API response. */ }
        }
        result.push({
          url, status: response.status, contentType, bodyReadable: response.ok && parsed,
          bodyLength: text.length, exactMarkerArrayCounts: parsed ? exactMarkerRecords(body, exactMarker) : [],
        });
      } catch (error) {
        result.push({ url, status: null, contentType: null, bodyReadable: false, error: "browser-fetch-or-CORS-failed" });
      }
    }
    return result;
  }, urls, marker);
}

async function exercisePreviewNavigation(frame, audit) {
  const candidates = await frame.evaluate(() => {
    const visible = element => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const addLeadVisible = [...document.querySelectorAll("button,[role=button],a")]
      .some(element => visible(element)
        && /\b(?:add|new|create)\s+(?:a\s+)?lead\b/i.test(
          (element.textContent || "").trim() || (element.getAttribute("aria-label") || "").trim()));
    const candidates = [...document.querySelectorAll("nav a[href],a[href],[role=tab],button")]
      .filter(element => {
        if (!visible(element)) return false;
        const label = (element.textContent || "").trim() || (element.getAttribute("aria-label") || "").trim();
        if (!label || /add|new|create|delete|save|submit|publish|logout/i.test(label)) return false;
        if (!/dashboard|home|lead|estimate|job|customer|client/i.test(label)) return false;
        if (element instanceof HTMLAnchorElement) {
          if (element.target && element.target !== "_self") return false;
          try {
            const destination = new URL(element.href);
            return destination.origin === location.origin && destination.href !== location.href
              && !(destination.pathname === location.pathname && destination.search === location.search
                && destination.hash !== location.hash);
          } catch { return false; }
        }
        return (element.getAttribute("role") === "tab" && element.getAttribute("aria-selected") !== "true")
          || (element.closest("nav") !== null && element.getAttribute("aria-current") !== "page")
          || (element instanceof HTMLButtonElement && getComputedStyle(element).cursor === "pointer");
      })
      .map((element, index) => ({
        index,
        label: ((element.textContent || "").trim() || (element.getAttribute("aria-label") || "").trim()).slice(0, 80),
        href: element instanceof HTMLAnchorElement ? element.href : null,
        role: element.getAttribute("role") || element.tagName.toLowerCase(),
        selected: element.getAttribute("aria-selected"),
      }))
      .sort((left, right) => Number(/lead|customer|client/i.test(right.label))
        - Number(/lead|customer|client/i.test(left.label)));
    if (addLeadVisible && !candidates.some(item => /lead/i.test(item.label))) {
      return { candidates: [], addLeadVisible };
    }
    return { candidates, addLeadVisible };
  });
  if (!candidates.candidates.length) {
    return {
      exercised: false,
      reason: candidates.addLeadVisible
        ? "Navigation was skipped to preserve the visible Add Lead view; no separate safe Lead route/tab was available."
        : "No visible, safe in-app navigation link or tab was present.",
    };
  }
  const candidate = candidates.candidates[0];
  const before = await frame.evaluate(() => ({
    url: location.href, text: (document.body?.innerText || "").slice(0, 8_000),
    selectedTabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
      .map(node => (node.textContent || "").trim()),
  }));
  const requestsBefore = audit.requests.length;
  const documentsBefore = audit.requests.filter(item => item.resourceType === "document").length;
  await frame.evaluate(target => {
    const items = [...document.querySelectorAll("nav a[href],a[href],[role=tab],button")]
      .filter(element => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const label = (element.textContent || "").trim() || (element.getAttribute("aria-label") || "").trim();
        if (box.width === 0 || box.height === 0 || style.display === "none" || style.visibility === "hidden") return false;
        if (!label || /add|new|create|delete|save|submit|publish|logout/i.test(label)) return false;
        return /dashboard|home|lead|estimate|job|customer|client/i.test(label);
      });
    const selected = items.find(element =>
      ((element.textContent || "").trim() || (element.getAttribute("aria-label") || "").trim()).slice(0, 80) === target.label
      && (element instanceof HTMLAnchorElement ? element.href : null) === target.href);
    selected?.click();
  }, candidate);
  const deadline = Date.now() + 15_000;
  let after = null;
  while (Date.now() < deadline) {
    try {
      after = await frame.evaluate(() => ({
        url: location.href, text: (document.body?.innerText || "").slice(0, 8_000),
        selectedTabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
          .map(node => (node.textContent || "").trim()),
      }));
      if (after.url !== before.url || after.text !== before.text
        || after.selectedTabs.join("\n") !== before.selectedTabs.join("\n")) break;
    } catch { /* Wait for a real document navigation to finish. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const applicationChanged = after && (after.url !== before.url || after.text !== before.text
    || after.selectedTabs.join("\n") !== before.selectedTabs.join("\n"));
  assert(applicationChanged,
    `Visible navigation control ${candidate.label} did not change route or application content.`);
  const documentsAfter = audit.requests.filter(item => item.resourceType === "document").length;
  const mutations = audit.requests.slice(requestsBefore)
    .filter(item => /^(?:POST|PUT|PATCH|DELETE)$/i.test(item.method));
  assert.equal(mutations.length, 0, "Read-only preview navigation unexpectedly issued a mutation request.");
  let changedBeyondHash = after.url !== before.url;
  try {
    const beforeUrl = new URL(before.url);
    const afterUrl = new URL(after.url);
    if (beforeUrl.origin === afterUrl.origin && beforeUrl.pathname === afterUrl.pathname
      && beforeUrl.search === afterUrl.search && beforeUrl.hash !== afterUrl.hash
      && after.text === before.text && after.selectedTabs.join("\n") === before.selectedTabs.join("\n")) {
      changedBeyondHash = false;
    }
  } catch { /* The application state/body change still counts if a URL is nonstandard. */ }
  return {
    exercised: true, label: candidate.label, from: safeObservedUrl(before.url), to: safeObservedUrl(after.url),
    sameDocument: documentsAfter === documentsBefore,
    javascriptNavigationEvidence: documentsAfter === documentsBefore
      && (after.text !== before.text || after.selectedTabs.join("\n") !== before.selectedTabs.join("\n")
        || changedBeyondHash),
    documentRequestsBefore: documentsBefore, documentRequestsAfter: documentsAfter,
  };
}

async function exactMarkerBackendReadback(frame, audit, marker) {
  const reads = await browserReadableJsonGets(frame, audit, marker);
  const readable = reads.filter(item => item.bodyReadable && item.status === 200);
  const markerCollections = readable.flatMap(item => item.exactMarkerArrayCounts
    .map(count => ({ url: item.url, count }))).filter(item => item.count > 0);
  assert(readable.length > 0,
    "No browser-readable JSON GET was observed for backend record verification.");
  assert(markerCollections.length > 0,
    "No browser-readable JSON collection contained the exact unique lead marker.");
  assert(markerCollections.every(item => item.count === 1),
    "Backend readback found zero/multiple exact marker records in an observed collection; refusing to retry.");
  const matchingUrls = [...new Set(markerCollections.map(item => item.url))];
  return {
    readRequests: reads.length,
    browserReadableJsonGetCount: readable.length,
    markerCollectionCount: markerCollections.length,
    exactBackendRecordCount: 1,
    matchingReadUrls: matchingUrls.map(safeObservedUrl),
    corsReadFailures: reads.filter(item => !item.bodyReadable).length,
  };
}

async function assertPreviewResourceEvidence(audit, previewUrl, rendered) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const documentReady = audit.requests.some(item => item.resourceType === "document"
      && item.status >= 200 && item.status < 400 && item.responseBodyReadable === true);
    const assets = audit.requests.filter(item => ["stylesheet", "script"].includes(item.resourceType)
      && item.status >= 200 && item.status < 400);
    const assetsReady = assets.every(item => item.responseBodyReadable !== undefined);
    const scriptSourcesReady = rendered.scriptUrls.every(source => hasReadableScriptSource(audit.requests, source));
    if (documentReady && assetsReady && scriptSourcesReady) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Requests were attributed by the preview iframe or its exact route when
  // observed; origin equality would also include parent-page API failures.
  const requests = audit.requests;
  const documents = requests.filter(item => item.resourceType === "document");
  assert(documents.some(item => item.status >= 200 && item.status < 400 && item.responseBodyReadable === true),
    "Preview document response was not captured/readable through the browser protocol.");
  const diagnostic = item => {
    const url = new URL(item.url);
    return {
      method: item.method,
      type: item.resourceType,
      host: url.hostname,
      path: url.pathname.replace(/^\/_private_preview\/[^/]+\/[^/]+\//, "/<preview>/"),
      ...(item.status != null ? { status: item.status } : {}),
      ...(item.failure ? { failure: item.failure } : {}),
    };
  };
  assert.equal(audit.failed.length, 0,
    `Preview HTML/CSS/JS/API has a failed network request: ${JSON.stringify(audit.failed.slice(0, 3).map(diagnostic))}`);
  const httpErrors = requests.filter(item => item.status >= 400);
  assert.equal(httpErrors.length, 0,
    `Preview-origin HTML/CSS/JS/API request returned an HTTP error: ${JSON.stringify(httpErrors.slice(0, 3).map(diagnostic))}`);
  const linkedStylesheets = rendered.loadedStylesheets;
  assert(linkedStylesheets > 0 || rendered.inlineStylesheets > 0,
    "Preview has no successfully loaded linked stylesheet or inline stylesheet.");
  if (linkedStylesheets > 0) {
    for (const source of rendered.stylesheetUrls) {
      const style = audit.requests.find(item => item.resourceType === "stylesheet" && item.url === source);
      assert(style && style.status >= 200 && style.status < 400 && style.responseBodyReadable === true,
        "A linked preview stylesheet did not have a successful readable request/response.");
    }
  }
  if (rendered.externalScripts > 0) {
    for (const source of rendered.scriptUrls) {
      const observed = audit.requests.filter(item => item.url === source).map(diagnostic);
      assert(hasReadableScriptSource(audit.requests, source),
        `An external preview script did not return a readable successful response: ${JSON.stringify({
          host: new URL(source).hostname, path: new URL(source).pathname, observed,
        })}`);
    }
  }
  const failedApiGets = audit.requests.filter(item => ["fetch", "xhr"].includes(item.resourceType)
    && item.method === "GET" && item.status >= 400);
  assert.equal(failedApiGets.length, 0, "A preview API/data GET returned an HTTP error.");
  return {
    documentResponseReadable: true, loadedStylesheets: linkedStylesheets,
    inlineStylesheets: rendered.inlineStylesheets,
    stylesheetApplied: rendered.stylesheetApplied, inlineStyleApplied: rendered.inlineStyleApplied,
    computedStyleEvidence: rendered.computedStyles,
    externalScripts: rendered.externalScripts, inlineScripts: rendered.inlineScripts,
    externalScriptResponsesReadable: rendered.scriptUrls.every(source => hasReadableScriptSource(audit.requests, source)),
    failedApiGets: 0,
  };
}

async function settlePreviewAuditBodies(audit) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const pending = audit.requests.filter(item => item.status >= 200 && item.status < 400
      && ["document", "stylesheet", "script", "fetch", "xhr"].includes(item.resourceType)
      && item.responseBodyReadable === undefined);
    if (!pending.length) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function correlatedLeadTransport(audit, marker) {
  const postRequests = audit.requests.filter(item => item.method === "POST"
    && (requestContainsExactMarker(item, marker) || urlContainsExactMarker(item.url, marker)));
  assert.equal(postRequests.length, 1, "Expected exactly one observed POST containing the unique lead marker.");
  const post = postRequests[0];
  assert(post.status >= 200 && post.status < 300, "The unique-marker POST did not return a successful HTTP status.");
  const postUrl = new URL(post.url);
  const postOrigin = post.headers.origin || "";
  if (postOrigin && postOrigin !== postUrl.origin) {
    const allowedPostOrigin = post.responseHeaders?.accessControlAllowOrigin || "";
    assert(allowedPostOrigin === "*" || allowedPostOrigin === postOrigin,
      "Successful POST response did not allow the preview request's actual Origin.");
  }
  const options = audit.requests.filter(item => {
    if (item.method !== "OPTIONS" || item.headers.accessControlRequestMethod?.toUpperCase() !== "POST") return false;
    try { return new URL(item.url).href === postUrl.href; } catch { return false; }
  });
  const contentType = post.headers.contentType || "";
  const simpleContentType = /^(?:application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)(?:\s*;|$)/i.test(contentType);
  const unsafeHeaders = post.headerNames.filter(name =>
    !/^(?:accept|accept-language|content-language|content-type|origin|referer|user-agent|accept-encoding|connection|host|content-length|cache-control|pragma|sec-.*)$/i.test(name));
  const preflightRequired = !simpleContentType || unsafeHeaders.length > 0;
  if (preflightRequired && options.length) {
    assert.equal(options.length, 1, "Multiple OPTIONS preflights were observed for the exact POST URL/query and method.");
    const preflight = options[0];
    assert.equal(preflight.headers.origin || "", postOrigin,
      "OPTIONS preflight Origin did not match the unique-marker POST Origin.");
    assert(preflight.status >= 200 && preflight.status < 300, "Correlated Add Lead OPTIONS preflight failed.");
    const origin = preflight.headers.origin || "";
    const allowedOrigin = preflight.responseHeaders?.accessControlAllowOrigin || "";
    assert(allowedOrigin === "*" || allowedOrigin === origin,
      "Correlated preflight did not allow the preview's actual Origin.");
    assert((preflight.responseHeaders?.accessControlAllowMethods || "").split(",")
      .some(method => method.trim().toUpperCase() === "POST"),
    "Correlated preflight did not allow POST.");
    const requestedHeaders = (preflight.headers.accessControlRequestHeaders || "")
      .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
    const expectedHeaders = unsafeHeaders.slice();
    if (!simpleContentType && contentType) expectedHeaders.push("content-type");
    assert(expectedHeaders.every(header => requestedHeaders.includes(header)),
      "Correlated OPTIONS did not request all non-simple headers actually sent by the POST.");
    const allowedHeaders = (preflight.responseHeaders?.accessControlAllowHeaders || "")
      .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
    assert(requestedHeaders.every(header => allowedHeaders.includes(header) || allowedHeaders.includes("*")),
      "Correlated preflight did not allow all requested headers.");
  } else if (!preflightRequired) {
    assert.equal(options.length, 0, "A simple lead POST unexpectedly had a correlated OPTIONS request.");
  }
  return {
    postRequestId: post.requestId, postUrl: safeObservedUrl(post.url), postStatus: post.status,
    correlatedOptionsRequestIds: options.map(item => item.requestId),
    preflightRequired, preflightObserved: options.length > 0,
    preflightStatus: options[0]?.status ?? null,
    corsErrors: audit.corsErrors.length,
  };
}

const LEAD_FIELDS = new Set([
  "id", "name", "phone", "email", "address", "project_type", "status",
  "estimated_value", "notes", "roof_size_sq", "pitch", "scheduled_date",
  "created_at", "updated_at", "error", "message",
]);

function redactedLeadFields(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { bodyShape: "non-object" };
    const fields = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!LEAD_FIELDS.has(key) || !["string", "number", "boolean"].includes(typeof value)) continue;
      fields[key] = typeof value === "string" ? safeError(value) : value;
    }
    return fields;
  } catch {
    return { bodyShape: "not-json" };
  }
}

function leadEndpoint(url) {
  try {
    const path = new URL(url).pathname;
    if (path.endsWith("/api/leads")) return "leads";
    if (path.endsWith("/api/stats")) return "stats";
  } catch { /* Invalid or internal URL. */ }
  return null;
}

async function attachLeadCdpAudit(page, previewUrl) {
  const session = await page.createCDPSession();
  await session.send("Network.enable");
  const requests = new Map();
  session.on("Network.requestWillBeSent", event => {
    const endpoint = leadEndpoint(event.request.url);
    if (!endpoint || !["OPTIONS", "POST", "GET"].includes(event.request.method)) return;
    const fromPreview = isPreviewAuditRequest(previewUrl, event.request.url, event.documentURL || "");
    const headers = event.request.headers || {};
    const header = name => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] || null;
    requests.set(event.requestId, {
      requestId: event.requestId, endpoint, method: event.request.method,
      initiator: fromPreview ? "generated-preview" : "parent-page",
      frameId: event.frameId || null,
      capability_present: new URL(event.request.url).searchParams.has("t"),
      contentType: header("content-type"),
      accessControlRequestMethod: header("access-control-request-method"),
      status: null, finished: false,
    });
  });
  session.on("Network.responseReceived", event => {
    const entry = requests.get(event.requestId);
    if (entry) entry.status = event.response.status;
  });
  session.on("Network.loadingFinished", event => {
    const entry = requests.get(event.requestId);
    if (entry) entry.finished = true;
  });
  session.on("Network.loadingFailed", event => {
    const entry = requests.get(event.requestId);
    if (entry) entry.failure = safeError(event.errorText);
  });
  return { requests, close: () => session.detach().catch(() => undefined) };
}

function leadAttemptEvidence(audit, from, cdp, marker, baseline, postRows, visible) {
  const requests = audit.requests.slice(from).filter(item =>
    leadEndpoint(item.url) && ["OPTIONS", "POST", "GET"].includes(item.method));
  return {
    baseline, authoritativeAfter: postRows
      ? { count: postRows.length, ids: postRows.map(row => row.id),
        matchingIds: postRows.filter(row => row.name === marker).map(row => row.id) }
      : { available: false },
    ui: visible,
    browserRequests: requests.map(item => ({
      requestId: item.requestId, method: item.method, endpoint: leadEndpoint(item.url),
      initiator: isPreviewAuditRequest(audit.previewUrl, item.url, item.initiatorFrameUrl)
        ? "generated-preview" : "parent-page",
      resourceType: item.resourceType,
      capability_present: new URL(item.url).searchParams.has("t"),
      status: item.status ?? null,
      contentType: item.headers.contentType,
      accessControlRequestMethod: item.headers.accessControlRequestMethod,
      responseHeaders: item.responseHeaders || null,
      requestBodyFields: item.method === "POST" ? redactedLeadFields(item.bodyText || "") : undefined,
      responseBodyFields: item.method === "POST" ? item.leadResponseBody || null : undefined,
      responseBodyReadable: item.responseBodyReadable === true,
    })),
    cdpRequests: [...cdp.requests.values()].filter(item =>
      item.initiator === "generated-preview" && ["OPTIONS", "POST", "GET"].includes(item.method)),
    failedRequests: audit.failed.filter(item => leadEndpoint(item.url))
      .map(item => ({ requestId: item.requestId, method: item.method,
        endpoint: leadEndpoint(item.url), failure: safeError(item.failure) })),
    corsErrorCount: audit.corsErrors.length,
  };
}

async function saveLeadEvidence(evidence, filename = "approved-lead-evidence.json") {
  assert(["approved-lead-evidence.json", "approved-lead-form-checks.json"].includes(filename));
  const destination = path.join(PRIVATE_DIR, filename);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(evidence)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, destination);
  await chmod(destination, 0o600);
}

async function markerVisibleInPreview(frame, marker) {
  return frame.evaluate(value => ({
    count: (document.body?.innerText || "").split(value).length - 1,
    stillInForm: [...document.querySelectorAll("input,textarea")].some(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && element.value === value;
    }),
  }), marker);
}

function requestContainsExactMarker(item, marker) {
  const raw = item.bodyText || "";
  const contains = (node, depth = 0) => {
    if (depth > 12 || node == null) return false;
    if (typeof node === "string") return node === marker;
    if (Array.isArray(node)) return node.some(value => contains(value, depth + 1));
    if (typeof node === "object") return Object.values(node).some(value => contains(value, depth + 1));
    return false;
  };
  try { if (contains(JSON.parse(raw))) return true; } catch { /* Form-encoded or multipart request body. */ }
  try {
    if ([...new URLSearchParams(raw).values()].some(value => value === marker)) return true;
  } catch { /* Not URL-encoded. */ }
  try {
    const decoded = decodeURIComponent(raw.replace(/\+/g, " "));
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|["'=:\\r\\n&])${escaped}(?:["'&\\r\\n]|$)`).test(decoded);
  } catch {
    return false;
  }
}

function urlContainsExactMarker(value, marker) {
  try { return [...new URL(value).searchParams.values()].some(item => item === marker); }
  catch { return false; }
}

async function markLeadOutcomeUncertain(state, persist = saveCheckpoint) {
  state.stage = "lead-outcome-uncertain";
  state.leadOutcome = "outcome-uncertain-no-retry";
  await persist(state);
}

async function addLeadIfAvailable(page, frame, state, audit,
  { approved = false, authoritativeBaseline = null, baselineRows = null,
    formOnly = false, persist = saveCheckpoint, beforeSubmit = null, afterClick = null } = {}) {
  assert(!(approved && formOnly), "Form-only verification must never use the Submit phase.");
  if (state.stage === "lead-submit-pending") {
    try {
      const found = await markerVisibleInPreview(frame, state.leadMarker);
      const backend = await exactMarkerBackendReadback(frame, audit, state.leadMarker);
      assert(found.count >= 1, "Pending lead did not appear in the preview UI.");
      assert.equal(found.stillInForm, false, "Pending lead form still contains the marker after the possible submission.");
      state.leadOutcome = "reconciled-exact-backend-record";
      state.stage = "preview-verified";
      await persist(state);
      return {
        available: true, submitted: true, reconciled: true,
        transportEvidence: "unavailable-after-resume", backendReadback: backend,
      };
    } catch (error) {
      await markLeadOutcomeUncertain(state, persist);
      throw new Error(`Lead-submit outcome is uncertain; backend/UI did not reconcile exactly and no retry was made: ${safeError(error)}`);
    }
  }

  const controls = await frame.evaluate(() => [...document.querySelectorAll("button,[role=button],a")]
    .filter(element => {
      const box = element.getBoundingClientRect();
      if (element.closest("form") || element.getAttribute("type")?.toLowerCase() === "submit") return false;
      if (element instanceof HTMLAnchorElement) {
        if (element.target && element.target !== "_self") return false;
        try { if (new URL(element.href).origin !== location.origin) return false; } catch { return false; }
      }
      return box.width > 0 && box.height > 0
        && /\b(?:add|new|create)\s+(?:a\s+)?lead\b/i.test(element.textContent || element.getAttribute("aria-label") || "");
    })
    .map(element => (element.textContent || element.getAttribute("aria-label") || "").trim()));
  if (state.stage === "preview-verified") {
    let backendReadback = null;
    if (state.actionCounts.leadSubmit === 1 && /verified|reconciled/.test(state.leadOutcome || "")) {
      backendReadback = await exactMarkerBackendReadback(frame, audit, state.leadMarker);
      const visible = await markerVisibleInPreview(frame, state.leadMarker);
      assert(visible.count >= 1, "Previously submitted lead is not visible on preview revalidation.");
    }
    return {
      available: controls.length > 0, submitted: false, alreadyVerified: true,
      mutationUnexercised: state.actionCounts.leadSubmit === 0
        ? "Preview was already marked complete; mutation is not replayed."
        : undefined,
      backendReadback,
    };
  }
  if (controls.length === 0) {
    return { available: false, submitted: false, mutationUnexercised: "No visible Add/New/Create Lead control exists." };
  }

  assert.equal(state.actionCounts.leadSubmit, 0, "Lead action was already attempted; refusing a second POST.");
  const priorOutcome = state.leadOutcome;
  const openerRequestStart = audit.requests.length;
  if (!formOnly) {
    state.stage = "lead-submit-pending";
    state.leadOutcome = "lead-form-opening-pending";
    await persist(state);
  }
  if (formOnly) {
    let opened = false;
    for (const element of await frame.$$("button,[role=button],a")) {
      const safe = await element.evaluate(node => {
        const box = node.getBoundingClientRect();
        if (node.closest("form") || node.getAttribute("type")?.toLowerCase() === "submit") return false;
        if (node instanceof HTMLAnchorElement) {
          if (node.target && node.target !== "_self") return false;
          try { if (new URL(node.href).origin !== location.origin) return false; } catch { return false; }
        }
        return box.width > 0 && box.height > 0
          && /\b(?:add|new|create)\s+(?:a\s+)?lead\b/i.test(node.textContent || node.getAttribute("aria-label") || "");
      });
      if (!safe) continue;
      await element.click();
      opened = true;
      break;
    }
    assert(opened, "The generated Add Lead control was unavailable for normal browser interaction.");
  } else await frame.evaluate(() => {
    const button = [...document.querySelectorAll("button,[role=button],a")]
      .find(element => {
        const box = element.getBoundingClientRect();
        if (element.closest("form") || element.getAttribute("type")?.toLowerCase() === "submit") return false;
        if (element instanceof HTMLAnchorElement) {
          if (element.target && element.target !== "_self") return false;
          try { if (new URL(element.href).origin !== location.origin) return false; } catch { return false; }
        }
        return box.width > 0 && box.height > 0
          && /\b(?:add|new|create)\s+(?:a\s+)?lead\b/i.test(element.textContent || element.getAttribute("aria-label") || "");
      });
    button?.click();
  });
  const formAppeared = await frame.waitForFunction(() => {
    const visible = element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    return [...document.querySelectorAll('form,[role="dialog"],dialog[open]')].some(scope => visible(scope)
      && [...scope.querySelectorAll("input:not([type=hidden]),textarea,select")].some(visible)
      && [...scope.querySelectorAll("button,[role=button],input[type=submit]")]
        .some(element => /add|save|create|submit/i.test(element.textContent || element.value || "")));
  }, { timeout: 15_000 }).then(() => true, () => false);
  const openerMutations = audit.requests.slice(openerRequestStart)
    .filter(item => /^(?:POST|PUT|PATCH|DELETE)$/i.test(item.method));
  if (openerMutations.length > 0) {
    if (formOnly) throw new Error("Opening the form unexpectedly issued a mutation; form-only verification stopped.");
    state.actionCounts.leadSubmit = 1;
    await markLeadOutcomeUncertain(state, persist);
    throw new Error("Opening the visible lead control issued a mutation before a unique marker could be attached; no retry was made.");
  }
  if (!formAppeared) {
    if (!formOnly) {
      state.stage = "generation-verified";
      state.leadOutcome = priorOutcome;
      await persist(state);
    }
    return {
      available: true, submitted: false,
      mutationUnexercised: "Visible lead action did not expose a safely identifiable form and submit control.",
    };
  }
  if (!formOnly) {
    state.stage = "generation-verified";
    state.leadOutcome = priorOutcome;
    await persist(state);
  }

  const email = `lead-${state.leadMarker.replace(/\W/g, "").toLowerCase()}@example.com`;
  const phone = "+1-202-555-0144";
  const notes = "Disposable Task 13 acceptance record";
  async function typeVisible(selector, text, { numeric = false } = {}) {
    let matches = await frame.$$(selector);
    if (numeric) {
      const estimateFields = [];
      for (const candidate of matches) {
        const label = await candidate.evaluate(element =>
          element.parentElement?.querySelector("label")?.textContent?.trim() || "");
        if (label === "Estimated Value ($)") estimateFields.push(candidate);
      }
      matches = estimateFields;
    }
    assert.equal(matches.length, 1, `Expected one visible generated form field for ${selector}.`);
    const element = matches[0];
    await element.click({ clickCount: 3 });
    // Controlled numeric fields convert an empty input to 0. Replacing the
    // selection without an intermediate Backspace avoids appending to that 0.
    if (numeric) {
      await page.keyboard.down("Control");
      try {
        await page.keyboard.press("a");
      } finally {
        await page.keyboard.up("Control");
      }
    } else {
      await element.press("Backspace");
    }
    await element.type(text, { delay: 12 });
  }
  await typeVisible('form input[placeholder="e.g. John Smith"]', state.leadMarker);
  await typeVisible('form input[placeholder="(555) 000-0000"]', phone);
  await typeVisible('form input[type="email"]', email);
  await typeVisible('form input[placeholder="123 Main St, Austin TX"]', "123 Demo Street");
  await typeVisible('form input[type="number"]', "12500", { numeric: true });
  await typeVisible("form textarea", notes);
  const populated = await frame.evaluate(marker => {
    const form = [...document.querySelectorAll("form")].find(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && element.querySelector('input[placeholder="e.g. John Smith"]');
    });
    if (!form) return { formFound: false };
    const name = form.querySelector('input[placeholder="e.g. John Smith"]')?.value;
    const phoneValue = form.querySelector('input[placeholder="(555) 000-0000"]')?.value;
    const emailValue = form.querySelector('input[type="email"]')?.value;
    const address = form.querySelector('input[placeholder="123 Main St, Austin TX"]')?.value;
    const estimate = [...form.querySelectorAll('input[type="number"]')]
      .find(element => element.parentElement?.querySelector("label")?.textContent?.trim()
        === "Estimated Value ($)")?.value;
    const notesValue = form.querySelector("textarea")?.value;
    const selects = [...form.querySelectorAll("select")];
    const project = selects[0];
    const status = selects[1];
    const submitControls = [...form.querySelectorAll('button[type="submit"],input[type="submit"]')]
      .filter(element => /add|save|create|submit/i.test(element.textContent || element.value || ""));
    return {
      formFound: true, name, phoneValue, emailValue, address, estimate, notesValue,
      nameMatches: name === marker,
      phoneMatches: phoneValue === "+1-202-555-0144",
      emailMatches: emailValue === `lead-${marker.replace(/\W/g, "").toLowerCase()}@example.com`,
      addressMatches: address === "123 Demo Street", estimateMatches: estimate === "12500",
      notesMatches: notesValue === "Disposable Task 13 acceptance record",
      projectType: project?.value || null, status: status?.value || null,
      projectValid: !!project?.value && [...project.options].some(option => option.value === project.value),
      statusValid: !!status?.value && [...status.options].some(option => option.value === status.value),
      requiredFieldsValid: form.checkValidity(), submitCount: submitControls.length,
      submitDisabled: submitControls[0]?.disabled ?? true,
    };
  }, state.leadMarker);
  const checks = [
    { field: "NAME", required: true, expected: state.leadMarker,
      observed: populated.name ?? null, pass: populated.nameMatches === true },
    { field: "PROJECT TYPE", required: true, expected: "valid selected option",
      observed: populated.projectType ?? null, pass: populated.projectValid === true },
    { field: "STATUS", required: true, expected: "valid selected option",
      observed: populated.status ?? null, pass: populated.statusValid === true },
    { field: "PHONE", required: false, expected: phone,
      observed: populated.phoneValue ?? null, pass: populated.phoneMatches === true },
    { field: "EMAIL", required: false, expected: email,
      observed: populated.emailValue ?? null, pass: populated.emailMatches === true },
    { field: "ADDRESS", required: false, expected: "123 Demo Street",
      observed: populated.address ?? null, pass: populated.addressMatches === true },
    { field: "ESTIMATED VALUE", required: false, expected: "12500",
      observed: populated.estimate ?? null, pass: populated.estimateMatches === true },
    { field: "NOTES", required: false, expected: notes,
      observed: populated.notesValue ?? null, pass: populated.notesMatches === true },
    { field: "FORM VALIDITY", required: true, expected: true,
      observed: populated.requiredFieldsValid ?? null, pass: populated.requiredFieldsValid === true },
    { field: "SUBMIT CONTROL", required: true, expected: "one enabled submit button",
      observed: { count: populated.submitCount ?? 0, disabled: populated.submitDisabled ?? null },
      pass: populated.submitCount === 1 && populated.submitDisabled === false },
  ];
  if (approved || formOnly) {
    const gate = { projectId: state.projectId, newSubmitClicks: state.actionCounts.leadSubmit,
      formPopulatedByBrowserTyping: true, checks };
    if (approved) await saveLeadEvidence(gate, "approved-lead-form-checks.json");
    report(formOnly ? "recovered-form-field-checks" : "approved-lead-field-checks", gate);
  }
  const failed = checks.filter(check => !check.pass);
  assert.equal(failed.length, 0,
    `Pre-submit field gate failed: ${failed.map(check => check.field).join(", ")}. No Submit click.`);
  if (formOnly) {
    return { available: true, submitted: false, formOnly: true, checks,
      formValues: populated, newSubmitClicks: state.actionCounts.leadSubmit };
  }
  const submit = await frame.$('form button[type="submit"],form input[type="submit"]');
  assert(submit, "Generated Add Lead Submit control disappeared; no mutation was made.");
  if (approved) {
    assert(authoritativeBaseline, "Approved attempt requires an authoritative pre-submit baseline.");
    // Recheck immediately before the one-way boundary, not only at phase start.
    const immediatelyBefore = await authoritativeLeadRows(page, state);
    assertApprovedLeadBaseline(immediatelyBefore, state);
    if (baselineRows) assert.deepEqual(immediatelyBefore, baselineRows,
      "Existing lead values changed before the approved click.");
  }
  if (beforeSubmit) await beforeSubmit({ populated, checks });
  const networkStart = audit.requests.length;
  const cdp = await attachLeadCdpAudit(page, audit.previewUrl);
  let afterRows = null;
  let visible = null;
  let attemptError = null;
  let evidenceSaved = false;
  try {
    state.stage = "lead-submit-pending";
    state.actionCounts.leadSubmit = 1;
    state.leadOutcome = "submit-pending";
    await persist(state);
    await submit.click(); // Exactly one real browser click; never retry on failure.
    if (afterClick) await afterClick();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      visible = await markerVisibleInPreview(frame, state.leadMarker);
      if (visible.count > 0 && !visible.stillInForm) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await new Promise(resolve => setTimeout(resolve, 750));
    afterRows = approved ? await authoritativeLeadRows(page, state) : null;
    assert(visible?.count >= 1 && visible.stillInForm === false,
      "Generated UI did not display the created lead after the single Submit click.");
    const attemptRequests = audit.requests.slice(networkStart);
    const posts = attemptRequests.filter(item => item.method === "POST"
      && leadEndpoint(item.url) === "leads"
      && isPreviewAuditRequest(audit.previewUrl, item.url, item.initiatorFrameUrl));
    assert.equal(posts.length, 1, "Expected exactly one generated-preview leads POST.");
    assert(requestContainsExactMarker(posts[0], state.leadMarker),
      "POST did not contain the visible unique name marker.");
    const cdpPosts = [...cdp.requests.values()].filter(item =>
      item.method === "POST" && item.endpoint === "leads" && item.initiator === "generated-preview");
    assert(cdpPosts.length <= 1, "CDP observed more than one generated-preview leads POST.");
    assert.equal(posts[0].status, 201, "Generated lead POST did not return HTTP 201.");
    const bodyDeadline = Date.now() + 5_000;
    while (posts[0].responseBodyReadable === undefined && Date.now() < bodyDeadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(posts[0].responseBodyReadable === true, "Generated POST response body was not browser-readable.");
    const transport = correlatedLeadTransport(audit, state.leadMarker);
    assert.equal(audit.failed.length, 0, "Preview application has a failed request.");
    if (approved) {
      assert.equal(afterRows.length, 13, "The authoritative lead count did not advance exactly once.");
      const fresh = afterRows.filter(row => !authoritativeBaseline.ids.includes(Number(row.id)));
      assert.equal(fresh.length, 1, "Expected exactly one new authoritative lead ID.");
      if (baselineRows) {
        const original = afterRows.filter(row => authoritativeBaseline.ids.includes(Number(row.id)));
        assert.deepEqual(original, baselineRows, "Existing leads 1–12 changed after the approved click.");
      }
      assert.equal(fresh[0].name, state.leadMarker, "The new database lead does not match the visible name.");
      assert.equal(fresh[0].phone, phone);
      assert.equal(fresh[0].email, email);
      assert.equal(fresh[0].notes, notes);
      assert.equal(fresh[0].address, "123 Demo Street");
      assert.equal(fresh[0].project_type, populated.projectType);
      assert.equal(fresh[0].status, populated.status);
      assert.equal(Number(fresh[0].estimated_value), 12500);
      for (const endpoint of ["leads", "stats"]) {
        assert(attemptRequests.some(item => item.method === "GET" && item.status === 200
          && leadEndpoint(item.url) === endpoint
          && isPreviewAuditRequest(audit.previewUrl, item.url, item.initiatorFrameUrl)),
        `Generated ${endpoint} GET did not refresh successfully after the POST.`);
      }
    }
    const backendReadback = await exactMarkerBackendReadback(frame, audit, state.leadMarker);
    if (approved) {
      await saveLeadEvidence({
        ...leadAttemptEvidence(audit, networkStart, cdp, state.leadMarker,
          authoritativeBaseline, afterRows, visible),
        result: "PASS", failure: null,
        formPopulatedByBrowserTyping: true, formValues: populated,
      });
      evidenceSaved = true;
    }
    state.leadOutcome = "verified-once";
    state.stage = "preview-verified";
    await persist(state);
    return {
      available: true, submitted: true, reconciled: false, uiMarkerOccurrences: visible.count,
      formPopulatedByBrowserTyping: true, formValues: populated,
      transport, backendReadback,
      ...(approved ? { authoritativeAfter: { count: afterRows.length,
        newLeadIds: afterRows.filter(row => !authoritativeBaseline.ids.includes(Number(row.id))).map(row => row.id) } } : {}),
    };
  } catch (error) {
    attemptError = error;
    if (approved && !afterRows) {
      try { afterRows = await authoritativeLeadRows(page, state); } catch { /* Keep transport evidence. */ }
    }
    await markLeadOutcomeUncertain(state, persist);
    throw new Error(`Add Lead result could not be verified; no retry will occur: ${safeError(error)}`);
  } finally {
    if (approved && !evidenceSaved) {
      await saveLeadEvidence({
        ...leadAttemptEvidence(audit, networkStart, cdp, state.leadMarker,
          authoritativeBaseline, afterRows, visible),
        result: attemptError ? "FAIL" : "PASS",
        failure: attemptError ? safeError(attemptError) : null,
        formPopulatedByBrowserTyping: true, formValues: populated,
      });
    }
    await cdp.close();
  }
}

async function recoveredFormPhase() {
  const checkpoint = JSON.parse(await readFile(RECOVERY_CHECKPOINT, "utf8"));
  assert.equal(checkpoint.schema, 1);
  assert.equal(checkpoint.stage, "same-owner-recovered-baseline-verified-form-pending");
  assert.equal(checkpoint.ownerUserId, "4d91ebb1-c2fc-4906-81fe-8b305761b8a2");
  assert.equal(checkpoint.projectId, 5);
  assert.equal(checkpoint.agentId, "ccac2618-5f92-4d2f-b68f-ca9d2116325e");
  assert.equal(checkpoint.revision, "d4bc4b85d03cfaf55326d078f08b9446b98e68b1");
  assert.equal(checkpoint.recoveryRequests, 1);
  assert.equal(checkpoint.historicalLeadSubmitClicks, 1);
  assert.equal(checkpoint.newlyApprovedLeadSubmitClicks, 0);
  assert.deepEqual(checkpoint.baseline?.ids, Array.from({ length: 12 }, (_, index) => index + 1));
  assert.equal(checkpoint.ownerPasswordSecretName, "BUILDCUSTOM_TASK13_PROJECT5_PASSWORD");
  const password = process.env.BUILDCUSTOM_TASK13_PROJECT5_PASSWORD;
  assert(password, "The same owner's durable password secret is unavailable.");
  const state = {
    projectId: checkpoint.projectId, agentId: checkpoint.agentId,
    userId: checkpoint.ownerUserId, initialRevision: checkpoint.revision,
    identity: { email: checkpoint.ownerEmail, password },
    leadMarker: `Task13 form-only ${randomBytes(8).toString("hex")}`,
    actionCounts: { leadSubmit: 0 }, stage: "recovered-form-only", leadOutcome: null,
  };
  let browser;
  try {
    browser = await launchBrowser(RECOVERED_PROFILE);
    const page = await browser.newPage();
    page.setDefaultTimeout(UI_TIMEOUT);
    page.setDefaultNavigationTimeout(UI_TIMEOUT);
    await ensureIdentity(page, state);
    const projects = projectsArray(await apiGet(page, "/api/projects", "Recovered owner project list"));
    assert.equal(projects?.length, 1);
    assert.equal(String(projects[0]?.id), String(state.projectId));
    const project = await apiGet(page, `/api/projects/${state.projectId}`, "Recovered owner project");
    assert.equal(String(project?.userId), state.userId);
    assert.equal(project?.agentId, state.agentId);
    const revision = await runtimeGet(page, state.projectId, "revision");
    assert.equal((revision?.commitHash || revision?.revision?.commitHash || "").toLowerCase(),
      state.initialRevision);
    const baseline = assertApprovedLeadBaseline(await authoritativeLeadRows(page, state), state);
    assert.deepEqual(baseline.ids, checkpoint.baseline.ids);
    const status = await runtimeGet(page, state.projectId, "status");
    const previewUrl = status.previewUrl || status.previewURL
      || status.state?.previewUrl || status.state?.previewURL;
    assert(previewUrl, "Same-owner project has no preview.");
    const audit = attachPreviewRequestAudit(page, previewUrl);
    await openEditor(page, state.projectId);
    const frame = await previewFrame(page, previewUrl);
    await frame.waitForFunction(() => {
      const text = document.body?.innerText || "";
      return text.includes("Roofing Dashboard") && text.includes("Leads Directory")
        && (document.querySelector("#root")?.childElementCount || 0) > 0;
    }, { timeout: UI_TIMEOUT });
    await exercisePreviewNavigation(frame, audit);
    const result = await addLeadIfAvailable(page, frame, state, audit, { formOnly: true });
    assert.equal(result.formOnly, true, "Form-only verification did not reach its field gate.");
    assert.equal(result.submitted, false);
    assert.equal(result.formValues.estimate, "12500");
    const after = assertApprovedLeadBaseline(await authoritativeLeadRows(page, state), state);
    assert.deepEqual(after.ids, baseline.ids);
    assert.equal(state.actionCounts.leadSubmit, 0);
    report("recovered-form-only-verified", {
      projectId: state.projectId, ownerIdConfirmed: true, agentIdConfirmed: true,
      revision: state.initialRevision, baseline, estimatedValue: result.formValues.estimate,
      checks: result.checks, newSubmitClicks: 0, authoritativeAfter: after,
    });
  } finally {
    if (browser) await browser.close();
  }
}

async function recoveredApprovedLeadPhase() {
  const checkpoint = JSON.parse(await readFile(RECOVERY_CHECKPOINT, "utf8"));
  assert.equal(checkpoint.schema, 1);
  assert.equal(checkpoint.stage, "same-owner-recovered-baseline-verified-form-pass-no-submit",
    "The durable recovery checkpoint is not eligible for another Add Lead attempt.");
  assert.equal(checkpoint.formVerification?.result, "PASS");
  assert.equal(checkpoint.formVerification?.estimatedValueObserved, "12500");
  assert.equal(checkpoint.ownerUserId, "4d91ebb1-c2fc-4906-81fe-8b305761b8a2");
  assert.equal(checkpoint.projectId, 5);
  assert.equal(checkpoint.agentId, "ccac2618-5f92-4d2f-b68f-ca9d2116325e");
  assert.equal(checkpoint.revision, "d4bc4b85d03cfaf55326d078f08b9446b98e68b1");
  assert.equal(checkpoint.recoveryRequests, 1);
  assert.equal(checkpoint.historicalLeadSubmitClicks, 1);
  assert.equal(checkpoint.newlyApprovedLeadSubmitClicks, 0);
  assert.deepEqual(checkpoint.baseline?.ids, Array.from({ length: 12 }, (_, index) => index + 1));
  assert.equal(checkpoint.ownerPasswordSecretName, "BUILDCUSTOM_TASK13_PROJECT5_PASSWORD");
  const password = process.env.BUILDCUSTOM_TASK13_PROJECT5_PASSWORD;
  assert(password, "The same owner's durable password secret is unavailable.");
  const state = {
    projectId: checkpoint.projectId, agentId: checkpoint.agentId,
    userId: checkpoint.ownerUserId, initialRevision: checkpoint.revision,
    identity: { email: checkpoint.ownerEmail, password },
    leadMarker: `Task13 approved lead ${randomBytes(8).toString("hex")}`,
    actionCounts: { leadSubmit: 0 }, stage: "generation-verified",
    leadOutcome: "approved-new-attempt-not-clicked",
  };
  let browser;
  let page;
  try {
    browser = await launchBrowser(RECOVERED_PROFILE);
    page = await browser.newPage();
    page.setDefaultTimeout(UI_TIMEOUT);
    page.setDefaultNavigationTimeout(UI_TIMEOUT);
    await ensureIdentity(page, state);
    const projects = projectsArray(await apiGet(page, "/api/projects", "Recovered owner project list"));
    assert.equal(projects?.length, 1);
    assert.equal(String(projects[0]?.id), String(state.projectId));
    const project = await apiGet(page, `/api/projects/${state.projectId}`, "Recovered owner project");
    assert.equal(String(project?.userId), state.userId);
    assert.equal(project?.agentId, state.agentId);
    const revision = await runtimeGet(page, state.projectId, "revision");
    assert.equal((revision?.commitHash || revision?.revision?.commitHash || "").toLowerCase(),
      state.initialRevision);
    const baselineRows = await authoritativeLeadRows(page, state);
    const baseline = assertApprovedLeadBaseline(baselineRows, state);
    assert.deepEqual(baseline.ids, checkpoint.baseline.ids);
    const originalDigest = createHash("sha256").update(JSON.stringify(baselineRows)).digest("hex");
    checkpoint.stage = "approved-lead-preparing";
    checkpoint.leadAttempt = {
      marker: state.leadMarker, baseline, originalDigest,
      clickReserved: false, confirmedBrowserClicks: 0,
      outcome: "preparing-one-approved-click",
    };
    await saveRecoveredCheckpoint(checkpoint);
    const persist = async current => {
      checkpoint.stage = current.stage;
      checkpoint.newlyApprovedLeadSubmitClicks = current.actionCounts.leadSubmit;
      checkpoint.leadAttempt.clickReserved ||= current.actionCounts.leadSubmit === 1;
      checkpoint.leadAttempt.outcome = current.leadOutcome;
      await saveRecoveredCheckpoint(checkpoint);
    };
    const status = await runtimeGet(page, state.projectId, "status");
    const previewUrl = status.previewUrl || status.previewURL
      || status.state?.previewUrl || status.state?.previewURL;
    assert(previewUrl, "Same-owner project has no preview.");
    const audit = attachPreviewRequestAudit(page, previewUrl);
    await openEditor(page, state.projectId);
    const frame = await previewFrame(page, previewUrl);
    await frame.waitForFunction(() => {
      const text = document.body?.innerText || "";
      return text.includes("Roofing Dashboard") && text.includes("Leads Directory")
        && (document.querySelector("#root")?.childElementCount || 0) > 0;
    }, { timeout: UI_TIMEOUT });
    await exercisePreviewNavigation(frame, audit);
    const lead = await addLeadIfAvailable(page, frame, state, audit, {
      approved: true, authoritativeBaseline: baseline, baselineRows, persist,
      beforeSubmit: async ({ populated, checks }) => {
        checkpoint.leadAttempt.preSubmitChecks = checks;
        checkpoint.leadAttempt.expectedValues = {
          name: populated.name, phone: populated.phoneValue, email: populated.emailValue,
          address: populated.address, projectType: populated.projectType,
          status: populated.status, estimatedValue: populated.estimate, notes: populated.notesValue,
        };
        await saveRecoveredCheckpoint(checkpoint);
      },
      afterClick: async () => {
        checkpoint.leadAttempt.confirmedBrowserClicks = 1;
        await saveRecoveredCheckpoint(checkpoint);
      },
    });
    assert.equal(lead.submitted, true, "The approved Add Lead phase did not submit.");
    assert.equal(lead.reconciled, false, "An earlier pending attempt must not be counted as this click.");
    assert.equal(checkpoint.leadAttempt.confirmedBrowserClicks, 1);
    const afterRows = await authoritativeLeadRows(page, state);
    const original = afterRows.filter(row => baseline.ids.includes(Number(row.id)));
    const fresh = afterRows.filter(row => !baseline.ids.includes(Number(row.id)));
    assert.deepEqual(original, baselineRows, "Existing leads 1–12 changed.");
    assert.equal(afterRows.length, 13);
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0].name, state.leadMarker);
    assert.equal(fresh[0].phone, lead.formValues.phoneValue);
    assert.equal(fresh[0].email, lead.formValues.emailValue);
    assert.equal(fresh[0].address, lead.formValues.address);
    assert.equal(fresh[0].project_type, lead.formValues.projectType);
    assert.equal(fresh[0].status, lead.formValues.status);
    assert.equal(fresh[0].notes, lead.formValues.notesValue);
    assert.equal(Number(fresh[0].estimated_value), 12500);
    assert(lead.uiMarkerOccurrences >= 1, "The customer UI did not display the new lead.");
    checkpoint.stage = "approved-lead-verified-once";
    checkpoint.leadAttempt.outcome = "PASS";
    checkpoint.leadAttempt.result = {
      preMutationCount: baseline.count, postMutationCount: afterRows.length,
      newLeadId: fresh[0].id, originalIdsUnchanged: true,
      originalRowsUnchanged: true, newLeadValuesCorrect: true,
      estimatedValueStored: Number(fresh[0].estimated_value),
      duplicateCreated: false, customerUiVisible: true,
      generatedPostStatus: 201, databaseVerification: "PASS", unintendedMutation: false,
    };
    await saveRecoveredCheckpoint(checkpoint);
    report("approved-recovered-lead-verified", {
      projectId: state.projectId, submitClicks: checkpoint.leadAttempt.confirmedBrowserClicks,
      ...checkpoint.leadAttempt.result,
      nextTask13Step: "edit1: dark navy dashboard theme and five newest leads",
    });
  } catch (error) {
    if (checkpoint.leadAttempt && checkpoint.stage !== "approved-lead-verified-once") {
      let after = null;
      if (page) {
        try {
          const rows = await authoritativeLeadRows(page, state);
          after = {
            count: rows.length, ids: rows.map(row => row.id),
            markerIds: rows.filter(row => row.name === state.leadMarker).map(row => row.id),
            originalDigestMatches: createHash("sha256")
              .update(JSON.stringify(rows.filter(row => checkpoint.baseline.ids.includes(Number(row.id)))))
              .digest("hex") === checkpoint.leadAttempt.originalDigest,
          };
        } catch { /* Preserve the one-way guard even if read-only reconciliation is unavailable. */ }
      }
      checkpoint.stage = "approved-lead-blocked-no-retry";
      checkpoint.leadAttempt.outcome = checkpoint.leadAttempt.clickReserved
        ? "post-click-outcome-requires-review-no-retry" : "pre-click-failure-no-submit";
      checkpoint.leadAttempt.failure = safeError(error);
      checkpoint.leadAttempt.readOnlyAfterFailure = after;
      await saveRecoveredCheckpoint(checkpoint);
      report("approved-recovered-lead-blocked", {
        submitClickReserved: checkpoint.leadAttempt.clickReserved,
        confirmedBrowserClicks: checkpoint.leadAttempt.confirmedBrowserClicks,
        authoritativeAfter: after, error: safeError(error), noRetry: true,
      });
    }
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function previewPhase({ approved = false } = {}) {
  const state = await readCheckpoint();
  if (approved) {
    assert.equal(state.projectId, 5, "The one approved attempt is restricted to existing project 5.");
    assert.equal(state.agentId, "ccac2618-5f92-4d2f-b68f-ca9d2116325e");
    assert.equal(state.initialRevision, "d4bc4b85d03cfaf55326d078f08b9446b98e68b1");
    assert(
      (state.stage === "lead-outcome-uncertain" && state.actionCounts.leadSubmit === 1
        && !state.historicalLeadAttempts)
      || (state.stage === "generation-verified" && state.actionCounts.leadSubmit === 0
        && state.historicalLeadAttempts?.length === 1)
      || (state.stage === "preview-failed" && state.actionCounts.leadSubmit === 0
        && state.leadOutcome === "approved-new-attempt-not-clicked"
        && state.historicalLeadAttempts?.length === 1
        && !state.preSubmitDiagnosticResumeCount),
      "This checkpoint is not eligible for the single newly approved attempt.",
    );
  } else {
    assert(["generation-verified", "lead-submit-pending", "preview-verified"].includes(state.stage),
      "Run generation first; failed/uncertain checkpoints are not retried.");
  }
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(UI_TIMEOUT);
    page.setDefaultNavigationTimeout(UI_TIMEOUT);
    await ensureIdentity(page, state);
    const projects = projectsArray(await apiGet(page, "/api/projects", "Owner dashboard project list"));
    assert.equal(projects?.length, 1, "Preview requires exactly one customer project.");
    assert.equal(String(projects[0]?.id), String(state.projectId));
    const project = await apiGet(page, `/api/projects/${state.projectId}`, "Owner project");
    assert.equal(String(project?.agentId), state.agentId,
      "The saved project is not attached to the checkpoint's agent.");
    const currentRevision = await runtimeGet(page, state.projectId, "revision");
    assert.equal((currentRevision?.commitHash || currentRevision?.revision?.commitHash || "").toLowerCase(),
      state.initialRevision, "The saved project changed since the original generation.");

    let authoritativeBaseline = null;
    if (approved) {
      authoritativeBaseline = assertApprovedLeadBaseline(await authoritativeLeadRows(page, state), state);
      if (state.stage === "lead-outcome-uncertain" || state.stage === "preview-failed") {
        if (state.stage === "lead-outcome-uncertain") {
          state.historicalLeadAttempts = [{
            marker: state.leadMarker, submitClicks: 1,
            outcome: "no-persisted-lead-authoritatively-verified",
          }];
          state.actionCounts.leadSubmit = 0;
        } else {
          state.preSubmitDiagnosticResumeCount = 1;
        }
        state.leadMarker = `Task13 approved lead ${randomBytes(8).toString("hex")}`;
        state.leadOutcome = "approved-new-attempt-not-clicked";
        state.stage = "generation-verified";
        await saveCheckpoint(state);
      }
      report("approved-lead-baseline", {
        projectId: state.projectId, revision: state.initialRevision,
        authoritativeLeads: authoritativeBaseline, historicalSubmitClicks: 1,
        newlyApprovedSubmitClicks: 0,
      });
    }

    const status = await runtimeGet(page, state.projectId, "status");
    const previewUrl = status.previewUrl || status.previewURL || status.state?.previewUrl || status.state?.previewURL;
    assert(previewUrl, "Runtime status did not provide a preview URL.");
    const audit = attachPreviewRequestAudit(page, previewUrl);
    await openEditor(page, state.projectId);
    const frame = await previewFrame(page, previewUrl);
    // A ready document can still contain only the initial loading placeholder.
    // Do not accept or submit a lead until this existing CRM has mounted.
    await frame.waitForFunction(() => {
      const text = document.body?.innerText || "";
      return text.includes("Roofing Dashboard") && text.includes("Leads Directory")
        && !/^\s*Loading ApexRoof CRM\.{0,3}\s*$/.test(text)
        && (document.querySelector("#root")?.childElementCount || 0) > 0;
    }, { timeout: 90_000 });
    const rendered = await renderedPreviewWithAppliedStyles(page, frame);
    const resources = await assertPreviewResourceEvidence(audit, previewUrl, rendered);
    const navigation = await exercisePreviewNavigation(frame, audit);
    assert(navigation.exercised && navigation.javascriptNavigationEvidence,
      "The generated CRM did not demonstrate working in-app navigation.");
    const dataDeadline = Date.now() + 30_000;
    const observedData = endpoint => audit.requests.some(item => {
      try {
        return item.method === "GET" && item.status === 200
          && /json/i.test(item.responseHeaders?.contentType || "")
          && new URL(item.url).pathname.endsWith(`/api/${endpoint}`);
      } catch { return false; }
    });
    while (Date.now() < dataDeadline && (!observedData("stats") || !observedData("leads"))) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(observedData("stats") && observedData("leads"),
      "The mounted CRM did not complete both scoped stats and leads JSON GETs.");
    const observedJsonCandidates = audit.requests.filter(item =>
      item.method === "GET" && item.status >= 200 && item.status < 300
        && /json/i.test(item.responseHeaders?.contentType || "") && /^https?:/i.test(item.url));
    const jsonReads = await browserReadableJsonGets(frame, audit, null);
    for (const endpoint of ["stats", "leads"]) {
      assert(jsonReads.some(item => item.bodyReadable && item.status === 200
        && new URL(item.url).pathname.endsWith(`/api/${endpoint}`)),
      `The generated CRM's ${endpoint} JSON GET was not browser-readable.`);
    }
    const queryJsonCandidates = observedJsonCandidates.filter(item => {
      try { return new URL(item.url).search.length > 0; } catch { return false; }
    });
    let queryJsonEvidence = { exercised: false, reason: "No successful query-bearing JSON GET was observed." };
    if (queryJsonCandidates.length > 0) {
      const exactUrls = [...new Set(queryJsonCandidates.map(item => item.url))];
      const queryReads = jsonReads.filter(item => exactUrls.includes(item.url));
      assert(queryReads.length > 0 && queryReads.some(item => item.bodyReadable && item.status >= 200 && item.status < 300),
        "Observed query-bearing JSON GET URLs were not browser-readable with their original query strings.");
      queryJsonEvidence = {
        exercised: true, requestCount: queryJsonCandidates.length,
        testedUrls: exactUrls.map(safeObservedUrl),
        readableCount: queryReads.filter(item => item.bodyReadable).length,
      };
    }
    const dynamicJsonCandidates = observedJsonCandidates.filter(item => isDynamicRequestUrl(item.url));
    let dynamicJsonEvidence = {
      exercised: false,
      reason: "No dynamic-path/query JSON GET was observed in the generated CRM.",
    };
    if (dynamicJsonCandidates.length > 0) {
      const exactUrls = [...new Set(dynamicJsonCandidates.map(item => item.url))];
      const dynamicReads = jsonReads.filter(item => exactUrls.includes(item.url));
      assert(dynamicReads.length > 0 && dynamicReads.some(item => item.bodyReadable && item.status >= 200 && item.status < 300),
        "Observed dynamic-path/query JSON GET URLs were not browser-readable with their exact path/query.");
      dynamicJsonEvidence = {
        exercised: true, requestCount: dynamicJsonCandidates.length,
        testedUrls: exactUrls.map(safeObservedUrl),
        readableCount: dynamicReads.filter(item => item.bodyReadable).length,
      };
    }

    let lead;
    try {
      lead = await addLeadIfAvailable(page, frame, state, audit, { approved, authoritativeBaseline });
    } catch (error) {
      if (!["lead-submit-pending", "lead-outcome-uncertain"].includes(state.stage)) {
        state.stage = "preview-failed";
        await saveCheckpoint(state);
      }
      throw error;
    }
    if (state.stage !== "preview-verified") {
      state.leadOutcome = lead.available ? "not-submitted" : "not-present";
      state.stage = "preview-verified";
      await saveCheckpoint(state);
    }
    await settlePreviewAuditBodies(audit);
    report("preview-verified", {
      userId: state.userId, projectId: state.projectId, agentId: state.agentId,
      revision: state.initialRevision, previewHttpSuccess: true,
      visibleContentLength: rendered.text.length,
      resources,
      interactiveNavigation: navigation,
      javascriptExecutionEvidence: navigation.exercised && navigation.javascriptNavigationEvidence
        ? { exercised: true, proof: "In-document navigation changed application state without a document reload." }
        : { exercised: false, reason: navigation.exercised
          ? "Navigation used a document load; script resources are not treated as execution proof."
          : "No safe in-app navigation control was present; script resources are not treated as execution proof." },
      browserReadableJsonGets: {
        observedJsonGetCount: observedJsonCandidates.length,
        testedCount: jsonReads.length,
        readableCount: jsonReads.filter(item => item.bodyReadable).length,
        unexercised: observedJsonCandidates.length === 0
          ? "No successful JSON GET response was observed in the generated app."
          : undefined,
      },
      queryBearingJsonGet: queryJsonEvidence,
      dynamicJsonGet: dynamicJsonEvidence,
      requestEvidence: previewRequestEvidence(audit),
      parentPageHttpErrors: audit.parentPageHttpErrors,
      platformTelemetryErrorCount: audit.platformTelemetryErrors.length,
      corsFailures: audit.corsErrors.map(item => ({
        ...item, failure: safeError(item.failure),
      })),
      addLead: lead,
      ...(approved ? { authoritativeBaseline } : {}),
    });
  } catch (error) {
    if (!["lead-submit-pending", "lead-outcome-uncertain", "preview-failed", "preview-verified"].includes(state.stage)) {
      state.stage = "preview-failed";
      await saveCheckpoint(state);
    }
    report("preview-failed", { error: safeError(error), checkpointPath: CHECKPOINT });
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

function ensureLifecycleCounters(state) {
  state.actionCounts ??= {};
  for (const name of [
    "signup", "projectStart", "initialPrompt", "leadSubmit",
    "edit1", "publish1", "publishSame", "edit2", "publishUpdate", "returningLogout", "returningLogin", "isolationLogin",
  ]) {
    if (state.actionCounts[name] === undefined) state.actionCounts[name] = 0;
    assert(Number.isInteger(state.actionCounts[name]) && state.actionCounts[name] >= 0 && state.actionCounts[name] <= 1,
      `Checkpoint action counter ${name} is invalid.`);
  }
}

async function lifecycleOwnerPage(browser, state) {
  const page = await browser.newPage();
  page.setDefaultTimeout(UI_TIMEOUT);
  page.setDefaultNavigationTimeout(UI_TIMEOUT);
  await ensureIdentity(page, state);
  const projects = projectsArray(await apiGet(page, "/api/projects", "Lifecycle dashboard"));
  assert.equal(projects?.length, 1, "Lifecycle phases require exactly one owner project.");
  assert.equal(String(projects[0]?.id), String(state.projectId));
  return page;
}

async function lifecycleSnapshot(page, state) {
  const [project, status, revisionBody, fileBody, turns, releases, html, css] = await Promise.all([
    apiGet(page, `/api/projects/${state.projectId}`, "Owner project"),
    runtimeGet(page, state.projectId, "status"),
    runtimeGet(page, state.projectId, "revision"),
    runtimeGet(page, state.projectId, "files"),
    runtimeGet(page, state.projectId, "turns"),
    runtimeGet(page, state.projectId, "releases"),
    apiGet(page, `/api/projects/${state.projectId}/runtime/files/content?path=public%2Findex.html`, "Authoritative HTML"),
    apiGet(page, `/api/projects/${state.projectId}/runtime/files/content?path=public%2Fstyles.css`, "Authoritative CSS"),
  ]);
  const files = Array.isArray(fileBody) ? fileBody : fileBody?.files;
  const revision = revisionBody?.commitHash || revisionBody?.revision?.commitHash;
  assert.match(revision || "", /^[a-f0-9]{40}$/i, "Authoritative revision is unavailable.");
  assert.equal(status.nativeThink, true, "Owner project is no longer attached to native Think.");
  assert.equal(String(project.agentId || status.agentId), String(state.agentId));
  assert(Array.isArray(files) && files.some(file => file.path === "public/index.html"));
  assert(files.some(file => file.path === "public/styles.css"));
  assert.equal(typeof html?.content, "string");
  assert.equal(typeof css?.content, "string");
  const releaseRows = Array.isArray(releases?.releases) ? releases.releases : releases;
  assert(Array.isArray(releaseRows), "Owner release list is unavailable.");
  return { project, status, revision: revision.toLowerCase(), files, turns, releases: releaseRows, html: html.content, css: css.content };
}

function exactTurnCount(turns, prompt) {
  return findStrings(turns).filter(value => value === prompt).length;
}

function attachSuggestionAudit(page) {
  const suggestions = [];
  let client;
  const ready = (async () => {
    client = await page.target().createCDPSession();
    await client.send("Network.enable");
    client.on("Network.webSocketFrameSent", ({ response }) => {
      let frame;
      try { frame = JSON.parse(response?.payloadData || "null"); } catch { return; }
      if (frame?.type === "user_suggestion") {
        suggestions.push(typeof frame.message === "string" ? frame.message : "");
      }
    });
  })();
  return {
    suggestions,
    async waitFor(prompt, expected = 1, timeout = 12_000) {
      await ready;
      const deadline = Date.now() + timeout;
      while (suggestions.filter(item => item === prompt).length < expected && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(suggestions.filter(item => item === prompt).length, expected,
        "UI did not submit exactly the expected prompt over the normal builder connection.");
    },
    async close() { await ready; await client?.detach().catch(() => undefined); },
  };
}

async function waitForNativeUiSuccess(page) {
  await page.waitForFunction(() => {
    const value = document.querySelector('[data-testid="native-completion-state"]')?.getAttribute("data-state");
    return value === "success" || value === "error";
  }, { timeout: GENERATION_TIMEOUT });
  const state = await page.$eval('[data-testid="native-completion-state"]', node => ({
    state: node.getAttribute("data-state"),
    text: (node.textContent || "").slice(0, 160),
  }));
  assert.equal(state.state, "success", `Normal builder UI did not complete successfully: ${state.text}`);
}

async function editPreview(page, state, expectedText, editNumber) {
  const status = await runtimeGet(page, state.projectId, "status");
  const previewUrl = status.previewUrl || status.previewURL || status.state?.previewUrl || status.state?.previewURL;
  assert(previewUrl, "Runtime status omitted the owner preview URL.");
  const frame = await previewFrame(page, previewUrl);
  let rendered = await renderedPreview(page, frame);
  if (editNumber === 2) {
    const hasNewLead = await frame.evaluate(() => [...document.querySelectorAll("button,[role=button],a")]
      .some(node => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && /new\s+lead/i.test(node.textContent || node.getAttribute("aria-label") || "");
      }));
    if (!hasNewLead) {
      await frame.evaluate(() => {
        const leads = [...document.querySelectorAll("button,[role=button],a")]
          .find(node => {
            const box = node.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && /^leads?$/i.test((node.textContent || "").trim());
          });
        leads?.click();
      });
      await frame.waitForFunction(() => [...document.querySelectorAll("button,[role=button],a")]
        .some(node => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && /new\s+lead/i.test(node.textContent || node.getAttribute("aria-label") || "");
        }), { timeout: 20_000 });
      rendered = await renderedPreview(page, frame);
    }
    const button = await frame.evaluate(() => {
      const node = [...document.querySelectorAll("button,[role=button]")]
        .find(element => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && /new\s+lead/i.test(element.textContent || element.getAttribute("aria-label") || "");
        });
      if (!node) return null;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const colors = [...`${style.backgroundColor} ${style.backgroundImage}`.matchAll(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/gi)]
        .map(match => match.slice(1, 4).map(Number));
      return {
        text: (node.textContent || node.getAttribute("aria-label") || "").trim(),
        x: box.x, y: box.y, right: box.right,
        width: window.innerWidth, height: window.innerHeight,
        greenBackground: colors.some(([red, green, blue]) => green > 40 && green > red * 1.15 && green > blue * 1.15),
        disabled: node instanceof HTMLButtonElement && node.disabled,
      };
    });
    assert(button, "Updated preview does not expose a visible New Lead button on the Leads page.");
    assert.match(button.text, /new\s+lead/i);
    assert(button.x > button.width * 0.45 && button.right > button.width * 0.75 && button.y < button.height * 0.4,
      "New Lead button is not positioned in the top-right of the page.");
    assert.equal(button.greenBackground, true, "New Lead button does not have a green background.");
    assert.equal(button.disabled, false, "New Lead button is disabled.");
  }
  assert(expectedText.test(rendered.text), `Edit ${editNumber} request did not appear in the normal UI preview.`);
  return { previewUrl, rendered };
}

function previewUrlFromStatus(status) {
  return status.previewUrl || status.previewURL || status.state?.previewUrl || status.state?.previewURL || null;
}

async function assertPreviewTraffic(audit, previewUrl, rendered) {
  await new Promise(resolve => setTimeout(resolve, 250));
  const origin = new URL(previewUrl, BASE).origin;
  const requests = audit.requests.filter(item => {
    try { return new URL(item.url).origin === origin; } catch { return false; }
  });
  assert(requests.some(item => item.resourceType === "document" && item.status >= 200 && item.status < 400),
    "Runtime preview document did not return a successful response after the edit.");
  assert.equal(audit.failed.length, 0, "Edited preview has a failed network/API request.");
  assert.equal(requests.filter(item => item.status >= 400).length, 0,
    "Edited preview HTML/CSS/JS/data request returned an HTTP error.");
  assert(rendered.stylesheets > 0, "Edited preview stylesheet did not load.");
  assert(rendered.scripts > 0, "Edited preview JavaScript did not load.");
}

async function verifyEditResult(page, state, prompt, previousRevision, expectedText, editNumber, previewAudit) {
  const snapshot = await lifecycleSnapshot(page, state);
  assert.equal(exactTurnCount(snapshot.turns, prompt), 1, `Edit ${editNumber} prompt must appear exactly once.`);
  assert.notEqual(snapshot.revision, previousRevision, `Edit ${editNumber} did not produce a new committed revision.`);
  if (editNumber === 1) {
    assert(/recent.{0,20}leads/i.test(`${snapshot.html}\n${snapshot.css}`),
      "The first edit did not add a recent-leads section to authoritative files.");
    assert(/navy|#0[0-9a-f]{5}|#[01][0-9a-f]{5}|\b(?:bg-)?(?:slate|blue|indigo)-(?:8|9)\d{2}\b/i
      .test(`${snapshot.html}\n${snapshot.css}`),
      "The first edit did not produce a dark navy stylesheet treatment.");
    state.edit1Revision = snapshot.revision;
  } else {
    assert(/new\s+lead/i.test(snapshot.html), "The second edit did not add the New Lead action to authoritative HTML.");
    state.edit2Revision = snapshot.revision;
  }
  const preview = await editPreview(page, state, expectedText, editNumber);
  await assertPreviewTraffic(previewAudit, preview.previewUrl, preview.rendered);
  state.latestPreviewUrl = preview.previewUrl;
  state.stage = editNumber === 1 ? "edit1-verified" : "edit2-verified";
  await saveCheckpoint(state);
  return { revision: snapshot.revision, preview };
}

async function runEditPhase(which) {
  const prompt = which === 1 ? EDIT1_PROMPT : EDIT2_PROMPT;
  const phaseName = which === 1 ? "edit1" : "edit2";
  const pending = `${phaseName}-submit-pending`;
  const complete = `${phaseName}-verified`;
  const priorRevisionKey = which === 1 ? "initialRevision" : "edit1Revision";
  const previousStage = which === 1 ? "preview-verified" : "publish-same-verified";
  const textPattern = which === 1 ? /recent\s+leads/i : /new\s+lead/i;
  const state = await readCheckpoint();
  ensureLifecycleCounters(state);
  if (state.stage === complete) {
    report(`${phaseName}-already-verified`, { projectId: state.projectId, revision: state[`${phaseName}Revision`] });
    return;
  }
  assert(state.stage === previousStage || state.stage === pending,
    `Phase ${phaseName} requires ${previousStage}; checkpoint is ${state.stage}.`);
  const previousRevision = state[priorRevisionKey];
  assert.match(previousRevision || "", /^[a-f0-9]{40}$/i, "Previous authoritative revision is missing.");
  let browser;
  let audit;
  let previewAudit;
  try {
    browser = await launchBrowser();
    const page = await lifecycleOwnerPage(browser, state);
    const previewStatus = await runtimeGet(page, state.projectId, "status");
    const currentPreviewUrl = previewUrlFromStatus(previewStatus);
    assert(currentPreviewUrl, "Runtime status omitted its preview URL before the edit.");
    previewAudit = attachPreviewAudit(page, currentPreviewUrl);
    await openEditor(page, state.projectId);
    audit = attachSuggestionAudit(page);
    if (state.stage !== pending) await audit.waitFor(prompt, 0, 1);
    if (state.stage === pending) {
      const recovered = await lifecycleSnapshot(page, state);
      const sent = exactTurnCount(recovered.turns, prompt);
      if (sent !== 1) {
        state.stage = `${phaseName}-outcome-uncertain`;
        await saveCheckpoint(state);
        throw new Error(`Edit ${which} is pending but its exact prompt is not confirmed; no replacement edit was sent.`);
      }
      await waitForNativeUiSuccess(page);
    } else {
      const before = await lifecycleSnapshot(page, state);
      assert.equal(exactTurnCount(before.turns, prompt), 0, `Edit ${which} prompt already exists; refusing duplicate edit.`);
      assert.equal(state.actionCounts[phaseName], 0, `Edit ${which} UI action was already attempted.`);
      const input = page.locator('[data-testid="input-editor-chat"]');
      await input.fill(prompt);
      state.stage = pending;
      state.actionCounts[phaseName] = 1;
      await saveCheckpoint(state);
      await page.locator('[data-testid="button-send-chat"]').click();
      await audit.waitFor(prompt);
      await waitForNativeUiSuccess(page);
    }
    const result = await verifyEditResult(page, state, prompt, previousRevision, textPattern, which, previewAudit);
    report(`${phaseName}-verified`, {
      projectId: state.projectId, agentId: state.agentId,
      revision: result.revision, previousRevision,
      exactPromptCopies: 1, previewRendered: true,
    });
  } catch (error) {
    if (state.stage === pending) {
      state.stage = `${phaseName}-outcome-uncertain`;
      await saveCheckpoint(state);
    }
    report(`${phaseName}-failed`, { error: safeError(error) });
    throw error;
  } finally {
    await audit?.close();
    if (browser) await browser.close();
  }
}

async function reopenPhase() {
  const state = await readCheckpoint();
  ensureLifecycleCounters(state);
  if (state.stage === "reopen-verified") {
    report("reopen-already-verified", { projectId: state.projectId, revision: state.edit1Revision });
    return;
  }
  assert(["edit1-verified", "reopen-pending"].includes(state.stage),
    `Reopen requires edit1-verified; checkpoint is ${state.stage}.`);
  let browser;
  let audit;
  let previewAudit;
  try {
    browser = await launchBrowser();
    const page = await lifecycleOwnerPage(browser, state);
    const previewStatus = await runtimeGet(page, state.projectId, "status");
    const previewUrl = previewUrlFromStatus(previewStatus);
    assert(previewUrl, "Reopen could not resolve the saved runtime preview URL.");
    previewAudit = attachPreviewAudit(page, previewUrl);
    audit = attachSuggestionAudit(page);
    const project = await apiGet(page, `/api/projects/${state.projectId}`, "Dashboard project metadata");
    state.stage = "reopen-pending";
    await saveCheckpoint(state);
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    const dashboardProjects = projectsArray(await apiGet(page, "/api/projects", "Dashboard after leaving project"));
    assert.equal(dashboardProjects?.length, 1);
    assert.equal(String(dashboardProjects[0]?.id), String(state.projectId));
    await page.waitForFunction(name => [...document.querySelectorAll("button")]
      .filter(button => (button.innerText || "").trim().includes(name)).length === 1,
    { timeout: UI_TIMEOUT }, String(project.name));
    const clicked = await page.evaluate(name => {
      const matches = [...document.querySelectorAll("button")]
        .filter(button => (button.innerText || "").trim().includes(name));
      if (matches.length !== 1) return matches.length;
      matches[0].click();
      return 1;
    }, String(project.name));
    assert.equal(clicked, 1, "Dashboard did not expose exactly one clickable project card.");
    await page.waitForFunction(id => location.pathname === `/app/project/${id}`, { timeout: UI_TIMEOUT }, state.projectId);
    await openEditor(page, state.projectId);
    const snapshot = await lifecycleSnapshot(page, state);
    assert.equal(snapshot.revision, state.edit1Revision, "Dashboard reopen did not restore the first edited revision.");
    assert.equal(exactTurnCount(snapshot.turns, EDIT1_PROMPT), 1);
    assert.equal(exactTurnCount(snapshot.turns, EDIT2_PROMPT), 0);
    assert(snapshot.html.includes("recent") || snapshot.css.includes("recent"));
    const preview = await editPreview(page, state, /recent\s+leads/i, 1);
    await assertPreviewTraffic(previewAudit, preview.previewUrl, preview.rendered);
    assert.equal(audit.suggestions.length, 0, "Reopen unexpectedly sent a generation/edit suggestion.");
    state.latestPreviewUrl = preview.previewUrl;
    state.stage = "reopen-verified";
    await saveCheckpoint(state);
    report("reopen-verified", {
      projectId: state.projectId, agentId: state.agentId, revision: snapshot.revision,
      dashboardCardReopened: true, exactPromptCopies: 1, newSuggestions: 0, previewRendered: true,
    });
  } catch (error) {
    report("reopen-failed", { error: safeError(error) });
    throw error;
  } finally {
    await audit?.close();
    if (browser) await browser.close();
  }
}

function releaseId(row) {
  return String(row?.id ?? row?.releaseId ?? "");
}

function releaseRevision(row) {
  return String(row?.commitHash ?? row?.commit_hash ?? row?.revision ?? "").toLowerCase();
}

function releaseScript(row) {
  return row?.scriptName || row?.script_name || row?.script || null;
}

function releaseUrl(row) {
  return row?.deploymentUrl || row?.deployment_url || row?.publicUrl || row?.public_url || null;
}

function monitorPublishRequests(page, state = null, phaseKey = null) {
  const results = [];
  results.persisted = Promise.resolve();
  results.persistError = null;
  page.on("response", async response => {
    let pathname;
    try { pathname = new URL(response.url()).pathname; } catch { return; }
    if (!pathname.endsWith("/runtime/publish-immutable-v2")) return;
    const body = await response.json().catch(() => null);
    const release = body?.release ?? {};
    const result = {
      status: response.status(),
      alreadyPublished: body?.alreadyPublished === true,
      releaseId: releaseId(release) || null,
      scriptName: releaseScript(release),
      deploymentUrl: body?.deploymentUrl || releaseUrl(release),
      commitHash: releaseRevision(release),
    };
    results.push(result);
    if (state && phaseKey) {
      results.persisted = results.persisted.then(async () => {
        state.lastPublishEvidence = { phase: phaseKey, ...result };
        await saveCheckpoint(state);
      }).catch(error => { results.persistError = error; });
    }
  });
  return results;
}

async function waitForPublishResult(results, expected, timeout = 310_000) {
  const deadline = Date.now() + timeout;
  while (results.length < expected && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(results.length, expected, `Expected exactly ${expected} normal UI publish response(s).`);
  await results.persisted;
  assert.equal(results.persistError, null, "Could not persist the observed Publish response before proceeding.");
}

async function openPublishDrawer(page) {
  await page.locator('[data-testid="button-open-native-publish"]').click();
  await page.waitForSelector('[data-testid="publishing-drawer"]', { visible: true, timeout: UI_TIMEOUT });
  await page.waitForSelector('[data-testid="button-publish-native"]', { visible: true, timeout: UI_TIMEOUT });
}

async function waitForPublishUi(page) {
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-testid="native-publish-status"]')?.textContent || "";
    return /published|publish failed/i.test(text);
  }, { timeout: 310_000 });
  const status = await page.$eval('[data-testid="native-publish-status"]', node => node.textContent || "");
  assert.match(status, /published/i, "Normal BuildCustom Publish UI reported failure.");
  assert.doesNotMatch(status, /publish failed/i);
  return status;
}

function validatePublicUrl(value, slug) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:");
  assert(url.hostname.endsWith(".apps.buildcustom.ai"), "Publish did not return a current public apps.buildcustom.ai URL.");
  assert.equal(url.hostname, `${slug}.apps.buildcustom.ai`, "Published URL does not match the saved stable slug.");
  return url.href;
}

function extractPublicAssets(html, publicUrl) {
  const base = new URL(publicUrl);
  const assetUrl = raw => {
    const url = new URL(raw, base);
    assert.equal(url.protocol, "https:", "Public app asset URLs must use HTTPS.");
    const knownPublicAssetHost = /^(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com|cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com)$/i
      .test(url.hostname);
    assert(url.hostname === base.hostname || url.hostname.endsWith(".apps.buildcustom.ai") || knownPublicAssetHost,
      "Public app referenced an unexpected asset host.");
    return url.href;
  };
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]);
  const css = links.flatMap(tag => {
    if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) return [];
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    return href ? [assetUrl(href)] : [];
  });
  const scripts = [];
  const inlineScripts = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const src = match[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (src) scripts.push(assetUrl(src));
    else if (match[2].trim() && !/application\/json/i.test(match[1])) inlineScripts.push(match[2]);
  }
  const inlineStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .map(match => match[1]).filter(Boolean);
  assert(css.length > 0 || inlineStyles.length > 0, "Public HTML contains no CSS stylesheet or inline styles.");
  assert(scripts.length > 0 || inlineScripts.length > 0, "Public HTML contains no executable JavaScript.");
  return { css, scripts, inlineStyles, inlineScripts };
}

async function verifyPublicApplication(browser, publicUrl, state, expectedContent) {
  const url = validatePublicUrl(publicUrl, state.slug);
  const response = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `Public app returned HTTP ${response.status}.`);
  assert((response.headers.get("content-type") || "").includes("text/html"), "Public app did not serve HTML.");
  const html = await response.text();
  assert(html.length > 500, "Public HTML response is empty or truncated.");
  const assets = extractPublicAssets(html, url);
  assert(!state.identity?.password || !html.includes(state.identity.password), "Customer password leaked into public HTML.");
  assert(!state.identity?.email || !html.includes(state.identity.email), "Customer email leaked into public HTML.");
  assert(!/\b(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_AI_GATEWAY_TOKEN|JWT_SECRET|AUTH_RUNTIME)\b/.test(html),
    "Public HTML exposes a private product binding name.");

  const assetContent = { css: [], scripts: [] };
  for (const [kind, urls] of [["css", assets.css], ["scripts", assets.scripts]]) {
    for (const asset of urls) {
      const result = await fetch(asset, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000) });
      assert.equal(result.status, 200, `Public ${kind} asset returned HTTP ${result.status}.`);
      const contentType = result.headers.get("content-type") || "";
      assert(kind === "css" ? /text\/css/i.test(contentType) : /javascript|ecmascript/i.test(contentType),
        `Public ${kind} asset has an unexpected content type.`);
      const content = await result.text();
      assert(content.length > 0, `Public ${kind} asset is empty.`);
      assert(!state.identity?.password || !content.includes(state.identity.password), `Customer password leaked into public ${kind}.`);
      assert(!state.identity?.email || !content.includes(state.identity.email), `Customer email leaked into public ${kind}.`);
      assert(!/\b(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_AI_GATEWAY_TOKEN|JWT_SECRET|AUTH_RUNTIME)\b/.test(content),
        `Public ${kind} exposes a private product binding name.`);
      assetContent[kind].push(content);
    }
  }

  // Use a fresh, cookie-free browser context: public application loads never
  // inherit the customer's app.buildcustom.ai session.
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(UI_TIMEOUT);
    assert.equal((await page.cookies(BASE)).length, 0,
      "Cookie-free public browser context unexpectedly contains BuildCustom product credentials.");
    const resourceResponses = [];
    const appErrors = [];
    const failedResources = [];
    const publicJsonReads = [];
    page.on("response", response => {
      try {
        const contentType = response.headers()["content-type"] || "";
        if (response.request().method() === "GET" && /json/i.test(contentType)) {
          publicJsonReads.push({ status: response.status(), bytes: Number(response.headers()["content-length"] || 0) });
        }
        if (new URL(response.url()).hostname === new URL(url).hostname) {
          const type = response.request().resourceType();
          resourceResponses.push({ type, status: response.status() });
        }
      } catch { /* Ignore browser-internal URLs. */ }
    });
    page.on("requestfailed", request => {
      try {
        const requestUrl = new URL(request.url());
        if (requestUrl.hostname === new URL(url).hostname
          && !requestUrl.pathname.startsWith("/cdn-cgi/rum")
          && ["document", "stylesheet", "script", "fetch", "xhr"].includes(request.resourceType())) {
          failedResources.push(request.resourceType());
        }
      } catch { /* Ignore browser-internal URLs. */ }
    });
    page.on("pageerror", error => appErrors.push(String(error?.message || "page error")));
    const navigation = await page.goto(url, { waitUntil: "domcontentloaded", timeout: UI_TIMEOUT });
    assert(navigation && navigation.status() === 200, "Cookie-free public browser navigation did not return HTTP 200.");
    await page.waitForFunction(() => document.readyState === "interactive" || document.readyState === "complete",
      { timeout: UI_TIMEOUT });
    await new Promise(resolve => setTimeout(resolve, 2_000));
    let publicNewLeadButton = null;
    if (expectedContent.test("New Lead")) {
      const hasNewLead = await page.evaluate(() => [...document.querySelectorAll("button,[role=button],a")]
        .some(node => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && /new\s+lead/i.test(node.textContent || node.getAttribute("aria-label") || "");
        }));
      if (!hasNewLead) {
        await page.evaluate(() => {
          const leads = [...document.querySelectorAll("button,[role=button],a")]
            .find(node => {
              const box = node.getBoundingClientRect();
              return box.width > 0 && box.height > 0 && /^leads?$/i.test((node.textContent || "").trim());
            });
          leads?.click();
        });
        await page.waitForFunction(() => [...document.querySelectorAll("button,[role=button],a")]
          .some(node => {
            const box = node.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && /new\s+lead/i.test(node.textContent || node.getAttribute("aria-label") || "");
          }), { timeout: 20_000 });
      }
      publicNewLeadButton = await page.evaluate(() => {
        const node = [...document.querySelectorAll("button,[role=button]")]
          .find(element => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && /new\s+lead/i.test(element.textContent || element.getAttribute("aria-label") || "");
          });
        if (!node) return null;
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const colors = [...`${style.backgroundColor} ${style.backgroundImage}`.matchAll(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/gi)]
          .map(match => match.slice(1, 4).map(Number));
        return {
          x: box.x, y: box.y, right: box.right, width: innerWidth, height: innerHeight,
          greenBackground: colors.some(([red, green, blue]) => green > 40 && green > red * 1.15 && green > blue * 1.15),
        };
      });
      assert(publicNewLeadButton, "Updated public app does not show a New Lead button.");
      assert(publicNewLeadButton.x > publicNewLeadButton.width * 0.45
        && publicNewLeadButton.right > publicNewLeadButton.width * 0.75
        && publicNewLeadButton.y < publicNewLeadButton.height * 0.4,
      "Public New Lead button is not positioned in the top-right.");
      assert.equal(publicNewLeadButton.greenBackground, true, "Public New Lead button is not green.");
    }
    const rendered = await page.evaluate(() => ({
      text: document.body?.innerText?.trim() || "",
      scripts: [...document.scripts].filter(script => script.src).length,
      stylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')].length
        + [...document.querySelectorAll("style")].length,
      dataRows: [...document.querySelectorAll("tr, [role=row]")].filter(node =>
        (node.innerText || "").trim().length > 0).length,
      metricValues: (document.body?.innerText?.match(/\b\d[\d,]*(?:\.\d+)?\b|\$\s*\d[\d,]*(?:\.\d+)?/g) || []).length,
    }));
    assert(rendered.text.length > 0, "Public application produced no visible content.");
    assert(expectedContent.test(rendered.text), "Public application did not render the latest requested customer content.");
    assert(resourceResponses.some(item => item.type === "document" && item.status === 200));
    assert.equal(resourceResponses.filter(item => item.status >= 400
      && ["document", "stylesheet", "script", "fetch", "xhr"].includes(item.type)).length, 0,
      "Public application has an HTTP-failed resource.");
    assert.equal(failedResources.length, 0, "Public application has a failed HTML/CSS/JS/API request.");
    assert(publicJsonReads.every(item => item.status >= 200 && item.status < 300),
      "A public application data GET returned an HTTP error.");
    assert(publicJsonReads.length > 0 || rendered.dataRows > 1 || rendered.metricValues >= 2,
      "Public generated app showed no readable data API response or populated data rows.");
    assert.equal(appErrors.length, 0, "Public application raised a browser JavaScript error.");
    assert(rendered.scripts > 0 || assets.inlineScripts.length > 0, "Public JavaScript did not load or execute.");
    assert(rendered.stylesheets > 0 || assets.inlineStyles.length > 0, "Public CSS did not load.");
    return {
      url, htmlBytes: html.length, cssAssetCount: assets.css.length,
      scriptAssetCount: assets.scripts.length, inlineScripts: assets.inlineScripts.length,
      visibleContentLength: rendered.text.length, browserJsErrors: appErrors.length,
      browserResourceResponses: resourceResponses.length, publicJsonReads: publicJsonReads.length,
      visibleDataRows: rendered.dataRows, visibleMetricValues: rendered.metricValues, publicAppHasDataContent: true,
      ...(publicNewLeadButton ? { newLeadButton: publicNewLeadButton } : {}),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function drawerPublicUrl(page) {
  await page.waitForFunction(() => document.querySelector('[data-testid="link-native-public-url"]')?.href,
    { timeout: 20_000 });
  return page.$eval('[data-testid="link-native-public-url"]', node => node.href);
}

function matchingReleases(snapshot, predicate) {
  return snapshot.releases.filter(predicate);
}

async function reconcilePublish1(page, state, browser) {
  const snapshot = await lifecycleSnapshot(page, state);
  assert.equal(snapshot.releases.length, 1, "Pending first Publish did not reconcile to exactly one immutable release.");
  const matches = matchingReleases(snapshot, row =>
    releaseRevision(row) === String(state.edit1Revision).toLowerCase()
    && String(row.subdomainSlug || row.slug || state.slug) === state.slug);
  if (matches.length !== 1) {
    state.stage = "publish1-outcome-uncertain";
    await saveCheckpoint(state);
    throw new Error("Pending Publish has no single matching owner release; refusing another Publish click.");
  }
  const release = matches[0];
  const publicUrl = releaseUrl(release) || `https://${state.slug}.apps.buildcustom.ai`;
  state.releaseId = releaseId(release);
  state.scriptName = releaseScript(release);
  state.deploymentUrl = validatePublicUrl(publicUrl, state.slug);
  await openEditor(page, state.projectId);
  await openPublishDrawer(page);
  const drawerUrl = await drawerPublicUrl(page);
  assert.equal(validatePublicUrl(drawerUrl, state.slug), state.deploymentUrl);
  const publicEvidence = await verifyPublicApplication(browser, state.deploymentUrl, state, /recent\s+leads/i);
  state.stage = "publish1-verified";
  await saveCheckpoint(state);
  return { release, publicEvidence, reconciled: true };
}

async function publish1Phase() {
  const state = await readCheckpoint();
  ensureLifecycleCounters(state);
  if (state.stage === "publish1-verified") {
    report("publish1-already-verified", { releaseId: state.releaseId, scriptName: state.scriptName, publicUrl: state.deploymentUrl });
    return;
  }
  assert(["reopen-verified", "publish1-pending"].includes(state.stage),
    `publish1 requires reopen-verified; checkpoint is ${state.stage}.`);
  let browser;
  let requests = [];
  try {
    browser = await launchBrowser();
    const page = await lifecycleOwnerPage(browser, state);
    const before = await lifecycleSnapshot(page, state);
    assert.equal(before.revision, state.edit1Revision, "publish1 must publish the verified first-edit revision.");
    if (state.stage === "publish1-pending") {
      const recovered = await reconcilePublish1(page, state, browser);
      report("publish1-reconciled", {
        releaseId: state.releaseId, scriptName: state.scriptName, publicUrl: state.deploymentUrl,
        publicHtmlCssJsData: recovered.publicEvidence,
      });
      return;
    }
    assert.equal(before.releases.length, 0, "The first publish phase expected no earlier releases.");
    assert.equal(state.actionCounts.publish1, 0, "First Publish was already attempted.");
    await openEditor(page, state.projectId);
    await openPublishDrawer(page);
    state.slug ??= `task13-${randomBytes(7).toString("hex")}`;
    const slugField = page.locator('[data-testid="input-native-publish-slug"]');
    await slugField.fill(state.slug);
    await page.waitForFunction(expected => document.querySelector('[data-testid="input-native-publish-slug"]')?.value === expected,
      { timeout: UI_TIMEOUT }, state.slug);
    requests = monitorPublishRequests(page, state, "publish1");
    state.stage = "publish1-pending";
    state.actionCounts.publish1 = 1;
    await saveCheckpoint(state);
    await page.locator('[data-testid="button-publish-native"]').click();
    await waitForPublishUi(page);
    await waitForPublishResult(requests, 1);
    assert(requests[0].status >= 200 && requests[0].status < 300, "First normal UI Publish request failed.");
    assert.equal(requests.length, 1, "One Publish click made multiple immutable publish requests.");
    const link = await drawerPublicUrl(page);
    const publicUrl = validatePublicUrl(link, state.slug);
    assert.equal(requests[0].deploymentUrl, publicUrl, "Publish API and customer UI returned different public URLs.");
    assert(requests[0].releaseId && requests[0].scriptName, "Publish response omitted release/script identities.");
    const after = await lifecycleSnapshot(page, state);
    assert.equal(after.releases.length, 1, "First publish did not create exactly one immutable release.");
    assert.equal(releaseId(after.releases[0]), requests[0].releaseId);
    assert.equal(releaseScript(after.releases[0]), requests[0].scriptName);
    assert.equal(releaseRevision(after.releases[0]), state.edit1Revision);
    const publicEvidence = await verifyPublicApplication(browser, publicUrl, state, /recent\s+leads/i);
    state.releaseId = requests[0].releaseId;
    state.scriptName = requests[0].scriptName;
    state.deploymentUrl = publicUrl;
    state.stage = "publish1-verified";
    await saveCheckpoint(state);
    report("publish1-verified", {
      projectId: state.projectId, releaseId: state.releaseId, scriptName: state.scriptName,
      revision: state.edit1Revision, publicUrl, publicHtmlCssJsData: publicEvidence,
    });
  } catch (error) {
    report("publish1-failed", { error: safeError(error) });
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function publishSamePhase() {
  const state = await readCheckpoint();
  ensureLifecycleCounters(state);
  if (state.stage === "publish-same-verified") {
    report("publish-same-already-verified", {
      releaseId: state.releaseId, scriptName: state.scriptName, publicUrl: state.deploymentUrl,
    });
    return;
  }
  assert(["publish1-verified", "publish-same-pending"].includes(state.stage),
    `publishSame requires publish1-verified; checkpoint is ${state.stage}.`);
  let browser;
  try {
    browser = await launchBrowser();
    const page = await lifecycleOwnerPage(browser, state);
    const before = await lifecycleSnapshot(page, state);
    assert.equal(before.revision, state.edit1Revision, "Same-revision publish must not include another edit.");
    assert.equal(before.releases.length, 1, "Same-revision publish requires exactly one existing release.");
    const original = before.releases.find(row => releaseId(row) === state.releaseId);
    assert(original, "The first immutable release disappeared before the same-revision check.");
    assert.equal(releaseRevision(original), state.edit1Revision);

    if (state.stage === "publish-same-pending") {
      const evidence = state.lastPublishEvidence;
      const reconciled = evidence?.phase === "publishSame"
        && evidence.alreadyPublished === true
        && evidence.releaseId === state.releaseId
        && evidence.scriptName === state.scriptName
        && evidence.deploymentUrl === state.deploymentUrl;
      if (!reconciled) {
        state.stage = "publish-same-outcome-uncertain";
        await saveCheckpoint(state);
        throw new Error("The same-revision Publish click is pending without persisted response evidence; no retry was made.");
      }
      assert.equal(before.releases.length, 1, "Pending same-revision publish created another immutable release.");
      await openEditor(page, state.projectId);
      await openPublishDrawer(page);
      assert.equal(validatePublicUrl(await drawerPublicUrl(page), state.slug), state.deploymentUrl);
      state.stage = "publish-same-verified";
      await saveCheckpoint(state);
      report("publish-same-reconciled", {
        releaseId: state.releaseId, scriptName: state.scriptName,
        publicUrl: state.deploymentUrl, alreadyPublished: true, releaseCount: 1,
      });
      return;
    }

    assert.equal(state.actionCounts.publishSame, 0, "Same-revision Publish was already attempted.");
    await openEditor(page, state.projectId);
    await openPublishDrawer(page);
    assert.equal(validatePublicUrl(await drawerPublicUrl(page), state.slug), state.deploymentUrl);
    const requests = monitorPublishRequests(page, state, "publishSame");
    state.stage = "publish-same-pending";
    state.actionCounts.publishSame = 1;
    await saveCheckpoint(state);
    await page.locator('[data-testid="button-publish-native"]').click();
    await waitForPublishUi(page);
    await waitForPublishResult(requests, 1);
    const response = requests[0];
    assert(response.status >= 200 && response.status < 300, "Same-revision Publish did not return successfully.");
    assert.equal(requests.length, 1, "One same-revision Publish click sent more than one immutable publish request.");
    assert.equal(response.alreadyPublished, true, "Same-revision Publish did not report alreadyPublished.");
    assert.equal(response.releaseId, state.releaseId, "Same-revision Publish changed the immutable release ID.");
    assert.equal(response.scriptName, state.scriptName, "Same-revision Publish changed the immutable script identity.");
    assert.equal(response.deploymentUrl, state.deploymentUrl, "Same-revision Publish changed the stable URL.");
    const after = await lifecycleSnapshot(page, state);
    assert.equal(after.releases.length, 1, "Same-revision Publish created a duplicate release row.");
    assert.equal(releaseId(after.releases[0]), state.releaseId);
    assert.equal(releaseRevision(after.releases[0]), state.edit1Revision);
    assert.equal(validatePublicUrl(await drawerPublicUrl(page), state.slug), state.deploymentUrl);
    state.stage = "publish-same-verified";
    await saveCheckpoint(state);
    report("publish-same-verified", {
      releaseId: state.releaseId, scriptName: state.scriptName,
      publicUrl: state.deploymentUrl, alreadyPublished: true, releaseCount: 1,
      publishRequests: 1,
    });
  } catch (error) {
    report("publish-same-failed", { error: safeError(error) });
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function publishUpdatePhase() {
  const state = await readCheckpoint();
  ensureLifecycleCounters(state);
  if (state.stage === "publish-update-verified") {
    report("publish-update-already-verified", {
      releaseId: state.updatedReleaseId, scriptName: state.updatedScriptName, publicUrl: state.deploymentUrl,
    });
    return;
  }
  assert(["edit2-verified", "publish-update-pending"].includes(state.stage),
    `publishUpdate requires edit2-verified; checkpoint is ${state.stage}.`);
  let browser;
  try {
    browser = await launchBrowser();
    const page = await lifecycleOwnerPage(browser, state);
    const before = await lifecycleSnapshot(page, state);
    assert.equal(before.revision, state.edit2Revision, "Publish update must use the second edited revision.");
    const previous = before.releases.find(row => releaseId(row) === state.releaseId);
    assert(previous, "The original immutable release is missing before Publish updates.");
    assert.equal(releaseRevision(previous), state.edit1Revision);
    assert.equal(state.deploymentUrl, `https://${state.slug}.apps.buildcustom.ai`,
      "Saved stable public URL is inconsistent with the original slug.");

    if (state.stage === "publish-update-pending") {
      const newRows = before.releases.filter(row => releaseRevision(row) === state.edit2Revision
        && (row.subdomainSlug || row.slug || state.slug) === state.slug);
      if (newRows.length !== 1 || before.releases.length !== 2) {
        state.stage = "publish-update-outcome-uncertain";
        await saveCheckpoint(state);
        throw new Error("Pending Publish updates has no single matching new immutable release; no retry was made.");
      }
      const updated = newRows[0];
      assert.equal(releaseId(updated), state.lastPublishEvidence?.releaseId || releaseId(updated));
      assert.equal(releaseId(previous), state.releaseId);
      assert.equal(releaseScript(previous), state.scriptName);
      const publicEvidence = await verifyPublicApplication(browser, state.deploymentUrl, state, /new\s+lead/i);
      state.updatedReleaseId = releaseId(updated);
      state.updatedScriptName = releaseScript(updated);
      state.stage = "publish-update-verified";
      await saveCheckpoint(state);
      report("publish-update-reconciled", {
        priorReleaseId: state.releaseId, releaseId: state.updatedReleaseId,
        scriptName: state.updatedScriptName, publicUrl: state.deploymentUrl,
        previousReleasePreserved: true, publicHtmlCssJsData: publicEvidence,
      });
      return;
    }

    assert.equal(before.releases.length, 1, "Publish updates expected exactly one prior immutable release.");
    assert.equal(state.actionCounts.publishUpdate, 0, "Publish updates was already attempted.");
    await openEditor(page, state.projectId);
    await openPublishDrawer(page);
    assert.equal(validatePublicUrl(await drawerPublicUrl(page), state.slug), state.deploymentUrl);
    const requests = monitorPublishRequests(page, state, "publishUpdate");
    state.stage = "publish-update-pending";
    state.actionCounts.publishUpdate = 1;
    await saveCheckpoint(state);
    await page.locator('[data-testid="button-publish-native"]').click();
    await waitForPublishUi(page);
    await waitForPublishResult(requests, 1);
    const response = requests[0];
    assert(response.status >= 200 && response.status < 300, "Publish updates did not return successfully.");
    assert.equal(requests.length, 1, "One Publish updates click sent multiple immutable publish requests.");
    assert.equal(response.alreadyPublished, false, "Changed revision was incorrectly treated as already published.");
    assert(response.releaseId && response.releaseId !== state.releaseId, "Changed revision reused the prior release ID.");
    assert(response.scriptName && response.scriptName !== state.scriptName, "Changed revision reused the prior script identity.");
    assert.equal(response.deploymentUrl, state.deploymentUrl, "Publish updates changed the stable public URL.");
    const after = await lifecycleSnapshot(page, state);
    assert.equal(after.releases.length, 2, "Publish updates did not retain exactly two immutable release rows.");
    const oldRelease = after.releases.find(row => releaseId(row) === state.releaseId);
    const updated = after.releases.find(row => releaseId(row) === response.releaseId);
    assert(oldRelease && updated, "The original or updated immutable release row is missing.");
    assert.equal(releaseRevision(oldRelease), state.edit1Revision);
    assert.equal(releaseScript(oldRelease), state.scriptName);
    assert.equal(releaseRevision(updated), state.edit2Revision);
    assert.equal(releaseScript(updated), response.scriptName);
    const publicEvidence = await verifyPublicApplication(browser, state.deploymentUrl, state, /new\s+lead/i);
    state.updatedReleaseId = response.releaseId;
    state.updatedScriptName = response.scriptName;
    state.stage = "publish-update-verified";
    await saveCheckpoint(state);
    report("publish-update-verified", {
      priorReleaseId: state.releaseId, releaseId: state.updatedReleaseId,
      scriptName: state.updatedScriptName, revision: state.edit2Revision,
      publicUrl: state.deploymentUrl, stableUrlUnchanged: true,
      previousReleasePreserved: true, publicHtmlCssJsData: publicEvidence,
    });
  } catch (error) {
    report("publish-update-failed", { error: safeError(error) });
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function readAuthenticationCookie(page) {
  const client = await page.target().createCDPSession();
  try {
    await client.send("Network.enable");
    const result = await client.send("Network.getAllCookies");
    const host = new URL(BASE).hostname;
    const cookies = (result.cookies || []).filter(cookie =>
      cookie.domain.replace(/^\./, "") === host
      && /session|access.?token|auth.?token|oauth.?token/i.test(cookie.name)
      && !/csrf/i.test(cookie.name)
      && cookie.value);
    assert(cookies.length > 0, "Could not inspect the current product authentication cookie.");
    return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
  } finally {
    await client.detach().catch(() => undefined);
  }
}

async function returningPhase() {
  const state = await readCheckpoint();
  ensureLifecycleCounters(state);
  if (state.stage === "returning-verified") {
    report("returning-already-verified", { userId: state.userId, projectId: state.projectId, revision: state.edit2Revision });
    return;
  }
  assert(["publish-update-verified", "returning-logout-pending", "returning-login-pending"].includes(state.stage),
    `returning requires publish-update-verified; checkpoint is ${state.stage}.`);
  let browser;
  let previewAudit;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(UI_TIMEOUT);
    page.setDefaultNavigationTimeout(UI_TIMEOUT);

    if (state.stage === "returning-logout-pending") {
      state.stage = "returning-outcome-uncertain";
      await saveCheckpoint(state);
      throw new Error("Logout was pending across process restart; the old session cookie was not retained, so logout will not be repeated.");
    }

    if (state.stage === "publish-update-verified") {
      const identity = await ensureIdentity(page, state);
      assert.equal(identity.userId, state.userId);
      await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="button-logout"]', { visible: true, timeout: UI_TIMEOUT });
      const oldCookie = await readAuthenticationCookie(page);
      assert.equal(state.actionCounts.returningLogout, 0, "Returning-customer logout was already attempted.");
      state.stage = "returning-logout-pending";
      state.actionCounts.returningLogout = 1;
      await saveCheckpoint(state);
      await page.locator('[data-testid="button-logout"]').click();
      await page.waitForFunction(() => location.pathname === "/login" || location.pathname === "/app/login",
        { timeout: UI_TIMEOUT });
      const afterLogout = await authMe(page);
      assert(afterLogout.status !== 200 || afterLogout.userId === null,
        "Normal logout left the customer authenticated in the product UI.");
      const remainingCookies = await page.cookies(BASE);
      assert.equal(remainingCookies.some(cookie =>
        /session|access.?token|auth.?token|oauth.?token/i.test(cookie.name) && !/csrf/i.test(cookie.name)), false,
      "Normal logout did not clear the product authentication cookie.");
      const revoked = await fetch(`${BASE}/api/auth/me`, {
        headers: { Cookie: oldCookie }, redirect: "manual", cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const revokedBody = await revoked.json().catch(() => null);
      assert([401, 403].includes(revoked.status) || (revoked.status === 200 && revokedBody?.id == null),
        "The exact pre-logout product session remained valid.");
      state.stage = "returning-login-pending";
      assert.equal(state.actionCounts.returningLogin, 0, "Returning-customer login was already attempted.");
      state.actionCounts.returningLogin = 1;
      await saveCheckpoint(state);
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="input-email"]').fill(state.identity.email);
      await page.locator('[data-testid="input-password"]').fill(state.identity.password);
      await page.locator('[data-testid="button-submit"]').click();
      await page.waitForFunction(() => location.pathname === "/app" || location.pathname === "/app/", { timeout: UI_TIMEOUT });
    } else {
      // A fresh UI login may have completed before interruption. Reconcile by
      // session identity only; never submit another login from a pending stage.
      await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
      const identity = await authMe(page);
      if (identity.status !== 200 || identity.userId !== state.userId) {
        state.stage = "returning-login-outcome-uncertain";
        await saveCheckpoint(state);
        throw new Error("Returning-customer login outcome is uncertain; no second login submit was made.");
      }
    }

    const identity = await authMe(page);
    assert.equal(identity.status, 200, "Normal customer login did not restore an authenticated session.");
    assert.equal(identity.userId, state.userId, "Returning login changed the customer identity.");
    const dashboard = projectsArray(await apiGet(page, "/api/projects", "Returning customer dashboard"));
    assert.equal(dashboard?.length, 1);
    assert.equal(String(dashboard[0]?.id), String(state.projectId));
    const previewStatus = await runtimeGet(page, state.projectId, "status");
    const currentPreviewUrl = previewUrlFromStatus(previewStatus);
    assert(currentPreviewUrl, "Returning customer could not resolve the latest runtime preview URL.");
    previewAudit = attachPreviewAudit(page, currentPreviewUrl);
    await openEditor(page, state.projectId);
    const snapshot = await lifecycleSnapshot(page, state);
    assert.equal(snapshot.revision, state.edit2Revision);
    assert.equal(exactTurnCount(snapshot.turns, EDIT1_PROMPT), 1);
    assert.equal(exactTurnCount(snapshot.turns, EDIT2_PROMPT), 1);
    assert.equal(snapshot.releases.length, 2);
    assert(snapshot.releases.some(row => releaseId(row) === state.releaseId && releaseRevision(row) === state.edit1Revision));
    assert(snapshot.releases.some(row => releaseId(row) === state.updatedReleaseId && releaseRevision(row) === state.edit2Revision));
    assert.equal(snapshot.status.deploymentUrl, state.deploymentUrl,
      "Published stable URL is no longer associated with the returning customer's project.");
    const preview = await editPreview(page, state, /new\s+lead/i, 2);
    await assertPreviewTraffic(previewAudit, preview.previewUrl, preview.rendered);
    state.latestPreviewUrl = preview.previewUrl;
    state.stage = "returning-verified";
    await saveCheckpoint(state);
    report("returning-verified", {
      userId: state.userId, projectId: state.projectId, agentId: state.agentId,
      revision: state.edit2Revision, priorSessionRevoked: true,
      normalLoginPreservedProject: true, conversationAndFilesPersisted: true,
      previewRendered: true, publicUrl: state.deploymentUrl,
    });
  } catch (error) {
    report("returning-failed", { error: safeError(error) });
    throw error;
  } finally {
    // The browser target closes immediately after this phase; the audit has no
    // private data beyond request metadata and needs no separate CDP cleanup.
    if (browser) await browser.close();
  }
}

async function isolationPhase() {
  const state = await readCheckpoint();
  ensureLifecycleCounters(state);
  if (state.stage === "isolation-verified") {
    report("isolation-already-verified", {
      testerId: TESTER_ID, projectId: state.projectId, deniedReadEndpoints: state.isolationDeniedStatuses?.length || 0,
    });
    return;
  }
  assert(["returning-verified", "isolation-login-pending"].includes(state.stage),
    `isolation requires returning-verified; checkpoint is ${state.stage}.`);
  const password = process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD;
  assert(typeof password === "string" && password.length > 0,
    "Set BUILDCUSTOM_CUTOVER_TESTER_PASSWORD for the existing independent tester account.");
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(UI_TIMEOUT);
    page.setDefaultNavigationTimeout(UI_TIMEOUT);

    if (state.stage === "isolation-login-pending") {
      await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
      const identity = await authMe(page);
      if (identity.status !== 200 || identity.userId !== TESTER_ID) {
        state.stage = "isolation-outcome-uncertain";
        await saveCheckpoint(state);
        throw new Error("Independent tester login outcome is uncertain; no second tester login was submitted.");
      }
    } else {
      await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
      const current = await authMe(page);
      if (current.status === 200 && current.userId === TESTER_ID) {
        // A previous process reached the tester session but did not persist its
        // phase completion; continue with read-only ownership checks.
      } else {
        if (current.status === 200) await clearProductSession(page);
        await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
        await page.locator('[data-testid="input-email"]').fill(TESTER_EMAIL);
        await page.locator('[data-testid="input-password"]').fill(password);
        assert.equal(state.actionCounts.isolationLogin, 0, "Independent tester login was already attempted.");
        state.stage = "isolation-login-pending";
        state.actionCounts.isolationLogin = 1;
        await saveCheckpoint(state);
        await page.locator('[data-testid="button-submit"]').click();
        await page.waitForFunction(() => location.pathname === "/app" || location.pathname === "/app/", { timeout: UI_TIMEOUT });
      }
    }

    const identity = await authMe(page);
    assert.equal(identity.status, 200, "Existing independent tester account did not authenticate.");
    assert.equal(identity.userId, TESTER_ID, "Isolation test did not use the configured independent tester identity.");
    const dashboard = projectsArray(await apiGet(page, "/api/projects", "Independent tester dashboard"));
    assert(dashboard, "Independent tester dashboard returned an invalid project list.");
    assert(!dashboard.some(project => String(project.id) === String(state.projectId)),
      "Independent tester dashboard exposed the new customer's project.");

    const routes = [
      [`/api/projects/${state.projectId}`, "project"],
      [`/api/projects/${state.projectId}/runtime/status`, "status-and-preview"],
      [`/api/projects/${state.projectId}/runtime/revision`, "revision"],
      [`/api/projects/${state.projectId}/runtime/files`, "files"],
      [`/api/projects/${state.projectId}/runtime/files/content?path=public%2Findex.html`, "file-content"],
      [`/api/projects/${state.projectId}/runtime/turns`, "conversation"],
      [`/api/projects/${state.projectId}/runtime/publishing-settings`, "publish-controls"],
      [`/api/projects/${state.projectId}/runtime/releases`, "releases"],
    ];
    const denied = [];
    for (const [pathname, label] of routes) {
      const result = await browserApi(page, pathname);
      if (![401, 403, 404].includes(result.status)) {
        throw new Error(`Independent tester read access to owner ${label} was not denied (HTTP ${result.status}).`);
      }
      denied.push({ resource: label, status: result.status });
    }
    assert(state.latestPreviewUrl, "Checkpoint does not contain the owner's latest preview URL.");
    const previewResponse = await fetch(state.latestPreviewUrl, {
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    const previewStatus = previewResponse.status;
    await previewResponse.body?.cancel().catch(() => undefined);
    assert([401, 403, 404].includes(previewStatus),
      `Independent tester could read the owner's private preview (HTTP ${previewStatus}).`);

    await page.goto(`${BASE}/app/project/${state.projectId}`, { waitUntil: "domcontentloaded" });
    const deniedUi = await page.waitForFunction(() => {
      const text = document.body?.innerText || "";
      return /project not found|not found|unable to load|access denied/i.test(text);
    }, { timeout: 15_000 }).then(() => true).catch(() => false);
    assert(deniedUi, "Independent tester's direct project UI did not show an access-denied/not-found state.");
    assert.equal(await page.$('[data-testid="button-open-native-publish"]'), null,
      "Independent tester can see the owner's Publish control.");
    state.isolationDeniedStatuses = denied;
    state.stage = "isolation-verified";
    await saveCheckpoint(state);
    report("isolation-verified", {
      testerId: TESTER_ID, projectId: state.projectId,
      dashboardProjectHidden: true, ownerReadEndpointsDenied: denied,
      previewCapabilityMetadataDenied: true, privatePreviewDeniedStatus: previewStatus, releasesDenied: true,
      publishControlHidden: true, directProjectUiDenied: true,
    });
  } catch (error) {
    report("isolation-failed", { error: safeError(error) });
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

let releaseLock;
try {
  releaseLock = await acquireLock();
  if (phase === "signup") await signupPhase();
  else if (phase === "generate") await generatePhase();
  else if (phase === "reconcileGeneration") await reconcileGenerationPhase();
  else if (phase === "preview") await previewPhase();
  else if (phase === "approvedLead") await previewPhase({ approved: true });
  else if (phase === "verifyRecoveredForm") await recoveredFormPhase();
  else if (phase === "approvedRecoveredLead") await recoveredApprovedLeadPhase();
  else if (phase === "edit1") await runEditPhase(1);
  else if (phase === "reopen") await reopenPhase();
  else if (phase === "publish1") await publish1Phase();
  else if (phase === "publishSame") await publishSamePhase();
  else if (phase === "edit2") await runEditPhase(2);
  else if (phase === "publishUpdate") await publishUpdatePhase();
  else if (phase === "returning") await returningPhase();
  else await isolationPhase();
} catch (error) {
  console.error(JSON.stringify({ phase, status: "FAIL", error: safeError(error) }));
  process.exitCode = 1;
} finally {
  if (releaseLock) await releaseLock();
}