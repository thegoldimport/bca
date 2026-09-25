import bcrypt from "bcryptjs";
import { assertOrigin, createSession, expiredSessionCookie, resolveSession, revokeSession, sessionCookie } from "./staging/auth";
import { assertControlPlaneEnvironment, assertSafeStagingTarget } from "./staging/boundary";
import { ProjectOperationDO } from "./staging/project-do";
import { createVibeSdkAdapter, VibeSdkAdapterError, type VibeSdkImage } from "./staging/vibesdk-adapter";
import { handleAdminRoute } from "./admin-routes";
import { handleContentRoute } from "./content-routes";
import { handleDomainRoute } from "./domain-routes";
import { deleteProjectWithRoutes, deploymentScriptName, routeMetadata, writePublishedRoute } from "./published-routes";
import { capturePreviewImage, imageDataUri, previewImageKey, verifyPublicHostnameRoute, type BrowserRunBinding } from "./staging/preview-image";
import { StagingPublishNotReadyError, waitForStagingAppReady } from "./staging/published-readiness";
import { handleStagingCustomerAuth, resolveRuntimeProductUser, RuntimeIdentityError } from "./staging/runtime-identity";

// Cloudflare requires the historical class export while its staging namespace exists.
// It has no active binding and is not used by the simplified control plane.
export { ProjectOperationDO };

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  STAGING_ROUTES: KVNamespace;
  ENVIRONMENT: string;
  STAGING_RUNTIME_URL: string;
  VIBESDK_RUNTIME_URL?: string;
  VIBESDK_API_KEY?: string;
  VIBESDK_RUNTIME: Fetcher;
  AUTH_RUNTIME?: Fetcher;
  AUTH_RUNTIME_URL?: string;
  STAGING_ROUTE_KV_ID: string;
  STAGING_DISPATCH_NAMESPACE: string;
  STAGING_ALLOWED_ORIGIN: string;
  CONTROL_PLANE_ALLOWED_ORIGIN?: string;
  CONTROL_PLANE_ROUTE_KV_ID?: string;
  CONTROL_PLANE_DISPATCH_NAMESPACE?: string;
  STAGING_LOGIN_ENABLED: string;
  STAGING_REGISTRATION_ENABLED?: string;
  RUNTIME_OPERATIONS_ENABLED: string;
  STAGING_ALLOWED_DOMAIN_SUFFIXES?: string;
  GOOGLE_AI_STUDIO_API_KEY?: string;
  BROWSER?: BrowserRunBinding;
  STAGING_MANAGED_GATEWAY_URL?: string;
  STAGING_MANAGED_HOSTNAME_SUFFIX?: string;
  STAGING_GATEWAY?: Fetcher;
};

const attempts = new Map<string, { count: number; reset: number }>();
const reservedSlugs = new Set(["www", "api", "app", "apps", "admin", "billing", "support", "status", "docs", "mail", "customers"]);
const STAGING_GATEWAY_HOST = "buildcustom-apps-gateway-staging.thegoldimport.workers.dev";
const json = (data: unknown, init: ResponseInit = {}) => Response.json(data, { headers: { "Cache-Control": "no-store", ...init.headers }, ...init });
const readBody = async (request: Request) => await request.json().catch(() => ({})) as Record<string, unknown>;
export const serializeUser = (row: any) => ({ id: row.id, username: row.display_name || row.username, email: row.email, plan: row.plan || "free", role: row.role, createdAt: row.created_at || row.createdAt });
const jsonArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
export const serializeProject = (row: any) => ({
  id: row.id,
  userId: row.user_id ?? row.userId,
  name: row.name,
  type: row.type,
  status: row.status,
  description: row.description,
  framework: row.framework,
  url: row.url,
  createdAt: row.created_at ?? row.createdAt,
  updatedAt: row.updated_at ?? row.updatedAt,
  agentId: row.agent_id ?? row.agentId ?? null,
  previewUrl: row.preview_url ?? row.previewUrl ?? null,
  deploymentUrl: row.deployment_url ?? row.deploymentUrl ?? null,
  previewImageUrl: row.has_preview_image && (row.deployment_url ?? row.deploymentUrl)
    ? `/api/public/projects/${row.id}/preview-image?v=${encodeURIComponent(row.seo_updated_at || "")}` : null,
});
export const serializeTurn = (row: any) => ({
  id: row.id,
  projectId: row.project_id ?? row.projectId,
  mode: row.mode,
  prompt: row.prompt,
  response: row.response,
  changedFiles: jsonArray(row.changed_files ?? row.changedFiles),
  activity: jsonArray(row.activity),
  commitHash: row.commit_hash ?? row.commitHash ?? null,
  createdAt: row.created_at ?? row.createdAt,
});
export const serializeRelease = (row: any) => ({
  id: row.id,
  projectId: row.project_id ?? row.projectId,
  commitHash: row.commit_hash ?? row.commitHash,
  deploymentUrl: row.deployment_url ?? row.deploymentUrl,
  createdAt: row.created_at ?? row.createdAt,
});
export const canPublishInStaging = (role: unknown): boolean => role === "super_admin";
export const isReadOnlyRuntimeOperation = (method: string, operation: string): boolean => method === "GET" && (
  operation === "status"
  || operation === "files"
  || operation === "files/content"
  || operation === "turns"
  || operation === "publishing-settings"
  || operation === "releases"
  || operation === "console"
  || operation === "domains"
  || operation === "custom-domain"
  || operation === "application-domain"
);

function rateLimit(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  if (attempts.size > 10_000) {
    for (const [candidate, entry] of attempts) if (entry.reset <= now) attempts.delete(candidate);
    if (attempts.size > 10_000) attempts.delete(attempts.keys().next().value as string);
  }
  const current = attempts.get(key);
  if (!current || current.reset <= now) { attempts.set(key, { count: 1, reset: now + windowMs }); return true; }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}
function cleanSlug(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "";
}
function validSlug(value: string): boolean { return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) && !reservedSlugs.has(value); }
function projectInput(input: Record<string, unknown>, fallback = "Project1") {
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 120) : fallback;
  const type = typeof input.type === "string" ? input.type.slice(0, 40) : "website";
  const description = typeof input.description === "string" ? input.description.slice(0, 2000) : "";
  const framework = typeof input.framework === "string" && input.framework.trim() ? input.framework.trim().slice(0, 120) : "React + TailwindCSS";
  return { name, type, description, framework };
}
function imageInput(input: unknown): VibeSdkImage[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 4) throw new Error("Attach no more than 4 images at a time");
  let total = 0;
  return input.map((image: any) => {
    const size = Number(image?.size);
    if (!image || !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType) || typeof image.id !== "string" || typeof image.filename !== "string" || image.filename.length > 255 || typeof image.base64Data !== "string" || image.base64Data.length > 5_600_000 || !Number.isFinite(size) || size < 0 || size > 4_000_000) throw new Error("Attach PNG, JPEG, or WebP images up to 4 MB each");
    total += size;
    return { id: image.id, filename: image.filename, mimeType: image.mimeType, base64Data: image.base64Data, size };
  });
}
function safePath(value: string | null): string {
  if (!value || value.includes("..") || value.startsWith("/") || value.includes("\\")) throw new Error("A safe file path is required");
  return value;
}
export function projectIdFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/api\/projects\/(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : null;
}
function runtimeError(error: unknown): Response {
  if (error instanceof VibeSdkAdapterError) return json({ message: error.message, code: error.code }, { status: error.status });
  if (error instanceof RuntimeIdentityError) return json({ message: error.message }, { status: error.status });
  return json({ message: error instanceof Error ? error.message : "Request failed" }, { status: 400 });
}

export function managedStagingPublishUrl(gateway: string, slug: string, hostnameSuffix?: string): string {
  if (hostnameSuffix === "staging.buildcustom.ai") return `https://${slug}.${hostnameSuffix}/`;
  return `${gateway.replace(/\/+$/, "")}/${slug}/`;
}

export function hasExactStagingGatewayConfig(url: string | undefined, gateway: Fetcher | undefined, hostnameSuffix?: string): boolean {
  if (!url || !gateway || (hostnameSuffix && hostnameSuffix !== "staging.buildcustom.ai")) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === STAGING_GATEWAY_HOST
      && parsed.pathname.replace(/\/+$/, "") === "/p" && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

export async function verifyManagedStagingRoute(gateway: Fetcher, url: string, slug: string, expectedScriptName?: string): Promise<void> {
  const routeCheck = await gateway.fetch(new Request(new URL("_buildcustom/route-check", url)));
  if (!routeCheck.ok) throw new Error(`Staging managed route check failed with status ${routeCheck.status}.`);
  const payload = await routeCheck.json().catch(() => null) as any;
  if (payload?.ok !== true || payload.project !== slug || (payload.scriptName !== undefined && payload.scriptName !== expectedScriptName)) {
    throw new Error("Staging managed route resolved to an unexpected project or deployment.");
  }
  const published = await gateway.fetch(new Request(url));
  if (!published.ok || !published.headers.get("content-type")?.toLowerCase().includes("text/html")) {
    throw new Error(`Staging managed publish returned an invalid public response (${published.status}).`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      assertControlPlaneEnvironment(env);
      assertSafeStagingTarget(env.VIBESDK_RUNTIME_URL || env.STAGING_RUNTIME_URL);
      assertOrigin(request, env.CONTROL_PLANE_ALLOWED_ORIGIN || env.STAGING_ALLOWED_ORIGIN);
      const url = new URL(request.url);
      const input = (request.method === "GET" || request.method === "HEAD") ? {} : await readBody(request);
      if (request.headers.has("x-user-id")) return json({ message: "Browser-supplied identity is not accepted." }, { status: 400 });
      const adminResponse = await handleAdminRoute({ request, env, url, input });
      if (adminResponse) return adminResponse;
      const contentResponse = await handleContentRoute({ request, env, url, input });
      if (contentResponse) return contentResponse;
      const stagingCustomer = env.ENVIRONMENT === "staging";
      if (stagingCustomer) {
        if (url.pathname === "/api/auth/register" && env.STAGING_REGISTRATION_ENABLED !== "true") {
          return json({ message: "Staging registration is closed." }, { status: 403 });
        }
        const response = await handleStagingCustomerAuth(env, request, url.pathname, input);
        if (response) return response;
      }

      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        if (env.STAGING_LOGIN_ENABLED !== "true") return json({ message: "Staging login is disabled until acceptance testing is authorized." }, { status: 503 });
        if (env.STAGING_REGISTRATION_ENABLED !== "true") return json({ message: "Staging registration is closed." }, { status: 403 });
        if (!rateLimit(`register:${request.headers.get("CF-Connecting-IP") || "unknown"}`, 5)) return json({ message: "Too many registration attempts." }, { status: 429 });
        const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
        const name = typeof input.name === "string" ? input.name.trim() : "";
        const password = typeof input.password === "string" ? input.password : "";
        if (!email || !name || password.length < 6 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ message: "Name, valid email, and a password of at least 6 characters are required." }, { status: 400 });
        if (await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first()) return json({ message: "An account with this email already exists" }, { status: 409 });
        const user = { id: crypto.randomUUID(), username: name.slice(0, 120), email, password: await bcrypt.hash(password, 10) };
        await env.DB.prepare("INSERT INTO users(id,username,email,password) VALUES(?,?,?,?)").bind(user.id, user.username, user.email, user.password).run();
        return json(serializeUser(user), { status: 201 });
      }
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        if (env.STAGING_LOGIN_ENABLED !== "true") return json({ message: "Staging login is disabled until acceptance testing is authorized." }, { status: 503 });
        if (!rateLimit(`login:${request.headers.get("CF-Connecting-IP") || "unknown"}`, 10)) return json({ message: "Too many login attempts." }, { status: 429 });
        const identity = String(input.email || input.username || "").trim().toLowerCase();
        const user = await env.DB.prepare("SELECT * FROM users WHERE email=? OR lower(username)=?").bind(identity, identity).first<any>();
        if (!user || typeof input.password !== "string" || !(await bcrypt.compare(input.password, user.password))) return json({ message: "Invalid email or password" }, { status: 401 });
        const token = await createSession(env.DB, user);
        return json(serializeUser(user), { headers: { "Set-Cookie": sessionCookie(token) } });
      }
      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        const session = await resolveSession(env.DB, request);
        return json(session ? serializeUser(session) : null);
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        await revokeSession(env.DB, request);
        return new Response(null, { status: 204, headers: { "Set-Cookie": expiredSessionCookie() } });
      }
      const user = stagingCustomer ? await resolveRuntimeProductUser(env, request) : await resolveSession(env.DB, request);
      if (!user) {
        if (url.pathname.startsWith("/api/")) return json({ message: "Unauthorized" }, { status: 401 });
        const asset = await env.ASSETS.fetch(request);
        return asset.status === 404 ? env.ASSETS.fetch(new Request(new URL("/index.html", request.url))) : asset;
      }
      if (url.pathname === "/api/auth/profile" && request.method === "PUT") {
        const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
        const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
        if (!name && !email) return json({ message: "Nothing to update" }, { status: 400 });
        if (email && await env.DB.prepare("SELECT id FROM users WHERE email=? AND id!=?").bind(email, user.id).first()) return json({ message: "Email already in use" }, { status: 409 });
        await env.DB.prepare("UPDATE users SET username=COALESCE(NULLIF(?,''),username),email=COALESCE(NULLIF(?,''),email) WHERE id=?").bind(name, email, user.id).run();
        return json(serializeUser(await env.DB.prepare("SELECT id,username,email,plan,role,created_at FROM users WHERE id=?").bind(user.id).first()));
      }
      if (url.pathname === "/api/auth/password" && request.method === "PUT") {
        if (typeof input.currentPassword !== "string" || typeof input.newPassword !== "string" || input.newPassword.length < 6) return json({ message: "Current and new passwords are required; new password must be at least 6 characters." }, { status: 400 });
        const row = await env.DB.prepare("SELECT password FROM users WHERE id=?").bind(user.id).first<any>();
        if (!row || !(await bcrypt.compare(input.currentPassword, row.password))) return json({ message: "Current password is incorrect" }, { status: 401 });
        await env.DB.prepare("UPDATE users SET password=? WHERE id=?").bind(await bcrypt.hash(input.newPassword, 10), user.id).run();
        return json({ success: true });
      }

      const projectMatch = url.pathname.match(/^\/api\/projects\/(\d+)$/);
      const projectId = projectIdFromPath(url.pathname);
      const project = projectId === null ? null : await env.DB.prepare("SELECT p.*,l.agent_id,l.agent_is_imported,l.preview_url,l.deployment_url,l.hosting_provider,l.subdomain_slug,l.custom_domain,l.custom_origin,l.deployment_origin_url,l.deployment_script_name,CASE WHEN length(s.preview_image_data)>0 THEN 1 ELSE 0 END has_preview_image,s.updated_at seo_updated_at FROM projects p LEFT JOIN runtime_project_links l ON l.project_id=p.id LEFT JOIN seo_settings s ON s.project_id=p.id WHERE p.id=? AND p.user_id=?").bind(projectId, user.id).first<any>();
      const projectList = async () => (await env.DB.prepare("SELECT p.*,l.agent_id,l.preview_url,l.deployment_url,CASE WHEN length(s.preview_image_data)>0 THEN 1 ELSE 0 END has_preview_image,s.updated_at seo_updated_at FROM projects p LEFT JOIN runtime_project_links l ON l.project_id=p.id LEFT JOIN seo_settings s ON s.project_id=p.id WHERE p.user_id=? ORDER BY p.updated_at DESC").bind(user.id).all()).results.map(serializeProject);
      if (url.pathname === "/api/projects" && request.method === "GET") return json(await projectList());
      if (url.pathname === "/api/projects" && request.method === "POST") {
        const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM projects WHERE user_id=?").bind(user.id).first<any>();
        const details = projectInput(input, `Project${Number(count?.count || 0) + 1}`);
        const result = await env.DB.prepare("INSERT INTO projects(user_id,name,type,description,framework) VALUES(?,?,?,?,?)").bind(user.id, details.name, details.type, details.description, details.framework).run();
        const created = await env.DB.prepare("SELECT * FROM projects WHERE id=?").bind(result.meta.last_row_id).first();
        return json(serializeProject(created), { status: 201 });
      }
      if (projectId !== null && !project) return json({ message: "Project not found" }, { status: 404 });
      if (project && request.method === "GET" && projectMatch) return json(serializeProject(project));
      if (project && request.method === "PUT" && projectMatch) {
        const details = projectInput(input, project.name);
        await env.DB.prepare("UPDATE projects SET name=?,type=?,description=?,updated_at=datetime('now') WHERE id=? AND user_id=?").bind(details.name, details.type, details.description, project.id, user.id).run();
        return json(serializeProject(await env.DB.prepare("SELECT * FROM projects WHERE id=?").bind(project.id).first()));
      }
      if (project && request.method === "DELETE" && projectMatch) {
        await deleteProjectWithRoutes(env, project.id);
        return json({ success: true });
      }

      const runtimeMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/runtime\/(.+)$/);
      if (runtimeMatch) {
        const id = Number(runtimeMatch[1]);
        const runtimeProject = project?.id === id ? { id: project.id, name: project.name, type: project.type, description: project.description, agentId: project.agent_id } : null;
        if (!runtimeProject) return json({ message: "Project not found" }, { status: 404 });
        const operation = runtimeMatch[2];
        const readOnly = isReadOnlyRuntimeOperation(request.method, operation);
        if (env.RUNTIME_OPERATIONS_ENABLED !== "true" && !readOnly) return json({ message: "Isolated VibeSDK compatibility gate has not passed." }, { status: 503 });
        const adapter = createVibeSdkAdapter({
          VIBESDK_RUNTIME_URL: env.VIBESDK_RUNTIME_URL || env.STAGING_RUNTIME_URL,
          VIBESDK_API_KEY: env.VIBESDK_API_KEY,
          VIBESDK_RUNTIME: env.VIBESDK_RUNTIME,
        });
        if (!readOnly && project.agent_is_imported) return json({ message: "IMPORTED_AGENT_READ_ONLY" }, { status: 409 });
        if (!readOnly && !rateLimit(`runtime:${user.id}:${id}`, 30, 60_000)) return json({ message: "Too many runtime mutations." }, { status: 429 });
        if (operation === "status" && request.method === "GET") {
          const status = await adapter.status(runtimeProject);
          return json({ ...status, previewUrl: status.state?.previewUrl || project.preview_url || null, deploymentUrl: project.deployment_url || null, previewImageUrl: serializeProject(project).previewImageUrl });
        }
        if (operation === "console" && request.method === "GET") {
          const status = await adapter.status(runtimeProject);
          const state = status.state as any;
          return json({ lines: [{ time: new Date().toLocaleTimeString(), type: state?.lastError ? "error" : status.connected ? "success" : "info", msg: state?.lastError || `Agent ${status.connected ? "connected" : "not connected"}; generation ${state?.generation?.status || "idle"}; ${status.files} workspace files.` }] });
        }
        const domainResponse = await handleDomainRoute({ request, env, url, input, user, project, operation });
        if (domainResponse) return domainResponse;
        if (operation === "files" && request.method === "GET") return json(await adapter.files(runtimeProject));
        if (operation === "files/content" && request.method === "GET") return json(await adapter.fileContent(runtimeProject, safePath(url.searchParams.get("path"))));
        if (operation === "turns" && request.method === "GET") return json({ turns: (await env.DB.prepare("SELECT * FROM runtime_builder_turns WHERE project_id=? ORDER BY created_at ASC").bind(id).all()).results.map(serializeTurn) });
        if (operation === "publishing-settings" && request.method === "GET") return json({ subdomainSlug: project.subdomain_slug || cleanSlug(project.name), hostingProvider: project.hosting_provider === "custom" ? "custom" : "buildcustom", customDomain: project.custom_domain || "", customOrigin: project.custom_origin || "" });
        if (operation === "publishing-settings" && request.method === "PUT") {
          const slug = cleanSlug(input.subdomainSlug);
          const hostingProvider = input.hostingProvider === "custom" ? "custom" : input.hostingProvider === "buildcustom" ? "buildcustom" : "";
          if (!hostingProvider || !validSlug(slug)) return json({ message: "Choose a supported provider and valid subdomain slug." }, { status: 400 });
          if (project.deployment_url && slug !== project.subdomain_slug) {
            return json({ message: "The published address cannot be changed while this project is live." }, { status: 409 });
          }
          const customDomain = cleanSlug(input.customDomain), customOrigin = cleanSlug(input.customOrigin);
          if (hostingProvider === "custom" && !customOrigin) return json({ message: "Enter the origin hostname supplied by your external hosting provider" }, { status: 400 });
          await env.DB.prepare("INSERT INTO runtime_project_links(project_id,subdomain_slug,hosting_provider,custom_domain,custom_origin) VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET subdomain_slug=excluded.subdomain_slug,hosting_provider=excluded.hosting_provider,custom_domain=excluded.custom_domain,custom_origin=excluded.custom_origin,updated_at=datetime('now')").bind(id, slug, hostingProvider === "custom" ? "custom" : "cloudflare", customDomain || null, customOrigin || null).run();
          return json({ subdomainSlug: slug, hostingProvider, customDomain, customOrigin });
        }
        if (operation === "releases" && request.method === "GET") return json({ releases: (await env.DB.prepare("SELECT * FROM runtime_releases WHERE project_id=? ORDER BY created_at DESC").bind(id).all()).results.map(serializeRelease) });
        if (operation === "messages" && request.method === "POST") {
          const message = typeof input.message === "string" ? input.message.trim() : "";
          if (!message || message.length > 30_000) return json({ message: "A message between 1 and 30,000 characters is required" }, { status: 400 });
          if (input.mode !== undefined && input.mode !== "plan" && input.mode !== "build") return json({ message: "Unsupported runtime mode" }, { status: 400 });
          const images = imageInput(input.images);
          if (images.reduce((sum, image) => sum + (image.size || 0), 0) > 8_000_000) return json({ message: "Image attachments must be 8 MB or less in total" }, { status: 400 });
          let active = runtimeProject;
          let initialGeneration = false;
          if (!active.agentId) {
            const created = await adapter.create(active, message, images);
            const claimed = await env.DB.prepare("INSERT INTO runtime_project_links(project_id,agent_id,agent_is_imported) VALUES(?,?,0) ON CONFLICT(project_id) DO UPDATE SET agent_id=COALESCE(runtime_project_links.agent_id,excluded.agent_id) RETURNING agent_id,agent_is_imported").bind(id, created.agentId).first<any>();
            active = { ...active, agentId: claimed?.agent_id || created.agentId };
            initialGeneration = active.agentId === created.agentId;
          }
          const result = input.mode === "plan"
            ? await adapter.plan(active, message, images)
            : await adapter.build(active, message, images, initialGeneration);
          const turn = await env.DB.prepare("INSERT INTO runtime_builder_turns(project_id,mode,prompt,response,changed_files,commit_hash,activity) VALUES(?,?,?,?,?,?,?) RETURNING *").bind(id, input.mode === "plan" ? "plan" : "build", typeof input.displayMessage === "string" ? input.displayMessage : message, result.message, JSON.stringify(result.changedFiles || []), result.commitHash || null, JSON.stringify(result.activity || [])).first();
          return json({ ...result, turn: serializeTurn(turn) });
        }
        if (operation === "previews" && request.method === "POST") {
          const result = await adapter.preview(runtimeProject);
          await env.DB.prepare("INSERT INTO runtime_project_links(project_id,preview_url) VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET preview_url=excluded.preview_url,updated_at=datetime('now')").bind(id, result.url).run();
          return json(result, { status: 201 });
        }
        if (operation === "stop" && request.method === "POST") return json(await adapter.stop(runtimeProject));
        if (operation === "deployments" && request.method === "POST") {
          const stagingTiming: Record<string, number> = {};
          if (env.ENVIRONMENT === "staging") stagingTiming.requestStartedAt = Date.now();
          if (!canPublishInStaging(user.role)) return json({ message: "Staging publish requires a super administrator." }, { status: 403 });
          if (env.ENVIRONMENT === "staging" && !hasExactStagingGatewayConfig(env.STAGING_MANAGED_GATEWAY_URL, env.STAGING_GATEWAY, env.STAGING_MANAGED_HOSTNAME_SUFFIX)) {
            return json({ message: "Staging managed gateway is not configured." }, { status: 503 });
          }
          const settings = await env.DB.prepare("SELECT * FROM runtime_project_links WHERE project_id=?").bind(id).first<any>();
          if (settings?.hosting_provider === "custom") return json({ message: "Automatic publishing is available with BuildCustom.Ai Hosting. External hosting uses your provider's deployment process." }, { status: 409 });
          const pendingKey = `pending-deployment:${id}`;
          const pendingRaw = env.ENVIRONMENT === "staging" ? await env.STAGING_ROUTES.get(pendingKey) : null;
          const pending = pendingRaw ? JSON.parse(pendingRaw) as {
            slug: string; scriptName: string; result: Awaited<ReturnType<typeof adapter.deploy>>; deployedAt: number;
          } : null;
          const slug = settings?.subdomain_slug || project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          if (!validSlug(slug) || (pending && pending.slug !== slug)) return json({ message: "Choose a valid publishing address or resolve the pending staging deployment." }, { status: 409 });
          const result = pending?.result || await adapter.deploy(runtimeProject);
          if (env.ENVIRONMENT === "staging") stagingTiming.deploymentCompletedAt = pending?.deployedAt || Date.now();
          const deploymentUrl = new URL(result.url);
          const runtimeUrl = new URL(env.VIBESDK_RUNTIME_URL || env.STAGING_RUNTIME_URL);
          if (deploymentUrl.origin !== runtimeUrl.origin || !deploymentUrl.pathname.startsWith("/deployed/")) {
            throw new VibeSdkAdapterError("VibeSDK returned a deployment outside the isolated staging runtime.", "RUNTIME_UPSTREAM_ERROR");
          }
          if (!result.commitHash) throw new VibeSdkAdapterError("VibeSDK did not return a restorable deployment revision.", "RUNTIME_UPSTREAM_ERROR");
          const scriptName = deploymentScriptName(result.workersUrl, result.url);
          if (pending && scriptName !== pending.scriptName) throw new Error("Pending staging deployment script mismatch.");
          const seo = await env.DB.prepare("SELECT * FROM seo_settings WHERE project_id=?").bind(id).first<any>();
          const previousRoute = await env.STAGING_ROUTES.get(slug);
          const previousPreview = await env.STAGING_ROUTES.get(previewImageKey(slug), "arrayBuffer");
          if (previousRoute && settings?.deployment_script_name !== scriptName) {
            let oldScript: unknown;
            try { oldScript = JSON.parse(previousRoute).scriptName; } catch { /* Refuse to replace unrecognized mappings. */ }
            if (oldScript !== settings?.deployment_script_name) return json({ message: "This publishing address is already in use." }, { status: 409 });
          }
          let prospectiveSeo = seo;
          let previewBytes: Uint8Array | null = null;
          const publicUrl = env.ENVIRONMENT === "production"
            ? `https://${slug}.apps.buildcustom.ai`
            : env.STAGING_MANAGED_GATEWAY_URL
              ? managedStagingPublishUrl(env.STAGING_MANAGED_GATEWAY_URL, slug, env.STAGING_MANAGED_HOSTNAME_SUFFIX)
              : result.url;
          if (pending && settings?.deployment_script_name === scriptName && settings?.deployment_url === publicUrl) {
            const existing = await env.DB.prepare("SELECT * FROM runtime_releases WHERE project_id=? AND commit_hash=? ORDER BY id DESC LIMIT 1")
              .bind(id, result.commitHash).first<any>();
            if (existing) {
              await env.STAGING_ROUTES.delete(pendingKey);
              return json({ ...result, url: publicUrl, originUrl: result.url, release: serializeRelease(existing),
                stagingTiming: { ...stagingTiming, alreadyCommitted: true } }, { status: 200 });
            }
          }
          if (env.ENVIRONMENT === "staging" && !pending) {
            await env.STAGING_ROUTES.put(pendingKey, JSON.stringify({ slug, scriptName, result, deployedAt: stagingTiming.deploymentCompletedAt }),
              { expirationTtl: 3600 });
          }
          try {
            await writePublishedRoute(env, slug, scriptName, routeMetadata(prospectiveSeo));
            if (env.ENVIRONMENT === "staging") stagingTiming.routeKvWrittenAt = Date.now();
          } catch (error) {
            if (previousRoute === null) await env.STAGING_ROUTES.delete(slug);
            else await env.STAGING_ROUTES.put(slug, previousRoute);
            if (previousPreview === null) await env.STAGING_ROUTES.delete(previewImageKey(slug));
            else await env.STAGING_ROUTES.put(previewImageKey(slug), previousPreview);
            throw error;
          }
          if (env.ENVIRONMENT === "staging") {
            try {
              const ready = await waitForStagingAppReady(publicUrl, env.STAGING_GATEWAY!, env.BROWSER, async () => {
                await verifyManagedStagingRoute(env.STAGING_GATEWAY!, publicUrl, slug, scriptName);
                stagingTiming.gatewayRouteCheckedAt ||= Date.now();
                if (env.STAGING_MANAGED_HOSTNAME_SUFFIX) {
                  await verifyPublicHostnameRoute(env.BROWSER, publicUrl, slug, scriptName);
                  stagingTiming.publicHostnameCheckedAt ||= Date.now();
                }
              });
              stagingTiming.readyAt = ready.firstReadyAt;
              stagingTiming.readinessAttempts = ready.attempts;
              stagingTiming.readinessElapsedMs = ready.elapsedMs;
              stagingTiming.verifiedAssets = ready.assets;
            }
            catch (error) {
              if (previousRoute === null) await env.STAGING_ROUTES.delete(slug);
              else await env.STAGING_ROUTES.put(slug, previousRoute);
              if (previousPreview === null) await env.STAGING_ROUTES.delete(previewImageKey(slug));
              else await env.STAGING_ROUTES.put(previewImageKey(slug), previousPreview);
              if (error instanceof StagingPublishNotReadyError) {
                return json({ message: error.message, code: "PUBLISH_NOT_READY", retryAfterSeconds: 5,
                  readiness: { attempts: error.attempts, elapsedMs: error.elapsedMs, failure: error.failure } },
                { status: 503 });
              }
              throw error;
            }
            try {
              previewBytes = await capturePreviewImage(env.BROWSER, publicUrl);
            } catch {
              // Express treats screenshot capture as non-fatal to publishing.
            }
            if (previewBytes) {
              const previewUrl = `${publicUrl}_buildcustom/preview-image?v=${Date.now()}`;
              const ogImageUrl = seo?.social_image_data ? seo.og_image_url : previewUrl;
              prospectiveSeo = { ...(seo || {}), preview_image_data: imageDataUri(previewBytes), og_image_url: ogImageUrl };
            }
          }
          try {
            if (previewBytes) {
              await writePublishedRoute(env, slug, scriptName, routeMetadata(prospectiveSeo));
              await env.STAGING_ROUTES.put(previewImageKey(slug), previewBytes);
            }
          } catch (error) {
            if (previousRoute === null) await env.STAGING_ROUTES.delete(slug);
            else await env.STAGING_ROUTES.put(slug, previousRoute);
            if (previousPreview === null) await env.STAGING_ROUTES.delete(previewImageKey(slug));
            else await env.STAGING_ROUTES.put(previewImageKey(slug), previousPreview);
            throw error;
          }
          let release: any;
          try {
            const statements = [];
            if (previewBytes) statements.push(env.DB.prepare("INSERT INTO seo_settings(project_id,preview_image_data,og_image_url) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET preview_image_data=excluded.preview_image_data,og_image_url=excluded.og_image_url,updated_at=datetime('now')")
              .bind(id, prospectiveSeo.preview_image_data, prospectiveSeo.og_image_url));
            statements.push(
              env.DB.prepare("UPDATE runtime_project_links SET deployment_url=?,deployment_origin_url=?,deployment_script_name=?,subdomain_slug=?,updated_at=datetime('now') WHERE project_id=?").bind(publicUrl, result.url, scriptName, slug, id),
              env.DB.prepare("INSERT INTO runtime_releases(project_id,commit_hash,deployment_url) VALUES(?,?,?) RETURNING *").bind(id, result.commitHash, publicUrl),
            );
            const results = await env.DB.batch(statements);
            release = results[results.length - 1].results?.[0];
            if (env.ENVIRONMENT === "staging") {
              try { await env.STAGING_ROUTES.delete(pendingKey); }
              catch (error) { console.warn("Staging pending deployment cleanup failed:", error instanceof Error ? error.name : "unknown"); }
            }
          } catch (error) {
            if (previousRoute === null) await env.STAGING_ROUTES.delete(slug);
            else await env.STAGING_ROUTES.put(slug, previousRoute);
            if (previousPreview === null) await env.STAGING_ROUTES.delete(previewImageKey(slug));
            else await env.STAGING_ROUTES.put(previewImageKey(slug), previousPreview);
            throw error;
          }
          return json({ ...result, url: publicUrl, originUrl: result.url, release: serializeRelease(release),
            ...(env.ENVIRONMENT === "staging" ? { stagingTiming: { ...stagingTiming, releaseCommittedAt: Date.now() } } : {}) }, { status: 201 });
        }
        const turnRestore = operation.match(/^turns\/(\d+)\/restore$/);
        if (turnRestore && request.method === "POST") {
          const turn = await env.DB.prepare("SELECT * FROM runtime_builder_turns WHERE id=? AND project_id=?").bind(Number(turnRestore[1]), id).first<any>();
          if (!turn?.commit_hash) return json({ message: "Restorable checkpoint not found" }, { status: 404 });
          const result = await adapter.restore(runtimeProject, turn.commit_hash);
          await env.DB.prepare("UPDATE runtime_project_links SET preview_url=?,updated_at=datetime('now') WHERE project_id=?").bind(result.previewUrl, id).run();
          return json({ ...result, turn: serializeTurn(turn) });
        }
        const releaseRestore = operation.match(/^releases\/(\d+)\/restore$/);
        if (releaseRestore && request.method === "POST") {
          const release = await env.DB.prepare("SELECT * FROM runtime_releases WHERE id=? AND project_id=?").bind(Number(releaseRestore[1]), id).first<any>();
          if (!release) return json({ message: "Release not found" }, { status: 404 });
          const result = await adapter.restore(runtimeProject, release.commit_hash);
          await env.DB.prepare("UPDATE runtime_project_links SET preview_url=?,updated_at=datetime('now') WHERE project_id=?").bind(result.previewUrl, id).run();
          return json({ ...result, release: serializeRelease(release) });
        }
      }
      if (url.pathname.startsWith("/api/")) return json({ message: "Not found" }, { status: 404 });
      const asset = await env.ASSETS.fetch(request);
      return asset.status === 404 ? env.ASSETS.fetch(new Request(new URL("/index.html", request.url))) : asset;
    } catch (error) {
      return runtimeError(error);
    }
  },
};