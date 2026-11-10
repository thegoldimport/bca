export type NativeConnectionStage =
  | "request_received"
  | "upgrade_validation"
  | "origin_validation"
  | "project_link_check"
  | "ai_settings_refresh"
  | "runtime_websocket"
  | "websocket_handshake"
  | "websocket_closed";

export type NativeConnectionStatus = "connecting" | "connected" | "failed" | "disconnected";

export type NativeConnectionRecord = {
  attemptId: string;
  correlationId: string;
};

type ConnectionDiagnosticDatabase = Pick<D1Database, "prepare">;

function safeCorrelationId(request: Request, fallback: string): string {
  const ray = request.headers.get("cf-ray") || "";
  return /^[A-Za-z0-9_-]{1,128}$/.test(ray) ? ray : fallback;
}

export async function startNativeConnectionAttempt(
  db: ConnectionDiagnosticDatabase,
  request: Request,
  projectId: number,
  userId: string,
): Promise<NativeConnectionRecord> {
  const attemptId = crypto.randomUUID();
  const correlationId = safeCorrelationId(request, attemptId);
  const startedAt = Date.now();

  // Keep diagnostic storage bounded without retaining prompt, source, or credential data.
  await db.prepare("DELETE FROM native_connection_attempts WHERE started_at_ms < ?")
    .bind(startedAt - 30 * 24 * 60 * 60 * 1000).run();
  await db.prepare(
    `INSERT INTO native_connection_attempts
       (attempt_id,project_id,user_id,started_at_ms,status,stage,correlation_id)
     VALUES (?,?,?,?,?,?,?)`,
  ).bind(attemptId, projectId, userId, startedAt, "connecting", "request_received", correlationId).run();

  return { attemptId, correlationId };
}

export async function setNativeConnectionStage(
  db: ConnectionDiagnosticDatabase,
  attemptId: string,
  stage: NativeConnectionStage,
  completed = false,
): Promise<void> {
  await db.prepare(
    `UPDATE native_connection_attempts
     SET stage=?, last_completed_stage=CASE WHEN ? THEN ? ELSE last_completed_stage END
     WHERE attempt_id=?`,
  ).bind(stage, completed ? 1 : 0, stage, attemptId).run();
}

export async function failNativeConnectionAttempt(
  db: ConnectionDiagnosticDatabase,
  attemptId: string,
  input: {
    stage: NativeConnectionStage;
    status?: number;
    errorCode: string;
    timeoutReason?: "runtime_timeout" | "upstream_timeout" | "diagnostics_write_failed";
  },
): Promise<void> {
  const status = Number.isInteger(input.status) && input.status! >= 100 && input.status! <= 599
    ? input.status! : null;
  const errorCode = /^[A-Z0-9_]{1,80}$/.test(input.errorCode)
    ? input.errorCode : "NATIVE_CONNECTION_FAILED";
  await db.prepare(
    `UPDATE native_connection_attempts
     SET finished_at_ms=?,status='failed',stage=?,http_status=?,error_code=?,timeout_reason=?
     WHERE attempt_id=?`,
  ).bind(Date.now(), input.stage, status, errorCode, input.timeoutReason || null, attemptId).run();
}

export async function completeNativeConnectionHandshake(
  db: ConnectionDiagnosticDatabase,
  attemptId: string,
): Promise<void> {
  await db.prepare(
    `UPDATE native_connection_attempts
     SET status='connected',stage='websocket_handshake',http_status=101,last_completed_stage='websocket_handshake'
     WHERE attempt_id=?`,
  ).bind(attemptId).run();
}

export async function closeNativeConnectionAttempt(
  db: ConnectionDiagnosticDatabase,
  attemptId: string,
  normalClose: boolean,
): Promise<void> {
  await db.prepare(
    `UPDATE native_connection_attempts
     SET finished_at_ms=?,status='disconnected',stage='websocket_closed',timeout_reason=?
     WHERE attempt_id=? AND status='connected'`,
  ).bind(Date.now(), normalClose ? "normal_close" : "remote_close", attemptId).run();
}
