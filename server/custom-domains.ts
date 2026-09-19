import { RuntimeAdapterError } from "./runtime-adapter";

const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export type DomainLifecycle = "pending_dns" | "verifying" | "ssl_provisioning" | "live" | "error";
export type DomainDnsRecord = { type: string; name: string; value: string };

type CloudflareCustomHostname = {
  id?: string;
  hostname?: string;
  status?: string;
  verification_errors?: string[];
  ownership_verification?: { type?: string; name?: string; value?: string };
  ssl?: {
    status?: string;
    validation_records?: Array<{ status?: string; txt_name?: string; txt_value?: string; cname_name?: string; cname_target?: string }>;
    validation_errors?: Array<{ message?: string }>;
  };
};

function config() {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const cnameTarget = process.env.CLOUDFLARE_CUSTOM_HOSTNAME_TARGET?.trim()?.toLowerCase();
  if (!zoneId || !apiToken || !cnameTarget) {
    throw new RuntimeAdapterError(
      "Custom domains are not configured. Cloudflare for SaaS, a fallback origin, and its CNAME target must be enabled first.",
      "RUNTIME_UNCONFIGURED",
    );
  }
  return { zoneId, apiToken, cnameTarget };
}

async function request(path: string, init?: RequestInit) {
  const { zoneId, apiToken } = config();
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok || body.success === false) {
    const upstream = body.errors?.map((error: any) => error.message).filter(Boolean).join(" ") || "";
    const quotaMissing = body.errors?.some((error: any) => error.code === 1404 || error.code === 1456);
    throw new RuntimeAdapterError(
      quotaMissing
        ? "Cloudflare for SaaS is not enabled for the BuildCustom zone yet."
        : upstream || "Cloudflare could not update this custom domain.",
      quotaMissing ? "RUNTIME_UNCONFIGURED" : "RUNTIME_UPSTREAM_ERROR",
      quotaMissing ? 503 : response.status >= 400 && response.status < 500 ? response.status : 502,
    );
  }
  return body.result as CloudflareCustomHostname;
}

export function normalizeCustomDomain(value: string) {
  const hostname = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.$/, "").replace(/\/.*$/, "");
  if (!HOSTNAME_PATTERN.test(hostname)) {
    throw new RuntimeAdapterError("Enter a valid domain such as app.example.com.", "RUNTIME_UPSTREAM_ERROR", 400);
  }
  if (hostname.endsWith(".apps.buildcustom.ai") || hostname === "apps.buildcustom.ai" || hostname === "buildcustom.ai") {
    throw new RuntimeAdapterError("Use a customer-owned domain, not a BuildCustom address.", "RUNTIME_UPSTREAM_ERROR", 400);
  }
  return hostname;
}

export function domainLifecycle(hostname: CloudflareCustomHostname): DomainLifecycle {
  const hostStatus = hostname.status || "pending";
  const sslStatus = hostname.ssl?.status || "pending_validation";
  if (hostStatus === "active" && sslStatus === "active") return "live";
  if (["blocked", "moved", "deleted"].includes(hostStatus) || ["expired", "deleted"].includes(sslStatus)) return "error";
  if (hostStatus === "pending") return "pending_dns";
  if (sslStatus === "pending_validation") return "verifying";
  if (["initializing", "pending_issuance", "pending_deployment"].includes(sslStatus)) return "ssl_provisioning";
  return hostname.verification_errors?.length || hostname.ssl?.validation_errors?.length ? "error" : "verifying";
}

export function customDomainRecords(hostname: CloudflareCustomHostname): DomainDnsRecord[] {
  const { cnameTarget } = config();
  const records: DomainDnsRecord[] = [{ type: "CNAME", name: hostname.hostname || "", value: cnameTarget }];
  const ownership = hostname.ownership_verification;
  if (ownership?.name && ownership.value) {
    records.push({ type: (ownership.type || "TXT").toUpperCase(), name: ownership.name, value: ownership.value });
  }
  for (const validation of hostname.ssl?.validation_records || []) {
    if (validation.txt_name && validation.txt_value) {
      records.push({ type: "TXT", name: validation.txt_name, value: validation.txt_value });
    } else if (validation.cname_name && validation.cname_target) {
      records.push({ type: "CNAME", name: validation.cname_name, value: validation.cname_target });
    }
  }
  return records.filter((record, index, all) => all.findIndex((item) => item.type === record.type && item.name === record.name && item.value === record.value) === index);
}

export function customDomainError(hostname: CloudflareCustomHostname) {
  return [
    ...(hostname.verification_errors || []),
    ...(hostname.ssl?.validation_errors || []).map((error) => error.message || ""),
  ].filter(Boolean).join(" ") || null;
}

export async function createCustomHostname(hostname: string) {
  return request("/custom_hostnames", {
    method: "POST",
    body: JSON.stringify({
      hostname,
      ssl: {
        method: "txt",
        type: "dv",
        bundle_method: "ubiquitous",
        wildcard: false,
        settings: { min_tls_version: "1.2", tls_1_3: "on", http2: "on" },
      },
    }),
  });
}

export async function getCustomHostname(id: string) {
  return request(`/custom_hostnames/${encodeURIComponent(id)}`);
}

export async function deleteCustomHostname(id: string) {
  await request(`/custom_hostnames/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function customDomainUpdate(hostname: CloudflareCustomHostname) {
  return {
    customDomainCloudflareId: hostname.id || null,
    customDomainStatus: domainLifecycle(hostname),
    customDomainSslStatus: hostname.ssl?.status || null,
    customDomainDnsRecords: customDomainRecords(hostname),
    customDomainError: customDomainError(hostname),
    customDomainCheckedAt: new Date(),
  };
}