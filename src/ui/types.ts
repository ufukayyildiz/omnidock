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
  deleted_at: string | null;
  junk_at: string | null;
  external_account_id: string | null;
  external_folder: string | null;
  external_uid: number | null;
  external_deleted_at: string | null;
  received_at: string | null;
  created_at: string;
};

export type ThreadRow = MessageRow & {
  message_count: number;
  unread_count: number;
  latest_at: string;
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

export type ExternalSyncJobStatus = "queued" | "running" | "complete" | "failed";

export type ExternalSyncJobRow = {
  account_id: string;
  status: ExternalSyncJobStatus;
  folders_json: string;
  folder_index: number;
  next_uid_exclusive: number | null;
  imported: number;
  skipped: number;
  checked: number;
  run_count: number;
  has_more: number;
  message: string | null;
  last_error: string | null;
  lease_until: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type AuditLogRow = {
  id: string;
  action: string;
  actor: string;
  target: string | null;
  metadata_json: string;
  created_at: string;
};

export type BucketRow = {
  id: string;
  name: string;
  binding: string;
  configured: boolean;
  writable: boolean;
  description: string;
};

export type BucketFolderRow = {
  key: string;
  name: string;
};

export type BucketObjectRow = {
  key: string;
  name: string;
  size: number;
  uploaded: string;
  etag: string;
  contentType: string;
};

export type BucketSearchResultRow = BucketObjectRow & {
  bucketId: string;
  bucketName: string;
  bucketBinding: string;
  match: "path" | "content";
  snippet: string | null;
};

export type BootstrapPayload = {
  ok: true;
  managementHost: string;
  domains: DomainRow[];
  mailboxes: MailboxRow[];
  contacts: ContactRow[];
  signatures: MailboxSignatureRow[];
  externalAccounts: ExternalAccountRow[];
  buckets: BucketRow[];
  stats: Record<string, number>;
  threads: ThreadRow[];
};

export type ThreadListPayload = {
  ok: true;
  threads: ThreadRow[];
  stats: Record<string, number>;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type BucketObjectsPayload = {
  ok: true;
  bucket: BucketRow;
  prefix: string;
  folders: BucketFolderRow[];
  objects: BucketObjectRow[];
  cursor: string | null;
  truncated: boolean;
};

export type BucketSearchPayload = {
  ok: true;
  query: string;
  scope: "bucket" | "all";
  bucket: BucketRow | null;
  results: BucketSearchResultRow[];
  scanned: number;
  contentScanned: number;
  contentErrors: number;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
};

export type BucketTextIndexRow = {
  id: string;
  bucket_id: string;
  bucket_name: string;
  bucket_binding: string;
  object_key: string;
  object_name: string;
  object_size: number;
  object_etag: string | null;
  object_content_type: string | null;
  source: string;
  text: string;
  normalized_text: string;
  created_at: string;
  updated_at: string;
};

export type BucketIndexJobRow = {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  bucket_index: number;
  cursor: string | null;
  scanned: number;
  indexed: number;
  skipped: number;
  failed: number;
  ocr_indexed: number;
  message: string | null;
  last_error: string | null;
  lease_until: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type BucketIndexPayload = {
  ok: true;
  job: BucketIndexJobRow | null;
  buckets: BucketRow[];
  aiConfigured: boolean;
};

export type BucketTextIndexPayload = {
  ok: true;
  index: BucketTextIndexRow | null;
};

export type AuditLogsPayload = {
  ok: true;
  logs: AuditLogRow[];
};

export type SetupStatusPayload = {
  ok: true;
  setupRequired: boolean;
  resetAvailable: boolean;
  configurationReady: boolean;
  requirements: RuntimeRequirement[];
  primaryDomain: string | null;
  passwordFromSecret: boolean;
};

export type RuntimeRequirement = {
  kind: "binding" | "secret" | "variable";
  name: string;
  required: boolean;
  configured: boolean;
  message: string;
};

export type ThreadPayload = {
  ok: true;
  messages: MessageRow[];
  attachments: AttachmentRow[];
};

export type FolderKey = "inbox" | "sent" | "archive" | "trash" | "junk";
