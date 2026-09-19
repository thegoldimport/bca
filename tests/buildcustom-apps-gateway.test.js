import assert from "node:assert/strict";
import test from "node:test";
import gateway, { metadataTags, routeConfig } from "../infrastructure/buildcustom-apps-gateway.js";

test("empty SEO preserves generated metadata and adds the BuildCustom favicon", () => {
  const tags = metadataTags({});
  assert.equal(tags, '<link rel="icon" href="https://buildcustom.ai/favicon.png"><meta property="og:image" content="https://buildcustom.ai/opengraph.jpg">');
  assert.doesNotMatch(tags, /<title>|name="description"/);
});

test("custom metadata emits escaped SEO, social, robots, favicon, and structured-data tags", () => {
  const favicon = "data:image/png;base64,abc123";
  const tags = metadataTags({
    title: 'Tea & "Cake"',
    description: "Fresh <daily>",
    canonicalUrl: "https://example.com/products?kind=tea&sort=new",
    ogTitle: "Tea social",
    ogDescription: "Fresh social",
    ogImageUrl: "https://example.com/social.png",
    faviconData: favicon,
    allowIndexing: false,
    schemaJson: '{"name":"Tea","html":"</script><p>safe</p>"}',
  });

  assert.match(tags, /<title>Tea &amp; &quot;Cake&quot;<\/title>/);
  assert.match(tags, /name="description" content="Fresh &lt;daily&gt;"/);
  assert.match(tags, /name="robots" content="noindex, nofollow"/);
  assert.match(tags, /rel="canonical" href="https:\/\/example\.com\/products\?kind=tea&amp;sort=new"/);
  assert.match(tags, /property="og:title" content="Tea social"/);
  assert.match(tags, /property="og:description" content="Fresh social"/);
  assert.match(tags, /property="og:image" content="https:\/\/example\.com\/social\.png"/);
  assert.match(tags, new RegExp(`rel="icon" href="${favicon}"`));
  assert.match(tags, /application\/ld\+json.*<\\\/script><p>safe<\/p>/);
  assert.doesNotMatch(tags, /https:\/\/buildcustom\.ai\/favicon\.png/);
});

test("legacy plain and JSON route values both dispatch to their scripts", async () => {
  for (const [raw, expectedScript] of [
    ["legacy-script", "legacy-script"],
    [JSON.stringify({ scriptName: "metadata-script", metadata: { title: "Saved title" } }), "metadata-script"],
  ]) {
    let dispatchedScript;
    const response = await gateway.fetch(new Request("https://project.apps.buildcustom.ai/asset.js"), {
      ROUTES: { get: async () => raw },
      DISPATCHER: {
        get(scriptName) {
          dispatchedScript = scriptName;
          return { fetch: async () => new Response("asset", { headers: { "content-type": "text/javascript" } }) };
        },
      },
    });
    assert.equal(dispatchedScript, expectedScript);
    assert.equal(await response.text(), "asset");
  }

  assert.deepEqual(routeConfig("legacy-script"), { scriptName: "legacy-script", metadata: {} });
});

test("a verified custom hostname aliases the managed slug without changing managed routing", async () => {
  const reads = [];
  const routes = {
    "hostname:www.customer-example.com": "project",
    project: JSON.stringify({ scriptName: "project-script", metadata: {} }),
  };
  let dispatchedScript;
  const env = {
    ROUTES: {
      async get(key) {
        reads.push(key);
        return routes[key] || null;
      },
    },
    DISPATCHER: {
      get(scriptName) {
        dispatchedScript = scriptName;
        return { fetch: async () => new Response("same project", { headers: { "content-type": "text/plain" } }) };
      },
    },
  };

  const customResponse = await gateway.fetch(new Request("https://www.customer-example.com/"), env);
  assert.equal(await customResponse.text(), "same project");
  assert.equal(dispatchedScript, "project-script");
  assert.deepEqual(reads, ["hostname:www.customer-example.com", "project"]);

  reads.length = 0;
  const managedResponse = await gateway.fetch(new Request("https://project.apps.buildcustom.ai/"), env);
  assert.equal(await managedResponse.text(), "same project");
  assert.deepEqual(reads, ["project"]);
});

test("an unmapped custom hostname cannot reach a user Worker", async () => {
  let dispatched = false;
  const response = await gateway.fetch(new Request("https://unverified.example.com/"), {
    ROUTES: { get: async () => null },
    DISPATCHER: { get: () => { dispatched = true; } },
  });
  assert.equal(response.status, 404);
  assert.equal(dispatched, false);
});

test("a zone-wide SaaS route passes existing BuildCustom hosts through to their origin", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => new Response(`origin:${new URL(request.url).hostname}`);
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await gateway.fetch(new Request("https://buildcustom.ai/pricing"), {
    ROUTES: { get: async () => { throw new Error("must not read tenant routes"); } },
    DISPATCHER: { get: () => { throw new Error("must not dispatch"); } },
  });
  assert.equal(await response.text(), "origin:buildcustom.ai");
});