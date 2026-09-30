#!/usr/bin/env node
// One-use, owner-only edit1 acceptance. Never retry after a reserved click.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../lab/bc-vibesdk-lab-20260925/package.json", import.meta.url));
const puppeteer = require("puppeteer");
const BASE = "https://app.buildcustom.ai";
const RUNTIME = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const PROFILE = "/tmp/buildcustom-task13-recovered-profile";
const CHECKPOINT = "production/vibesdk-launch/task13-project5-recovery-checkpoint.json";
const PROMPT = "Change the dashboard to a dark navy theme and add a recent leads section showing the five newest leads.";
const VERSION = "d4bc4b85d03cfaf55326d078f08b9446b98e68b1";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = rows => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const safeError = error => String(error?.message || error).slice(0, 400);

const checkpoint = JSON.parse(await readFile(CHECKPOINT, "utf8"));
assert.equal(checkpoint.stage, "edit1-blocked-no-retry");
assert.equal(checkpoint.projectId, 5);
assert.equal(checkpoint.revision, VERSION);
assert.equal(checkpoint.edit1?.readOnlyAfterFailure?.exactInstructionTurns, 0);
assert.equal(checkpoint.postRepairLeadAttempt?.acceptance?.status, "PASS");
assert(!checkpoint.instrumentedEdit1, "An instrumented edit1 attempt is already reserved; no retry.");
const save = async () => {
  const temporary = `${CHECKPOINT}.instrumented-tmp`;
  await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, CHECKPOINT);
};

let browser, page, cdp, beforeRows;
const audit = {
  sockets: new Map(), outgoing: [], incoming: [], consoleErrors: [], pageErrors: [],
  unhandledRejections: [], clickEvidence: null,
};
async function get(path) {
  const result = await page.evaluate(async url => {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, path);
  assert.equal(result.status, 200, `Read-only owner endpoint unavailable: ${path}`);
  return result.body;
}
async function snapshot() {
  const [project, status, revisionBody, turnsBody, filesBody, releasesBody] =
    await Promise.all([
      get("/api/projects/5"), get("/api/projects/5/runtime/status"),
      get("/api/projects/5/runtime/revision"), get("/api/projects/5/runtime/turns"),
      get("/api/projects/5/runtime/files"), get("/api/projects/5/runtime/releases"),
    ]);
  const revision = (revisionBody.commitHash || revisionBody.revision?.commitHash || "").toLowerCase();
  const turns = turnsBody.turns || turnsBody;
  const files = filesBody.files || filesBody;
  const releases = releasesBody.releases || releasesBody;
  assert.equal(String(project.userId), checkpoint.ownerUserId);
  assert.equal(project.agentId, checkpoint.agentId);
  assert.equal(status.nativeThink, true);
  assert(Array.isArray(turns) && Array.isArray(files) && Array.isArray(releases));
  assert.match(revision, /^[a-f0-9]{40}$/);
  return { revision, status, turns, files, releases };
}
const idle = status => status.runtimeStatus === "ready"
  && status.state?.shouldBeGenerating === false && status.state?.generation?.status === "idle";
async function rows() {
  const cookies = (await page.cookies(BASE))
    .filter(cookie => ["accessToken", "csrf-token"].includes(cookie.name))
    .map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
  assert(cookies.includes("accessToken="), "Owner session unavailable for read-only lead verification.");
  const url = new URL(`/api/agent/${checkpoint.agentId}/db/query`, RUNTIME);
  for (const [key, value] of Object.entries({
    branch: "main", table: "leads", limit: "100", offset: "0", orderBy: "id", orderDir: "asc",
  })) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Accept: "application/json", Cookie: cookies }, signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.data.rows.length, body.data.totalCount);
  return body.data.rows;
}
async function attachNetworkAudit() {
  cdp = await page.target().createCDPSession();
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketCreated", ({ requestId, url }) => {
    if (url.includes("/api/projects/5/runtime/ws"))
      audit.sockets.set(requestId, { open: false, closed: false });
  });
  cdp.on("Network.webSocketHandshakeResponseReceived", ({ requestId, response }) => {
    const socket = audit.sockets.get(requestId);
    if (socket) socket.open = response.status === 101;
  });
  cdp.on("Network.webSocketClosed", ({ requestId }) => {
    const socket = audit.sockets.get(requestId);
    if (socket) socket.closed = true;
  });
  cdp.on("Network.webSocketFrameSent", ({ requestId, response }) => {
    if (!audit.sockets.has(requestId)) return;
    try {
      const frame = JSON.parse(response.payloadData);
      audit.outgoing.push({ type: frame.type, edit1: frame.type === "user_suggestion" && frame.message === PROMPT });
    } catch { audit.outgoing.push({ type: "non-json" }); }
  });
  cdp.on("Network.webSocketFrameReceived", ({ requestId, response }) => {
    if (!audit.sockets.has(requestId)) return;
    try {
      const frame = JSON.parse(response.payloadData);
      audit.incoming.push({ type: frame.type });
    } catch { audit.incoming.push({ type: "non-json" }); }
  });
  page.on("console", message => {
    if (message.type() === "error") audit.consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", error => audit.pageErrors.push(safeError(error)));
  // Installed before editor navigation: captures both its idle and operation WebSockets.
  await page.evaluateOnNewDocument(expected => {
    const NativeSocket = window.WebSocket;
    const sockets = [];
    const events = [];
    class ObservedSocket extends NativeSocket {
      constructor(...args) {
        super(...args);
        if (String(args[0]).includes("/api/projects/5/runtime/ws")) {
          const entry = { socket: this, url: String(args[0]) };
          sockets.push(entry);
          this.addEventListener("open", () => events.push({ kind: "ws-open" }));
          this.addEventListener("close", () => events.push({ kind: "ws-close" }));
          this.addEventListener("message", event => {
            try { events.push({ kind: "ws-incoming", type: JSON.parse(event.data).type }); } catch { /* binary */ }
          });
        }
      }
      send(payload) {
        try {
          const frame = JSON.parse(payload);
          events.push({ kind: "ws-send", type: frame.type, edit1: frame.type === "user_suggestion"
            && frame.message === expected, readyState: this.readyState });
        } catch { /* preserve normal WebSocket behavior */ }
        return super.send(payload);
      }
    }
    window.WebSocket = ObservedSocket;
    window.__task13SendProbe = { sockets, events, clicks: [], errors: [] };
    window.addEventListener("unhandledrejection", event => {
      window.__task13SendProbe.errors.push(String(event.reason || "unknown").slice(0, 300));
    });
    document.addEventListener("click", event => {
      if (event.target?.closest?.('[data-testid="button-send-chat"]'))
        window.__task13SendProbe.clicks.push({ phase: "capture", trusted: event.isTrusted,
          target: event.target?.tagName, matchedSend: true });
    }, true);
  }, PROMPT);
}
async function probe() {
  return page.evaluate(expected => {
    const text = document.querySelector('[data-testid="input-editor-chat"]');
    const button = document.querySelector('[data-testid="button-send-chat"]');
    const props = node => {
      const key = Object.keys(node || {}).find(name => name.startsWith("__reactProps$"));
      return key ? node[key] : null;
    };
    const rect = button?.getBoundingClientRect();
    const element = rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null;
    const sendProps = props(button);
    const state = window.__task13SendProbe;
    return {
      domPromptMatches: text?.value === expected,
      reactPromptMatches: props(text)?.value === expected,
      sendPresent: !!button, sendConnected: button?.isConnected === true,
      sendDisabled: button?.disabled, sendType: button?.type,
      handlerAvailable: typeof sendProps?.onClick === "function",
      centerTargetsSend: !!element?.closest?.('[data-testid="button-send-chat"]'),
      centerTargetTag: element?.tagName || null,
      socketStates: (state?.sockets || []).map(item => item.socket.readyState),
      probeInstalled: !!state, consoleErrors: state?.errors || [],
    };
  }, PROMPT);
}
async function observedEvents() {
  return page.evaluate(() => {
    const state = window.__task13SendProbe;
    return { events: state?.events || [], clicks: state?.clicks || [],
      handlerEntries: state?.handlerEntries || 0, errors: state?.errors || [],
      promptNow: document.querySelector('[data-testid="input-editor-chat"]')?.value || "",
      stopButtonVisible: !!document.querySelector('[data-testid="button-stop-build"]') };
  });
}
async function verifyPreview(newest) {
  const iframe = await page.waitForSelector('iframe[title="Development project preview"]',
    { timeout: 60_000 });
  const frame = await iframe.contentFrame();
  assert(frame);
  await frame.waitForFunction(() => /recent\s+leads/i.test(document.body?.innerText || ""),
    { timeout: 60_000 });
  const proof = await frame.evaluate(() => {
    const heading = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .find(node => /^recent\s+leads$/i.test((node.textContent || "").trim())
        && node.getBoundingClientRect().width > 0);
    const section = heading?.closest("section") || heading?.parentElement?.parentElement;
    const colors = [...document.querySelectorAll("body,header,aside,nav,main,section,div")]
      .filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.width >= 250 && rect.height >= 40;
      }).map(node => getComputedStyle(node).backgroundColor);
    const navyCount = colors.filter(color => {
      const match = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!match) return false;
      const [red, green, blue] = match.slice(1).map(Number);
      return red <= 45 && green <= 65 && blue <= 105 && blue > red && blue > green;
    }).length;
    return { sectionText: section?.innerText || "", headingVisible: !!heading,
      navyCount, stylesheets: document.styleSheets.length,
      rootPopulated: (document.querySelector("#root")?.childElementCount || 0) > 0 };
  });
  assert(proof.headingVisible && proof.rootPopulated && proof.stylesheets > 0);
  const indices = newest.map(row => proof.sectionText.indexOf(row.name));
  assert(indices.every(index => index >= 0));
  assert(indices.every((index, n) => n === 0 || indices[n - 1] < index));
  assert(!proof.sectionText.includes(checkpoint.edit1.before.sixthNewestName));
  assert(proof.navyCount > checkpoint.edit1.before.navySurfaceCount,
    "Preview did not gain dark-navy surfaces.");
  return { navyRendered: true, newestFiveRendered: true };
}

try {
  browser = await puppeteer.launch({ executablePath: "/repl/tools/bin/chromium",
    headless: true, userDataDir: PROFILE, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.setDefaultTimeout(45_000);
  page.setDefaultNavigationTimeout(45_000);
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  const identity = await get("/api/auth/me");
  assert.equal(String(identity.id), checkpoint.ownerUserId);
  const before = await snapshot();
  assert.equal(before.revision, VERSION);
  assert(idle(before.status));
  assert.equal(before.turns.filter(turn => turn.prompt === PROMPT).length, 0);
  assert.equal(before.releases.length, 0);
  beforeRows = await rows();
  assert.equal(beforeRows.length, 13);
  assert.deepEqual(beforeRows.map(row => Number(row.id)), Array.from({ length: 13 }, (_, i) => i + 1));
  assert.equal(beforeRows[12].name, checkpoint.postRepairLeadAttempt.marker);
  assert.equal(digest(beforeRows), checkpoint.edit1.before.leadDigest);
  await attachNetworkAudit();
  await page.goto(`${BASE}/app/project/5`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="button-header-open-builder"]', { visible: true });
  await page.locator('[data-testid="button-header-open-builder"]').click();
  await page.waitForFunction(() => location.pathname === "/app/editor/5");
  await page.waitForSelector('[data-testid="button-send-chat"]', { visible: true });
  for (let i = 0; i < 60 && !(await probe()).socketStates.includes(1); i++) await delay(500);
  const textarea = await page.$('[data-testid="input-editor-chat"]');
  assert(textarea);
  await textarea.click();
  await page.keyboard.type(PROMPT, { delay: 3 });
  let pre = await probe();
  for (let i = 0; i < 30 && !(pre.domPromptMatches && pre.reactPromptMatches
    && pre.sendDisabled === false); i++) {
    await delay(250);
    pre = await probe();
  }
  const immediate = await snapshot();
  assert.equal(immediate.revision, VERSION);
  assert(idle(immediate.status));
  assert.equal(immediate.turns.filter(turn => turn.prompt === PROMPT).length, 0);
  assert.equal((await rows()).length, 13);
  const preconditions = pre.domPromptMatches && pre.reactPromptMatches
    && pre.sendPresent && pre.sendConnected && pre.sendDisabled === false
    && pre.handlerAvailable && pre.centerTargetsSend && pre.socketStates.includes(1)
    && pre.probeInstalled;
  checkpoint.instrumentedEdit1 = {
    instruction: PROMPT, preRevision: VERSION, leadCountBefore: 13,
    newestFiveIds: [13, 12, 11, 10, 9], preClick: pre,
    clickReserved: false, browserClickCalls: 0, agentInstructionsSent: 0,
    outcome: preconditions ? "preconditions-passed" : "preconditions-failed-no-click",
  };
  checkpoint.stage = preconditions ? "instrumented-edit1-preparing" : "instrumented-edit1-preconditions-failed";
  await save();
  assert(preconditions, "Instrumented pre-send check failed; Send was not clicked.");

  // Instrument the existing React Send handler without replacing its behavior.
  await page.evaluate(() => {
    const button = document.querySelector('[data-testid="button-send-chat"]');
    const key = Object.keys(button).find(name => name.startsWith("__reactProps$"));
    const props = button[key];
    const original = props.onClick;
    window.__task13SendProbe.handlerEntries = 0;
    props.onClick = function(...args) {
      window.__task13SendProbe.handlerEntries += 1;
      return original.apply(this, args);
    };
  });
  const finalPre = await probe();
  assert(finalPre.domPromptMatches && finalPre.reactPromptMatches
    && finalPre.sendDisabled === false && finalPre.centerTargetsSend
    && finalPre.socketStates.includes(1), "Send preconditions changed before click.");
  checkpoint.instrumentedEdit1.preClick = finalPre;
  checkpoint.instrumentedEdit1.clickReserved = true;
  checkpoint.stage = "instrumented-edit1-click-reserved-no-retry";
  await save();
  await page.locator('[data-testid="button-send-chat"]').click();
  checkpoint.instrumentedEdit1.browserClickCalls = 1;
  await save();
  let observed = await observedEvents();
  for (let i = 0; i < 120 && !observed.events.some(event => event.kind === "ws-send" && event.edit1); i++) {
    await delay(250);
    observed = await observedEvents();
  }
  audit.clickEvidence = observed;
  const sent = observed.events.filter(event => event.kind === "ws-send" && event.edit1);
  const cdpSent = audit.outgoing.filter(event => event.type === "user_suggestion" && event.edit1);
  checkpoint.instrumentedEdit1.sendEvidence = {
    clickEvents: observed.clicks, handlerEntries: observed.handlerEntries,
    outgoingFrames: sent.length, cdpOutgoingFrames: cdpSent.length,
    socketEvents: observed.events, cdpIncomingTypes: audit.incoming.map(event => event.type),
    consoleErrors: audit.consoleErrors, pageErrors: audit.pageErrors,
    unhandledRejections: observed.errors, stopButtonVisible: observed.stopButtonVisible,
  };
  if (sent.length === 1) checkpoint.instrumentedEdit1.agentInstructionsSent = 1;
  await save();
  assert.equal(sent.length, 1, "Exactly one outgoing edit1 frame was not observed; no resend.");
  assert.equal(cdpSent.length, 1, "CDP did not independently observe exactly one edit1 frame.");
  assert.equal(observed.clicks.filter(event => event.trusted).length, 1);
  assert.equal(observed.handlerEntries, 1);
  await page.waitForFunction(() => {
    const state = document.querySelector('[data-testid="native-completion-state"]')?.getAttribute("data-state");
    return state === "success" || state === "error";
  }, { timeout: 8 * 60_000 });
  const lifecycle = await page.$eval('[data-testid="native-completion-state"]',
    element => ({ state: element.getAttribute("data-state"), text: (element.textContent || "").slice(0, 150) }));
  checkpoint.instrumentedEdit1.lifecycle = lifecycle;
  await save();
  assert.equal(lifecycle.state, "success", `Agent UI did not complete normally: ${lifecycle.text}`);
  let after, stable = 0;
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline && stable < 2) {
    after = await snapshot();
    stable = after.revision !== VERSION && idle(after.status) ? stable + 1 : 0;
    if (stable < 2) await delay(4000);
  }
  assert.equal(stable, 2, "A new stable authoritative revision did not appear.");
  assert.equal(after.turns.filter(turn => turn.prompt === PROMPT).length, 1);
  assert.deepEqual(after.releases, before.releases, "Unexpected publish/release.");
  assert.deepEqual(await rows(), beforeRows, "Edit1 changed lead records.");
  const appAfter = await get("/api/projects/5/runtime/files/content?path=public%2Fapp.jsx");
  assert(/recent.{0,20}leads/i.test(appAfter.content), "Authoritative app source lacks Recent Leads.");
  await page.goto(`${BASE}/app/project/5`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="button-header-open-builder"]', { visible: true });
  await page.locator('[data-testid="button-header-open-builder"]').click();
  await page.waitForSelector('iframe[title="Development project preview"]', { visible: true });
  const reopened = await snapshot();
  assert.equal(reopened.revision, after.revision);
  assert.equal(reopened.turns.filter(turn => turn.prompt === PROMPT).length, 1);
  assert(reopened.files.some(file => file.path === "public/app.jsx"));
  assert.deepEqual(reopened.releases, before.releases);
  const preview = await verifyPreview([...beforeRows].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 5));
  assert.deepEqual(await rows(), beforeRows);
  checkpoint.instrumentedEdit1.outcome = "PASS";
  checkpoint.instrumentedEdit1.result = { preRevision: VERSION, postRevision: reopened.revision,
    agentInstructionsSent: 1, editTurns: 1, leadCountBefore: 13, leadCountAfter: 13,
    newestFiveIds: [13, 12, 11, 10, 9], otherRowsUnchanged: true,
    duplicateLeads: false, reopenPersistence: true, authoritativeFiles: true,
    unexpectedPublish: false, unintendedMutation: false, ...preview };
  checkpoint.stage = "instrumented-edit1-pass-stop-before-edit2";
  await save();
  console.log(JSON.stringify({ stage: checkpoint.stage, result: checkpoint.instrumentedEdit1.result }));
} catch (error) {
  if (checkpoint.instrumentedEdit1 && checkpoint.stage !== "instrumented-edit1-pass-stop-before-edit2") {
    let current = null;
    try {
      const now = await snapshot();
      const leadRows = await rows();
      current = { revision: now.revision, idle: idle(now.status),
        editTurns: now.turns.filter(turn => turn.prompt === PROMPT).length,
        leadCount: leadRows.length, leadDigestMatches: digest(leadRows) === checkpoint.edit1.before.leadDigest,
        releaseCount: now.releases.length };
    } catch { /* never replace the one-use guard with an assumed outcome */ }
    const events = page ? await observedEvents().catch(() => null) : null;
    checkpoint.instrumentedEdit1.failure = safeError(error);
    checkpoint.instrumentedEdit1.readOnlyAfterFailure = current;
    checkpoint.instrumentedEdit1.sendEvidence ??= {
      clickEvents: events?.clicks || [], handlerEntries: events?.handlerEntries || 0,
      outgoingFrames: events?.events?.filter(event => event.kind === "ws-send" && event.edit1).length || 0,
      cdpOutgoingFrames: audit.outgoing.filter(event => event.edit1).length,
      socketEvents: events?.events || [], cdpIncomingTypes: audit.incoming.map(event => event.type),
      consoleErrors: audit.consoleErrors, pageErrors: audit.pageErrors,
      unhandledRejections: events?.errors || [],
    };
    checkpoint.instrumentedEdit1.outcome = checkpoint.instrumentedEdit1.clickReserved
      ? "post-click-no-retry" : "pre-click-no-send";
    checkpoint.stage = checkpoint.instrumentedEdit1.clickReserved
      ? "instrumented-edit1-blocked-no-retry" : "instrumented-edit1-preconditions-failed";
    await save();
    console.log(JSON.stringify({ stage: checkpoint.stage, error: safeError(error),
      clickReserved: checkpoint.instrumentedEdit1.clickReserved,
      agentInstructionsSent: checkpoint.instrumentedEdit1.agentInstructionsSent,
      observed: current, noRetry: true }));
  } else console.log(JSON.stringify({ stage: checkpoint.stage, error: safeError(error),
    clickReserved: false, agentInstructionsSent: 0, noRetry: true }));
  process.exitCode = 1;
} finally {
  await cdp?.detach().catch(() => undefined);
  await browser?.close();
}