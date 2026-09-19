import { RuntimeAdapterError } from "./runtime-adapter";
import { promises as dns } from "node:dns";
import { domainToASCII } from "node:url";
import { getDomain } from "tldts";

const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export type DomainLifecycle = "pending_dns" | "verifying" | "ssl_provisioning" | "live" | "error";
export type DomainDnsRecord = { type: string; name: string; value: string };
export type HostnameKind = "apex" | "www" | "subdomain";
export type DnsInventoryRecord = { type: string; name: string; value: string };

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

async function request(path: string, init?: RequestInit, allowNotFound = false) {
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
  if (allowNotFound && response.status === 404) return null;
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
  const input = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.$/, "").replace(/\/.*$/, "");
  const hostname = domainToASCII(input);
  if (!HOSTNAME_PATTERN.test(hostname)) {
    throw new RuntimeAdapterError("Enter a valid domain such as app.example.com.", "RUNTIME_UPSTREAM_ERROR", 400);
  }
  if (hostname.endsWith(".apps.buildcustom.ai") || hostname === "apps.buildcustom.ai" || hostname === "buildcustom.ai") {
    throw new RuntimeAdapterError("Use a customer-owned domain, not a BuildCustom address.", "RUNTIME_UPSTREAM_ERROR", 400);
  }
  return hostname;
}

/** Classifies against the registrable domain without allowing a customer host to masquerade as apex. */
export function classifyHostname(value: string): { hostname: string; kind: HostnameKind; registrableDomain: string } {
  const hostname = normalizeCustomDomain(value);
  const registrable = getDomain(hostname, { allowPrivateDomains: true });
  if (!registrable) {
    throw new RuntimeAdapterError("Enter a registrable customer-owned domain.", "RUNTIME_UPSTREAM_ERROR", 400);
  }
  const kind: HostnameKind = hostname === registrable ? "apex" : hostname === `www.${registrable}` ? "www" : "subdomain";
  return { hostname, kind, registrableDomain: registrable };
}

async function resolve(type: string, name: string): Promise<string[]> {
  try {
    if (type === "A") return await dns.resolve4(name);
    if (type === "AAAA") return await dns.resolve6(name);
    if (type === "CNAME") return await dns.resolveCname(name);
    if (type === "MX") return (await dns.resolveMx(name)).map((r) => `${r.priority} ${r.exchange}`);
    if (type === "TXT") return (await dns.resolveTxt(name)).map((r) => r.join(""));
    if (type === "NS") return await dns.resolveNs(name);
    if (type === "CAA") return (await dns.resolveCaa(name)).map((r) => JSON.stringify(r));
    if (type === "SRV") return (await dns.resolveSrv(name)).map((r) => `${r.priority} ${r.weight} ${r.port} ${r.name}`);
  } catch { /* NXDOMAIN and unavailable record types are inventory facts, not failures. */ }
  return [];
}

/** Read-only public DNS discovery. It deliberately reports incompleteness. */
export async function inspectPublicDns(value: string) {
  const classification = classifyHostname(value);
  const names = new Set([classification.registrableDomain, classification.hostname,
    `www.${classification.registrableDomain}`, `mail.${classification.registrableDomain}`,
    `autodiscover.${classification.registrableDomain}`, `webmail.${classification.registrableDomain}`,
    `_dmarc.${classification.registrableDomain}`, `default._domainkey.${classification.registrableDomain}`]);
  const types = ["A", "AAAA", "CNAME", "MX", "TXT", "CAA", "SRV", "NS"];
  const records: DnsInventoryRecord[] = [];
  await Promise.all(Array.from(names).flatMap((name) => types.map(async (type) => {
    for (const result of await resolve(type, name)) records.push({ type, name, value: result.replace(/\.$/, "") });
  })));
  const emailRecords = records.filter((r) => ["MX", "TXT"].includes(r.type) &&
    (r.type === "MX" || /spf|dkim|dmarc|domainkey/i.test(r.value) || /_dmarc|_domainkey/i.test(r.name)));
  return {
    ...classification,
    records: records.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type)),
    scannedAt: new Date().toISOString(),
    complete: false,
    warnings: ["Public DNS cannot enumerate private records, arbitrary DKIM selectors, or the complete provider zone. Compare this scan with your DNS provider before changing nameservers."],
    emailRiskFlags: Array.from(new Set(emailRecords.map((r) => r.type === "MX" ? "mail-routing" : /spf/i.test(r.value) ? "spf" : /dmarc/i.test(r.name) ? "dmarc" : /dkim|domainkey/i.test(r.name) ? "dkim" : "email-txt"))),
  };
}

export function validateExpectedNameservers(values: unknown): string[] {
  if (!Array.isArray(values) || values.length !== 2) throw new RuntimeAdapterError("Enter the two Cloudflare nameservers assigned to your zone.", "RUNTIME_UPSTREAM_ERROR", 400);
  const normalized = values.map((v) => String(v).trim().toLowerCase().replace(/\.$/, ""));
  if (normalized.some((v) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ns\.cloudflare\.com$/.test(v)) || new Set(normalized).size !== 2) {
    throw new RuntimeAdapterError("Enter the two different .ns.cloudflare.com nameservers assigned to your Cloudflare zone.", "RUNTIME_UPSTREAM_ERROR", 400);
  }
  return normalized;
}

export async function authoritativeNameservers(domain: string) {
  return (await resolve("NS", classifyHostname(domain).registrableDomain)).map((value) => value.toLowerCase().replace(/\.$/, ""));
}

export function nameserversMatchExpected(current: string[], expected: string[]) {
  const currentSet = new Set(current.map((value) => value.toLowerCase().replace(/\.$/, "")));
  const expectedSet = new Set(expected.map((value) => value.toLowerCase().replace(/\.$/, "")));
  return currentSet.size === 2 && expectedSet.size === 2 &&
    Array.from(expectedSet).every((value) => currentSet.has(value));
}

export async function verifyCustomDomainRouting(
  hostname: string,
  expectedSlug: string,
  expectedRedirectTo: string | null = null,
  expectedContext?: { purpose?: string | null; role?: string | null; primaryHostname?: string | null },
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const checkedHostname = normalizeCustomDomain(hostname);
    const response = await fetch(`https://${expectedSlug}.apps.buildcustom.ai/_buildcustom/custom-host-route-check?hostname=${encodeURIComponent(checkedHostname)}`, {
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => null) as any;
    return body?.ok === true
      && body?.project === expectedSlug
      && (body?.redirectTo || null) === expectedRedirectTo
      && (!expectedContext || (
        (body?.purpose || null) === (expectedContext.purpose || null)
        && (body?.role || null) === (expectedContext.role || null)
        && (body?.primaryHostname || null) === (expectedContext.primaryHostname || null)
      ));
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
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
  }) as Promise<CloudflareCustomHostname>;
}

export async function getCustomHostname(id: string) {
  return request(`/custom_hostnames/${encodeURIComponent(id)}`) as Promise<CloudflareCustomHostname>;
}

export async function deleteCustomHostname(id: string) {
  await request(`/custom_hostnames/${encodeURIComponent(id)}`, { method: "DELETE" }, true);
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