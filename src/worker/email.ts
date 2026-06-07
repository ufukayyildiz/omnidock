import { connect } from "cloudflare:sockets";
import PostalMime from "postal-mime";
import {
  createId,
  domainFromEmail,
  ensureMailbox,
  findThreadForHeaders,
  getDomainByName,
  getExternalAccountByEmail,
  getMailboxByAddress,
  getSignatureForMailboxAddress,
  getThread,
  insertAttachment,
  insertMessage,
  type ExternalAccountRow,
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

type SmtpSecurity = "ssl" | "starttls" | "none";

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10;
const SMTP_CONNECT_TIMEOUT_MS = 12_000;
const SMTP_COMMAND_TIMEOUT_MS = 15_000;
const SMTP_DATA_TIMEOUT_MS = 45_000;
const SMTP_QUIT_TIMEOUT_MS = 3_000;

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
  const externalAccount = await getExternalAccountByEmail(env, from);
  if (externalAccount) {
    if (externalAccount.outbound_enabled !== 1) {
      throw new ApiError(400, "external_outbound_disabled", "Outbound sending is disabled for this external account");
    }
    return sendExternalSmtpEmail(env, externalAccount, input);
  }

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

async function sendExternalSmtpEmail(
  env: RuntimeEnv,
  account: ExternalAccountRow,
  input: SendInput
): Promise<MessageRow> {
  const from = normalizeEmail(account.email);
  if (!account.smtp_host || !account.smtp_port) {
    throw new ApiError(400, "external_smtp_missing", "SMTP host and port are required before sending from this external account");
  }
  if (account.auth_type !== "app_password") {
    throw new ApiError(400, "external_auth_unsupported", "Only app-password SMTP sending is supported right now");
  }

  const to = normalizeAddressList(input.to);
  const cc = normalizeAddressList(input.cc ?? []);
  const bcc = normalizeAddressList(input.bcc ?? []);

  if (to.length === 0) {
    throw new ApiError(400, "recipient_missing", "At least one recipient is required");
  }
  if (to.length + cc.length + bcc.length > 50) {
    throw new ApiError(400, "too_many_recipients", "Send to up to 50 recipients");
  }

  const subject = input.subject.trim();
  const text = input.text?.trim() || htmlToText(input.html ?? "");
  const html = input.html?.trim() || textToHtml(text);
  const attachments = prepareOutboundAttachments(from, input.attachments ?? []);
  const threadData = await prepareThreadHeaders(env, input.replyToThreadId ?? null, from);
  const plannedMessageId = createId("msg");
  const rfcMessageId = `<${plannedMessageId}@${domainFromEmail(from)}>`;

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
            direction: "outbound",
            source: "external-smtp"
          }
        })
      )
    );
  } catch {
    throw new ApiError(500, "attachment_store_failed", "Attachments could not be stored in R2");
  }

  const headers: Record<string, string> = {
    ...threadData.headers,
    "Message-ID": rfcMessageId
  };
  const mime = buildMimeMessage({
    from,
    fromName: input.fromName ?? account.display_name,
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    headers,
    attachments
  });

  try {
    try {
      await sendViaSmtp(env, account, from, [...to, ...cc, ...bcc], mime);
    } catch (error) {
      if (!shouldRetryImplicitTlsForGmail(account, error)) {
        throw error;
      }
      await recordAudit(env, "external_account.smtp_fallback", account.id, {
        email: account.email,
        from: "starttls",
        to: "ssl",
        reason: error instanceof Error ? error.message : "SMTP STARTTLS failed"
      });
      await sendViaSmtp(
        env,
        {
          ...account,
          smtp_port: 465,
          smtp_security: "ssl"
        },
        from,
        [...to, ...cc, ...bcc],
        mime
      );
    }
  } catch (error) {
    await Promise.allSettled(attachments.map((attachment) => env.MAIL_BUCKET.delete(attachment.r2Key)));
    await recordAudit(env, "email.send_failed.external", account.id, {
      from,
      to,
      message: error instanceof Error ? error.message : "External SMTP send failed"
    }).catch(() => undefined);
    throw error;
  }

  const stored = await insertMessage(env, {
    id: plannedMessageId,
    threadId: threadData.threadId,
    direction: "outbound",
    mailbox: threadData.replyMailbox,
    domain: domainFromEmail(from),
    fromAddress: from,
    fromName: input.fromName ?? account.display_name,
    to,
    cc,
    bcc,
    subject,
    snippet: makeSnippet(text),
    textBody: text,
    htmlBody: html,
    messageId: rfcMessageId,
    inReplyTo: headers["In-Reply-To"] ?? null,
    referencesHeader: headers.References ?? null,
    sentStatus: "sent",
    sentMessageId: rfcMessageId,
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

  await recordAudit(env, "email.sent.external", stored.id, { from, to, attachments: attachments.length });
  return stored;
}

async function sendViaSmtp(
  env: RuntimeEnv,
  account: ExternalAccountRow,
  from: string,
  recipients: string[],
  mime: string
): Promise<void> {
  if (!account.smtp_host || !account.smtp_port) {
    throw new ApiError(400, "external_smtp_missing", "SMTP host and port are required before sending from this external account");
  }
  const smtp = await SmtpClient.open({
    host: account.smtp_host,
    port: account.smtp_port,
    security: account.smtp_security as SmtpSecurity
  });
  try {
    await smtp.authenticate(account.username || account.email, externalCredential(env, account));
    await smtp.send(from, recipients, mime);
  } finally {
    await smtp.quit();
  }
}

function shouldRetryImplicitTlsForGmail(account: ExternalAccountRow, error: unknown): boolean {
  if (!(error instanceof ApiError) || error.code !== "smtp_timeout") return false;
  if (!/tls handshake/i.test(error.message)) return false;
  if ((account.smtp_security ?? "").toLowerCase() !== "starttls") return false;
  const host = (account.smtp_host ?? "").toLowerCase();
  return account.provider === "gmail" || host.includes("gmail.com");
}

async function prepareThreadHeaders(
  env: RuntimeEnv,
  replyToThreadId: string | null,
  fallbackMailbox: string
): Promise<{ headers: Record<string, string>; threadId: string; replyMailbox: string }> {
  const headers: Record<string, string> = {};
  let threadId = replyToThreadId ?? createId("thr");
  let replyMailbox = fallbackMailbox;

  if (!replyToThreadId) {
    return { headers, threadId, replyMailbox };
  }

  const thread = await getThread(env, replyToThreadId);
  if (thread.messages.length === 0) {
    throw new ApiError(404, "thread_not_found", "Reply thread was not found");
  }
  const original = [...thread.messages].reverse().find((message) => message.message_id);
  if (original?.message_id) {
    headers["In-Reply-To"] = original.message_id;
    headers.References = [original.references_header, original.message_id].filter(Boolean).join(" ");
  }
  const inbound = thread.messages.find((message) => message.direction === "inbound");
  replyMailbox = inbound?.mailbox ?? fallbackMailbox;
  threadId = replyToThreadId;
  return { headers, threadId, replyMailbox };
}

class SmtpClient {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = new Uint8Array(0);
  private closed = false;

  private constructor(private socket: Socket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  static async open(input: { host: string; port: number; security: SmtpSecurity }): Promise<SmtpClient> {
    const secureTransport = input.security === "ssl" ? "on" : input.security === "starttls" ? "starttls" : "off";
    const socket = connect(
      { hostname: input.host, port: input.port },
      { secureTransport, allowHalfOpen: false }
    );
    await withSmtpTimeout(socket.opened, SMTP_CONNECT_TIMEOUT_MS, "SMTP connection", () => socket.close().catch(() => undefined));
    let client = new SmtpClient(socket);
    await client.expect([220]);
    await client.ehlo();

    if (input.security === "starttls") {
      await client.command("STARTTLS", [220], SMTP_COMMAND_TIMEOUT_MS, "SMTP STARTTLS");
      const tlsSocket = socket.startTls({ expectedServerHostname: input.host });
      await withSmtpTimeout(tlsSocket.opened, SMTP_CONNECT_TIMEOUT_MS, "SMTP TLS handshake", () =>
        tlsSocket.close().catch(() => undefined)
      );
      client.releaseLocks();
      client = new SmtpClient(tlsSocket);
      await client.ehlo();
    }

    return client;
  }

  async authenticate(username: string, password: string): Promise<void> {
    await this.command("AUTH LOGIN", [334], SMTP_COMMAND_TIMEOUT_MS, "SMTP authentication");
    await this.command(base64Utf8(username), [334], SMTP_COMMAND_TIMEOUT_MS, "SMTP username");
    await this.command(base64Utf8(password), [235], SMTP_COMMAND_TIMEOUT_MS, "SMTP password");
  }

  async send(from: string, recipients: string[], mime: string): Promise<void> {
    await this.command(`MAIL FROM:<${from}>`, [250], SMTP_COMMAND_TIMEOUT_MS, "SMTP sender");
    for (const recipient of recipients) {
      await this.command(`RCPT TO:<${recipient}>`, [250, 251], SMTP_COMMAND_TIMEOUT_MS, "SMTP recipient");
    }
    await this.command("DATA", [354], SMTP_COMMAND_TIMEOUT_MS, "SMTP DATA");
    await this.write(`${dotStuff(mime)}\r\n.\r\n`, SMTP_DATA_TIMEOUT_MS, "SMTP message upload");
    await this.expect([250], SMTP_DATA_TIMEOUT_MS, "SMTP message acceptance");
  }

  async quit(): Promise<void> {
    if (this.closed) return;
    try {
      await this.command("QUIT", [221], SMTP_QUIT_TIMEOUT_MS, "SMTP quit");
    } catch {
      // The server can close first; force-close below is enough.
    }
    this.releaseLocks();
    await this.socket.close().catch(() => undefined);
    this.closed = true;
  }

  private async ehlo(): Promise<void> {
    await this.command("EHLO omnidock.local", [250]);
  }

  private async command(
    command: string,
    expected: number[],
    timeoutMs = SMTP_COMMAND_TIMEOUT_MS,
    label = describeSmtpCommand(command)
  ): Promise<string[]> {
    await this.write(`${command}\r\n`, timeoutMs, label);
    return this.expect(expected, timeoutMs, label);
  }

  private async write(value: string, timeoutMs = SMTP_COMMAND_TIMEOUT_MS, label = "SMTP write"): Promise<void> {
    await this.withTimeout(this.writer.write(new TextEncoder().encode(value)), timeoutMs, label);
  }

  private async expect(expected: number[], timeoutMs = SMTP_COMMAND_TIMEOUT_MS, label = "SMTP response"): Promise<string[]> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.readLine(timeoutMs, label);
      lines.push(line);
      const code = Number.parseInt(line.slice(0, 3), 10);
      if (!line.startsWith(`${line.slice(0, 3)}-`)) {
        if (!expected.includes(code)) {
          throw new ApiError(502, "smtp_command_failed", sanitizeSmtpStatus(line));
        }
        return lines;
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

  private async readMore(timeoutMs: number, label: string): Promise<void> {
    const chunk = await this.withTimeout(this.reader.read(), timeoutMs, label);
    if (chunk.done || !chunk.value) {
      throw new ApiError(502, "smtp_connection_closed", "SMTP connection closed unexpectedly");
    }
    const merged = new Uint8Array(this.buffer.byteLength + chunk.value.byteLength);
    merged.set(this.buffer, 0);
    merged.set(chunk.value, this.buffer.byteLength);
    this.buffer = merged;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return withSmtpTimeout(promise, timeoutMs, label, () => this.forceClose());
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

function buildObjectKey(kind: "raw" | "attachments", mailbox: string, filename: string): string {
  const safeMailbox = mailbox.replace(/[^a-z0-9@._-]/gi, "_");
  const safeFilename = filename.replace(/[^a-z0-9._-]/gi, "_").slice(0, 128);
  const date = new Date().toISOString().slice(0, 10);
  return `${kind}/${date}/${safeMailbox}/${crypto.randomUUID()}-${safeFilename}`;
}

function buildMimeMessage(input: {
  from: string;
  fromName?: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  attachments: PreparedAttachment[];
}): string {
  const mixedBoundary = `omnidock-mixed-${crypto.randomUUID()}`;
  const alternativeBoundary = `omnidock-alt-${crypto.randomUUID()}`;
  const lines = [
    `From: ${formatAddress(input.from, input.fromName)}`,
    `To: ${input.to.map((address) => formatAddress(address)).join(", ")}`,
    input.cc.length > 0 ? `Cc: ${input.cc.map((address) => formatAddress(address)).join(", ")}` : "",
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Date: ${new Date().toUTCString()}`,
    ...Object.entries(input.headers).map(([key, value]) => `${key}: ${sanitizeHeaderValue(value)}`),
    input.attachments.length > 0
      ? `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`
      : `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    input.attachments.length > 0 ? `--${mixedBoundary}` : "",
    input.attachments.length > 0 ? `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"` : "",
    input.attachments.length > 0 ? "" : "",
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(base64Utf8(input.text || htmlToText(input.html))),
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(base64Utf8(input.html || textToHtml(input.text))),
    `--${alternativeBoundary}--`
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "");

  for (const attachment of input.attachments) {
    lines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${sanitizeHeaderValue(attachment.contentType)}; name="${escapeHeaderParam(attachment.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${escapeHeaderParam(attachment.filename)}"`,
      "",
      wrapBase64(bytesToBase64(attachment.content))
    );
  }

  if (input.attachments.length > 0) {
    lines.push(`--${mixedBoundary}--`);
  }

  return lines.filter((line) => line !== undefined).join("\r\n");
}

function formatAddress(email: string, name?: string | null): string {
  const cleanEmail = normalizeEmail(email);
  const cleanName = name?.trim();
  return cleanName ? `${encodeHeader(cleanName)} <${cleanEmail}>` : cleanEmail;
}

function encodeHeader(value: string): string {
  const clean = sanitizeHeaderValue(value);
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${base64Utf8(clean)}?=`;
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeHeaderParam(value: string): string {
  return sanitizeHeaderValue(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function wrapBase64(value: string): string {
  return value.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function base64Utf8(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function dotStuff(value: string): string {
  return value.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

function indexOfCrlf(bytes: Uint8Array): number {
  for (let index = 0; index < bytes.byteLength - 1; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) return index;
  }
  return -1;
}

async function withSmtpTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: () => void | Promise<void>
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      void onTimeout?.();
      reject(new ApiError(504, "smtp_timeout", `${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function describeSmtpCommand(command: string): string {
  const verb = command.trim().split(/\s+/, 1)[0]?.toUpperCase();
  if (!verb) return "SMTP command";
  if (verb === "AUTH") return "SMTP authentication";
  if (verb === "MAIL") return "SMTP sender";
  if (verb === "RCPT") return "SMTP recipient";
  return `SMTP ${verb}`;
}

function sanitizeSmtpStatus(value: string): string {
  return value.replace(/^\d{3}[ -]?/, "").slice(0, 220) || "SMTP command failed";
}

function externalCredential(env: RuntimeEnv, account: ExternalAccountRow): string {
  const secretName = (account.credential_secret_name || account.email).trim();
  const value = (env as unknown as Record<string, unknown>)[secretName];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(409, "external_secret_missing", `Add a Worker secret named ${secretName} with this account's app password.`);
  }
  return value.trim();
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
