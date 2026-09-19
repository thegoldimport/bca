import { RuntimeAdapterError } from "./runtime-adapter";
import { promises as dns } from "node:dns";
import { createSocket } from "node:dgram";
import { randomBytes } from "node:crypto";
import { domainToASCII } from "node:url";
import { getDomain, getPublicSuffix } from "tldts";

const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export type DomainLifecycle = "pending_dns" | "verifying" | "ssl_provisioning" | "live" | "error";
export type DomainDnsRecord = { type: string; name: string; value: string };
export type HostnameKind = "apex" | "www" | "subdomain";
export type DnsInventoryRecord = { type: string; name: string; value: string };
export type DnsReplacementAction = "replace" | "keep" | "review";
export type DnsReplacementRecord = DnsInventoryRecord & {
  action: DnsReplacementAction;
  reason: string;
  proxyGuidance?: "dns_only";
};
export type CloudflareImportedDnsRecord = DnsInventoryRecord & {
  proxied: boolean | null;
};
export type CloudflareDnsImportComparison = {
  importedRecords: CloudflareImportedDnsRecord[];
  publicFindings: Array<DnsInventoryRecord & {
    status: "matched" | "missing" | "changed";
    importedValues: string[];
  }>;
  importOnlyRecords: CloudflareImportedDnsRecord[];
  proxiedServiceRecords: CloudflareImportedDnsRecord[];
  unverifiedServiceRecords: CloudflareImportedDnsRecord[];
  counts: {
    matched: number;
    missing: number;
    changed: number;
    importOnly: number;
    proxiedServices: number;
    unverifiedServices: number;
  };
};

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

export function validateApplicationHostname(value: string) {
  const classification = classifyHostname(value);
  if (classification.kind !== "subdomain") {
    throw new RuntimeAdapterError(
      "App/login domains must be subdomains such as app.example.com.",
      "RUNTIME_UPSTREAM_ERROR",
      400,
    );
  }
  return classification;
}

const DNS_ONLY_SERVICE_LABELS = new Set(["mail", "ftp", "cpanel", "webmail", "webdisk", "whm", "autodiscover", "autoconfig"]);
const DNS_RECORD_TYPES = new Set(["A", "AAAA", "CAA", "CERT", "CNAME", "DS", "HTTPS", "LOC", "MX", "NAPTR", "NS", "PTR", "SOA", "SRV", "SSHFP", "SVCB", "TLSA", "TXT"]);
const COMPARABLE_RECORD_TYPES = new Set(["A", "AAAA", "CAA", "CERT", "CNAME", "HTTPS", "LOC", "MX", "NAPTR", "PTR", "SRV", "SSHFP", "SVCB", "TLSA", "TXT"]);

function normalizeImportedRecordName(name: string, registrableDomain: string) {
  const value = name.trim().toLowerCase().replace(/\.$/, "");
  if (!value || value === "@") return registrableDomain;
  if (value === registrableDomain || value.endsWith(`.${registrableDomain}`)) return value;
  return `${value}.${registrableDomain}`;
}

function normalizeDnsRecordValue(type: string, value: string) {
  let normalized = String(value).trim().replace(/\s+/g, " ");
  if (type === "TXT") {
    normalized = normalized.replace(/^"(.*)"$/, "$1").replace(/"\s+"/g, "");
    return normalized;
  }
  if (["CNAME", "NS", "PTR"].includes(type)) return normalized.toLowerCase().replace(/\.$/, "");
  if (type === "MX") return normalized.replace(/(\s+\S+)\.$/, "$1").toLowerCase();
  if (type === "SRV") return normalized.replace(/(\s+\S+)\.$/, "$1").toLowerCase();
  if (type === "CAA") {
    try {
      const parsed = JSON.parse(normalized);
      if (parsed && typeof parsed === "object") {
        const tag = Object.keys(parsed).find((key) => key !== "critical" && parsed[key] !== undefined);
        if (tag) return `${Number(parsed.critical || 0)} ${tag.toLowerCase()} ${String(parsed[tag]).replace(/^"(.*)"$/, "$1").toLowerCase()}`;
      }
    } catch {
      // Zone exports use wire-style text instead of the Node resolver object.
    }
    const match = normalized.match(/^(\d+)\s+([a-z0-9-]+)\s+"?(.*?)"?$/i);
    if (match) return `${Number(match[1])} ${match[2].toLowerCase()} ${match[3].replace(/"$/, "").toLowerCase()}`;
  }
  return normalized.toLowerCase();
}

function normalizedImportedRecord(record: { type?: unknown; name?: unknown; value?: unknown; content?: unknown; proxied?: unknown; proxyStatus?: unknown }, registrableDomain: string): CloudflareImportedDnsRecord | null {
  const type = String(record.type || "").trim().toUpperCase();
  if (!DNS_RECORD_TYPES.has(type)) return null;
  const rawName = String(record.name || "").trim();
  const rawValue = String(record.content ?? record.value ?? "").trim();
  if (!rawName || !rawValue) return null;
  const proxyValue = record.proxied ?? record.proxyStatus;
  const proxied = typeof proxyValue === "boolean"
    ? proxyValue
    : typeof proxyValue === "string"
      ? /^(true|proxied|on|orange cloud)$/i.test(proxyValue.trim())
        ? true
        : /^(false|dns only|off|gray cloud|grey cloud)$/i.test(proxyValue.trim())
          ? false
          : null
      : null;
  return {
    type,
    name: normalizeImportedRecordName(rawName, registrableDomain),
    value: normalizeDnsRecordValue(type, rawValue),
    proxied,
  };
}

function parseDelimitedLine(line: string, delimiter: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

function parseDelimitedDnsImport(content: string, registrableDomain: string) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = parseDelimitedLine(lines[0], delimiter).map((header) => header.toLowerCase().replace(/[^a-z]/g, ""));
  const typeIndex = headers.indexOf("type");
  const nameIndex = headers.indexOf("name");
  const valueIndex = headers.findIndex((header) => ["content", "value", "target"].includes(header));
  const proxiedIndex = headers.findIndex((header) => ["proxied", "proxystatus", "proxy"].includes(header));
  if (typeIndex < 0 || nameIndex < 0 || valueIndex < 0) return [];
  return lines.slice(1).flatMap((line) => {
    const values = parseDelimitedLine(line, delimiter);
    const record = normalizedImportedRecord({
      type: values[typeIndex],
      name: values[nameIndex],
      content: values[valueIndex],
      proxyStatus: proxiedIndex >= 0 ? values[proxiedIndex] : undefined,
    }, registrableDomain);
    return record ? [record] : [];
  });
}

function bindLogicalLines(content: string) {
  const lines: Array<{ text: string; ownerOmitted: boolean }> = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  let ownerOmitted = false;
  for (const rawLine of content.split(/\r?\n/)) {
    let cleaned = "";
    for (let index = 0; index < rawLine.length; index += 1) {
      const character = rawLine[index];
      if (character === '"' && rawLine[index - 1] !== "\\") quoted = !quoted;
      if (character === ";" && !quoted) break;
      if (!quoted && character === "(") depth += 1;
      if (!quoted && character === ")") depth = Math.max(0, depth - 1);
      cleaned += character;
    }
    if (!current && cleaned.trim()) ownerOmitted = /^\s/.test(rawLine);
    current = `${current} ${cleaned.replace(/[()]/g, " ")}`.trim();
    if (depth === 0 && current) {
      lines.push({ text: current, ownerOmitted });
      current = "";
      ownerOmitted = false;
    }
  }
  if (current) lines.push({ text: current, ownerOmitted });
  return lines;
}

function tokenizeBindLine(line: string) {
  const tokens: string[] = [];
  let token = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index - 1] !== "\\") quoted = !quoted;
    if (/\s/.test(character) && !quoted) {
      if (token) tokens.push(token);
      token = "";
    } else {
      token += character;
    }
  }
  if (token) tokens.push(token);
  return tokens;
}

function parseBindDnsImport(content: string, registrableDomain: string) {
  let origin = registrableDomain;
  let priorName = "@";
  const records: CloudflareImportedDnsRecord[] = [];
  for (const logicalLine of bindLogicalLines(content)) {
    const tokens = tokenizeBindLine(logicalLine.text);
    if (!tokens.length) continue;
    if (tokens[0].toUpperCase() === "$ORIGIN" && tokens[1]) {
      origin = tokens[1].toLowerCase().replace(/\.$/, "");
      continue;
    }
    if (tokens[0].startsWith("$")) continue;
    const typeIndex = tokens.findIndex((token, index) =>
      index >= (logicalLine.ownerOmitted ? 0 : 1) && DNS_RECORD_TYPES.has(token.toUpperCase()));
    if (typeIndex < 0 || typeIndex === tokens.length - 1) continue;
    const first = tokens[0];
    const ownerOmitted = logicalLine.ownerOmitted;
    const owner = ownerOmitted ? priorName : first;
    priorName = owner;
    const absoluteOwner = owner === "@" ? origin
      : owner.endsWith(".") ? owner
        : owner === origin || owner.endsWith(`.${origin}`) ? owner
          : `${owner}.${origin}`;
    const record = normalizedImportedRecord({
      type: tokens[typeIndex],
      name: absoluteOwner,
      value: tokens.slice(typeIndex + 1).join(" "),
    }, registrableDomain);
    if (record) records.push(record);
  }
  return records;
}

export function parseCloudflareDnsImport(content: string, hostname: string): CloudflareImportedDnsRecord[] {
  if (typeof content !== "string" || !content.trim()) {
    throw new RuntimeAdapterError("Paste a Cloudflare DNS export or copied DNS table first.", "RUNTIME_UPSTREAM_ERROR", 400);
  }
  if (Buffer.byteLength(content, "utf8") > 1_000_000) {
    throw new RuntimeAdapterError("The DNS import must be smaller than 1 MB.", "RUNTIME_UPSTREAM_ERROR", 413);
  }
  const { registrableDomain } = classifyHostname(hostname);
  let records: CloudflareImportedDnsRecord[] = [];
  try {
    const parsed = JSON.parse(content);
    const values = Array.isArray(parsed) ? parsed
      : Array.isArray(parsed?.result) ? parsed.result
        : Array.isArray(parsed?.records) ? parsed.records
          : [];
    records = values.flatMap((value: any) => {
      const record = normalizedImportedRecord(value, registrableDomain);
      return record ? [record] : [];
    });
  } catch {
    records = parseDelimitedDnsImport(content, registrableDomain);
    if (!records.length) records = parseBindDnsImport(content, registrableDomain);
  }
  const unique = Array.from(new Map(records.map((record) => [
    `${record.type}\0${record.name}\0${record.value}\0${String(record.proxied)}`,
    record,
  ])).values());
  if (!unique.length) {
    throw new RuntimeAdapterError("No DNS records were recognized. Use a Cloudflare zone export, JSON export, or copied DNS table with Type, Name, and Content columns.", "RUNTIME_UPSTREAM_ERROR", 400);
  }
  if (unique.length > 2_000) {
    throw new RuntimeAdapterError("The DNS import contains too many records.", "RUNTIME_UPSTREAM_ERROR", 413);
  }
  return unique.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
}

function recordIdentity(record: DnsInventoryRecord) {
  const type = record.type.toUpperCase();
  return `${type}\0${record.name.toLowerCase().replace(/\.$/, "")}\0${normalizeDnsRecordValue(type, record.value)}`;
}

function isDnsOnlyServiceRecord(record: DnsInventoryRecord, registrableDomain: string) {
  const relative = record.name.toLowerCase().replace(/\.$/, "").replace(new RegExp(`\\.?${registrableDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
  return relative.split(".").some((label) => DNS_ONLY_SERVICE_LABELS.has(label));
}

export function compareCloudflareDnsImport(
  publicRecords: DnsInventoryRecord[],
  importedRecords: CloudflareImportedDnsRecord[],
  hostname: string,
): CloudflareDnsImportComparison {
  const { registrableDomain } = classifyHostname(hostname);
  const comparablePublic = publicRecords.filter((record) => COMPARABLE_RECORD_TYPES.has(record.type.toUpperCase()));
  const importedByHostType = new Map<string, CloudflareImportedDnsRecord[]>();
  for (const record of importedRecords) {
    const key = `${record.type.toUpperCase()}\0${record.name.toLowerCase().replace(/\.$/, "")}`;
    importedByHostType.set(key, [...(importedByHostType.get(key) || []), record]);
  }
  const importedIdentities = new Set(importedRecords.map(recordIdentity));
  const publicIdentities = new Set(comparablePublic.map(recordIdentity));
  const publicHostTypes = new Set(comparablePublic.map((record) =>
    `${record.type.toUpperCase()}\0${record.name.toLowerCase().replace(/\.$/, "")}`));
  const publicFindings = comparablePublic.map((record) => {
    const type = record.type.toUpperCase();
    const key = `${type}\0${record.name.toLowerCase().replace(/\.$/, "")}`;
    const sameHostType = importedByHostType.get(key) || [];
    const status = importedIdentities.has(recordIdentity(record)) ? "matched" as const
      : sameHostType.length ? "changed" as const
        : "missing" as const;
    return { ...record, status, importedValues: sameHostType.map((value) => value.value) };
  });
  const importOnlyRecords = importedRecords.filter((record) =>
    COMPARABLE_RECORD_TYPES.has(record.type)
    && !publicIdentities.has(recordIdentity(record))
    && !publicHostTypes.has(`${record.type}\0${record.name}`));
  const proxiedServiceRecords = importedRecords.filter((record) =>
    record.proxied === true && isDnsOnlyServiceRecord(record, registrableDomain));
  const unverifiedServiceRecords = importedRecords.filter((record) =>
    record.proxied === null && isDnsOnlyServiceRecord(record, registrableDomain));
  return {
    importedRecords,
    publicFindings,
    importOnlyRecords,
    proxiedServiceRecords,
    unverifiedServiceRecords,
    counts: {
      matched: publicFindings.filter((record) => record.status === "matched").length,
      missing: publicFindings.filter((record) => record.status === "missing").length,
      changed: publicFindings.filter((record) => record.status === "changed").length,
      importOnly: importOnlyRecords.length,
      proxiedServices: proxiedServiceRecords.length,
      unverifiedServices: unverifiedServiceRecords.length,
    },
  };
}

export function buildDnsReplacementPlan(records: DnsInventoryRecord[], registrableDomain: string, inspectedHostname = registrableDomain) {
  const root = registrableDomain.toLowerCase();
  const www = `www.${root}`;
  const inspected = inspectedHostname.toLowerCase();
  const websiteHosts = inspected === root || inspected === www ? new Set([root, www]) : new Set([inspected]);
  const classified: DnsReplacementRecord[] = records.map((record) => {
    const type = record.type.toUpperCase();
    const name = record.name.toLowerCase().replace(/\.$/, "");
    const label = name === root ? "@" : name.endsWith(`.${root}`) ? name.slice(0, -(root.length + 1)) : name;
    const serviceLabel = label.split(".").at(-1) || label;
    const proxyGuidance = DNS_ONLY_SERVICE_LABELS.has(serviceLabel) ? "dns_only" as const : undefined;

    if (websiteHosts.has(name) && ["A", "AAAA", "CNAME"].includes(type)) {
      return { ...record, action: "replace" as const, reason: "This record currently controls website traffic and conflicts with BuildCustom." };
    }
    if (type === "MX") {
      return { ...record, action: "keep" as const, reason: "Keep this mail-routing record to avoid interrupting email.", proxyGuidance };
    }
    if (type === "SRV") {
      return { ...record, action: "keep" as const, reason: "Keep this service-discovery record.", proxyGuidance };
    }
    if (type === "TXT") {
      const purpose = /v=spf1/i.test(record.value) ? "SPF email policy"
        : /v=dmarc1/i.test(record.value) || label.startsWith("_dmarc") ? "DMARC email policy"
          : /dkim|domainkey/i.test(record.value) || label.includes("_domainkey") ? "DKIM email authentication"
            : "verification or service";
      return { ...record, action: "keep" as const, reason: `Keep this ${purpose} record.` };
    }
    if (["CAA"].includes(type)) {
      return { ...record, action: "keep" as const, reason: "Keep this certificate-authority policy record." };
    }
    if (serviceLabel === "ftp") {
      return { ...record, action: "review" as const, reason: "Confirm whether this FTP alias is still used before importing it.", proxyGuidance };
    }
    if (DNS_ONLY_SERVICE_LABELS.has(serviceLabel)) {
      return { ...record, action: "keep" as const, reason: "Keep this service record if the service is still in use.", proxyGuidance };
    }
    return { ...record, action: "review" as const, reason: "Confirm what uses this record before importing or removing it." };
  });
  return {
    records: classified,
    counts: {
      replace: classified.filter((record) => record.action === "replace").length,
      keep: classified.filter((record) => record.action === "keep").length,
      review: classified.filter((record) => record.action === "review").length,
    },
  };
}

export function proposedBuildCustomWebsiteRecords(registrableDomain: string, inspectedHostname = registrableDomain): DomainDnsRecord[] {
  const { cnameTarget } = config();
  const inspected = inspectedHostname.toLowerCase();
  if (inspected !== registrableDomain && inspected !== `www.${registrableDomain}`) {
    return [{ type: "CNAME", name: inspected, value: cnameTarget }];
  }
  return [
    { type: "CNAME", name: registrableDomain, value: cnameTarget },
    { type: "CNAME", name: `www.${registrableDomain}`, value: cnameTarget },
  ];
}

export function removeCnameFollowedAddresses(records: DnsInventoryRecord[]) {
  const cnameOwners = new Set(records.filter((record) => record.type.toUpperCase() === "CNAME").map((record) => record.name.toLowerCase().replace(/\.$/, "")));
  return records.filter((record) =>
    !["A", "AAAA"].includes(record.type.toUpperCase())
    || !cnameOwners.has(record.name.toLowerCase().replace(/\.$/, "")));
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
    `autoconfig.${classification.registrableDomain}`, `ftp.${classification.registrableDomain}`,
    `cpanel.${classification.registrableDomain}`, `whm.${classification.registrableDomain}`,
    `webdisk.${classification.registrableDomain}`,
    `_dmarc.${classification.registrableDomain}`, `default._domainkey.${classification.registrableDomain}`]);
  const types = ["A", "AAAA", "CNAME", "MX", "TXT", "CAA", "SRV", "NS"];
  const records: DnsInventoryRecord[] = [];
  await Promise.all(Array.from(names).flatMap((name) => types.map(async (type) => {
    for (const result of await resolve(type, name)) records.push({ type, name, value: result.replace(/\.$/, "") });
  })));
  const emailRecords = records.filter((r) => ["MX", "TXT"].includes(r.type) &&
    (r.type === "MX" || /spf|dkim|dmarc|domainkey/i.test(r.value) || /_dmarc|_domainkey/i.test(r.name)));
  const sortedRecords = removeCnameFollowedAddresses(records)
    .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
  return {
    ...classification,
    records: sortedRecords,
    replacementPlan: buildDnsReplacementPlan(sortedRecords, classification.registrableDomain, classification.hostname),
    proposedRecords: proposedBuildCustomWebsiteRecords(classification.registrableDomain, classification.hostname),
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

export function nameserverActivationReady(current: string[], expected: string[], authoritativeActive: boolean) {
  return nameserversMatchExpected(current, expected) && authoritativeActive;
}

function encodeDnsName(name: string) {
  const labels = name.replace(/\.$/, "").split(".");
  return Buffer.concat([
    ...labels.map((label) => {
      const value = Buffer.from(label, "ascii");
      if (!value.length || value.length > 63) throw new Error("Invalid DNS label.");
      return Buffer.concat([Buffer.from([value.length]), value]);
    }),
    Buffer.from([0]),
  ]);
}

function readDnsName(packet: Buffer, start: number) {
  const labels: string[] = [];
  let offset = start;
  let nextOffset = start;
  let jumped = false;
  const visited = new Set<number>();
  while (offset < packet.length) {
    if (visited.has(offset)) throw new Error("DNS compression loop.");
    visited.add(offset);
    const length = packet[offset];
    if ((length & 0xc0) === 0xc0) {
      if (offset + 1 >= packet.length) throw new Error("Truncated DNS pointer.");
      const pointer = ((length & 0x3f) << 8) | packet[offset + 1];
      if (!jumped) nextOffset = offset + 2;
      jumped = true;
      offset = pointer;
      continue;
    }
    if (length === 0) {
      if (!jumped) nextOffset = offset + 1;
      return { name: labels.join(".").toLowerCase(), nextOffset };
    }
    if ((length & 0xc0) !== 0 || offset + 1 + length > packet.length) throw new Error("Invalid DNS name.");
    labels.push(packet.toString("ascii", offset + 1, offset + 1 + length));
    offset += 1 + length;
    if (!jumped) nextOffset = offset;
  }
  throw new Error("Truncated DNS name.");
}

export function parseNameserverDnsResponse(packet: Buffer, expected?: { id: number; name: string }) {
  if (packet.length < 12) throw new Error("Truncated DNS response.");
  const id = packet.readUInt16BE(0);
  const flags = packet.readUInt16BE(2);
  if (expected && id !== expected.id) throw new Error("Mismatched DNS response ID.");
  if (!(flags & 0x8000)) throw new Error("DNS packet is not a response.");
  if ((flags & 0x7800) !== 0) throw new Error("Unsupported DNS opcode.");
  if (flags & 0x0200) throw new Error("Truncated UDP DNS response.");
  const rcode = flags & 0x000f;
  if (rcode !== 0) throw new Error(`DNS response code ${rcode}.`);
  const counts = [
    packet.readUInt16BE(4),
    packet.readUInt16BE(6),
    packet.readUInt16BE(8),
    packet.readUInt16BE(10),
  ];
  if (counts[0] !== 1) throw new Error("Unexpected DNS question count.");
  let offset = 12;
  let questionName = "";
  let questionType = 0;
  let questionClass = 0;
  for (let i = 0; i < counts[0]; i += 1) {
    const question = readDnsName(packet, offset);
    offset = question.nextOffset;
    if (offset + 4 > packet.length) throw new Error("Truncated DNS question.");
    questionName = question.name;
    questionType = packet.readUInt16BE(offset);
    questionClass = packet.readUInt16BE(offset + 2);
    offset += 4;
    if (offset > packet.length) throw new Error("Truncated DNS question.");
  }
  const expectedName = expected?.name.toLowerCase().replace(/\.$/, "");
  if (expected && (questionName !== expectedName || questionType !== 2 || questionClass !== 1)) {
    throw new Error("DNS response question does not match the request.");
  }
  const nameservers: string[] = [];
  for (const count of counts.slice(1)) {
    for (let i = 0; i < count; i += 1) {
      const owner = readDnsName(packet, offset);
      offset = owner.nextOffset;
      if (offset + 10 > packet.length) throw new Error("Truncated DNS record.");
      const type = packet.readUInt16BE(offset);
      const recordClass = packet.readUInt16BE(offset + 2);
      const dataLength = packet.readUInt16BE(offset + 8);
      const dataOffset = offset + 10;
      const recordEnd = dataOffset + dataLength;
      if (recordEnd > packet.length) throw new Error("Truncated DNS record data.");
      if (type === 2 && recordClass === 1 && (!expectedName || owner.name === expectedName)) {
        const target = readDnsName(packet, dataOffset);
        if (target.nextOffset !== recordEnd) throw new Error("Invalid NS record data length.");
        nameservers.push(target.name);
      }
      offset = recordEnd;
    }
  }
  return {
    authoritative: Boolean(flags & 0x0400),
    nameservers: Array.from(new Set(nameservers)).sort(),
  };
}

async function queryNameserverDirect(server: string, name: string, timeoutMs = 2500) {
  const id = randomBytes(2).readUInt16BE(0);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(1, 4);
  const question = Buffer.alloc(4);
  question.writeUInt16BE(2, 0);
  question.writeUInt16BE(1, 2);
  const packet = Buffer.concat([header, encodeDnsName(name), question]);
  return new Promise<ReturnType<typeof parseNameserverDnsResponse>>((resolve, reject) => {
    const socket = createSocket("udp4");
    let settled = false;
    let timer: NodeJS.Timeout;
    const finish = (error?: Error, response?: ReturnType<typeof parseNameserverDnsResponse>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(response!);
    };
    timer = setTimeout(() => finish(new Error("Direct DNS query timed out.")), timeoutMs);
    socket.once("error", (error) => finish(error));
    socket.once("message", (message) => {
      try {
        finish(undefined, parseNameserverDnsResponse(message, { id, name }));
      } catch (error) {
        finish(error as Error);
      }
    });
    socket.connect(53, server, () => socket.send(packet));
  });
}

async function resolveIpv4(hostname: string) {
  return (await dns.resolve4(hostname))[0];
}

async function parentDelegationNameservers(domain: string) {
  const suffix = getPublicSuffix(domain);
  if (!suffix) throw new Error("Public suffix not found.");
  const parentHosts = await dns.resolveNs(suffix);
  const parentAddresses = await Promise.allSettled(parentHosts.slice(0, 4).map(resolveIpv4));
  const parentServers = parentAddresses.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (parentServers.length < 2) throw new Error("Not enough reachable parent nameservers.");
  const responses = await Promise.allSettled(parentServers.map((server) => queryNameserverDirect(server, domain)));
  const counts = new Map<string, { nameservers: string[]; count: number }>();
  for (const response of responses) {
    if (response.status !== "fulfilled" || response.value.nameservers.length === 0) continue;
    const key = response.value.nameservers.join(",");
    const prior = counts.get(key);
    counts.set(key, { nameservers: response.value.nameservers, count: (prior?.count || 0) + 1 });
  }
  return selectNameserverConsensus(Array.from(counts.values()));
}

export function selectNameserverConsensus(groups: Array<{ nameservers: string[]; count: number }>) {
  const ordered = [...groups].sort((a, b) => b.count - a.count);
  const validResponses = ordered.reduce((sum, group) => sum + group.count, 0);
  const consensus = ordered[0];
  const tied = Boolean(ordered[1] && ordered[1].count === consensus?.count);
  if (!consensus || consensus.count < 2 || consensus.count <= validResponses / 2 || tied) {
    throw new Error("Parent nameservers did not reach a strict delegation consensus.");
  }
  return consensus.nameservers;
}

async function expectedNameserversAnswer(domain: string, expected: string[]) {
  const responses = await Promise.all(expected.map(async (hostname) => {
    const server = await resolveIpv4(hostname);
    return queryNameserverDirect(server, domain);
  }));
  return responses.every((response) =>
    response.authoritative && nameserversMatchExpected(response.nameservers, expected));
}

export async function checkNameserverActivation(domain: string, expected: string[]) {
  try {
    return await withTimeout((async () => {
      const registrableDomain = classifyHostname(domain).registrableDomain;
      const currentNameservers = await parentDelegationNameservers(registrableDomain);
      const delegationActive = nameserversMatchExpected(currentNameservers, expected);
      const authoritativeActive = delegationActive
        ? await expectedNameserversAnswer(registrableDomain, expected)
        : false;
      return {
        currentNameservers,
        active: nameserverActivationReady(currentNameservers, expected, authoritativeActive),
        checkSource: "parent_delegation" as const,
        authoritativeActive,
      };
    })(), 7000, "Direct nameserver verification timed out.");
  } catch {
    const currentNameservers = await withTimeout(authoritativeNameservers(domain), 2500, "Recursive nameserver lookup timed out.")
      .catch(() => [] as string[]);
    return {
      currentNameservers,
      active: false,
      checkSource: "recursive_fallback" as const,
      authoritativeActive: null,
    };
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string) {
  let timer: NodeJS.Timeout;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
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
    const probe = randomBytes(8).toString("hex");
    const path = expectedRedirectTo ? `/_buildcustom/route-check/${probe}` : "/_buildcustom/route-check";
    const query = `?probe=${probe}`;
    const response = await fetch(`https://${checkedHostname}${path}${query}`, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" },
      redirect: "manual",
      signal: controller.signal,
    });
    if (expectedRedirectTo) {
      if (response.status !== 301) return false;
      const location = response.headers.get("location");
      if (!location) return false;
      const expected = `https://${normalizeCustomDomain(expectedRedirectTo)}${path}${query}`;
      return new URL(location, `https://${checkedHostname}`).href === expected;
    }
    if (!response.ok) return false;
    const body = await response.json().catch(() => null) as any;
    return body?.ok === true
      && body?.project === expectedSlug
      && (body?.redirectTo || null) === null
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

export function routingStatusAfterVerification(
  cloudflareStatus: DomainLifecycle,
  routingVerified: boolean,
): DomainLifecycle | "connecting" {
  return cloudflareStatus === "live" && !routingVerified ? "connecting" : cloudflareStatus;
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