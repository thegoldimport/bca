import { RuntimeIdentityError, stockAgentRequest } from "./runtime-identity";

type Env = { DB: D1Database; AUTH_RUNTIME?: Fetcher; AUTH_RUNTIME_URL?: string };
type Project = { id: number; user_id: string; name: string; creation_key?: string | null };
type Link = { agent_id: string | null; initialization_status: string; initialization_error: string | null };

const linkFor = (db: D1Database, id: number) =>
  db.prepare("SELECT agent_id,initialization_status,initialization_error FROM runtime_project_links WHERE project_id=?")
    .bind(id).first<Link>();

function marker(project: Project): string {
  // Stock stores the query as originalPrompt. The marker is unique to this
  // project, not supplied by the client, and enables owner-scoped recovery.
  return `BuildCustom project ${project.id} [bc-project:${project.id}]`;
}

async function setState(env: Env, project: Project, status: string, error: string | null = null): Promise<void> {
  await env.DB.prepare(
    "UPDATE runtime_project_links SET initialization_status=?,initialization_error=?,updated_at=datetime('now') WHERE project_id=?",
  ).bind(status, error, project.id).run();
  await env.DB.prepare("UPDATE projects SET status=?,updated_at=datetime('now') WHERE id=? AND user_id=?")
    .bind(status === "ready" ? "ready" : ["error", "reconcile"].includes(status) ? "error" : "initializing", project.id, project.user_id).run();
}

async function claim(env: Env, project: Project): Promise<boolean> {
  const row = await env.DB.prepare(
    "INSERT INTO runtime_project_links(project_id,initialization_status,initialization_started_at,runtime_provider) VALUES(?,'initializing',datetime('now'),'stock-think') " +
    "ON CONFLICT(project_id) DO UPDATE SET initialization_status='initializing',initialization_started_at=datetime('now'),runtime_provider='stock-think' " +
    "WHERE runtime_project_links.agent_id IS NULL AND runtime_project_links.initialization_status='pending' RETURNING project_id",
  ).bind(project.id).first<{ project_id: number }>();
  if (row) await env.DB.prepare("UPDATE projects SET status='initializing',updated_at=datetime('now') WHERE id=? AND user_id=?")
    .bind(project.id, project.user_id).run();
  return Boolean(row);
}

async function saveAgentId(env: Env, project: Project, agentId: string): Promise<void> {
  const claimed = await env.DB.prepare(
    "UPDATE runtime_project_links SET agent_id=?,initialization_status='initializing',updated_at=datetime('now') " +
    "WHERE project_id=? AND agent_id IS NULL AND initialization_status IN ('initializing','reconcile') RETURNING agent_id",
  ).bind(agentId, project.id).first<{ agent_id: string }>();
  if (!claimed) {
    const existing = await linkFor(env.DB, project.id);
    if (existing?.agent_id !== agentId) throw new RuntimeIdentityError("Project setup needs review before it can continue.", 409);
  }
}

async function checkOwner(env: Env, request: Request, agentId: string): Promise<boolean> {
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) throw new RuntimeIdentityError("Invalid project setup reference.", 502);
  const response = await stockAgentRequest(env, request, `/api/agent/${agentId}/connect`);
  if (response.status === 404) return false; // Initialization may still be in progress.
  if (!response.ok) throw new RuntimeIdentityError("Project ownership could not be verified.", response.status === 403 ? 403 : 502);
  const result = await response.json().catch(() => null) as any;
  if (result?.success !== true || result?.data?.agentId !== agentId) {
    throw new RuntimeIdentityError("Project ownership could not be verified.");
  }
  return true;
}

export async function refreshProjectAgent(env: Env, request: Request, project: Project): Promise<Link | null> {
  let link = await linkFor(env.DB, project.id);
  if (!link) return null;
  if (!link.agent_id && (link.initialization_status === "initializing" || link.initialization_status === "reconcile")) {
    // Stock lists only this authenticated owner's apps. The app row appears
    // after Think initialization; until then we fail closed, never POST again.
    const response = await stockAgentRequest(env, request, "/api/apps");
    if (response.ok) {
      const result = await response.json().catch(() => null) as any;
      const apps = result?.data?.apps;
      if (!Array.isArray(apps)) throw new RuntimeIdentityError("Project setup could not be checked.");
      const matches = apps.filter((app: any) => app.originalPrompt === marker(project) && typeof app.id === "string");
      if (matches.length > 1) {
        await setState(env, project, "error", "Project setup needs review.");
        throw new RuntimeIdentityError("Project setup needs review.", 409);
      }
      if (matches.length === 1) await saveAgentId(env, project, matches[0].id);
    }
    link = await linkFor(env.DB, project.id);
  }
  if (link?.agent_id) {
    const owned = await checkOwner(env, request, link.agent_id);
    // A stock initialization error is not repaired by a successful connect.
    // Only a known-good completed initialization (or a recovered app row)
    // may be promoted to ready.
    if (link.initialization_status === "error") return link;
    if (owned) {
      if (link.initialization_status !== "ready") {
        await setState(env, project, "ready");
        link = await linkFor(env.DB, project.id);
      }
    } else if (link.initialization_status === "ready") {
      await setState(env, project, "reconcile", "Project setup could not be verified.");
      link = await linkFor(env.DB, project.id);
    }
  }
  return link;
}

async function consumeAgentStream(env: Env, project: Project, stream: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!stream) throw new RuntimeIdentityError("Project setup did not return a result.");
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let first = true;
  let bytes = 0;
  const processLine = async (line: string): Promise<void> => {
    if (!line) return;
    const event = JSON.parse(line) as any;
    if (first) {
      first = false;
      if (typeof event.agentId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(event.agentId)
        || event.behaviorType !== "think") throw new RuntimeIdentityError("Project setup returned an invalid result.");
      await saveAgentId(env, project, event.agentId);
    } else if (event.error) {
      throw new RuntimeIdentityError("Project setup could not finish.");
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    bytes += value?.byteLength || 0;
    if (bytes > 256_000) throw new RuntimeIdentityError("Project setup returned too much data.");
    let end: number;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end).trim();
      pending = pending.slice(end + 1);
      await processLine(line);
    }
    if (done) {
      await processLine(pending.trim());
      break;
    }
  }
  if (first) throw new RuntimeIdentityError("Project setup did not return an agent.");
}

export async function initializeProjectAgent(env: Env, request: Request, project: Project): Promise<Link | null> {
  if (!(await claim(env, project))) return refreshProjectAgent(env, request, project);
  let agentIssued = false;
  try {
    const response = await stockAgentRequest(env, request, "/api/agent", {
      method: "POST", body: { query: marker(project), behaviorType: "think", projectType: "app" },
    });
    if (!response.ok) {
      // Non-2xx from stock may be ambiguous. Do not blindly send a second POST.
      await setState(env, project, "reconcile", "Project setup could not be confirmed.");
      return linkFor(env.DB, project.id);
    }
    await consumeAgentStream(env, project, response.body);
    agentIssued = true;
    return refreshProjectAgent(env, request, project);
  } catch (error) {
    // The upstream may have created the agent even if our response was lost.
    // Reconcile by its owner-visible marker on reopen instead of retrying.
    const initFailed = error instanceof RuntimeIdentityError && error.message === "Project setup could not finish.";
    await setState(env, project, agentIssued || initFailed ? "error" : "reconcile", "Project setup could not be confirmed.");
    return linkFor(env.DB, project.id);
  }
}

export async function createProductProject(
  env: Env, request: Request, ownerId: string,
  details: { name: string; type: string; description: string; framework: string },
): Promise<{ project: Project; created: boolean; link: Link | null }> {
  const key = request.headers.get("Idempotency-Key")?.trim() || "";
  if (!/^[a-zA-Z0-9_-]{16,120}$/.test(key)) {
    throw new RuntimeIdentityError("A project creation key is required. Please retry from the dashboard.", 400);
  }
  const inserted = await env.DB.prepare(
    "INSERT INTO projects(user_id,name,type,description,framework,creation_key,status) VALUES(?,?,?,?,?,?,'initializing') " +
    "ON CONFLICT(user_id,creation_key) DO NOTHING RETURNING id",
  ).bind(ownerId, details.name, details.type, details.description, details.framework, key).first<{ id: number }>();
  const project = await env.DB.prepare(
    "SELECT id,user_id,name,creation_key FROM projects WHERE user_id=? AND creation_key=?",
  ).bind(ownerId, key).first<Project>();
  if (!project) throw new RuntimeIdentityError("Could not save this project.");
  // A retry may arrive after the project insert but before the first request
  // claims its link. Both requests race through the same atomic D1 claim.
  const link = await initializeProjectAgent(env, request, project);
  return { project, created: Boolean(inserted), link };
}