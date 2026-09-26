// Lab-only public gateway for scripts published in the isolated VibeSDK
// Workers for Platforms dispatch namespace. Editor access stays on the lab
// VibeSDK Worker and is not exposed by this gateway.
const HOST_SUFFIX = ".lab-apps.buildcustom.ai";
const VALID_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const VALID_SCRIPT_NAME = /^[a-z0-9_][a-z0-9_-]{0,62}$/;
const RESERVED_SLUGS = new Set(["admin", "api", "app", "apps", "editor", "gateway", "www"]);

function routeScriptName(raw) {
  let mapping;
  try {
    mapping = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return null;
  if (typeof mapping.scriptName !== "string" || !VALID_SCRIPT_NAME.test(mapping.scriptName)) return null;
  if (!mapping.metadata || typeof mapping.metadata !== "object" || Array.isArray(mapping.metadata)) return null;
  return { scriptName: mapping.scriptName, metadata: mapping.metadata };
}

export default {
  async fetch(request, env) {
    const hostname = new URL(request.url).hostname.toLowerCase();
    if (!hostname.endsWith(HOST_SUFFIX)) {
      return new Response("Not found", { status: 404 });
    }

    const slug = hostname.slice(0, -HOST_SUFFIX.length);
    if (!VALID_SLUG.test(slug) || RESERVED_SLUGS.has(slug)) {
      return new Response("Not found", { status: 404 });
    }

    const rawMapping = await env.ROUTES.get(slug);
    const route = rawMapping === null ? null : routeScriptName(rawMapping);
    const scriptName = route?.scriptName ?? (rawMapping === null ? slug : null);
    if (!scriptName) {
      return new Response("Project not found", { status: 404 });
    }

    const script = env.DISPATCHER.get(scriptName);
    return script.fetch(request);
  },
};