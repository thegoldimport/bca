import { RuntimeAdapterError } from "./runtime-adapter";

const DEFAULT_APPS_DOMAIN = "apps.buildcustom.ai";
const SCRIPT_NAME_PATTERN = /^[a-z0-9_][a-z0-9-_]*$/;

export type PublishedRouteMetadata = {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImageUrl?: string;
  faviconData?: string;
  allowIndexing?: boolean;
  schemaJson?: string;
};

function routeConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const namespaceId = process.env.CLOUDFLARE_ROUTES_KV_NAMESPACE_ID?.trim();
  const apiToken = process.env.WORKERSKV;
  if (!accountId || !namespaceId || !apiToken) {
    throw new RuntimeAdapterError(
      "Managed publishing routes are not configured.",
      "RUNTIME_UNCONFIGURED",
    );
  }
  return { accountId, namespaceId, apiToken };
}

async function writeRoute(slug: string, method: "PUT" | "DELETE", scriptName?: string) {
  const { accountId, namespaceId, apiToken } = routeConfig();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(slug)}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        ...(method === "PUT" ? { "Content-Type": "text/plain" } : {}),
      },
      ...(method === "PUT" ? { body: scriptName } : {}),
    },
  );
  if (!response.ok) {
    throw new RuntimeAdapterError(
      "The managed project address could not be updated. Try publishing again.",
      "RUNTIME_UPSTREAM_ERROR",
    );
  }
}

export async function setPublishedCustomHostname(
  hostname: string,
  slug: string,
  redirectTo?: string,
  context?: { purpose?: string; role?: string; primaryHostname?: string | null },
) {
  await writeRoute(
    `hostname:${hostname}`,
    "PUT",
    redirectTo || context
      ? JSON.stringify({ slug, redirectTo: redirectTo || null, ...(context || {}) })
      : slug,
  );
}

export async function removePublishedCustomHostname(hostname: string) {
  await writeRoute(`hostname:${hostname}`, "DELETE");
}

export async function setPublishedProjectPreviewImage(slug: string, data: string) {
  const match = data.match(/^data:image\/jpeg;base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new RuntimeAdapterError("The project preview image is invalid.", "RUNTIME_UPSTREAM_ERROR");
  const { accountId, namespaceId, apiToken } = routeConfig();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(`preview:${slug}`)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: Buffer.from(match[1], "base64"),
    },
  );
  if (!response.ok) {
    throw new RuntimeAdapterError("The project preview image could not be published.", "RUNTIME_UPSTREAM_ERROR");
  }
}

export async function getPublishedProjectRouteValue(slug: string) {
  const { accountId, namespaceId, apiToken } = routeConfig();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(slug)}`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new RuntimeAdapterError(
      "The managed project address could not be read. Try again.",
      "RUNTIME_UPSTREAM_ERROR",
    );
  }
  return response.text();
}

export async function restorePublishedProjectRouteValue(slug: string, value: string) {
  await writeRoute(slug, "PUT", value);
}

export function publishedProjectUrl(slug: string) {
  const domain = process.env.BUILDCUSTOM_APPS_DOMAIN?.trim() || DEFAULT_APPS_DOMAIN;
  return `https://${slug}.${domain}`;
}

export function deploymentScriptName(...candidateUrls: Array<string | undefined>) {
  for (const candidate of candidateUrls) {
    if (!candidate) continue;
    try {
      const match = new URL(candidate).pathname.match(/^\/deployed\/([^/]+)(?:\/|$)/);
      const scriptName = match ? decodeURIComponent(match[1]) : "";
      if (SCRIPT_NAME_PATTERN.test(scriptName)) return scriptName;
    } catch {
      // Try the next deployment URL.
    }
  }
  throw new RuntimeAdapterError(
    "The deployment completed without a routable project identifier.",
    "RUNTIME_UPSTREAM_ERROR",
  );
}

export async function setPublishedProjectRoute(slug: string, scriptName: string, metadata?: PublishedRouteMetadata) {
  if (!SCRIPT_NAME_PATTERN.test(scriptName)) {
    throw new RuntimeAdapterError(
      "The deployment returned an invalid project identifier.",
      "RUNTIME_UPSTREAM_ERROR",
    );
  }
  await writeRoute(slug, "PUT", JSON.stringify({ scriptName, metadata: metadata || {} }));
}

export async function removePublishedProjectRoute(slug: string) {
  await writeRoute(slug, "DELETE");
}