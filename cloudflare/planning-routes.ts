import { isValidPlanningSession, type PlanningSession } from "../shared/build-planning";
import { assertOrigin, hasValidCsrfToken, type SessionUser } from "./staging/auth";

type PlanningEnv = { DB: D1Database; CONTROL_PLANE_ALLOWED_ORIGIN?: string };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleBuilderPlanningRoute(args: {
  env: PlanningEnv;
  request: Request;
  url: URL;
  input: Record<string, unknown>;
  user: SessionUser;
  projectId: number | null;
  allowedOrigin?: string;
}): Promise<Response | null> {
  const { env, request, url, input, user, projectId, allowedOrigin } = args;
  const match = url.pathname.match(/^\/api\/projects\/(\d+)\/planning$/);
  if (!match) return null;
  if (!projectId || Number(match[1]) !== projectId) return json({ message: "Project not found." }, 404);

  if (request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT state_json,updated_at FROM builder_planning_sessions WHERE project_id=? AND user_id=?",
    ).bind(projectId, user.id).first<{ state_json: string; updated_at: string }>();
    if (!row) return json({ session: null });
    try {
      const state = JSON.parse(row.state_json);
      if (!isValidPlanningSession(state)) return json({ message: "Saved planning state is invalid." }, 500);
      return json({ session: state, updatedAt: row.updated_at });
    } catch {
      return json({ message: "Saved planning state is invalid." }, 500);
    }
  }

  if (!["PUT", "DELETE"].includes(request.method)) {
    return json({ message: "Method not allowed." }, 405);
  }
  if (!hasValidCsrfToken(request)) return json({ message: "A secure request is required." }, 403);
  try {
    assertOrigin(request, allowedOrigin || env.CONTROL_PLANE_ALLOWED_ORIGIN || "https://app.buildcustom.ai");
  } catch {
    return json({ message: "A secure request is required." }, 403);
  }

  if (request.method === "DELETE") {
    await env.DB.prepare(
      "DELETE FROM builder_planning_sessions WHERE project_id=? AND user_id=?",
    ).bind(projectId, user.id).run();
    return json({ success: true });
  }

  const session = input.session as PlanningSession | undefined;
  if (!isValidPlanningSession(session)) return json({ message: "Planning state is invalid." }, 400);
  const stateJson = JSON.stringify(session);
  if (stateJson.length > 48_000) return json({ message: "Planning state is too large." }, 413);
  const result = await env.DB.prepare(
    `INSERT INTO builder_planning_sessions(project_id,user_id,state_json,updated_at)
     VALUES(?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(project_id) DO UPDATE SET state_json=excluded.state_json,updated_at=CURRENT_TIMESTAMP
     WHERE builder_planning_sessions.user_id=excluded.user_id`,
  ).bind(projectId, user.id, stateJson).run();
  if (Number(result.meta?.changes || 0) !== 1) {
    return json({ message: "Planning state could not be saved for this project." }, 409);
  }
  return json({ success: true });
}

