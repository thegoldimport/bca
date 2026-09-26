import test from "node:test";
import assert from "node:assert/strict";
import {
  handleLaunchPreviewProxy,
  isPreviewProductApiRequest,
  launchPreviewCookie,
  launchPreviewProxyUrl,
  rewritePreviewCss,
  rewritePreviewHtml,
  rewritePreviewJavaScript,
} from "../cloudflare/staging/preview-proxy";

const controlOrigin = "https://buildcustom-control-plane-production.thegoldimport.workers.dev";
const runtimeOrigin = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const token = `${"a".repeat(32)}.${"b".repeat(32)}.${"c".repeat(32)}`;
const route = (agentId: string, branch: string, path = "") =>
  `/_private_preview/${encodeURIComponent(agentId)}/${encodeURIComponent(branch)}/${path}`;
const launchEnv = (runtime: Fetcher) => ({
  ENVIRONMENT: "production",
  CONTROL_PLANE_PROFILE: "launch",
  CONTROL_PLANE_ALLOWED_ORIGIN: controlOrigin,
  AUTH_RUNTIME_URL: runtimeOrigin,
  AUTH_RUNTIME: runtime,
});

test("launch previews become exact-origin branch-scoped capability URLs only", () => {
  const runtime = {} as Fetcher;
  const preview = `${runtimeOrigin}/space/agent-1/preview/main/?t=${token}`;
  assert.equal(
    launchPreviewProxyUrl(launchEnv(runtime), "agent-1", preview),
    `${controlOrigin}${route("agent-1", "main")}`,
  );
  assert.equal(launchPreviewProxyUrl(launchEnv(runtime), "agent-1", "https://evil.example/space/agent-1/preview/main/?t=x"), null);
  assert.equal(launchPreviewProxyUrl(launchEnv(runtime), "agent-1", `${runtimeOrigin}/space/agent-2/preview/main/?t=${token}`), null);
  assert.equal(launchPreviewProxyUrl(launchEnv(runtime), "agent-1", `${runtimeOrigin}/space/agent-1/preview/main/?t=${token}&extra=x`), null);
  assert.equal(launchPreviewProxyUrl({ ...launchEnv(runtime), CONTROL_PLANE_PROFILE: "staging" }, "agent-1", preview), null);
});

test("HTML and CSS root assets stay under a branch-scoped path with the preview token", () => {
  const previewRoute = route("agent-1", "main");
  const requestUrl = new URL(`${controlOrigin}${previewRoute}`);
  const capability = { agentId: "agent-1", branch: "main", token, path: "" };
  const html = rewritePreviewHtml(
    '<html><head></head><body><script src="/src/main.js"></script><link href="/site.css"><link href="relative.css"><img srcset="/a.webp 1x, /b.webp 2x"></body></html>',
    requestUrl,
    controlOrigin,
    capability,
  );
  assert.match(html, new RegExp(`${previewRoute}src/main\\.js`));
  assert.match(html, new RegExp(`${previewRoute}site\\.css`));
  assert.ok(html.includes(`${previewRoute}a.webp?t=${token} 1x`));
  assert.ok(html.includes(`${previewRoute}b.webp?t=${token} 2x`));
  assert.ok(html.includes(`${previewRoute}src/main.js?t=${token}`));
  assert.ok(html.includes(`${controlOrigin}${previewRoute}relative.css?t=${token}`));
  assert.match(html, /name="referrer" content="no-referrer"/);

  const css = rewritePreviewCss(
    "body{background:url('/images/bg.webp') url('images/relative.webp')}@import '/theme.css';",
    requestUrl,
    controlOrigin,
    capability,
  );
  assert.match(css, new RegExp(`${previewRoute}images/bg\\.webp`));
  assert.match(css, new RegExp(`${previewRoute}theme\\.css`));
  assert.ok(css.includes(`${controlOrigin}${previewRoute}images/relative.webp?t=${token}`));

  const javascript = rewritePreviewJavaScript(
    'import "/src/chunk.js"; fetch("/assets/data.json"); fetch("/api/auth/me?t=upstream-token");',
    requestUrl,
    controlOrigin,
    capability,
  );
  assert.match(javascript, new RegExp(`${previewRoute}src/chunk\\.js`));
  assert.match(javascript, new RegExp(`${previewRoute}assets/data\\.json`));
  assert.match(javascript, /fetch\("\/api\/auth\/me"\)/);
  assert.doesNotMatch(javascript, /auth\/me\?t=/);

  const moduleUrl = new URL(`${controlOrigin}${previewRoute}src/main.js`);
  const nestedModule = rewritePreviewJavaScript(
    'import "./chunk.js";',
    moduleUrl,
    controlOrigin,
    { ...capability, path: "src/main.js" },
  );
  assert.ok(nestedModule.includes(`${controlOrigin}${previewRoute}src/chunk.js?t=${token}`));
});

test("runtime-rewritten root assets are normalized only for the matching agent and branch", () => {
  const previewRoute = route("agent-1", "main");
  const requestUrl = new URL(`${controlOrigin}${previewRoute}`);
  const capability = { agentId: "agent-1", branch: "main", token, path: "" };
  const runtimeAssetPrefix = "/space/agent-1/preview/main/";
  const html = rewritePreviewHtml(
    `<head><link href="${runtimeAssetPrefix}styles.css?theme=dark&t=upstream-token"><style>body{background:url('${runtimeAssetPrefix}images/inline.webp?t=upstream-token')}</style></head><a href="/navigate?t=upstream-token">go</a><form action="/submit?t=upstream-token"></form><script>import "${runtimeAssetPrefix}assets/inline.js?t=upstream-token";</script>`,
    requestUrl,
    controlOrigin,
    capability,
  );
  assert.ok(html.includes(`href="${controlOrigin}${previewRoute}styles.css?theme=dark&t=${token}"`));
  assert.ok(html.includes(`${previewRoute}images/inline.webp?t=${token}`));
  assert.ok(html.includes(`href="${controlOrigin}${previewRoute}navigate"`));
  assert.ok(html.includes(`action="${controlOrigin}${previewRoute}submit"`));
  assert.doesNotMatch(html, /(?:navigate|submit)\?t=/);
  assert.ok(html.includes(`import "${controlOrigin}${previewRoute}assets/inline.js?t=${token}"`));
  assert.doesNotMatch(html, /upstream-token/);

  const css = rewritePreviewCss(
    `body{background:url('${runtimeAssetPrefix}images/bg.webp?variant=dark&t=upstream-token')}`,
    requestUrl,
    controlOrigin,
    capability,
  );
  assert.ok(css.includes(`${previewRoute}images/bg.webp?variant=dark&t=${token}`));
  assert.doesNotMatch(css, /upstream-token/);

  const javascript = rewritePreviewJavaScript(
    `import "${runtimeAssetPrefix}assets/chunk.js?mode=fast&t=upstream-token";`,
    requestUrl,
    controlOrigin,
    capability,
  );
  assert.ok(javascript.includes(`${previewRoute}assets/chunk.js?mode=fast&t=${token}`));
  assert.doesNotMatch(javascript, /upstream-token/);

  const wrongCapabilities = rewritePreviewHtml(
    `<link href="/space/agent-2/preview/main/other.css?t=${token}"><link href="/space/agent-1/preview/other/other.css?t=${token}">`,
    requestUrl,
    controlOrigin,
    capability,
  );
  assert.match(wrongCapabilities, /\/space\/agent-2\/preview\/main\/other\.css/);
  assert.match(wrongCapabilities, /\/space\/agent-1\/preview\/other\/other\.css/);
  assert.doesNotMatch(wrongCapabilities, /[?&]t=/);
  assert.doesNotMatch(wrongCapabilities, new RegExp(`${previewRoute}(?:agent-2|other)`));
});

test("preview fetches forward only a fixed runtime path, token, and safe request headers", async () => {
  const calls: Request[] = [];
  const runtime = {
    async fetch(request: Request) {
      calls.push(request);
      return new Response("<html><head></head><script src='/assets/main.js'></script></html>", {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": "__Host-bc_session=leak",
          "Cache-Control": "public, max-age=3600",
          "Access-Control-Allow-Origin": "*",
        },
      });
    },
  } as unknown as Fetcher;
  const path = route("agent-1", "main");
  const runtimePreviewUrl = `${runtimeOrigin}/space/agent-1/preview/main/?t=${token}`;
  const setCookie = await launchPreviewCookie(launchEnv(runtime), "agent-1", runtimePreviewUrl);
  assert.ok(setCookie);
  const capabilityCookie = setCookie!.split(";")[0];
  assert.match(setCookie!, /HttpOnly; SameSite=None; Partitioned/);
  assert.match(setCookie!, new RegExp(`Path=${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  const request = new Request(`${controlOrigin}${path}?screen=home`, {
    headers: {
      Cookie: `__Host-bc_session=dashboard-secret; ${capabilityCookie}`,
      Authorization: "Bearer browser-token",
      "X-CSRF-Token": "csrf-secret",
      Origin: "null",
      Referer: `${controlOrigin}${path}`,
      Accept: "text/html",
    },
  });
  const response = await handleLaunchPreviewProxy(launchEnv(runtime), request);
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  const body = await response.text();
  assert.ok(body.includes(`${path}assets/main.js?t=${token}`));
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `${runtimeOrigin}/space/agent-1/preview/main/?screen=home&t=${token}`,
  );
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers.get("Cookie"), null);
  assert.equal(calls[0].headers.get("Authorization"), null);
  assert.equal(calls[0].headers.get("X-CSRF-Token"), null);
  assert.equal(calls[0].headers.get("Origin"), null);
});

test("scoped module requests keep the HttpOnly preview cookie and rewrite nested root imports", async () => {
  const calls: Request[] = [];
  const runtime = {
    async fetch(request: Request) {
      calls.push(request);
      return new Response('import "/src/chunk.js"; export default true', { headers: { "Content-Type": "text/javascript" } });
    },
  } as unknown as Fetcher;
  const previewRoute = route("agent-1", "feature/ui");
  const runtimePreviewUrl = `${runtimeOrigin}/space/agent-1/preview/feature%2Fui/?t=${token}`;
  const setCookie = await launchPreviewCookie(launchEnv(runtime), "agent-1", runtimePreviewUrl);
  assert.ok(setCookie);
  const response = await handleLaunchPreviewProxy(launchEnv(runtime), new Request(`${controlOrigin}${previewRoute}src/main.js`, {
    headers: {
      Cookie: setCookie!.split(";")[0],
      Referer: `${controlOrigin}${previewRoute}index.html`,
    },
  }));
  assert.ok(response);
  assert.ok((await response.text()).includes(`${previewRoute}src/chunk.js?t=${token}`));
  assert.equal(calls[0].url, `${runtimeOrigin}/space/agent-1/preview/feature%2Fui/src/main.js?t=${token}`);
  assert.equal(calls[0].headers.get("Cookie"), null);
});

test("scoped assets accept a runtime token without cookies and preserve ordinary query parameters", async () => {
  const calls: Request[] = [];
  const runtime = {
    async fetch(request: Request) {
      calls.push(request);
      return new Response("body", { headers: { "Content-Type": "text/css" } });
    },
  } as unknown as Fetcher;
  const path = route("agent-1", "main", "styles.css");
  const response = await handleLaunchPreviewProxy(
    launchEnv(runtime),
    new Request(`${controlOrigin}${path}?theme=dark&t=${token}`),
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${runtimeOrigin}/space/agent-1/preview/main/styles.css?theme=dark&t=${token}`);
  assert.equal(calls[0].headers.get("Cookie"), null);
  assert.equal(calls[0].headers.get("Authorization"), null);
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
});

test("root previews remain cookie-gated and query tokens are rejected off scoped asset paths", async () => {
  let fetches = 0;
  const runtime = { async fetch() { fetches += 1; return new Response("ok"); } } as unknown as Fetcher;
  const env = launchEnv(runtime);
  const branchBRoot = route("agent-1", "feature");
  const rootWithoutCookie = await handleLaunchPreviewProxy(env, new Request(`${controlOrigin}${branchBRoot}`));
  assert.equal(rootWithoutCookie?.status, 401);
  const rootWithQueryToken = await handleLaunchPreviewProxy(
    env,
    new Request(`${controlOrigin}${branchBRoot}?t=${token}`),
  );
  assert.equal(rootWithQueryToken?.status, 400);
  const branchAssetWithoutToken = await handleLaunchPreviewProxy(
    env,
    new Request(`${controlOrigin}${route("agent-1", "feature", "styles.css")}`),
  );
  assert.equal(branchAssetWithoutToken?.status, 401);

  for (const [url, method] of [
    [`${controlOrigin}/api/auth/me?t=${token}`, "GET"],
    [`${controlOrigin}/src/unrewritten.js?t=${token}`, "GET"],
    [`${controlOrigin}/api/projects/10/runtime/publish?t=${token}`, "POST"],
  ]) {
    const response = await handleLaunchPreviewProxy(env, new Request(url, {
      method,
      headers: { Referer: `${controlOrigin}${branchBRoot}` },
    }));
    assert.equal(response?.status, 400);
  }
  const malformed = await handleLaunchPreviewProxy(
    env,
    new Request(`${controlOrigin}${route("agent-1", "main", "styles.css")}?t=bad%20token`),
  );
  assert.equal(malformed?.status, 400);
  assert.equal(fetches, 0);
});

test("runtime rejects a valid preview token used on another agent or branch path", async () => {
  const calls: Request[] = [];
  const runtime = {
    async fetch(request: Request) {
      calls.push(request);
      const url = new URL(request.url);
      return url.pathname.startsWith("/space/agent-1/preview/main/")
        && url.searchParams.get("t") === token
        ? new Response("ok")
        : new Response("invalid capability", { status: 401 });
    },
  } as unknown as Fetcher;
  const env = launchEnv(runtime);
  for (const path of [
    route("agent-2", "main", "styles.css"),
    route("agent-1", "other", "styles.css"),
  ]) {
    const response = await handleLaunchPreviewProxy(
      env,
      new Request(`${controlOrigin}${path}?t=${token}`),
    );
    assert.equal(response?.status, 401);
  }
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/space/agent-2/preview/main/styles.css",
    "/space/agent-1/preview/other/styles.css",
  ]);
});

test("preview proxy rejects mutation, bad capabilities, and product API referrer requests", async () => {
  let fetches = 0;
  const runtime = { async fetch() { fetches += 1; return new Response("ok"); } } as unknown as Fetcher;
  const path = route("agent-1", "main");
  const env = launchEnv(runtime);
  const deniedMethod = await handleLaunchPreviewProxy(env, new Request(`${controlOrigin}${path}`, { method: "POST" }));
  assert.equal(deniedMethod?.status, 405);
  const deniedPath = await handleLaunchPreviewProxy(env, new Request(`${controlOrigin}/_private_preview/agent-1/%2Fattacker/`));
  assert.equal(deniedPath?.status, 404);
  const malformedCapabilityPath = await handleLaunchPreviewProxy(
    env,
    new Request(`${controlOrigin}/_private_preview/agent-1/%2Fattacker/styles.css?t=${token}`),
  );
  assert.equal(malformedCapabilityPath?.status, 400);
  const rootAssetWithoutPathCookie = await handleLaunchPreviewProxy(env, new Request(`${controlOrigin}/src/unrewritten.js`, {
    headers: { Referer: `${controlOrigin}${path}index.html` },
  }));
  assert.equal(rootAssetWithoutPathCookie?.status, 401);
  const apiRequest = new Request(`${controlOrigin}/api/auth/me`, {
    headers: { Referer: `${controlOrigin}${path}` },
  });
  assert.equal(isPreviewProductApiRequest(apiRequest, controlOrigin), true);
  const blockedApi = await handleLaunchPreviewProxy(env, apiRequest);
  assert.equal(blockedApi?.status, 404);
  assert.equal(fetches, 0);
});