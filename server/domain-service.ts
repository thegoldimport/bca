import { storage, type RuntimeDomainMapping } from "./storage";

export type DomainPurpose = "website" | "application" | "documentation" | "api" | "redirect" | "custom";
export type DomainRoutingRole = "primary" | "direct" | "redirect";
export type DomainRouteConfig =
  | { role: "redirect"; redirectTo: string }
  | { role: "primary" | "direct"; redirectTo?: never };
export type AddDomainInput = { hostname: string; purpose: DomainPurpose } & DomainRouteConfig;

export const DOMAIN_ACTION_NAMES = [
  "list_domains",
  "add_domain",
  "remove_domain",
  "verify_domain",
  "set_primary_domain",
  "set_domain_role",
  "set_domain_purpose",
  "get_dns_instructions",
  "check_domain_status",
] as const;

/**
 * Contract for a future ThinkAgent adapter. The adapter must call authenticated
 * BuildCustom actions implementing this interface; it must never receive direct
 * database or Cloudflare access.
 */
export interface AuthenticatedDomainActions {
  listDomains(projectId: number): Promise<RuntimeDomainMapping[]>;
  addDomain(projectId: number, input: AddDomainInput): Promise<RuntimeDomainMapping>;
  removeDomain(projectId: number, hostname: string): Promise<void>;
  verifyDomain(projectId: number, hostname: string): Promise<RuntimeDomainMapping>;
  setPrimaryDomain(projectId: number, hostname: string): Promise<RuntimeDomainMapping[]>;
  setDomainRole(projectId: number, hostname: string, route: DomainRouteConfig): Promise<RuntimeDomainMapping>;
  setDomainPurpose(projectId: number, hostname: string, purpose: DomainPurpose): Promise<RuntimeDomainMapping>;
  getDnsInstructions(projectId: number, hostname: string): Promise<Array<{ type: string; name: string; value: string }>>;
  checkDomainStatus(projectId: number, hostname: string): Promise<RuntimeDomainMapping>;
}

/**
 * Authenticated routes and future agent actions share this service boundary.
 * Callers enforce project ownership before invoking it; no agent receives
 * Cloudflare credentials or direct database access.
 */
export async function listDomains(projectId: number): Promise<RuntimeDomainMapping[]> {
  return storage.getRuntimeCustomDomains(projectId);
}

export async function configurePrimaryDomainPair(input: {
  projectId: number;
  primaryHostname: string;
  secondaryHostname: string | null;
  migration: Record<string, unknown>;
}) {
  return storage.configureRuntimeCustomDomains(
    input.projectId,
    input.primaryHostname,
    input.secondaryHostname,
    input.migration,
  );
}

export async function updateDomainLifecycle(
  projectId: number,
  hostname: string,
  lifecycle: {
    cloudflareId: string | null;
    status: string | null;
    sslStatus: string | null;
    dnsRecords: Array<{ type: string; name: string; value: string }>;
    error: string | null;
    checkedAt: Date;
    migrationState?: Record<string, unknown>;
  },
) {
  return storage.updateRuntimeCustomDomain(hostname, projectId, lifecycle);
}

export async function domainRoutingContext(projectId: number, hostname: string) {
  const mapping = await storage.getRuntimeCustomDomainClaim(hostname);
  if (!mapping || mapping.projectId !== projectId) return null;
  const primary = (await storage.getRuntimeCustomDomains(projectId)).find((domain) => domain.isPrimary);
  return {
    purpose: mapping.purpose,
    role: mapping.role,
    primaryHostname: primary?.hostname || null,
    redirectTo: mapping.redirectTo,
  };
}