const HOSTNAME = "buildcustom-apps-gateway-staging.thegoldimport.workers.dev";
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SCRIPT = /^[a-z0-9_][a-z0-9-_]*$/;

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function routeConfig(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return { scriptName: parsed.scriptName, metadata: parsed.metadata || {} };
  } catch { /* Legacy route values contain only the script name. */ }
  return { scriptName: raw, metadata: {} };
}

export function metadataTags(metadata, origin, slug) {
  const tags = [];
  if (metadata.title) tags.push(`<title>${escapeHtml(metadata.title)}</title>`);
  if (metadata.description) tags.push(`<meta name="description" content="${escapeHtml(metadata.description)}">`);
  if (typeof metadata.allowIndexing === "boolean") tags.push(`<meta name="robots" content="${metadata.allowIndexing === false ? "noindex, nofollow" : "index, follow"}">`);
  if (metadata.canonicalUrl) tags.push(`<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}">`);
  if (metadata.faviconData) tags.push(`<link rel="icon" href="${escapeHtml(metadata.faviconData)}">`);
  if (metadata.ogTitle) tags.push(`<meta property="og:title" content="${escapeHtml(metadata.ogTitle)}">`);
  if (metadata.ogDescription) tags.push(`<meta property="og:description" content="${escapeHtml(metadata.ogDescription)}">`);
  if (metadata.ogImageUrl) tags.push(`<meta property="og:image" content="${escapeHtml(metadata.ogImageUrl)}">`);
  if (metadata.ogTitle || metadata.ogDescription || metadata.ogImageUrl) tags.push('<meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">');
  if (metadata.schemaJson && metadata.schemaJson !== "{}") tags.push(`<script type="application/ld+json">${String(metadata.schemaJson).replace(/<\/script/gi, "<\\/script")}</script>`);
  return tags.join("");
}

export function stagingPath(pathname) {
  const match = pathname.match(/^\/p\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\/(.*))?$/);
  if (!match || !SLUG.test(match[1])) return null;
  return { slug: match[1], path: `/${match[2] || ""}`.replace(/\/+/g, "/"), trailingSlash: pathname === `/p/${match[1]}/` || pathname.startsWith(`/p/${match[1]}/`) };
}

export function rewriteRootAbsoluteUrl(value, slug) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith(`/p/${slug}/`)) return value;
  return `/p/${slug}${value}`;
}

// This only covers URLs present in HTML/CSS. JavaScript that constructs a
// root-relative route at runtime cannot be safely rewritten without executing it.
export function rewriteRootAbsoluteCss(value, slug) {
  if (typeof value !== "string") return value;
  return value
    .replace(/url\(\s*(['"]?)(\/(?!\/|p\/)[^)'"]*)\1\s*\)/gi, (_match, quote, path) => `url(${quote}/p/${slug}${path}${quote})`)
    .replace(/(@import\s+)(['"])(\/(?!\/|p\/)[^'"]+)\2/gi, (_match, prefix, quote, path) => `${prefix}${quote}/p/${slug}${path}${quote}`);
}

function rewriteSrcset(value, slug) {
  return typeof value === "string" ? value.split(",").map((candidate) => {
    const parts = candidate.trim().split(/\s+/);
    if (parts[0]) parts[0] = rewriteRootAbsoluteUrl(parts[0], slug);
    return parts.join(" ");
  }).join(", ") : value;
}

function removeElement() { return { element(element) { element.remove(); } }; }

function rewriteHtml(response, metadata, origin, slug) {
  if (!response.headers.get("content-type")?.includes("text/html") || typeof HTMLRewriter === "undefined") return response;
  let rewriter = new HTMLRewriter();
  const replacements = [
    ["title", "title"], ['meta[name="description"]', "description"], ['meta[name="robots"]', "allowIndexing"],
    ['meta[property="og:title"]', "ogTitle"], ['meta[property="og:description"]', "ogDescription"],
    ['meta[property="og:image"]', "ogImageUrl"], ['link[rel="canonical"]', "canonicalUrl"], ['link[rel~="icon"]', "faviconData"],
  ];
  for (const [selector, field] of replacements) if (metadata[field] !== undefined && metadata[field] !== null && metadata[field] !== "") rewriter = rewriter.on(selector, removeElement());
  if (metadata.schemaJson && metadata.schemaJson !== "{}") rewriter = rewriter.on('script[type="application/ld+json"]', removeElement());
  const tags = metadataTags(metadata, origin, slug);
  if (tags) rewriter = rewriter.on("head", { element(element) { element.append(tags, { html: true }); } });
  rewriter = rewriter.on("*", { element(element) {
    for (const name of ["href", "src", "action", "poster"]) {
      const attribute = element.getAttribute(name);
      if (attribute) element.setAttribute(name, rewriteRootAbsoluteUrl(attribute, slug));
    }
    const srcset = element.getAttribute("srcset");
    if (srcset) element.setAttribute("srcset", rewriteSrcset(srcset, slug));
    const style = element.getAttribute("style");
    if (style) element.setAttribute("style", rewriteRootAbsoluteCss(style, slug));
  } });
  rewriter = rewriter.on("style", { text(text) { text.replace(rewriteRootAbsoluteCss(text.text, slug)); } });
  return rewriter.transform(response);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname.toLowerCase().replace(/\.$/, "") !== HOSTNAME) return new Response("Not found", { status: 404 });
    const resolved = stagingPath(url.pathname);
    if (!resolved) return new Response("Not found", { status: 404 });
    const { slug, path } = resolved;
    if (!resolved.trailingSlash && path === "/") return Response.redirect(`${url.origin}/p/${slug}/${url.search}`, 308);
    const raw = await env.ROUTES.get(slug);
    if (!raw) return new Response("Project not found", { status: 404 });
    const { scriptName, metadata } = routeConfig(raw);
    if (!SCRIPT.test(scriptName || "")) return new Response("Project not found", { status: 404 });

    if (path === "/_buildcustom/route-check") {
      return Response.json({ ok: true, project: slug, scriptName }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (path === "/_buildcustom/preview-image") {
      const image = await env.ROUTES.get(`preview:${slug}`, "arrayBuffer");
      return image ? new Response(image, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } }) : new Response("Preview image not found", { status: 404 });
    }
    if (path === "/robots.txt") {
      const body = metadata.allowIndexing === false ? "User-agent: *\nDisallow: /\n" : `User-agent: *\nAllow: /\nSitemap: ${url.origin}/p/${slug}/sitemap.xml\n`;
      return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
    }
    if (path === "/sitemap.xml") {
      const canonical = escapeHtml(metadata.canonicalUrl || `${url.origin}/p/${slug}/`);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${canonical}</loc></url></urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
    }

    const headers = new Headers(request.headers);
    for (const name of ["X-BuildCustom-Hostname", "X-BuildCustom-Domain-Purpose", "X-BuildCustom-Domain-Role", "X-BuildCustom-Primary-Hostname"]) headers.delete(name);
    const dispatched = await env.DISPATCHER.get(scriptName).fetch(new Request(new URL(path + url.search, url.origin), { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body }));
    const location = dispatched.headers.get("Location");
    if (location?.startsWith("/") && !location.startsWith("//")) {
      const redirectHeaders = new Headers(dispatched.headers);
      redirectHeaders.set("Location", rewriteRootAbsoluteUrl(location, slug));
      redirectHeaders.delete("content-length");
      return new Response(null, { status: dispatched.status, statusText: dispatched.statusText, headers: redirectHeaders });
    }
    return rewriteHtml(dispatched, metadata, url.origin, slug);
  },
};