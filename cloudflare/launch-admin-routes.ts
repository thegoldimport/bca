import { assertOrigin, hasValidCsrfToken, type SessionUser } from "./staging/auth";
import {
  checkRuntimeAvailability,
  resolveRuntimeProductUser,
} from "./staging/runtime-identity";
import { handleOwnerBootstrapRoute } from "./owner-bootstrap";
import { handleAdminSupportAccessRoute } from "./support-access-routes";
import { handleAdminSupportTicketRoute } from "./support-ticket-routes";
import { adminDeploymentLinks, type AdminCustomDomain } from "./admin-deployment-url";

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});
const INITIAL_OWNER_EMAIL = "support@buildcustom.ai";

type LaunchAdminEnv = {
  DB: D1Database;
  AUTH_RUNTIME?: Fetcher;
  AUTH_RUNTIME_URL?: string;
  ENVIRONMENT?: string;
  CONTROL_PLANE_PROFILE?: string;
  CONTROL_PLANE_ALLOWED_ORIGIN?: string;
  PUBLIC_GENERATED_APPS_ENABLED?: string;
  OWNER_BOOTSTRAP_SECRET?: string;
  EMAIL?: { send(message: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> };
};

type AuthorizedUser = { user: SessionUser } | { response: Response };

async function requireAdmin(env: LaunchAdminEnv, request: Request): Promise<AuthorizedUser> {
  const user = await resolveRuntimeProductUser(env, request);
  if (!user) return { response: json({ message: "Unauthorized" }, 401) };
  if (user.account_status === "suspended") {
    return { response: json({ message: "Account access is suspended." }, 403) };
  }
  if (user.role !== "super_admin") {
    return { response: json({ message: "Admin access required." }, 403) };
  }
  return { user };
}

async function getHealth(env: LaunchAdminEnv) {
  let database: "available" | "unavailable" = "unavailable";
  let runtime: "available" | "unavailable" = "unavailable";
  try {
    const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (row?.ok === 1) database = "available";
  } catch {
    database = "unavailable";
  }
  if (await checkRuntimeAvailability(env)) runtime = "available";
  return { checkedAt: new Date().toISOString(), database, runtime };
}

async function getOverview(env: LaunchAdminEnv) {
  const [customers, projects, deployments, operations, turns, health] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN account_status='active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN account_status='suspended' THEN 1 ELSE 0 END) AS suspended FROM users WHERE role='user'",
    ).first<{ total: number; active: number; suspended: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM projects p JOIN users u ON u.id=p.user_id WHERE u.role='user'",
    ).first<{ total: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM runtime_project_links l JOIN projects p ON p.id=l.project_id JOIN users u ON u.id=p.user_id WHERE u.role='user' AND l.deployment_url IS NOT NULL AND TRIM(l.deployment_url)<>''",
    ).first<{ total: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM operations o JOIN users u ON u.id=o.user_id WHERE u.role='user' AND o.created_at >= datetime('now','-30 days')",
    ).first<{ total: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM runtime_builder_turns t JOIN projects p ON p.id=t.project_id JOIN users u ON u.id=p.user_id WHERE u.role='user' AND t.created_at >= datetime('now','-30 days')",
    ).first<{ total: number }>(),
    getHealth(env),
  ]);
  return {
    stats: {
      customers: Number(customers?.total || 0),
      activeCustomers: Number(customers?.active || 0),
      suspendedCustomers: Number(customers?.suspended || 0),
      projects: Number(projects?.total || 0),
      deployedProjects: Number(deployments?.total || 0),
      operationsLast30Days: Number(operations?.total || 0),
      builderTurnsLast30Days: Number(turns?.total || 0),
    },
    health,
    billing: { configured: false, label: "Not configured" },
    credits: { tracked: false, label: "Not tracked in product data" },
  };
}

async function getCustomers(env: LaunchAdminEnv, url: URL) {
  const search = (url.searchParams.get("search") || "").trim().slice(0, 100);
  const limit = 100;
  const pattern = `%${search}%`;
  const results = await env.DB.prepare(
    `SELECT u.id,COALESCE(u.profile_name,u.display_name,u.username) AS name,u.email,u.plan,u.role,u.account_status,u.created_at,
      (SELECT COUNT(*) FROM projects p WHERE p.user_id=u.id) AS project_count,
      (SELECT COUNT(*) FROM operations o WHERE o.user_id=u.id) AS operation_count,
      (SELECT COUNT(*) FROM runtime_builder_turns t JOIN projects tp ON tp.id=t.project_id WHERE tp.user_id=u.id) AS builder_turn_count
     FROM users u
     WHERE u.role='user' AND (?='' OR u.email LIKE ? COLLATE NOCASE OR COALESCE(u.profile_name,u.display_name,u.username) LIKE ? COLLATE NOCASE)
     ORDER BY u.created_at DESC LIMIT ?`,
  ).bind(search, pattern, pattern, limit).all();
  const customers = (results.results || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    plan: row.plan,
    role: row.role,
    accountStatus: row.account_status,
    createdAt: row.created_at,
    projectCount: Number(row.project_count || 0),
    operationCount: Number(row.operation_count || 0),
    builderTurnCount: Number(row.builder_turn_count || 0),
    creditsTracked: false,
  }));
  return { customers, limit };
}

async function getCustomerProjects(env: LaunchAdminEnv, customerId: string) {
  const projects = await env.DB.prepare(
    `SELECT id,name,type,status,framework,created_at,updated_at
     FROM projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 200`,
  ).bind(customerId).all();
  return {
    projects: (projects.results || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      framework: row.framework,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  };
}

function customerDomains(row: any): AdminCustomDomain[] {
  return [
    {
      hostname: row.primary_claim_hostname,
      status: row.primary_claim_status,
      sslStatus: row.primary_claim_ssl_status,
      isPrimary: true,
    },
    {
      hostname: row.custom_domain,
      status: row.custom_domain_status,
      sslStatus: row.custom_domain_ssl_status,
      isPrimary: true,
    },
    {
      hostname: row.secondary_claim_hostname,
      status: row.secondary_claim_status,
      sslStatus: row.secondary_claim_ssl_status,
      isPrimary: false,
    },
    {
      hostname: row.custom_domain_secondary,
      status: row.custom_domain_secondary_status,
      sslStatus: row.custom_domain_secondary_ssl_status,
      isPrimary: false,
    },
  ].filter((domain) => typeof domain.hostname === "string" && domain.hostname.trim());
}

function publicAppsEnabled(env: LaunchAdminEnv): boolean {
  return env.CONTROL_PLANE_PROFILE === "launch" && env.PUBLIC_GENERATED_APPS_ENABLED === "true";
}

async function getProjects(env: LaunchAdminEnv, url: URL) {
  const search = (url.searchParams.get("search") || "").trim().slice(0, 100);
  const pattern = `%${search}%`;
  const result = await env.DB.prepare(
    `SELECT p.id,p.user_id,p.name,p.type,p.status,p.framework,p.created_at,p.updated_at,
       COALESCE(u.profile_name,u.display_name,u.username) AS owner_name,u.email AS owner_email,
       l.hosting_provider,l.deployment_url,l.subdomain_slug,
       l.custom_domain,l.custom_domain_status,l.custom_domain_ssl_status,
       l.custom_domain_secondary,l.custom_domain_secondary_status,l.custom_domain_secondary_ssl_status,
       (SELECT c.hostname FROM runtime_custom_domain_claims c WHERE c.project_id=p.id ORDER BY c.is_primary DESC,c.hostname ASC LIMIT 1) AS primary_claim_hostname,
       (SELECT c.status FROM runtime_custom_domain_claims c WHERE c.project_id=p.id ORDER BY c.is_primary DESC,c.hostname ASC LIMIT 1) AS primary_claim_status,
       (SELECT c.ssl_status FROM runtime_custom_domain_claims c WHERE c.project_id=p.id ORDER BY c.is_primary DESC,c.hostname ASC LIMIT 1) AS primary_claim_ssl_status,
       (SELECT c.hostname FROM runtime_custom_domain_claims c WHERE c.project_id=p.id AND c.is_primary=0 ORDER BY c.hostname ASC LIMIT 1) AS secondary_claim_hostname,
       (SELECT c.status FROM runtime_custom_domain_claims c WHERE c.project_id=p.id AND c.is_primary=0 ORDER BY c.hostname ASC LIMIT 1) AS secondary_claim_status,
       (SELECT c.ssl_status FROM runtime_custom_domain_claims c WHERE c.project_id=p.id AND c.is_primary=0 ORDER BY c.hostname ASC LIMIT 1) AS secondary_claim_ssl_status
     FROM projects p
     JOIN users u ON u.id=p.user_id
     LEFT JOIN runtime_project_links l ON l.project_id=p.id
     WHERE u.role='user'
       AND (?='' OR p.name LIKE ? COLLATE NOCASE
         OR COALESCE(u.profile_name,u.display_name,u.username) LIKE ? COLLATE NOCASE
         OR u.email LIKE ? COLLATE NOCASE)
     ORDER BY p.updated_at DESC LIMIT 200`,
  ).bind(search, pattern, pattern, pattern).all();
  return {
    projects: (result.results || []).map((row: any) => {
      const links = adminDeploymentLinks({
        storedUrl: row.deployment_url,
        slug: row.subdomain_slug,
        publicAppsEnabled: publicAppsEnabled(env),
        customDomains: customerDomains(row),
      });
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        status: row.status,
        framework: row.framework,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ownerId: row.user_id,
        ownerName: row.owner_name,
        ownerEmail: row.owner_email,
        deploymentStatus: links.diagnosticUrl ? "Deployment record exists" : "No deployment record",
        hostingProvider: row.hosting_provider || null,
        publishedUrl: links.deploymentUrl,
        gatewayDiagnosticUrl: links.diagnosticUrl,
        subdomainSlug: row.subdomain_slug || null,
        customDomains: customerDomains(row).map((domain) => ({
          hostname: domain.hostname,
          status: domain.status || "Not tracked",
          sslStatus: domain.sslStatus || "Not tracked",
        })),
      };
    }),
  };
}

async function getDeployments(env: LaunchAdminEnv, projectId: number | null) {
  const projectFilter = projectId === null ? "" : " AND p.id=?";
  const statement = env.DB.prepare(
    `SELECT p.id,p.name,p.type,p.status,p.updated_at,u.display_name AS owner_name,u.email AS owner_email,
      l.hosting_provider,l.deployment_url,l.subdomain_slug,
      l.custom_domain,l.custom_domain_status,l.custom_domain_ssl_status,
      l.custom_domain_secondary,l.custom_domain_secondary_status,l.custom_domain_secondary_ssl_status,
      (SELECT c.hostname FROM runtime_custom_domain_claims c WHERE c.project_id=p.id ORDER BY c.is_primary DESC,c.hostname ASC LIMIT 1) AS primary_claim_hostname,
      (SELECT c.status FROM runtime_custom_domain_claims c WHERE c.project_id=p.id ORDER BY c.is_primary DESC,c.hostname ASC LIMIT 1) AS primary_claim_status,
      (SELECT c.ssl_status FROM runtime_custom_domain_claims c WHERE c.project_id=p.id ORDER BY c.is_primary DESC,c.hostname ASC LIMIT 1) AS primary_claim_ssl_status,
      (SELECT c.hostname FROM runtime_custom_domain_claims c WHERE c.project_id=p.id AND c.is_primary=0 ORDER BY c.hostname ASC LIMIT 1) AS secondary_claim_hostname,
      (SELECT c.status FROM runtime_custom_domain_claims c WHERE c.project_id=p.id AND c.is_primary=0 ORDER BY c.hostname ASC LIMIT 1) AS secondary_claim_status,
      (SELECT c.ssl_status FROM runtime_custom_domain_claims c WHERE c.project_id=p.id AND c.is_primary=0 ORDER BY c.hostname ASC LIMIT 1) AS secondary_claim_ssl_status
     FROM projects p
     JOIN users u ON u.id=p.user_id
     JOIN runtime_project_links l ON l.project_id=p.id
     WHERE u.role='user' AND l.deployment_url IS NOT NULL AND TRIM(l.deployment_url)<>''${projectFilter}
     ORDER BY l.updated_at DESC LIMIT 100`,
  );
  const result = await (projectId === null ? statement : statement.bind(projectId)).all();
  const deployments = (result.results || []).map((row: any) => {
    const domains = customerDomains(row);
    const links = adminDeploymentLinks({
      storedUrl: row.deployment_url,
      slug: row.subdomain_slug,
      publicAppsEnabled: publicAppsEnabled(env),
      customDomains: domains,
    });
    return {
      projectId: row.id,
      projectName: row.name,
      projectType: row.type,
      projectStatus: row.status,
      updatedAt: row.updated_at,
      ownerName: row.owner_name,
      ownerEmail: row.owner_email,
      hostingProvider: row.hosting_provider,
      deploymentUrl: links.deploymentUrl,
      gatewayDiagnosticUrl: links.diagnosticUrl,
      subdomainSlug: row.subdomain_slug || null,
      customDomains: domains.map((domain) => ({
        hostname: domain.hostname,
        status: domain.status || "Not tracked",
        sslStatus: domain.sslStatus || "Not tracked",
      })),
    };
  });
  return { deployments };
}

async function updateCustomerStatus(
  env: LaunchAdminEnv,
  request: Request,
  admin: SessionUser,
  customerId: string,
  input: Record<string, unknown>,
): Promise<Response> {
  if (request.method !== "PATCH") return json({ message: "Method not allowed." }, 405);
  if (!hasValidCsrfToken(request)) return json({ message: "A secure request is required." }, 403);
  try {
    assertOrigin(request, env.CONTROL_PLANE_ALLOWED_ORIGIN || "https://app.buildcustom.ai");
  } catch {
    return json({ message: "A secure request is required." }, 403);
  }
  const accountStatus = input.accountStatus;
  if (accountStatus !== "active" && accountStatus !== "suspended") {
    return json({ message: "Account status must be active or suspended." }, 400);
  }
  if (customerId === admin.id) return json({ message: "You cannot change your own account status." }, 409);
  const target = await env.DB.prepare("SELECT id,role,email FROM users WHERE id=?")
    .bind(customerId).first<{ id: string; role: string; email: string }>();
  if (!target) return json({ message: "Customer not found." }, 404);
  if (target.role !== "user" || target.email?.trim().toLowerCase() === INITIAL_OWNER_EMAIL) {
    return json({ message: "Owner accounts cannot be changed from customer status controls." }, 409);
  }

  const result = await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET account_status=? WHERE id=? AND role='user' AND account_status<>?",
    ).bind(accountStatus, customerId, accountStatus),
    env.DB.prepare(
      "INSERT INTO audit_events(actor_user_id,action,metadata_json) SELECT ?,?,? WHERE changes()=1",
    ).bind(admin.id, "admin_account_status_changed", JSON.stringify({
      targetUserId: customerId,
      accountStatus,
    })),
  ]);
  if (Number(result[0]?.meta?.changes || 0) !== 1) {
    const current = await env.DB.prepare("SELECT id,role FROM users WHERE id=? AND role='user'")
      .bind(customerId).first();
    if (!current) return json({ message: "Customer status could not be changed." }, 409);
  }
  return json({ success: true, accountStatus });
}

export async function handleLaunchAdminRoute(args: {
  request: Request;
  env: LaunchAdminEnv;
  url: URL;
  input: Record<string, unknown>;
  allowedOrigin?: string;
}): Promise<Response | null> {
  const { request, env, url, input, allowedOrigin } = args;
  if (!url.pathname.startsWith("/api/admin/")) return null;

  if (url.pathname === "/api/admin/owner-bootstrap") {
    return handleOwnerBootstrapRoute({ env, request, url, input });
  }
  if (url.pathname.startsWith("/api/admin/owner-bootstrap/")) {
    return handleOwnerBootstrapRoute({ env, request, url, input });
  }

  const auth = await requireAdmin(env, request);
  if ("response" in auth) return auth.response;

  const supportResponse = await handleAdminSupportAccessRoute({
    request,
    env,
    url,
    input,
    admin: auth.user,
    allowedOrigin,
  });
  if (supportResponse) return supportResponse;
  const supportTicketResponse = await handleAdminSupportTicketRoute({
    request,
    env,
    url,
    input,
    admin: auth.user,
  });
  if (supportTicketResponse) return supportTicketResponse;

  if (url.pathname === "/api/admin/overview" && request.method === "GET") {
    return json(await getOverview(env));
  }
  if (url.pathname === "/api/admin/health" && request.method === "GET") {
    return json(await getHealth(env));
  }
  if (url.pathname === "/api/admin/customers" && request.method === "GET") {
    return json(await getCustomers(env, url));
  }
  if (url.pathname === "/api/admin/projects" && request.method === "GET") {
    return json(await getProjects(env, url));
  }
  if (url.pathname === "/api/admin/deployments" && request.method === "GET") {
    const projectIdParam = url.searchParams.get("projectId");
    if (projectIdParam !== null && (!/^[1-9]\d*$/.test(projectIdParam)
      || !Number.isSafeInteger(Number(projectIdParam)))) {
      return json({ message: "Project id must be a positive integer." }, 400);
    }
    return json(await getDeployments(env, projectIdParam === null ? null : Number(projectIdParam)));
  }

  const statusMatch = url.pathname.match(/^\/api\/admin\/customers\/([^/]+)\/status$/);
  if (statusMatch) {
    let customerId: string;
    try {
      customerId = decodeURIComponent(statusMatch[1]);
    } catch {
      return json({ message: "Invalid customer ID." }, 400);
    }
    if (!customerId || customerId.length > 128) return json({ message: "Invalid customer ID." }, 400);
    return updateCustomerStatus(env, request, auth.user, customerId, input);
  }

  const projectsMatch = url.pathname.match(/^\/api\/admin\/customers\/([^/]+)\/projects$/);
  if (projectsMatch && request.method === "GET") {
    let customerId: string;
    try {
      customerId = decodeURIComponent(projectsMatch[1]);
    } catch {
      return json({ message: "Invalid customer ID." }, 400);
    }
    if (!customerId || customerId.length > 128) return json({ message: "Invalid customer ID." }, 400);
    const customer = await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='user'").bind(customerId).first();
    if (!customer) return json({ message: "Customer not found." }, 404);
    return json(await getCustomerProjects(env, customerId));
  }

  return json({ message: "Not found" }, 404);
}
