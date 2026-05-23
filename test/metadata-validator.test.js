import test from "node:test";
import assert from "node:assert/strict";

import { validateVideoMetadata } from "../src/services/metadata-validator.js";

test("returns ok=true for a minimal valid payload", () => {
  const result = validateVideoMetadata({ title: "My short" });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("returns ok=true with description and tags within limits", () => {
  const result = validateVideoMetadata({
    title: "Hello",
    description: "A short description.",
    tags: ["funny", "ai"],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("flags missing title", () => {
  const r1 = validateVideoMetadata({ description: "x" });
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => e.includes("title is required")));

  const r2 = validateVideoMetadata({ title: "   " });
  assert.equal(r2.ok, false);
});

test("flags non-string title", () => {
  const r = validateVideoMetadata({ title: 42 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("title must be a string")));
});

test("flags title longer than 100 chars", () => {
  const r = validateVideoMetadata({ title: "x".repeat(101) });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("title exceeds 100 characters")));
});

test("title length exactly 100 passes", () => {
  const r = validateVideoMetadata({ title: "x".repeat(100) });
  assert.equal(r.ok, true);
});

test("flags description longer than 5000 chars", () => {
  const r = validateVideoMetadata({
    title: "ok",
    description: "x".repeat(5001),
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("description exceeds 5000")));
});

test("flags non-array tags", () => {
  const r = validateVideoMetadata({ title: "ok", tags: "funny" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("tags must be an array")));
});

test("flags tag count over limit (default 500)", () => {
  const tags = Array.from({ length: 501 }, (_, i) => `tag${i}`);
  const r = validateVideoMetadata({ title: "ok", tags });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("tags exceeds 500 entries")));
});

test("flags individual tag too long", () => {
  const r = validateVideoMetadata({
    title: "ok",
    tags: ["short", "x".repeat(101)],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("tags[1] exceeds 100 characters")));
});

test("non-object metadata fails fast", () => {
  const r = validateVideoMetadata(null);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ["metadata must be an object"]);
});

test("custom limits override defaults", () => {
  const r = validateVideoMetadata(
    { title: "abcdef" },
    { maxTitle: 5 },
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("title exceeds 5")));
});

test("accumulates multiple errors", () => {
  const r = validateVideoMetadata({
    title: "x".repeat(200),
    description: "y".repeat(5001),
    tags: ["ok", 42],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 3);
});
