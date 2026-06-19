import assert from "node:assert/strict";
import test from "node:test";
import {
  limitInboundAttachments,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT
} from "../src/worker/attachment-limits.ts";

function attachment(size, filename = "attachment.bin") {
  return {
    filename,
    mimeType: "application/octet-stream",
    disposition: "attachment",
    content: new Uint8Array(size)
  };
}

test("accepts inbound attachments within count and byte limits", () => {
  const result = limitInboundAttachments([attachment(1024, "a.txt"), attachment(2048, "b.txt")]);

  assert.equal(result.accepted.length, 2);
  assert.equal(result.accepted[0].size, 1024);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.skippedReasons, {});
});

test("skips inbound attachments after the attachment count limit", () => {
  const result = limitInboundAttachments(
    Array.from({ length: MAX_ATTACHMENT_COUNT + 1 }, (_, index) => attachment(1, `${index}.txt`))
  );

  assert.equal(result.accepted.length, MAX_ATTACHMENT_COUNT);
  assert.equal(result.skipped, 1);
  assert.equal(result.skippedReasons.too_many_attachments, 1);
});

test("skips inbound attachments larger than the per-attachment limit", () => {
  const result = limitInboundAttachments([attachment(MAX_ATTACHMENT_BYTES + 1)]);

  assert.equal(result.accepted.length, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.skippedReasons.attachment_too_large, 1);
});

test("skips inbound attachments that would exceed the total byte limit", () => {
  const result = limitInboundAttachments([
    attachment(MAX_ATTACHMENT_BYTES, "first.bin"),
    attachment(MAX_ATTACHMENT_BYTES, "second.bin"),
    attachment(5 * 1024 * 1024, "third.bin")
  ]);

  assert.equal(result.accepted.length, 2);
  assert.equal(result.accepted[0].filename, "first.bin");
  assert.equal(result.accepted[1].filename, "second.bin");
  assert.equal(result.skipped, 1);
  assert.equal(result.skippedReasons.attachments_too_large, 1);
});
