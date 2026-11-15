import test from "node:test";
import assert from "node:assert/strict";
import git from "isomorphic-git";
import { createFsFromVolume, Volume } from "memfs";
import {
  allowedNativeClientFrame,
  changedFilesBetweenCommits,
  createNativeTicketRequest,
  filterNativeServerFrame,
  ownerCsrfToken,
  openStockAgentWebSocket,
  previewUrlAllowed,
  safeThinkFilePath,
  safeNativeTurnEvent,
  shapeThinkHistory,
  stockThinkRequest,
} from "../cloudflare/staging/think-runtime";
import {
  closeNativeConnectionAttempt,
  completeNativeConnectionHandshake,
  failNativeConnectionAttempt,
  setNativeConnectionStage,
  startNativeConnectionAttempt,
} from "../cloudflare/staging/native-connection-diagnostics";

const env = {
  DB: {} as D1Database,
  AUTH_RUNTIME_URL: "https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev",
  STAGING_ALLOWED_ORIGIN: "https://buildcustom-control-plane-staging.thegoldimport.workers.dev",
};

test("native Think bridge allows suggestions and read/stop messages, but never generate_all", () => {
  assert.deepEqual(allowedNativeClientFrame({ type: "get_conversation_state", agentId: "attacker" }), {
    type: "get_conversation_state",
  });
  assert.deepEqual(allowedNativeClientFrame({ type: "stop_generation" }), { type: "stop_generation" });
  assert.deepEqual(allowedNativeClientFrame({ type: "user_suggestion", message: "Build a page" }), {
    type: "user_suggestion",
    message: "Build a page",
  });
  assert.equal(allowedNativeClientFrame({ type: "generate_all" }), null);
  assert.equal(allowedNativeClientFrame({ type: "deployment_completed" }), null);
  assert.equal(allowedNativeClientFrame({ type: "user_suggestion", message: " " }), null);
  assert.equal(allowedNativeClientFrame({ type: "user_suggestion", message: "x".repeat(30_001) }), null);
});

test("native Think image attachments and browser-supplied routing metadata are bounded", () => {
  const image = {
    id: "image-1",
    filename: "reference.png",
    mimeType: "image/png",
    base64Data: "YWJj",
    size: 3,
    agentId: "must-not-be-forwarded",
  };
  assert.deepEqual(allowedNativeClientFrame({
    type: "user_suggestion",
    message: "Use the reference",
    images: [image],
    projectId: 999,
  }), {
    type: "user_suggestion",
    message: "Use the reference",
    images: [{
      id: "image-1",
      filename: "reference.png",
      mimeType: "image/png",
      base64Data: "YWJj",
      size: 3,
    }],
  });
  assert.equal(allowedNativeClientFrame({
    type: "user_suggestion",
    message: "Use the reference",
    images: [{ ...image, size: 5_000_000 }],
  }), null);
  assert.equal(allowedNativeClientFrame({
    type: "user_suggestion",
    message: "Use the reference",
    images: [image, image, image, image, image],
  }), null);
});

test("native activity metadata is bounded, validated, and stripped from the upstream prompt", () => {
  const turnId = "c1e2d3f4-a5b6-4789-8abc-def012345678";
  const clean = allowedNativeClientFrame({
    type: "user_suggestion",
    message: "Update the dashboard",
    buildcustomTurnId: turnId,
    buildcustomBaselineCommitHash: "a".repeat(40),
  });
  assert.deepEqual(clean, {
    type: "user_suggestion",
    message: "Update the dashboard",
    buildcustomTurnId: turnId,
    buildcustomBaselineCommitHash: "a".repeat(40),
  });
  assert.equal(allowedNativeClientFrame({
    type: "user_suggestion",
    message: "Update the dashboard",
    buildcustomTurnId: "not-a-turn-id",
    buildcustomBaselineCommitHash: null,
  }), null);
  assert.equal(allowedNativeClientFrame({
    type: "user_suggestion",
    message: "Update the dashboard",
    buildcustomTurnId: turnId,
    buildcustomBaselineCommitHash: "bad-revision",
  }), null);
});

test("server frames redact credential-bearing state and drop framework Cloudflare token frames", () => {
  const connected = filterNativeServerFrame(JSON.stringify({
    type: "agent_connected",
    state: {
      shouldBeGenerating: true,
      generation: { status: "running" },
      cloudflareToken: "encrypted-oauth-blob",
      nested: { apiKey: "secret", useful: "kept" },
    },
  }));
  assert.ok(connected);
  assert.doesNotMatch(connected, /encrypted-oauth-blob|apiKey|secret/);
  assert.deepEqual(JSON.parse(connected), {
    type: "agent_connected",
    state: { shouldBeGenerating: true, generation: { status: "running" }, nested: { useful: "kept" } },
  });
  assert.equal(filterNativeServerFrame(JSON.stringify({ type: "cf_agent_state", state: { ready: true } })), null);
});

test("server frame filter rejects JSON-encoded framework types but preserves native Think frames", () => {
  const oauthBlob = "fake-oauth-blob-".repeat(900);
  const frameworkType = JSON.stringify({
    state: { cloudflareToken: oauthBlob, identity: { accessToken: oauthBlob } },
    type: "cf_agent_state",
  });
  assert.equal(frameworkType.length > 14_000, true);
  assert.equal(filterNativeServerFrame(JSON.stringify({ type: frameworkType })), null);
  assert.equal(filterNativeServerFrame(JSON.stringify({ type: "x".repeat(65) })), null);
  assert.equal(filterNativeServerFrame(JSON.stringify({ type: "{\"type\":" })), null);

  for (const type of ["generation_started", "conversation_response", "file_generated", "deployment_completed"]) {
    assert.equal(JSON.parse(filterNativeServerFrame(JSON.stringify({ type, state: { cloudflareToken: oauthBlob, status: "ok" } }))!).type, type);
  }
  const safe = JSON.parse(filterNativeServerFrame(JSON.stringify({
    type: "conversation_response",
    state: { status: "complete", credentials: { token: oauthBlob }, nested: [{ apiKey: oauthBlob, visible: true }] },
  }))!);
  assert.deepEqual(safe.state, { status: "complete", nested: [{ visible: true }] });
  assert.doesNotMatch(JSON.stringify(safe), /fake-oauth-blob/);
});

test("only the stock one-use WebSocket ticket endpoint is an allowed POST", () => {
  assert.equal(createNativeTicketRequest("/api/ws-ticket"), true);
  assert.equal(createNativeTicketRequest("/api/agent/some-agent/preview"), false);
  assert.equal(createNativeTicketRequest("/api/agent"), false);
  assert.equal(createNativeTicketRequest("/api/ws-ticket?resourceId=attacker"), false);
});

test("stock requests use only allowlisted owner cookies and never browser bearer headers", async () => {
  let forwarded: Request | null = null;
  const runtime = {
    async fetch(request: Request) {
      forwarded = request;
      return Response.json({ success: true, data: { accepted: true } });
    },
  };
  const request = new Request("https://buildcustom-control-plane-staging.thegoldimport.workers.dev/api/projects/1/runtime/ws", {
    method: "GET",
    headers: {
      Cookie: "accessToken=stock-session; accessToken=shadow-session; csrf-token=csrf-cookie; __Host-cf_oauth_token=encrypted-blob; unrelated=do-not-forward",
      Authorization: "Bearer browser-value",
      "X-CSRF-Token": "csrf-header",
    },
  });
  await stockThinkRequest({
    ...env,
    AUTH_RUNTIME: runtime as unknown as Fetcher,
  }, request, "/api/agent/owner-linked-agent/branches");
  assert.ok(forwarded);
  assert.equal(forwarded!.url, `${env.AUTH_RUNTIME_URL}/api/agent/owner-linked-agent/branches`);
  assert.equal(forwarded!.headers.get("Authorization"), null);
  assert.equal(forwarded!.headers.get("X-CSRF-Token"), null);
  assert.equal(
    forwarded!.headers.get("Cookie"),
    "accessToken=stock-session; csrf-token=csrf-cookie",
  );
  assert.equal(forwarded!.method, "GET");
  await assert.rejects(() => stockThinkRequest({
    ...env,
    AUTH_RUNTIME: runtime as unknown as Fetcher,
  }, request, "/api/agent/attacker/preview", { method: "POST" }), /Unsupported owner-scoped runtime request/);
});

test("owner CSRF forwarding extracts a fresh token from the encoded runtime cookie", () => {
  const token = "runtime-csrf-token";
  const cookieValue = encodeURIComponent(JSON.stringify({ token, timestamp: Date.now() }));
  const request = new Request("https://app.buildcustom.ai/api/projects/1/runtime/ws", {
    headers: { Cookie: `accessToken=stock-session; csrf-token=${cookieValue}` },
  });
  assert.equal(ownerCsrfToken(request), token);
  assert.equal(ownerCsrfToken(new Request("https://app.buildcustom.ai/api/projects/1/runtime/ws", {
    headers: { "X-CSRF-Token": "explicit-header-token", Cookie: `csrf-token=${cookieValue}` },
  })), "explicit-header-token");
});

test("owner CSRF forwarding rejects malformed, expired, and future-dated JSON cookies", () => {
  const expired = encodeURIComponent(JSON.stringify({ token: "expired-token", timestamp: Date.now() - 2 * 60 * 60 * 1000 - 1 }));
  const future = encodeURIComponent(JSON.stringify({ token: "future-token", timestamp: Date.now() + 1000 }));
  for (const value of [encodeURIComponent("{invalid"), expired, future, "%E0%A4%A"]) {
    const request = new Request("https://app.buildcustom.ai/api/projects/1/runtime/ws", {
      headers: { Cookie: `csrf-token=${value}` },
    });
    assert.equal(ownerCsrfToken(request), null);
  }
});

test("BuildCustom AI refresh is an owner-scoped POST with the CSRF cookie forwarded", async () => {
  let forwarded: Request | null = null;
  const calls: Request[] = [];
  const runtime = {
    async fetch(request: Request) {
      calls.push(request);
      if (request.url.endsWith("/api/auth/csrf-token")) {
        return Response.json({ success: true, data: { token: "server-csrf-token" } }, {
          headers: { "Set-Cookie": "csrf-token=server-csrf-cookie; Path=/; Secure; HttpOnly; SameSite=Strict" },
        });
      }
      forwarded = request;
      return Response.json({ success: true, data: { refreshed: true } });
    },
  };
  const request = new Request("https://buildcustom-control-plane-staging.thegoldimport.workers.dev/api/projects/1/runtime/ws", {
    headers: {
      Origin: "https://buildcustom-control-plane-staging.thegoldimport.workers.dev",
      Cookie: "accessToken=stock-session; unrelated=do-not-forward",
    },
  });
  const response = await stockThinkRequest({
    ...env,
    AUTH_RUNTIME: runtime as unknown as Fetcher,
  }, request, "/api/agent/owner-linked-agent/buildcustom-ai-config/refresh", {
    method: "POST",
    body: {},
  });
  assert.equal(response.status, 200);
  assert.ok(forwarded);
  assert.equal(forwarded!.method, "POST");
  assert.equal(forwarded!.headers.get("Origin"), "https://buildcustom-control-plane-staging.thegoldimport.workers.dev");
  assert.equal(forwarded!.headers.get("X-CSRF-Token"), "server-csrf-token");
  assert.equal(forwarded!.headers.get("Cookie"), "accessToken=stock-session; csrf-token=server-csrf-cookie");
  assert.equal(forwarded!.headers.get("Authorization"), null);
  assert.equal(calls.length, 2, "the authenticated runtime CSRF bootstrap must complete before the settings POST");
  assert.equal(calls[0].url, `${env.AUTH_RUNTIME_URL}/api/auth/csrf-token`);
  assert.equal(calls[0].headers.get("Cookie"), "accessToken=stock-session");
  assert.equal(calls[0].redirect, "manual");
});

test("owner-scoped POST refuses to proceed if fresh runtime CSRF bootstrap is rejected", async () => {
  const calls: Request[] = [];
  const runtime = {
    async fetch(request: Request) {
      calls.push(request);
      return Response.json({ message: "unauthorized" }, { status: 401 });
    },
  };
  const request = new Request("https://app.buildcustom.ai/api/projects/1/runtime/ws", {
    headers: { Cookie: "accessToken=stock-session" },
  });
  await assert.rejects(() => stockThinkRequest({
    ...env,
    AUTH_RUNTIME: runtime as unknown as Fetcher,
  }, request, "/api/agent/owner-linked-agent/buildcustom-ai-config/refresh", { method: "POST", body: {} }),
  (error: unknown) => {
    assert.equal((error as RuntimeIdentityError).status, 401);
    assert.equal((error as RuntimeIdentityError).code, "NATIVE_CSRF_BOOTSTRAP_REJECTED");
    return true;
  });
  assert.equal(calls.length, 1, "no state-changing request is sent after CSRF bootstrap fails");
  assert.equal(calls[0].url, `${env.AUTH_RUNTIME_URL}/api/auth/csrf-token`);
});

test("native connection diagnostics persist bounded stages, failures, handshake, and safe disconnect states", async () => {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) { values = args; return statement; },
        async run() { writes.push({ sql, values }); return { success: true }; },
      };
      return statement;
    },
  } as unknown as D1Database;
  const request = new Request("https://app.buildcustom.ai/api/projects/10/runtime/ws", {
    headers: { "cf-ray": "abc123-SJC", Cookie: "accessToken=PRIVATE_SESSION; csrf-token=PRIVATE_CSRF" },
  });
  const failed = await startNativeConnectionAttempt(db, request, 10, "owner-1");
  assert.equal(failed.correlationId, "abc123-SJC");
  await setNativeConnectionStage(db, failed.attemptId, "ai_settings_refresh", true);
  await failNativeConnectionAttempt(db, failed.attemptId, {
    stage: "ai_settings_refresh",
    status: 403,
    errorCode: "NATIVE_AI_CONFIG_REFRESH_REJECTED",
  });
  const connected = await startNativeConnectionAttempt(db, request, 10, "owner-1");
  await setNativeConnectionStage(db, connected.attemptId, "runtime_websocket");
  await completeNativeConnectionHandshake(db, connected.attemptId);
  await closeNativeConnectionAttempt(db, connected.attemptId, false);

  assert.match(writes[1].sql, /INSERT INTO native_connection_attempts/);
  assert.deepEqual(writes[1].values.slice(1, 3), [10, "owner-1"]);
  assert.deepEqual(writes[2].values.slice(0, 3), ["ai_settings_refresh", 1, "ai_settings_refresh"]);
  assert.ok(writes.some(({ sql, values }) => /status='failed'/.test(sql) && values.includes("NATIVE_AI_CONFIG_REFRESH_REJECTED")));
  assert.ok(writes.some(({ sql, values }) => /http_status=101/.test(sql) && values.includes(connected.attemptId)));
  assert.ok(writes.some(({ sql, values }) => /status='disconnected'/.test(sql) && values.includes("remote_close")));
  assert.doesNotMatch(JSON.stringify(writes), /PRIVATE_SESSION|PRIVATE_CSRF/);
});

test("ticket bootstrap couples the fresh stock CSRF cookie/header and keeps owner-bound ticket server-side", async () => {
  const calls: Request[] = [];
  const socket = {} as WebSocket;
  const runtime = {
    async fetch(request: Request) {
      calls.push(request);
      if (request.url.endsWith("/api/auth/csrf-token")) {
        assert.equal(request.method, "GET");
        assert.equal(request.headers.get("Cookie"), "accessToken=stock-session");
        assert.equal(request.headers.get("Cache-Control"), "no-store");
        return Response.json({ success: true, data: { token: "fresh-csrf-header" } }, {
          headers: { "Set-Cookie": "csrf-token=fresh-csrf-cookie; Path=/; Secure; HttpOnly; SameSite=Strict" },
        });
      }
      if (request.url.endsWith("/api/ws-ticket")) {
        assert.equal(request.method, "POST");
        assert.equal(request.headers.get("Cookie"), "accessToken=stock-session; csrf-token=fresh-csrf-cookie");
        assert.equal(request.headers.get("X-CSRF-Token"), "fresh-csrf-header");
        assert.equal(request.headers.get("Cache-Control"), "no-store");
        assert.deepEqual(await request.json(), { resourceType: "agent", resourceId: "linked-agent" });
        return Response.json({ success: true, data: { ticket: `tk_${"a".repeat(40)}` } });
      }
      if (request.url.endsWith("/api/agent/foreign-agent/ws-ticket")) {
        return Response.json({ success: false }, { status: 403 });
      }
      assert.equal(request.method, "GET");
      assert.equal(request.url, `${env.AUTH_RUNTIME_URL}/api/agent/linked-agent/ws?ticket=tk_${"a".repeat(40)}`);
      assert.equal(request.headers.get("Upgrade"), "websocket");
      assert.match(request.headers.get("Cookie") || "", /accessToken=stock-session/);
      assert.match(request.headers.get("Cookie") || "", /__Host-cf_oauth_token=encrypted-blob/);
      return { status: 101, webSocket: socket } as unknown as Response;
    },
  };
  const request = new Request("https://buildcustom-control-plane-staging.thegoldimport.workers.dev/api/projects/1/runtime/ws", {
    headers: {
      Cookie: "accessToken=stock-session; csrf-token=csrf-cookie; __Host-cf_oauth_token=encrypted-blob",
    },
  });
  const upstream = await openStockAgentWebSocket({
    ...env,
    AUTH_RUNTIME: runtime as unknown as Fetcher,
  }, request, "linked-agent");
  assert.equal(upstream, socket);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url.includes("tk_"), true);
  await assert.rejects(async () => openStockAgentWebSocket({
    ...env,
    AUTH_RUNTIME: {
      async fetch(request: Request) {
        if (request.url.endsWith("/api/auth/csrf-token")) {
          return Response.json({ success: true, data: { token: "fresh-csrf-header" } }, {
            headers: { "Set-Cookie": "csrf-token=fresh-csrf-cookie; Path=/; Secure" },
          });
        }
        return Response.json({ success: false }, { status: 403 });
      },
    } as unknown as Fetcher,
  }, request, "foreign-agent"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /could not issue a project connection ticket/i);
    assert.equal((error as RuntimeIdentityError).status, 403);
    assert.equal((error as RuntimeIdentityError).code, "NATIVE_WS_TICKET_REJECTED");
    return true;
  });
});

test("upstream WebSocket timeouts are classified without exposing transport details", async () => {
  const runtime = {
    async fetch(request: Request) {
      if (request.url.endsWith("/api/auth/csrf-token")) {
        return Response.json({ success: true, data: { token: "csrf-header" } }, {
          headers: { "Set-Cookie": "csrf-token=csrf-cookie; Path=/; Secure" },
        });
      }
      if (request.url.endsWith("/api/ws-ticket")) {
        return Response.json({ success: true, data: { ticket: `tk_${"b".repeat(40)}` } });
      }
      throw new DOMException("internal transport details", "TimeoutError");
    },
  };
  const request = new Request("https://app.buildcustom.ai/api/projects/10/runtime/ws", {
    headers: { Cookie: "accessToken=stock-session" },
  });
  await assert.rejects(() => openStockAgentWebSocket({
    ...env,
    AUTH_RUNTIME: runtime as unknown as Fetcher,
  }, request, "linked-agent"), (error: unknown) => {
    assert.equal((error as RuntimeIdentityError).status, 502);
    assert.equal((error as RuntimeIdentityError).code, "NATIVE_AGENT_WS_TIMEOUT");
    assert.doesNotMatch((error as Error).message, /internal transport details/i);
    return true;
  });
});

test("preview capabilities stay HTTPS, owner-path-scoped, signed, and on the stock staging origin", () => {
  const good = "https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev/space/agent-1/preview/main/?t=signed-token";
  assert.equal(previewUrlAllowed(env, "agent-1", good), true);
  assert.equal(previewUrlAllowed(env, "agent-1", "http://bc-vibesdk-lab-20260925.thegoldimport.workers.dev/space/agent-1/preview/main/?t=x"), false);
  assert.equal(previewUrlAllowed(env, "agent-1", "https://elsewhere.example/space/agent-1/preview/main/?t=x"), false);
  assert.equal(previewUrlAllowed(env, "agent-1", "https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev/space/agent-2/preview/main/?t=x"), false);
  assert.equal(previewUrlAllowed(env, "agent-1", "https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev/space/agent-1/preview/main/"), false);
});

test("artifact file paths reject traversal and malformed separators", () => {
  assert.equal(safeThinkFilePath("src/App.tsx"), "src/App.tsx");
  assert.equal(safeThinkFilePath("../secrets"), null);
  assert.equal(safeThinkFilePath("src//App.tsx"), null);
  assert.equal(safeThinkFilePath("/etc/passwd"), null);
});

test("reopened turns are derived from persisted stock conversation messages", () => {
  assert.deepEqual(shapeThinkHistory([
    { role: "user", content: "Build the page", conversationId: "user-1" },
    { role: "assistant", content: [{ type: "text", text: "I will build it." }], conversationId: "assistant-1" },
    { role: "tool", content: "ignored tool result" },
    { role: "assistant", content: "It is ready.", conversationId: "assistant-2" },
  ]), [{
    id: 1,
    mode: "build",
    prompt: "Build the page",
    response: "I will build it.\nIt is ready.",
    changedFiles: [],
    activity: [],
    commitHash: null,
    createdAt: "",
  }]);
  assert.throws(() => shapeThinkHistory(null), /invalid result/);
});

test("native saved activity and Development checkpoints merge only into their matching turns", () => {
  const turnId = "c1e2d3f4-a5b6-4789-8abc-def012345678";
  const turns = shapeThinkHistory([
    { role: "user", content: "Change the header", conversationId: "user-1" },
    { role: "assistant", content: "Header updated.", conversationId: "assistant-1" },
    { role: "user", content: "A request without saved activity" },
    { role: "assistant", content: "Reply without a checkpoint." },
  ], [{
    id: 44,
    mode: "native_build",
    prompt: "Change the header",
    response: "Persisted response",
    changed_files: JSON.stringify([{ path: "src/Header.tsx", change: "modified", size: 120 }]),
    commit_hash: "b".repeat(40),
    activity: JSON.stringify([
      { type: "__buildcustom_native_turn", token: turnId, status: "checkpoint_verified", baselineCommitHash: "a".repeat(40) },
      { type: "tool", label: "Updated src/Header.tsx", path: "src/Header.tsx", status: "success", createdAt: "2026-11-15T12:00:00.000Z" },
    ]),
    created_at: "2026-11-15T12:00:00.000Z",
  }]);

  assert.equal(turns[0].id, 44);
  assert.equal(turns[0].response, "Header updated.");
  assert.equal(turns[0].status, "checkpoint_verified");
  assert.equal(turns[0].commitHash, "b".repeat(40));
  assert.deepEqual(turns[0].changedFiles, [{ path: "src/Header.tsx", change: "modified", size: 120 }]);
  assert.deepEqual(turns[0].activity.map((event) => event.label), ["Updated src/Header.tsx"]);
  assert.equal(turns[1].id, -2);
  assert.equal(turns[1].activity.length, 0);
  assert.equal(turns[1].commitHash, null);
  assert.equal(turns[1].status, undefined);
});

test("persisted native turns remain readable when the stock transcript has not returned them", () => {
  const saved = {
    id: 45,
    mode: "native_build",
    prompt: "Saved prompt",
    response: "Saved response",
    changed_files: "[]",
    commit_hash: null,
    activity: JSON.stringify([
      { type: "__buildcustom_native_turn", token: "c1e2d3f4-a5b6-4789-8abc-def012345678", status: "interrupted", baselineCommitHash: null },
      { type: "progress", label: "Connection ended", status: "error", createdAt: "2026-11-15T12:00:00.000Z" },
    ]),
    created_at: "2026-11-15T12:00:00.000Z",
  };
  const turns = shapeThinkHistory([], [saved]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].prompt, "Saved prompt");
  assert.equal(turns[0].response, "Saved response");
  assert.equal(turns[0].status, "interrupted");
  assert.equal(turns[0].commitHash, null);
});

test("native activity records safe progress, file changes, and explicit non-completion status", () => {
  assert.equal(safeNativeTurnEvent({ type: "generation_complete" })?.status, "agent_turn_ended");
  assert.equal(
    safeNativeTurnEvent({ type: "generation_complete" })?.activity?.label,
    "Agent turn ended · application completion is not verified",
  );
  assert.equal(safeNativeTurnEvent({ type: "file_generated", path: "/src/App.tsx" })?.activity?.label,
    "Agent reported generating src/App.tsx");
  assert.equal(safeNativeTurnEvent({ type: "file_deleted", path: "../private.txt" }), null);
  assert.equal(safeNativeTurnEvent({ type: "user_suggestion", message: "private prompt" }), null);
});

test("native checkpoint file comparison identifies additions, edits, and deletions", async () => {
  const fs = createFsFromVolume(new Volume());
  const dir = "/native-checkpoint";
  await git.init({ fs, dir, defaultBranch: "main" });
  const commit = async (message: string) => git.commit({
    fs, dir, message,
    author: { name: "BuildCustom test", email: "test@example.invalid" },
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/index.html`, "A");
  fs.writeFileSync(`${dir}/old.txt`, "old");
  fs.writeFileSync(`${dir}/stable.txt`, "unchanged");
  await git.add({ fs, dir, filepath: "index.html" });
  await git.add({ fs, dir, filepath: "old.txt" });
  await git.add({ fs, dir, filepath: "stable.txt" });
  const baseline = await commit("baseline");

  fs.writeFileSync(`${dir}/index.html`, "B");
  fs.writeFileSync(`${dir}/new.txt`, "new");
  await git.add({ fs, dir, filepath: "index.html" });
  await git.add({ fs, dir, filepath: "new.txt" });
  await git.remove({ fs, dir, filepath: "old.txt" });
  const target = await commit("updated project");
  const changes = await changedFilesBetweenCommits(
    { fs, dir, commitHash: target, files: [] },
    baseline,
    target,
  );
  assert.deepEqual(changes, [
    { path: "index.html", change: "modified", size: 1 },
    { path: "new.txt", change: "added", size: 3 },
    { path: "old.txt", change: "deleted", size: 0 },
  ]);
  await assert.rejects(
    changedFilesBetweenCommits({ fs, dir, commitHash: baseline, files: [] }, baseline, target),
    /checkpoint no longer matches/,
  );
});