CREATE TABLE IF NOT EXISTS native_connection_attempts (
  attempt_id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('connecting', 'connected', 'failed', 'disconnected')),
  stage TEXT NOT NULL,
  http_status INTEGER,
  error_code TEXT,
  correlation_id TEXT NOT NULL,
  timeout_reason TEXT,
  last_completed_stage TEXT
);

CREATE INDEX IF NOT EXISTS idx_native_connection_attempts_project_started
  ON native_connection_attempts(project_id, user_id, started_at_ms DESC);
