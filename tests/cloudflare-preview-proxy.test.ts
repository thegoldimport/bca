import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/worker";
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

test("dynamic preview URLs keep filters, repeated names, encoding, and fragments with their capability", () => {
  const previewRoute = route("agent-1", "main");
  const requestUrl = new URL(`${controlOrigin}${previewRoute}app.js?t=${token}`);
  const capability = { agentId: "agent-1", branch: "main", token, path: "app.js" };
  const evaluate = (expression: string, values: Record<string, unknown> = {}) => {
    const rewritten = rewritePreviewJavaScript(expression, requestUrl, controlOrigin, capability);
    return new URL(Function(...Object.keys(values), `return ${rewritten}`)(...Object.values(values)) as string);
  };

  const noQuery = evaluate("`./api/metrics`");
  assert.equal(noQuery.pathname, `${previewRoute}api/metrics`);
  assert.deepEqual([...noQuery.searchParams], [["t", token]]);

  const oneQuery = evaluate("`./api/leads?status=${encodeURIComponent(status)}`", { status: "new lead" });
  assert.equal(oneQuery.searchParams.get("status"), "new lead");
  assert.equal(oneQuery.searchParams.get("t"), token);

  const manyQueries = evaluate(
    "`./api/leads?status=${encodeURIComponent(status)}&status=${encodeURIComponent(other)}&search=${encodeURIComponent(search)}#details`",
    { status: "new", other: "won", search: "roof & tile / + %" },
  );
  assert.equal(manyQueries.pathname, `${previewRoute}api/leads`);
  assert.deepEqual(manyQueries.searchParams.getAll("status"), ["new", "won"]);
  assert.equal(manyQueries.searchParams.get("search"), "roof & tile / + %");
  assert.equal(manyQueries.searchParams.get("t"), token);
  assert.equal(manyQueries.hash, "#details");

  const rootRelative = evaluate("`/assets/${encodeURIComponent(file)}?size=large&size=small`", { file: "roof 1.png" });
  assert.equal(rootRelative.pathname, `${previewRoute}assets/roof%201.png`);
  assert.deepEqual(rootRelative.searchParams.getAll("size"), ["large", "small"]);
  assert.equal(rootRelative.searchParams.get("t"), token);

  const nested = evaluate("`./api/leads/${id}?note=${encodeURIComponent(note)}`", { id: 2, note: "a+b" });
  assert.equal(nested.pathname, `${previewRoute}api/leads/2`);
  assert.equal(nested.searchParams.get("note"), "a+b");
  assert.equal(nested.searchParams.get("t"), token);

  const existingToken = evaluate("`./api/leads?status=new&t=untrusted&status=won`");
  assert.deepEqual(existingToken.searchParams.getAll("status"), ["new", "won"]);
  assert.deepEqual(existingToken.searchParams.getAll("t"), [token]);

  const forbidden = evaluate("`/api/auth/${name}?status=new`", { name: "me" });
  assert.equal(forbidden.pathname, "/api/auth/me");
  assert.equal(forbidden.searchParams.has("t"), false);
  const escaped = evaluate("`../../outside?status=new`");
  assert.equal(escaped.searchParams.has("t"), false);
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

test("opaque sandbox can read token-scoped JavaScript without exposing HTML, CSS, or cookie-only assets", async () => {
  const runtime = {
    async fetch(request: Request) {
      const url = new URL(request.url);
      if (url.searchParams.get("t") !== token) return new Response("invalid capability", { status: 401 });
      const asset = url.pathname.split("/").at(-1);
      if (asset === "app.js") {
        return new Response("document.body.textContent = 'CRM ready';", {
          headers: { "Content-Type": "application/javascript; charset=utf-8", "Access-Control-Allow-Origin": "*" },
        });
      }
      if (asset === "style.css") {
        return new Response("body{background:navy}", { headers: { "Content-Type": "text/css" } });
      }
      if (asset === "leads") {
        return Response.json({ filters: [...url.searchParams.getAll("status")], search: url.searchParams.get("search") }, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }
      return new Response('<html><head><link rel="stylesheet" href="./style.css"></head><body><script type="text/babel" data-type="module" src="./app.js"></script><script type="module" src="./app.js"></script></body></html>', {
        headers: { "Content-Type": "text/html" },
      });
    },
  } as unknown as Fetcher;
  const env = launchEnv(runtime);
  const root = route("agent-1", "main");
  const previewUrl = `${runtimeOrigin}/space/agent-1/preview/main/?t=${token}`;
  const cookie = (await launchPreviewCookie(env, "agent-1", previewUrl))!.split(";")[0];
  const html = await handleLaunchPreviewProxy(env, new Request(`${controlOrigin}${root}`, {
    headers: { Cookie: cookie },
  }));
  assert.ok(html);
  assert.equal(html?.status, 200);
  assert.equal(html.headers.get("Access-Control-Allow-Origin"), null);
  assert.match(await html.text(), /type="text\/babel"[^>]*src="[^"]*app\.js\?t=/);

  const script = `${controlOrigin}${root}app.js?t=${token}`;
  const corsHeaders = { Origin: "null", "Sec-Fetch-Mode": "cors" };
  const js = await handleLaunchPreviewProxy(env, new Request(script, { headers: corsHeaders }));
  assert.ok(js);
  assert.equal(js?.status, 200);
  assert.match(js.headers.get("Content-Type") || "", /application\/javascript/);
  assert.equal(js.headers.get("Access-Control-Allow-Origin"), "null");
  assert.equal(js.headers.get("Access-Control-Allow-Credentials"), null);
  assert.equal(js.headers.get("Vary"), "Origin");
  assert.equal(js.headers.get("Set-Cookie"), null);
  assert.match(await js.text(), /CRM ready/);

  const filteredExpression = rewritePreviewJavaScript(
    "`./api/leads?status=${encodeURIComponent(first)}&status=${encodeURIComponent(second)}&search=${encodeURIComponent(search)}`",
    new URL(`${controlOrigin}${root}app.js?t=${token}`),
    controlOrigin,
    { agentId: "agent-1", branch: "main", token, path: "app.js" },
  );
  const filteredUrl = Function("first", "second", "search", `return ${filteredExpression}`)("new", "won", "roof & tile") as string;
  const json = await handleLaunchPreviewProxy(env, new Request(filteredUrl, {
    headers: corsHeaders,
  }));
  assert.ok(json);
  assert.equal(json.status, 200);
  assert.match(json.headers.get("Content-Type") || "", /application\/json/);
  assert.equal(json.headers.get("Access-Control-Allow-Origin"), "null");
  assert.equal(json.headers.get("Access-Control-Allow-Credentials"), null);
  assert.equal(json.headers.get("Vary"), "Origin");
  assert.deepEqual(await json.json(), { filters: ["new", "won"], search: "roof & tile" });

  const css = await handleLaunchPreviewProxy(env, new Request(`${controlOrigin}${root}style.css?t=${token}`, {
    headers: corsHeaders,
  }));
  assert.ok(css);
  assert.equal(css?.status, 200);
  assert.equal(css.headers.get("Access-Control-Allow-Origin"), null);
  const otherOrigin = await handleLaunchPreviewProxy(env, new Request(script, {
    headers: { Origin: "https://other.example" },
  }));
  assert.ok(otherOrigin);
  assert.equal(otherOrigin?.headers.get("Access-Control-Allow-Origin"), null);
  const cookieOnly = await handleLaunchPreviewProxy(env, new Request(`${controlOrigin}${root}app.js`, {
    headers: { ...corsHeaders, Cookie: cookie },
  }));
  assert.ok(cookieOnly);
  assert.equal(cookieOnly?.status, 200);
  assert.equal(cookieOnly.headers.get("Access-Control-Allow-Origin"), null);
  const cookieOnlyJson = await handleLaunchPreviewProxy(env, new Request(`${controlOrigin}${root}api/leads`, {
    headers: { ...corsHeaders, Cookie: cookie },
  }));
  assert.equal(cookieOnlyJson?.status, 200);
  assert.equal(cookieOnlyJson.headers.get("Access-Control-Allow-Origin"), null);
  const noCapability = await handleLaunchPreviewProxy(env, new Request(`${controlOrigin}${root}app.js`, {
    headers: corsHeaders,
  }));
  assert.ok(noCapability);
  assert.equal(noCapability?.status, 401);
  assert.equal(noCapability.headers.get("Access-Control-Allow-Origin"), null);
  const wrongCapability = await handleLaunchPreviewProxy(env, new Request(`${controlOrigin}${root}app.js?t=wrong`, {
    headers: corsHeaders,
  }));
  assert.ok(wrongCapability);
  assert.equal(wrongCapability?.status, 401);
  assert.equal(wrongCapability.headers.get("Access-Control-Allow-Origin"), null);
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

test("preflight uses internal validation only and rejects unsupported, missing, or foreign capabilities", async () => {
  const forwarded: string[] = [];
  const validations: string[] = [];
  const env = {
    ...launchEnv({ async fetch(request: Request) { forwarded.push(request.method); return Response.json({ unexpected: true }); } } as Fetcher),
    PREVIEW_VALIDATOR: {
      async validatePreviewCapability(input: { agentId: string; branch: string; token: string }) {
        validations.push(`${input.agentId}/${input.branch}`);
        return { valid: input.agentId === "agent-1" && input.branch === "main" && input.token === token };
      },
    },
  };
  const path = `${controlOrigin}${route("agent-1", "main", "api/leads")}?t=${token}`;
  const preflight = (url: string, headers: Record<string, string>) =>
    handleLaunchPreviewProxy(env, new Request(url, {
      method: "OPTIONS",
      headers: { Origin: "null", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type", ...headers },
    }));
  const approved = await preflight(path, {});
  assert.equal(approved?.status, 204);
  assert.equal(approved.headers.get("Access-Control-Allow-Origin"), "null");
  assert.equal(approved.headers.get("Access-Control-Allow-Methods"), "POST");
  assert.equal(approved.headers.get("Access-Control-Allow-Headers"), "content-type");
  assert.equal(approved.headers.get("Access-Control-Allow-Credentials"), null);
  assert.equal(approved.headers.get("Set-Cookie"), null);
  assert.deepEqual(forwarded, []);
  assert.deepEqual(validations, ["agent-1/main"]);

  const denied = [
    [path, { "Access-Control-Request-Headers": "authorization" }, 400],
    [path, { "Access-Control-Request-Method": "PROPFIND" }, 405],
    [path, { Origin: "https://attacker.example" }, 403],
    [`${controlOrigin}${route("agent-1", "main", "api/leads")}`, {}, 401],
    [`${controlOrigin}${route("agent-1", "main", "api/leads")}?t=wrong`, {}, 401],
    [`${controlOrigin}${route("agent-2", "main", "api/leads")}?t=${token}`, {}, 401],
    [`${controlOrigin}${route("agent-1", "other", "api/leads")}?t=${token}`, {}, 401],
    [`${controlOrigin}${route("agent-1", "main", "api/leads")}?t=bad%20token`, {}, 400],
  ] as const;
  for (const [url, headers, status] of denied) {
    const response = await preflight(url, headers);
    assert.equal(response?.status, status);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  }
  assert.deepEqual(forwarded, []);
  assert.deepEqual(validations, ["agent-1/main", "agent-1/main", "agent-2/main", "agent-1/other"]);

  const cookie = (await launchPreviewCookie(env, "agent-1", `${runtimeOrigin}/space/agent-1/preview/main/?t=${token}`))!.split(";")[0];
  const cookieOnlyPost = await handleLaunchPreviewProxy(env, new Request(
    `${controlOrigin}${route("agent-1", "main", "api/leads")}`,
    { method: "POST", headers: { Origin: "null", Cookie: cookie, "Content-Type": "application/json" }, body: "{}" },
  ));
  assert.equal(cookieOnlyPost?.status, 401);
  assert.equal(cookieOnlyPost.headers.get("Access-Control-Allow-Origin"), null);
  assert.deepEqual(forwarded, []);

  const unavailable = await handleLaunchPreviewProxy(
    launchEnv({ async fetch() { throw new Error("must not dispatch"); } } as Fetcher),
    new Request(path, { method: "OPTIONS", headers: { Origin: "null", "Access-Control-Request-Method": "POST" } }),
  );
  assert.equal(unavailable?.status, 503);
  assert.equal(unavailable.headers.get("Access-Control-Allow-Origin"), null);
});

test("authorized application methods forward original body and filters but no product credentials", async () => {
  const forwarded: Array<{ method: string; url: URL; headers: Headers; body: string }> = [];
  let validations = 0;
  const runtime = {
    async fetch(request: Request) {
      const url = new URL(request.url);
      const body = await request.text();
      forwarded.push({ method: request.method, url, headers: request.headers, body });
      if (url.pathname.endsWith("/reject")) return Response.json({ error: "invalid app data" }, { status: 422 });
      if (url.pathname.endsWith("/forbidden")) return Response.json({ error: "app permission denied" }, { status: 403 });
      if (url.pathname.endsWith("/unauthorized")) return Response.json({ error: "app login needed" }, { status: 401 });
      if (url.pathname.endsWith("/limited")) return Response.json({ error: "app rate limit" }, { status: 429 });
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      if (request.method === "HEAD") return new Response(null, { status: 200, headers: { "Content-Type": "application/json" } });
      return Response.json({ method: request.method, body: body ? JSON.parse(body) : null },
        { status: request.method === "POST" ? 201 : 200, headers: { "Set-Cookie": "generated=secret" } });
    },
  } as unknown as Fetcher;
  const env = {
    ...launchEnv(runtime),
    PREVIEW_VALIDATOR: { async validatePreviewCapability() { validations++; return { valid: true }; } },
  };
  const path = `${controlOrigin}${route("agent-1", "main", "api/leads")}?status=new&status=won&search=roof%20%26%20tile&t=${token}`;
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const data = { customer_name: "Disposable test lead", method };
    const response = await handleLaunchPreviewProxy(env, new Request(path, {
      method,
      headers: {
        Origin: "null", "Content-Type": "application/json", Accept: "application/json",
        Cookie: "__Host-bc_session=product-secret", Authorization: "Bearer product-secret",
        "X-CSRF-Token": "product-secret",
      },
      body: JSON.stringify(data),
    }));
    assert.equal(response?.status, method === "POST" ? 201 : method === "DELETE" ? 204 : 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "null");
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
    assert.equal(response.headers.get("Set-Cookie"), null);
    if (method === "DELETE") assert.equal(await response.text(), "");
    else assert.deepEqual(await response.json(), { method, body: data });
    const sent = forwarded.at(-1)!;
    assert.equal(sent.method, method);
    assert.equal(sent.url.pathname, "/space/agent-1/preview/main/api/leads");
    assert.deepEqual(sent.url.searchParams.getAll("status"), ["new", "won"]);
    assert.equal(sent.url.searchParams.get("search"), "roof & tile");
    assert.equal(sent.url.searchParams.get("t"), token);
    assert.deepEqual(JSON.parse(sent.body), data);
    assert.equal(sent.headers.get("Content-Type"), "application/json");
    assert.equal(sent.headers.get("Accept"), "application/json");
    for (const unsafe of ["Cookie", "Authorization", "X-CSRF-Token", "Origin"]) {
      assert.equal(sent.headers.get(unsafe), null);
    }
  }
  const request = (asset: string, method: string) => new Request(
    `${controlOrigin}${route("agent-1", "main", asset)}?t=${token}`,
    { method, headers: { Origin: "null", "Content-Type": "application/json" }, ...(method !== "HEAD" && { body: "{}" }) },
  );
  const invalid = await handleLaunchPreviewProxy(env, request("api/reject", "POST"));
  assert.equal(invalid?.status, 422);
  assert.equal(invalid.headers.get("Access-Control-Allow-Origin"), "null");
  assert.deepEqual(await invalid.json(), { error: "invalid app data" });
  const forbidden = await handleLaunchPreviewProxy(env, request("api/forbidden", "POST"));
  assert.equal(forbidden?.status, 403);
  assert.equal(forbidden.headers.get("Access-Control-Allow-Origin"), "null");
  assert.deepEqual(await forbidden.json(), { error: "app permission denied" });
  for (const [asset, status] of [["api/unauthorized", 401], ["api/limited", 429]] as const) {
    const response = await handleLaunchPreviewProxy(env, request(asset, "POST"));
    assert.equal(response?.status, status);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "null");
    assert.match((await response.json() as { error: string }).error, /^app /);
  }
  const head = await handleLaunchPreviewProxy(env, request("api/leads", "HEAD"));
  assert.equal(head?.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("Access-Control-Allow-Origin"), "null");
  assert.equal(validations, 12);

  let checks = 0;
  const expired = await handleLaunchPreviewProxy({
    ...env,
    PREVIEW_VALIDATOR: {
      async validatePreviewCapability() { checks++; return { valid: checks === 1 }; },
    },
    AUTH_RUNTIME: { async fetch() { return Response.json({ error: "expired runtime capability" }, { status: 401 }); } } as Fetcher,
  }, request("api/leads", "POST"));
  assert.equal(expired?.status, 401);
  assert.equal(expired.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(checks, 2);
});

test("control worker permits only scoped opaque-origin mutations before product Origin enforcement", async () => {
  const methods: string[] = [];
  const appOrigin = "https://app.buildcustom.ai";
  let validatorUnavailable = false;
  const env = {
    ...launchEnv({
      async fetch(request: Request) {
        methods.push(request.method);
        return Response.json({ posted: await request.json() }, { status: 201 });
      },
    } as Fetcher),
    PREVIEW_VALIDATOR: {
      async validatePreviewCapability(input: { agentId: string; branch: string; token: string }) {
        if (validatorUnavailable) throw new Error("internal RPC unavailable");
        return { valid: input.agentId === "agent-1" && input.branch === "main" && input.token === token };
      },
    },
    CONTROL_PLANE_ALLOWED_ORIGIN: appOrigin,
    STAGING_ALLOWED_ORIGIN: appOrigin,
    CONTROL_PLANE_CANARY_ORIGIN: "https://buildcustom-control-plane-launch.thegoldimport.workers.dev",
    STAGING_RUNTIME_URL: runtimeOrigin,
    VIBESDK_RUNTIME_URL: runtimeOrigin,
    VIBESDK_RUNTIME: {},
    STAGING_ROUTE_KV_ID: "248ac5b6821a475794a7fe3d2b0c3718",
    CONTROL_PLANE_ROUTE_KV_ID: "248ac5b6821a475794a7fe3d2b0c3718",
    STAGING_DISPATCH_NAMESPACE: "buildcustom-vibesdk-launch-dispatch",
    CONTROL_PLANE_DISPATCH_NAMESPACE: "buildcustom-vibesdk-launch-dispatch",
    STAGING_MANAGED_GATEWAY_URL: "https://buildcustom-apps-gateway-launch.thegoldimport.workers.dev/p",
    STAGING_GATEWAY: {},
    STAGING_LOGIN_ENABLED: "true",
    STAGING_REGISTRATION_ENABLED: "true",
    PUBLIC_GENERATED_APPS_ENABLED: "true",
    RUNTIME_OPERATIONS_ENABLED: "true",
  };
  const url = `${appOrigin}${route("agent-1", "main", "api/leads")}?t=${token}`;
  const preflight = await worker.fetch(new Request(url, {
    method: "OPTIONS",
    headers: { Origin: "null", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  }), env as never);
  assert.equal(preflight.status, 204, await preflight.text());
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "null");
  assert.deepEqual(methods, []);
  const post = await worker.fetch(new Request(url, {
    method: "POST", headers: { Origin: "null", "Content-Type": "application/json" }, body: '{"customer_name":"Disposable test lead"}',
  }), env as never);
  assert.equal(post.status, 201, await post.text());
  assert.equal(post.headers.get("Access-Control-Allow-Origin"), "null");
  assert.deepEqual(methods, ["POST"]);
  for (const method of ["OPTIONS", "POST"]) {
    const denied = await worker.fetch(new Request(`${appOrigin}${route("agent-1", "main", "api/leads")}?t=wrong`, {
      method,
      headers: method === "OPTIONS"
        ? { Origin: "null", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" }
        : { Origin: "null", "Content-Type": "application/json" },
      ...(method === "POST" && { body: "{}" }),
    }), env as never);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
  }
  validatorUnavailable = true;
  const unavailable = await worker.fetch(new Request(url, {
    method: "OPTIONS", headers: { Origin: "null", "Access-Control-Request-Method": "POST" },
  }), env as never);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("Access-Control-Allow-Origin"), null);
  validatorUnavailable = false;
  assert.deepEqual(methods, ["POST"]);
  const product = await worker.fetch(new Request(`${appOrigin}/api/auth/register`, {
    method: "POST", headers: { Origin: "null", "Content-Type": "application/json" }, body: "{}",
  }), env as never);
  assert.equal(product.status, 400);
  assert.deepEqual(await product.json(), { message: "ORIGIN_REJECTED" });
  assert.deepEqual(methods, ["POST"]);
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
      new Request(`${controlOrigin}${path}?t=${token}`, { headers: { Origin: "null" } }),
    );
    assert.equal(response?.status, 401);
    assert.equal(response?.headers.get("Access-Control-Allow-Origin"), null);
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