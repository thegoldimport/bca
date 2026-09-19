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

const DNS_ONLY_SERVICE_LABELS = new Set(["mail", "ftp", "cpanel", "webmail", "webdisk", "whm", "autodiscover", "autoconfig"]);

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