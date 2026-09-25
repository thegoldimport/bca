import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const labRequire = createRequire(path.join(root, "lab/bc-vibesdk-lab-20260925/package.json"));
const puppeteer = labRequire("puppeteer");

const PROJECT_ID = 10;
const BASELINE = "f8252595233caa93afc192a03a30d857279eae47";
const EDITED = "b53e777aa0481108f8d8bcce09de73b23afe0da6";
const PROMPT = "Test-only simulated Task 3 edit";
const ASSISTANT = "Test-only verified edit response.";
const PROMPT_DIGEST = createHash("sha256").update(PROMPT).digest("hex");
// The two revision hashes are observed Task 3 evidence. Chat text is clearly
// synthetic offline fixture content; the initial fixture has one turn, and
// the simulated edit is persisted as turn two rather than a third turn.
const BASE_TURNS = [
  {
    id: 1,
    mode: "build",
    prompt: "Task 3 initial turn (offline browser-test fixture).",
    response: "Initial Task 3 revision available in the fixture.",
    changedFiles: [],
    activity: [],
    commitHash: BASELINE,
    createdAt: "2026-09-25T21:00:00.000Z",
  },
];
const FINAL_TURN = {
  id: 2,
  mode: "build",
  prompt: PROMPT,
  response: ASSISTANT,
  changedFiles: ["public/index.html"],
  activity: [],
  commitHash: EDITED,
  createdAt: "2026-09-25T21:20:00.000Z",
};
const FOREIGN_TURN = {
  id: 2,
  mode: "build",
  prompt: "Unrelated concurrent change (offline browser-test fixture).",
  response: "A separate change was persisted.",
  changedFiles: ["public/styles.css"],
  activity: [],
  commitHash: EDITED,
  createdAt: "2026-09-25T21:20:00.000Z",
};

function fixture({ active = false, changed = false, savedOperation = false } = {}) {
  return {
    projectId: PROJECT_ID,
    runtimeProvider: "stock-think",
    currentRevision: changed ? EDITED : BASELINE,
    shouldBeGenerating: active,
    generationStatus: active ? "running" : "idle",
    deployedRevision: changed ? EDITED : BASELINE,
    persistedTurns: BASE_TURNS,
    ...(savedOperation ? {
      operationBaseline: {
        revision: BASELINE,
        startedAt: 1_758_838_800_000,
        promptAttempted: true,
        startingTurnCount: BASE_TURNS.length,
        promptDigest: PROMPT_DIGEST,
        imageDigest: null,
      },
    } : {}),
    filePaths: ["public/index.html", "public/styles.css", "package.json", "index.js", "README.md"],
    stats: {
      sockets: 0,
      userSuggestions: 0,
      conversationStateRequests: 0,
      frameworkEnvelopesFiltered: 0,
      previewPosts: 0,
      publishRequests: 0,
      agentCreationRequests: 0,
      api: [],
    },
  };
}

function installBrowserHarness(initialFixture) {
  const realFetch = window.fetch.bind(window);
  const realWebSocket = window.WebSocket;
  const saved = sessionStorage.getItem("__native_completion_fixture");
  const state = saved ? JSON.parse(saved) : initialFixture;
  let clockOffset = 0;
  let turnsResponseSkip = null;
  let releaseDelayedTurnsResponse = null;
  let delayedTurnsResponsePending = false;
  const nativeDateNow = Date.now.bind(Date);
  Date.now = () => nativeDateNow() + clockOffset;
  localStorage.removeItem("bc_new_user");

  const persist = () => {
    const { activeSocket: _activeSocket, ...serializable } = state;
    sessionStorage.setItem("__native_completion_fixture", JSON.stringify(serializable));
  };
  if (!saved && initialFixture.operationBaseline) {
    sessionStorage.setItem("buildcustom:native-operation:10", JSON.stringify(initialFixture.operationBaseline));
  }
  const previewUrl = () => `${location.origin}/__native_completion_preview/?revision=${state.currentRevision}`;
  const status = () => ({
    nativeThink: true,
    connected: true,
    runtimeStatus: "ready",
    previewUrl: previewUrl(),
    deploymentUrl: null,
    state: {
      shouldBeGenerating: state.shouldBeGenerating,
      generation: { status: state.generationStatus },
      lastDeployedCommit: state.deployedRevision,
      previewUrl: previewUrl(),
    },
  });
  const json = (value, statusCode = 200) => new Response(JSON.stringify(value), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    const method = String(init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    state.stats.api.push({ path: url.pathname, method });
    persist();

    if (url.pathname === "/api/auth/me") {
      return json({ id: "task3-disposable-owner", username: "T3", email: "task3@example.test", plan: "free", role: "user" });
    }
    if (url.pathname === "/api/auth/csrf-token") return json({ token: "browser-test-csrf" });
    if (url.pathname.endsWith("/runtime/status")) return json(status());
    if (url.pathname.endsWith("/runtime/revision")) return json({ branch: "main", commitHash: state.currentRevision });
    if (url.pathname.endsWith("/runtime/files")) {
      return json({ files: state.filePaths.map((filePath) => ({ path: filePath })) });
    }
    if (url.pathname.endsWith("/runtime/turns")) {
      if (turnsResponseSkip !== null) {
        if (turnsResponseSkip > 0) {
          turnsResponseSkip -= 1;
        } else {
          turnsResponseSkip = null;
          delayedTurnsResponsePending = true;
          await new Promise((resolve) => { releaseDelayedTurnsResponse = resolve; });
          delayedTurnsResponsePending = false;
          releaseDelayedTurnsResponse = null;
        }
      }
      return json({ turns: state.persistedTurns });
    }
    if (url.pathname.endsWith("/runtime/publishing-settings")) {
      return json({ subdomainSlug: "", hostingProvider: "buildcustom", customDomain: "", customOrigin: "" });
    }
    if (url.pathname.endsWith("/runtime/releases")) return json({ releases: [] });
    if (url.pathname.endsWith("/runtime/previews") && method === "POST") {
      state.stats.previewPosts += 1;
      persist();
      return json({ url: previewUrl(), previewUrl: previewUrl() });
    }
    if (/\/(?:agents?|thinkagents?)(?:\/|$)/i.test(url.pathname)
      && /^(POST|PUT)$/.test(method)) {
      state.stats.agentCreationRequests += 1;
      persist();
    }
    if (/(?:publish|production|deploy)/i.test(url.pathname) && method === "POST") {
      state.stats.publishRequests += 1;
      persist();
    }
    return json({});
  };

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = String(url);
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      state.stats.sockets += 1;
      state.socketConstructed = true;
      state.activeSocket = this;
      persist();
      setTimeout(() => {
        if (this.readyState !== FakeWebSocket.CONNECTING) return;
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.({ target: this });
        this.emit({ type: "agent_connected", state: { shouldBeGenerating: false } });
      }, 0);
    }

    send(raw) {
      if (this.readyState !== FakeWebSocket.OPEN) throw new Error("Fake WebSocket is not open");
      const frame = JSON.parse(String(raw));
      this.sent.push(frame);
      if (frame.type === "user_suggestion") state.stats.userSuggestions += 1;
      if (frame.type === "get_conversation_state") state.stats.conversationStateRequests += 1;
      persist();
    }

    close(code = 1000, reason = "") {
      if (this.readyState === FakeWebSocket.CLOSED) return;
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ code, reason, wasClean: code === 1000, target: this });
    }

    emit(frame) {
      if (this.readyState !== FakeWebSocket.OPEN) throw new Error("Cannot deliver a frame to a closed socket");
      this.onmessage?.({ data: JSON.stringify(frame), target: this });
    }

    closeUnexpectedly() {
      this.close(1006, "");
    }
  }

  window.WebSocket = new Proxy(realWebSocket, {
    construct(Target, args, NewTarget) {
      const url = String(args[0]);
      if (url.includes("/api/projects/10/runtime/ws")) return new FakeWebSocket(url);
      return Reflect.construct(Target, args, NewTarget);
    },
  });

  window.__nativeCompletionHarness = {
    advanceClock(ms) {
      clockOffset += ms;
      return clockOffset;
    },
    emit(frame) {
      if (!state.activeSocket) throw new Error("No native WebSocket has been opened");
      state.activeSocket.emit(frame);
    },
    deliverLate(frame) {
      const socket = state.activeSocket;
      if (!socket?.onmessage) return;
      socket.onmessage({ data: JSON.stringify(frame), target: socket });
    },
    closeUnexpectedly() {
      state.activeSocket?.closeUnexpectedly();
    },
    filterFrameworkEnvelope() {
      // The staging bridge consumes this stock envelope internally. It is
      // intentionally not delivered to the customer-facing WebSocket.
      state.stats.frameworkEnvelopesFiltered += 1;
      persist();
    },
    setRuntime({ active, revision, deployedRevision, persistedTurns }) {
      if (typeof active === "boolean") {
        state.shouldBeGenerating = active;
        state.generationStatus = active ? "running" : "idle";
      }
      if (typeof revision === "string") state.currentRevision = revision;
      if (typeof deployedRevision === "string") state.deployedRevision = deployedRevision;
      if (Array.isArray(persistedTurns)) state.persistedTurns = persistedTurns;
      persist();
    },
    delayTurnsRequest(skip = 0) {
      turnsResponseSkip = skip;
    },
    turnsRequestDelayed() {
      return delayedTurnsResponsePending;
    },
    releaseDelayedTurnsRequest() {
      if (!releaseDelayedTurnsResponse) throw new Error("No delayed runtime turns response is pending");
      const release = releaseDelayedTurnsResponse;
      releaseDelayedTurnsResponse = null;
      release();
    },
    snapshot() {
      persist();
      return JSON.parse(JSON.stringify({
        currentRevision: state.currentRevision,
        shouldBeGenerating: state.shouldBeGenerating,
        generationStatus: state.generationStatus,
        persistedTurns: state.persistedTurns,
        stats: state.stats,
      }));
    },
    async fastForward(ms) {
      clockOffset += ms;
      await new Promise((resolve) => window.setTimeout(resolve, 1250));
      return clockOffset;
    },
    async awaitState(expected) {
      const node = document.querySelector('[data-testid="native-completion-state"]');
      if (!node) return null;
      return {
        state: node.getAttribute("data-state") || node.getAttribute("data-phase") || node.dataset.state || node.dataset.phase,
        text: node.textContent?.trim() || "",
        expected,
      };
    },
  };
  persist();
}

async function stateOf(page) {
  return page.evaluate(() => {
    const node = document.querySelector('[data-testid="native-completion-state"]');
    return node
      ? node.getAttribute("data-state") || node.getAttribute("data-phase") || node.dataset.state || node.dataset.phase
      : null;
  });
}

async function waitForState(page, expected, timeout = 10_000) {
  await page.waitForFunction((phase) => {
    const node = document.querySelector('[data-testid="native-completion-state"]');
    const value = node && (node.getAttribute("data-state") || node.getAttribute("data-phase") || node.dataset.state || node.dataset.phase);
    return value === phase;
  }, { timeout }, expected);
}

async function statsOf(page) {
  return page.evaluate(() => window.__nativeCompletionHarness.snapshot().stats);
}

async function startEditor(serverUrl, browser, initialFixture = fixture()) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(installBrowserHarness, initialFixture);
  await page.goto(`${serverUrl}/app/editor/${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="input-editor-chat"]', { timeout: 20_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="builder-chat-scroll"]')?.textContent, { timeout: 20_000 });
  return page;
}

async function navigateWithinApp(page, route) {
  await page.evaluate((nextRoute) => {
    history.pushState({}, "", nextRoute);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, route);
}

async function sendOnePrompt(page) {
  await page.waitForSelector('[data-testid="input-editor-chat"]:not(:disabled)', { timeout: 10_000 });
  await page.type('[data-testid="input-editor-chat"]', PROMPT);
  await page.click('[data-testid="button-send-chat"]');
  await page.waitForFunction(() => window.__nativeCompletionHarness.snapshot().stats.userSuggestions === 1, { timeout: 10_000 }).catch(async (error) => {
    const debug = await page.evaluate(() => ({
      stats: window.__nativeCompletionHarness.snapshot().stats,
      completionState: document.querySelector('[data-testid="native-completion-state"]')?.outerHTML,
      text: document.querySelector('[data-testid="builder-chat-scroll"]')?.innerText,
      input: document.querySelector('[data-testid="input-editor-chat"]')?.value,
    }));
    error.message += `; browser state: ${JSON.stringify(debug)}`;
    throw error;
  });
  await waitForState(page, "running");
}

async function emitObservedProgress(page, { includeFilteredEnvelope = false } = {}) {
  await page.evaluate(({ filter, assistant }) => {
    const harness = window.__nativeCompletionHarness;
    if (filter) harness.filterFrameworkEnvelope();
    harness.emit({ type: "generation_started" });
    harness.emit({ type: "conversation_response", message: "Applying the simulated Task 3 edit", isDelta: false, isStreaming: true });
    harness.emit({ type: "file_generating", path: "public/index.html" });
    harness.emit({ type: "file_generated", path: "public/index.html" });
    harness.emit({ type: "conversation_response", message: assistant, isDelta: false, isStreaming: false });
    harness.emit({ type: "deployment_completed" });
  }, { filter: includeFilteredEnvelope, assistant: ASSISTANT });
}

async function persistSuccessfulTurn(page) {
  await page.evaluate(({ editedRevision, turn }) => {
    window.__nativeCompletionHarness.setRuntime({
      active: false,
      revision: editedRevision,
      deployedRevision: editedRevision,
      persistedTurns: [...window.__nativeCompletionHarness.snapshot().persistedTurns, turn],
    });
  }, { editedRevision: EDITED, turn: FINAL_TURN });
}

async function waitForVerificationRevision(page, minimumRequests = 2) {
  await page.waitForFunction((min) => {
    const stats = window.__nativeCompletionHarness.snapshot().stats;
    return stats.api.filter((entry) => entry.path.endsWith("/runtime/revision")).length >= min;
  }, { timeout: 10_000 }, minimumRequests);
}

async function assertSinglePersistedTurn(page, expectedPrompt = PROMPT) {
  await page.waitForFunction((prompt) => {
    const node = document.querySelector('[data-testid="builder-chat-scroll"]');
    return node?.innerText.includes(prompt);
  }, { timeout: 10_000 }, expectedPrompt);
  const text = await page.$eval('[data-testid="builder-chat-scroll"]', (node) => node.innerText);
  assert.equal(text.split(expectedPrompt).length - 1, 1, "the user turn must be rendered exactly once");
  assert.equal(text.split(ASSISTANT).length - 1, 1, "the assistant response must be rendered exactly once");
  const composer = await page.$eval('[data-testid="input-editor-chat"]', (node) => !node.disabled);
  assert.equal(composer, true, "composer must be usable after verified completion");
  const stats = await statsOf(page);
  assert.equal(stats.userSuggestions, 1, "recovery must not resend the prompt");
  assert.equal(stats.agentCreationRequests, 0, "recovery must not create an agent");
  assert.equal(stats.publishRequests, 0, "completion recovery must not publish");
}

async function finishQuietCandidate(page) {
  await waitForVerificationRevision(page);
  await page.evaluate(() => window.__nativeCompletionHarness.advanceClock(6_000));
  // The browser timer driving the existing state machine remains real-time;
  // only its quiet-period clock is advanced.
  await page.waitForFunction(() => {
    const state = document.querySelector('[data-testid="native-completion-state"]')
      ?.getAttribute("data-state");
    return state === "success";
  }, { timeout: 12_000 });
}

test("BuildCustom completion and recovery states in rendered Chromium client", { timeout: 300_000 }, async (t) => {
  const bundleDir = await mkdtemp(path.join(os.tmpdir(), "native-completion-browser-"));
  let httpServer;
  let browser;
  try {
    await build({
      configFile: path.join(root, "vite.config.ts"),
      mode: "production",
      logLevel: "error",
      build: { outDir: bundleDir, emptyOutDir: true },
    });
    httpServer = createHttpServer(async (request, response) => {
      const requestUrl = new URL(request.url || "/", "http://localhost");
      if (requestUrl.pathname.startsWith("/api/")) {
        response.writeHead(501, { "Content-Type": "application/json" }).end("{}");
        return;
      }
      if (requestUrl.pathname.startsWith("/__native_completion_preview/")) {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<!doctype html><html><body><h1>Task 3 browser-test preview</h1></body></html>");
        return;
      }
      const relative = path.normalize(decodeURIComponent(requestUrl.pathname).replace(/^[/\\]+/, ""));
      let filePath = path.join(bundleDir, relative || "index.html");
      if (!filePath.startsWith(bundleDir + path.sep) && filePath !== path.join(bundleDir, "index.html")) {
        response.writeHead(400).end();
        return;
      }
      try {
        await stat(filePath);
      } catch {
        filePath = path.join(bundleDir, "index.html");
      }
      try {
        const content = await readFile(filePath);
        const extension = path.extname(filePath);
        const contentType = extension === ".js" ? "text/javascript"
          : extension === ".css" ? "text/css"
            : extension === ".svg" ? "image/svg+xml"
              : extension === ".png" ? "image/png"
                : extension === ".woff2" ? "font/woff2"
                  : "text/html; charset=utf-8";
        response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
        response.end(content);
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    assert.ok(address && typeof address !== "string");
    const serverUrl = `http://127.0.0.1:${address.port}`;
    browser = await puppeteer.launch({
      executablePath: "/repl/tools/bin/chromium",
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    await t.test("normal generation_complete reaches success and reconciles current files, preview, and conversation", async () => {
      const page = await startEditor(serverUrl, browser);
      try {
        await sendOnePrompt(page);
        await emitObservedProgress(page);
        await persistSuccessfulTurn(page);
        await page.evaluate(() => window.__nativeCompletionHarness.emit({ type: "generation_complete" }));
        await waitForState(page, "recovering");
        await finishQuietCandidate(page);
        await assertSinglePersistedTurn(page);
        const stats = await statsOf(page);
        assert.ok(stats.api.filter((entry) => entry.path.endsWith("/runtime/files")).length >= 1);
        assert.equal(stats.frameworkEnvelopesFiltered, 0);
      } finally {
        await page.close();
      }
    });

    await t.test("unexpected 1006 verifies an already committed result without a second prompt", async () => {
      const page = await startEditor(serverUrl, browser);
      try {
        await sendOnePrompt(page);
        await emitObservedProgress(page);
        await persistSuccessfulTurn(page);
        await page.evaluate(() => window.__nativeCompletionHarness.closeUnexpectedly());
        await waitForState(page, "recovering");
        await page.evaluate(() => window.__nativeCompletionHarness.advanceClock(31_000));
        await finishQuietCandidate(page);
        await assertSinglePersistedTurn(page);
      } finally {
        await page.close();
      }
    });

    await t.test("missing generation_complete recovers only from a changed stable revision", async () => {
      const page = await startEditor(serverUrl, browser);
      try {
        await sendOnePrompt(page);
        await emitObservedProgress(page, { includeFilteredEnvelope: true });
        await persistSuccessfulTurn(page);
        // The observed stock edit never produced generation_complete and its
        // filtered framework state envelope is not needed by the client.
        await page.evaluate(() => window.__nativeCompletionHarness.advanceClock(31_000));
        await finishQuietCandidate(page);
        await assertSinglePersistedTurn(page);
        assert.equal((await statsOf(page)).frameworkEnvelopesFiltered, 1);
      } finally {
        await page.close();
      }
    });

    await t.test("unmount and remount during an active generation preserves baseline and suppresses stale handlers", async () => {
      const page = await startEditor(serverUrl, browser);
      try {
        await sendOnePrompt(page);
        await page.evaluate((revision) => {
          window.__nativeCompletionHarness.setRuntime({ active: true, revision });
          window.__nativeCompletionHarness.emit({ type: "generation_started" });
        }, BASELINE);

        await navigateWithinApp(page, "/app/templates");
        await page.waitForFunction(() => !document.querySelector('[data-testid="builder-chat-scroll"]'));
        const afterUnmount = await statsOf(page);
        const baselineKey = "buildcustom:native-operation:10";
        const storedBaseline = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || "null"), baselineKey);
        assert.ok(storedBaseline, "the in-flight baseline must survive unmount");
        assert.equal(storedBaseline.revision, BASELINE);
        assert.equal(storedBaseline.promptAttempted, true);
        assert.equal(typeof storedBaseline.startedAt, "number");

        // Simulate a previously queued frame arriving after the editor has
        // unmounted. Its old handler must not clear the baseline or poll stock.
        await page.evaluate(() => window.__nativeCompletionHarness.deliverLate({
          type: "error",
          message: "Late frame delivered after unmount.",
        }));
        await new Promise((resolve) => setTimeout(resolve, 1_350));
        const afterLateFrame = await statsOf(page);
        assert.equal(afterLateFrame.userSuggestions, 1);
        assert.equal(afterLateFrame.sockets, 1);
        assert.equal(
          afterLateFrame.api.filter((entry) => entry.path.endsWith("/runtime/status")).length,
          afterUnmount.api.filter((entry) => entry.path.endsWith("/runtime/status")).length,
          "the unmounted operation handler must not reconcile stock",
        );
        assert.equal(
          afterLateFrame.api.filter((entry) => entry.path.endsWith("/runtime/revision")).length,
          afterUnmount.api.filter((entry) => entry.path.endsWith("/runtime/revision")).length,
          "the unmounted operation handler must not verify a revision",
        );
        const baselineAfterLateFrame = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || "null"), baselineKey);
        assert.ok(baselineAfterLateFrame, "the in-flight baseline must survive unmount and late frames");
        assert.equal(baselineAfterLateFrame.promptAttempted, true);

        await page.goto(`${serverUrl}/app/editor/${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="builder-chat-scroll"]', { timeout: 20_000 });
        await waitForState(page, "recovering");
        const beforeCompletion = await statsOf(page);
        const priorRevisionChecks = beforeCompletion.api.filter((entry) => entry.path.endsWith("/runtime/revision")).length;
        await page.evaluate(({ revision, turn }) => {
          window.__nativeCompletionHarness.setRuntime({
            active: false,
            revision,
            deployedRevision: revision,
            persistedTurns: [...window.__nativeCompletionHarness.snapshot().persistedTurns, turn],
          });
          window.__nativeCompletionHarness.advanceClock(36_000);
        }, { revision: EDITED, turn: FINAL_TURN });
        await waitForVerificationRevision(page, priorRevisionChecks + 1);
        await page.evaluate(() => window.__nativeCompletionHarness.advanceClock(31_000));
        await waitForState(page, "success", 25_000);
        await assertSinglePersistedTurn(page);
        assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), baselineKey), null);
      } finally {
        await page.close();
      }
    });

    await t.test("foreign changed revision with an unmatched persisted turn never succeeds", async () => {
      const page = await startEditor(serverUrl, browser);
      try {
        await sendOnePrompt(page);
        await emitObservedProgress(page);
        await page.evaluate(({ revision, turn }) => {
          window.__nativeCompletionHarness.setRuntime({
            active: false,
            revision,
            deployedRevision: revision,
            persistedTurns: [...window.__nativeCompletionHarness.snapshot().persistedTurns, turn],
          });
          window.__nativeCompletionHarness.emit({ type: "generation_complete" });
          window.__nativeCompletionHarness.advanceClock(31_000);
        }, { revision: EDITED, turn: FOREIGN_TURN });
        await waitForVerificationRevision(page);
        await page.evaluate(() => window.__nativeCompletionHarness.advanceClock(6_000));
        await new Promise((resolve) => setTimeout(resolve, 1_350));
        assert.notEqual(await stateOf(page), "success", "a different persisted turn cannot verify this prompt");

        await page.evaluate(() => window.__nativeCompletionHarness.advanceClock(10 * 60_000 + 1));
        await waitForState(page, "error", 10_000);
        const text = await page.$eval('[data-testid="builder-chat-scroll"]', (node) => node.innerText);
        assert.match(text, /could not verify|persisted|matching|latest state/i);
        const stats = await statsOf(page);
        assert.equal(stats.userSuggestions, 1);
        assert.equal(stats.agentCreationRequests, 0);
        assert.equal(stats.publishRequests, 0);
      } finally {
        await page.close();
      }
    });

    await t.test("stale preview triggers fresh preview creation then final revision confirmation", async () => {
      const page = await startEditor(serverUrl, browser);
      try {
        await sendOnePrompt(page);
        await emitObservedProgress(page);
        await page.evaluate(({ revision, staleDeployment, turn }) => {
          window.__nativeCompletionHarness.setRuntime({
            active: false,
            revision,
            deployedRevision: staleDeployment,
            persistedTurns: [...window.__nativeCompletionHarness.snapshot().persistedTurns, turn],
          });
          window.__nativeCompletionHarness.emit({ type: "generation_complete" });
        }, { revision: EDITED, staleDeployment: BASELINE, turn: FINAL_TURN });
        await waitForVerificationRevision(page);
        await page.evaluate(() => window.__nativeCompletionHarness.advanceClock(6_000));
        await waitForState(page, "success");
        await assertSinglePersistedTurn(page);

        const stats = await statsOf(page);
        assert.equal(stats.previewPosts, 1, "stale deployed preview must be replaced with a fresh preview");
        const previewIndex = stats.api.findIndex((entry) => entry.path.endsWith("/runtime/previews") && entry.method === "POST");
        assert.ok(previewIndex >= 0, "completion must request a fresh preview");
        assert.ok(
          stats.api.slice(previewIndex + 1).some((entry) => entry.path.endsWith("/runtime/revision")),
          "the fresh preview must be followed by a stable final-revision check",
        );
        assert.equal(stats.publishRequests, 0);
      } finally {
        await page.close();
      }
    });

    await t.test("native progress during delayed final verification cancels stale success until rechecked", async () => {
      const page = await startEditor(serverUrl, browser);
      try {
        await sendOnePrompt(page);
        await emitObservedProgress(page);
        await persistSuccessfulTurn(page);
        await page.evaluate(() => window.__nativeCompletionHarness.delayTurnsRequest(1));
        await page.evaluate(() => window.__nativeCompletionHarness.emit({ type: "generation_complete" }));
        await waitForState(page, "recovering");
        await page.waitForFunction(() => window.__nativeCompletionHarness.turnsRequestDelayed(), { timeout: 20_000 });

        const revisionsBeforeRace = (await statsOf(page)).api
          .filter((entry) => entry.path.endsWith("/runtime/revision")).length;
        await page.evaluate((revision) => {
          window.__nativeCompletionHarness.setRuntime({
            active: false,
            revision,
            deployedRevision: revision,
          });
          window.__nativeCompletionHarness.emit({ type: "file_generating", path: "public/styles.css" });
        }, EDITED);
        await page.evaluate(() => window.__nativeCompletionHarness.releaseDelayedTurnsRequest());
        await waitForVerificationRevision(page, revisionsBeforeRace + 1);
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.notEqual(await stateOf(page), "success", "the in-flight stale verification cannot win after new progress");

        await page.evaluate(() => {
          window.__nativeCompletionHarness.emit({ type: "file_generated", path: "public/styles.css" });
          window.__nativeCompletionHarness.advanceClock(6_000);
        });
        await waitForVerificationRevision(page, revisionsBeforeRace + 2);
        assert.notEqual(await stateOf(page), "success", "the changed frame sequence must reset revision stability");

        await page.evaluate(() => window.__nativeCompletionHarness.advanceClock(6_000));
        await waitForVerificationRevision(page, revisionsBeforeRace + 3);
        await waitForState(page, "success", 15_000);
        await assertSinglePersistedTurn(page);
        const stats = await statsOf(page);
        assert.equal(stats.userSuggestions, 1);
        assert.equal(stats.publishRequests, 0);
      } finally {
        await page.close();
      }
    });

    await t.test("quiet or missing completion with an unchanged revision ends in bounded recoverable error", async () => {
      const page = await startEditor(serverUrl, browser);
      try {
        await sendOnePrompt(page);
        await emitObservedProgress(page);
        await page.evaluate((baseline) => {
          window.__nativeCompletionHarness.setRuntime({ active: false, revision: baseline, deployedRevision: baseline });
          window.__nativeCompletionHarness.advanceClock(31_000);
        }, BASELINE);
        await waitForState(page, "recovering");
        await page.waitForFunction(() => {
          const entries = window.__nativeCompletionHarness.snapshot().stats.api;
          return entries.filter((entry) => entry.path.endsWith("/runtime/revision")).length >= 2;
        }, { timeout: 10_000 });
        assert.notEqual(await stateOf(page), "success", "quiet time alone must never declare success");
        await page.evaluate(() => window.__nativeCompletionHarness.advanceClock(10 * 60_000 + 1));
        await waitForState(page, "error", 10_000);
        const errorText = await page.$eval('[data-testid="builder-chat-scroll"]', (node) => node.innerText);
        assert.match(errorText, /could not verify|reconnect|latest state|connection/i);
        const stats = await statsOf(page);
        assert.equal(stats.userSuggestions, 1);
        assert.equal(stats.agentCreationRequests, 0);
        assert.equal(stats.publishRequests, 0);
      } finally {
        await page.close();
      }
    });

    await t.test("an explicit error before quiet remains terminal through unchanged then changed commits", async () => {
      const page = await startEditor(serverUrl, browser);
      try {
        await sendOnePrompt(page);
        await emitObservedProgress(page);
        await page.evaluate(() => window.__nativeCompletionHarness.emit({ type: "error", message: "Stock Think reported an explicit test error." }));
        await waitForState(page, "error");
        const errorBefore = await page.$eval('[data-testid="builder-chat-scroll"]', (node) => node.innerText);
        await page.evaluate((baseline) => {
          window.__nativeCompletionHarness.setRuntime({ active: false, revision: baseline, deployedRevision: baseline });
          window.__nativeCompletionHarness.advanceClock(31_000);
        }, BASELINE);
        await new Promise((resolve) => setTimeout(resolve, 1_350));
        assert.equal(await stateOf(page), "error", "an early explicit error must not fall through to quiet unchanged-revision recovery");

        await page.evaluate(({ revision, turn }) => {
          window.__nativeCompletionHarness.setRuntime({
            active: false,
            revision,
            deployedRevision: revision,
            persistedTurns: [...window.__nativeCompletionHarness.snapshot().persistedTurns, turn],
          });
          window.__nativeCompletionHarness.advanceClock(10 * 60_000);
        }, { revision: EDITED, turn: FINAL_TURN });
        await new Promise((resolve) => setTimeout(resolve, 1_350));
        assert.equal(await stateOf(page), "error");
        const errorAfter = await page.$eval('[data-testid="builder-chat-scroll"]', (node) => node.innerText);
        assert.match(errorBefore, /Stock Think reported an explicit test error/);
        assert.match(errorAfter, /Stock Think reported an explicit test error/);
        const stats = await statsOf(page);
        assert.equal(stats.userSuggestions, 1);
        assert.equal(stats.agentCreationRequests, 0);
        assert.equal(stats.publishRequests, 0);
      } finally {
        await page.close();
      }
    });

    await t.test("reopen after runtime completion shows persisted turns and does not open a generation socket", async () => {
      const page = await startEditor(serverUrl, browser, fixture({ active: true, savedOperation: true }));
      try {
        await waitForState(page, "recovering");
        const beforeRefresh = await statsOf(page);
        assert.equal(beforeRefresh.userSuggestions, 0);
        assert.equal(beforeRefresh.sockets, 0);

        // The same tab is refreshed after stock finished while the editor was
        // away. sessionStorage retains only the operation baseline, not files
        // or conversation; reload must reconcile stock's authoritative state.
        await page.evaluate(({ revision, turns }) => {
          window.__nativeCompletionHarness.setRuntime({
            active: false,
            revision,
            deployedRevision: revision,
            persistedTurns: turns,
          });
        }, { revision: EDITED, turns: [...BASE_TURNS, FINAL_TURN] });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="builder-chat-scroll"]', { timeout: 20_000 });
        await waitForState(page, "recovering");
        await page.evaluate(() => window.__nativeCompletionHarness.advanceClock(36_000));
        await waitForVerificationRevision(page, beforeRefresh.api.filter((entry) => entry.path.endsWith("/runtime/revision")).length + 1);
        await page.evaluate(() => window.__nativeCompletionHarness.advanceClock(31_000));
        await waitForState(page, "success", 20_000);

        const text = await page.$eval('[data-testid="builder-chat-scroll"]', (node) => node.innerText);
        assert.match(text, /Task 3 initial turn \(offline browser-test fixture\)/);
        assert.match(text, new RegExp(PROMPT));
        assert.match(text, new RegExp(ASSISTANT));
        assert.equal(await page.$eval('[data-testid="input-editor-chat"]', (node) => !node.disabled), true);
        const stats = await statsOf(page);
        assert.equal(stats.sockets, 0, "reopen must not create a new native generation socket");
        assert.equal(stats.userSuggestions, 0, "reopen must not resend either persisted prompt");
        assert.equal(stats.agentCreationRequests, 0);
        assert.equal(stats.publishRequests, 0);
      } finally {
        await page.close();
      }
    });

    await t.test("reopen while runtime is active reconciles it after completion without resending", async () => {
      const page = await startEditor(serverUrl, browser, fixture({ active: true, savedOperation: true }));
      try {
        await waitForState(page, "recovering");
        const before = await statsOf(page);
        assert.equal(before.userSuggestions, 0);
        assert.equal(before.sockets, 0);
        await page.evaluate(({ revision, turn }) => {
          window.__nativeCompletionHarness.setRuntime({
            active: false,
            revision,
            deployedRevision: revision,
            persistedTurns: [...window.__nativeCompletionHarness.snapshot().persistedTurns, turn],
          });
        }, { revision: EDITED, turn: FINAL_TURN });
        // Polling/stability timers are ordinary browser timers; advancing the
        // wall clock keeps the test fast without bypassing actual client code.
        const priorRevisionChecks = before.api.filter((entry) => entry.path.endsWith("/runtime/revision")).length;
        await page.evaluate(() => window.__nativeCompletionHarness.advanceClock(36_000));
        await waitForVerificationRevision(page, priorRevisionChecks + 1);
        await page.evaluate(() => window.__nativeCompletionHarness.advanceClock(31_000));
        await page.waitForFunction(() => {
          const node = document.querySelector('[data-testid="native-completion-state"]');
          const state = node?.getAttribute("data-state") || node?.getAttribute("data-phase");
          const stats = window.__nativeCompletionHarness.snapshot().stats;
          return state === "success" && stats.userSuggestions === 0 && stats.sockets === 0;
        }, { timeout: 25_000 });
        const text = await page.$eval('[data-testid="builder-chat-scroll"]', (node) => node.innerText);
        assert.match(text, new RegExp(PROMPT));
        assert.match(text, new RegExp(ASSISTANT));
        assert.equal(await page.$eval('[data-testid="input-editor-chat"]', (node) => !node.disabled), true);
        const stats = await statsOf(page);
        assert.equal(stats.userSuggestions, 0);
        assert.equal(stats.sockets, 0);
        assert.equal(stats.agentCreationRequests, 0);
        assert.equal(stats.publishRequests, 0);
      } finally {
        await page.close();
      }
    });
  } finally {
    await browser?.close();
    if (httpServer?.listening) await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    await rm(bundleDir, { recursive: true, force: true });
  }
});