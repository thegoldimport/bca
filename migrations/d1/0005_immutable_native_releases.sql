-- Preserve the existing release IDs and foreign keys while allowing a legacy
-- title-derived release and its immutable project/revision identity to coexist.
-- No tables reference native_publish_releases; its only foreign keys point to
-- projects and users, which remain unchanged.
CREATE TABLE native_publish_releases_v5 (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  script_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  public_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO native_publish_releases_v5 (
  id,user_id,project_id,revision,script_name,slug,public_url,status,created_at
)
SELECT id,user_id,project_id,revision,script_name,slug,public_url,status,created_at
FROM native_publish_releases;

DROP TABLE native_publish_releases;
ALTER TABLE native_publish_releases_v5 RENAME TO native_publish_releases;

CREATE INDEX native_publish_releases_owner_project
  ON native_publish_releases(user_id, project_id, created_at DESC);
CREATE UNIQUE INDEX native_publish_releases_project_script
  ON native_publish_releases(project_id, script_name);