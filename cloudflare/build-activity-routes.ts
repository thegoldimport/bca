type BuildActivityEnv = { DB: D1Database };

type AttemptRow = {
  attempt_id: string;
  started_at_ms: number;
  finished_at_ms: number | null;
  status: "running" | "completed" | "failed";
  last_stage: string;
  last_successful_stage: string | null;
  failure_stage: string | null;
  error_code: string | null;
  customer_message: string | null;
  correlation_id: string | null;
};

type EventRow = {
  id: string;
  attempt_id: string;
  occurred_at_ms: number;
  event_type: string;
  stage: string;
  status: "active" | "complete" | "error" | "info";
  error_code: string | null;
  customer_message: string | null;
  correlation_id: string | null;
};

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

export async function handleProjectBuildActivityRoute(
  env: BuildActivityEnv,
  request: Request,
  userId: string,
): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(/^\/api\/projects\/(\d+)\/build-activity$/);
  if (!match) return null;
  if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);
  const projectId = Number(match[1]);
  if (!Number.isSafeInteger(projectId) || projectId < 1 || !userId) {
    return json({ message: "Project not found." }, 404);
  }

  const owner = await env.DB.prepare(
    "SELECT id FROM projects WHERE id=? AND user_id=?",
  ).bind(projectId, userId).first<{ id: number }>();
  if (!owner) return json({ message: "Project not found." }, 404);

  try {
    const [attemptResult, eventResult] = await Promise.all([
      env.DB.prepare(
        `SELECT attempt_id,started_at_ms,finished_at_ms,status,last_stage,last_successful_stage,
                failure_stage,error_code,customer_message,correlation_id
         FROM native_build_attempts
         WHERE project_id=? AND user_id=?
         ORDER BY started_at_ms DESC LIMIT 50`,
      ).bind(projectId, userId).all<AttemptRow>(),
      env.DB.prepare(
        `SELECT e.id,e.attempt_id,e.occurred_at_ms,e.event_type,e.stage,e.status,e.error_code,
                e.customer_message,e.correlation_id
         FROM native_build_events e
         JOIN native_build_attempts a ON a.attempt_id=e.attempt_id
         WHERE a.project_id=? AND a.user_id=?
         ORDER BY e.occurred_at_ms DESC LIMIT 1000`,
      ).bind(projectId, userId).all<EventRow>(),
    ]);

    const eventsByAttempt = new Map<string, EventRow[]>();
    for (const event of eventResult.results || []) {
      const list = eventsByAttempt.get(event.attempt_id) || [];
      list.push(event);
      eventsByAttempt.set(event.attempt_id, list);
    }
    const attempts = (attemptResult.results || []).map((attempt) => {
      const events = (eventsByAttempt.get(attempt.attempt_id) || [])
        .sort((a, b) => Number(a.occurred_at_ms) - Number(b.occurred_at_ms));
      const startedAt = Number(attempt.started_at_ms);
      const finishedAt = attempt.finished_at_ms == null ? null : Number(attempt.finished_at_ms);
      return {
        attemptId: attempt.attempt_id,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, (finishedAt ?? Date.now()) - startedAt),
        status: attempt.status,
        lastStage: attempt.last_stage,
        lastSuccessfulStage: attempt.last_successful_stage,
        failureStage: attempt.failure_stage,
        errorCode: attempt.error_code,
        customerMessage: attempt.customer_message,
        correlationId: attempt.correlation_id,
        events: events.map((event) => ({
          id: event.id,
          occurredAt: Number(event.occurred_at_ms),
          eventType: event.event_type,
          stage: event.stage,
          status: event.status,
          errorCode: event.error_code,
          message: event.customer_message,
          correlationId: event.correlation_id,
        })),
      };
    });
    return json({ attempts, retainedEventCount: (eventResult.results || []).length });
  } catch {
    return json({ message: "Persistent build activity is temporarily unavailable." }, 503);
  }
}
