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
      await createAdminAccount(env, {
        name: requiredString(body, "name", { min: 2, max: 160 }),
        email: requiredString(body, "email", { max: 320 }),
        recoveryEmail,
        primaryDomain,
        password: optionalString(body, "password", { max: 256 })
      });
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
  binding: "MAIL_BUCKET";
  configured: boolean;
  writable: boolean;
  description: string;
};

type BucketBinding = {
  info: BucketInfo;
  bucket: R2Bucket;
};

function listAvailableBuckets(env: RuntimeEnv): BucketInfo[] {
  const configured = Boolean(env.MAIL_BUCKET);
  return [
    {
      id: "mail",
      name: runtimeBucketName(env),
      binding: "MAIL_BUCKET",
      configured,
      writable: configured,
      description: "OmniDock raw messages, attachments, and manual files"
    }
  ];
}

function getBucketBinding(env: RuntimeEnv, bucketId: string): BucketBinding {
  if (bucketId !== "mail") {
    throw new ApiError(404, "bucket_not_found", "Bucket is not configured for this Worker");
  }
  requireMailBucketBinding(env);
  const info = listAvailableBuckets(env)[0];
  return { info, bucket: env.MAIL_BUCKET };
}

function runtimeBucketName(env: RuntimeEnv): string {
  return env.R2_BUCKET_NAME?.trim() || "MAIL_BUCKET";
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
  const credentialSecretName = optionalString(body, "credentialSecretName", { max: 128 });

  if (credentialSecretName && !/^[A-Z_][A-Z0-9_]*$/i.test(credentialSecretName)) {
    throw new ApiError(400, "invalid_secret_name", "Credential secret name must look like a Worker secret name");
  }

  return {
    provider,
    email: requiredString(body, "email", { max: 320 }),
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
