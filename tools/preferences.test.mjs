import assert from "node:assert/strict";
import test from "node:test";
import { parseRefreshInterval, readPreference, writePreference } from "../src/ui/preferences.ts";

test("new installations use the default refresh interval while explicit zero disables refresh", () => {
  assert.equal(parseRefreshInterval(null), 10);
  assert.equal(parseRefreshInterval(""), 10);
  assert.equal(parseRefreshInterval("0"), 0);
  assert.equal(parseRefreshInterval("30"), 30);
});

test("invalid stored refresh intervals fall back and valid values stay within UI limits", () => {
  for (const value of ["invalid", "NaN", "Infinity", "-1"]) assert.equal(parseRefreshInterval(value), 10);
  assert.equal(parseRefreshInterval("301"), 300);
  assert.equal(parseRefreshInterval("10.5"), 11);
});

test("denied browser storage does not crash the workspace", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage denied"); } });
  try {
    assert.equal(readPreference("key"), null);
    assert.doesNotThrow(() => writePreference("key", "value"));
    assert.doesNotThrow(() => writePreference("key", null));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});
