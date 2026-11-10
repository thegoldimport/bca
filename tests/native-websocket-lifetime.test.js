import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import * as localWorkers from "miniflare";

const root = fileURLToPath(new URL("../", import.meta.url));
const entry = `
import { openStockAgentWebSocket } from "./cloudflare/staging/think-runtime.ts";
let upgradeSignal;
export default { async fetch(request, env) {
  const path = new URL(request.url).pathname;
  if (path === "/inspect") {
    const counts = await (await env.ECHO.fetch("https://offline-runtime.example/counts")).json();
    return Response.json({ aborted: upgradeSignal?.aborted, ...counts });
  }
  const runtime = { fetch(req) {
    if (req.headers.get("Upgrade") === "websocket") upgradeSignal = req.signal;
    return env.ECHO.fetch(req);
  }};
  try {
    const socket = await openStockAgentWebSocket({
      AUTH_RUNTIME: runtime, ENVIRONMENT: "production", CONTROL_PLANE_PROFILE: "launch",
      // Exact production URL allowlist, with every fetch bound to the isolated ECHO Worker.
      AUTH_RUNTIME_URL: "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev",
    }, request, path === "/stalled" ? "stalled-agent" : "linked-agent");
    return new Response(null, { status: 101, webSocket: socket });
  } catch (error) { return Response.json({ code: error.code }, { status: error.status || 500 }); }
}};
`;
// Clearly labeled sandboxed transport, not a customer agent or provider runtime.
const echo = `
let prompts = 0, connections = 0;
export default { async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/counts") return Response.json({ prompts, connections });
  if (path === "/api/auth/csrf-token") return Response.json({ success: true, data: { token: "offline-csrf" } }, {
    headers: { "Set-Cookie": "csrf-token=offline-cookie; Path=/; Secure; HttpOnly" },
  });
  if (path === "/api/ws-ticket") {
    if (!request.headers.get("Cookie")?.includes("accessToken=offline-fixture")
      || request.headers.get("X-CSRF-Token") !== "offline-csrf") return new Response(null, { status: 403 });
    return Response.json({ success: true, data: { ticket: "tk_" + "a".repeat(40) } });
  }
  if (path.includes("/stalled-agent/")) {
    await new Promise(resolve => setTimeout(resolve, 60_000));
    return new Response(null, { status: 504 });
  }
  if (request.headers.get("Upgrade") !== "websocket") return new Response(null, { status: 400 });
  connections++;
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].addEventListener("message", event => {
    if (event.data === "close-fixture") { pair[1].close(1001, "Offline remote close"); return; }
    try { if (JSON.parse(event.data).type === "user_suggestion") prompts++; } catch {}
    pair[1].send(event.data);
  });
  return new Response(null, { status: 101, webSocket: pair[0] });
}};
`;

function message(socket, text) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.removeEventListener("message", listener); reject(new Error("Echo timeout")); }, 2000);
    const listener = (event) => {
      if (event.data !== text) return;
      clearTimeout(timer);
      socket.removeEventListener("message", listener);
      resolve();
    };
    socket.addEventListener("message", listener);
    socket.send(text);
  });
}

test("real isolated Workers transport separates upgrade deadlines from socket lifetime", { timeout: 55_000 }, async (t) => {
  const bundled = await build({ stdin: { contents: entry, resolveDir: root, sourcefile: "offline-transport.ts" },
    bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire("/offline-transport.mjs");' } });
  const options = { workers: [
    { name: "proxy", modules: true, compatibilityDate: "2026-09-20", compatibilityFlags: ["nodejs_compat"], serviceBindings: { ECHO: "echo" }, script: bundled.outputFiles[0].text },
    { name: "echo", modules: true, compatibilityDate: "2026-09-20", script: echo },
  ] };
  const mf = new localWorkers.Miniflare(localWorkers.convertV4MiniflareOptions
    ? localWorkers.convertV4MiniflareOptions(options) : options);
  const open = (path = "/ws", cookie = "accessToken=offline-fixture") =>
    mf.dispatchFetch(`https://offline-control.example${path}`, { headers: { Upgrade: "websocket", Cookie: cookie } });
  try {
    await t.test("the actual production helper keeps an upgraded socket usable after its real 15-second deadline", async () => {
      const response = await open();
      assert.equal(response.status, 101);
      const socket = response.webSocket;
      socket.accept();
      let closed = false;
      socket.addEventListener("close", () => { closed = true; });
      await message(socket, "before-deadline");
      await new Promise((resolve) => setTimeout(resolve, 15_300));
      const meta = await (await mf.dispatchFetch("https://offline-control.example/inspect")).json();
      assert.equal(typeof meta.aborted, "boolean");
      t.diagnostic(`Actual upgrade request signal aborted after 15 seconds: ${meta.aborted}`);
      assert.equal(closed, false, "abort does not terminate an already upgraded workerd socket");
      await message(socket, "after-deadline");
      assert.equal(meta.prompts, 0);
      socket.close(1000, "Offline test complete");
    });
    await t.test("an unfinished handshake still times out and returns the safe classified error", async () => {
      const startedAt = Date.now();
      const response = await open("/stalled");
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { code: "NATIVE_AGENT_WS_TIMEOUT" });
      assert.ok(Date.now() - startedAt >= 14_000);
      assert.ok(Date.now() - startedAt < 22_000);
    });
    await t.test("a genuine remote close permits a fresh connection without submitting a prompt", async () => {
      const first = (await open()).webSocket;
      first.accept();
      const closed = new Promise((resolve) => first.addEventListener("close", resolve, { once: true }));
      first.send("close-fixture");
      await closed;
      const second = (await open()).webSocket;
      second.accept();
      await message(second, "reconnected");
      const meta = await (await mf.dispatchFetch("https://offline-control.example/inspect")).json();
      assert.equal(meta.prompts, 0);
      second.close(1000, "Offline test complete");
    });
    await t.test("a missing owner session is rejected before an upgrade can be established", async () => {
      const response = await open("/ws", "");
      assert.ok([401, 403].includes(response.status));
    });
  } finally { await mf.dispose(); }
});
