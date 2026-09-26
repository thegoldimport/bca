const SUFFIX = ".apps.buildcustom.ai";
const ZONE = "buildcustom.ai";
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SCRIPT = /^[a-z0-9_][a-z0-9-_]*$/;
const CANDIDATE_SCRIPT = /^bc-r-[a-f0-9]{56}$/;
const DEFAULT_FAVICON_URL = "https://buildcustom.ai/favicon.png";
const DEFAULT_SOCIAL_IMAGE_URL = "https://buildcustom.ai/opengraph.jpg";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function routeConfig(raw) {
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

export function hostnameRoute(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.slug === "string") return {
      slug: parsed.slug,
      redirectTo: parsed.redirectTo || null,
      purpose: parsed.purpose || null,
      role: parsed.role || null,
      primaryHostname: parsed.primaryHostname || null,
    };
  } catch {
    // Existing hostname aliases contain only the slug.
  }
  return { slug: raw, redirectTo: null, purpose: null, role: null, primaryHostname: null };
}

export function metadataTags(metadata) {
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
  tags.push(`<meta property="og:image" content="${escapeHtml(metadata.ogImageUrl || DEFAULT_SOCIAL_IMAGE_URL)}">`);
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

function privateRoute(pathname) {
  const match = pathname.match(/^\/([pc])\/([^/]+)(\/.*)?$/);
  if (!match) return null;
  const path = match[3] || "/";
  if (match[1] === "p" && SLUG.test(match[2])) {
    return { type: "project", slug: match[2], scriptName: null, prefix: `/p/${match[2]}`, path };
  }
  if (match[1] === "c" && CANDIDATE_SCRIPT.test(match[2])) {
    return { type: "candidate", slug: null, scriptName: match[2], prefix: `/c/${match[2]}`, path };
  }
  return null;
}

function scopeRootRelativeUrl(value, prefix) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return value;
  if (value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`) || value.startsWith(`${prefix}#`)) return value;
  return `${prefix}${value}`;
}

function rewriteSrcset(value, prefix) {
  return value.replace(/(^|,\s*)(\/(?!\/)[^\s,]*)/g, (_match, separator, url) =>
    `${separator}${scopeRootRelativeUrl(url, prefix)}`);
}

function rewriteCssUrls(css, prefix) {
  return css
    .replace(/url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi, (whole, quote, quotedUrl, unquotedUrl) => {
      const url = quote ? quotedUrl : unquotedUrl.trim();
      const scoped = scopeRootRelativeUrl(url, prefix);
      return quote ? `url(${quote}${scoped}${quote})` : `url(${scoped})`;
    })
    .replace(/(@import\s+)(["'])([^"']+)\2/gi, (_match, prefixText, quote, url) =>
      `${prefixText}${quote}${scopeRootRelativeUrl(url, prefix)}${quote}`);
}

function scopedHtmlUrls(prefix) {
  return {
    element(element) {
      for (const attribute of ["href", "src"]) {
        const value = element.getAttribute(attribute);
        if (value !== null) element.setAttribute(attribute, scopeRootRelativeUrl(value, prefix));
      }
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const privateCanaryHost = typeof env.PRIVATE_CANARY_HOST === "string"
      ? env.PRIVATE_CANARY_HOST.toLowerCase().replace(/\.$/, "")
      : "";
    const isPrivateCanary = Boolean(privateCanaryHost && hostname === privateCanaryHost);
    const privatePath = isPrivateCanary ? privateRoute(url.pathname) : null;
    const requestPath = isPrivateCanary ? privatePath?.path || null : url.pathname;
    const isPrivateCandidate = isPrivateCanary && privatePath?.type === "candidate";
    const rawSourceVerification = isPrivateCanary && request.headers.get("X-BuildCustom-Verify-Source") === "1";
    const notFound = () => new Response("Not found", {
      status: 404,
      headers: isPrivateCanary ? { "X-Robots-Tag": "noindex, nofollow" } : undefined,
    });

    // The workers.dev canary is opt-in and path-scoped. It never changes
    // dispatch behavior for the public managed/custom-host gateway.
    if (isPrivateCanary && !privatePath) return notFound();
    if (hostname === ZONE || (hostname.endsWith(`.${ZONE}`) && !hostname.endsWith(SUFFIX))) {
      return fetch(request);
    }
    const managedSlug = isPrivateCanary
      ? privatePath.type === "project" ? privatePath.slug : null
      : hostname.endsWith(SUFFIX) ? hostname.slice(0, -SUFFIX.length) : null;
    const hostnameConfig = managedSlug || isPrivateCandidate
      ? { slug: managedSlug, redirectTo: null, purpose: null, role: null, primaryHostname: null }
      : hostnameRoute(await env.ROUTES.get(`hostname:${hostname}`));
    const slug = hostnameConfig.slug;
    let scriptName;
    let metadata = {};
    if (isPrivateCandidate) {
      scriptName = privatePath.scriptName;
    } else {
      if (typeof slug !== "string" || !SLUG.test(slug) || slug.includes(".")) return notFound();
      const raw = await env.ROUTES.get(slug);
      if (!raw) return new Response("Project not found", {
        status: 404,
        headers: isPrivateCanary ? { "X-Robots-Tag": "noindex, nofollow" } : undefined,
      });
      ({ scriptName, metadata } = routeConfig(raw));
      if (!SCRIPT.test(scriptName || "")) return new Response("Project not found", {
        status: 404,
        headers: isPrivateCanary ? { "X-Robots-Tag": "noindex, nofollow" } : undefined,
      });
    }

    if (!managedSlug && hostnameConfig.redirectTo && hostnameConfig.redirectTo !== hostname) {
      return Response.redirect(`https://${hostnameConfig.redirectTo}${url.pathname}${url.search}`, 301);
    }

    if (requestPath === "/_buildcustom/route-check") {
      const requestedProject = url.searchParams.get("project");
      const requestedScriptName = url.searchParams.get("scriptName");
      const project = isPrivateCandidate ? requestedProject : slug;
      const identityMatches = !isPrivateCanary || (
        (!isPrivateCandidate || (typeof project === "string" && SLUG.test(project))) &&
        (requestedProject === null || requestedProject === project) &&
        (requestedScriptName === null || requestedScriptName === scriptName)
      );
      if (!identityMatches) {
        return Response.json({ ok: false }, { status: 404, headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Robots-Tag": "noindex, nofollow",
        } });
      }
      return Response.json(
        {
          ok: true,
          project,
          ...(isPrivateCanary ? { scriptName } : {}),
          redirectTo: hostnameConfig.redirectTo,
          purpose: hostnameConfig.purpose,
          role: hostnameConfig.role,
          primaryHostname: hostnameConfig.primaryHostname,
        },
        { headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ...(isPrivateCanary ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
        } },
      );
    }

    if (requestPath === "/_buildcustom/custom-host-route-check") {
      if (isPrivateCandidate) return notFound();
      const customHostname = (url.searchParams.get("hostname") || "").toLowerCase().replace(/\.$/, "");
      const mappedRoute = /^[a-z0-9.-]+$/.test(customHostname)
        ? hostnameRoute(await env.ROUTES.get(`hostname:${customHostname}`))
        : { slug: null, redirectTo: null, purpose: null, role: null, primaryHostname: null };
      const mappedSlug = mappedRoute.slug;
      return Response.json(
        {
          ok: mappedSlug === slug,
          project: mappedSlug === slug ? slug : null,
          redirectTo: mappedSlug === slug ? mappedRoute.redirectTo : null,
          purpose: mappedSlug === slug ? mappedRoute.purpose : null,
          role: mappedSlug === slug ? mappedRoute.role : null,
          primaryHostname: mappedSlug === slug ? mappedRoute.primaryHostname : null,
        },
        { status: mappedSlug === slug ? 200 : 404, headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ...(isPrivateCanary ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
        } },
      );
    }

    if (requestPath === "/_buildcustom/preview-image") {
      if (isPrivateCandidate) return notFound();
      const image = await env.ROUTES.get(`preview:${slug}`, "arrayBuffer");
      if (!image) return new Response("Preview image not found", { status: 404 });
      return new Response(image, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (requestPath === "/robots.txt") {
      const body = isPrivateCanary || metadata.allowIndexing === false
        ? "User-agent: *\nDisallow: /\n"
        : `User-agent: *\nAllow: /\nSitemap: ${url.origin}/sitemap.xml\n`;
      return new Response(body, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          ...(isPrivateCanary ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
        },
      });
    }
    if (requestPath === "/sitemap.xml") {
      const canonical = escapeHtml(metadata.canonicalUrl || url.origin);
      const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${canonical}</loc></url></urlset>`;
      return new Response(body, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          ...(isPrivateCanary ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
        },
      });
    }

    const dispatchHeaders = new Headers(request.headers);
    dispatchHeaders.delete("X-BuildCustom-Hostname");
    dispatchHeaders.delete("X-BuildCustom-Domain-Purpose");
    dispatchHeaders.delete("X-BuildCustom-Domain-Role");
    dispatchHeaders.delete("X-BuildCustom-Primary-Hostname");
    if (!managedSlug) {
      if (!isPrivateCanary) {
        dispatchHeaders.set("X-BuildCustom-Hostname", hostname);
        if (hostnameConfig.purpose) dispatchHeaders.set("X-BuildCustom-Domain-Purpose", hostnameConfig.purpose);
        if (hostnameConfig.role) dispatchHeaders.set("X-BuildCustom-Domain-Role", hostnameConfig.role);
        if (hostnameConfig.primaryHostname) dispatchHeaders.set("X-BuildCustom-Primary-Hostname", hostnameConfig.primaryHostname);
      }
    }
    let dispatchRequest = new Request(request, { headers: dispatchHeaders });
    if (isPrivateCanary) {
      const dispatchUrl = new URL(request.url);
      dispatchUrl.pathname = requestPath;
      dispatchRequest = new Request(dispatchUrl, dispatchRequest);
    }
    let response = await env.DISPATCHER.get(scriptName).fetch(dispatchRequest);
    if (isPrivateCanary) {
      const headers = new Headers(response.headers);
      headers.set("X-Robots-Tag", "noindex, nofollow");
      const location = headers.get("Location");
      if (location) headers.set("Location", scopeRootRelativeUrl(location, privatePath.prefix));
      response = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    if (rawSourceVerification) return response;
    if (isPrivateCanary && (!response.body || request.method === "HEAD")) return response;

    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (isPrivateCanary && contentType.includes("text/css")) {
      const headers = new Headers(response.headers);
      headers.delete("Content-Length");
      return new Response(rewriteCssUrls(await response.text(), privatePath.prefix), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    if (!contentType.includes("text/html")) return response;

    const tags = metadataTags(metadata);
    if (!tags) return response;
    let rewriter = new HTMLRewriter();
    if (isPrivateCanary) {
      rewriter = rewriter
        .on("[href], [src]", scopedHtmlUrls(privatePath.prefix))
        .on("[srcset]", {
          element(element) {
            const value = element.getAttribute("srcset");
            if (value !== null) element.setAttribute("srcset", rewriteSrcset(value, privatePath.prefix));
          },
        });
    }
    if (metadata.title) rewriter = rewriter.on("title", removeElement());
    if (metadata.description) rewriter = rewriter.on('meta[name="description"]', removeElement());
    if (typeof metadata.allowIndexing === "boolean") rewriter = rewriter.on('meta[name="robots"]', removeElement());
    if (metadata.ogTitle || metadata.title) rewriter = rewriter.on('meta[property="og:title"]', removeElement());
    if (metadata.ogDescription || metadata.description) rewriter = rewriter.on('meta[property="og:description"]', removeElement());
    rewriter = rewriter.on('meta[property="og:image"]', removeElement());
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