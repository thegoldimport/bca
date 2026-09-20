import { assertOrigin, createSession, expiredSessionCookie, resolveSession, revokeSession, sessionCookie } from "./staging/auth";
import { assertMutableAgent, assertStagingEnvironment, assertSafeStagingTarget } from "./staging/boundary";
import { ProjectOperationDO } from "./staging/project-do";
import { RuntimeOperationWorkflow } from "./staging/workflow";
import bcrypt from "bcryptjs";

export { ProjectOperationDO, RuntimeOperationWorkflow };

export type Env = {
  DB: D1Database;
  PROJECT_OP: DurableObjectNamespace;
  RUNTIME_WORKFLOW: Workflow;
  ASSETS: Fetcher;
  STAGING_ROUTES: KVNamespace;
  ENVIRONMENT: string;
  STAGING_RUNTIME_URL: string;
  STAGING_ROUTE_KV_ID: string;
  STAGING_DISPATCH_NAMESPACE: string;
  STAGING_ALLOWED_ORIGIN: string;
  STAGING_LOGIN_ENABLED: string;
  RUNTIME_OPERATIONS_ENABLED: string;
};

function json(data: unknown, init: ResponseInit = {}) { return Response.json(data, { headers: { "Cache-Control": "no-store", ...init.headers }, ...init }); }
async function body(request: Request) { return await request.json().catch(() => ({})) as Record<string, unknown>; }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      assertStagingEnvironment(env);
      assertOrigin(request, env.STAGING_ALLOWED_ORIGIN);
      const url = new URL(request.url);
      if (url.pathname === "/api/auth/me") return json(await resolveSession(env.DB, request) || null, { status: 200 });
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        await revokeSession(env.DB, request);
        return new Response(null, { status: 204, headers: { "Set-Cookie": expiredSessionCookie() } });
      }
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        if (env.STAGING_LOGIN_ENABLED !== "true") {
          return json({ message: "Staging login is disabled until acceptance testing is authorized." }, { status: 503 });
        }
        const input = await body(request);
        const identity = String(input.email || input.username || "").trim();
        const user = await env.DB.prepare("SELECT id,username,email,role,password FROM users WHERE email=? OR username=?").bind(identity, identity).first<any>();
        if (!user || typeof input.password !== "string" || !(await bcrypt.compare(input.password, user.password))) return json({ message: "Invalid credentials" }, { status: 401 });
        const token = await createSession(env.DB, user);
        const { password: _password, ...safe } = user;
        return json(safe, { headers: { "Set-Cookie": sessionCookie(token) } });
      }
      const user = await resolveSession(env.DB, request);
      if (!user) return json({ message: "Unauthorized" }, { status: 401 });
      const operationMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/operations$/);
      if (operationMatch && request.method === "POST") {
        const projectId = Number(operationMatch[1]);
        const project = await env.DB.prepare("SELECT p.id,p.user_id,l.agent_id,COALESCE(l.agent_is_imported,0) AS agent_is_imported FROM projects p LEFT JOIN runtime_project_links l ON l.project_id=p.id WHERE p.id=?").bind(projectId).first<any>();
        if (!project || project.user_id !== user.id) return json({ message: "Project not found" }, { status: 404 });
        const input = await body(request);
        const operation = String(input.operation || "");
        const allowedOperations = ["plan", "build", "preview", "restore", "deploy"] as const;
        if (!allowedOperations.includes(operation as (typeof allowedOperations)[number])) {
          return json({ message: "Unsupported operation" }, { status: 400 });
        }
        if (env.RUNTIME_OPERATIONS_ENABLED !== "true") {
          return json({ message: "Isolated VibeSDK compatibility gate has not passed." }, { status: 503 });
        }
        assertSafeStagingTarget(env.STAGING_RUNTIME_URL);
        if (project.agent_is_imported) throw new Error("IMPORTED_AGENT_READ_ONLY");
        const operationId = crypto.randomUUID();
        const acquired = await env.PROJECT_OP.get(env.PROJECT_OP.idFromName(String(projectId))).fetch("https://do/acquire", { method: "POST", body: JSON.stringify({ operationId }) });
        if (!acquired.ok) return json(await acquired.json(), { status: 409 });
        await env.DB.prepare("INSERT INTO operations(id,project_id,user_id,kind,status,input_json) VALUES (?,?,?,?,'queued',?)").bind(operationId, projectId, user.id, operation, JSON.stringify(input)).run();
        try {
          await env.RUNTIME_WORKFLOW.create({ id: operationId, params: { operationId, projectId, operation, boundary: { runtimeUrl: env.STAGING_RUNTIME_URL, agentId: project.agent_id, imported: Boolean(project.agent_is_imported) }, payload: input } });
        } catch {
          await env.DB.prepare("UPDATE operations SET status='failed',error=? WHERE id=?").bind("Workflow could not be started", operationId).run();
          await env.PROJECT_OP.get(env.PROJECT_OP.idFromName(String(projectId))).fetch("https://do/release", { method: "POST", body: JSON.stringify({ operationId }) });
          return json({ message: "Workflow unavailable" }, { status: 503 });
        }
        return json({ operationId, status: "queued" }, { status: 202 });
      }
      const statusMatch = url.pathname.match(/^\/api\/operations\/([^/]+)$/);
      if (statusMatch && request.method === "POST" && (await body(request)).action === "cancel") {
        const operation = await env.DB.prepare("SELECT project_id,status FROM operations WHERE id=? AND user_id=?").bind(statusMatch[1], user.id).first<any>();
        if (!operation) return json({ message: "Operation not found" }, { status: 404 });
        if (["succeeded", "failed", "canceled"].includes(operation.status)) return json({ status: operation.status });
        const workflow = await env.RUNTIME_WORKFLOW.get(statusMatch[1]);
        await workflow.terminate({ reason: "Canceled by user" });
        await env.DB.prepare("UPDATE operations SET status='canceled',finished_at=datetime('now') WHERE id=? AND status IN ('queued','running')").bind(statusMatch[1]).run();
        await env.PROJECT_OP.get(env.PROJECT_OP.idFromName(String(operation.project_id))).fetch("https://do/release", { method: "POST", body: JSON.stringify({ operationId: statusMatch[1] }) });
        return json({ status: "canceled" });
      }
      if (statusMatch && request.method === "GET") {
        const operation = await env.DB.prepare("SELECT * FROM operations WHERE id=? AND user_id=?").bind(statusMatch[1], user.id).first();
        return operation ? json(operation) : json({ message: "Operation not found" }, { status: 404 });
      }
      if (url.pathname.startsWith("/api/")) return json({ message: "Not found" }, { status: 404 });
      const asset = await env.ASSETS.fetch(request);
      return asset.status === 404 ? env.ASSETS.fetch(new Request(new URL("/index.html", request.url))) : asset;
    } catch (error) {
      return json({ message: error instanceof Error ? error.message : "Request failed" }, { status: 400 });
    }
  },
};