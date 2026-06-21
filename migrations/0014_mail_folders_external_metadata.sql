ALTER TABLE messages ADD COLUMN deleted_at TEXT;
ALTER TABLE messages ADD COLUMN junk_at TEXT;
ALTER TABLE messages ADD COLUMN external_account_id TEXT;
ALTER TABLE messages ADD COLUMN external_folder TEXT;
ALTER TABLE messages ADD COLUMN external_uid INTEGER;
ALTER TABLE messages ADD COLUMN external_deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_deleted
ON messages(deleted_at, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_junk
ON messages(junk_at, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_external
ON messages(external_account_id, external_folder, external_uid);
