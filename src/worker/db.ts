import { ApiError, RuntimeEnv, splitAddresses } from "./http";

export type DomainRow = {
  id: string;
  domain: string;
  zone_id: string | null;
  source: string;
  sending_enabled: number;
  routing_enabled: number;
  catch_all_enabled: number;
  is_default: number;
  worker_rule_id: string | null;
  status: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MailboxRow = {
  id: string;
  domain_id: string;
  address: string;
  local_part: string;
  display_name: string | null;
  enabled: number;
  routing_enabled: number;
  routing_rule_id: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  thread_id: string;
  direction: "inbound" | "outbound";
  mailbox: string;
  domain: string;
  from_address: string;
  from_name: string | null;
  to_json: string;
  cc_json: string;
  bcc_json: string;
  subject: string;
  snippet: string;
  text_body: string | null;
  html_body: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  raw_r2_key: string | null;
  sent_status: string | null;
  sent_message_id: string | null;
  error: string | null;
  read_at: string | null;
  archived_at: string | null;
  received_at: string | null;
  created_at: string;
};

export type AttachmentRow = {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: number;
  r2_key: string;
  disposition: string | null;
  content_id: string | null;
  created_at: string;
};

export type ContactRow = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  tags: string | null;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export type ContactImportReport = {
  imported: number;
  created: number;
  updated: number;
  skipped: number;
  rows: {
    email: string;
    status: "created" | "updated" | "skipped";
    message?: string;
  }[];
};

export type MailboxSignatureRow = {
  id: string;
  mailbox_id: string;
  text_signature: string;
  html_signature: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type ExternalAccountRow = {
  id: string;
  provider: string;
  email: string;
  display_name: string | null;
  username: string | null;
  auth_type: string;
  credential_secret_name: string | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_security: string;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_security: string;
  inbound_enabled: number;
  outbound_enabled: number;
  status: string;
  last_checked_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AuditLogRow = {
  id: string;
  action: string;
  actor: string;
  target: string | null;
  metadata_json: string;
  created_at: string;
};

const EXTERNAL_MAILBOX_SCOPE_PREFIX = "external:";

export type ThreadRow = MessageRow & {
  message_count: number;
  unread_count: number;
  latest_at: string;
};

export type NewMessage = {
  id?: string;
  threadId?: string;
  direction: "inbound" | "outbound";
  mailbox: string;
  domain: string;
  fromAddress: string;
  fromName?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  snippet: string;
  textBody?: string | null;
  htmlBody?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  rawR2Key?: string | null;
  sentStatus?: string | null;
  sentMessageId?: string | null;
  error?: string | null;
  readAt?: string | null;
  receivedAt?: string | null;
  createdAt?: string | null;
};

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (!isValidDomain(domain)) {
    throw new ApiError(400, "invalid_domain", "Domain is invalid");
  }
  return domain;
}

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) {
    throw new ApiError(400, "invalid_email", "Email address is invalid");
  }

  normalizeDomain(email.slice(at + 1));

  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(email.slice(0, at))) {
    throw new ApiError(400, "invalid_email", "Email local part is invalid");
  }

  return email;
}

export function domainFromEmail(email: string): string {
  return normalizeEmail(email).split("@")[1];
}

export function localPartFromEmail(email: string): string {
  return normalizeEmail(email).split("@")[0];
}

export async function listDomains(env: RuntimeEnv): Promise<DomainRow[]> {
  const result = await env.DB.prepare("SELECT * FROM domains ORDER BY domain ASC").all<DomainRow>();
  return result.results ?? [];
}

export async function listMailboxes(env: RuntimeEnv): Promise<MailboxRow[]> {
  const result = await env.DB.prepare("SELECT * FROM mailboxes ORDER BY address ASC").all<MailboxRow>();
  return result.results ?? [];
}

export async function listContacts(env: RuntimeEnv): Promise<ContactRow[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM contacts ORDER BY COALESCE(name, email) COLLATE NOCASE ASC LIMIT 1000"
  ).all<ContactRow>();
  return result.results ?? [];
}

export async function listExternalAccounts(env: RuntimeEnv): Promise<ExternalAccountRow[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM external_accounts ORDER BY email COLLATE NOCASE ASC LIMIT 200"
  ).all<ExternalAccountRow>();
  return result.results ?? [];
}

export async function getExternalAccountById(env: RuntimeEnv, id: string): Promise<ExternalAccountRow | null> {
  return (await env.DB.prepare("SELECT * FROM external_accounts WHERE id = ?").bind(id).first<ExternalAccountRow>()) ?? null;
}

export async function getExternalAccountByEmail(env: RuntimeEnv, email: string): Promise<ExternalAccountRow | null> {
  return (await env.DB.prepare("SELECT * FROM external_accounts WHERE email = ?").bind(normalizeEmail(email)).first<ExternalAccountRow>()) ?? null;
}

export async function upsertExternalAccount(
  env: RuntimeEnv,
  input: {
    id?: string | null;
    provider: string;
    email: string;
    displayName?: string | null;
    username?: string | null;
    authType: string;
    credentialSecretName?: string | null;
    imapHost?: string | null;
    imapPort?: number | null;
    imapSecurity: string;
    smtpHost?: string | null;
    smtpPort?: number | null;
    smtpSecurity: string;
    inboundEnabled: boolean;
    outboundEnabled: boolean;
    notes?: string | null;
  }
): Promise<ExternalAccountRow> {
  const email = normalizeEmail(input.email);
  const existingById = input.id
    ? await env.DB.prepare("SELECT * FROM external_accounts WHERE id = ?").bind(input.id).first<ExternalAccountRow>()
    : null;
  if (input.id && !existingById) {
    throw new ApiError(404, "external_account_not_found", "External account not found");
  }

  const existingByEmail = await env.DB.prepare("SELECT * FROM external_accounts WHERE email = ?")
    .bind(email)
    .first<ExternalAccountRow>();
  if (existingByEmail && existingById && existingByEmail.id !== existingById.id) {
    throw new ApiError(409, "external_account_exists", "External account email already exists");
  }

  const existing = existingById ?? existingByEmail;
  const status = input.authType === "none" || nullableText(input.credentialSecretName) ? "configured" : "needs_secret";

  if (!existing) {
    const id = createId("ext");
    await env.DB.prepare(
      `INSERT INTO external_accounts (
        id, provider, email, display_name, username, auth_type, credential_secret_name,
        imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security,
        inbound_enabled, outbound_enabled, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        input.provider,
        email,
        nullableText(input.displayName),
        nullableText(input.username) ?? email,
        input.authType,
        nullableText(input.credentialSecretName),
        nullableText(input.imapHost),
        input.imapPort ?? null,
        input.imapSecurity,
        nullableText(input.smtpHost),
        input.smtpPort ?? null,
        input.smtpSecurity,
        input.inboundEnabled ? 1 : 0,
        input.outboundEnabled ? 1 : 0,
        status,
        nullableText(input.notes)
      )
      .run();

    const created = await env.DB.prepare("SELECT * FROM external_accounts WHERE id = ?")
      .bind(id)
      .first<ExternalAccountRow>();
    if (!created) {
      throw new ApiError(500, "external_account_insert_failed", "External account could not be saved");
    }
    return created;
  }

  await env.DB.prepare(
    `UPDATE external_accounts
     SET provider = ?, email = ?, display_name = ?, username = ?, auth_type = ?,
         credential_secret_name = ?, imap_host = ?, imap_port = ?, imap_security = ?,
         smtp_host = ?, smtp_port = ?, smtp_security = ?, inbound_enabled = ?,
         outbound_enabled = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      input.provider,
      email,
      nullableText(input.displayName),
      nullableText(input.username) ?? email,
      input.authType,
      nullableText(input.credentialSecretName),
      nullableText(input.imapHost),
      input.imapPort ?? null,
      input.imapSecurity,
      nullableText(input.smtpHost),
      input.smtpPort ?? null,
      input.smtpSecurity,
      input.inboundEnabled ? 1 : 0,
      input.outboundEnabled ? 1 : 0,
      status,
      nullableText(input.notes),
      existing.id
    )
    .run();

  const updated = await env.DB.prepare("SELECT * FROM external_accounts WHERE id = ?")
    .bind(existing.id)
    .first<ExternalAccountRow>();
  if (!updated) {
    throw new ApiError(500, "external_account_update_failed", "External account could not be saved");
  }
  return updated;
}

export async function deleteExternalAccount(env: RuntimeEnv, id: string): Promise<void> {
  const result = await env.DB.prepare("DELETE FROM external_accounts WHERE id = ?").bind(id).run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new ApiError(404, "external_account_not_found", "External account not found");
  }
}

export async function markExternalAccountChecked(
  env: RuntimeEnv,
  id: string,
  status = "configured"
): Promise<ExternalAccountRow | null> {
  await env.DB.prepare(
    `UPDATE external_accounts
     SET status = ?, last_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(status, id)
    .run();
  return getExternalAccountById(env, id);
}

export async function upsertContact(
  env: RuntimeEnv,
  input: {
    id?: string | null;
    email: string;
    name?: string | null;
    company?: string | null;
    phone?: string | null;
    tags?: string | null;
    notes?: string | null;
    source?: string;
  }
): Promise<ContactRow> {
  return (await saveContact(env, input)).contact;
}

async function saveContact(
  env: RuntimeEnv,
  input: {
    id?: string | null;
    email: string;
    name?: string | null;
    company?: string | null;
    phone?: string | null;
    tags?: string | null;
    notes?: string | null;
    source?: string;
  }
): Promise<{ contact: ContactRow; status: "created" | "updated" }> {
  const email = normalizeEmail(input.email);
  const existingById = input.id
    ? await env.DB.prepare("SELECT * FROM contacts WHERE id = ?").bind(input.id).first<ContactRow>()
    : null;

  if (input.id && !existingById) {
    throw new ApiError(404, "contact_not_found", "Contact not found");
  }

  const existingByEmail = await env.DB.prepare("SELECT * FROM contacts WHERE email = ?")
    .bind(email)
    .first<ContactRow>();
  if (existingByEmail && existingById && existingByEmail.id !== existingById.id) {
    throw new ApiError(409, "contact_exists", "Contact email already exists");
  }
  const existing = existingById ?? existingByEmail;

  if (!existing) {
    const id = createId("con");
    await env.DB.prepare(
      `INSERT INTO contacts (id, email, name, company, phone, tags, notes, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        email,
        nullableText(input.name),
        nullableText(input.company),
        nullableText(input.phone),
        nullableText(input.tags),
        nullableText(input.notes),
        input.source ?? "manual"
      )
      .run();

    const created = await env.DB.prepare("SELECT * FROM contacts WHERE id = ?")
      .bind(id)
      .first<ContactRow>();
    if (!created) {
      throw new ApiError(500, "contact_insert_failed", "Contact could not be created");
    }
    return { contact: created, status: "created" };
  }

  await env.DB.prepare(
    `UPDATE contacts
     SET email = ?, name = ?, company = ?, phone = ?, tags = ?, notes = ?, source = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      email,
      nullableText(input.name) ?? existing.name,
      nullableText(input.company) ?? existing.company,
      nullableText(input.phone) ?? existing.phone,
      nullableText(input.tags) ?? existing.tags,
      nullableText(input.notes) ?? existing.notes,
      input.source ?? existing.source,
      existing.id
    )
    .run();

  const updated = await env.DB.prepare("SELECT * FROM contacts WHERE id = ?")
    .bind(existing.id)
    .first<ContactRow>();
  if (!updated) {
    throw new ApiError(500, "contact_update_failed", "Contact could not be updated");
  }
  return { contact: updated, status: "updated" };
}

export async function deleteContact(env: RuntimeEnv, id: string): Promise<void> {
  const result = await env.DB.prepare("DELETE FROM contacts WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) {
    throw new ApiError(404, "contact_not_found", "Contact not found");
  }
}

export async function importContacts(
  env: RuntimeEnv,
  contacts: {
    email: string;
    name?: string | null;
    company?: string | null;
    phone?: string | null;
    tags?: string | null;
    notes?: string | null;
  }[],
  source = "upload"
): Promise<ContactImportReport> {
  const report: ContactImportReport = {
    imported: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    rows: []
  };
  for (const contact of contacts.slice(0, 1000)) {
    try {
      const saved = await saveContact(env, { ...contact, source });
      report.imported += 1;
      report[saved.status] += 1;
      report.rows.push({ email: saved.contact.email, status: saved.status });
    } catch (error) {
      report.skipped += 1;
      report.rows.push({
        email: contact.email,
        status: "skipped",
        message: error instanceof Error ? error.message : "Could not import contact"
      });
    }
  }
  return report;
}

export async function listMailboxSignatures(env: RuntimeEnv): Promise<MailboxSignatureRow[]> {
  const result = await env.DB.prepare("SELECT * FROM mailbox_signatures ORDER BY updated_at DESC")
    .all<MailboxSignatureRow>();
  return result.results ?? [];
}

export async function getSignatureForMailboxAddress(
  env: RuntimeEnv,
  address: string
): Promise<MailboxSignatureRow | null> {
  const mailbox = await getMailboxByAddress(env, address);
  if (!mailbox) {
    return null;
  }

  return (
    (await env.DB.prepare("SELECT * FROM mailbox_signatures WHERE mailbox_id = ?")
      .bind(mailbox.id)
      .first<MailboxSignatureRow>()) ?? null
  );
}

export async function upsertMailboxSignature(
  env: RuntimeEnv,
  input: { mailboxId: string; textSignature: string; htmlSignature?: string | null; enabled: boolean }
): Promise<MailboxSignatureRow> {
  const mailbox = await getMailboxById(env, input.mailboxId);
  if (!mailbox) {
    throw new ApiError(404, "mailbox_not_found", "Mailbox not found");
  }

  const existing = await env.DB.prepare("SELECT * FROM mailbox_signatures WHERE mailbox_id = ?")
    .bind(input.mailboxId)
    .first<MailboxSignatureRow>();

  if (!existing) {
    const id = createId("sig");
    await env.DB.prepare(
      `INSERT INTO mailbox_signatures (id, mailbox_id, text_signature, html_signature, enabled)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(id, input.mailboxId, input.textSignature, nullableText(input.htmlSignature), input.enabled ? 1 : 0)
      .run();

    const created = await env.DB.prepare("SELECT * FROM mailbox_signatures WHERE id = ?")
      .bind(id)
      .first<MailboxSignatureRow>();
    if (!created) {
      throw new ApiError(500, "signature_insert_failed", "Signature could not be saved");
    }
    return created;
  }

  await env.DB.prepare(
    `UPDATE mailbox_signatures
     SET text_signature = ?, html_signature = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(input.textSignature, nullableText(input.htmlSignature), input.enabled ? 1 : 0, existing.id)
    .run();

  const updated = await env.DB.prepare("SELECT * FROM mailbox_signatures WHERE id = ?")
    .bind(existing.id)
    .first<MailboxSignatureRow>();
  if (!updated) {
    throw new ApiError(500, "signature_update_failed", "Signature could not be saved");
  }
  return updated;
}

export async function getMailboxById(env: RuntimeEnv, id: string): Promise<MailboxRow | null> {
  const row = await env.DB.prepare("SELECT * FROM mailboxes WHERE id = ?").bind(id).first<MailboxRow>();
  return row ?? null;
}

export async function getMailboxByAddress(env: RuntimeEnv, address: string): Promise<MailboxRow | null> {
  const row = await env.DB.prepare("SELECT * FROM mailboxes WHERE address = ?")
    .bind(normalizeEmail(address))
    .first<MailboxRow>();
  return row ?? null;
}

export async function getDomainByName(env: RuntimeEnv, domain: string): Promise<DomainRow | null> {
  const row = await env.DB.prepare("SELECT * FROM domains WHERE domain = ?")
    .bind(normalizeDomain(domain))
    .first<DomainRow>();
  return row ?? null;
}

export async function getDomainById(env: RuntimeEnv, id: string): Promise<DomainRow | null> {
  const row = await env.DB.prepare("SELECT * FROM domains WHERE id = ?").bind(id).first<DomainRow>();
  return row ?? null;
}

export async function getDefaultDomain(env: RuntimeEnv): Promise<DomainRow | null> {
  const row = await env.DB.prepare("SELECT * FROM domains WHERE is_default = 1 LIMIT 1").first<DomainRow>();
  return row ?? null;
}

export async function setDefaultDomain(env: RuntimeEnv, id: string): Promise<DomainRow> {
  const domain = await getDomainById(env, id);
  if (!domain) {
    throw new ApiError(404, "domain_not_found", "Domain not found");
  }

  await env.DB.prepare("UPDATE domains SET is_default = 0 WHERE is_default = 1").run();
  await env.DB.prepare("UPDATE domains SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(id)
    .run();

  const updated = await getDomainById(env, id);
  if (!updated) {
    throw new ApiError(500, "domain_default_failed", "Default domain could not be saved");
  }
  return updated;
}

export async function upsertDomain(
  env: RuntimeEnv,
  input: {
    domain: string;
    zoneId?: string | null;
    source?: string;
    sendingEnabled?: boolean;
    routingEnabled?: boolean;
    catchAllEnabled?: boolean;
    workerRuleId?: string | null;
    status?: string;
    syncedAt?: string | null;
  }
): Promise<DomainRow> {
  const domain = normalizeDomain(input.domain);
  const existing = await getDomainByName(env, domain);

  if (!existing) {
    const id = createId("dom");
    await env.DB.prepare(
      `INSERT INTO domains (
        id, domain, zone_id, source, sending_enabled, routing_enabled, catch_all_enabled,
        worker_rule_id, status, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        domain,
        input.zoneId ?? null,
        input.source ?? "manual",
        input.sendingEnabled ? 1 : 0,
        input.routingEnabled ? 1 : 0,
        input.catchAllEnabled ? 1 : 0,
        input.workerRuleId ?? null,
        input.status ?? "pending",
        input.syncedAt ?? null
      )
      .run();

    const created = await getDomainByName(env, domain);
    if (!created) {
      throw new ApiError(500, "domain_insert_failed", "Domain could not be created");
    }
    return created;
  }

  await env.DB.prepare(
    `UPDATE domains
     SET zone_id = ?, source = ?, sending_enabled = ?, routing_enabled = ?, catch_all_enabled = ?,
         worker_rule_id = ?, status = ?, last_synced_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      input.zoneId ?? existing.zone_id,
      input.source ?? existing.source,
      input.sendingEnabled === undefined ? existing.sending_enabled : input.sendingEnabled ? 1 : 0,
      input.routingEnabled === undefined ? existing.routing_enabled : input.routingEnabled ? 1 : 0,
      input.catchAllEnabled === undefined ? existing.catch_all_enabled : input.catchAllEnabled ? 1 : 0,
      input.workerRuleId ?? existing.worker_rule_id,
      input.status ?? existing.status,
      input.syncedAt ?? existing.last_synced_at,
      existing.id
    )
    .run();

  const updated = await getDomainByName(env, domain);
  if (!updated) {
    throw new ApiError(500, "domain_update_failed", "Domain could not be updated");
  }
  return updated;
}

export async function ensureMailbox(
  env: RuntimeEnv,
  address: string,
  displayName: string | null = null
): Promise<MailboxRow> {
  const normalized = normalizeEmail(address);
  const existing = await env.DB.prepare("SELECT * FROM mailboxes WHERE address = ?")
    .bind(normalized)
    .first<MailboxRow>();
  if (existing) {
    return existing;
  }

  const mailboxDomain = domainFromEmail(normalized);
  const domain =
    (await getDomainByName(env, mailboxDomain)) ??
    (await upsertDomain(env, {
      domain: mailboxDomain,
      source: "inbound",
      routingEnabled: true,
      status: "routing-seen"
    }));

  const id = createId("mbx");
  await env.DB.prepare(
    `INSERT INTO mailboxes (id, domain_id, address, local_part, display_name)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, domain.id, normalized, localPartFromEmail(normalized), displayName)
    .run();

  const created = await env.DB.prepare("SELECT * FROM mailboxes WHERE id = ?")
    .bind(id)
    .first<MailboxRow>();
  if (!created) {
    throw new ApiError(500, "mailbox_insert_failed", "Mailbox could not be created");
  }
  return created;
}

export async function createMailboxForDomain(
  env: RuntimeEnv,
  domainId: string,
  localPart: string,
  displayName: string | null
): Promise<MailboxRow> {
  const domain = await getDomainById(env, domainId);
  if (!domain) {
    throw new ApiError(404, "domain_not_found", "Domain not found");
  }

  const local = localPart.trim().toLowerCase();
  const address = normalizeEmail(`${local}@${domain.domain}`);
  return ensureMailbox(env, address, displayName);
}

export async function markMailboxRouting(
  env: RuntimeEnv,
  mailboxId: string,
  ruleId: string | null
): Promise<MailboxRow> {
  await env.DB.prepare(
    `UPDATE mailboxes
     SET routing_enabled = 1, routing_rule_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(ruleId, mailboxId)
    .run();

  const updated = await getMailboxById(env, mailboxId);
  if (!updated) {
    throw new ApiError(500, "mailbox_update_failed", "Mailbox could not be updated");
  }
  return updated;
}

export async function insertMessage(env: RuntimeEnv, message: NewMessage): Promise<MessageRow> {
  const id = message.id ?? createId("msg");
  const threadId = message.threadId ?? createId("thr");

  await env.DB.prepare(
    `INSERT INTO messages (
      id, thread_id, direction, mailbox, domain, from_address, from_name, to_json, cc_json, bcc_json,
      subject, snippet, text_body, html_body, message_id, in_reply_to, references_header, raw_r2_key,
      sent_status, sent_message_id, error, read_at, received_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      threadId,
      message.direction,
      normalizeEmail(message.mailbox),
      normalizeDomain(message.domain),
      normalizeEmail(message.fromAddress),
      message.fromName ?? null,
      JSON.stringify(message.to.map(normalizeEmail)),
      JSON.stringify((message.cc ?? []).map(normalizeEmail)),
      JSON.stringify((message.bcc ?? []).map(normalizeEmail)),
      message.subject,
      message.snippet,
      message.textBody ?? null,
      message.htmlBody ?? null,
      message.messageId ?? null,
      message.inReplyTo ?? null,
      message.referencesHeader ?? null,
      message.rawR2Key ?? null,
      message.sentStatus ?? null,
      message.sentMessageId ?? null,
      message.error ?? null,
      message.readAt ?? null,
      message.receivedAt ?? null,
      message.createdAt ?? nowIso()
    )
    .run();

  const created = await env.DB.prepare("SELECT * FROM messages WHERE id = ?")
    .bind(id)
    .first<MessageRow>();
  if (!created) {
    throw new ApiError(500, "message_insert_failed", "Message could not be created");
  }
  return created;
}

export async function messageExistsByMessageId(env: RuntimeEnv, messageId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM messages WHERE message_id = ? LIMIT 1")
    .bind(messageId)
    .first<{ id: string }>();
  return Boolean(row?.id);
}

export async function insertAttachment(
  env: RuntimeEnv,
  input: {
    messageId: string;
    filename: string;
    contentType: string;
    size: number;
    r2Key: string;
    disposition?: string | null;
    contentId?: string | null;
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO attachments (
      id, message_id, filename, content_type, size, r2_key, disposition, content_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      createId("att"),
      input.messageId,
      input.filename,
      input.contentType,
      input.size,
      input.r2Key,
      input.disposition ?? null,
      input.contentId ?? null
    )
    .run();
}

export async function getAttachmentById(env: RuntimeEnv, id: string): Promise<AttachmentRow | null> {
  const row = await env.DB.prepare("SELECT * FROM attachments WHERE id = ?")
    .bind(id)
    .first<AttachmentRow>();
  return row ?? null;
}

export async function findThreadForHeaders(
  env: RuntimeEnv,
  input: { inReplyTo?: string | null; references?: string | null; subject: string; mailbox: string }
): Promise<string | null> {
  const ids = parseMessageIds(`${input.inReplyTo ?? ""} ${input.references ?? ""}`);
  for (const messageId of ids) {
    const row = await env.DB.prepare("SELECT thread_id FROM messages WHERE message_id = ? LIMIT 1")
      .bind(messageId)
      .first<{ thread_id: string }>();
    if (row?.thread_id) {
      return row.thread_id;
    }
  }

  const normalizedSubject = normalizeSubject(input.subject);
  if (!normalizedSubject) {
    return null;
  }

  const fallback = await env.DB.prepare(
    `SELECT thread_id FROM messages
     WHERE mailbox = ? AND lower(replace(replace(subject, 'Re: ', ''), 'Fwd: ', '')) = ?
     ORDER BY created_at DESC LIMIT 1`
  )
    .bind(normalizeEmail(input.mailbox), normalizedSubject)
    .first<{ thread_id: string }>();

  return fallback?.thread_id ?? null;
}

export async function listThreads(
  env: RuntimeEnv,
  options: { folder: string; domainId?: string | null; mailboxId?: string | null; query?: string | null }
): Promise<ThreadRow[]> {
  const filters: string[] = [];
  const params: unknown[] = [];
  const searchTerm = options.query?.trim();

  if (!searchTerm) {
    if (options.folder === "sent") {
      filters.push("m.direction = 'outbound'");
      filters.push("m.archived_at IS NULL");
    } else if (options.folder === "archive") {
      filters.push("m.archived_at IS NOT NULL");
    } else {
      filters.push("m.direction = 'inbound'");
      filters.push("m.archived_at IS NULL");
    }
  }

  if (options.domainId) {
    const domain = await getDomainById(env, options.domainId);
    if (domain) {
      filters.push("m.domain = ?");
      params.push(domain.domain);
    }
  }

  if (options.mailboxId) {
    const externalAccountId = externalAccountIdFromMailboxScope(options.mailboxId);
    const scopedAddress = externalAccountId
      ? (await getExternalAccountById(env, externalAccountId))?.email
      : (await getMailboxById(env, options.mailboxId))?.address;
    if (scopedAddress) {
      filters.push("(m.mailbox = ? OR (m.direction = 'outbound' AND m.from_address = ?))");
      params.push(scopedAddress, scopedAddress);
    } else {
      filters.push("1 = 0");
    }
  }

  if (searchTerm) {
    const like = `%${searchTerm.toLowerCase()}%`;
    filters.push(
      `EXISTS (
        SELECT 1 FROM messages q
        WHERE q.thread_id = m.thread_id
          AND (
            lower(COALESCE(q.subject, '')) LIKE ?
            OR lower(COALESCE(q.from_address, '')) LIKE ?
            OR lower(COALESCE(q.from_name, '')) LIKE ?
            OR lower(COALESCE(q.to_json, '')) LIKE ?
            OR lower(COALESCE(q.cc_json, '')) LIKE ?
            OR lower(COALESCE(q.bcc_json, '')) LIKE ?
            OR lower(COALESCE(q.snippet, '')) LIKE ?
            OR lower(COALESCE(q.text_body, '')) LIKE ?
            OR lower(COALESCE(q.html_body, '')) LIKE ?
            OR lower(COALESCE(q.mailbox, '')) LIKE ?
            OR lower(COALESCE(q.domain, '')) LIKE ?
          )
      )`
    );
    params.push(like, like, like, like, like, like, like, like, like, like, like);
  }

  const where = filters.length > 0 ? filters.join(" AND ") : "1 = 1";
  const result = await env.DB.prepare(
    `WITH latest AS (
       SELECT m.thread_id, MAX(m.created_at) AS latest_at
       FROM messages m
       WHERE ${where}
       GROUP BY m.thread_id
     )
     SELECT m.*,
       latest.latest_at AS latest_at,
       (SELECT COUNT(*) FROM messages child WHERE child.thread_id = m.thread_id) AS message_count,
       (SELECT COUNT(*) FROM messages child WHERE child.thread_id = m.thread_id AND child.direction = 'inbound' AND child.read_at IS NULL) AS unread_count
     FROM messages m
     INNER JOIN latest ON latest.thread_id = m.thread_id AND latest.latest_at = m.created_at
     ORDER BY latest.latest_at DESC
     LIMIT 80`
  )
    .bind(...params)
    .all<ThreadRow>();

  return result.results ?? [];
}

export async function getThread(
  env: RuntimeEnv,
  threadId: string
): Promise<{ messages: MessageRow[]; attachments: AttachmentRow[] }> {
  const messagesResult = await env.DB.prepare(
    "SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC"
  )
    .bind(threadId)
    .all<MessageRow>();

  const messages = messagesResult.results ?? [];
  const attachments: AttachmentRow[] = [];

  for (const message of messages) {
    const result = await env.DB.prepare("SELECT * FROM attachments WHERE message_id = ? ORDER BY created_at ASC")
      .bind(message.id)
      .all<AttachmentRow>();
    attachments.push(...(result.results ?? []));
  }

  return { messages, attachments };
}

export async function markThreadRead(env: RuntimeEnv, threadId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE messages SET read_at = COALESCE(read_at, ?) WHERE thread_id = ? AND direction = 'inbound'"
  )
    .bind(nowIso(), threadId)
    .run();
}

export async function archiveThread(env: RuntimeEnv, threadId: string, archived: boolean): Promise<void> {
  await env.DB.prepare("UPDATE messages SET archived_at = ? WHERE thread_id = ?")
    .bind(archived ? nowIso() : null, threadId)
    .run();
}

export async function listThreadStorageKeys(env: RuntimeEnv, threadId: string): Promise<string[]> {
  const keys = new Set<string>();

  const messagesResult = await env.DB.prepare("SELECT id, raw_r2_key FROM messages WHERE thread_id = ?")
    .bind(threadId)
    .all<{ id: string; raw_r2_key: string | null }>();
  const messages = messagesResult.results ?? [];

  for (const message of messages) {
    if (message.raw_r2_key) {
      keys.add(message.raw_r2_key);
    }
  }

  const attachmentsResult = await env.DB.prepare(
    `SELECT attachments.r2_key
     FROM attachments
     INNER JOIN messages ON messages.id = attachments.message_id
     WHERE messages.thread_id = ?`
  )
    .bind(threadId)
    .all<{ r2_key: string }>();

  for (const attachment of attachmentsResult.results ?? []) {
    keys.add(attachment.r2_key);
  }

  return [...keys];
}

export async function deleteThread(env: RuntimeEnv, threadId: string): Promise<number> {
  const messagesResult = await env.DB.prepare("SELECT id FROM messages WHERE thread_id = ?")
    .bind(threadId)
    .all<{ id: string }>();
  const messages = messagesResult.results ?? [];

  if (messages.length === 0) {
    return 0;
  }

  for (const message of messages) {
    await env.DB.prepare("DELETE FROM attachments WHERE message_id = ?").bind(message.id).run();
  }

  await env.DB.prepare("DELETE FROM messages WHERE thread_id = ?").bind(threadId).run();
  return messages.length;
}

export async function getStats(env: RuntimeEnv): Promise<Record<string, number>> {
  const rows = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM domains) AS domains,
      (SELECT COUNT(*) FROM mailboxes) AS mailboxes,
      (SELECT COUNT(*) FROM contacts) AS contacts,
      (SELECT COUNT(*) FROM external_accounts) AS external_accounts,
      (SELECT COUNT(*) FROM audit_log) AS audit_logs,
      (SELECT COUNT(*) FROM messages WHERE direction = 'inbound' AND archived_at IS NULL) AS inbox,
      (SELECT COUNT(*) FROM messages WHERE direction = 'outbound' AND archived_at IS NULL) AS sent,
      (SELECT COUNT(*) FROM messages WHERE archived_at IS NOT NULL) AS archive,
      (SELECT COUNT(*) FROM messages WHERE direction = 'inbound' AND read_at IS NULL AND archived_at IS NULL) AS unread`
  ).first<Record<string, number>>();

  return rows ?? defaultStats();
}

export async function getMailboxStats(env: RuntimeEnv, mailboxId: string | null): Promise<Record<string, number>> {
  if (!mailboxId) {
    return getStats(env);
  }

  const externalAccountId = externalAccountIdFromMailboxScope(mailboxId);
  const scopedAddress = externalAccountId
    ? (await getExternalAccountById(env, externalAccountId))?.email
    : (await getMailboxById(env, mailboxId))?.address;
  if (!scopedAddress) {
    return defaultStats();
  }

  const rows = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM domains) AS domains,
      (SELECT COUNT(*) FROM mailboxes) AS mailboxes,
      (SELECT COUNT(*) FROM contacts) AS contacts,
      (SELECT COUNT(*) FROM external_accounts) AS external_accounts,
      (SELECT COUNT(*) FROM audit_log) AS audit_logs,
      (SELECT COUNT(*) FROM messages WHERE direction = 'inbound' AND archived_at IS NULL AND mailbox = ?) AS inbox,
      (SELECT COUNT(*) FROM messages WHERE direction = 'outbound' AND archived_at IS NULL AND from_address = ?) AS sent,
      (SELECT COUNT(*) FROM messages WHERE archived_at IS NOT NULL AND (mailbox = ? OR (direction = 'outbound' AND from_address = ?))) AS archive,
      (SELECT COUNT(*) FROM messages WHERE direction = 'inbound' AND read_at IS NULL AND archived_at IS NULL AND mailbox = ?) AS unread`
  )
    .bind(scopedAddress, scopedAddress, scopedAddress, scopedAddress, scopedAddress)
    .first<Record<string, number>>();

  return rows ?? defaultStats();
}

function defaultStats(): Record<string, number> {
  return {
    domains: 0,
    mailboxes: 0,
    contacts: 0,
    external_accounts: 0,
    audit_logs: 0,
    inbox: 0,
    sent: 0,
    archive: 0,
    unread: 0
  };
}

function externalAccountIdFromMailboxScope(mailboxId: string): string | null {
  return mailboxId.startsWith(EXTERNAL_MAILBOX_SCOPE_PREFIX) ? mailboxId.slice(EXTERNAL_MAILBOX_SCOPE_PREFIX.length) : null;
}

export async function recordAudit(
  env: RuntimeEnv,
  action: string,
  target: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await env.DB.prepare("INSERT INTO audit_log (id, action, target, metadata_json) VALUES (?, ?, ?, ?)")
    .bind(createId("aud"), action, target, JSON.stringify(metadata))
    .run();
}

export async function listAuditLogs(
  env: RuntimeEnv,
  options: { limit?: number; query?: string } = {}
): Promise<AuditLogRow[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 250), 1), 500);
  const query = options.query?.trim();

  if (query) {
    const like = `%${query}%`;
    const result = await env.DB.prepare(
      `SELECT * FROM audit_log
       WHERE action LIKE ? OR target LIKE ? OR metadata_json LIKE ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
      .bind(like, like, like, limit)
      .all<AuditLogRow>();
    return result.results ?? [];
  }

  const result = await env.DB.prepare(
    `SELECT * FROM audit_log
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  )
    .bind(limit)
    .all<AuditLogRow>();
  return result.results ?? [];
}

export async function deleteAuditLog(env: RuntimeEnv, id: string): Promise<number> {
  const result = await env.DB.prepare("DELETE FROM audit_log WHERE id = ?").bind(id).run();
  return result.meta.changes ?? 0;
}

export async function deleteAuditLogs(env: RuntimeEnv, options: { ids?: string[]; all?: boolean }): Promise<number> {
  if (options.all) {
    const result = await env.DB.prepare("DELETE FROM audit_log").run();
    return result.meta.changes ?? 0;
  }

  const ids = uniqueStrings((options.ids ?? []).map((id) => id.trim()).filter(Boolean)).slice(0, 500);
  if (ids.length === 0) {
    return 0;
  }

  const placeholders = ids.map(() => "?").join(", ");
  const result = await env.DB.prepare(`DELETE FROM audit_log WHERE id IN (${placeholders})`)
    .bind(...ids)
    .run();
  return result.meta.changes ?? 0;
}

function isValidDomain(domain: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}

function parseMessageIds(value: string): string[] {
  return [...value.matchAll(/<[^>]+>/g)].map((match) => match[0]).slice(0, 20);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeSubject(subject: string): string {
  return subject
    .trim()
    .replace(/^(re|fwd):\s*/i, "")
    .toLowerCase();
}

export function normalizeAddressList(value: string | string[]): string[] {
  return Array.isArray(value) ? value.flatMap(splitAddresses).map(normalizeEmail) : splitAddresses(value).map(normalizeEmail);
}

function nullableText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}
