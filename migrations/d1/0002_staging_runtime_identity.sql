-- Keep existing staging account data and its legacy hashes without requiring
-- new runtime-owned customer accounts to have a BuildCustom password.
-- A parent-table rebuild would cascade-delete projects and sessions in D1.
ALTER TABLE users ADD COLUMN legacy_password_hash TEXT;
ALTER TABLE users ADD COLUMN display_name TEXT;
UPDATE users SET legacy_password_hash = password, display_name = username;
ALTER TABLE users DROP COLUMN password;