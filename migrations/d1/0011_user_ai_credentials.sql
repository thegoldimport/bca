CREATE TABLE IF NOT EXISTS user_ai_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'managed' CHECK (mode IN ('managed', 'byok')),
  provider TEXT,
  model_id TEXT,
  encrypted_api_key TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (mode = 'managed' AND provider IS NULL AND model_id IS NULL AND encrypted_api_key IS NULL)
    OR
    (mode = 'byok' AND provider IS NOT NULL AND model_id IS NOT NULL AND encrypted_api_key IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_user_ai_credentials_updated_at
  ON user_ai_credentials(updated_at);
