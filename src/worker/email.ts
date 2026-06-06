import PostalMime from "postal-mime";
import {
  createId,
  domainFromEmail,
  ensureMailbox,
  findThreadForHeaders,
  getDomainByName,
  getMailboxByAddress,
  getSignatureForMailboxAddress,
  getThread,
  insertAttachment,
  insertMessage,
  MessageRow,
  normalizeAddressList,
  normalizeEmail,
  nowIso,
  recordAudit
} from "./db";
import { ApiError, RuntimeEnv, isRecord } from "./http";
import { ensureDatabaseSchema } from "./schema";

type SendInput = {
  from: string;
  fromName?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string | null;
  html?: string | null;
  replyToThreadId?: string | null;
  attachments?: OutboundAttachmentInput[];
};

type ParsedAddress = {
  address?: string;
  name?: string;
};

type OutboundAttachmentInput = {
  filename: string;
  contentType: string;
  contentBase64: string;
  size: number;
};

type PreparedAttachment = {
  filename: string;
  contentType: string;
  size: number;
  content: Uint8Array;
  r2Key: string;
};

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10;

export async function receiveEmail(
  message: ForwardableEmailMessage,
  env: RuntimeEnv
): Promise<MessageRow> {
  await ensureDatabaseSchema(env);

  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(raw);

  const mailbox = normalizeEmail(message.to);
  const from = normalizeEmail(message.from);
  const domain = domainFromEmail(mailbox);
  const subject = parsed.subject ?? message.headers.get("subject") ?? "";
  const textBody = parsed.text ?? null;
  const htmlBody = parsed.html ?? null;
  const inReplyTo = message.headers.get("in-reply-to");
  const referencesHeader = message.headers.get("references");
  const messageId = message.headers.get("message-id");
  const threadId =
    (await findThreadForHeaders(env, {
      inReplyTo,
      references: referencesHeader,
      subject,
      mailbox
    })) ?? createId("thr");

  await ensureMailbox(env, mailbox, null);

  const rawR2Key = buildObjectKey("raw", mailbox, "message.eml");
  await env.MAIL_BUCKET.put(rawR2Key, raw, {
    httpMetadata: {
      contentType: "message/rfc822"
    },
    customMetadata: {
      mailbox,
      from,
      subject: subject.slice(0, 256)
    }
  });

  const to = addressListFromParsed(parsed.to, mailbox);
  const cc = addressListFromParsed(parsed.cc, "");
  const sender = parsed.from && isRecord(parsed.from) ? (parsed.from as ParsedAddress) : null;

  const stored = await insertMessage(env, {
    threadId,
    direction: "inbound",
    mailbox,
    domain,
    fromAddress: sender?.address ? normalizeEmail(sender.address) : from,
    fromName: sender?.name ?? null,
    to,
    cc,
    subject,
    snippet: makeSnippet(textBody ?? htmlToText(htmlBody ?? "")),
    textBody,
    htmlBody,
    messageId,
    inReplyTo,
    referencesHeader,
    rawR2Key,
    receivedAt: nowIso()
  });

  for (const attachment of parsed.attachments ?? []) {
    const filename = attachment.filename || "attachment";
    const contentType = attachment.mimeType || "application/octet-stream";
    const r2Key = buildObjectKey("attachments", mailbox, filename);
    const content = attachment.content;
    const size = typeof content === "string" ? new TextEncoder().encode(content).byteLength : content.byteLength;

    await env.MAIL_BUCKET.put(r2Key, content, {
      httpMetadata: {
        contentType
      },
      customMetadata: {
        messageId: stored.id,
        filename
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

  await recordAudit(env, "email.received", stored.id, { mailbox, from });
  return stored;
}

export async function sendEmail(env: RuntimeEnv, input: SendInput): Promise<MessageRow> {
  await ensureDatabaseSchema(env);

  const from = normalizeEmail(input.from);
  const domain = domainFromEmail(from);
  const domainRow = await getDomainByName(env, domain);
  const mailboxRow = await getMailboxByAddress(env, from);

  if (!domainRow || domainRow.sending_enabled !== 1) {
    throw new ApiError(400, "sender_not_verified", "Sender domain is not marked as verified for Email Sending");
  }
  if (!mailboxRow || mailboxRow.enabled !== 1 || mailboxRow.domain_id !== domainRow.id) {
    throw new ApiError(400, "sender_mailbox_not_enabled", "Sender mailbox is not enabled in OmniDock");
  }

  const to = normalizeAddressList(input.to);
  const cc = normalizeAddressList(input.cc ?? []);
  const bcc = normalizeAddressList(input.bcc ?? []);

  if (to.length === 0) {
    throw new ApiError(400, "recipient_missing", "At least one recipient is required");
  }

  if (to.length + cc.length + bcc.length > 50) {
    throw new ApiError(400, "too_many_recipients", "Cloudflare Email Service allows up to 50 recipients");
  }

  const subject = input.subject.trim();
  const signature = await getSignatureForMailboxAddress(env, from);
  const text = applyTextSignature(input.text?.trim() || htmlToText(input.html ?? ""), signature?.text_signature, signature?.enabled);
  const html = applyHtmlSignature(input.html?.trim() || textToHtml(text), signature?.html_signature, signature?.text_signature, signature?.enabled);
  const attachments = prepareOutboundAttachments(from, input.attachments ?? []);
  const headers: Record<string, string> = {};
  let threadId = input.replyToThreadId ?? createId("thr");
  let replyMailbox = from;
  const plannedMessageId = createId("msg");

  if (input.replyToThreadId) {
    const thread = await getThread(env, input.replyToThreadId);
    if (thread.messages.length === 0) {
      throw new ApiError(404, "thread_not_found", "Reply thread was not found");
    }
    const original = [...thread.messages].reverse().find((message) => message.message_id);
    if (original?.message_id) {
      headers["In-Reply-To"] = original.message_id;
      headers.References = [original.references_header, original.message_id].filter(Boolean).join(" ");
    }
    const inbound = thread.messages.find((message) => message.direction === "inbound");
    replyMailbox = inbound?.mailbox ?? from;
    threadId = input.replyToThreadId;
  }

  const sender = input.fromName ? { email: from, name: input.fromName } : from;

  try {
    await Promise.all(
      attachments.map((attachment) =>
        env.MAIL_BUCKET.put(attachment.r2Key, attachment.content, {
          httpMetadata: {
            contentType: attachment.contentType
          },
          customMetadata: {
            messageId: plannedMessageId,
            filename: attachment.filename,
            direction: "outbound"
          }
        })
      )
    );
  } catch {
    throw new ApiError(500, "attachment_store_failed", "Attachments could not be stored in R2");
  }

  let response: EmailSendResult;
  try {
    const emailAttachments: EmailAttachment[] = attachments.map((attachment): EmailAttachment => ({
      disposition: "attachment",
      filename: attachment.filename,
      type: attachment.contentType,
      content: attachment.content
    }));

    response = await env.EMAIL.send({
      to,
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      from: sender,
      subject,
      text,
      html,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      attachments: emailAttachments
    });
  } catch (error) {
    await Promise.allSettled(attachments.map((attachment) => env.MAIL_BUCKET.delete(attachment.r2Key)));
    throw error;
  }

  const stored = await insertMessage(env, {
    id: plannedMessageId,
    threadId,
    direction: "outbound",
    mailbox: replyMailbox,
    domain,
    fromAddress: from,
    fromName: input.fromName ?? null,
    to,
    cc,
    bcc,
    subject,
    snippet: makeSnippet(text),
    textBody: text,
    htmlBody: html,
    sentStatus: "sent",
    sentMessageId: response.messageId ?? null,
    readAt: nowIso()
  });

  for (const attachment of attachments) {
    await insertAttachment(env, {
      messageId: stored.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      r2Key: attachment.r2Key,
      disposition: "attachment"
    });
  }

  await recordAudit(env, "email.sent", stored.id, { from, to, attachments: attachments.length });
  return stored;
}

function buildObjectKey(kind: "raw" | "attachments", mailbox: string, filename: string): string {
  const safeMailbox = mailbox.replace(/[^a-z0-9@._-]/gi, "_");
  const safeFilename = filename.replace(/[^a-z0-9._-]/gi, "_").slice(0, 128);
  const date = new Date().toISOString().slice(0, 10);
  return `${kind}/${date}/${safeMailbox}/${crypto.randomUUID()}-${safeFilename}`;
}

function addressListFromParsed(value: unknown, fallback: string): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (isRecord(entry) && typeof entry.address === "string") {
          return entry.address;
        }
        if (typeof entry === "string") {
          return entry;
        }
        return "";
      })
      .filter(Boolean)
      .map(normalizeEmail);
  }

  if (fallback) {
    return [normalizeEmail(fallback)];
  }

  return [];
}

function makeSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyTextSignature(text: string, signature: string | null | undefined, enabled: number | undefined): string {
  const cleanSignature = signature?.trim();
  if (enabled === 0 || !cleanSignature) {
    return text;
  }

  return text ? `${text}\n\n${cleanSignature}` : cleanSignature;
}

function applyHtmlSignature(
  html: string,
  htmlSignature: string | null | undefined,
  textSignature: string | null | undefined,
  enabled: number | undefined
): string {
  if (enabled === 0) {
    return html;
  }

  const signatureHtml = htmlSignature?.trim() || (textSignature?.trim() ? textToHtml(textSignature.trim()) : "");
  if (!signatureHtml) {
    return html;
  }

  return html ? `${html}<br>${signatureHtml}` : signatureHtml;
}

function prepareOutboundAttachments(from: string, attachments: OutboundAttachmentInput[]): PreparedAttachment[] {
  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    throw new ApiError(400, "too_many_attachments", `Attach up to ${MAX_ATTACHMENT_COUNT} files`);
  }

  let totalBytes = 0;
  return attachments.map((attachment) => {
    const filename = sanitizeFilename(attachment.filename);
    const contentType = attachment.contentType?.trim() || "application/octet-stream";
    const content = base64ToBytes(attachment.contentBase64);
    const size = attachment.size || content.byteLength;
    totalBytes += size;

    if (size > MAX_ATTACHMENT_BYTES) {
      throw new ApiError(400, "attachment_too_large", `${filename} is too large`);
    }
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new ApiError(400, "attachments_too_large", "Attachments are too large");
    }

    return {
      filename,
      contentType,
      size,
      content,
      r2Key: buildObjectKey("attachments", from, filename)
    };
  });
}

function sanitizeFilename(filename: string): string {
  const safe = filename.trim().replace(/[^\w .@-]/g, "_").slice(0, 128);
  return safe || "attachment";
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.includes(",") ? value.split(",").pop() ?? "" : value;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
