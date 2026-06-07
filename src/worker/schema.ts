import { RuntimeEnv } from "./http";

const CURRENT_MIGRATIONS = [
  "0001_initial.sql",
  "0002_admin_auth.sql",
  "0003_mailbox_routing.sql",
  "0004_contacts_signatures.sql",
  "0005_default_domain.sql",
  "0006_admin_profile_reset.sql",
  "0007_external_accounts.sql",
  "0008_contact_phone.sql",
  "0009_auth_attempts.sql",
  "0010_bucket_text_index.sql",
  "0011_external_sync_jobs.sql",
  "0012_admin_sessions.sql"
];

let schemaReady: Promise<void> | null = null;

type TableInfoRow = {
  name: string;
};

export async function ensureDatabaseSchema(env: RuntimeEnv): Promise<void> {
  if (!schemaReady) {
    schemaReady = applyDatabaseSchema(env).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  await schemaReady;
}

async function applyDatabaseSchema(env: RuntimeEnv): Promise<void> {
  for (const statement of schemaStatements) {
    await env.DB.prepare(statement).run();
  }

  await addMissingColumns(env, "domains", {
    is_default: "INTEGER NOT NULL DEFAULT 0"
  });

  await addMissingColumns(env, "mailboxes", {
    routing_enabled: "INTEGER NOT NULL DEFAULT 0",
    routing_rule_id: "TEXT"
  });

  await addMissingColumns(env, "admin_auth", {
    admin_name: "TEXT",
    admin_email: "TEXT",
    reset_token_hash: "TEXT",
    reset_expires_at: "TEXT"
  });

  await addMissingColumns(env, "contacts", {
    phone: "TEXT"
  });

  for (const statement of indexStatements) {
    await env.DB.prepare(statement).run();
  }

  for (const migration of CURRENT_MIGRATIONS) {
    await env.DB.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)").bind(migration).run();
  }
}

async function addMissingColumns(
  env: RuntimeEnv,
  table: "admin_auth" | "contacts" | "domains" | "mailboxes",
  columns: Record<string, string>
): Promise<void> {
  const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all<TableInfoRow>();
  const existing = new Set((result.results ?? []).map((column) => column.name));

  for (const [column, definition] of Object.entries(columns)) {
    if (!existing.has(column)) {
      await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    }
  }
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    zone_id TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    sending_enabled INTEGER NOT NULL DEFAULT 0,
    routing_enabled INTEGER NOT NULL DEFAULT 0,
    catch_all_enabled INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    worker_rule_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS mailboxes (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL,
    address TEXT NOT NULL UNIQUE,
    local_part TEXT NOT NULL,
    display_name TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    routing_enabled INTEGER NOT NULL DEFAULT 0,
    routing_rule_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    mailbox TEXT NOT NULL,
    domain TEXT NOT NULL,
    from_address TEXT NOT NULL,
    from_name TEXT,
    to_json TEXT NOT NULL,
    cc_json TEXT NOT NULL DEFAULT '[]',
    bcc_json TEXT NOT NULL DEFAULT '[]',
    subject TEXT NOT NULL DEFAULT '',
    snippet TEXT NOT NULL DEFAULT '',
    text_body TEXT,
    html_body TEXT,
    message_id TEXT,
    in_reply_to TEXT,
    references_header TEXT,
    raw_r2_key TEXT,
    sent_status TEXT,
    sent_message_id TEXT,
    error TEXT,
    read_at TEXT,
    archived_at TEXT,
    received_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    r2_key TEXT NOT NULL,
    disposition TEXT,
    content_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'admin',
    target TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS admin_auth (
    id TEXT PRIMARY KEY CHECK (id = 'primary'),
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL,
    admin_name TEXT,
    admin_email TEXT,
    reset_token_hash TEXT,
    reset_expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
	    email TEXT NOT NULL UNIQUE,
	    name TEXT,
	    company TEXT,
	    phone TEXT,
	    tags TEXT,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS mailbox_signatures (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL UNIQUE,
    text_signature TEXT NOT NULL DEFAULT '',
    html_signature TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS external_accounts (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    username TEXT,
    auth_type TEXT NOT NULL DEFAULT 'app_password',
    credential_secret_name TEXT,
    imap_host TEXT,
    imap_port INTEGER,
    imap_security TEXT NOT NULL DEFAULT 'ssl',
    smtp_host TEXT,
    smtp_port INTEGER,
    smtp_security TEXT NOT NULL DEFAULT 'starttls',
    inbound_enabled INTEGER NOT NULL DEFAULT 0,
    outbound_enabled INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'needs_secret',
    last_checked_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS auth_attempts (
    key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS bucket_text_index (
    id TEXT PRIMARY KEY,
    bucket_id TEXT NOT NULL,
    bucket_name TEXT NOT NULL,
    bucket_binding TEXT NOT NULL,
    object_key TEXT NOT NULL,
    object_name TEXT NOT NULL,
    object_size INTEGER NOT NULL DEFAULT 0,
    object_etag TEXT,
    object_content_type TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    text TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(bucket_id, object_key)
  )`,
  `CREATE TABLE IF NOT EXISTS external_sync_jobs (
    account_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed')),
    folders_json TEXT NOT NULL DEFAULT '[]',
    folder_index INTEGER NOT NULL DEFAULT 0,
    next_uid_exclusive INTEGER,
    imported INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    checked INTEGER NOT NULL DEFAULT 0,
    run_count INTEGER NOT NULL DEFAULT 0,
    has_more INTEGER NOT NULL DEFAULT 1,
    message TEXT,
    last_error TEXT,
    lease_until TEXT,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY (account_id) REFERENCES external_accounts(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`
];

const indexStatements = [
  "CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain)",
  "CREATE INDEX IF NOT EXISTS idx_mailboxes_domain ON mailboxes(domain_id)",
  "CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_messages_mailbox ON messages(mailbox, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_messages_domain ON messages(domain, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id)",
  "CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email)",
  "CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name)",
  "CREATE INDEX IF NOT EXISTS idx_mailbox_signatures_mailbox ON mailbox_signatures(mailbox_id)",
  "CREATE INDEX IF NOT EXISTS idx_external_accounts_email ON external_accounts(email)",
  "CREATE INDEX IF NOT EXISTS idx_external_accounts_provider ON external_accounts(provider)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_domains_default ON domains(is_default) WHERE is_default = 1",
  "CREATE INDEX IF NOT EXISTS idx_admin_auth_email ON admin_auth(admin_email)",
  "CREATE INDEX IF NOT EXISTS idx_admin_auth_reset ON admin_auth(reset_token_hash)",
  "CREATE INDEX IF NOT EXISTS idx_auth_attempts_locked ON auth_attempts(locked_until)",
  "CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_bucket_text_index_bucket ON bucket_text_index(bucket_id, object_key)",
  "CREATE INDEX IF NOT EXISTS idx_bucket_text_index_normalized ON bucket_text_index(normalized_text)",
  "CREATE INDEX IF NOT EXISTS idx_external_sync_jobs_status ON external_sync_jobs(status, lease_until, updated_at)"
];
