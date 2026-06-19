import type { Attachment } from "postal-mime";

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENT_COUNT = 10;

export type InboundAttachmentSkipReason = "too_many_attachments" | "attachment_too_large" | "attachments_too_large";

export type PreparedInboundAttachment = {
  filename: string;
  contentType: string;
  content: Attachment["content"];
  size: number;
  disposition: Attachment["disposition"];
  contentId: string | null;
};

export type InboundAttachmentLimitResult = {
  accepted: PreparedInboundAttachment[];
  skipped: number;
  skippedBytes: number;
  skippedReasons: Partial<Record<InboundAttachmentSkipReason, number>>;
};

export function limitInboundAttachments(attachments: Attachment[]): InboundAttachmentLimitResult {
  const result: InboundAttachmentLimitResult = {
    accepted: [],
    skipped: 0,
    skippedBytes: 0,
    skippedReasons: {}
  };
  let totalBytes = 0;

  for (const attachment of attachments) {
    const filename = attachment.filename || "attachment";
    const contentType = attachment.mimeType || "application/octet-stream";
    const content = attachment.content;
    const size = attachmentContentByteLength(content);
    const reason = inboundAttachmentSkipReason(result.accepted.length, totalBytes, size);

    if (reason) {
      result.skipped += 1;
      result.skippedBytes += size;
      result.skippedReasons[reason] = (result.skippedReasons[reason] ?? 0) + 1;
      continue;
    }

    totalBytes += size;
    result.accepted.push({
      filename,
      contentType,
      content,
      size,
      disposition: attachment.disposition ?? null,
      contentId: attachment.contentId ?? null
    });
  }

  return result;
}

function inboundAttachmentSkipReason(
  acceptedCount: number,
  acceptedBytes: number,
  candidateBytes: number
): InboundAttachmentSkipReason | null {
  if (acceptedCount >= MAX_ATTACHMENT_COUNT) {
    return "too_many_attachments";
  }
  if (candidateBytes > MAX_ATTACHMENT_BYTES) {
    return "attachment_too_large";
  }
  if (acceptedBytes + candidateBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return "attachments_too_large";
  }
  return null;
}

function attachmentContentByteLength(content: Attachment["content"]): number {
  if (typeof content === "string") {
    return new TextEncoder().encode(content).byteLength;
  }
  return content.byteLength;
}
