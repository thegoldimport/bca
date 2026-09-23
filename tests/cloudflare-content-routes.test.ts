import test from "node:test";
import assert from "node:assert/strict";
import { handleContentRoute } from "../cloudflare/content-routes";

type Row = Record<string, any>;
function dbMock(responses: Row[] = []): D1Database {
  let index = 0;
  const db: any = {
    prepare() {
      const response = responses[index++] ?? {};
      const statement: any = {
        bind(..._args: unknown[]) { return statement; },
        first: async () => response.first ?? null,
        all: async () => ({ results: response.results ?? [] }),
        run: async () => ({ success: true, meta: { changes: 1 } }),
      };
      return statement;
    },
  };
  return db;
}
const env = (responses: Row[]) => ({ DB: dbMock(responses) }) as any;
const request = (url: string, method = "GET", body?: unknown, cookie?: string) =>
  new Request(url, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });

test("content routes return public images only for valid bounded data URIs", async () => {
  const data = `data:image/png;base64,${btoa("png-bytes")}`;
  const response = await handleContentRoute({
    request: request("https://staging.example/api/public/projects/2/social-image"),
    env: env([{ first: { social_image_data: data } }]),
    url: new URL("https://staging.example/api/public/projects/2/social-image"),
    input: {},
  });
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get("Content-Type"), "image/png");
  assert.equal(await response?.text(), "png-bytes");
});

test("template routes preserve camelCase and return 404 for missing slugs", async () => {
  const response = await handleContentRoute({
    request: request("https://staging.example/api/templates/landing"),
    env: env([{ first: { id: 4, name: "Landing", slug: "landing", project_type: "website", tags: "[\"marketing\"]", featured: 1 } }]),
    url: new URL("https://staging.example/api/templates/landing"),
    input: {},
  });
  assert.equal(response?.status, 200);
  assert.deepEqual(await response?.json(), { id: 4, name: "Landing", slug: "landing", projectType: "website", tags: ["marketing"], featured: true });
});

test("authenticated blog routes enforce project ownership before querying posts", async () => {
  const response = await handleContentRoute({
    request: request("https://staging.example/api/projects/7/blog-posts", "GET", undefined, "__Host-bc_session=opaque"),
    env: env([
      { first: { id: "user-1", username: "owner", email: "owner@example.com", role: "user" } },
      { first: null },
    ]),
    url: new URL("https://staging.example/api/projects/7/blog-posts"),
    input: {},
  });
  assert.equal(response?.status, 404);
  assert.deepEqual(await response?.json(), { message: "Project not found" });
});

test("SEO JSON does not expose stored image payloads", async () => {
  const response = await handleContentRoute({
    request: request("https://staging.example/api/projects/7/seo", "GET", undefined, "__Host-bc_session=opaque"),
    env: env([
      { first: { id: "user-1", username: "owner", email: "owner@example.com", role: "user" } },
      { first: { id: 7, user_id: "user-1" } },
      { first: { project_id: 7, social_image_data: "data:image/png;base64,c2VjcmV0", preview_image_data: "" } },
    ]),
    url: new URL("https://staging.example/api/projects/7/seo"),
    input: {},
  });
  const body = await response?.json() as any;
  assert.equal(response?.status, 200);
  assert.equal(body.hasSocialImage, true);
  assert.equal("socialImageData" in body, false);
  assert.equal("previewImageData" in body, false);
});

test("SEO suggestions fail explicitly when the provider is not configured", async () => {
  const response = await handleContentRoute({
    request: request("https://staging.example/api/projects/7/seo/suggestions", "GET", undefined, "__Host-bc_session=opaque"),
    env: env([
      { first: { id: "user-1", username: "owner", email: "owner@example.com", role: "user" } },
      { first: { id: 7, user_id: "user-1", runtime_agent_id: "agent-7", name: "Tasks", type: "website", description: "" } },
    ]),
    url: new URL("https://staging.example/api/projects/7/seo/suggestions"),
    input: {},
  });
  assert.equal(response?.status, 503);
});

test("configured SEO suggestions fetch bounded adapter files and provider JSON", async () => {
  const originalFetch = globalThis.fetch;
  let providerPrompt = "";
  let adapterAgentId = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    providerPrompt = String(init?.body || "");
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        projectSummary: "A focused task planning application for teams and their daily work.",
        metaTitle: "Team Tasks | Plan Work Clearly",
        metaDescription: "Plan tasks, organize priorities, and keep daily work moving with a focused workspace built for teams that need clarity and progress every day.",
        focusKeyword: "team task planning",
        ogTitle: "Plan Team Tasks With Clarity",
        ogDescription: "A focused workspace for organizing team tasks, priorities, and daily progress.",
        keywords: ["team task planning"],
        longTailKeywords: ["task planning workspace for teams"],
        schemaJson: "{\"@context\":\"https://schema.org\",\"@type\":\"SoftwareApplication\"}",
      }) }] } }],
    }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const response = await handleContentRoute({
      request: request("https://staging.example/api/projects/7/seo/suggestions", "GET", undefined, "__Host-bc_session=opaque"),
      env: Object.assign(env([
        { first: { id: "user-1", username: "owner", email: "owner@example.com", role: "user" } },
        { first: { id: 7, user_id: "user-1", name: "Tasks", type: "website", description: "", runtime_agent_id: "agent-7", runtime_deployment_url: "https://tasks.example" } },
      ]), {
        GOOGLE_AI_STUDIO_API_KEY: "test-only-key",
        __seoAdapter: {
          files: async (project: { agentId?: string }) => { adapterAgentId = String(project.agentId); return { files: [{ path: "src/App.tsx" }, { path: ".env" }] }; },
          fileContent: async (_project: unknown, path: string) => ({ path, content: path === "src/App.tsx" ? "Task planner dashboard" : "should-not-be-read" }),
        },
      }),
      url: new URL("https://staging.example/api/projects/7/seo/suggestions"),
      input: {},
    });
    assert.equal(response?.status, 200);
    const body = await response?.json() as any;
    assert.deepEqual(body.keywords, ["team task planning"]);
    assert.equal(adapterAgentId, "agent-7");
    assert.match(providerPrompt, /src\/App\.tsx/);
    assert.doesNotMatch(providerPrompt, /\.env/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("published SEO mutations refresh owned route metadata through validated KV", async () => {
  const writes: Array<[string, string]> = [];
  const routes = {
    get: async (key: string) => key === "tasks" ? JSON.stringify({ scriptName: "task_script", metadata: {} }) : null,
    put: async (key: string, value: string) => { writes.push([key, value]); },
  };
  const response = await handleContentRoute({
    request: request("https://staging.example/api/projects/7/seo/social-image", "POST", { data: `data:image/png;base64,${btoa("image")}` }, "__Host-bc_session=opaque"),
    env: Object.assign(env([
      { first: { id: "user-1", username: "owner", email: "owner@example.com", role: "user" } },
      { first: { id: 7, user_id: "user-1", runtime_deployment_script_name: "task_script", subdomain_slug: "tasks" } },
      { first: { project_id: 7, social_image_data: "data:image/png;base64,aW1hZ2U=", og_image_url: "https://staging.example/image" } },
      { first: { project_id: 7, meta_title: "Tasks", allow_indexing: 1 } },
    ]), {
      STAGING_ROUTES: routes,
      ENVIRONMENT: "staging",
      STAGING_ROUTE_KV_ID: "e5e119fa2abc4c26a8c027e0d8a8d82c",
    }),
    url: new URL("https://staging.example/api/projects/7/seo/social-image"),
    input: { data: `data:image/png;base64,${btoa("image")}` },
  });
  assert.equal(response?.status, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "tasks");
  assert.equal(JSON.parse(writes[0][1]).scriptName, "task_script");
  assert.equal(JSON.parse(writes[0][1]).metadata.title, "Tasks");
});