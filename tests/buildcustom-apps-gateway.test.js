import assert from "node:assert/strict";
import test from "node:test";
import gateway, { hostnameRoute, metadataTags, routeConfig } from "../infrastructure/buildcustom-apps-gateway.js";

async function withHtmlRewriterStub(run) {
  const original = globalThis.HTMLRewriter;
  globalThis.HTMLRewriter = class {
    constructor() {
      this.handlers = [];
    }

    on(selector, handler) {
      this.handlers.push({ selector, handler });
      return this;
    }

    async transform(response) {
      let body = await response.text();
      body = body.replace(/<\/?([a-z][a-z0-9-]*)(?:\s[^<>]*)?>/gi, (tag, tagName) => {
        const opening = !tag.startsWith("</");
        const attributes = new Set();
        for (const [, name] of tag.matchAll(/\s([a-z][a-z0-9-]*)\s*=/gi)) attributes.add(name.toLowerCase());
        let rewritten = tag;
        let append = "";
        let removed = false;
        const element = {
          getAttribute(name) {
            const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const match = rewritten.match(new RegExp(`\\s${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i"));
            return match ? match[2] : null;
          },
          setAttribute(name, value) {
            const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = new RegExp(`(\\s${escapedName}\\s*=\\s*)(["'])(.*?)\\2`, "i");
            rewritten = rewritten.replace(pattern, (_match, before, quote) => `${before}${quote}${value}${quote}`);
          },
          append(value) { append += value; },
          remove() { removed = true; },
        };
        if (!opening) return tag;
        for (const { selector, handler } of this.handlers) {
          const matches = selector === "head"
            ? tagName.toLowerCase() === "head"
            : selector === "[href], [src]"
              ? attributes.has("href") || attributes.has("src")
              : selector === "[srcset]"
                ? attributes.has("srcset")
                : selector === 'link[rel~="icon"]'
                  ? tagName.toLowerCase() === "link" && (element.getAttribute("rel") || "").split(/\s+/).includes("icon")
                  : false;
          if (matches) handler.element(element);
        }
        return removed ? "" : `${rewritten}${append}`;
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
  };
  try {
    return await run();
  } finally {
    if (original === undefined) delete globalThis.HTMLRewriter;
    else globalThis.HTMLRewriter = original;
  }
}

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

test("private canary resolves /p/<slug> and strips the prefix before dispatch", async () => {
  let dispatchedScript;
  let dispatchedUrl;
  const response = await gateway.fetch(new Request(
    "https://gateway.private.workers.dev/p/private-project/assets/app.js?theme=dark",
    { headers: { "X-BuildCustom-Hostname": "spoofed.example" } },
  ), {
    PRIVATE_CANARY_HOST: "gateway.private.workers.dev",
    ROUTES: {
      get: async (key) => key === "private-project"
        ? JSON.stringify({ scriptName: "private-project-release", metadata: {} })
        : null,
    },
    DISPATCHER: {
      get(scriptName) {
        dispatchedScript = scriptName;
        return { fetch: async (request) => {
          dispatchedUrl = new URL(request.url);
          return new Response("private asset", { headers: { "content-type": "text/javascript" } });
        } };
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "private asset");
  assert.equal(dispatchedScript, "private-project-release");
  assert.equal(dispatchedUrl.pathname, "/assets/app.js");
  assert.equal(dispatchedUrl.search, "?theme=dark");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
});

test("private canary route-check uses the path slug without dispatching", async () => {
  let dispatched = false;
  const response = await gateway.fetch(new Request(
    "https://gateway.private.workers.dev/p/private-project/_buildcustom/route-check",
  ), {
    PRIVATE_CANARY_HOST: "gateway.private.workers.dev",
    ROUTES: {
      get: async (key) => key === "private-project"
        ? JSON.stringify({ scriptName: "private-project-release", metadata: {} })
        : null,
    },
    DISPATCHER: { get: () => { dispatched = true; } },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    project: "private-project",
    scriptName: "private-project-release",
    redirectTo: null,
    purpose: null,
    role: null,
    primaryHostname: null,
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(dispatched, false);
});

test("private route-check returns 404 when the expected project or script identity differs", async () => {
  const env = {
    PRIVATE_CANARY_HOST: "gateway.private.workers.dev",
    ROUTES: {
      get: async (key) => key === "private-project"
        ? JSON.stringify({ scriptName: "private-project-release", metadata: {} })
        : null,
    },
    DISPATCHER: { get: () => { throw new Error("route-check must not dispatch"); } },
  };

  for (const query of ["project=other-project", "scriptName=unexpected-release"]) {
    const response = await gateway.fetch(new Request(
      `https://gateway.private.workers.dev/p/private-project/_buildcustom/route-check?${query}`,
    ), env);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  }
});

test("private candidate route dispatches the validated release directly without a slug KV read", async () => {
  const candidate = `bc-r-${"a".repeat(56)}`;
  const routeReads = [];
  let dispatchedScript;
  let dispatchedPath;
  const response = await gateway.fetch(new Request(
    `https://gateway.private.workers.dev/c/${candidate}/_buildcustom/route-check?project=private-project&scriptName=${candidate}`,
  ), {
    PRIVATE_CANARY_HOST: "gateway.private.workers.dev",
    ROUTES: { get: async (key) => { routeReads.push(key); return null; } },
    DISPATCHER: {
      get(scriptName) {
        dispatchedScript = scriptName;
        return { fetch: async (request) => {
          dispatchedPath = new URL(request.url).pathname;
          throw new Error("route-check should return before dispatch");
        } };
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    project: "private-project",
    scriptName: candidate,
    redirectTo: null,
    purpose: null,
    role: null,
    primaryHostname: null,
  });
  assert.deepEqual(routeReads, []);
  assert.equal(dispatchedScript, undefined);
  assert.equal(dispatchedPath, undefined);

  const invalid = await gateway.fetch(new Request(
    "https://gateway.private.workers.dev/c/not-a-release-script/",
  ), {
    PRIVATE_CANARY_HOST: "gateway.private.workers.dev",
    ROUTES: { get: async () => { throw new Error("invalid candidates must not read KV"); } },
    DISPATCHER: { get: () => { throw new Error("invalid candidates must not dispatch"); } },
  });
  assert.equal(invalid.status, 404);
});

test("private project and candidate HTML/CSS assets and root-relative redirects stay scoped", async () => {
  await withHtmlRewriterStub(async () => {
    const candidate = `bc-r-${"b".repeat(56)}`;
    for (const [prefix, url, routeValue] of [
      ["/p/private-project", "https://gateway.private.workers.dev/p/private-project/", JSON.stringify({ scriptName: "private-project-release", metadata: {} })],
      [`/c/${candidate}`, `https://gateway.private.workers.dev/c/${candidate}/`, null],
    ]) {
      const routeReads = [];
      const env = {
        PRIVATE_CANARY_HOST: "gateway.private.workers.dev",
        ROUTES: { get: async (key) => {
          routeReads.push(key);
          return key === "private-project" ? routeValue : null;
        } },
        DISPATCHER: {
          get(scriptName) {
            assert.equal(scriptName, routeValue ? "private-project-release" : candidate);
            return { fetch: async (request) => {
              assert.equal(new URL(request.url).pathname, "/");
              return new Response(
                '<!doctype html><html><head></head><body><link rel="stylesheet" href="/styles.css"><img src="/logo.png" srcset="/small.png 1x, /large.png 2x"></body></html>',
                { headers: { "content-type": "text/html; charset=utf-8" } },
              );
            } };
          },
        },
      };
      const response = await gateway.fetch(new Request(url), env);
      const html = await response.text();
      assert.match(html, new RegExp(`href="${prefix}/styles\\.css"`));
      assert.match(html, new RegExp(`src="${prefix}/logo\\.png"`));
      assert.match(html, new RegExp(`srcset="${prefix}/small\\.png 1x, ${prefix}/large\\.png 2x"`));
      assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
      assert.deepEqual(routeReads, routeValue ? ["private-project"] : []);
    }
  });

  const cssResponse = await gateway.fetch(new Request(
    "https://gateway.private.workers.dev/p/private-project/styles.css",
  ), {
    PRIVATE_CANARY_HOST: "gateway.private.workers.dev",
    ROUTES: { get: async () => JSON.stringify({ scriptName: "private-project-release", metadata: {} }) },
    DISPATCHER: {
      get: () => ({ fetch: async () => new Response(
        '.hero { background-image: url("/images/hero.svg") } @import "/theme/base.css";',
        { headers: { "content-type": "text/css; charset=utf-8" } },
      ) }),
    },
  });
  const css = await cssResponse.text();
  assert.match(css, /url\("\/p\/private-project\/images\/hero\.svg"\)/);
  assert.match(css, /@import "\/p\/private-project\/theme\/base\.css"/);

  const redirect = await gateway.fetch(new Request(
    "https://gateway.private.workers.dev/c/bc-r-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/styles",
  ), {
    PRIVATE_CANARY_HOST: "gateway.private.workers.dev",
    ROUTES: { get: async () => null },
    DISPATCHER: { get: () => ({ fetch: async () => new Response(null, {
      status: 302,
      headers: { Location: "/login?next=%2Fstyles" },
    }) }) },
  });
  assert.equal(redirect.headers.get("location"), "/c/bc-r-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/login?next=%2Fstyles");
});

test("public HTML and CSS retain root-relative asset URLs", async () => {
  await withHtmlRewriterStub(async () => {
    const htmlResponse = await gateway.fetch(new Request("https://public-project.apps.buildcustom.ai/"), {
      ROUTES: { get: async () => JSON.stringify({ scriptName: "public-project-release", metadata: {} }) },
      DISPATCHER: {
        get: () => ({ fetch: async () => new Response(
          '<html><head></head><body><link rel="stylesheet" href="/styles.css"><img src="/logo.png"></body></html>',
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ) }),
      },
    });
    const html = await htmlResponse.text();
    assert.match(html, /href="\/styles\.css"/);
    assert.match(html, /src="\/logo\.png"/);
    assert.equal(htmlResponse.headers.get("x-robots-tag"), null);
  });

  const cssResponse = await gateway.fetch(new Request("https://public-project.apps.buildcustom.ai/styles.css"), {
    ROUTES: { get: async () => JSON.stringify({ scriptName: "public-project-release", metadata: {} }) },
    DISPATCHER: {
      get: () => ({ fetch: async () => new Response(
        ".hero { background: url(/images/hero.png); } @import '/theme.css';",
        { headers: { "content-type": "text/css" } },
      ) }),
    },
  });
  assert.equal(await cssResponse.text(), ".hero { background: url(/images/hero.png); } @import '/theme.css';");
});

test("private source-verification header reaches the candidate and preserves response bytes", async () => {
  const sources = [
    ["/", '<html>\n<head></head><body><link href="/styles.css"></body>\n</html>', "text/html; charset=utf-8"],
    ["/styles.css", '.hero { background: url("/images/hero.png"); }', "text/css; charset=utf-8"],
  ];
  for (const [path, source, contentType] of sources) {
    let forwardedHeaders;
    const response = await gateway.fetch(new Request(
      `https://gateway.private.workers.dev/c/bc-r-cccccccccccccccccccccccccccccccccccccccccccccccccccccccc${path}`,
      { headers: { "X-BuildCustom-Verify-Source": "1" } },
    ), {
      PRIVATE_CANARY_HOST: "gateway.private.workers.dev",
      ROUTES: { get: async () => { throw new Error("candidate verification must not read slug KV"); } },
      DISPATCHER: {
        get: () => ({ fetch: async (request) => {
          forwardedHeaders = request.headers;
          return new Response(source, { headers: { "content-type": contentType } });
        } }),
      },
    });

    assert.equal(await response.text(), source);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(forwardedHeaders.get("X-BuildCustom-Verify-Source"), "1");
  }
});

test("private canary refuses unscoped paths and does not enable its prefix on other hosts", async () => {
  let dispatched = false;
  const env = {
    PRIVATE_CANARY_HOST: "gateway.private.workers.dev",
    ROUTES: { get: async () => JSON.stringify({ scriptName: "private-project-release", metadata: {} }) },
    DISPATCHER: { get: () => { dispatched = true; } },
  };

  const unscoped = await gateway.fetch(new Request("https://gateway.private.workers.dev/"), env);
  assert.equal(unscoped.status, 404);
  assert.equal(unscoped.headers.get("x-robots-tag"), "noindex, nofollow");

  const wrongHost = await gateway.fetch(new Request(
    "https://other.private.workers.dev/p/private-project/",
  ), env);
  assert.equal(wrongHost.status, 404);
  assert.equal(dispatched, false);
});

test("public managed routes retain their original path even when the canary is configured", async () => {
  let dispatchedUrl;
  const response = await gateway.fetch(new Request(
    "https://public-project.apps.buildcustom.ai/p/private-project/assets/app.js?x=1",
  ), {
    PRIVATE_CANARY_HOST: "gateway.private.workers.dev",
    ROUTES: {
      get: async (key) => key === "public-project"
        ? JSON.stringify({ scriptName: "public-project-release", metadata: {} })
        : null,
    },
    DISPATCHER: {
      get: () => ({ fetch: async (request) => {
        dispatchedUrl = new URL(request.url);
        return new Response("public asset", { headers: { "content-type": "text/javascript" } });
      } }),
    },
  });

  assert.equal(await response.text(), "public asset");
  assert.equal(dispatchedUrl.pathname, "/p/private-project/assets/app.js");
  assert.equal(dispatchedUrl.search, "?x=1");
  assert.equal(response.headers.get("x-robots-tag"), null);
});

test("a verified custom hostname aliases the managed slug without changing managed routing", async () => {
  const reads = [];
  const routes = {
    "hostname:www.customer-example.com": JSON.stringify({
      slug: "project",
      purpose: "application",
      role: "direct",
      primaryHostname: "customer-example.com",
    }),
    project: JSON.stringify({ scriptName: "project-script", metadata: {} }),
  };
  let dispatchedScript;
  let dispatchedHeaders;
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
        return { fetch: async (request) => {
          dispatchedHeaders = request.headers;
          return new Response("same project", { headers: { "content-type": "text/plain" } });
        } };
      },
    },
  };

  const customResponse = await gateway.fetch(new Request("https://www.customer-example.com/", {
    headers: { "X-BuildCustom-Domain-Purpose": "spoofed" },
  }), env);
  assert.equal(await customResponse.text(), "same project");
  assert.equal(dispatchedScript, "project-script");
  assert.deepEqual(reads, ["hostname:www.customer-example.com", "project"]);
  assert.equal(dispatchedHeaders.get("X-BuildCustom-Hostname"), "www.customer-example.com");
  assert.equal(dispatchedHeaders.get("X-BuildCustom-Domain-Purpose"), "application");
  assert.equal(dispatchedHeaders.get("X-BuildCustom-Domain-Role"), "direct");
  assert.equal(dispatchedHeaders.get("X-BuildCustom-Primary-Hostname"), "customer-example.com");

  reads.length = 0;
  const managedResponse = await gateway.fetch(new Request("https://project.apps.buildcustom.ai/"), env);
  assert.equal(await managedResponse.text(), "same project");
  assert.deepEqual(reads, ["project"]);
  assert.equal(dispatchedHeaders.get("X-BuildCustom-Domain-Purpose"), null);
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

test("route check identifies the expected project without dispatching user code", async () => {
  let dispatched = false;
  const response = await gateway.fetch(new Request("https://customer.example.com/_buildcustom/route-check"), {
    ROUTES: {
      async get(key) {
        return key === "hostname:customer.example.com"
          ? "project"
          : key === "project"
            ? JSON.stringify({ scriptName: "project-script", metadata: {} })
            : null;
      },
    },
    DISPATCHER: { get: () => { dispatched = true; } },
  });
  assert.deepEqual(await response.json(), {
    ok: true,
    project: "project",
    redirectTo: null,
    purpose: null,
    role: null,
    primaryHostname: null,
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(dispatched, false);
});

test("trusted managed route check verifies the custom-hostname alias", async () => {
  const routes = {
    project: JSON.stringify({ scriptName: "project-script", metadata: {} }),
    "hostname:customer.example.com": "project",
  };
  const response = await gateway.fetch(new Request("https://project.apps.buildcustom.ai/_buildcustom/custom-host-route-check?hostname=customer.example.com"), {
    ROUTES: { get: async (key) => routes[key] || null },
    DISPATCHER: { get: () => { throw new Error("must not dispatch"); } },
  });
  assert.deepEqual(await response.json(), {
    ok: true,
    project: "project",
    redirectTo: null,
    purpose: null,
    role: null,
    primaryHostname: null,
  });
  assert.equal(response.status, 200);
});

test("secondary hostname redirects permanently to primary while preserving path and query", async () => {
  const routes = {
    "hostname:www.customer.example": JSON.stringify({ slug: "project", redirectTo: "customer.example" }),
    project: JSON.stringify({ scriptName: "project-script", metadata: {} }),
  };
  const response = await gateway.fetch(new Request("https://www.customer.example/path/to/page?offer=1"), {
    ROUTES: { get: async (key) => routes[key] || null },
    DISPATCHER: { get: () => { throw new Error("redirect must not dispatch"); } },
  });
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://customer.example/path/to/page?offer=1");
  assert.deepEqual(hostnameRoute(routes["hostname:www.customer.example"]), {
    slug: "project",
    redirectTo: "customer.example",
    purpose: null,
    role: null,
    primaryHostname: null,
  });
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