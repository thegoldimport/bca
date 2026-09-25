PRAGMA foreign_keys = ON;

-- A single project-level lease prevents two native Think publishes from
-- concurrently replacing the same staging route.
CREATE TABLE IF NOT EXISTS native_publish_claims (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  claim_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS native_publish_releases (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  script_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  public_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, revision)
);

CREATE INDEX IF NOT EXISTS native_publish_releases_owner_project
  ON native_publish_releases(user_id, project_id, created_at DESC);