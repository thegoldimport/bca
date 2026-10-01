import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import {
  previewBranchPrefix,
  previewRequestSinkBootstrap,
  rewritePreviewModuleSpecifiers,
} from "../cloudflare/staging/preview-request-sink";

const origin = "https://buildcustom-control-plane-production.thegoldimport.workers.dev";
const token = `${"a".repeat(32)}.${"b".repeat(32)}.${"c".repeat(32)}`;
const prefixPath = "/_private_preview/agent-1/main";
const prefix = `${origin}${prefixPath}`;
const previewUrl = `${prefix}/`;

function createHarness(base = previewUrl) {
  const calls: Array<{ input: unknown; init?: RequestInit }> = [];
  const transport = { send: (_input: unknown, _init?: RequestInit) => Promise.resolve("fetch-result") };
  const window: { fetch: (input: unknown, init?: RequestInit) => Promise<unknown>; XMLHttpRequest?: typeof FakeXHR } = {
    fetch(input, init) {
      calls.push({ input, init });
      return transport.send(input, init);
    },
  };
  class FakeXHR {
    calls: unknown[][] = [];
    open(...args: unknown[]) {
      this.calls.push(args);
      return "xhr-result";
    }
  }
  window.XMLHttpRequest = FakeXHR;
  const context = {
    window,
    document: { baseURI: base },
    URL,
    URLSearchParams,
    Request,
    Promise,
    XMLHttpRequest: FakeXHR,
    fetch: (input: unknown, init?: RequestInit) => window.fetch(input, init),
  };
  runInNewContext(previewRequestSinkBootstrap(
    origin,
    previewBranchPrefix(origin, { agentId: "agent-1", branch: "main" }),
    token,
  ), context);
  return { calls, window, context, FakeXHR, transport };
}

const responseUrl = (harness: ReturnType<typeof createHarness>, input: unknown): string => {
  harness.window.fetch(input);
  const captured = harness.calls.at(-1)!.input;
  return typeof captured === "string" ? captured : (captured as Request).url;
};

test("exact generated Project 8 getApiUrl helper reaches the scoped API through fetch", () => {
  const harness = createHarness();
  const generatedHelper = `
    function getApiUrl(endpoint) {
      const cleanEndpoint = endpoint.startsWith("/") ? endpoint : \`/\${endpoint}\`;
      const base = document.baseURI?.split("?")[0].replace(/\\/$/, "");
      return \`\${base}\${cleanEndpoint}\`;
    }
    fetch(getApiUrl("/api/leads"));
  `;
  runInNewContext(generatedHelper, harness.context);
  const requestUrl = new URL(harness.calls[0].input as string);
  assert.equal(requestUrl.href, `${prefix}/api/leads?t=${token}`);
  assert.doesNotMatch(requestUrl.pathname, /mainhttps:/);
});

test("request sink scopes safe generated paths and leaves other URL classes alone", () => {
  const harness = createHarness();
  const cases: Array<[string, string | null]> = [
    ["/api/leads", `${prefix}/api/leads?t=${token}`],
    ["/api/leads?status=Qualified", `${prefix}/api/leads?status=Qualified&t=${token}`],
    ["/cdn-cgi/rum?ray=telemetry", null],
    ["assets/logo.svg", `${prefix}/assets/logo.svg?t=${token}`],
    [
      `${prefix}/api/leads?status=Qualified&t=old&t=other&status=Won#details`,
      `${prefix}/api/leads?status=Qualified&status=Won&t=${token}#details`,
    ],
    ["https://api.example.test/leads", null],
    ["http://api.example.test/leads", null],
    ["//api.example.test/leads", null],
    ["data:application/json,%7B%7D", null],
    ["blob:https://site.example.test/id", null],
    ["/api/%zz/leads", null],
    ["/assets/http/icon.svg", `${prefix}/assets/http/icon.svg?t=${token}`],
    [`${origin}/unscoped/path`, null],
    [`${origin}/_private_preview/agent-2/main/api/leads`, null],
    [`${origin}/_private_preview/agent-1/other/api/leads`, null],
    ["/_private_preview/agent-2/main/api/leads", null],
    ["/space/agent-1/preview/main/assets/app.js", null],
    ["/assets/%2e%2e/private", null],
    ["/assets/%2fprivate", null],
    ["/assets\\private", null],
  ];

  for (const [raw, expectedScoped] of cases) {
    const result = responseUrl(harness, raw);
    if (expectedScoped) {
      assert.equal(result, expectedScoped, raw);
    } else {
      assert.equal(result, raw, raw);
    }
  }
  assert.equal(
    new URL(responseUrl(harness, "/api/leads?status=Qualified&status=Won#list")).searchParams.getAll("status").join(","),
    "Qualified,Won",
  );
});

test("fetch preserves Request, method, body, init overrides, abort signal, and promise behavior", async () => {
  const harness = createHarness();
  let rejectFetch!: (reason: unknown) => void;
  const expectedPromise = new Promise((_, reject) => { rejectFetch = reject; });
  harness.transport.send = (input) => {
    const signal = (input as Request).signal;
    signal.addEventListener("abort", () => rejectFetch(signal.reason), { once: true });
    return expectedPromise;
  };
  const controller = new AbortController();
  const request = new Request(`${prefix}/api/leads?status=old`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request": "original" },
    body: JSON.stringify({ title: "Lead" }),
  });
  const overrides: RequestInit = {
    method: "PATCH",
    headers: { "X-Request": "override" },
    body: JSON.stringify({ title: "Overridden lead" }),
    signal: controller.signal,
  };
  const promise = harness.window.fetch(request, overrides);
  assert.equal(promise, expectedPromise);
  const forwarded = harness.calls.at(-1)!;
  assert.ok(forwarded.input instanceof Request);
  const rewritten = forwarded.input as Request;
  assert.equal(new URL(rewritten.url).pathname, `${prefixPath}/api/leads`);
  assert.equal(new URL(rewritten.url).searchParams.get("t"), token);
  assert.equal(rewritten.method, "PATCH");
  assert.equal(rewritten.headers.get("Content-Type"), "text/plain;charset=UTF-8");
  assert.equal(rewritten.headers.get("X-Request"), "override");
  assert.equal(await rewritten.text(), JSON.stringify({ title: "Overridden lead" }));
  assert.equal(forwarded.init, undefined, "The input+init combination is applied before replacing the Request URL.");
  assert.equal(rewritten.signal.aborted, false);
  const aborted = new DOMException("aborted", "AbortError");
  controller.abort(aborted);
  assert.equal(rewritten.signal.aborted, true);
  await assert.rejects(promise, (error) => error === aborted);
});

test("Request construction errors reject fetch promises instead of throwing synchronously", async () => {
  const harness = createHarness();
  const request = new Request(`${prefix}/api/leads`, {
    method: "POST",
    body: "payload",
  });
  let result: Promise<unknown> | undefined;
  assert.doesNotThrow(() => {
    result = harness.window.fetch(request, { method: "GET" });
  });
  assert.ok(result instanceof Promise);
  await assert.rejects(result, TypeError);
});

test("XHR open keeps arguments and return value while scoping only its URL", () => {
  const harness = createHarness();
  const xhr = new harness.FakeXHR();
  const args = ["POST", "/api/leads?status=Qualified", false, "user", "password"];
  const result = (xhr as unknown as { open: (...args: unknown[]) => unknown }).open(...args);
  assert.equal(result, "xhr-result");
  const [method, url, async, user, password] = xhr.calls[0];
  assert.equal(method, "POST");
  const rewritten = new URL(url as string);
  assert.equal(rewritten.pathname, `${prefixPath}/api/leads`);
  assert.equal(rewritten.searchParams.get("status"), "Qualified");
  assert.equal(rewritten.searchParams.get("t"), token);
  assert.equal(async, false);
  assert.equal(user, "user");
  assert.equal(password, "password");
});

test("bootstrap keeps capability private to its closure and preserves request sandbox constraints", () => {
  const harness = createHarness();
  assert.equal(Object.prototype.hasOwnProperty.call(harness.window, "previewToken"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(harness.context, "previewToken"), false);
  const installedFetch = harness.window.fetch;
  const differentToken = `${"d".repeat(32)}.${"e".repeat(32)}.${"f".repeat(32)}`;
  runInNewContext(previewRequestSinkBootstrap(
    origin,
    previewBranchPrefix(origin, { agentId: "agent-1", branch: "main" }),
    differentToken,
  ), harness.context);
  assert.equal(harness.window.fetch, installedFetch, "Duplicate bootstraps do not replace the original token-scoped wrapper.");
  const external = responseUrl(harness, "https://api.example.test/leads");
  assert.equal(external, "https://api.example.test/leads");
  assert.equal(responseUrl(harness, "/api/leads"), `${prefix}/api/leads?t=${token}`);
  assert.equal(harness.calls.at(-1)?.init, undefined);
});

test("module URL rewriting is limited to static, re-export, and literal dynamic specifiers", () => {
  const source = [
    'import "./static.js";',
    'export { value } from "./re-export.js";',
    'export { from as renamed } from "./from-alias.js";',
    'const module = import("./dynamic.js");',
    'const json = import("./dynamic-options.js", { with: { type: "json" } });',
    'const text = "./string.js";',
    'const template = `./template.js ${path}`;',
    'const view = <div title="./jsx-attribute.js">import("./jsx-text.js")</div>;',
    'const conditional = ready && <span>import("./jsx-expression-text.js")</span>;',
    'const jsxImport = <div>{import("./jsx-expression.js")}</div>;',
    'const nestedTemplate = `template text ${import("./nested-template.js")}`;',
    'const render = <T,>(value: T) => value; import("./after-generic.js");',
    'if (ready) /import\\("\\.\\/regex\\.js"\\)/.test(source);',
    'const templateText = `import("./template-text.js")`;',
    '// import "./comment.js";',
    '/* import("./block-comment.js"); */',
  ].join("\n");
  const rewritten = rewritePreviewModuleSpecifiers(source, (specifier) => `/scoped/${specifier}`);
  assert.ok(rewritten.includes('import "/scoped/./static.js";'));
  assert.ok(rewritten.includes('from "/scoped/./re-export.js";'));
  assert.ok(rewritten.includes('from "/scoped/./from-alias.js";'));
  assert.ok(rewritten.includes('import("/scoped/./dynamic.js")'));
  assert.ok(rewritten.includes('import("/scoped/./dynamic-options.js", { with: { type: "json" } })'));
  assert.ok(rewritten.includes('const text = "./string.js";'));
  assert.ok(rewritten.includes('const template = `./template.js ${path}`;'));
  assert.ok(rewritten.includes('title="./jsx-attribute.js">import("./jsx-text.js")'));
  assert.ok(rewritten.includes('import("./jsx-expression-text.js")'));
  assert.ok(rewritten.includes('import("/scoped/./jsx-expression.js")'));
  assert.ok(rewritten.includes('import("/scoped/./nested-template.js")'));
  assert.ok(rewritten.includes('import("/scoped/./after-generic.js")'));
  assert.ok(rewritten.includes('if (ready) /import\\("\\.\\/regex\\.js"\\)/.test(source);'));
  assert.ok(rewritten.includes('const templateText = `import("./template-text.js")`;'));
  assert.ok(rewritten.includes('// import "./comment.js";'));
  assert.ok(rewritten.includes('/* import("./block-comment.js"); */'));
});

test("invalid or incomplete JS/TSX remains byte-for-byte unchanged", () => {
  const source = 'const incomplete = ; import("./must-not-partially-rewrite.js");';
  assert.equal(rewritePreviewModuleSpecifiers(source, (specifier) => `/scoped/${specifier}`), source);
});