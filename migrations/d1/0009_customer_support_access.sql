CREATE TABLE IF NOT EXISTS support_access_grants (
  id TEXT PRIMARY KEY NOT NULL,
  customer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission = 'read_only_diagnostics'),
  granted_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER,
  revoked_by_user_id TEXT,
  CHECK (expires_at_ms > granted_at_ms),
  UNIQUE (id, project_id, customer_user_id)
);

CREATE INDEX IF NOT EXISTS support_access_grants_customer_idx
  ON support_access_grants(customer_user_id, granted_at_ms DESC);

CREATE INDEX IF NOT EXISTS support_access_grants_project_idx
  ON support_access_grants(project_id, expires_at_ms, revoked_at_ms);

CREATE TABLE IF NOT EXISTS support_access_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  grant_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  customer_user_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at_ms INTEGER NOT NULL,
  last_access_at_ms INTEGER NOT NULL,
  closed_at_ms INTEGER,
  access_count INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
  FOREIGN KEY (grant_id, project_id, customer_user_id)
    REFERENCES support_access_grants(id, project_id, customer_user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS support_access_sessions_grant_idx
  ON support_access_sessions(grant_id, started_at_ms DESC);

CREATE INDEX IF NOT EXISTS support_access_sessions_admin_idx
  ON support_access_sessions(admin_user_id, started_at_ms DESC);
