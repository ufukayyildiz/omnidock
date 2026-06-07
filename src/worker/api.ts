import {
  confirmAdminPasswordReset,
  createAdminAccount,
  getSetupStatus,
  requestAdminPasswordReset,
  requireAdmin,
  setAdminPassword
} from "./auth";
import { configuredAdminPassword, configuredPrimaryDomain, runtimeRequirements } from "./configuration";
import {
  createMailboxAndRoutingRule,
  enableCatchAllForDomain,
  enableRoutingForMailbox,
  syncCloudflareInventory
} from "./cloudflare";
import {
  archiveThread,
  deleteContact,
  deleteExternalAccount,
  deleteThread,
  getAttachmentById,
  getMailboxStats,
  getStats,
  getThread,
  ensureMailbox,
  importContacts,
  insertMessage,
  listContacts,
  listDomains,
  listExternalAccounts,
  listThreadStorageKeys,
  listMailboxSignatures,
  listMailboxes,
  listThreads,
  markThreadRead,
  normalizeDomain,
  recordAudit,
  setDefaultDomain,
  upsertContact,
  upsertExternalAccount,
  upsertMailboxSignature,
  upsertDomain
} from "./db";
import { sendEmail } from "./email";
import {
  ApiError,
  RuntimeEnv,
  errorResponse,
  json,
  methodNotAllowed,
  noContent,
  isRecord,
  optionalBoolean,
  optionalString,
  readJson,
  requiredString,
  stringList
} from "./http";

export async function handleApi(
  request: Request,
  env: RuntimeEnv,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return noContent();
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, host: env.MANAGEMENT_HOST || url.host });
    }

    if (url.pathname === "/api/setup/status") {
      if (request.method !== "GET") return methodNotAllowed();
      const setup = await getSetupStatus(env);
      const requirements = runtimeRequirements(env, setup.setupRequired);
      return json({
        ok: true,
        ...setup,
        configurationReady: requirements.every((item) => item.configured || !item.required),
        requirements,
        primaryDomain: configuredPrimaryDomain(env),
        passwordFromSecret: Boolean(configuredAdminPassword(env))
      });
    }

    if (url.pathname === "/api/setup") {
      if (request.method !== "POST") return methodNotAllowed();
      const body = await readJson(request);
      const setup = await getSetupStatus(env);
      if (!setup.setupRequired) {
        throw new ApiError(409, "setup_complete", "Admin account is already configured");
      }
      const requirements = runtimeRequirements(env, setup.setupRequired);
      const missingRequired = requirements.filter((item) => item.required && !item.configured);
      if (missingRequired.length > 0) {
        throw new ApiError(
          409,
          "configuration_required",
          `Complete Cloudflare setup first: ${missingRequired.map((item) => item.name).join(", ")}`
        );
      }
      const primaryDomainInput =
        optionalString(body, "primaryDomain", { max: 253 }) ?? configuredPrimaryDomain(env);
      if (!primaryDomainInput) {
        throw new ApiError(409, "primary_domain_variable_missing", "Add PRIMARY_DOMAIN as a Worker variable first.");
      }
      const primaryDomain = normalizeDomain(primaryDomainInput);
      const recoveryEmail = requiredString(body, "recoveryEmail", { max: 320 });
      const domain = await upsertDomain(env, {
        domain: primaryDomain,
        source: "setup",
        status: "manual"
      });
      await setDefaultDomain(env, domain.id);
      await createAdminAccount(
        env,
        {
          name: requiredString(body, "name", { min: 2, max: 160 }),
          email: requiredString(body, "email", { max: 320 }),
          recoveryEmail,
          primaryDomain,
          password: optionalString(body, "password", { max: 256 })
        },
        request
      );
      ctx.waitUntil(recordAudit(env, "admin.created", "primary", { primaryDomain }));
      return json({ ok: true }, { status: 201 });
    }

    if (url.pathname === "/api/auth/reset/request") {
      if (request.method !== "POST") return methodNotAllowed();
      requireD1Binding(env);
      const body = await readJson(request);
      await requestAdminPasswordReset(env, requiredString(body, "email", { max: 320 }), publicOrigin(request, env));
      return json({ ok: true });
    }

    if (url.pathname === "/api/auth/reset/confirm") {
      if (request.method !== "POST") return methodNotAllowed();
      requireD1Binding(env);
      const body = await readJson(request);
      await confirmAdminPasswordReset(env, {
        token: requiredString(body, "token", { min: 24, max: 256 }),
        password: requiredString(body, "password", { min: 12, max: 256 })
      });
      ctx.waitUntil(recordAudit(env, "admin.password_reset", "primary", {}));
      return json({ ok: true });
    }

    requireD1Binding(env);
    await requireAdmin(request, env);

    if (url.pathname === "/api/bootstrap") {
      if (request.method !== "GET") return methodNotAllowed();
      const [domains, mailboxes, contacts, signatures, externalAccounts, stats, threads] = await Promise.all([
        listDomains(env),
        listMailboxes(env),
        listContacts(env),
        listMailboxSignatures(env),
        listExternalAccounts(env),
        getStats(env),
        listThreads(env, { folder: "inbox" })
      ]);
      return json({
        ok: true,
        managementHost: env.MANAGEMENT_HOST || url.host,
        domains,
        mailboxes,
        contacts,
        signatures,
        externalAccounts,
        buckets: listAvailableBuckets(env),
        stats,
        threads
      });
    }

    if (url.pathname === "/api/auth/password") {
      if (request.method !== "PUT") return methodNotAllowed();
      const body = await readJson(request);
      const password = requiredString(body, "password", { min: 12, max: 256 });
      await setAdminPassword(env, password);
      return json({ ok: true });
    }

    if (url.pathname === "/api/domains") {
      if (request.method !== "POST") return methodNotAllowed();
      const body = await readJson(request);
      const domain = normalizeDomain(requiredString(body, "domain", { max: 253 }));
      const zoneId = optionalString(body, "zoneId", { max: 128 });
      const created = await upsertDomain(env, {
        domain,
        zoneId,
        source: "manual",
        status: "manual"
      });
      ctx.waitUntil(recordAudit(env, "domain.added", created.id, { domain }));
      return json({ ok: true, domain: created }, { status: 201 });
    }

    if (url.pathname === "/api/sync/cloudflare") {
      if (request.method !== "POST") return methodNotAllowed();
      const result = await syncCloudflareInventory(env);
      return json({ ok: true, ...result });
    }

    const defaultDomainMatch = url.pathname.match(/^\/api\/domains\/([^/]+)\/default$/);
    if (defaultDomainMatch) {
      if (request.method !== "POST") return methodNotAllowed();
      const domain = await setDefaultDomain(env, defaultDomainMatch[1]);
      ctx.waitUntil(recordAudit(env, "domain.default_set", domain.id, { domain: domain.domain }));
      return json({ ok: true, domain });
    }

    const catchAllMatch = url.pathname.match(/^\/api\/domains\/([^/]+)\/catch-all$/);
    if (catchAllMatch) {
      if (request.method !== "POST") return methodNotAllowed();
      const result = await enableCatchAllForDomain(env, catchAllMatch[1]);
      return json({ ok: true, ...result });
    }

    if (url.pathname === "/api/contacts") {
      if (request.method === "GET") {
        return json({ ok: true, contacts: await listContacts(env) });
      }

      if (request.method === "POST") {
        const body = await readJson(request);
        const contact = await upsertContact(env, readContactInput(body, "manual"));
        ctx.waitUntil(recordAudit(env, "contact.saved", contact.id, { email: contact.email }));
        return json({ ok: true, contact }, { status: 201 });
      }

      return methodNotAllowed();
    }

    const contactMatch = url.pathname.match(/^\/api\/contacts\/(?!import$)([^/]+)$/);
    if (contactMatch) {
      if (request.method === "PUT") {
        const body = await readJson(request);
        const contact = await upsertContact(env, {
          ...readContactInput(body, "manual"),
          id: contactMatch[1]
        });
        ctx.waitUntil(recordAudit(env, "contact.saved", contact.id, { email: contact.email }));
        return json({ ok: true, contact });
      }

      if (request.method === "DELETE") {
        await deleteContact(env, contactMatch[1]);
        ctx.waitUntil(recordAudit(env, "contact.deleted", contactMatch[1], {}));
        return json({ ok: true });
      }

      return methodNotAllowed();
    }

    if (url.pathname === "/api/contacts/import") {
      if (request.method !== "POST") return methodNotAllowed();
      const body = await readJson(request);
      const source = optionalString(body, "source", { max: 32 }) ?? "upload";
      const contacts = readContactList(body);
      const report = await importContacts(env, contacts, source);
      ctx.waitUntil(recordAudit(env, "contacts.imported", null, { imported: report.imported, skipped: report.skipped, source }));
      return json({ ok: true, report }, { status: 201 });
    }

    if (url.pathname === "/api/external-accounts") {
      if (request.method === "GET") {
        return json({ ok: true, externalAccounts: await listExternalAccounts(env) });
      }

      if (request.method === "POST") {
        const body = await readJson(request);
        const account = await upsertExternalAccount(env, readExternalAccountInput(body));
        ctx.waitUntil(recordAudit(env, "external_account.saved", account.id, { email: account.email, provider: account.provider }));
        return json({ ok: true, account }, { status: 201 });
      }

      return methodNotAllowed();
    }

    const externalAccountMatch = url.pathname.match(/^\/api\/external-accounts\/([^/]+)$/);
    if (externalAccountMatch) {
      if (request.method === "PUT") {
        const body = await readJson(request);
        const account = await upsertExternalAccount(env, {
          ...readExternalAccountInput(body),
          id: externalAccountMatch[1]
        });
        ctx.waitUntil(recordAudit(env, "external_account.saved", account.id, { email: account.email, provider: account.provider }));
        return json({ ok: true, account });
      }

      if (request.method === "DELETE") {
        await deleteExternalAccount(env, externalAccountMatch[1]);
        ctx.waitUntil(recordAudit(env, "external_account.deleted", externalAccountMatch[1], {}));
        return json({ ok: true });
      }

      return methodNotAllowed();
    }

    if (url.pathname === "/api/mailboxes") {
      if (request.method !== "POST") return methodNotAllowed();
      const body = await readJson(request);
      const domainId = requiredString(body, "domainId", { max: 128 });
      const localPart = requiredString(body, "localPart", { max: 128 });
      const displayName = optionalString(body, "displayName", { max: 128 });
      const createRule = optionalBoolean(body, "createRule");
      const result = await createMailboxAndRoutingRule(env, {
        domainId,
        localPart,
        displayName,
        createRule
      });
      return json({ ok: true, ...result }, { status: 201 });
    }

    const mailboxRoutingMatch = url.pathname.match(/^\/api\/mailboxes\/([^/]+)\/routing-rule$/);
    if (mailboxRoutingMatch) {
      if (request.method !== "POST") return methodNotAllowed();
      const result = await enableRoutingForMailbox(env, mailboxRoutingMatch[1]);
      return json({ ok: true, ...result });
    }

    const mailboxSignatureMatch = url.pathname.match(/^\/api\/mailboxes\/([^/]+)\/signature$/);
    if (mailboxSignatureMatch) {
      if (request.method !== "PUT") return methodNotAllowed();
      const body = await readJson(request);
      const signature = await upsertMailboxSignature(env, {
        mailboxId: mailboxSignatureMatch[1],
        textSignature: textField(body, "textSignature", 20000),
        htmlSignature: optionalRawString(body, "htmlSignature", 40000),
        enabled: optionalEnabled(body)
      });
      ctx.waitUntil(recordAudit(env, "signature.saved", signature.mailbox_id, { enabled: signature.enabled === 1 }));
      return json({ ok: true, signature });
    }

    if (url.pathname === "/api/threads") {
      if (request.method !== "GET") return methodNotAllowed();
      const folder = url.searchParams.get("folder") ?? "inbox";
      const domainId = url.searchParams.get("domainId");
      const mailboxId = url.searchParams.get("mailboxId");
      const query = url.searchParams.get("q");
      const [threads, stats] = await Promise.all([
        listThreads(env, { folder, domainId, mailboxId, query }),
        getMailboxStats(env, mailboxId)
      ]);
      return json({ ok: true, threads, stats });
    }

    const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
    if (threadMatch) {
      const threadId = threadMatch[1];

      if (request.method === "GET") {
        const thread = await getThread(env, threadId);
        return json({ ok: true, ...thread });
      }

      if (request.method === "PATCH") {
        const body = await readJson(request);
        const action = requiredString(body, "action", { max: 32 });
        if (action === "read") {
          await markThreadRead(env, threadId);
        } else if (action === "archive") {
          await archiveThread(env, threadId, true);
        } else if (action === "unarchive") {
          await archiveThread(env, threadId, false);
        } else {
          throw new ApiError(400, "unknown_action", "Thread action is unknown");
        }
        return json({ ok: true });
      }

      if (request.method === "DELETE") {
        const r2Keys = await listThreadStorageKeys(env, threadId);
        const storageResults = await Promise.allSettled(r2Keys.map((key) => env.MAIL_BUCKET.delete(key)));
        const failedStorageDeletes = storageResults.filter((result) => result.status === "rejected");
        if (failedStorageDeletes.length > 0) {
          throw new ApiError(
            502,
            "storage_delete_failed",
            "Could not delete all stored message objects from R2. Try again."
          );
        }

        const deletedMessages = await deleteThread(env, threadId);
        if (deletedMessages === 0) {
          throw new ApiError(404, "thread_not_found", "Thread not found");
        }

        ctx.waitUntil(
          recordAudit(env, "thread.deleted", threadId, {
            deletedMessages,
            deletedObjects: r2Keys.length
          })
        );
        return json({ ok: true, deletedMessages, deletedObjects: r2Keys.length });
      }

      return methodNotAllowed();
    }

    const attachmentMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)$/);
    if (attachmentMatch) {
      if (request.method !== "GET") return methodNotAllowed();
      requireMailBucketBinding(env);
      const attachment = await getAttachmentById(env, attachmentMatch[1]);
      if (!attachment) {
        throw new ApiError(404, "attachment_not_found", "Attachment not found");
      }
      const object = await env.MAIL_BUCKET.get(attachment.r2_key);
      if (!object) {
        throw new ApiError(404, "attachment_missing", "Attachment object is missing in R2");
      }

      const headers = new Headers();
      headers.set("content-type", attachment.content_type);
      headers.set("content-disposition", `attachment; filename="${safeHeaderFilename(attachment.filename)}"`);
      headers.set("cache-control", "private, max-age=60");
      if (object.size) {
        headers.set("content-length", String(object.size));
      }
      return new Response(object.body, { headers });
    }

    if (url.pathname === "/api/buckets") {
      if (request.method !== "GET") return methodNotAllowed();
      return json({ ok: true, buckets: listAvailableBuckets(env) });
    }

    if (url.pathname === "/api/buckets/search") {
      if (request.method !== "GET") return methodNotAllowed();
      return json(await searchBucketObjects(env, url));
    }

    const bucketObjectsMatch = url.pathname.match(/^\/api\/buckets\/([^/]+)\/objects$/);
    if (bucketObjectsMatch) {
      if (request.method !== "GET") return methodNotAllowed();
      const bucket = getBucketBinding(env, bucketObjectsMatch[1]);
      const prefix = readR2Prefix(url);
      const cursor = url.searchParams.get("cursor")?.trim() || undefined;
      const result = await bucket.bucket.list({
        cursor,
        delimiter: "/",
        include: ["httpMetadata"],
        limit: 200,
        prefix
      });

      return json({
        ok: true,
        bucket: bucket.info,
        prefix,
        folders: result.delimitedPrefixes.map((folderPrefix) => ({
          key: folderPrefix,
          name: displayR2FolderName(folderPrefix, prefix)
        })),
        objects: result.objects.map(serializeR2Object).filter((object) => object.key !== prefix),
        cursor: result.truncated ? result.cursor : null,
        truncated: result.truncated
      });
    }

    const bucketObjectMatch = url.pathname.match(/^\/api\/buckets\/([^/]+)\/object$/);
    if (bucketObjectMatch) {
      const bucket = getBucketBinding(env, bucketObjectMatch[1]);
      const key = readR2Key(url);

      if (request.method === "GET") {
        const object = await bucket.bucket.get(key);
        if (!object) {
          throw new ApiError(404, "bucket_object_not_found", "R2 object not found");
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("content-type", headers.get("content-type") || "application/octet-stream");
        headers.set("content-disposition", `attachment; filename="${safeHeaderFilename(filenameFromR2Key(key))}"`);
        headers.set("cache-control", "private, max-age=60");
        headers.set("etag", object.httpEtag);
        if (object.size) {
          headers.set("content-length", String(object.size));
        }
        return new Response(object.body, { headers });
      }

      if (request.method === "PUT") {
        if (!request.body) {
          throw new ApiError(400, "empty_upload", "Upload body is empty");
        }
        const contentType = request.headers.get("content-type") || "application/octet-stream";
        const uploaded = await bucket.bucket.put(key, request.body, {
          httpMetadata: {
            contentDisposition: `attachment; filename="${safeHeaderFilename(filenameFromR2Key(key))}"`,
            contentType
          }
        });
        ctx.waitUntil(recordAudit(env, "bucket.object_uploaded", key, { bucket: bucket.info.id, size: uploaded.size }));
        return json({ ok: true, object: serializeR2Object(uploaded) }, { status: 201 });
      }

      if (request.method === "DELETE") {
        await bucket.bucket.delete(key);
        ctx.waitUntil(recordAudit(env, "bucket.object_deleted", key, { bucket: bucket.info.id }));
        return json({ ok: true });
      }

      return methodNotAllowed();
    }

    const replyMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/reply$/);
    if (replyMatch) {
      if (request.method !== "POST") return methodNotAllowed();
      requireMailSendBindings(env);
      const body = await readJson(request);
      const sent = await sendEmail(env, {
        from: requiredString(body, "from", { max: 320 }),
        fromName: optionalString(body, "fromName", { max: 128 }),
        to: stringList(body, "to"),
        cc: stringList(body, "cc"),
        bcc: stringList(body, "bcc"),
        subject: requiredString(body, "subject", { max: 998 }),
        text: optionalString(body, "text", { max: 200000 }),
        html: optionalString(body, "html", { max: 200000 }),
        attachments: attachmentList(body),
        replyToThreadId: replyMatch[1]
      });
      return json({ ok: true, message: sent }, { status: 201 });
    }

    if (url.pathname === "/api/send") {
      if (request.method !== "POST") return methodNotAllowed();
      requireMailSendBindings(env);
      const body = await readJson(request);
      const sent = await sendEmail(env, {
        from: requiredString(body, "from", { max: 320 }),
        fromName: optionalString(body, "fromName", { max: 128 }),
        to: stringList(body, "to"),
        cc: stringList(body, "cc"),
        bcc: stringList(body, "bcc"),
        subject: requiredString(body, "subject", { max: 998 }),
        text: optionalString(body, "text", { max: 200000 }),
        html: optionalString(body, "html", { max: 200000 }),
        attachments: attachmentList(body)
      });
      return json({ ok: true, message: sent }, { status: 201 });
    }

    if (url.pathname === "/api/dev/seed") {
      if (request.method !== "POST") return methodNotAllowed();
      const seeded = await seedDevelopmentData(env);
      return json({ ok: true, seeded });
    }

    return json(
      {
        ok: false,
        error: {
          code: "not_found",
          message: "Route not found"
        }
      },
      { status: 404 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function requireD1Binding(env: RuntimeEnv): void {
  if (!env.DB) {
    throw new ApiError(503, "database_binding_missing", "D1 binding DB is not configured for this Worker.");
  }
}

function requireMailBucketBinding(env: RuntimeEnv): void {
  if (!env.MAIL_BUCKET) {
    throw new ApiError(503, "mail_bucket_binding_missing", "R2 binding MAIL_BUCKET is not configured for this Worker.");
  }
}

function requireEmailBinding(env: RuntimeEnv): void {
  if (!env.EMAIL) {
    throw new ApiError(503, "email_binding_missing", "Email Sending binding EMAIL is not configured for this Worker.");
  }
}

function requireMailSendBindings(env: RuntimeEnv): void {
  requireMailBucketBinding(env);
  requireEmailBinding(env);
}

type BucketInfo = {
  id: string;
  name: string;
  binding: string;
  configured: boolean;
  writable: boolean;
  description: string;
};

type BucketBinding = {
  info: BucketInfo;
  bucket: R2Bucket;
};

const reservedBucketDiscoveryBindings = new Set(["ASSETS", "DB", "EMAIL"]);
const MAX_BUCKET_SEARCH_RESULTS = 100;
const MAX_BUCKET_SEARCH_SCAN = 1200;
const MAX_BUCKET_TEXT_SEARCH_FILES = 80;
const MAX_BUCKET_TEXT_SEARCH_BYTES = 2 * 1024 * 1024;

function listAvailableBuckets(env: RuntimeEnv): BucketInfo[] {
  const configured = Boolean(env.MAIL_BUCKET);
  const displayNames = parseExtraR2Buckets(env.EXTRA_R2_BUCKETS);
  const extraBindings = new Set<string>([...displayNames.keys(), ...discoverR2BindingNames(env)]);
  const buckets: BucketInfo[] = [
    {
      id: "mail",
      name: runtimeBucketName(env),
      binding: "MAIL_BUCKET",
      configured,
      writable: configured,
      description: "OmniDock raw messages, attachments, and manual files"
    }
  ];

  for (const binding of [...extraBindings].sort((left, right) => left.localeCompare(right))) {
    if (binding === "MAIL_BUCKET" || reservedBucketDiscoveryBindings.has(binding)) continue;
    const bucket = r2BucketFromEnv(env, binding);
    buckets.push({
      id: bucketIdForBinding(binding),
      name: displayNames.get(binding) ?? humanizeBucketBinding(binding),
      binding,
      configured: Boolean(bucket),
      writable: Boolean(bucket),
      description: bucket ? "Extra storage bucket" : "Bucket binding is not connected"
    });
  }

  return buckets;
}

function parseExtraR2Buckets(value?: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!value?.trim()) return result;

  for (const rawItem of value.split(/[,\n]/)) {
    const item = rawItem.trim();
    if (!item) continue;
    const separator = item.includes("=") ? "=" : item.includes(":") ? ":" : "";
    const displayName = (separator ? item.slice(item.indexOf(separator) + 1) : item).trim();
    const binding = (separator ? item.slice(0, item.indexOf(separator)) : bindingNameForBucket(displayName)).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(binding)) continue;
    result.set(binding, displayName || binding);
  }

  return result;
}

function bindingNameForBucket(bucketName: string): string {
  const normalized = bucketName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `R2_${normalized || "BUCKET"}`;
}

function discoverR2BindingNames(env: RuntimeEnv): string[] {
  const source = env as unknown as Record<string, unknown>;
  return Object.keys(source).filter(
    (key) => key !== "MAIL_BUCKET" && !reservedBucketDiscoveryBindings.has(key) && isR2Bucket(source[key])
  );
}

function r2BucketFromEnv(env: RuntimeEnv, binding: string): R2Bucket | null {
  const value = (env as unknown as Record<string, unknown>)[binding];
  return isR2Bucket(value) ? value : null;
}

function isR2Bucket(value: unknown): value is R2Bucket {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Record<"get" | "put" | "delete" | "list", unknown>>;
  return (
    typeof candidate.get === "function" &&
    typeof candidate.put === "function" &&
    typeof candidate.delete === "function" &&
    typeof candidate.list === "function"
  );
}

function bucketIdForBinding(binding: string): string {
  return binding.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "bucket";
}

function getBucketBinding(env: RuntimeEnv, bucketId: string): BucketBinding {
  const info = listAvailableBuckets(env).find((bucket) => bucket.id === bucketId);
  if (!info) {
    throw new ApiError(404, "bucket_not_found", "Bucket is not configured for this Worker");
  }
  const bucket = r2BucketFromEnv(env, info.binding);
  if (!bucket) {
    throw new ApiError(503, "bucket_binding_missing", `R2 binding ${info.binding} is not configured for this Worker.`);
  }
  return { info, bucket };
}

async function searchBucketObjects(env: RuntimeEnv, url: URL) {
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query.length < 2) {
    throw new ApiError(400, "invalid_search", "Search query must be at least 2 characters.");
  }

  const includeText = url.searchParams.get("text") === "1";
  const scope = url.searchParams.get("scope") === "all" ? "all" : "bucket";
  const bucketId = url.searchParams.get("bucketId")?.trim() || "mail";
  const normalizedQuery = normalizeSearchText(query);
  const bucketBindings =
    scope === "all"
      ? listAvailableBuckets(env)
          .filter((bucket) => bucket.configured)
          .map((bucket) => ({ info: bucket, bucket: r2BucketFromEnv(env, bucket.binding) }))
          .filter((item): item is BucketBinding => Boolean(item.bucket))
      : [getBucketBinding(env, bucketId)];

  const results: Array<ReturnType<typeof serializeR2Object> & {
    bucketId: string;
    bucketName: string;
    bucketBinding: string;
    match: "path" | "content";
    snippet: string | null;
  }> = [];
  let scanned = 0;
  let contentScanned = 0;
  let truncated = false;

  for (const bucket of bucketBindings) {
    let cursor: string | undefined;
    do {
      const page = await bucket.bucket.list({
        cursor,
        include: ["httpMetadata"],
        limit: 200
      });

      for (const object of page.objects) {
        scanned += 1;
        const keySearch = normalizeSearchText(object.key);
        const nameSearch = normalizeSearchText(filenameFromR2Key(object.key));
        const pathMatches = keySearch.includes(normalizedQuery) || nameSearch.includes(normalizedQuery);
        let contentSnippet: string | null = null;

        if (
          !pathMatches &&
          includeText &&
          contentScanned < MAX_BUCKET_TEXT_SEARCH_FILES &&
          object.size <= MAX_BUCKET_TEXT_SEARCH_BYTES &&
          isTextSearchCandidate(object)
        ) {
          contentScanned += 1;
          contentSnippet = await findTextMatch(bucket.bucket, object, normalizedQuery);
        }

        if (pathMatches || contentSnippet) {
          results.push({
            ...serializeR2Object(object),
            bucketId: bucket.info.id,
            bucketName: bucket.info.name,
            bucketBinding: bucket.info.binding,
            match: contentSnippet ? "content" : "path",
            snippet: contentSnippet
          });
        }

        if (results.length >= MAX_BUCKET_SEARCH_RESULTS || scanned >= MAX_BUCKET_SEARCH_SCAN) {
          truncated = true;
          break;
        }
      }

      if (results.length >= MAX_BUCKET_SEARCH_RESULTS || scanned >= MAX_BUCKET_SEARCH_SCAN) {
        break;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    if (results.length >= MAX_BUCKET_SEARCH_RESULTS || scanned >= MAX_BUCKET_SEARCH_SCAN) {
      break;
    }
  }

  return {
    ok: true,
    query,
    scope,
    bucket: scope === "bucket" ? bucketBindings[0]?.info ?? null : null,
    results,
    scanned,
    contentScanned,
    truncated
  };
}

async function findTextMatch(bucket: R2Bucket, object: R2Object, normalizedQuery: string): Promise<string | null> {
  const body = await bucket.get(object.key);
  if (!body) return null;
  const text = isPdfSearchCandidate(object)
    ? await extractPdfText(await body.arrayBuffer())
    : await body.text();
  if (!text.trim()) return null;
  const normalizedText = normalizeSearchText(text);
  const index = normalizedText.indexOf(normalizedQuery);
  if (index < 0) return null;
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + normalizedQuery.length + 120);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function normalizeSearchText(value: string): string {
  return value
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isTextSearchCandidate(object: R2Object): boolean {
  const contentType = object.httpMetadata?.contentType?.toLowerCase() ?? "";
  const filename = object.key.toLowerCase();
  const textExtensions = [".txt", ".md", ".csv", ".json", ".log", ".xml", ".html", ".css", ".js", ".ts", ".tsx", ".yml", ".yaml"];
  return (
    isPdfSearchCandidate(object) ||
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    textExtensions.some((extension) => filename.endsWith(extension))
  );
}

function isPdfSearchCandidate(object: R2Object): boolean {
  const contentType = object.httpMetadata?.contentType?.toLowerCase() ?? "";
  return contentType === "application/pdf" || object.key.toLowerCase().endsWith(".pdf");
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const raw = decodePdfBytes(bytes);
  const chunks = [raw];

  for (const stream of await extractPdfStreams(bytes, raw)) {
    chunks.push(decodePdfBytes(stream));
  }

  return extractPdfOperatorText(chunks.join("\n"));
}

async function extractPdfStreams(bytes: Uint8Array, raw: string): Promise<Uint8Array[]> {
  const streams: Uint8Array[] = [];
  let offset = 0;

  while (offset < raw.length) {
    const streamIndex = raw.indexOf("stream", offset);
    if (streamIndex < 0) break;
    const endIndex = raw.indexOf("endstream", streamIndex + 6);
    if (endIndex < 0) break;

    let dataStart = streamIndex + 6;
    if (raw[dataStart] === "\r" && raw[dataStart + 1] === "\n") {
      dataStart += 2;
    } else if (raw[dataStart] === "\n" || raw[dataStart] === "\r") {
      dataStart += 1;
    }

    let dataEnd = endIndex;
    while (dataEnd > dataStart && (raw[dataEnd - 1] === "\n" || raw[dataEnd - 1] === "\r")) {
      dataEnd -= 1;
    }

    const dictionary = raw.slice(Math.max(0, streamIndex - 500), streamIndex);
    const streamBytes = bytes.slice(dataStart, dataEnd);
    if (/\/Filter\s*(?:\/FlateDecode|\[[^\]]*\/FlateDecode)/.test(dictionary)) {
      const inflated = await inflatePdfStream(streamBytes);
      if (inflated) streams.push(inflated);
    } else {
      streams.push(streamBytes);
    }

    offset = endIndex + 9;
  }

  return streams;
}

async function inflatePdfStream(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

function extractPdfOperatorText(source: string): string {
  const parts: string[] = [];

  for (const match of source.matchAll(/\[((?:.|\n|\r)*?)\]\s*TJ/g)) {
    parts.push(...extractPdfStrings(match[1]));
  }

  for (const match of source.matchAll(/(\((?:\\.|[^\\()])*\)|<[\dA-Fa-f\s]+>)\s*(?:Tj|'|")/g)) {
    parts.push(decodePdfTokenString(match[1]));
  }

  const text = parts
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");

  return text || source.replace(/[^\p{L}\p{N}\s.,;:!?@/#%&()[\]{}_-]+/gu, " ");
}

function extractPdfStrings(value: string): string[] {
  const strings: string[] = [];
  for (const match of value.matchAll(/\((?:\\.|[^\\()])*\)|<[\dA-Fa-f\s]+>/g)) {
    strings.push(decodePdfTokenString(match[0]));
  }
  return strings;
}

function decodePdfTokenString(token: string): string {
  if (token.startsWith("<")) {
    return decodePdfHexString(token);
  }
  return decodePdfLiteralString(token);
}

function decodePdfLiteralString(token: string): string {
  const content = token.slice(1, -1);
  const bytes: number[] = [];

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char !== "\\") {
      bytes.push(content.charCodeAt(index) & 0xff);
      continue;
    }

    const next = content[index + 1];
    if (!next) break;
    if (/[0-7]/.test(next)) {
      const octal = content.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] ?? next;
      bytes.push(Number.parseInt(octal, 8) & 0xff);
      index += octal.length;
      continue;
    }

    const escapeMap: Record<string, number | null> = {
      n: 10,
      r: 13,
      t: 9,
      b: 8,
      f: 12,
      "(": 40,
      ")": 41,
      "\\": 92,
      "\n": null,
      "\r": null
    };
    const mapped = escapeMap[next];
    if (mapped !== undefined) {
      if (mapped !== null) bytes.push(mapped);
      if (next === "\r" && content[index + 2] === "\n") index += 1;
      index += 1;
      continue;
    }

    bytes.push(next.charCodeAt(0) & 0xff);
    index += 1;
  }

  return decodePdfStringBytes(new Uint8Array(bytes));
}

function decodePdfHexString(token: string): string {
  const hex = token.slice(1, -1).replace(/\s+/g, "");
  const bytes = new Uint8Array(Math.ceil(hex.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2).padEnd(2, "0"), 16);
  }
  return decodePdfStringBytes(bytes);
}

function decodePdfStringBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Bytes(bytes.slice(2), false);
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeUtf16Bytes(bytes.slice(2), true);
  }
  if (looksLikeUtf16Be(bytes)) {
    return decodeUtf16Bytes(bytes, false);
  }

  const utf8 = new TextDecoder("utf-8").decode(bytes);
  return utf8.includes("\ufffd") ? decodePdfBytes(bytes) : utf8;
}

function decodeUtf16Bytes(bytes: Uint8Array, littleEndian: boolean): string {
  let output = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const code = littleEndian ? bytes[index] | (bytes[index + 1] << 8) : (bytes[index] << 8) | bytes[index + 1];
    output += String.fromCharCode(code);
  }
  return output;
}

function looksLikeUtf16Be(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes.length % 2 !== 0) return false;
  let zeroHighBytes = 0;
  const pairs = Math.min(24, bytes.length / 2);
  for (let index = 0; index < pairs * 2; index += 2) {
    if (bytes[index] === 0) zeroHighBytes += 1;
  }
  return zeroHighBytes >= Math.ceil(pairs * 0.6);
}

function decodePdfBytes(bytes: Uint8Array): string {
  let output = "";
  const chunkSize = 8192;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    output += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return output;
}

function runtimeBucketName(env: RuntimeEnv): string {
  return env.R2_BUCKET_NAME?.trim() || "Mail bucket";
}

function humanizeBucketBinding(binding: string): string {
  const label = binding
    .replace(/_?R2_?/gi, "_")
    .replace(/_?BUCKET$/i, "")
    .replace(/_/g, " ")
    .trim();
  if (!label) return binding;
  return label
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function readR2Prefix(url: URL): string {
  const prefix = url.searchParams.get("prefix") ?? "";
  if (prefix.length > 1024 || /[\u0000-\u001f\u007f]/.test(prefix) || prefix.startsWith("/")) {
    throw new ApiError(400, "invalid_prefix", "R2 prefix is invalid");
  }
  return prefix;
}

function readR2Key(url: URL): string {
  const key = url.searchParams.get("key") ?? "";
  if (!key || key.length > 1024 || key.startsWith("/") || key.endsWith("/") || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new ApiError(400, "invalid_key", "R2 object key is invalid");
  }
  return key;
}

function serializeR2Object(object: R2Object) {
  return {
    key: object.key,
    name: filenameFromR2Key(object.key),
    size: object.size,
    uploaded: object.uploaded.toISOString(),
    etag: object.etag,
    contentType: object.httpMetadata?.contentType ?? "application/octet-stream"
  };
}

function displayR2FolderName(folderPrefix: string, parentPrefix: string): string {
  const relative = folderPrefix.slice(parentPrefix.length).replace(/\/$/, "");
  return relative.split("/").filter(Boolean).pop() || folderPrefix.replace(/\/$/, "") || "/";
}

function filenameFromR2Key(key: string): string {
  return key.split("/").filter(Boolean).pop() || "object";
}

async function seedDevelopmentData(env: RuntimeEnv): Promise<number> {
  if (env.ENABLE_DEV_SEED !== "true") {
    throw new ApiError(403, "seed_disabled", "Seed endpoint is disabled");
  }

  const domain = await upsertDomain(env, {
    domain: "example.com",
    source: "manual",
    sendingEnabled: true,
    routingEnabled: true,
    catchAllEnabled: true,
    status: "demo-ready"
  });

  await ensureMailbox(env, "support@example.com", "Support");

  await insertMessage(env, {
    direction: "inbound",
    mailbox: "support@example.com",
    domain: domain.domain,
    fromAddress: "info@example.net",
    fromName: "Client Ops",
    to: ["support@example.com"],
    subject: "Routing active check",
    snippet: "OmniDock received this routed message and stored it in D1/R2.",
    textBody: "OmniDock received this routed message and stored it in D1/R2.",
    receivedAt: new Date().toISOString()
  });

  await recordAudit(env, "dev.seed", domain.id, { domain: domain.domain });
  return 1;
}

function readContactInput(
  body: Record<string, unknown>,
  source: string
): { email: string; name: string | null; company: string | null; phone: string | null; tags: string | null; notes: string | null; source: string } {
  return {
    email: requiredString(body, "email", { max: 320 }),
    name: optionalString(body, "name", { max: 160 }),
    company: optionalString(body, "company", { max: 160 }),
    phone: optionalString(body, "phone", { max: 80 }),
    tags: optionalString(body, "tags", { max: 300 }),
    notes: optionalString(body, "notes", { max: 2000 }),
    source
  };
}

function readExternalAccountInput(body: Record<string, unknown>): {
  provider: string;
  email: string;
  displayName: string | null;
  username: string | null;
  authType: string;
  credentialSecretName: string | null;
  imapHost: string | null;
  imapPort: number | null;
  imapSecurity: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecurity: string;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  notes: string | null;
} {
  const provider = enumString(body, "provider", ["gmail", "outlook", "yahoo", "icloud", "custom"], "custom");
  const authType = enumString(body, "authType", ["app_password", "oauth2", "none"], "app_password");
  const imapSecurity = enumString(body, "imapSecurity", ["ssl", "starttls", "none"], "ssl");
  const smtpSecurity = enumString(body, "smtpSecurity", ["ssl", "starttls", "none"], "starttls");
  const email = requiredString(body, "email", { max: 320 });
  const credentialSecretNameInput = optionalString(body, "credentialSecretName", { max: 320 });
  const credentialSecretName = authType === "none" ? null : credentialSecretNameInput || email.toLowerCase();

  if (credentialSecretName && !isCredentialSecretReference(credentialSecretName)) {
    throw new ApiError(
      400,
      "invalid_secret_name",
      "Enter an email address or a Worker secret name. Do not paste the email password itself."
    );
  }

  return {
    provider,
    email,
    displayName: optionalString(body, "displayName", { max: 160 }),
    username: optionalString(body, "username", { max: 320 }),
    authType,
    credentialSecretName,
    imapHost: optionalString(body, "imapHost", { max: 253 }),
    imapPort: optionalPort(body, "imapPort"),
    imapSecurity,
    smtpHost: optionalString(body, "smtpHost", { max: 253 }),
    smtpPort: optionalPort(body, "smtpPort"),
    smtpSecurity,
    inboundEnabled: optionalBoolean(body, "inboundEnabled"),
    outboundEnabled: optionalBoolean(body, "outboundEnabled"),
    notes: optionalString(body, "notes", { max: 2000 })
  };
}

function isCredentialSecretReference(value: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/i.test(value) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function publicOrigin(request: Request, env: RuntimeEnv): string {
  const url = new URL(request.url);
  const managementHost = env.MANAGEMENT_HOST?.trim();
  if (
    managementHost &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1" &&
    !url.hostname.endsWith(".workers.dev")
  ) {
    return `https://${managementHost}`;
  }
  return url.origin;
}

function enumString<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  fallback: T
): T {
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ApiError(400, "invalid_field", `${field} is invalid`);
  }
  return value as T;
}

function optionalPort(body: Record<string, unknown>, field: string): number | null {
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const port = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ApiError(400, "invalid_port", `${field} is invalid`);
  }
  return port;
}

function readContactList(
  body: Record<string, unknown>
): { email: string; name: string | null; company: string | null; phone: string | null; tags: string | null; notes: string | null }[] {
  const value = body.contacts;
  if (!Array.isArray(value)) {
    throw new ApiError(400, "invalid_contacts", "contacts must be an array");
  }
  if (value.length === 0 || value.length > 1000) {
    throw new ApiError(400, "invalid_contacts", "Import 1-1000 contacts at a time");
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      throw new ApiError(400, "invalid_contact", "Each contact must be an object");
    }
    return readContactInput(item, "upload");
  });
}

function textField(body: Record<string, unknown>, field: string, max: number): string {
  const value = body[field];
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string" || value.length > max) {
    throw new ApiError(400, "invalid_field", `${field} is invalid`);
  }
  return value;
}

function optionalRawString(body: Record<string, unknown>, field: string, max: number): string | null {
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.length > max) {
    throw new ApiError(400, "invalid_field", `${field} is invalid`);
  }
  return value;
}

function optionalEnabled(body: Record<string, unknown>): boolean {
  const value = body.enabled;
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== "boolean") {
    throw new ApiError(400, "invalid_field", "enabled must be a boolean");
  }
  return value;
}

function attachmentList(
  body: Record<string, unknown>
): { filename: string; contentType: string; contentBase64: string; size: number }[] {
  const value = body.attachments;
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ApiError(400, "invalid_attachments", "attachments must be an array");
  }
  if (value.length > 10) {
    throw new ApiError(400, "too_many_attachments", "Attach up to 10 files");
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      throw new ApiError(400, "invalid_attachment", "Each attachment must be an object");
    }
    const size = item.size;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
      throw new ApiError(400, "invalid_attachment_size", "Attachment size is invalid");
    }
    return {
      filename: requiredString(item, "filename", { max: 180 }),
      contentType: optionalString(item, "contentType", { max: 120 }) ?? "application/octet-stream",
      contentBase64: requiredString(item, "contentBase64", { max: 30000000 }),
      size
    };
  });
}

function safeHeaderFilename(filename: string): string {
  return filename.replace(/["\r\n]/g, "_");
}
