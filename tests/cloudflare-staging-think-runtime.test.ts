import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedNativeClientFrame,
  createNativeTicketRequest,
  filterNativeServerFrame,
  openStockAgentWebSocket,
  previewUrlAllowed,
  safeThinkFilePath,
  shapeThinkHistory,
  stockThinkRequest,
} from "../cloudflare/staging/think-runtime";

const env = {
  DB: {} as D1Database,
  AUTH_RUNTIME_URL: "https://bc-vibesdk-lab-20260925.thegoldimport.workers.dev",
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
  await assert.rejects(() => openStockAgentWebSocket({
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
  }, request, "foreign-agent"), /not available/);
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