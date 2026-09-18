const SUFFIX = ".apps.buildcustom.ai";
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SCRIPT = /^[a-z0-9_][a-z0-9-_]*$/;
const DEFAULT_FAVICON_URL = "https://buildcustom.ai/favicon.png";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function routeConfig(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { scriptName: parsed.scriptName, metadata: parsed.metadata || {} };
    }
  } catch {
    // Existing route records contain only the script name.
  }
  return { scriptName: raw, metadata: {} };
}

function metadataTags(metadata) {
  const tags = [];
  if (metadata.title) tags.push(`<title>${escapeHtml(metadata.title)}</title>`);
  if (metadata.description) tags.push(`<meta name="description" content="${escapeHtml(metadata.description)}">`);
  if (typeof metadata.allowIndexing === "boolean") {
    tags.push(`<meta name="robots" content="${metadata.allowIndexing === false ? "noindex, nofollow" : "index, follow"}">`);
  }
  if (metadata.canonicalUrl) tags.push(`<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}">`);
  tags.push(`<link rel="icon" href="${escapeHtml(metadata.faviconData || DEFAULT_FAVICON_URL)}">`);
  if (metadata.ogTitle || metadata.title) tags.push(`<meta property="og:title" content="${escapeHtml(metadata.ogTitle || metadata.title)}">`);
  if (metadata.ogDescription || metadata.description) tags.push(`<meta property="og:description" content="${escapeHtml(metadata.ogDescription || metadata.description)}">`);
  if (metadata.ogImageUrl) tags.push(`<meta property="og:image" content="${escapeHtml(metadata.ogImageUrl)}">`);
  if (metadata.ogTitle || metadata.ogDescription || metadata.ogImageUrl) {
    tags.push('<meta property="og:type" content="website">');
    tags.push('<meta name="twitter:card" content="summary_large_image">');
  }
  if (metadata.schemaJson && metadata.schemaJson !== "{}") {
    tags.push(`<script type="application/ld+json">${String(metadata.schemaJson).replace(/<\/script/gi, "<\\/script")}</script>`);
  }
  return tags.join("");
}

function removeElement() {
  return { element(element) { element.remove(); } };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.hostname.endsWith(SUFFIX)) return new Response("Not found", { status: 404 });
    const slug = url.hostname.slice(0, -SUFFIX.length);
    if (!SLUG.test(slug) || slug.includes(".")) return new Response("Not found", { status: 404 });

    const raw = await env.ROUTES.get(slug);
    if (!raw) return new Response("Project not found", { status: 404 });
    const { scriptName, metadata } = routeConfig(raw);
    if (!SCRIPT.test(scriptName || "")) return new Response("Project not found", { status: 404 });

    const response = await env.DISPATCHER.get(scriptName).fetch(request);
    if (!response.headers.get("content-type")?.includes("text/html")) return response;

    const tags = metadataTags(metadata);
    if (!tags) return response;
    let rewriter = new HTMLRewriter();
    if (metadata.title) rewriter = rewriter.on("title", removeElement());
    if (metadata.description) rewriter = rewriter.on('meta[name="description"]', removeElement());
    if (typeof metadata.allowIndexing === "boolean") rewriter = rewriter.on('meta[name="robots"]', removeElement());
    if (metadata.ogTitle || metadata.title) rewriter = rewriter.on('meta[property="og:title"]', removeElement());
    if (metadata.ogDescription || metadata.description) rewriter = rewriter.on('meta[property="og:description"]', removeElement());
    if (metadata.ogImageUrl) rewriter = rewriter.on('meta[property="og:image"]', removeElement());
    if (metadata.ogTitle || metadata.ogDescription || metadata.ogImageUrl) {
      rewriter = rewriter.on('meta[property="og:type"]', removeElement()).on('meta[name^="twitter:"]', removeElement());
    }
    if (metadata.canonicalUrl) rewriter = rewriter.on('link[rel="canonical"]', removeElement());
    rewriter = rewriter.on('link[rel~="icon"]', removeElement());
    if (metadata.schemaJson && metadata.schemaJson !== "{}") rewriter = rewriter.on('script[type="application/ld+json"]', removeElement());
    return rewriter.on("head", {
        element(element) {
          element.append(tags, { html: true });
        },
      })
      .transform(response);
  },
};