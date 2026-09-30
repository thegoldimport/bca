/**
 * A preview can share its host with the product page. Attribute a request to
 * the generated app primarily by its initiating frame; the exact scoped route
 * also identifies the initial document and resources without frame metadata.
 * Off-route APIs and external resources remain in scope when the preview
 * frame initiated them.
 */
export function isPreviewAuditRequest(previewUrl, requestUrl, initiatorFrameUrl = "") {
  const preview = new URL(previewUrl);
  const prefix = preview.pathname.endsWith("/") ? preview.pathname : `${preview.pathname}/`;
  const matchesPreviewRoute = value => {
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.origin === preview.origin
        && (url.pathname === prefix.slice(0, -1) || url.pathname.startsWith(prefix));
    } catch {
      return false;
    }
  };
  return matchesPreviewRoute(initiatorFrameUrl) || matchesPreviewRoute(requestUrl);
}

// A script tag may be loaded by the browser as a script resource, or fetched
// through XHR/fetch by a source transformer before that transformer executes it.
export function hasReadableScriptSource(requests, sourceUrl) {
  return requests.some(item => (item.url === sourceUrl || item.redirectSourceUrls?.includes(sourceUrl))
    && ["script", "xhr", "fetch"].includes(item.resourceType)
    && item.status >= 200 && item.status < 400
    && item.responseBodyReadable === true);
}

export function safeObservedUrl(value) {
  const url = new URL(value);
  if (url.username) url.username = "[redacted]";
  if (url.password) url.password = "[redacted]";
  for (const name of new Set(url.searchParams.keys())) {
    // The runtime's opaque preview capability is carried in the short "t"
    // parameter, not in a parameter literally named "token".
    if (name === "t" || /token|secret|authorization|cookie|csrf|password|email|api.?key|session/i.test(name)) {
      url.searchParams.set(name, "[redacted]");
    }
  }
  return url.href;
}