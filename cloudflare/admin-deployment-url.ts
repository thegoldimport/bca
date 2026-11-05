const MANAGED_APP_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED_MANAGED_APP_SLUGS = new Set([
  "www", "api", "app", "apps", "admin", "billing", "support", "status",
  "docs", "mail", "customers", "editor", "gateway",
]);
const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type AdminCustomDomain = {
  hostname: unknown;
  status: unknown;
  sslStatus: unknown;
  isPrimary?: boolean;
};

function normalizedHostname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  if (hostname.length > 253 || !HOSTNAME.test(hostname)) return null;
  return hostname;
}

function isLiveCustomDomain(domain: AdminCustomDomain): boolean {
  // A provider SSL state alone is insufficient. Only use a custom hostname
  // after the product's end-to-end check has marked it Live.
  const state = typeof domain.status === "string" ? domain.status.trim().toLowerCase() : "";
  const sslState = typeof domain.sslStatus === "string" ? domain.sslStatus.trim().toLowerCase() : "";
  return state === "live" && (sslState === "active" || sslState === "live")
    && normalizedHostname(domain.hostname) !== null;
}

export function safeAdminDeploymentUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

export function validManagedAppSlug(value: unknown): value is string {
  return typeof value === "string"
    && MANAGED_APP_SLUG.test(value)
    && !RESERVED_MANAGED_APP_SLUGS.has(value);
}

export function adminDeploymentLinks(args: {
  storedUrl: unknown;
  slug: unknown;
  publicAppsEnabled: boolean;
  customDomains?: AdminCustomDomain[];
}): { deploymentUrl: string | null; diagnosticUrl: string | null } {
  const diagnosticUrl = safeAdminDeploymentUrl(args.storedUrl);
  if (!diagnosticUrl) return { deploymentUrl: null, diagnosticUrl: null };

  const liveCustomDomain = (args.customDomains || [])
    .filter((domain) => domain.isPrimary === true && isLiveCustomDomain(domain))
    .sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)))[0];
  const customHostname = liveCustomDomain
    ? normalizedHostname(liveCustomDomain.hostname)
    : null;
  if (customHostname) {
    return { deploymentUrl: `https://${customHostname}/`, diagnosticUrl };
  }

  if (args.publicAppsEnabled && validManagedAppSlug(args.slug)) {
    return {
      deploymentUrl: `https://${args.slug}.apps.buildcustom.ai/`,
      diagnosticUrl,
    };
  }

  return { deploymentUrl: null, diagnosticUrl };
}
