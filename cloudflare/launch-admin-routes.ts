import { hasValidCsrfToken, type SessionUser } from "./staging/auth";
import {
  checkRuntimeAvailability,
  hasVerifiedRuntimeEmailIdentity,
  resolveRuntimeProductUser,
} from "./staging/runtime-identity";

const OWNER_EMAIL = "support@buildcustom.ai";
const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

type LaunchAdminEnv = {
  DB: D1Database;
  AUTH_RUNTIME?: Fetcher;
  AUTH_RUNTIME_URL?: string;
  ENVIRONMENT?: string;
  CONTROL_PLANE_PROFILE?: string;
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

async function ownerBootstrapState(
  env: LaunchAdminEnv,
  request: Request,
  user: SessionUser,
) {
  const ownership = await hasVerifiedRuntimeEmailIdentity(env, request, OWNER_EMAIL);
  const owners = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM users WHERE role='super_admin'",
  ).first<{ count: number }>();
  const ownerAlreadyInitialized = Number(owners?.count || 0) > 0;
  let identitySettingsUrl: string | null = null;
  try {
    const runtimeUrl = new URL(env.AUTH_RUNTIME_URL || "");
    if (runtimeUrl.protocol === "https:") {
      identitySettingsUrl = new URL("/settings", runtimeUrl).toString();
    }
  } catch {
    identitySettingsUrl = null;
  }
  return {
    candidateEmail: OWNER_EMAIL,
    identitySettingsUrl,
    accountStatus: user.account_status || "active",
    alreadyAdmin: user.role === "super_admin",
    ownerAlreadyInitialized,
    emailOwnershipVerified: ownership.verified,
    verificationServiceAvailable: ownership.available,
    eligible: user.role === "user"
      && user.account_status !== "suspended"
      && ownership.verified
      && !ownerAlreadyInitialized,
  };
}

async function handleOwnerBootstrap(
  env: LaunchAdminEnv,
  request: Request,
  input: Record<string, unknown>,
): Promise<Response> {
  const user = await resolveRuntimeProductUser(env, request);
  if (!user) return json({ message: "Unauthorized" }, 401);
  if (user.account_status === "suspended") return json({ message: "Account access is suspended." }, 403);
  if (user.email.trim().toLowerCase() !== OWNER_EMAIL) {
    return json({ message: "Owner authorization is restricted to the configured owner account." }, 403);
  }

  if (request.method === "GET") {
    return json(await ownerBootstrapState(env, request, user));
  }
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  if (!hasValidCsrfToken(request)) return json({ message: "A secure request is required." }, 403);
  if (input.confirmEmail !== OWNER_EMAIL) {
    return json({ message: "Type the exact owner email to confirm authorization." }, 400);
  }
  if (user.role !== "user") {
    return json({ message: "Owner bootstrap is only available before an owner is initialized." }, 409);
  }

  const ownership = await hasVerifiedRuntimeEmailIdentity(env, request, OWNER_EMAIL);
  if (!ownership.available) {
    return json({ message: "Could not verify a linked identity. Try again later." }, 503);
  }
  if (!ownership.verified) {
    return json({
      message: "A provider-verified identity matching the owner email is required. The email/password signup flag is not accepted as proof.",
    }, 403);
  }

  const result = await env.DB.prepare(
    "UPDATE users SET role='super_admin' WHERE id=? AND lower(email)=? AND role='user' AND account_status='active' AND NOT EXISTS (SELECT 1 FROM users WHERE role='super_admin')",
  ).bind(user.id, OWNER_EMAIL).run();
  if (Number(result.meta?.changes || 0) !== 1) {
    return json({ message: "Owner bootstrap is no longer available for this account." }, 409);
  }

  await env.DB.prepare(
    "INSERT INTO audit_events(actor_user_id,action,metadata_json) VALUES(?,?,?)",
  ).bind(user.id, "initial_owner_bootstrap", JSON.stringify({ method: "verified-linked-identity" })).run();

  return json({ success: true, role: "super_admin" });
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
    `SELECT u.id,COALESCE(u.display_name,u.username) AS name,u.email,u.plan,u.role,u.account_status,u.created_at,
      (SELECT COUNT(*) FROM projects p WHERE p.user_id=u.id) AS project_count,
      (SELECT COUNT(*) FROM operations o WHERE o.user_id=u.id) AS operation_count,
      (SELECT COUNT(*) FROM runtime_builder_turns t JOIN projects tp ON tp.id=t.project_id WHERE tp.user_id=u.id) AS builder_turn_count
     FROM users u
     WHERE u.role='user' AND (?='' OR u.email LIKE ? COLLATE NOCASE OR COALESCE(u.display_name,u.username) LIKE ? COLLATE NOCASE)
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

function safeDeploymentUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

async function getDeployments(env: LaunchAdminEnv) {
  const result = await env.DB.prepare(
    `SELECT p.id,p.name,p.type,p.status,p.updated_at,u.display_name AS owner_name,u.email AS owner_email,
      l.hosting_provider,l.deployment_url
     FROM projects p
     JOIN users u ON u.id=p.user_id
     JOIN runtime_project_links l ON l.project_id=p.id
     WHERE u.role='user' AND l.deployment_url IS NOT NULL AND TRIM(l.deployment_url)<>''
     ORDER BY l.updated_at DESC LIMIT 100`,
  ).all();
  const deployments = (result.results || []).map((row: any) => ({
    projectId: row.id,
    projectName: row.name,
    projectType: row.type,
    projectStatus: row.status,
    updatedAt: row.updated_at,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    hostingProvider: row.hosting_provider,
    deploymentUrl: safeDeploymentUrl(row.deployment_url),
  }));
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
  const accountStatus = input.accountStatus;
  if (accountStatus !== "active" && accountStatus !== "suspended") {
    return json({ message: "Account status must be active or suspended." }, 400);
  }
  if (customerId === admin.id) return json({ message: "You cannot change your own account status." }, 409);
  const target = await env.DB.prepare("SELECT id,role FROM users WHERE id=?")
    .bind(customerId).first<{ id: string; role: string }>();
  if (!target) return json({ message: "Customer not found." }, 404);
  if (target.role !== "user") {
    return json({ message: "Owner accounts cannot be changed from customer status controls." }, 409);
  }

  await env.DB.prepare("UPDATE users SET account_status=? WHERE id=? AND role='user'")
    .bind(accountStatus, customerId).run();
  await env.DB.prepare(
    "INSERT INTO audit_events(actor_user_id,action,metadata_json) VALUES(?,?,?)",
  ).bind(admin.id, "admin_account_status_changed", JSON.stringify({
    targetUserId: customerId,
    accountStatus,
  })).run();
  return json({ success: true, accountStatus });
}

export async function handleLaunchAdminRoute(args: {
  request: Request;
  env: LaunchAdminEnv;
  url: URL;
  input: Record<string, unknown>;
}): Promise<Response | null> {
  const { request, env, url, input } = args;
  if (!url.pathname.startsWith("/api/admin/")) return null;

  if (url.pathname === "/api/admin/owner-bootstrap") {
    return handleOwnerBootstrap(env, request, input);
  }

  const auth = await requireAdmin(env, request);
  if ("response" in auth) return auth.response;

  if (url.pathname === "/api/admin/overview" && request.method === "GET") {
    return json(await getOverview(env));
  }
  if (url.pathname === "/api/admin/health" && request.method === "GET") {
    return json(await getHealth(env));
  }
  if (url.pathname === "/api/admin/customers" && request.method === "GET") {
    return json(await getCustomers(env, url));
  }
  if (url.pathname === "/api/admin/deployments" && request.method === "GET") {
    return json(await getDeployments(env));
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
