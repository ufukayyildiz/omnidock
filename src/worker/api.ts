import {
  confirmAdminPasswordReset,
  createAdminAccount,
  getSetupStatus,
  requestAdminPasswordReset,
  requireAdmin,
  setAdminPassword
} from "./auth";
import {
  createMailboxAndRoutingRule,
  enableCatchAllForDomain,
  enableRoutingForMailbox,
  syncCloudflareInventory
} from "./cloudflare";
import {
  archiveThread,
  getAttachmentById,
  getMailboxStats,
  getStats,
  getThread,
  ensureMailbox,
  importContacts,
  insertMessage,
  listContacts,
  listDomains,
  listMailboxSignatures,
  listMailboxes,
  listThreads,
  markThreadRead,
  normalizeDomain,
  recordAudit,
  setDefaultDomain,
  upsertContact,
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
      return json({ ok: true, ...(await getSetupStatus(env)) });
    }

    if (url.pathname === "/api/setup") {
      if (request.method !== "POST") return methodNotAllowed();
      const body = await readJson(request);
      await createAdminAccount(env, {
        name: requiredString(body, "name", { min: 2, max: 160 }),
        email: requiredString(body, "email", { max: 320 }),
        password: requiredString(body, "password", { min: 12, max: 256 })
      });
      ctx.waitUntil(recordAudit(env, "admin.created", "primary", {}));
      return json({ ok: true }, { status: 201 });
    }

    if (url.pathname === "/api/auth/reset/request") {
      if (request.method !== "POST") return methodNotAllowed();
      const body = await readJson(request);
      await requestAdminPasswordReset(env, requiredString(body, "email", { max: 320 }), publicOrigin(request, env));
      return json({ ok: true });
    }

    if (url.pathname === "/api/auth/reset/confirm") {
      if (request.method !== "POST") return methodNotAllowed();
      const body = await readJson(request);
      await confirmAdminPasswordReset(env, {
        token: requiredString(body, "token", { min: 24, max: 256 }),
        password: requiredString(body, "password", { min: 12, max: 256 })
      });
      ctx.waitUntil(recordAudit(env, "admin.password_reset", "primary", {}));
      return json({ ok: true });
    }

    await requireAdmin(request, env);

    if (url.pathname === "/api/bootstrap") {
      if (request.method !== "GET") return methodNotAllowed();
      const [domains, mailboxes, contacts, signatures, stats, threads] = await Promise.all([
        listDomains(env),
        listMailboxes(env),
        listContacts(env),
        listMailboxSignatures(env),
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

    if (url.pathname === "/api/contacts/import") {
      if (request.method !== "POST") return methodNotAllowed();
      const body = await readJson(request);
      const source = optionalString(body, "source", { max: 32 }) ?? "upload";
      const contacts = readContactList(body);
      const imported = await importContacts(env, contacts, source);
      ctx.waitUntil(recordAudit(env, "contacts.imported", null, { imported, source }));
      return json({ ok: true, imported }, { status: 201 });
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

      return methodNotAllowed();
    }

    const attachmentMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)$/);
    if (attachmentMatch) {
      if (request.method !== "GET") return methodNotAllowed();
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

    const replyMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/reply$/);
    if (replyMatch) {
      if (request.method !== "POST") return methodNotAllowed();
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
    snippet: "Emailfox received this routed message and stored it in D1/R2.",
    textBody: "Emailfox received this routed message and stored it in D1/R2.",
    receivedAt: new Date().toISOString()
  });

  await recordAudit(env, "dev.seed", domain.id, { domain: domain.domain });
  return 1;
}

function readContactInput(
  body: Record<string, unknown>,
  source: string
): { email: string; name: string | null; company: string | null; tags: string | null; notes: string | null; source: string } {
  return {
    email: requiredString(body, "email", { max: 320 }),
    name: optionalString(body, "name", { max: 160 }),
    company: optionalString(body, "company", { max: 160 }),
    tags: optionalString(body, "tags", { max: 300 }),
    notes: optionalString(body, "notes", { max: 2000 }),
    source
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

function readContactList(
  body: Record<string, unknown>
): { email: string; name: string | null; company: string | null; tags: string | null; notes: string | null }[] {
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
