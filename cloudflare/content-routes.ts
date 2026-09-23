import { resolveSession, type SessionUser } from "./staging/auth";
import { createVibeSdkAdapter } from "./staging/vibesdk-adapter";
import { refreshPublishedMetadata, routeMetadata } from "./published-routes";

type ContentEnv = { DB: D1Database; VIBESDK_RUNTIME_URL?: string; VIBESDK_API_KEY?: string; VIBESDK_RUNTIME?: Fetcher; GOOGLE_AI_STUDIO_API_KEY?: string; __seoAdapter?: any; STAGING_ROUTES?: KVNamespace; ENVIRONMENT?: string; STAGING_ROUTE_KV_ID?: string; CONTROL_PLANE_ROUTE_KV_ID?: string };
type ContentRouteArgs = { request: Request; env: ContentEnv; url: URL; input: Record<string, unknown> };

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "Cache-Control": "no-store" },
});

const numberId = (value: string | undefined) => {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const jsonValue = (value: unknown, fallback: unknown = {}) => {
  if (typeof value !== "string") return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

const blog = (row: any) => ({
  id: row.id, projectId: row.project_id, title: row.title, slug: row.slug, content: row.content,
  status: row.status, keyword: row.keyword, wordCount: row.word_count,
  scheduledAt: row.scheduled_at, publishedAt: row.published_at, createdAt: row.created_at,
});
const page = (row: any) => ({
  id: row.id, projectId: row.project_id, title: row.title, slug: row.slug, status: row.status,
  pageType: row.page_type, content: row.content, createdAt: row.created_at,
});
const template = (row: any) => ({
  id: row.id, name: row.name, slug: row.slug, category: row.category, description: row.description,
  framework: row.framework, projectType: row.project_type, tags: jsonValue(row.tags, []),
  color: row.color, githubUrl: row.github_url, forkUrl: row.fork_url,
  featured: Boolean(row.featured), stars: row.stars,
});
const autoblogger = (row: any) => row && ({
  ...row,
  projectId: row.project_id,
  postsPerDay: row.posts_per_day,
  writingStyle: row.writing_style,
  minWordCount: row.min_word_count,
  updatedAt: row.updated_at,
  enabled: Boolean(row.enabled),
});

async function ownedProject(env: ContentEnv, user: SessionUser, id: number) {
  return env.DB.prepare("SELECT p.*, r.agent_id AS runtime_agent_id, r.deployment_url AS runtime_deployment_url, r.deployment_script_name AS runtime_deployment_script_name, r.subdomain_slug FROM projects p LEFT JOIN runtime_project_links r ON r.project_id=p.id WHERE p.id=? AND p.user_id=?").bind(id, user.id).first<any>();
}

async function refreshPublishedSeo(env: ContentEnv, project: any, projectId: number) {
  if (!project.runtime_deployment_script_name || !project.subdomain_slug) return;
  if (!env.STAGING_ROUTES || !env.ENVIRONMENT || !env.STAGING_ROUTE_KV_ID) {
    throw Object.assign(new Error("Published route binding is not configured"), { status: 503 });
  }
  const seo = await env.DB.prepare("SELECT * FROM seo_settings WHERE project_id=?").bind(projectId).first<any>();
  await refreshPublishedMetadata({
    STAGING_ROUTES: env.STAGING_ROUTES,
    ENVIRONMENT: env.ENVIRONMENT,
    STAGING_ROUTE_KV_ID: env.STAGING_ROUTE_KV_ID,
    CONTROL_PLANE_ROUTE_KV_ID: env.CONTROL_PLANE_ROUTE_KV_ID,
  }, project.subdomain_slug, project.runtime_deployment_script_name, routeMetadata(seo));
}

function publicImage(data: unknown): Response {
  if (typeof data !== "string") return new Response("Not found", { status: 404 });
  const match = data.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return new Response("Not found", { status: 404 });
  const encoded = match[2];
  if (encoded.length > 7_000_000) return new Response("Not found", { status: 404 });
  let binary: string;
  try { binary = atob(encoded); } catch { return new Response("Not found", { status: 404 }); }
  if (!binary.length || binary.length > 5_000_000) return new Response("Not found", { status: 404 });
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": `image/${match[1].toLowerCase()}`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

function safeSeo(row: any, origin: string, id: number) {
  const updated = row?.updated_at || "";
  return {
    projectId: id,
    metaTitle: row?.meta_title || "",
    metaDescription: row?.meta_description || "",
    focusKeyword: row?.focus_keyword || "",
    seoKeywords: row?.seo_keywords || "",
    longTailKeywords: row?.long_tail_keywords || "",
    schemaJson: row?.schema_json || "{}",
    faviconData: row?.favicon_data || "",
    canonicalUrl: row?.canonical_url || "",
    ogTitle: row?.og_title || "",
    ogDescription: row?.og_description || "",
    ogImageUrl: row?.og_image_url || "",
    allowIndexing: row?.allow_indexing === undefined ? true : Boolean(row.allow_indexing),
    hasSocialImage: Boolean(row?.social_image_data),
    previewImageUrl: row?.preview_image_data ? `${origin}/api/public/projects/${id}/preview-image?v=${encodeURIComponent(updated)}` : undefined,
    socialImageUrl: row?.social_image_data ? `${origin}/api/public/projects/${id}/social-image?v=${encodeURIComponent(updated)}` : undefined,
  };
}

function dataUri(value: unknown, kinds: string): { value: string; bytes: number } | null {
  if (typeof value !== "string") return null;
  const match = value.match(new RegExp(`^data:image/(?:${kinds});base64,([A-Za-z0-9+/]+={0,2})$`, "i"));
  if (!match) return null;
  try {
    const bytes = atob(match[1]).length;
    return bytes ? { value, bytes } : null;
  } catch { return null; }
}

type SeoSuggestions = {
  projectSummary: string; metaTitle: string[]; metaDescription: string[]; focusKeyword: string[];
  ogTitle: string[]; ogDescription: string[]; keywords: string[]; longTailKeywords: string[]; schemaJson: string;
};
const seoCache = new Map<string, { expires: number; value: SeoSuggestions }>();
const seoPath = (path: string) => {
  const p = path.toLowerCase();
  if (/(node_modules\/|\.git\/|dist\/|build\/|\/\.env|\.env$|secret|credential|\.lock$|-lock\.json$)/.test(p)) return false;
  return /\.(tsx?|jsx?|html?|md|json|css|vue|svelte)$/i.test(path);
};
const seoRank = (path: string) => {
  const p = path.toLowerCase();
  if (/(^|\/)readme\.md$/.test(p)) return 100;
  if (/(^|\/)(app|page|home|index)\.(tsx?|jsx?|vue|svelte)$/.test(p)) return 95;
  if (p.includes("/pages/") || p.includes("/components/")) return 80;
  if (p.endsWith("package.json")) return 70;
  if (p.endsWith(".json")) return 40;
  if (p.endsWith(".css")) return 20;
  return 50;
};
const valueText = (value: unknown) => typeof value === "string" ? value.trim() : Array.isArray(value) ? [...value].reverse().find((x) => typeof x === "string")?.trim() || "" : "";
const listText = (value: unknown, max: number) => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, max) : [];
function completeTitle(candidate: string, name: string, keyword: string) {
  if (candidate.length >= 25 && candidate.length <= 60 && candidate.toLowerCase() !== name.toLowerCase()) return candidate;
  return `${name} | ${keyword || "Helpful Online Software"}`.slice(0, 60).trim();
}
function completeDescription(candidate: string, summary: string) {
  const s = (candidate || summary).replace(/\s+/g, " ").trim();
  if (s.length >= 150 && s.length <= 160 && /[.!?]$/.test(s)) return s;
  return s.length >= 120 ? `${s.replace(/[.!?]+$/, "")}.` : "";
}
async function sha(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}
async function generateSuggestions(env: ContentEnv, project: any, deploymentUrl: string | undefined, files: Array<{ path: string; content: string }>): Promise<SeoSuggestions> {
  const key = env.GOOGLE_AI_STUDIO_API_KEY?.trim();
  if (!key) throw Object.assign(new Error("Project-aware SEO suggestions are not configured."), { status: 503 });
  const context = files.map((file) => `FILE: ${file.path}\n${file.content}`).join("\n\n");
  const fingerprint = await sha(JSON.stringify({ project: { name: project.name, type: project.type, description: project.description }, deploymentUrl, context }));
  const cached = seoCache.get(fingerprint);
  if (cached && cached.expires > Date.now()) return cached.value;
  const prompt = `Analyze this generated application and return JSON only with projectSummary, metaTitle, metaDescription, focusKeyword, ogTitle, ogDescription, keywords, longTailKeywords, schemaJson. Make metaTitle 25-60 characters and metaDescription 150-160 characters. Describe the actual product, not its framework.\nProject name: ${project.name}\nProject type: ${project.type}\nKnown description: ${project.description || "None"}\nPublished URL: ${deploymentUrl || "Not published"}\n\n${context}`;
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }),
  });
  if (!response.ok) throw Object.assign(new Error("Unable to analyze the generated project right now."), { status: 502 });
  const payload: any = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("") || "";
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { throw Object.assign(new Error("The SEO provider returned invalid JSON."), { status: 502 }); }
  const summary = valueText(parsed.projectSummary);
  const focus = valueText(parsed.focusKeyword);
  const result: SeoSuggestions = {
    projectSummary: summary.slice(0, 500),
    metaTitle: [completeTitle(valueText(parsed.metaTitle), project.name, focus)],
    metaDescription: [completeDescription(valueText(parsed.metaDescription), summary)],
    focusKeyword: focus ? [focus.slice(0, 120)] : [],
    ogTitle: valueText(parsed.ogTitle) ? [valueText(parsed.ogTitle).slice(0, 120)] : [],
    ogDescription: valueText(parsed.ogDescription) ? [valueText(parsed.ogDescription).slice(0, 500)] : [],
    keywords: listText(parsed.keywords, 8),
    longTailKeywords: listText(parsed.longTailKeywords, 10),
    schemaJson: typeof parsed.schemaJson === "string" ? parsed.schemaJson.slice(0, 50_000) : JSON.stringify(parsed.schemaJson || {}),
  };
  if (!result.projectSummary || !result.metaTitle[0] || !result.metaDescription[0]) throw Object.assign(new Error("The generated project could not be summarized."), { status: 502 });
  try { JSON.parse(result.schemaJson); } catch { throw Object.assign(new Error("The SEO provider returned invalid structured data."), { status: 502 }); }
  seoCache.set(fingerprint, { expires: Date.now() + 900_000, value: result });
  return result;
}

export async function handleContentRoute({ request, env, url, input }: ContentRouteArgs): Promise<Response | null> {
  const path = url.pathname;
  const publicMatch = path.match(/^\/api\/public\/projects\/(\d+)\/(preview-image|social-image)$/);
  if (publicMatch && request.method === "GET") {
    const id = Number(publicMatch[1]);
    const column = publicMatch[2] === "preview-image" ? "preview_image_data" : "social_image_data";
    const row = await env.DB.prepare(`SELECT ${column} FROM seo_settings WHERE project_id=?`).bind(id).first<any>();
    return publicImage(row?.[column]);
  }

  const templateMatch = path.match(/^\/api\/templates(?:\/([^/]+))?$/);
  if (templateMatch && request.method === "GET") {
    if (templateMatch[1]) {
      const row = await env.DB.prepare("SELECT * FROM templates WHERE slug=?").bind(decodeURIComponent(templateMatch[1])).first<any>();
      return row ? json(template(row)) : json({ message: "Template not found" }, 404);
    }
    const rows = (await env.DB.prepare("SELECT * FROM templates ORDER BY id ASC").all()).results || [];
    return json(rows.map(template));
  }

  const user = await resolveSession(env.DB, request);
  if (!user) return null;

  const projectMatch = path.match(/^\/api\/projects\/(\d+)(?:\/(.*))?$/);
  if (!projectMatch) return null;
  const projectId = numberId(projectMatch[1]);
  if (!projectId) return json({ message: "Project not found" }, 404);
  const operation = projectMatch[2] || "";
  const project = await ownedProject(env, user, projectId);
  if (!project) return json({ message: "Project not found" }, 404);

  const blogMatch = operation.match(/^blog-posts(?:\/(\d+))?$/);
  if (blogMatch) {
    const postId = numberId(blogMatch[1]);
    if (request.method === "GET" && !postId) {
      const rows = (await env.DB.prepare("SELECT * FROM blog_posts WHERE project_id=? ORDER BY created_at DESC").bind(projectId).all()).results || [];
      return json(rows.map(blog));
    }
    if (request.method === "POST" && !postId) {
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const content = typeof input.content === "string" ? input.content : "";
      if (!title) return json({ message: "Title is required" }, 400);
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `post-${Date.now()}`;
      const words = content ? content.trim().split(/\s+/).filter(Boolean).length : 0;
      const result = await env.DB.prepare("INSERT INTO blog_posts(project_id,title,slug,content,status,keyword,word_count,scheduled_at,published_at) VALUES(?,?,?,?,?,?,?,?,?) RETURNING *")
        .bind(projectId, title, slug, content, input.status ?? "draft", input.keyword ?? "", words, input.scheduledAt ?? null, input.publishedAt ?? null).first<any>();
      return json(blog(result), 201);
    }
    if (postId && (request.method === "PUT" || request.method === "DELETE")) {
      const existing = await env.DB.prepare("SELECT * FROM blog_posts WHERE id=? AND project_id=?").bind(postId, projectId).first<any>();
      if (!existing) return json({ message: "Blog post not found" }, 404);
      if (request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM blog_posts WHERE id=? AND project_id=?").bind(postId, projectId).run();
        return json({ success: true });
      }
      const title = typeof input.title === "string" ? input.title.trim() : existing.title;
      const content = typeof input.content === "string" ? input.content : existing.content;
      const words = typeof input.content === "string" ? content.trim().split(/\s+/).filter(Boolean).length : existing.word_count;
      const result = await env.DB.prepare("UPDATE blog_posts SET title=?,content=?,status=?,keyword=?,word_count=?,scheduled_at=?,published_at=? WHERE id=? AND project_id=? RETURNING *")
        .bind(title, content, input.status ?? existing.status, input.keyword ?? existing.keyword, words, input.scheduledAt ?? existing.scheduled_at, input.publishedAt ?? existing.published_at, postId, projectId).first<any>();
      return json(blog(result));
    }
    return json({ message: "Method not allowed" }, 405);
  }

  if (operation === "autoblogger") {
    if (request.method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM autoblogger_settings WHERE project_id=?").bind(projectId).first<any>();
      return json(autoblogger(row) || { projectId, enabled: false, postsPerDay: 3, writingStyle: "neil-patel", minWordCount: 2000, keywords: "" });
    }
    if (request.method === "PUT") {
      const result = await env.DB.prepare("INSERT INTO autoblogger_settings(project_id,enabled,posts_per_day,writing_style,min_word_count,keywords) VALUES(?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,posts_per_day=excluded.posts_per_day,writing_style=excluded.writing_style,min_word_count=excluded.min_word_count,keywords=excluded.keywords,updated_at=datetime('now') RETURNING *")
        .bind(projectId, input.enabled ? 1 : 0, Number(input.postsPerDay ?? 3), String(input.writingStyle ?? "neil-patel"), Number(input.minWordCount ?? 2000), String(input.keywords ?? "")).first<any>();
      return json(autoblogger(result));
    }
    return json({ message: "Method not allowed" }, 405);
  }

  const seoMatch = operation.match(/^seo(?:\/(suggestions|social-image))?$/);
  if (seoMatch) {
    const suffix = seoMatch[1];
    if (suffix === "suggestions" && request.method === "GET") {
      if (!project.runtime_agent_id) return json({ message: "Generate the project before requesting project-aware suggestions." }, 409);
      try {
        const adapter = env.__seoAdapter || createVibeSdkAdapter({ VIBESDK_RUNTIME_URL: env.VIBESDK_RUNTIME_URL, VIBESDK_API_KEY: env.VIBESDK_API_KEY, VIBESDK_RUNTIME: env.VIBESDK_RUNTIME });
        const runtimeProject = { agentId: project.runtime_agent_id, name: project.name, type: project.type, description: project.description };
        const listing = await adapter.files(runtimeProject);
        const selected = (listing.files || []).filter((file: any) => seoPath(file.path)).sort((a: any, b: any) => seoRank(b.path) - seoRank(a.path)).slice(0, 12);
        const files: Array<{ path: string; content: string }> = [];
        let remaining = 60_000;
        for (const file of selected) {
          if (remaining <= 0) break;
          const result = await adapter.fileContent(runtimeProject, file.path);
          if (!result.content) continue;
          const content = result.content.slice(0, Math.min(12_000, remaining));
          remaining -= content.length;
          files.push({ path: file.path, content });
        }
        if (!files.length) return json({ message: "No readable generated project files were found." }, 422);
        return json(await generateSuggestions(env, project, project.runtime_deployment_url, files));
      } catch (error: any) {
        return json({ message: error?.message || "Unable to create project-aware suggestions." }, error?.status || 502);
      }
    }
    if (suffix === "social-image" && request.method === "POST") {
      const image = dataUri(input.data, "png|jpeg|webp");
      if (!image) return json({ message: "Upload a PNG, JPEG, or WebP social image." }, 400);
      if (image.bytes > 5_000_000) return json({ message: "Social images must be 5 MB or less." }, 413);
      const row = await env.DB.prepare("INSERT INTO seo_settings(project_id,social_image_data,og_image_url) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET social_image_data=excluded.social_image_data,og_image_url=excluded.og_image_url,updated_at=datetime('now') RETURNING *")
        .bind(projectId, image.value, `${url.origin}/api/public/projects/${projectId}/social-image?v=${Date.now()}`).first<any>();
      try { await refreshPublishedSeo(env, project, projectId); } catch (error: any) { return json({ message: error?.message || "Published metadata refresh failed." }, error?.status || 502); }
      return json(safeSeo(row, url.origin, projectId));
    }
    if (suffix === "social-image" && request.method === "DELETE") {
      const row = await env.DB.prepare("INSERT INTO seo_settings(project_id,social_image_data,og_image_url) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET social_image_data='',og_image_url='',updated_at=datetime('now') RETURNING *").bind(projectId, "", "").first<any>();
      try { await refreshPublishedSeo(env, project, projectId); } catch (error: any) { return json({ message: error?.message || "Published metadata refresh failed." }, error?.status || 502); }
      return json(safeSeo(row, url.origin, projectId));
    }
    if (!suffix && request.method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM seo_settings WHERE project_id=?").bind(projectId).first<any>();
      return json(safeSeo(row, url.origin, projectId));
    }
    if (!suffix && request.method === "PUT") {
      const text = (key: string, max: number) => typeof input[key] === "string" ? String(input[key]).trim().slice(0, max) : undefined;
      const update: Record<string, unknown> = {
        meta_title: text("metaTitle", 120), meta_description: text("metaDescription", 500), focus_keyword: text("focusKeyword", 120),
        seo_keywords: text("seoKeywords", 2000), long_tail_keywords: text("longTailKeywords", 4000), schema_json: text("schemaJson", 50000),
        favicon_data: text("faviconData", 350000), canonical_url: text("canonicalUrl", 2000), og_title: text("ogTitle", 120),
        og_description: text("ogDescription", 500), og_image_url: text("ogImageUrl", 2000),
      };
      if (typeof input.allowIndexing === "boolean") update.allow_indexing = input.allowIndexing ? 1 : 0;
      if (update.favicon_data && !/^data:image\/(?:png|x-icon|vnd\.microsoft\.icon|svg\+xml|webp);base64,/i.test(String(update.favicon_data))) return json({ message: "Upload a PNG, ICO, SVG, or WebP favicon." }, 400);
      for (const key of ["canonical_url", "og_image_url"]) if (update[key]) { try { new URL(String(update[key])); } catch { return json({ message: "Enter a valid URL." }, 400); } }
      if (update.schema_json && update.schema_json !== "{}") { try { JSON.parse(String(update.schema_json)); } catch { return json({ message: "Structured data must be valid JSON." }, 400); } }
      const keys = Object.keys(update).filter((key) => update[key] !== undefined);
      const values = keys.map((key) => update[key]);
      const insertCols = ["project_id", ...keys], placeholders = insertCols.map(() => "?").join(",");
      const updates = keys.map((key) => `${key}=excluded.${key}`).join(",");
      const row = await env.DB.prepare(`INSERT INTO seo_settings(${insertCols.join(",")}) VALUES(${placeholders}) ON CONFLICT(project_id) DO UPDATE SET ${updates},updated_at=datetime('now') RETURNING *`).bind(projectId, ...values).first<any>();
      try { await refreshPublishedSeo(env, project, projectId); } catch (error: any) { return json({ message: error?.message || "Published metadata refresh failed." }, error?.status || 502); }
      return json(safeSeo(row, url.origin, projectId));
    }
    return json({ message: "Method not allowed" }, 405);
  }

  const pagesMatch = operation.match(/^pages(?:\/(\d+))?$/);
  if (pagesMatch) {
    const pageId = numberId(pagesMatch[1]);
    if (request.method === "GET" && !pageId) {
      const rows = (await env.DB.prepare("SELECT * FROM site_pages WHERE project_id=? ORDER BY id ASC").bind(projectId).all()).results || [];
      return json(rows.map(page));
    }
    if (request.method === "POST" && !pageId) {
      const result = await env.DB.prepare("INSERT INTO site_pages(project_id,title,slug,status,page_type,content) VALUES(?,?,?,?,?,?) RETURNING *")
        .bind(projectId, String(input.title ?? ""), String(input.slug ?? ""), String(input.status ?? "draft"), String(input.pageType ?? "standard"), String(input.content ?? "")).first<any>();
      return json(page(result), 201);
    }
    if (pageId && (request.method === "PUT" || request.method === "DELETE")) {
      const existing = await env.DB.prepare("SELECT * FROM site_pages WHERE id=? AND project_id=?").bind(pageId, projectId).first<any>();
      if (!existing) return json({ message: "Page not found" }, 404);
      if (request.method === "DELETE") { await env.DB.prepare("DELETE FROM site_pages WHERE id=? AND project_id=?").bind(pageId, projectId).run(); return json({ success: true }); }
      const result = await env.DB.prepare("UPDATE site_pages SET title=?,slug=?,status=?,page_type=?,content=? WHERE id=? AND project_id=? RETURNING *")
        .bind(input.title ?? existing.title, input.slug ?? existing.slug, input.status ?? existing.status, input.pageType ?? existing.page_type, input.content ?? existing.content, pageId, projectId).first<any>();
      return json(page(result));
    }
    return json({ message: "Method not allowed" }, 405);
  }

  return null;
}