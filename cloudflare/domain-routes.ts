/**
 * Cloudflare control-plane domain routes.
 *
 * This module deliberately contains no Cloudflare account API client.  The
 * staging control plane may inspect/import DNS metadata and save wizard state,
 * but it must never turn a broad production account token into a staging
 * hostname provisioner.
 */

type DomainEnv = {
  DB: D1Database;
  STAGING_ROUTES: KVNamespace;
  ENVIRONMENT?: string;
  STAGING_CUSTOM_DOMAIN_SUFFIX?: string;
  STAGING_ALLOWED_DOMAIN_SUFFIXES?: string;
};

type Project = { id: number; user_id?: string; userId?: string; [key: string]: unknown };

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, { headers: { "Cache-Control": "no-store", ...init.headers }, ...init });

const error = (status: number, code: string, message: string) =>
  json({ code, message }, { status });

const cleanHost = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.$/, "").split("/")[0];
};

function validHostname(hostname: string): boolean {
  return hostname.length <= 253
    && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(hostname)
    && !hostname.includes("..");
}

function suffixes(env: DomainEnv): string[] {
  return (env.STAGING_ALLOWED_DOMAIN_SUFFIXES || env.STAGING_CUSTOM_DOMAIN_SUFFIX || "")
    .split(",")
    .map((suffix) => cleanHost(suffix).replace(/^\./, ""))
    .filter(Boolean);
}

export function stagingHostnameAllowed(hostname: string, env: DomainEnv): boolean {
  const allowed = suffixes(env);
  return validHostname(hostname)
    && !hostname.endsWith(".apps.buildcustom.ai")
    && hostname !== "buildcustom.ai"
    && allowed.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function hostnameKind(hostname: string): "apex" | "www" | "subdomain" {
  const labels = hostname.split(".");
  if (labels.length === 2) return "apex";
  if (labels.length === 3 && labels[0] === "www") return "www";
  return "subdomain";
}

function parseJson(value: unknown, fallback: any = {}) {
  if (typeof value !== "string") return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function serializeClaim(row: any) {
  if (!row) return null;
  return {
    hostname: row.hostname,
    projectId: row.project_id,
    role: row.role,
    createdAt: row.created_at,
    source: row.source,
    purpose: row.purpose,
    hostnameKind: row.hostname_kind,
    isPrimary: Boolean(row.is_primary),
    redirectTo: row.redirect_to,
    cloudflareId: row.cloudflare_id,
    status: row.status,
    sslStatus: row.ssl_status,
    dnsRecords: parseJson(row.dns_records, []),
    error: row.error,
    checkedAt: row.checked_at,
    migrationState: parseJson(row.migration_state, {}),
    updatedAt: row.updated_at,
  };
}

function serializeLink(row: any) {
  if (!row) return null;
  return {
    customDomain: row.custom_domain,
    customOrigin: row.custom_origin,
    customDomainStatus: row.custom_domain_status,
    customDomainSslStatus: row.custom_domain_ssl_status,
    customDomainDnsRecords: parseJson(row.custom_domain_dns_records, []),
    customDomainError: row.custom_domain_error,
    customDomainCheckedAt: row.custom_domain_checked_at,
    customDomainSecondary: row.custom_domain_secondary,
    customDomainSecondaryStatus: row.custom_domain_secondary_status,
    customDomainSecondarySslStatus: row.custom_domain_secondary_ssl_status,
    customDomainSecondaryDnsRecords: parseJson(row.custom_domain_secondary_dns_records, []),
    customDomainMigrationState: parseJson(row.custom_domain_migration_state, {}),
    subdomainSlug: row.subdomain_slug,
  };
}

function response(projectId: number, link: any, claims: any[]) {
  return {
    ...(serializeLink(link) || {}),
    domains: claims.map(serializeClaim),
    projectId,
  };
}

async function getLink(env: DomainEnv, projectId: number) {
  return env.DB.prepare("SELECT * FROM runtime_project_links WHERE project_id=?")
    .bind(projectId).first<any>();
}

async function getClaims(env: DomainEnv, projectId: number) {
  return (await env.DB.prepare(
    "SELECT * FROM runtime_custom_domain_claims WHERE project_id=? ORDER BY is_primary DESC, hostname ASC",
  ).bind(projectId).all()).results as any[];
}

async function saveMigration(env: DomainEnv, projectId: number, migration: Record<string, unknown>) {
  await env.DB.prepare(
    "INSERT INTO runtime_project_links(project_id,custom_domain_migration_state) VALUES(?,?) " +
    "ON CONFLICT(project_id) DO UPDATE SET custom_domain_migration_state=?,updated_at=datetime('now')",
  ).bind(projectId, JSON.stringify(migration), JSON.stringify(migration)).run();
}

function recordsFromImport(input: unknown, hostname: string): Array<{ type: string; name: string; value: string; proxied: boolean | null }> {
  if (typeof input !== "string" || input.length > 1_000_000) throw new Error("DNS import is missing or too large.");
  const parsed = parseJson(input, null);
  const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.result) ? parsed.result : null;
  if (!source) throw new Error("DNS import must be a Cloudflare JSON export.");
  return source.map((record: any) => {
    const type = String(record.type || "").toUpperCase();
    const name = cleanHost(record.name || hostname);
    const value = String(record.content ?? record.value ?? "").trim();
    if (!/^[A-Z0-9]+$/.test(type) || !name || !value) throw new Error("DNS import contains an invalid record.");
    return { type, name, value, proxied: typeof record.proxied === "boolean" ? record.proxied : null };
  });
}

function compareRecords(publicRecords: any[], imported: any[]) {
  const key = (record: any) => `${record.type}|${record.name}|${record.value}`.toLowerCase();
  const publicKeys = new Set(publicRecords.map(key));
  const importedKeys = new Set(imported.map(key));
  const matched = imported.filter((record) => publicKeys.has(key(record)));
  const missing = publicRecords.filter((record) => !importedKeys.has(key(record)));
  const importOnly = imported.filter((record) => !publicKeys.has(key(record)));
  return {
    importedRecords: imported,
    publicFindings: [
      ...matched.map((record) => ({ ...record, status: "matched", importedValues: [record.value] })),
      ...missing.map((record) => ({ ...record, status: "missing", importedValues: [] })),
    ],
    importOnlyRecords: importOnly,
    proxiedServiceRecords: imported.filter((record) => record.proxied === true),
    unverifiedServiceRecords: [],
    counts: {
      matched: matched.length, missing: missing.length, changed: 0,
      importOnly: importOnly.length, proxiedServices: imported.filter((r) => r.proxied === true).length,
      unverifiedServices: 0,
    },
  };
}

function mutationBlocked(operation: string) {
  return error(
    503,
    "STAGING_CUSTOM_HOSTNAME_UNAVAILABLE",
    `Cloudflare for SaaS hostname ${operation} is disabled in isolated staging. Configure a dedicated staging zone and token before enabling this operation.`,
  );
}

/**
 * Handles the domain portion of /api/projects/:id/runtime/*.
 * The worker must authenticate and verify project ownership before invoking
 * this function. `project` is consequently trusted only for ownership, not
 * for hostname or resource authorization.
 */
export async function handleDomainRoute(args: {
  request: Request;
  env: DomainEnv;
  url: URL;
  input: Record<string, unknown>;
  user: unknown;
  project: Project;
  operation: string;
}): Promise<Response | null> {
  const { request, env, input, project, operation } = args;
  const id = Number(project.id);
  if (!Number.isInteger(id) || id < 1) return error(400, "INVALID_PROJECT", "A valid project is required.");
  const hostname = cleanHost(input.hostname ?? args.url.searchParams.get("hostname"));
  if (hostname && !stagingHostnameAllowed(hostname, env)) {
    return error(400, "STAGING_HOSTNAME_NOT_ALLOWED", "This hostname is outside the isolated staging domain allowlist.");
  }

  if (operation === "domains" && request.method === "GET") {
    return json((await getClaims(env, id)).map(serializeClaim));
  }
  if (operation === "custom-domain" && request.method === "GET") {
    return json(response(id, await getLink(env, id), await getClaims(env, id)));
  }
  if (operation === "application-domain" && request.method === "GET") {
    return json(response(id, await getLink(env, id), await getClaims(env, id)));
  }

  if (operation === "custom-domain/inspect" && request.method === "POST") {
    if (!hostname) return error(400, "INVALID_HOSTNAME", "A hostname is required.");
    const now = new Date().toISOString();
    const prior = parseJson((await getLink(env, id))?.custom_domain_migration_state, {});
    const migration = {
      ...(prior?.hostname === hostname ? prior : {}),
      hostname, hostnameKind: hostnameKind(hostname), dnsInventory: [],
      dnsScannedAt: now, dnsComplete: false,
      warnings: ["Public DNS inspection is unavailable in isolated staging; provide a Cloudflare export to compare."],
      emailRiskFlags: [], replacementPlan: [], proposedRecords: [],
    };
    await saveMigration(env, id, migration);
    return json({ hostname, kind: migration.hostnameKind, registrableDomain: hostname.split(".").slice(-2).join("."), records: [], scannedAt: now, complete: false, warnings: migration.warnings, migration });
  }
  if (operation === "custom-domain/import-dns" && request.method === "POST") {
    const link = await getLink(env, id);
    const prior = parseJson(link?.custom_domain_migration_state, {});
    if (!hostname || prior.hostname !== hostname || !Array.isArray(prior.dnsInventory) || !prior.dnsScannedAt) {
      return error(409, "PUBLIC_DNS_SCAN_REQUIRED", "Inspect the existing public DNS records before comparing the Cloudflare import.");
    }
    try {
      const imported = recordsFromImport(input.content, hostname);
      const comparison = compareRecords(prior.dnsInventory, imported);
      const migration = { ...prior, cloudflareImportComparison: comparison, cloudflareImportCheckedAt: new Date().toISOString(), cloudflareImportFilename: typeof input.filename === "string" ? input.filename.slice(0, 200) : null };
      await saveMigration(env, id, migration);
      return json({ hostname, comparison, migration });
    } catch (e) {
      return error(400, "INVALID_DNS_IMPORT", e instanceof Error ? e.message : "Invalid DNS import.");
    }
  }
  if (operation === "custom-domain/configure" && request.method === "POST") {
    if (!hostname) return error(400, "INVALID_HOSTNAME", "A hostname is required.");
    const strategy = input.strategy === "customer_cloudflare" || input.strategy === "current_dns" ? input.strategy : null;
    if (!strategy) return error(400, "INVALID_DNS_STRATEGY", "Choose whether to keep current DNS or use customer-owned Cloudflare DNS.");
    const link = await getLink(env, id);
    if (!link?.deployment_url || !link?.subdomain_slug) return error(409, "PROJECT_NOT_PUBLISHED", "Publish this project before connecting a custom domain.");
    const prior = parseJson(link.custom_domain_migration_state, {});
    const migration = {
      ...prior, hostname, inspectedHostname: hostname, hostnameKind: hostnameKind(hostname),
      registrableDomain: hostname.split(".").slice(-2).join("."), strategy,
      ...(input.acknowledged === true ? { acknowledgedAt: new Date().toISOString() } : {}),
      lifecycleLabel: "Getting Started",
    };
    await saveMigration(env, id, migration);
    return json(response(id, await getLink(env, id), await getClaims(env, id)));
  }

  if (request.method === "POST" && ["custom-domain", "custom-domain/refresh", "application-domain", "application-domain/refresh"].includes(operation)) {
    return mutationBlocked(operation);
  }
  if (request.method === "DELETE" && ["custom-domain", "application-domain"].includes(operation)) {
    return mutationBlocked(operation);
  }
  return null;
}