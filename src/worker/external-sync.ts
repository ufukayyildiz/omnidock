import { connect } from "cloudflare:sockets";
import PostalMime from "postal-mime";
import {
  createId,
  domainFromEmail,
  findThreadForHeaders,
  getExternalAccountById,
  insertAttachment,
  insertMessage,
  listExternalAccounts,
  markExternalAccountChecked,
  markExternalMessagesDeleted,
  messageExistsByMessageId,
  normalizeEmail,
  nowIso,
  recordAudit,
  type ExternalAccountRow
} from "./db";
import { ApiError, RuntimeEnv, isRecord } from "./http";
import { htmlToPlainText as htmlToText } from "./html";
import { classifyJunkMail } from "./junk";
import { ensureDatabaseSchema } from "./schema";

type SyncOptions = {
  limit?: number;
  cursor?: ExternalSyncCursor;
  maxDurationMs?: number;
  onProgress?: (progress: ExternalSyncProgress) => Promise<void>;
};

export type ExternalSyncResult = {
  imported: number;
  skipped: number;
  checked: number;
  folders: string[];
  hasMore: boolean;
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

export type ExternalSyncJobRunResult = {
  ok: true;
  started: number;
  completed: number;
  failed: number;
  imported: number;
  skipped: number;
  checked: number;
  hasMore: boolean;
  jobs: ExternalSyncJobRow[];
};

type ExternalSyncCursor = {
  folders: string[];
  folderIndex: number;
  nextUidExclusive: number | null;
};

type ExternalSyncProgress = {
  imported: number;
  skipped: number;
  checked: number;
  folders: string[];
  folderIndex: number;
  nextUidExclusive: number | null;
  hasMore: boolean;
  force?: boolean;
};

type ExternalSyncBatchResult = ExternalSyncResult & {
  cursor: ExternalSyncCursor;
  complete: boolean;
  timedOut: boolean;
};

type ParsedAddress = {
  address?: string;
  name?: string;
};

type ImapFolder = {
  name: string;
  attributes: string[];
};

type ExternalFolderRole = "inbox" | "sent" | "junk" | "trash";

type ExternalDeleteRow = {
  id: string;
  message_id: string | null;
  external_account_id: string | null;
  external_folder: string | null;
  external_uid: number | null;
  account_id: string;
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

export type ExternalThreadDeleteResult = {
  attempted: number;
  deleted: number;
  skipped: number;
  failed: number;
  errors: string[];
};

const DEFAULT_SYNC_LIMIT = 300;
const MAX_SYNC_LIMIT = 800;
const SYNC_TIME_BUDGET_MS = 22_000;
export const EXTERNAL_SYNC_HTTP_BACKGROUND_MS = 25_000;
export const EXTERNAL_SYNC_SCHEDULED_RUN_MS = 20_000;
export const EXTERNAL_SYNC_MAX_RUN_MS = 15 * 60 * 1000;
const EXTERNAL_SYNC_SAFETY_MS = 3_000;
const EXTERNAL_SYNC_HEARTBEAT_MS = 4_000;
const EXTERNAL_SYNC_STALE_RUNNING_MS = 45_000;
const IMAP_CONNECT_TIMEOUT_MS = 12_000;
const IMAP_COMMAND_TIMEOUT_MS = 30_000;
const IMAP_FETCH_TIMEOUT_MS = 60_000;
const IMAP_LOGOUT_TIMEOUT_MS = 3_000;

export async function syncExternalAccount(
  env: RuntimeEnv,
  account: ExternalAccountRow,
  options: SyncOptions = {}
): Promise<ExternalSyncResult> {
  const result = await syncExternalAccountBatch(env, account, {
    ...options,
    maxDurationMs: options.maxDurationMs ?? SYNC_TIME_BUDGET_MS
  });
  await markExternalAccountChecked(env, account.id, "configured");
  await recordAudit(env, "external_account.synced", account.id, {
    email: account.email,
    imported: result.imported,
    skipped: result.skipped,
    checked: result.checked,
    hasMore: result.hasMore
  });

  return {
    imported: result.imported,
    skipped: result.skipped,
    checked: result.checked,
    folders: result.folders,
    hasMore: result.hasMore
  };
}

export async function listExternalSyncJobs(env: RuntimeEnv): Promise<ExternalSyncJobRow[]> {
  await ensureDatabaseSchema(env);
  await requeueExpiredExternalSyncJobs(env);
  const result = await env.DB.prepare(
    "SELECT * FROM external_sync_jobs ORDER BY updated_at DESC LIMIT 200"
  ).all<ExternalSyncJobRow>();
  return result.results ?? [];
}

export async function getExternalSyncJob(env: RuntimeEnv, accountId: string): Promise<ExternalSyncJobRow | null> {
  await ensureDatabaseSchema(env);
  return (
    (await env.DB.prepare("SELECT * FROM external_sync_jobs WHERE account_id = ?")
      .bind(accountId)
      .first<ExternalSyncJobRow>()) ?? null
  );
}

export async function queueExternalSyncJob(env: RuntimeEnv, account: ExternalAccountRow): Promise<ExternalSyncJobRow> {
  await ensureDatabaseSchema(env);
  await requeueExpiredExternalSyncJobs(env);
  if (account.inbound_enabled !== 1) {
    throw new ApiError(400, "external_inbound_disabled", "Inbound sync is disabled for this external account");
  }

  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO external_sync_jobs (
      account_id, status, folders_json, folder_index, next_uid_exclusive,
      imported, skipped, checked, run_count, has_more, message, last_error,
      lease_until, started_at, updated_at, completed_at
    ) VALUES (?, 'queued', '[]', 0, NULL, 0, 0, 0, 0, 1, ?, NULL, NULL, ?, ?, NULL)
    ON CONFLICT(account_id) DO UPDATE SET
      status = 'queued',
      folders_json = CASE WHEN external_sync_jobs.status IN ('complete', 'failed') THEN '[]' ELSE external_sync_jobs.folders_json END,
      folder_index = CASE WHEN external_sync_jobs.status IN ('complete', 'failed') THEN 0 ELSE external_sync_jobs.folder_index END,
      next_uid_exclusive = CASE WHEN external_sync_jobs.status IN ('complete', 'failed') THEN NULL ELSE external_sync_jobs.next_uid_exclusive END,
      imported = CASE WHEN external_sync_jobs.status IN ('complete', 'failed') THEN 0 ELSE external_sync_jobs.imported END,
      skipped = CASE WHEN external_sync_jobs.status IN ('complete', 'failed') THEN 0 ELSE external_sync_jobs.skipped END,
      checked = CASE WHEN external_sync_jobs.status IN ('complete', 'failed') THEN 0 ELSE external_sync_jobs.checked END,
      has_more = 1,
      message = excluded.message,
      last_error = NULL,
      lease_until = NULL,
      updated_at = excluded.updated_at,
      completed_at = NULL`
  )
    .bind(account.id, `Queued ${account.email}`, now, now)
    .run();

  const job = await getExternalSyncJob(env, account.id);
  if (!job) {
    throw new ApiError(500, "external_sync_queue_failed", "External sync job could not be queued");
  }
  return job;
}

async function requeueExpiredExternalSyncJobs(env: RuntimeEnv): Promise<void> {
  const staleBefore = new Date(Date.now() - EXTERNAL_SYNC_STALE_RUNNING_MS).toISOString();
  await env.DB.prepare(
    `UPDATE external_sync_jobs
     SET status = 'queued',
         message = 'Previous pull stopped before completion. Run Sync to continue remaining mail.',
         lease_until = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE status = 'running'
       AND (lease_until IS NULL OR lease_until < ? OR datetime(updated_at) < datetime(?))`
  )
    .bind(nowIso(), staleBefore)
    .run();
}

export async function queueAllExternalSyncJobs(env: RuntimeEnv): Promise<ExternalSyncJobRow[]> {
  const accounts = (await listExternalAccounts(env)).filter((account) => account.inbound_enabled === 1);
  const jobs: ExternalSyncJobRow[] = [];
  for (const account of accounts) {
    jobs.push(await queueExternalSyncJob(env, account));
  }
  return jobs;
}

export async function runExternalSyncJobs(
  env: RuntimeEnv,
  options: { accountId?: string; maxDurationMs?: number } = {}
): Promise<ExternalSyncJobRunResult> {
  await ensureDatabaseSchema(env);
  await requeueExpiredExternalSyncJobs(env);
  const maxDurationMs = Math.min(Math.max(options.maxDurationMs ?? EXTERNAL_SYNC_HTTP_BACKGROUND_MS, 5_000), EXTERNAL_SYNC_MAX_RUN_MS);
  const deadline = Date.now() + maxDurationMs - EXTERNAL_SYNC_SAFETY_MS;
  let started = 0;
  let completed = 0;
  let failed = 0;
  let imported = 0;
  let skipped = 0;
  let checked = 0;
  let hasMore = false;

  while (Date.now() < deadline) {
    const job = await nextRunnableExternalSyncJob(env, options.accountId);
    if (!job) break;

    const account = await getExternalAccountById(env, job.account_id);
    if (!account) {
      await failExternalSyncJob(env, job.account_id, "External account no longer exists");
      failed += 1;
      continue;
    }

    started += 1;
    const result = await runExternalSyncJob(env, account, job, Math.max(5_000, deadline - Date.now()));
    imported += result.imported;
    skipped += result.skipped;
    checked += result.checked;
    if (result.complete) {
      completed += 1;
    } else if (result.failed) {
      failed += 1;
    } else {
      hasMore = true;
    }

    if (options.accountId && (result.complete || result.failed || Date.now() >= deadline)) break;
  }

  const jobs = await listExternalSyncJobs(env);
  return { ok: true, started, completed, failed, imported, skipped, checked, hasMore, jobs };
}

async function syncExternalAccountBatch(
  env: RuntimeEnv,
  account: ExternalAccountRow,
  options: SyncOptions = {}
): Promise<ExternalSyncBatchResult> {
  await ensureDatabaseSchema(env);
  if (account.inbound_enabled !== 1) {
    throw new ApiError(400, "external_inbound_disabled", "Inbound sync is disabled for this external account");
  }
  if (account.auth_type !== "app_password") {
    throw new ApiError(400, "external_auth_unsupported", "Only app-password IMAP sync is supported right now");
  }
  if (!account.imap_host || !account.imap_port) {
    throw new ApiError(400, "external_imap_missing", "IMAP host and port are required before syncing old emails");
  }

  const password = externalCredential(env, account);
  const startedAt = Date.now();
  const maxDurationMs = Math.min(Math.max(options.maxDurationMs ?? SYNC_TIME_BUDGET_MS, 1_000), EXTERNAL_SYNC_MAX_RUN_MS);
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_SYNC_LIMIT, 1), MAX_SYNC_LIMIT);
  let folders = options.cursor?.folders.length ? options.cursor.folders : externalSyncFolders(account.provider);
  let folderIndex = Math.max(0, options.cursor?.folderIndex ?? 0);
  let nextUidExclusive = options.cursor?.nextUidExclusive ?? null;
  let imported = 0;
  let skipped = 0;
  let checked = 0;
  let hasMore = false;
  let timedOut = false;
  const reportProgress = async (force = false): Promise<void> => {
    await options.onProgress?.({
      imported,
      skipped,
      checked,
      folders,
      folderIndex,
      nextUidExclusive,
      hasMore,
      force
    });
  };

  const imap = await ImapClient.open({
    host: account.imap_host,
    port: account.imap_port,
    security: account.imap_security
  });

  try {
    await imap.login(account.username || account.email, password);
    if (!options.cursor?.folders.length) {
      folders = externalSyncFolders(account.provider, await imap.listFolders());
    }
    await reportProgress(true);

    for (; folderIndex < folders.length; folderIndex += 1) {
      const folder = folders[folderIndex];
      const selected = await imap.examine(folder);
      if (!selected) {
        nextUidExclusive = null;
        await reportProgress();
        continue;
      }

      const uids = await imap.searchAll();
      const newestFirst = [...uids]
        .sort((a, b) => b - a)
        .filter((uid) => nextUidExclusive === null || uid < nextUidExclusive);
      const folderRole = externalFolderRole(folder);

      for (const uid of newestFirst) {
        if (imported + skipped >= limit || Date.now() - startedAt > maxDurationMs) {
          hasMore = true;
          timedOut = Date.now() - startedAt > maxDurationMs;
          break;
        }

        const raw = await imap.fetchRaw(uid);
        checked += 1;
        nextUidExclusive = uid;
        if (!raw) {
          skipped += 1;
          await reportProgress();
          continue;
        }

        const stored = await storeExternalRawMessage(env, account, raw, {
          folder,
          role: folderRole,
          uid
        });
        if (stored) {
          imported += 1;
        } else {
          skipped += 1;
        }
        await reportProgress();
      }

      if (hasMore) break;
      nextUidExclusive = null;
      await reportProgress();
    }
  } finally {
    await imap.logout();
  }

  const complete = !hasMore && folderIndex >= folders.length;

  return {
    imported,
    skipped,
    checked,
    folders,
    hasMore,
    complete,
    timedOut,
    cursor: {
      folders,
      folderIndex,
      nextUidExclusive
    }
  };
}

async function nextRunnableExternalSyncJob(env: RuntimeEnv, accountId?: string): Promise<ExternalSyncJobRow | null> {
  const now = nowIso();
  const baseWhere = `status = 'queued' OR (status = 'running' AND (lease_until IS NULL OR lease_until < ?))`;
  if (accountId) {
    return (
      (await env.DB.prepare(
        `SELECT * FROM external_sync_jobs
         WHERE account_id = ? AND (${baseWhere})
         ORDER BY updated_at ASC
         LIMIT 1`
      )
        .bind(accountId, now)
        .first<ExternalSyncJobRow>()) ?? null
    );
  }

  return (
    (await env.DB.prepare(
      `SELECT * FROM external_sync_jobs
       WHERE ${baseWhere}
       ORDER BY updated_at ASC
       LIMIT 1`
    )
      .bind(now)
      .first<ExternalSyncJobRow>()) ?? null
  );
}

async function runExternalSyncJob(
  env: RuntimeEnv,
  account: ExternalAccountRow,
  job: ExternalSyncJobRow,
  maxDurationMs: number
): Promise<ExternalSyncBatchResult & { failed: boolean }> {
  const leaseUntil = new Date(Date.now() + Math.min(maxDurationMs + EXTERNAL_SYNC_SAFETY_MS, EXTERNAL_SYNC_MAX_RUN_MS)).toISOString();
  await env.DB.prepare(
    `UPDATE external_sync_jobs
     SET status = 'running',
         lease_until = ?,
         run_count = run_count + 1,
         message = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE account_id = ?`
  )
    .bind(leaseUntil, `Pulling ${account.email}`, job.account_id)
    .run();

  try {
    const latest = (await getExternalSyncJob(env, job.account_id)) ?? job;
    let lastHeartbeatAt = 0;
    const saveProgress = async (progress: ExternalSyncProgress): Promise<void> => {
      if (!progress.force && Date.now() - lastHeartbeatAt < EXTERNAL_SYNC_HEARTBEAT_MS) return;
      lastHeartbeatAt = Date.now();
      await env.DB.prepare(
        `UPDATE external_sync_jobs
         SET folders_json = ?,
             folder_index = ?,
             next_uid_exclusive = ?,
             imported = ?,
             skipped = ?,
             checked = ?,
             has_more = ?,
             message = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE account_id = ? AND status = 'running'`
      )
        .bind(
          JSON.stringify(progress.folders),
          progress.folderIndex,
          progress.nextUidExclusive,
          latest.imported + progress.imported,
          latest.skipped + progress.skipped,
          latest.checked + progress.checked,
          progress.hasMore ? 1 : 0,
          `Pulling ${account.email}: ${progress.imported} new, ${progress.skipped} already saved, ${progress.checked} checked`,
          account.id
        )
        .run();
    };

    const result = await syncExternalAccountBatch(env, account, {
      limit: MAX_SYNC_LIMIT,
      maxDurationMs,
      cursor: cursorFromJob(latest),
      onProgress: saveProgress
    });
    await markExternalAccountChecked(env, account.id, "configured");

    const nextStatus: ExternalSyncJobStatus = result.complete ? "complete" : "queued";
    const nextImported = latest.imported + result.imported;
    const nextSkipped = latest.skipped + result.skipped;
    const message = result.complete
      ? `Done: ${nextImported} new, ${nextSkipped} already saved`
      : result.timedOut
        ? "15 minute sync window reached. Run Sync again to continue remaining mail."
        : `Still pulling: ${nextImported} new, ${nextSkipped} already saved`;

    await env.DB.prepare(
      `UPDATE external_sync_jobs
       SET status = ?,
           folders_json = ?,
           folder_index = ?,
           next_uid_exclusive = ?,
           imported = ?,
           skipped = ?,
           checked = ?,
           has_more = ?,
           message = ?,
           last_error = NULL,
           lease_until = NULL,
           updated_at = CURRENT_TIMESTAMP,
           completed_at = CASE WHEN ? = 'complete' THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE account_id = ?`
    )
      .bind(
        nextStatus,
        JSON.stringify(result.cursor.folders),
        result.cursor.folderIndex,
        result.cursor.nextUidExclusive,
        nextImported,
        nextSkipped,
        latest.checked + result.checked,
        result.hasMore ? 1 : 0,
        message,
        nextStatus,
        account.id
      )
      .run();

    await recordAudit(env, "external_account.sync_batch", account.id, {
      email: account.email,
      imported: result.imported,
      skipped: result.skipped,
      checked: result.checked,
      complete: result.complete,
      timedOut: result.timedOut
    });

    return { ...result, failed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "External sync failed";
    await failExternalSyncJob(env, account.id, message);
    await recordAudit(env, "external_account.sync_failed", account.id, { email: account.email, message });
    return {
      imported: 0,
      skipped: 0,
      checked: 0,
      folders: cursorFromJob(job).folders,
      hasMore: false,
      complete: false,
      timedOut: false,
      failed: true,
      cursor: cursorFromJob(job)
    };
  }
}

async function failExternalSyncJob(env: RuntimeEnv, accountId: string, message: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE external_sync_jobs
     SET status = 'failed',
         has_more = 0,
         message = ?,
         last_error = ?,
         lease_until = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE account_id = ?`
  )
    .bind(message, message, accountId)
    .run();
}

function cursorFromJob(job: ExternalSyncJobRow): ExternalSyncCursor {
  return {
    folders: parseFolders(job.folders_json),
    folderIndex: Math.max(0, job.folder_index || 0),
    nextUidExclusive: job.next_uid_exclusive ?? null
  };
}

function parseFolders(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  } catch {
    return [];
  }
}

async function storeExternalRawMessage(
  env: RuntimeEnv,
  account: ExternalAccountRow,
  raw: Uint8Array,
  source: { folder: string; role: ExternalFolderRole; uid: number }
): Promise<boolean> {
  const parsed = await PostalMime.parse(raw);
  const mailbox = normalizeEmail(account.email);
  const messageId = parsed.messageId || `external:${account.id}:${await sha256Hex(raw)}`;
  if (await messageExistsByMessageId(env, messageId)) {
    return false;
  }

  const subject = parsed.subject ?? "";
  const textBody = parsed.text ?? null;
  const htmlBody = parsed.html ?? null;
  const junk = classifyJunkMail({
    parsedHeaders: parsed.headers,
    subject,
    text: textBody,
    html: htmlBody
  });
  const role: ExternalFolderRole = source.role === "inbox" && junk.junk ? "junk" : source.role;
  const sender = parsed.from && isRecord(parsed.from) ? (parsed.from as ParsedAddress) : null;
  const fromAddress = safeNormalizeEmail(sender?.address, mailbox);
  const to = addressListFromParsed(parsed.to, mailbox);
  const cc = addressListFromParsed(parsed.cc, "");
  const date = parseEmailDate(parsed.date);
  const threadId =
    (await findThreadForHeaders(env, {
      inReplyTo: parsed.inReplyTo ?? null,
      references: parsed.references ?? null,
      subject,
      mailbox
    })) ?? createId("thr");

  const rawR2Key = buildObjectKey("raw", mailbox, "external.eml");
  await env.MAIL_BUCKET.put(rawR2Key, raw, {
    httpMetadata: {
      contentType: "message/rfc822"
    },
    customMetadata: {
      mailbox,
      from: fromAddress,
      subject: subject.slice(0, 256),
      source: "external-imap"
    }
  });

  const stored = await insertMessage(env, {
    threadId,
    direction: role === "sent" ? "outbound" : "inbound",
    mailbox,
    domain: domainFromEmail(mailbox),
    fromAddress,
    fromName: sender?.name ?? null,
    to,
    cc,
    subject,
    snippet: makeSnippet(textBody ?? htmlToText(htmlBody ?? "")),
    textBody,
    htmlBody,
    messageId,
    inReplyTo: parsed.inReplyTo ?? null,
    referencesHeader: parsed.references ?? null,
    rawR2Key,
    sentStatus: role === "sent" ? "sent" : null,
    readAt: role === "sent" ? nowIso() : null,
    deletedAt: role === "trash" ? nowIso() : null,
    junkAt: role === "junk" ? nowIso() : null,
    externalAccountId: account.id,
    externalFolder: source.folder,
    externalUid: source.uid,
    receivedAt: date,
    createdAt: date
  });

  for (const attachment of parsed.attachments ?? []) {
    const filename = attachment.filename || "attachment";
    const contentType = attachment.mimeType || "application/octet-stream";
    const r2Key = buildObjectKey("attachments", mailbox, filename);
    const content = attachment.content;
    const size = attachmentSize(content);

    await env.MAIL_BUCKET.put(r2Key, content, {
      httpMetadata: {
        contentType
      },
      customMetadata: {
        messageId: stored.id,
        filename,
        source: "external-imap"
      }
    });

    await insertAttachment(env, {
      messageId: stored.id,
      filename,
      contentType,
      size,
      r2Key,
      disposition: attachment.disposition ?? null,
      contentId: attachment.contentId ?? null
    });
  }

  return true;
}

export async function deleteThreadFromExternalMailboxes(
  env: RuntimeEnv,
  threadId: string
): Promise<ExternalThreadDeleteResult> {
  await ensureDatabaseSchema(env);
  const result = await env.DB.prepare(
    `SELECT
       m.id,
       m.message_id,
       m.external_account_id,
       m.external_folder,
       m.external_uid,
       a.id AS account_id,
       a.provider,
       a.email,
       a.display_name,
       a.username,
       a.auth_type,
       a.credential_secret_name,
       a.imap_host,
       a.imap_port,
       a.imap_security,
       a.smtp_host,
       a.smtp_port,
       a.smtp_security,
       a.inbound_enabled,
       a.outbound_enabled,
       a.status,
       a.last_checked_at,
       a.notes,
       a.created_at,
       a.updated_at
     FROM messages m
     INNER JOIN external_accounts a
       ON (
         (m.external_account_id IS NOT NULL AND a.id = m.external_account_id)
         OR (m.external_account_id IS NULL AND a.email = m.mailbox)
       )
     WHERE m.thread_id = ?
       AND m.external_deleted_at IS NULL
       AND lower(a.provider) = 'gmail'`
  )
    .bind(threadId)
    .all<ExternalDeleteRow>();

  const rows = result.results ?? [];
  const summary: ExternalThreadDeleteResult = {
    attempted: rows.length,
    deleted: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };
  if (rows.length === 0) return summary;

  const byAccount = new Map<string, ExternalDeleteRow[]>();
  for (const row of rows) {
    byAccount.set(row.account_id, [...(byAccount.get(row.account_id) ?? []), row]);
  }

  const deletedLocalIds: string[] = [];
  for (const accountRows of byAccount.values()) {
    const account = accountFromDeleteRow(accountRows[0]);
    if (!account.imap_host || !account.imap_port || account.auth_type !== "app_password") {
      summary.failed += accountRows.length;
      summary.errors.push(`${account.email}: Gmail IMAP credentials are not configured`);
      continue;
    }

    let imap: ImapClient | null = null;
    try {
      imap = await ImapClient.open({
        host: account.imap_host,
        port: account.imap_port,
        security: account.imap_security
      });
      await imap.login(account.username || account.email, externalCredential(env, account));
      const discovered = await imap.listFolders();
      const trashFolder = externalTrashFolder(account.provider, discovered);

      for (const row of accountRows) {
        try {
          const deleted = await deleteExternalMessage(imap, account, row, discovered, trashFolder);
          if (deleted) {
            summary.deleted += 1;
            deletedLocalIds.push(row.id);
          } else {
            summary.skipped += 1;
          }
        } catch (error) {
          summary.failed += 1;
          summary.errors.push(`${account.email}: ${error instanceof Error ? error.message : "Gmail message delete failed"}`);
        }
      }
    } catch (error) {
      summary.failed += accountRows.length;
      summary.errors.push(`${account.email}: ${error instanceof Error ? error.message : "Gmail delete failed"}`);
    } finally {
      await imap?.logout().catch(() => undefined);
    }
  }

  await markExternalMessagesDeleted(env, deletedLocalIds);
  return summary;
}

async function deleteExternalMessage(
  imap: ImapClient,
  account: ExternalAccountRow,
  row: ExternalDeleteRow,
  discovered: ImapFolder[],
  trashFolder: string
): Promise<boolean> {
  const folders = uniqueStrings(
    [
      row.external_folder,
      ...externalSyncFolders(account.provider, discovered),
      trashFolder
    ].filter(Boolean) as string[]
  );

  for (const folder of folders) {
    const selected = await imap.select(folder);
    if (!selected) continue;

    const uidMatches =
      row.external_uid && row.external_folder && row.external_folder.toLowerCase() === folder.toLowerCase()
        ? [row.external_uid]
        : [];
    const headerMatches = row.message_id ? await imap.searchHeader("Message-ID", row.message_id).catch(() => []) : [];
    const uids = uniqueNumbers([...uidMatches, ...headerMatches]);
    if (uids.length === 0) continue;

    for (const uid of uids) {
      await moveOrDeleteUid(imap, uid, folder, trashFolder);
    }
    return true;
  }

  return false;
}

async function moveOrDeleteUid(imap: ImapClient, uid: number, sourceFolder: string, trashFolder: string): Promise<void> {
  if (sourceFolder.toLowerCase() !== trashFolder.toLowerCase()) {
    try {
      await imap.moveUidToFolder(uid, trashFolder);
      return;
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "imap_command_failed") {
        throw error;
      }
    }
  }

  await imap.markUidDeleted(uid);
  await imap.expunge();
}

function accountFromDeleteRow(row: ExternalDeleteRow): ExternalAccountRow {
  return {
    id: row.account_id,
    provider: row.provider,
    email: row.email,
    display_name: row.display_name,
    username: row.username,
    auth_type: row.auth_type,
    credential_secret_name: row.credential_secret_name,
    imap_host: row.imap_host,
    imap_port: row.imap_port,
    imap_security: row.imap_security,
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    smtp_security: row.smtp_security,
    inbound_enabled: row.inbound_enabled,
    outbound_enabled: row.outbound_enabled,
    status: row.status,
    last_checked_at: row.last_checked_at,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

class ImapClient {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = new Uint8Array(0);
  private tagCounter = 1;
  private closed = false;

  private constructor(private socket: Socket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  static async open(input: { host: string; port: number; security: string }): Promise<ImapClient> {
    const secureTransport = input.security === "ssl" ? "on" : input.security === "starttls" ? "starttls" : "off";
    const socket = connect(
      { hostname: input.host, port: input.port },
      { secureTransport, allowHalfOpen: false }
    );
    await withImapTimeout(socket.opened, IMAP_CONNECT_TIMEOUT_MS, "IMAP connection", () => socket.close().catch(() => undefined));
    let client = new ImapClient(socket);
    await client.readGreeting();

    if (input.security === "starttls") {
      await client.command("STARTTLS");
      const tlsSocket = socket.startTls({ expectedServerHostname: input.host });
      await withImapTimeout(tlsSocket.opened, IMAP_CONNECT_TIMEOUT_MS, "IMAP TLS handshake", () =>
        tlsSocket.close().catch(() => undefined)
      );
      client.releaseLocks();
      client = new ImapClient(tlsSocket);
    }

    return client;
  }

  async login(username: string, password: string): Promise<void> {
    await this.command(`LOGIN ${quoteImapString(username)} ${quoteImapString(password)}`);
  }

  async examine(folder: string): Promise<boolean> {
    try {
      await this.command(`EXAMINE ${quoteImapString(folder)}`);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === "imap_command_failed") {
        return false;
      }
      throw error;
    }
  }

  async select(folder: string): Promise<boolean> {
    try {
      await this.command(`SELECT ${quoteImapString(folder)}`);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === "imap_command_failed") {
        return false;
      }
      throw error;
    }
  }

  async searchAll(): Promise<number[]> {
    const response = await this.command("UID SEARCH ALL");
    const line = response.text.split(/\r\n/).find((item) => item.toUpperCase().startsWith("* SEARCH "));
    if (!line) return [];
    return line
      .slice("* SEARCH ".length)
      .trim()
      .split(/\s+/)
      .map((item) => Number.parseInt(item, 10))
      .filter((uid) => Number.isInteger(uid) && uid > 0);
  }

  async searchHeader(header: string, value: string): Promise<number[]> {
    const response = await this.command(`UID SEARCH HEADER ${quoteImapAtom(header)} ${quoteImapString(value)}`);
    return parseSearchUids(response.text);
  }

  async listFolders(): Promise<ImapFolder[]> {
    const response = await this.command('LIST "" "*"', IMAP_COMMAND_TIMEOUT_MS, "IMAP folder list");
    return response.text
      .split(/\r\n/)
      .map(parseListLine)
      .filter((folder): folder is ImapFolder => Boolean(folder));
  }

  async fetchRaw(uid: number): Promise<Uint8Array | null> {
    const response = await this.command(`UID FETCH ${uid} (BODY.PEEK[])`, IMAP_FETCH_TIMEOUT_MS, "IMAP message fetch");
    return response.literals.sort((a, b) => b.byteLength - a.byteLength)[0] ?? null;
  }

  async moveUidToFolder(uid: number, folder: string): Promise<void> {
    await this.command(`UID MOVE ${uid} ${quoteImapString(folder)}`, IMAP_COMMAND_TIMEOUT_MS, "IMAP message move");
  }

  async markUidDeleted(uid: number): Promise<void> {
    await this.command(`UID STORE ${uid} +FLAGS.SILENT (\\Deleted)`, IMAP_COMMAND_TIMEOUT_MS, "IMAP message delete");
  }

  async expunge(): Promise<void> {
    await this.command("EXPUNGE", IMAP_COMMAND_TIMEOUT_MS, "IMAP expunge");
  }

  async logout(): Promise<void> {
    if (this.closed) return;
    try {
      await this.command("LOGOUT", IMAP_LOGOUT_TIMEOUT_MS, "IMAP logout");
    } catch {
      // The server may close after LOGOUT; close below is enough.
    }
    this.releaseLocks();
    await this.socket.close().catch(() => undefined);
    this.closed = true;
  }

  private async readGreeting(): Promise<void> {
    const line = await this.readLine(IMAP_COMMAND_TIMEOUT_MS, "IMAP greeting");
    if (!line.toUpperCase().startsWith("* OK")) {
      throw new ApiError(502, "imap_greeting_failed", "IMAP server did not return an OK greeting");
    }
  }

  private async command(
    command: string,
    timeoutMs = IMAP_COMMAND_TIMEOUT_MS,
    label = describeImapCommand(command)
  ): Promise<{ text: string; literals: Uint8Array[] }> {
    const tag = `A${String(this.tagCounter++).padStart(4, "0")}`;
    await this.withTimeout(this.writer.write(new TextEncoder().encode(`${tag} ${command}\r\n`)), timeoutMs, label);
    const response = await this.readTagged(tag, timeoutMs, label);
    const statusLine = response.text.split(/\r\n/).find((line) => line.startsWith(`${tag} `)) ?? "";
    if (!new RegExp(`^${tag} OK\\b`, "i").test(statusLine)) {
      throw new ApiError(502, "imap_command_failed", sanitizeImapStatus(statusLine || "IMAP command failed"));
    }
    return response;
  }

  private async readTagged(tag: string, timeoutMs: number, label: string): Promise<{ text: string; literals: Uint8Array[] }> {
    const literals: Uint8Array[] = [];
    let text = "";

    for (;;) {
      const line = await this.readLine(timeoutMs, label);
      text += `${line}\r\n`;

      const literalMatch = line.match(/\{(\d+)\}$/);
      if (literalMatch) {
        const literal = await this.readBytes(Number.parseInt(literalMatch[1], 10), timeoutMs, label);
        literals.push(literal);
        text += `{literal:${literal.byteLength}}\r\n`;
      }

      if (line.startsWith(`${tag} `)) {
        return { text, literals };
      }
    }
  }

  private async readLine(timeoutMs: number, label: string): Promise<string> {
    for (;;) {
      const index = indexOfCrlf(this.buffer);
      if (index >= 0) {
        const lineBytes = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        return new TextDecoder().decode(lineBytes);
      }
      await this.readMore(timeoutMs, label);
    }
  }

  private async readBytes(length: number, timeoutMs: number, label: string): Promise<Uint8Array> {
    while (this.buffer.byteLength < length) {
      await this.readMore(timeoutMs, label);
    }
    const bytes = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    return bytes;
  }

  private async readMore(timeoutMs: number, label: string): Promise<void> {
    const chunk = await this.withTimeout(this.reader.read(), timeoutMs, label);
    if (chunk.done || !chunk.value) {
      throw new ApiError(502, "imap_connection_closed", "IMAP connection closed unexpectedly");
    }
    const merged = new Uint8Array(this.buffer.byteLength + chunk.value.byteLength);
    merged.set(this.buffer, 0);
    merged.set(chunk.value, this.buffer.byteLength);
    this.buffer = merged;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return withImapTimeout(promise, timeoutMs, label, () => this.forceClose());
  }

  private async forceClose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([
      this.reader.cancel().catch(() => undefined),
      this.writer.abort().catch(() => undefined),
      this.socket.close().catch(() => undefined)
    ]);
    this.releaseLocks();
  }

  private releaseLocks(): void {
    try {
      this.reader.releaseLock();
    } catch {
      // Already released or canceled.
    }
    try {
      this.writer.releaseLock();
    } catch {
      // Already released or canceled.
    }
  }
}

async function withImapTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: () => void | Promise<void>
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      void onTimeout?.();
      reject(new ApiError(504, "imap_timeout", `${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function describeImapCommand(command: string): string {
  const upper = command.trim().toUpperCase();
  if (upper.startsWith("LOGIN")) return "IMAP login";
  if (upper.startsWith("EXAMINE")) return "IMAP folder open";
  if (upper.startsWith("SELECT")) return "IMAP folder select";
  if (upper.startsWith("UID SEARCH")) return "IMAP search";
  if (upper.startsWith("UID FETCH")) return "IMAP message fetch";
  if (upper.startsWith("UID MOVE")) return "IMAP message move";
  if (upper.startsWith("UID STORE")) return "IMAP message delete";
  if (upper.startsWith("EXPUNGE")) return "IMAP expunge";
  return "IMAP command";
}

function externalCredential(env: RuntimeEnv, account: ExternalAccountRow): string {
  const secretName = (account.credential_secret_name || account.email).trim();
  const value = (env as unknown as Record<string, unknown>)[secretName];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(409, "external_secret_missing", `Add a Worker secret named ${secretName} with this account's app password.`);
  }
  return value.trim();
}

function externalSyncFolders(provider: string, discovered: ImapFolder[] = []): string[] {
  const sent = discovered.find((folder) => folder.attributes.some((attribute) => attribute.toLowerCase() === "\\sent"))?.name;
  const junk = externalJunkFolder(provider, discovered);
  const fallback =
    provider === "gmail"
      ? "[Gmail]/Sent Mail"
      : provider === "outlook"
        ? "Sent Items"
        : provider === "icloud"
          ? "Sent Messages"
          : "Sent";
  const junkFallback = provider === "gmail" ? "[Gmail]/Spam" : "Junk";
  return uniqueStrings(["INBOX", sent, fallback, junk, junkFallback, "Spam"].filter(Boolean) as string[]);
}

function externalFolderRole(folder: string): ExternalFolderRole {
  const normalized = folder.toLowerCase();
  if (/sent/.test(normalized)) return "sent";
  if (/spam|junk|bulk/.test(normalized)) return "junk";
  if (/trash|deleted|bin/.test(normalized)) return "trash";
  return "inbox";
}

function externalTrashFolder(provider: string, discovered: ImapFolder[] = []): string {
  const trash = discovered.find((folder) => folder.attributes.some((attribute) => attribute.toLowerCase() === "\\trash"))?.name;
  if (trash) return trash;
  if (provider === "gmail") return "[Gmail]/Trash";
  if (provider === "outlook") return "Deleted Items";
  return "Trash";
}

function externalJunkFolder(provider: string, discovered: ImapFolder[] = []): string | null {
  const junk = discovered.find((folder) => folder.attributes.some((attribute) => attribute.toLowerCase() === "\\junk"))?.name;
  if (junk) return junk;
  const named = discovered.find((folder) => /(^|[/\\])(spam|junk|bulk)$/i.test(folder.name));
  if (named) return named.name;
  return provider === "gmail" ? "[Gmail]/Spam" : null;
}

function quoteImapString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ")}"`;
}

function quoteImapAtom(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : quoteImapString(value);
}

function parseSearchUids(text: string): number[] {
  const line = text.split(/\r\n/).find((item) => item.toUpperCase().startsWith("* SEARCH "));
  if (!line) return [];
  return line
    .slice("* SEARCH ".length)
    .trim()
    .split(/\s+/)
    .map((item) => Number.parseInt(item, 10))
    .filter((uid) => Number.isInteger(uid) && uid > 0);
}

function sanitizeImapStatus(value: string): string {
  return value.replace(/^A\d+\s+/i, "").slice(0, 220) || "IMAP command failed";
}

function parseListLine(line: string): ImapFolder | null {
  if (!line.toUpperCase().startsWith("* LIST ")) return null;
  const attributes = line.match(/\(([^)]*)\)/)?.[1].split(/\s+/).filter(Boolean) ?? [];
  const name = lastQuotedString(line) ?? line.split(/\s+/).at(-1)?.trim();
  if (!name || name === "NIL") return null;
  return { name, attributes };
}

function lastQuotedString(line: string): string | null {
  let end = -1;
  for (let index = line.length - 1; index >= 0; index -= 1) {
    if (line[index] === '"' && line[index - 1] !== "\\") {
      end = index;
      break;
    }
  }
  if (end < 0) return null;

  let start = -1;
  for (let index = end - 1; index >= 0; index -= 1) {
    if (line[index] === '"' && line[index - 1] !== "\\") {
      start = index;
      break;
    }
  }
  if (start < 0) return null;

  return line.slice(start + 1, end).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueNumbers(values: number[]): number[] {
  const seen = new Set<number>();
  return values.filter((value) => {
    if (!Number.isInteger(value) || value <= 0 || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function indexOfCrlf(bytes: Uint8Array): number {
  for (let index = 0; index < bytes.byteLength - 1; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) return index;
  }
  return -1;
}

function addressListFromParsed(value: unknown, fallback: string): string[] {
  const fallbackAddress = fallback ? normalizeEmail(fallback) : null;
  if (Array.isArray(value)) {
    const addresses = value
      .flatMap((entry) => {
        if (isRecord(entry) && typeof entry.address === "string") {
          return [entry.address];
        }
        if (isRecord(entry) && Array.isArray(entry.group)) {
          return entry.group.flatMap((member) => (isRecord(member) && typeof member.address === "string" ? [member.address] : []));
        }
        if (typeof entry === "string") {
          return [entry];
        }
        return [];
      })
      .filter(Boolean)
      .map((address) => safeNormalizeEmail(address, ""))
      .filter(Boolean);
    return addresses.length > 0 ? addresses : fallbackAddress ? [fallbackAddress] : [];
  }

  if (fallbackAddress) {
    return [fallbackAddress];
  }

  return [];
}

function safeNormalizeEmail(value: string | null | undefined, fallback: string): string {
  if (value) {
    try {
      return normalizeEmail(value);
    } catch {
      // Old mailboxes can contain malformed display addresses; keep the sync moving.
    }
  }
  return fallback ? normalizeEmail(fallback) : "";
}

function attachmentSize(content: string | ArrayBuffer | Uint8Array): number {
  if (typeof content === "string") return new TextEncoder().encode(content).byteLength;
  return content.byteLength;
}

function buildObjectKey(kind: "raw" | "attachments", mailbox: string, filename: string): string {
  const safeMailbox = mailbox.replace(/[^a-z0-9@._-]/gi, "_");
  const safeFilename = filename.replace(/[^a-z0-9._-]/gi, "_").slice(0, 128);
  const date = new Date().toISOString().slice(0, 10);
  return `${kind}/${date}/${safeMailbox}/${crypto.randomUUID()}-${safeFilename}`;
}

function makeSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function parseEmailDate(value: string | undefined): string {
  if (!value) return nowIso();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : nowIso();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
