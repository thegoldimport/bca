import { RuntimeAdapterError } from "./runtime-adapter";

const DEFAULT_APPS_DOMAIN = "apps.buildcustom.ai";
const SCRIPT_NAME_PATTERN = /^[a-z0-9_][a-z0-9-_]*$/;

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

export async function setPublishedProjectRoute(slug: string, scriptName: string) {
  if (!SCRIPT_NAME_PATTERN.test(scriptName)) {
    throw new RuntimeAdapterError(
      "The deployment returned an invalid project identifier.",
      "RUNTIME_UPSTREAM_ERROR",
    );
  }
  await writeRoute(slug, "PUT", scriptName);
}

export async function removePublishedProjectRoute(slug: string) {
  await writeRoute(slug, "DELETE");
}