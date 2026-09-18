import assert from "node:assert/strict";
import test from "node:test";
import gateway, { metadataTags, routeConfig } from "../infrastructure/buildcustom-apps-gateway.js";

test("empty SEO preserves generated metadata and adds the BuildCustom favicon", () => {
  const tags = metadataTags({});
  assert.equal(tags, '<link rel="icon" href="https://buildcustom.ai/favicon.png">');
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