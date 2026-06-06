ALTER TABLE admin_auth ADD COLUMN admin_name TEXT;
ALTER TABLE admin_auth ADD COLUMN admin_email TEXT;
ALTER TABLE admin_auth ADD COLUMN reset_token_hash TEXT;
ALTER TABLE admin_auth ADD COLUMN reset_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_auth_email ON admin_auth(admin_email);
CREATE INDEX IF NOT EXISTS idx_admin_auth_reset ON admin_auth(reset_token_hash);
