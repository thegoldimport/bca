CREATE TABLE IF NOT EXISTS native_build_attempts (
  attempt_id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  last_stage TEXT NOT NULL,
  last_successful_stage TEXT,
  failure_stage TEXT,
  error_code TEXT,
  customer_message TEXT,
  provider TEXT,
  model_id TEXT,
  correlation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_native_build_attempts_project_started
  ON native_build_attempts(project_id, user_id, started_at_ms DESC);

CREATE TABLE IF NOT EXISTS native_build_events (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES native_build_attempts(attempt_id) ON DELETE CASCADE,
  occurred_at_ms INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'complete', 'error', 'info')),
  error_code TEXT,
  customer_message TEXT,
  provider_status INTEGER,
  correlation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_native_build_events_attempt_time
  ON native_build_events(attempt_id, occurred_at_ms);
