-- Additive staging-only metadata for a retry-safe product project -> stock agent link.
ALTER TABLE projects ADD COLUMN creation_key TEXT;
CREATE UNIQUE INDEX projects_owner_creation_key_idx ON projects(user_id, creation_key);
ALTER TABLE runtime_project_links ADD COLUMN initialization_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE runtime_project_links ADD COLUMN initialization_error TEXT;
ALTER TABLE runtime_project_links ADD COLUMN initialization_started_at TEXT;
ALTER TABLE runtime_project_links ADD COLUMN runtime_provider TEXT NOT NULL DEFAULT 'compat';
UPDATE runtime_project_links SET initialization_status='ready' WHERE agent_id IS NOT NULL;