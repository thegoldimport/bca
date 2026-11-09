import {
  assertOrigin,
  hasValidCsrfToken,
  randomToken,
  type SessionUser,
} from "./staging/auth";
import { resolveRuntimeProductUser } from "./staging/runtime-identity";
import { adminDeploymentLinks, type AdminCustomDomain } from "./admin-deployment-url";

const SUPPORT_SCOPE = "read_only_diagnostics" as const;
const DEFAULT_ORIGIN = "https://app.buildcustom.ai";
const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

type SupportEnv = {
  DB: D1Database;
  AUTH_RUNTIME?: Fetcher;
  AUTH_RUNTIME_URL?: string;
  ENVIRONMENT?: string;
  CONTROL_PLANE_PROFILE?: string;
  CONTROL_PLANE_ALLOWED_ORIGIN?: string;
  PUBLIC_GENERATED_APPS_ENABLED?: string;
};

type SupportRouteArgs = {
  request: Request;
  env: SupportEnv;
  url: URL;
  input: Record<string, unknown>;
};

type AdminSupportRouteArgs = SupportRouteArgs & { admin: SessionUser };

function protectedMutation(env: SupportEnv, request: Request): boolean {
  if (!hasValidCsrfToken(request)) return false;
  try {
    assertOrigin(request, env.CONTROL_PLANE_ALLOWED_ORIGIN || DEFAULT_ORIGIN);
    return true;
  } catch {
    return false;
  }
}

function validId(value: string | undefined, maxLength = 128): string | null {
  if (!value || value.length > maxLength || /[\r\n/]/.test(value)) return null;
  return value;
}

function decodedId(value: string | undefined, maxLength = 128): string | null {
  if (!value) return null;
  try {
    return validId(decodeURIComponent(value), maxLength);
  } catch {
    return null;
  }
}

function rows(result: any): any[] {
  return Array.isArray(result?.results) ? result.results : [];
}

function statusForGrant(grant: {
  revoked_at_ms?: number | null;
  expires_at_ms: number;
}, now = Date.now()): "active" | "expired" | "revoked" {
  if (grant.revoked_at_ms != null) return "revoked";
  return Number(grant.expires_at_ms) > now ? "active" : "expired";
}

function safePublicOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

const CUSTOMER_PROJECT_PAGE_SIZE = 50;
const CUSTOMER_HISTORY_LIMIT = 100;

function domainsForProject(project: any, claims: any[]): AdminCustomDomain[] {
  const projectId = Number(project.id ?? project.project_id);
  const linked: AdminCustomDomain[] = [
    {
      hostname: project.custom_domain,
      status: project.custom_domain_status,
      sslStatus: project.custom_domain_ssl_status,
      isPrimary: true,
    },
    {
      hostname: project.custom_domain_secondary,
      status: project.custom_domain_secondary_status,
      sslStatus: project.custom_domain_secondary_ssl_status,
      isPrimary: false,
    },
  ];
  const claimed = claims
    .filter((claim) => Number(claim.project_id) === projectId)
    .map((claim) => ({
      hostname: claim.hostname,
      status: claim.status,
      sslStatus: claim.ssl_status,
      isPrimary: Number(claim.is_primary) === 1,
    }));
  const seen = new Set<string>();
  return [...claimed, ...linked].filter((domain) => {
    if (typeof domain.hostname !== "string") return false;
    const key = domain.hostname.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isLaunchPublicAppsEnabled(env: SupportEnv): boolean {
  return env.ENVIRONMENT === "production"
    && env.CONTROL_PLANE_PROFILE === "launch"
    && env.PUBLIC_GENERATED_APPS_ENABLED === "true";
}

async function getCustomerSupportAccess(env: SupportEnv, user: SessionUser) {
  const [projectsResult, grantsResult, sessionsResult] = await Promise.all([
    env.DB.prepare(
      `SELECT p.id,p.name,p.type,p.status,p.created_at,p.updated_at
       FROM projects p
       WHERE p.user_id=?
       ORDER BY p.updated_at DESC LIMIT 200`,
    ).bind(user.id).all(),
    env.DB.prepare(
      `SELECT g.id,g.project_id,g.permission,g.granted_at_ms,g.expires_at_ms,g.revoked_at_ms,
        p.name AS project_name
       FROM support_access_grants g
       LEFT JOIN projects p ON p.id=g.project_id AND p.user_id=g.customer_user_id
       WHERE g.customer_user_id=?
       ORDER BY g.granted_at_ms DESC LIMIT 200`,
    ).bind(user.id).all(),
    env.DB.prepare(
      `SELECT s.id,s.grant_id,s.project_id,s.started_at_ms,s.last_access_at_ms,s.closed_at_ms,
        COALESCE(a.profile_name,a.display_name,a.username) AS operator_name,a.email AS operator_email,
        g.expires_at_ms,g.revoked_at_ms
       FROM support_access_sessions s
       JOIN support_access_grants g ON g.id=s.grant_id
       LEFT JOIN users a ON a.id=s.admin_user_id
       WHERE s.customer_user_id=?
       ORDER BY s.started_at_ms DESC LIMIT 100`,
    ).bind(user.id).all(),
  ]);
  const now = Date.now();
  return {
    scope: SUPPORT_SCOPE,
    disclosure: "BuildCustom support can view the selected project's metadata, build and deployment status, and troubleshooting activity during the approved period. Support cannot view source files, passwords, API keys, environment variables, private application data, or unrelated projects.",
    projects: rows(projectsResult).map((project) => ({
      id: Number(project.id),
      name: String(project.name || "Untitled project"),
      type: String(project.type || "project"),
      status: String(project.status || "unknown"),
      createdAt: project.created_at ?? null,
      updatedAt: project.updated_at ?? null,
    })),
    grants: rows(grantsResult).map((grant) => ({
      id: String(grant.id),
      projectId: Number(grant.project_id),
      projectName: grant.project_name ? String(grant.project_name) : "Project no longer available",
      permission: String(grant.permission),
      grantedAt: Number(grant.granted_at_ms),
      expiresAt: Number(grant.expires_at_ms),
      revokedAt: grant.revoked_at_ms == null ? null : Number(grant.revoked_at_ms),
      status: statusForGrant(grant, now),
    })),
    sessions: rows(sessionsResult).map((session) => ({
      id: String(session.id),
      grantId: String(session.grant_id),
      projectId: Number(session.project_id),
      operatorName: session.operator_name ? String(session.operator_name) : "BuildCustom support",
      operatorEmail: session.operator_email ? String(session.operator_email) : null,
      startedAt: Number(session.started_at_ms),
      lastAccessAt: Number(session.last_access_at_ms),
      closedAt: session.closed_at_ms == null ? null : Number(session.closed_at_ms),
      status: session.closed_at_ms != null
        ? "closed"
        : statusForGrant(session, now),
    })),
  };
}

async function createCustomerGrant(
  env: SupportEnv,
  request: Request,
  user: SessionUser,
  input: Record<string, unknown>,
): Promise<Response> {
  if (!protectedMutation(env, request)) return json({ message: "A secure request is required." }, 403);
  const projectId = Number(input.projectId);
  const durationMinutes = input.durationMinutes === undefined ? 60 : Number(input.durationMinutes);
  if (!Number.isSafeInteger(projectId) || projectId < 1
    || ![30, 60, 240, 1440].includes(durationMinutes)) {
    return json({ message: "Select a project and one of the available access durations." }, 400);
  }

  const now = Date.now();
  const expiresAt = now + durationMinutes * 60_000;
  const grantId = randomToken();
  const metadata = JSON.stringify({
    grantId,
    permission: SUPPORT_SCOPE,
    durationMinutes,
    outcome: "granted",
  });
  const result = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO support_access_grants
        (id,customer_user_id,project_id,permission,granted_at_ms,expires_at_ms,revoked_at_ms,revoked_by_user_id)
       SELECT ?,?,?,?, ?,?,NULL,NULL
       WHERE EXISTS(
         SELECT 1 FROM projects p JOIN users u ON u.id=p.user_id
         WHERE p.id=? AND p.user_id=? AND u.role='user' AND u.account_status='active'
       )
       AND NOT EXISTS(
         SELECT 1 FROM support_access_grants g
         WHERE g.customer_user_id=? AND g.project_id=? AND g.revoked_at_ms IS NULL AND g.expires_at_ms>?
       )`,
    ).bind(
      grantId, user.id, projectId, SUPPORT_SCOPE, now, expiresAt,
      projectId, user.id, user.id, projectId, now,
    ),
    env.DB.prepare(
      `INSERT INTO audit_events(actor_user_id,action,project_id,metadata_json)
       SELECT ?, 'customer_support_access_granted', ?, ?
       WHERE EXISTS(
         SELECT 1 FROM support_access_grants WHERE id=? AND customer_user_id=? AND project_id=?
       )`,
    ).bind(user.id, projectId, metadata, grantId, user.id, projectId),
  ]);
  if (Number(result[0]?.meta?.changes || 0) !== 1) {
    return json({ message: "The project is unavailable or already has active support approval." }, 409);
  }
  return json({
    grant: {
      id: grantId,
      projectId,
      permission: SUPPORT_SCOPE,
      grantedAt: now,
      expiresAt,
      status: "active",
    },
  }, 201);
}

async function revokeCustomerGrant(
  env: SupportEnv,
  request: Request,
  user: SessionUser,
  grantId: string,
): Promise<Response> {
  if (!protectedMutation(env, request)) return json({ message: "A secure request is required." }, 403);
  const owned = await env.DB.prepare(
    "SELECT id,project_id FROM support_access_grants WHERE id=? AND customer_user_id=?",
  ).bind(grantId, user.id).first<{ id: string; project_id: number }>();
  if (!owned) return json({ message: "Support approval not found." }, 404);

  const revokedAt = Date.now();
  const metadata = JSON.stringify({
    grantId,
    revokedAt,
    outcome: "revoked",
  });
  const result = await env.DB.batch([
    env.DB.prepare(
      `UPDATE support_access_grants
       SET revoked_at_ms=?,revoked_by_user_id=?
       WHERE id=? AND customer_user_id=? AND revoked_at_ms IS NULL`,
    ).bind(revokedAt, user.id, grantId, user.id),
    env.DB.prepare(
      "UPDATE support_access_sessions SET closed_at_ms=? WHERE grant_id=? AND closed_at_ms IS NULL",
    ).bind(revokedAt, grantId),
    env.DB.prepare(
      `INSERT INTO audit_events(actor_user_id,action,project_id,metadata_json)
       SELECT ?, 'customer_support_access_revoked', ?, ?
       WHERE EXISTS(
         SELECT 1 FROM support_access_grants
         WHERE id=? AND customer_user_id=? AND revoked_at_ms=?
       )
       AND NOT EXISTS(
         SELECT 1 FROM audit_events WHERE action='customer_support_access_revoked' AND metadata_json=?
       )`,
    ).bind(user.id, Number(owned.project_id), metadata, grantId, user.id, revokedAt, metadata),
  ]);
  if (Number(result[0]?.meta?.changes || 0) !== 1) {
    return json({ message: "This support approval has already ended." }, 409);
  }
  return json({ success: true, revokedAt });
}

export async function handleCustomerSupportAccessRoute(args: SupportRouteArgs): Promise<Response | null> {
  const { request, env, url, input } = args;
  if (url.pathname !== "/api/support-access" && !url.pathname.startsWith("/api/support-access/")) return null;
  const user = await resolveRuntimeProductUser(env, request);
  if (!user) return json({ message: "Unauthorized." }, 401);
  if (user.role !== "user" || user.account_status === "suspended") {
    return json({ message: "Customer support access is unavailable for this account." }, 403);
  }
  if (url.pathname === "/api/support-access" && request.method === "GET") {
    return json(await getCustomerSupportAccess(env, user));
  }
  if (url.pathname === "/api/support-access/grants" && request.method === "POST") {
    return createCustomerGrant(env, request, user, input);
  }
  const revokeMatch = url.pathname.match(/^\/api\/support-access\/grants\/([^/]+)\/revoke$/);
  if (revokeMatch && request.method === "POST") {
    const grantId = decodedId(revokeMatch[1], 128);
    if (!grantId) return json({ message: "Invalid support approval." }, 400);
    return revokeCustomerGrant(env, request, user, grantId);
  }
  return json({ message: "Not found." }, 404);
}

async function getAdminCustomerDetail(
  env: SupportEnv,
  customerId: string,
  projectOffset: number,
): Promise<Response> {
  const customer = await env.DB.prepare(
    `SELECT id,COALESCE(profile_name,display_name,username) AS name,email,plan,role,account_status,created_at
     FROM users WHERE id=? AND role='user'`,
  ).bind(customerId).first<any>();
  if (!customer) return json({ message: "Customer not found." }, 404);

  const [projectsResult, projectCount, deploymentProjectCount, projectLinksResult, customDomainResult,
    operationSummary, operationsResult, turnSummary, turnRows, releasesResult,
    nativeReleasesResult, grantsResult, sessionsResult, supportAuditResult] = await Promise.all([
    env.DB.prepare(
      `SELECT p.id,p.name,p.type,p.status,p.framework,p.created_at,p.updated_at,
        l.deployment_url,l.updated_at AS deployment_updated_at,l.hosting_provider,l.subdomain_slug,
        l.custom_domain,l.custom_domain_status,l.custom_domain_ssl_status,
        l.custom_domain_secondary,l.custom_domain_secondary_status,l.custom_domain_secondary_ssl_status,
        (SELECT o.status FROM operations o WHERE o.project_id=p.id ORDER BY o.created_at DESC LIMIT 1) AS latest_generation_status
       FROM projects p LEFT JOIN runtime_project_links l ON l.project_id=p.id
       WHERE p.user_id=? ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
    ).bind(customerId, CUSTOMER_PROJECT_PAGE_SIZE + 1, projectOffset).all(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM projects WHERE user_id=?")
      .bind(customerId).first<any>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total FROM projects p
       LEFT JOIN runtime_project_links l ON l.project_id=p.id
       WHERE p.user_id=? AND l.deployment_url IS NOT NULL AND TRIM(l.deployment_url)<>''`,
    ).bind(customerId).first<any>(),
    env.DB.prepare(
      `SELECT l.project_id,l.hosting_provider,l.subdomain_slug,l.custom_domain,l.custom_domain_status,
        l.custom_domain_ssl_status,l.custom_domain_secondary,l.custom_domain_secondary_status,
        l.custom_domain_secondary_ssl_status
       FROM runtime_project_links l JOIN projects p ON p.id=l.project_id
       WHERE p.user_id=?`,
    ).bind(customerId).all(),
    env.DB.prepare(
      `SELECT c.project_id,c.hostname,c.role,c.status,c.ssl_status,c.created_at,c.is_primary
       FROM runtime_custom_domain_claims c
       JOIN projects p ON p.id=c.project_id AND p.user_id=?
       ORDER BY c.is_primary DESC,c.hostname ASC LIMIT 200`,
    ).bind(customerId).all(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM operations WHERE user_id=?",
    ).bind(customerId).first<any>(),
    env.DB.prepare(
      `SELECT o.project_id,o.kind,o.status,o.created_at,o.started_at,o.finished_at,
        CASE WHEN o.error IS NULL OR TRIM(o.error)='' THEN 0 ELSE 1 END AS has_error
       FROM operations o WHERE o.user_id=? ORDER BY o.created_at DESC LIMIT 100`,
    ).bind(customerId).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total,MAX(t.created_at) AS last_activity
       FROM runtime_builder_turns t JOIN projects p ON p.id=t.project_id WHERE p.user_id=?`,
    ).bind(customerId).first<any>(),
    env.DB.prepare(
      `SELECT t.project_id,t.mode,t.created_at
       FROM runtime_builder_turns t JOIN projects p ON p.id=t.project_id
       WHERE p.user_id=? ORDER BY t.created_at DESC LIMIT 50`,
    ).bind(customerId).all(),
    env.DB.prepare(
      `SELECT r.project_id,r.deployment_url,r.created_at,l.subdomain_slug,
        l.custom_domain,l.custom_domain_status,l.custom_domain_ssl_status,
        l.custom_domain_secondary,l.custom_domain_secondary_status,l.custom_domain_secondary_ssl_status
       FROM runtime_releases r JOIN projects p ON p.id=r.project_id
       LEFT JOIN runtime_project_links l ON l.project_id=p.id
       WHERE p.user_id=? ORDER BY r.created_at DESC LIMIT 100`,
    ).bind(customerId).all(),
    env.DB.prepare(
      `SELECT n.project_id,n.public_url AS deployment_url,n.slug,n.created_at,n.status,
        l.custom_domain,l.custom_domain_status,l.custom_domain_ssl_status,
        l.custom_domain_secondary,l.custom_domain_secondary_status,l.custom_domain_secondary_ssl_status
       FROM native_publish_releases n
       LEFT JOIN runtime_project_links l ON l.project_id=n.project_id
       WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 100`,
    ).bind(customerId).all(),
    env.DB.prepare(
      `SELECT g.id,g.project_id,g.permission,g.granted_at_ms,g.expires_at_ms,g.revoked_at_ms,
        p.name AS project_name
       FROM support_access_grants g
       LEFT JOIN projects p ON p.id=g.project_id AND p.user_id=g.customer_user_id
       WHERE g.customer_user_id=? ORDER BY g.granted_at_ms DESC LIMIT 100`,
    ).bind(customerId).all(),
    env.DB.prepare(
      `SELECT s.id,s.grant_id,s.project_id,s.started_at_ms,s.last_access_at_ms,s.closed_at_ms,
        COALESCE(a.profile_name,a.display_name,a.username) AS operator_name,a.email AS operator_email,
        g.expires_at_ms,g.revoked_at_ms
       FROM support_access_sessions s
       JOIN support_access_grants g ON g.id=s.grant_id
       LEFT JOIN users a ON a.id=s.admin_user_id
       WHERE s.customer_user_id=? ORDER BY s.started_at_ms DESC LIMIT 100`,
    ).bind(customerId).all(),
    env.DB.prepare(
      `SELECT a.action,a.project_id,a.created_at,
        COALESCE(actor.profile_name,actor.display_name,actor.username) AS actor_name,actor.email AS actor_email,
        p.name AS project_name
       FROM audit_events a
       JOIN projects p ON p.id=a.project_id AND p.user_id=?
       LEFT JOIN users actor ON actor.id=a.actor_user_id
       WHERE a.action IN (
         'customer_support_access_granted','customer_support_access_revoked',
         'admin_support_session_opened','admin_support_resource_accessed','admin_support_session_closed'
       )
       ORDER BY a.created_at DESC LIMIT 100`,
    ).bind(customerId).all(),
  ]);
  const now = Date.now();
  const fetchedProjectRows = rows(projectsResult);
  const projectsHasMore = fetchedProjectRows.length > CUSTOMER_PROJECT_PAGE_SIZE;
  const projectRows = fetchedProjectRows.slice(0, CUSTOMER_PROJECT_PAGE_SIZE);
  const customDomainRows = rows(customDomainResult);
  const projects = projectRows.map((project) => {
    const domainCandidates = domainsForProject(project, customDomainRows);
    const customDomains = domainCandidates.map((domain) => ({
      hostname: domain.hostname,
      role: customDomainRows.find((claim) => claim.hostname === domain.hostname)?.role || null,
      status: domain.status || "Not tracked",
      sslStatus: domain.sslStatus || "Not tracked",
      isPrimary: Boolean(domain.isPrimary),
    }));
    const links = adminDeploymentLinks({
      storedUrl: project.deployment_url,
      slug: project.subdomain_slug,
      publicAppsEnabled: isLaunchPublicAppsEnabled(env),
      customDomains: domainCandidates,
    });
    return {
      id: Number(project.id),
      name: String(project.name || "Untitled project"),
      type: String(project.type || "project"),
      framework: String(project.framework || "Not tracked in product data"),
      projectStatus: String(project.status || "unknown"),
      buildStatus: project.latest_generation_status
        ? String(project.latest_generation_status)
        : "Not tracked in product data",
      createdAt: project.created_at ?? null,
      updatedAt: project.updated_at ?? null,
      deploymentStatus: links.diagnosticUrl ? "Deployment record exists" : "No deployment record",
      deploymentUrl: links.deploymentUrl,
      gatewayDiagnosticUrl: links.diagnosticUrl,
      deploymentUpdatedAt: project.deployment_updated_at ?? null,
      hostingProvider: project.hosting_provider || "Not tracked in product data",
      subdomainSlug: project.subdomain_slug || null,
      customDomains,
    };
  });
  const grants = rows(grantsResult).map((grant) => ({
    id: String(grant.id),
    projectId: Number(grant.project_id),
    projectName: grant.project_name ? String(grant.project_name) : "Project no longer available",
    permission: String(grant.permission),
    grantedAt: Number(grant.granted_at_ms),
    expiresAt: Number(grant.expires_at_ms),
    revokedAt: grant.revoked_at_ms == null ? null : Number(grant.revoked_at_ms),
    status: statusForGrant(grant, now),
  }));
  const sessions = rows(sessionsResult).map((session) => ({
    id: String(session.id),
    grantId: String(session.grant_id),
    projectId: Number(session.project_id),
    operatorName: session.operator_name ? String(session.operator_name) : "BuildCustom support",
    operatorEmail: session.operator_email ? String(session.operator_email) : null,
    startedAt: Number(session.started_at_ms),
    lastAccessAt: Number(session.last_access_at_ms),
    closedAt: session.closed_at_ms == null ? null : Number(session.closed_at_ms),
    status: session.closed_at_ms != null ? "closed" : statusForGrant(session, now),
  }));
  const projectLinks = rows(projectLinksResult);
  const rawReleases = [
    ...rows(nativeReleasesResult),
    ...rows(releasesResult).map((release) => ({ ...release, status: "published" })),
  ];
  const uniqueReleases = new Map<string, any>();
  for (const release of rawReleases) {
    const key = `${Number(release.project_id)}|${String(release.created_at || "")}`;
    if (!uniqueReleases.has(key)) uniqueReleases.set(key, release);
  }
  const releaseRows = [...uniqueReleases.values()]
    .sort((a, b) => Date.parse(String(b.created_at || "")) - Date.parse(String(a.created_at || "")));
  const deploymentHistoryHasMore = rows(nativeReleasesResult).length >= CUSTOMER_HISTORY_LIMIT
    || rows(releasesResult).length >= CUSTOMER_HISTORY_LIMIT
    || releaseRows.length > CUSTOMER_HISTORY_LIMIT;
  const deployments = releaseRows.slice(0, CUSTOMER_HISTORY_LIMIT).map((release) => {
    const project = projectLinks.find((row) => Number(row.project_id) === Number(release.project_id)) || release;
    const links = adminDeploymentLinks({
      storedUrl: release.deployment_url,
      slug: release.slug || project.subdomain_slug,
      publicAppsEnabled: isLaunchPublicAppsEnabled(env),
      customDomains: domainsForProject({ ...project, id: release.project_id }, customDomainRows),
    });
    return {
      projectId: Number(release.project_id),
      deploymentUrl: links.deploymentUrl,
      gatewayDiagnosticUrl: links.diagnosticUrl,
      createdAt: release.created_at ?? null,
      status: String(release.status || (links.diagnosticUrl ? "published" : "not published")),
    };
  });
  const customerCustomDomains = projectLinks.flatMap((project) =>
    domainsForProject(project, customDomainRows).map((domain) => ({
      projectId: Number(project.project_id),
      hostname: domain.hostname,
      role: customDomainRows.find((claim) => claim.hostname === domain.hostname)?.role || null,
      status: domain.status || "Not tracked",
      sslStatus: domain.sslStatus || "Not tracked",
      isPrimary: Boolean(domain.isPrimary),
    })),
  );
  const knownDomainKeys = new Set(customerCustomDomains.map((domain) =>
    `${domain.projectId}|${String(domain.hostname).toLowerCase()}`));
  for (const domain of customDomainRows) {
    const key = `${Number(domain.project_id)}|${String(domain.hostname).toLowerCase()}`;
    if (knownDomainKeys.has(key)) continue;
    knownDomainKeys.add(key);
    customerCustomDomains.push({
      projectId: Number(domain.project_id),
      hostname: String(domain.hostname),
      role: domain.role ? String(domain.role) : null,
      status: domain.status || "Not tracked",
      sslStatus: domain.ssl_status || "Not tracked",
      isPrimary: Number(domain.is_primary) === 1,
    });
  }
  const supportAuditRows = rows(supportAuditResult);
  return json({
    customer: {
      id: String(customer.id),
      name: String(customer.name || "Customer"),
      email: String(customer.email),
      signupDate: customer.created_at ?? null,
      accountStatus: String(customer.account_status || "active"),
      role: String(customer.role),
      productTier: customer.plan ? String(customer.plan) : "Not tracked in product data",
      emailVerification: "Not tracked in product data",
      lastLogin: "Not tracked in product data",
      authenticationProvider: "Not tracked in product data",
      credits: "Not tracked",
    },
    projects,
    projectPagination: {
      offset: projectOffset,
      pageSize: CUSTOMER_PROJECT_PAGE_SIZE,
      total: Number(projectCount?.total || 0),
      hasMore: projectsHasMore,
    },
    deployments,
    deploymentHistoryHasMore,
    hosting: {
      subscriptionStatus: "Not configured",
      hostingPlan: "Not configured",
      hostingStatus: "Not tracked in product data",
      projectsWithDeploymentRecords: Number(deploymentProjectCount?.total || 0),
      hostingStartDate: "Not tracked in product data",
      renewalDate: "Not tracked in product data",
      usage: "Not tracked in product data",
      customDomains: customerCustomDomains,
    },
    billing: {
      configured: false,
      subscription: "Not configured",
      paymentStatus: "Not configured",
      invoiceHistory: "Not configured",
    },
    supportTickets: {
      configured: false,
      label: "Not configured",
    },
    usage: {
      operationCount: Number(operationSummary?.total || 0),
      operations: rows(operationsResult).map((operation) => ({
        projectId: Number(operation.project_id),
        kind: String(operation.kind || "operation"),
        status: String(operation.status || "unknown"),
        createdAt: operation.created_at ?? null,
        startedAt: operation.started_at ?? null,
        finishedAt: operation.finished_at ?? null,
        failureDetails: Number(operation.has_error) === 1 ? "Withheld from support view" : null,
      })),
      builderTurnCount: Number(turnSummary?.total || 0),
      lastBuildActivityAt: turnSummary?.last_activity ?? null,
      buildActivity: rows(turnRows).map((turn) => ({
        projectId: Number(turn.project_id),
        mode: String(turn.mode || "build"),
        createdAt: turn.created_at ?? null,
      })),
      credits: "Not tracked",
    },
    supportAccess: {
      grants,
      sessions,
        auditHistory: supportAuditRows.map((event) => ({
          action: String(event.action),
          projectId: Number(event.project_id),
          projectName: String(event.project_name || "Project"),
          actorName: event.actor_name ? String(event.actor_name) : "BuildCustom support",
          actorEmail: event.actor_email ? String(event.actor_email) : null,
          createdAt: event.created_at ?? null,
        })),
        historyMayBeTruncated: grants.length >= CUSTOMER_HISTORY_LIMIT
          || sessions.length >= CUSTOMER_HISTORY_LIMIT
          || supportAuditRows.length >= CUSTOMER_HISTORY_LIMIT,
    },
  });
}

const activeSessionSql = `EXISTS(
  SELECT 1
  FROM support_access_sessions s
  JOIN support_access_grants g ON g.id=s.grant_id AND g.project_id=s.project_id AND g.customer_user_id=s.customer_user_id
  JOIN users c ON c.id=g.customer_user_id
  JOIN projects scoped_project ON scoped_project.id=g.project_id AND scoped_project.user_id=g.customer_user_id
  WHERE s.id=? AND s.admin_user_id=? AND s.project_id=?
    AND s.closed_at_ms IS NULL
    AND g.permission='read_only_diagnostics'
    AND g.revoked_at_ms IS NULL
    AND g.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    AND c.role='user' AND c.account_status='active'
)`;

async function openSupportSession(
  env: SupportEnv,
  request: Request,
  admin: SessionUser,
  customerId: string,
  grantId: string,
): Promise<Response> {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  if (!protectedMutation(env, request)) return json({ message: "A secure request is required." }, 403);
  const grant = await env.DB.prepare(
    `SELECT g.project_id FROM support_access_grants g
     JOIN users c ON c.id=g.customer_user_id
     JOIN projects p ON p.id=g.project_id AND p.user_id=g.customer_user_id
     WHERE g.id=? AND g.customer_user_id=? AND g.permission='read_only_diagnostics'
       AND g.revoked_at_ms IS NULL
       AND g.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
       AND c.role='user' AND c.account_status='active'`,
  ).bind(grantId, customerId).first<{ project_id: number }>();
  if (!grant) return json({ message: "Customer approval is required or has expired." }, 403);
  const sessionId = randomToken();
  const now = Date.now();
  const metadata = JSON.stringify({
    grantId,
    sessionId,
    permission: SUPPORT_SCOPE,
    outcome: "opened",
  });
  const result = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO support_access_sessions
        (id,grant_id,project_id,customer_user_id,admin_user_id,started_at_ms,last_access_at_ms,closed_at_ms,access_count)
       SELECT ?,g.id,g.project_id,g.customer_user_id,?,?,?,NULL,0
       FROM support_access_grants g
       JOIN users c ON c.id=g.customer_user_id
       JOIN projects p ON p.id=g.project_id AND p.user_id=g.customer_user_id
       WHERE g.id=? AND g.customer_user_id=? AND g.permission='read_only_diagnostics'
         AND g.revoked_at_ms IS NULL AND g.expires_at_ms>?
         AND c.role='user' AND c.account_status='active'`,
    ).bind(sessionId, admin.id, now, now, grantId, customerId, now),
    env.DB.prepare(
      `INSERT INTO audit_events(actor_user_id,action,project_id,metadata_json)
       SELECT ?, 'admin_support_session_opened', s.project_id, ?
       FROM support_access_sessions s
       JOIN support_access_grants g ON g.id=s.grant_id
       WHERE s.id=? AND s.admin_user_id=? AND s.grant_id=? AND g.customer_user_id=?`,
    ).bind(admin.id, metadata, sessionId, admin.id, grantId, customerId),
  ]);
  if (Number(result[0]?.meta?.changes || 0) !== 1) {
    return json({ message: "Customer approval is required or has expired." }, 403);
  }
  return json({ sessionId, projectId: Number(grant.project_id), permission: SUPPORT_SCOPE }, 201);
}

async function getSupportWorkspace(
  env: SupportEnv,
  admin: SessionUser,
  sessionId: string,
): Promise<Response> {
  const context = await env.DB.prepare(
    `SELECT s.id,s.grant_id,s.project_id,s.customer_user_id,s.started_at_ms,
      g.expires_at_ms,g.permission,COALESCE(c.profile_name,c.display_name,c.username) AS customer_name,c.email AS customer_email
     FROM support_access_sessions s
     JOIN support_access_grants g ON g.id=s.grant_id AND g.project_id=s.project_id AND g.customer_user_id=s.customer_user_id
     JOIN users c ON c.id=g.customer_user_id
     JOIN projects p ON p.id=g.project_id AND p.user_id=g.customer_user_id
     WHERE s.id=? AND s.admin_user_id=? AND s.closed_at_ms IS NULL
       AND g.permission='read_only_diagnostics' AND g.revoked_at_ms IS NULL
       AND g.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
       AND c.role='user' AND c.account_status='active'`,
  ).bind(sessionId, admin.id).first<any>();
  if (!context) return json({ message: "This support session is no longer authorized." }, 403);

  const projectId = Number(context.project_id);
  const guardParams = [sessionId, admin.id, projectId];
  const metadata = JSON.stringify({
    grantId: String(context.grant_id),
    sessionId,
    permission: SUPPORT_SCOPE,
    outcome: "allowed",
  });
  const result = await env.DB.batch([
    env.DB.prepare(
      `SELECT s.id,s.grant_id,s.project_id,s.started_at_ms,g.expires_at_ms,g.permission,
        COALESCE(c.profile_name,c.display_name,c.username) AS customer_name,c.email AS customer_email
       FROM support_access_sessions s
       JOIN support_access_grants g ON g.id=s.grant_id AND g.project_id=s.project_id AND g.customer_user_id=s.customer_user_id
       JOIN users c ON c.id=g.customer_user_id
       JOIN projects p ON p.id=g.project_id AND p.user_id=g.customer_user_id
       WHERE s.id=? AND s.admin_user_id=? AND s.project_id=? AND s.closed_at_ms IS NULL
         AND g.permission='read_only_diagnostics' AND g.revoked_at_ms IS NULL
         AND g.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
         AND c.role='user' AND c.account_status='active'`,
    ).bind(...guardParams),
    env.DB.prepare(
      `SELECT p.id,p.name,p.type,p.status,p.framework,p.created_at,p.updated_at,
        l.deployment_url,l.updated_at AS deployment_updated_at
       FROM projects p LEFT JOIN runtime_project_links l ON l.project_id=p.id
       WHERE p.id=? AND ${activeSessionSql}`,
    ).bind(projectId, ...guardParams),
    env.DB.prepare(
      `SELECT r.deployment_url,r.created_at
       FROM runtime_releases r
       WHERE r.project_id=? AND ${activeSessionSql}
       ORDER BY r.created_at DESC LIMIT 50`,
    ).bind(projectId, ...guardParams),
    env.DB.prepare(
      `SELECT o.kind,o.status,o.created_at,o.started_at,o.finished_at,
        CASE WHEN o.error IS NULL OR TRIM(o.error)='' THEN 0 ELSE 1 END AS has_error
       FROM operations o
       WHERE o.project_id=? AND ${activeSessionSql}
       ORDER BY o.created_at DESC LIMIT 50`,
    ).bind(projectId, ...guardParams),
    env.DB.prepare(
      `SELECT t.mode,t.created_at
       FROM runtime_builder_turns t
       WHERE t.project_id=? AND ${activeSessionSql}
       ORDER BY t.created_at DESC LIMIT 50`,
    ).bind(projectId, ...guardParams),
    env.DB.prepare(
      `SELECT COUNT(*) AS total,MAX(t.created_at) AS last_activity
       FROM runtime_builder_turns t
       WHERE t.project_id=? AND ${activeSessionSql}`,
    ).bind(projectId, ...guardParams),
    env.DB.prepare(
      `UPDATE support_access_sessions SET last_access_at_ms=?,access_count=access_count+1
       WHERE id=? AND admin_user_id=? AND project_id=? AND closed_at_ms IS NULL
         AND EXISTS(
           SELECT 1 FROM support_access_grants g
           JOIN users c ON c.id=g.customer_user_id
           JOIN projects p ON p.id=g.project_id AND p.user_id=g.customer_user_id
           WHERE g.id=support_access_sessions.grant_id AND g.project_id=support_access_sessions.project_id
             AND g.customer_user_id=support_access_sessions.customer_user_id
             AND g.permission='read_only_diagnostics' AND g.revoked_at_ms IS NULL
             AND g.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
             AND c.role='user' AND c.account_status='active'
         )`,
    ).bind(Date.now(), sessionId, admin.id, projectId),
    env.DB.prepare(
      `INSERT INTO audit_events(actor_user_id,action,project_id,metadata_json)
       SELECT ?, 'admin_support_resource_accessed', ?, ?
       WHERE ${activeSessionSql}`,
    ).bind(admin.id, projectId, metadata, ...guardParams),
    env.DB.prepare(
      `SELECT a.attempt_id,a.started_at_ms,a.finished_at_ms,a.status,a.last_stage,
        a.last_successful_stage,a.failure_stage,a.error_code,a.customer_message,
        a.provider,a.model_id,a.correlation_id
       FROM native_build_attempts a
       WHERE a.project_id=?
         AND a.user_id=(SELECT customer_user_id FROM support_access_sessions WHERE id=? AND admin_user_id=?)
         AND ${activeSessionSql}
       ORDER BY a.started_at_ms DESC LIMIT 50`,
    ).bind(projectId, sessionId, admin.id, ...guardParams),
    env.DB.prepare(
      `SELECT e.attempt_id,e.occurred_at_ms,e.event_type,e.stage,e.status,e.error_code,
        e.customer_message,e.provider_status,e.correlation_id
       FROM native_build_events e
       JOIN native_build_attempts a ON a.attempt_id=e.attempt_id
       WHERE a.project_id=?
         AND a.user_id=(SELECT customer_user_id FROM support_access_sessions WHERE id=? AND admin_user_id=?)
         AND ${activeSessionSql}
       ORDER BY e.occurred_at_ms DESC LIMIT 1000`,
    ).bind(projectId, sessionId, admin.id, ...guardParams),
  ]);
  const activeSession = rows(result[0])[0];
  const project = rows(result[1])[0];
  if (!activeSession || !project) return json({ message: "This support session is no longer authorized." }, 403);

  return json({
    session: {
      id: String(activeSession.id),
      grantId: String(activeSession.grant_id),
      projectId,
      permission: String(activeSession.permission),
      startedAt: Number(activeSession.started_at_ms),
      expiresAt: Number(activeSession.expires_at_ms),
    },
    customer: {
      name: String(activeSession.customer_name || "Customer"),
      email: String(activeSession.customer_email),
    },
    project: {
      id: Number(project.id),
      name: String(project.name || "Untitled project"),
      type: String(project.type || "project"),
      status: String(project.status || "unknown"),
      framework: String(project.framework || "Not tracked"),
      createdAt: project.created_at ?? null,
      updatedAt: project.updated_at ?? null,
      deploymentUrl: safePublicOrigin(project.deployment_url),
      deploymentStatus: safePublicOrigin(project.deployment_url) ? "published" : "not published",
      deploymentUpdatedAt: project.deployment_updated_at ?? null,
    },
    diagnostics: {
      deployments: rows(result[2]).map((release) => ({
        deploymentUrl: safePublicOrigin(release.deployment_url),
        createdAt: release.created_at ?? null,
        status: safePublicOrigin(release.deployment_url) ? "published" : "not published",
      })),
      operations: rows(result[3]).map((operation) => ({
        kind: String(operation.kind || "operation"),
        status: String(operation.status || "unknown"),
        createdAt: operation.created_at ?? null,
        startedAt: operation.started_at ?? null,
        finishedAt: operation.finished_at ?? null,
        failureDetails: Number(operation.has_error) === 1 ? "Withheld from support view" : null,
      })),
      buildActivity: rows(result[4]).map((turn) => ({
        mode: String(turn.mode || "build"),
        createdAt: turn.created_at ?? null,
      })),
      buildActivityTotal: Number(rows(result[5])[0]?.total || 0),
      lastBuildActivityAt: rows(result[5])[0]?.last_activity ?? null,
      buildAttempts: rows(result[8]).map((attempt) => ({
        attemptId: String(attempt.attempt_id),
        startedAt: Number(attempt.started_at_ms),
        finishedAt: attempt.finished_at_ms == null ? null : Number(attempt.finished_at_ms),
        status: String(attempt.status),
        lastStage: String(attempt.last_stage || ""),
        lastSuccessfulStage: attempt.last_successful_stage ? String(attempt.last_successful_stage) : null,
        failureStage: attempt.failure_stage ? String(attempt.failure_stage) : null,
        errorCode: attempt.error_code ? String(attempt.error_code) : null,
        customerMessage: attempt.customer_message ? String(attempt.customer_message) : null,
        provider: attempt.provider ? String(attempt.provider) : null,
        modelId: attempt.model_id ? String(attempt.model_id) : null,
        correlationId: attempt.correlation_id ? String(attempt.correlation_id) : null,
      })),
      buildEvents: rows(result[9]).map((event) => ({
        attemptId: String(event.attempt_id),
        occurredAt: Number(event.occurred_at_ms),
        eventType: String(event.event_type),
        stage: String(event.stage),
        status: String(event.status),
        errorCode: event.error_code ? String(event.error_code) : null,
        message: event.customer_message ? String(event.customer_message) : null,
        providerStatus: event.provider_status == null ? null : Number(event.provider_status),
        correlationId: event.correlation_id ? String(event.correlation_id) : null,
      })),
    },
    restrictions: {
      readOnly: true,
      sourceFilesIncluded: false,
      environmentVariablesIncluded: false,
      credentialsIncluded: false,
      unrelatedProjectsIncluded: false,
    },
  });
}

async function closeSupportSession(
  env: SupportEnv,
  request: Request,
  admin: SessionUser,
  sessionId: string,
): Promise<Response> {
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  if (!protectedMutation(env, request)) return json({ message: "A secure request is required." }, 403);
  const session = await env.DB.prepare(
    "SELECT id,project_id,closed_at_ms FROM support_access_sessions WHERE id=? AND admin_user_id=?",
  ).bind(sessionId, admin.id).first<any>();
  if (!session) return json({ message: "Support session not found." }, 404);
  if (session.closed_at_ms != null) return json({ success: true, closed: true });

  const closedAt = Date.now();
  const metadata = JSON.stringify({
    sessionId,
    outcome: "closed",
  });
  const result = await env.DB.batch([
    env.DB.prepare(
      "UPDATE support_access_sessions SET closed_at_ms=? WHERE id=? AND admin_user_id=? AND closed_at_ms IS NULL",
    ).bind(closedAt, sessionId, admin.id),
    env.DB.prepare(
      `INSERT INTO audit_events(actor_user_id,action,project_id,metadata_json)
       SELECT ?, 'admin_support_session_closed', ?, ?
       WHERE EXISTS(
         SELECT 1 FROM support_access_sessions
         WHERE id=? AND admin_user_id=? AND closed_at_ms=?
       )
       AND NOT EXISTS(
         SELECT 1 FROM audit_events WHERE action='admin_support_session_closed' AND metadata_json=?
       )`,
    ).bind(admin.id, Number(session.project_id), metadata, sessionId, admin.id, closedAt, metadata),
  ]);
  if (Number(result[0]?.meta?.changes || 0) !== 1) {
    return json({ message: "Support session could not be closed." }, 409);
  }
  return json({ success: true, closed: true, closedAt });
}

export async function handleAdminSupportAccessRoute(args: AdminSupportRouteArgs): Promise<Response | null> {
  const { request, env, url, admin } = args;
  const customerMatch = url.pathname.match(/^\/api\/admin\/customers\/([^/]+)$/);
  if (customerMatch) {
    if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);
    const customerId = decodedId(customerMatch[1]);
    if (!customerId) return json({ message: "Invalid customer ID." }, 400);
    const rawOffset = url.searchParams.get("projectOffset");
    const projectOffset = rawOffset === null ? 0 : Number(rawOffset);
    if (!Number.isSafeInteger(projectOffset) || projectOffset < 0 || projectOffset > 1_000_000) {
      return json({ message: "Invalid project page." }, 400);
    }
    return getAdminCustomerDetail(env, customerId, projectOffset);
  }

  const openMatch = url.pathname.match(/^\/api\/admin\/customers\/([^/]+)\/support-grants\/([^/]+)\/sessions$/);
  if (openMatch) {
    const customerId = decodedId(openMatch[1]);
    const grantId = decodedId(openMatch[2]);
    if (!customerId || !grantId) return json({ message: "Invalid support approval." }, 400);
    return openSupportSession(env, request, admin, customerId, grantId);
  }

  const supportSessionMatch = url.pathname.match(/^\/api\/admin\/support-sessions\/([^/]+)$/);
  if (supportSessionMatch) {
    const sessionId = decodedId(supportSessionMatch[1]);
    if (!sessionId) return json({ message: "Invalid support session." }, 400);
    if (request.method === "GET") return getSupportWorkspace(env, admin, sessionId);
    if (request.method === "POST") return closeSupportSession(env, request, admin, sessionId);
    return json({ message: "Method not allowed." }, 405);
  }

  return null;
}
