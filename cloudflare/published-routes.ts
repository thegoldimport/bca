type RoutesEnv = {
  STAGING_ROUTES: KVNamespace;
  ENVIRONMENT: string;
  STAGING_ROUTE_KV_ID: string;
  CONTROL_PLANE_ROUTE_KV_ID?: string;
};

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const scriptPattern = /^[a-z0-9_][a-z0-9-_]*$/;

export function assertRouteBinding(env: RoutesEnv): void {
  if (env.ENVIRONMENT === "staging" && env.STAGING_ROUTE_KV_ID !== "e5e119fa2abc4c26a8c027e0d8a8d82c") {
    throw new Error("ISOLATED_ROUTE_KV_REQUIRED");
  }
  if (env.ENVIRONMENT === "production" && env.CONTROL_PLANE_ROUTE_KV_ID !== "d6e19823343e46d3965ad167775afb30") {
    throw new Error("PRODUCTION_ROUTE_KV_REQUIRED");
  }
  if (!["staging", "production"].includes(env.ENVIRONMENT)) throw new Error("ROUTE_ENVIRONMENT_REQUIRED");
}

export function deploymentScriptName(...urls: Array<string | undefined | null>): string {
  for (const value of urls) {
    if (!value) continue;
    try {
      const match = new URL(value).pathname.match(/^\/deployed\/([^/]+)(?:\/|$)/);
      const script = match ? decodeURIComponent(match[1]) : "";
      if (scriptPattern.test(script)) return script;
    } catch { /* Try the next URL. */ }
  }
  throw new Error("The VibeSDK deployment has no routable script name");
}

export function routeMetadata(seo: any): Record<string, unknown> {
  if (!seo) return {};
  return {
    title: seo.meta_title, description: seo.meta_description, canonicalUrl: seo.canonical_url,
    ogTitle: seo.og_title, ogDescription: seo.og_description, ogImageUrl: seo.og_image_url,
    faviconData: seo.favicon_data, allowIndexing: Boolean(seo.allow_indexing), schemaJson: seo.schema_json,
  };
}

export async function writePublishedRoute(env: RoutesEnv, slug: string, scriptName: string, metadata: Record<string, unknown>): Promise<void> {
  assertRouteBinding(env);
  if (!slugPattern.test(slug) || !scriptPattern.test(scriptName)) throw new Error("Invalid published route identifier");
  await env.STAGING_ROUTES.put(slug, JSON.stringify({ scriptName, metadata }));
}

/** The published route is refreshed only when its persisted script still owns the KV key. */
export async function refreshPublishedMetadata(env: RoutesEnv, slug: string, scriptName: string, metadata: Record<string, unknown>): Promise<void> {
  assertRouteBinding(env);
  if (!slugPattern.test(slug) || !scriptPattern.test(scriptName)) throw new Error("Invalid published route identifier");
  const existing = await env.STAGING_ROUTES.get(slug);
  if (!existing) throw new Error("The published route is missing; publish again before updating metadata");
  let route: any;
  try { route = JSON.parse(existing); } catch { throw new Error("The published route has an unknown format"); }
  if (route?.scriptName !== scriptName) throw new Error("The published route belongs to another deployment");
  await writePublishedRoute(env, slug, scriptName, metadata);
}

/** Remove only keys belonging to this project, restoring all KV values if D1 deletion fails. */
export async function deleteProjectWithRoutes(env: RoutesEnv & { DB: D1Database }, projectId: number): Promise<void> {
  assertRouteBinding(env);
  const link = await env.DB.prepare("SELECT subdomain_slug,deployment_script_name,custom_domain_cloudflare_id,custom_domain_secondary_cloudflare_id FROM runtime_project_links WHERE project_id=?").bind(projectId).first<{subdomain_slug:string|null;deployment_script_name:string|null;custom_domain_cloudflare_id:string|null;custom_domain_secondary_cloudflare_id:string|null}>();
  const claims = (await env.DB.prepare("SELECT hostname,cloudflare_id FROM runtime_custom_domain_claims WHERE project_id=?").bind(projectId).all<{hostname:string;cloudflare_id:string|null}>()).results;
  // Do not orphan an actual Cloudflare for SaaS hostname. A separately verified hostname
  // deletion must precede the D1 delete when a live Cloudflare ID is present.
  if (claims.some(claim => claim.cloudflare_id) || link?.custom_domain_cloudflare_id || link?.custom_domain_secondary_cloudflare_id) {
    throw new Error("Remove verified Cloudflare custom hostnames before deleting this project");
  }
  const slug = link?.subdomain_slug;
  if (slug && !slugPattern.test(slug)) throw new Error("Invalid stored publishing address; route cleanup is required before deleting this project");
  const keys = [
    ...(slug && slugPattern.test(slug) ? [slug, `preview:${slug}`] : []),
    ...(env.ENVIRONMENT === "staging" ? [`pending-deployment:${projectId}`] : []),
    ...claims.map(claim => `hostname:${claim.hostname}`),
  ];
  const saved = new Map<string, string | null>();
  try {
    for (const key of keys) {
      const value = await env.STAGING_ROUTES.get(key);
      if (value !== null && key === slug) {
        let script: unknown;
        try { script = JSON.parse(value).scriptName; } catch { /* Refuse unknown routes. */ }
        if (!link?.deployment_script_name || script !== link.deployment_script_name) throw new Error("Published route does not belong to this project");
      }
      if (value !== null && key.startsWith("hostname:")) {
        let mappedSlug: unknown = value;
        try { mappedSlug = JSON.parse(value).slug; } catch { /* Legacy route value is a bare slug. */ }
        if (!slug || mappedSlug !== slug) throw new Error("Hostname route does not belong to this project");
      }
      saved.set(key, value);
      if (value !== null) await env.STAGING_ROUTES.delete(key);
    }
    const deleted = await env.DB.prepare("DELETE FROM projects WHERE id=?").bind(projectId).run();
    if (!deleted.meta.changes) throw new Error("Project not found");
  } catch (error) {
    const restore = await Promise.allSettled([...saved].map(([key, value]) =>
      value === null ? Promise.resolve() : env.STAGING_ROUTES.put(key, value)));
    if (restore.some(result => result.status === "rejected")) {
      throw new Error("Project deletion failed and route restoration also failed");
    }
    throw error;
  }
}