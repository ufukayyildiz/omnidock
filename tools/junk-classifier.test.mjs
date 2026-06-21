import assert from "node:assert/strict";
import test from "node:test";
import { classifyJunkMail } from "../src/worker/junk.ts";

test("classifies explicit spam headers as junk", () => {
  const result = classifyJunkMail({
    headers: new Headers({
      "x-spam-flag": "YES",
      "x-spam-status": "Yes, score=8.2"
    }),
    subject: "Quarterly update"
  });

  assert.equal(result.junk, true);
  assert.ok(result.score >= 5);
  assert.ok(result.reasons.includes("x-spam-flag"));
});

test("keeps ordinary business mail out of junk", () => {
  const result = classifyJunkMail({
    headers: new Headers({
      "authentication-results": "mx.example.com; dkim=pass; spf=pass; dmarc=pass"
    }),
    subject: "Invoice approval",
    text: "Please review the attached invoice before tomorrow's operations meeting."
  });

  assert.equal(result.junk, false);
});

test("uses parsed headers when runtime headers are unavailable", () => {
  const result = classifyJunkMail({
    parsedHeaders: [
      { key: "x-spam-score", value: "6.4" },
      { key: "authentication-results", value: "mx; dmarc=fail; spf=fail" }
    ],
    subject: "Status"
  });

  assert.equal(result.junk, true);
  assert.ok(result.reasons.includes("spam-score"));
});
