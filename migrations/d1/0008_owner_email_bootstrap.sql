CREATE TABLE IF NOT EXISTS owner_email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  consume_nonce TEXT
);

CREATE INDEX IF NOT EXISTS owner_email_tokens_user_idx
  ON owner_email_verification_tokens(user_id, expires_at_ms);

CREATE TABLE IF NOT EXISTS owner_email_verification_proofs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  verified_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  consume_nonce TEXT
);

CREATE TABLE IF NOT EXISTS owner_bootstrap_rate_limits (
  bucket_hash TEXT PRIMARY KEY,
  window_started_at_ms INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0)
);

CREATE TABLE IF NOT EXISTS owner_bootstrap_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  consumed_at_ms INTEGER,
  consume_nonce TEXT
);

INSERT OR IGNORE INTO owner_bootstrap_state(singleton, consumed_at_ms, consume_nonce)
VALUES (1, NULL, NULL);
