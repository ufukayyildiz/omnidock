import assert from "node:assert/strict";
import test from "node:test";
import { readJson } from "../src/worker/http.ts";

function request(body, headers = {}) {
  return new Request("https://example.com/api/test", {
    method: "POST", body, headers: { "content-type": "application/json", ...headers }
  });
}

test("reads JSON split across UTF-8 chunks", async () => {
  const bytes = new TextEncoder().encode('{"name":"İstanbul"}');
  const stream = new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  }});
  const input = new Request("https://example.com", {
    method: "POST", body: stream, duplex: "half", headers: { "content-type": "application/json" }
  });
  assert.deepEqual(await readJson(input), { name: "İstanbul" });
});

test("rejects oversized bodies even with missing or false content-length", async () => {
  for (const headers of [{}, { "content-length": "1" }, { "content-length": "999" }]) {
    await assert.rejects(readJson(request('{"value":"too long"}', headers), 10), { status: 413 });
  }
});

test("cancels a chunked oversized body before reading the remainder", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(20)); },
    cancel() { cancelled = true; }
  });
  const input = new Request("https://example.com", {
    method: "POST", body: stream, duplex: "half", headers: { "content-type": "application/json" }
  });
  await assert.rejects(readJson(input, 10), { status: 413 });
  assert.equal(cancelled, true);
});

test("rejects invalid JSON, non-object JSON and incorrect media types", async () => {
  await assert.rejects(readJson(request('{')), { status: 400, code: "invalid_json" });
  await assert.rejects(readJson(request('[]')), { status: 400, code: "invalid_body" });
  await assert.rejects(readJson(request('{}', { "content-type": "text/plain" })), { status: 415 });
});
