import assert from "node:assert/strict";
import test from "node:test";
import gateway from "../lab/bc-vibesdk-lab-20260925/app-gateway/worker.mjs";

function makeEnv({ mapping = null, onDispatch = () => {}, onRouteRead = () => {} } = {}) {
  return {
    ROUTES: {
      async get(key) {
        onRouteRead(key);
        return mapping;
      },
    },
    DISPATCHER: {
      get(scriptName) {
        onDispatch(scriptName);
        return {
          fetch: async (request) => new Response(
            `${scriptName}:${new URL(request.url).pathname}${new URL(request.url).search}`,
            { headers: { "content-type": "text/plain" } },
          ),
        };
      },
    },
  };
}

test("slug mapping dispatches to the mapped stock script", async () => {
  const reads = [];
  const dispatches = [];
  const env = makeEnv({
    mapping: JSON.stringify({ scriptName: "stock_worker-42", metadata: {} }),
    onRouteRead: (key) => reads.push(key),
    onDispatch: (name) => dispatches.push(name),
  });

  const response = await gateway.fetch(
    new Request("https://northstar-coffee.lab-apps.buildcustom.ai/"),
    env,
  );

  assert.equal(await response.text(), "stock_worker-42:/");
  assert.deepEqual(reads, ["northstar-coffee"]);
  assert.deepEqual(dispatches, ["stock_worker-42"]);
});

test("unmapped valid slug retains direct script-host dispatch fallback", async () => {
  const dispatches = [];
  const response = await gateway.fetch(
    new Request("https://minimal-test-site.lab-apps.buildcustom.ai/"),
    makeEnv({ onDispatch: (name) => dispatches.push(name) }),
  );

  assert.equal(await response.text(), "minimal-test-site:/");
  assert.deepEqual(dispatches, ["minimal-test-site"]);
});

test("malformed or unsafe mapping values fail closed", async (t) => {
  const malformedMappings = [
    "{not-json",
    JSON.stringify("stock-script"),
    JSON.stringify({ metadata: {} }),
    JSON.stringify({ scriptName: "stock-script" }),
    JSON.stringify({ scriptName: "stock-script", metadata: [] }),
    JSON.stringify({ scriptName: "other.example", metadata: {} }),
    JSON.stringify({ scriptName: "../stock-script", metadata: {} }),
  ];

  for (const mapping of malformedMappings) {
    await t.test(mapping, async () => {
      let dispatched = false;
      const response = await gateway.fetch(
        new Request("https://northstar-coffee.lab-apps.buildcustom.ai/"),
        makeEnv({ mapping, onDispatch: () => { dispatched = true; } }),
      );
      assert.equal(response.status, 404);
      assert.equal(dispatched, false);
    });
  }
});

test("forwards app paths, query strings, method, and headers unchanged", async () => {
  let receivedName;
  let receivedRequest;
  const env = {
    ROUTES: { get: async (key) => key === "northstar-coffee"
      ? JSON.stringify({ scriptName: "stock-worker", metadata: {} })
      : null },
    DISPATCHER: {
      get(name) {
        receivedName = name;
        return { fetch: async (request) => {
          receivedRequest = request;
          return new Response("asset", { headers: { "content-type": "text/javascript" } });
        } };
      },
    },
  };
  const request = new Request("https://northstar-coffee.lab-apps.buildcustom.ai/assets/app.js?v=1", {
    method: "POST",
    headers: { "x-app-test": "preserved" },
    body: "payload",
  });
  const response = await gateway.fetch(request, env);

  assert.equal(receivedName, "stock-worker");
  assert.equal(new URL(receivedRequest.url).pathname + new URL(receivedRequest.url).search, "/assets/app.js?v=1");
  assert.equal(receivedRequest.method, "POST");
  assert.equal(receivedRequest.headers.get("x-app-test"), "preserved");
  assert.equal(await receivedRequest.text(), "payload");
  assert.equal(await response.text(), "asset");
});

test("reserved and malformed hostnames are rejected before KV or script dispatch", async () => {
  const reads = [];
  let dispatched = false;
  const env = makeEnv({
    onRouteRead: (key) => reads.push(key),
    onDispatch: () => { dispatched = true; },
  });

  for (const hostname of [
    "editor.lab-apps.buildcustom.ai",
    "api.lab-apps.buildcustom.ai",
    "-bad.lab-apps.buildcustom.ai",
    "two.labels.lab-apps.buildcustom.ai",
    "northstar-coffee.lab-apps.buildcustom.ai.attacker.example",
    "buildcustom.ai",
  ]) {
    const response = await gateway.fetch(new Request(`https://${hostname}/`), env);
    assert.equal(response.status, 404, hostname);
  }
  assert.deepEqual(reads, []);
  assert.equal(dispatched, false);
});

test("editor host is not routed to the lab VibeSDK editor", async () => {
  let dispatched = false;
  const response = await gateway.fetch(
    new Request("https://editor.lab-apps.buildcustom.ai/"),
    makeEnv({
      mapping: JSON.stringify({ scriptName: "lab-editor", metadata: {} }),
      onDispatch: () => { dispatched = true; },
    }),
  );

  assert.equal(response.status, 404);
  assert.equal(dispatched, false);
});

test("mapped style fallback preserves an existing /style.css response without retrying", async () => {
  const dispatchedPaths = [];
  const env = {
    ROUTES: {
      get: async () => JSON.stringify({
        scriptName: "stock-worker",
        metadata: { styleCssFallback: true },
      }),
    },
    DISPATCHER: {
      get: () => ({
        fetch: async (request) => {
          dispatchedPaths.push(new URL(request.url).pathname + new URL(request.url).search);
          return new Response("legitimate style.css", {
            status: 200,
            headers: { "content-type": "text/css" },
          });
        },
      }),
    },
  };

  const response = await gateway.fetch(
    new Request("https://northstar-coffee.lab-apps.buildcustom.ai/style.css?v=1"),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/css");
  assert.equal(await response.text(), "legitimate style.css");
  assert.deepEqual(dispatchedPaths, ["/style.css?v=1"]);
});

test("mapped style fallback retries /styles.css only after /style.css returns 404", async () => {
  const dispatchedUrls = [];
  const env = {
    ROUTES: {
      get: async () => JSON.stringify({
        scriptName: "stock-worker",
        metadata: { styleCssFallback: true },
      }),
    },
    DISPATCHER: {
      get: () => ({
        fetch: async (request) => {
          dispatchedUrls.push(request.url);
          if (new URL(request.url).pathname === "/style.css") {
            return new Response("missing", { status: 404 });
          }
          return new Response("/* generated stylesheet */", {
            status: 200,
            headers: { "content-type": "text/css" },
          });
        },
      }),
    },
  };

  const response = await gateway.fetch(
    new Request("https://northstar-coffee.lab-apps.buildcustom.ai/style.css?theme=dark"),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/css");
  assert.equal(await response.text(), "/* generated stylesheet */");
  assert.deepEqual(dispatchedUrls, [
    "https://northstar-coffee.lab-apps.buildcustom.ai/style.css?theme=dark",
    "https://northstar-coffee.lab-apps.buildcustom.ai/styles.css?theme=dark",
  ]);
});

test("unmapped direct-script requests never use the style fallback", async () => {
  const dispatchedPaths = [];
  const env = {
    ROUTES: { get: async () => null },
    DISPATCHER: {
      get: () => ({
        fetch: async (request) => {
          dispatchedPaths.push(new URL(request.url).pathname);
          return new Response("missing", { status: 404 });
        },
      }),
    },
  };

  const response = await gateway.fetch(
    new Request("https://northstar-coffee.lab-apps.buildcustom.ai/style.css"),
    env,
  );

  assert.equal(response.status, 404);
  assert.deepEqual(dispatchedPaths, ["/style.css"]);
});

test("mapped requests to paths other than exactly /style.css are not rewritten", async () => {
  const dispatchedPaths = [];
  const env = {
    ROUTES: {
      get: async () => JSON.stringify({
        scriptName: "stock-worker",
        metadata: { styleCssFallback: true },
      }),
    },
    DISPATCHER: {
      get: () => ({
        fetch: async (request) => {
          dispatchedPaths.push(new URL(request.url).pathname);
          return new Response("missing", { status: 404 });
        },
      }),
    },
  };

  const response = await gateway.fetch(
    new Request("https://northstar-coffee.lab-apps.buildcustom.ai/assets/style.css"),
    env,
  );

  assert.equal(response.status, 404);
  assert.deepEqual(dispatchedPaths, ["/assets/style.css"]);
});