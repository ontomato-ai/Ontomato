import assert from "node:assert/strict";
import test from "node:test";
import { extractSummaryKeyValueEntries, formatSummaryKvValue } from "../summary-key-value.ts";

const translate = (key) => {
  if (key === "platform.booleanTrue") return "Yes";
  if (key === "platform.booleanFalse") return "No";
  return key;
};

test("extractSummaryKeyValueEntries extracts JSON map objects and structured entry arrays", () => {
  const jsonMap = {
    kind: "json",
    value: {
      region: "East",
      year: 2026,
      active: true,
      channels: ["web", "app"],
      empty: null,
    },
  };

  assert.deepEqual(extractSummaryKeyValueEntries(jsonMap, translate), [
    { key: "region", value: "East" },
    { key: "year", value: "2026" },
    { key: "active", value: "Yes" },
    { key: "channels", value: "web, app" },
    { key: "empty", value: "—" },
  ]);

  assert.deepEqual(extractSummaryKeyValueEntries({ kind: "json", value: {} }, translate), []);

  const entryArray = {
    kind: "json",
    value: [
      { key: "startDate", label: "Start date", value: "2026-01-01" },
      { key: "includeArchived", value: false },
    ],
  };

  assert.deepEqual(extractSummaryKeyValueEntries(entryArray, translate), [
    { key: "Start date", value: "2026-01-01" },
    { key: "includeArchived", value: "No" },
  ]);
});

test("extractSummaryKeyValueEntries returns null for scalars, arrays, references, and localized strings", () => {
  assert.equal(extractSummaryKeyValueEntries(undefined, translate), null);
  assert.equal(extractSummaryKeyValueEntries("plain text", translate), null);
  assert.equal(extractSummaryKeyValueEntries(42, translate), null);
  assert.equal(extractSummaryKeyValueEntries(true, translate), null);
  assert.equal(extractSummaryKeyValueEntries(["tag1", "tag2"], translate), null);
  assert.equal(
    extractSummaryKeyValueEntries(
      { kind: "reference", className: "MetricView", primaryKey: "m-1", label: "GMV" },
      translate,
    ),
    null,
  );
  assert.equal(
    extractSummaryKeyValueEntries(
      {
        kind: "child-reference",
        parent: { objectType: "Dashboard", primaryKey: "d-1" },
        collection: "cards",
        primaryKey: "c-1",
        label: "Card 1",
      },
      translate,
    ),
    null,
  );
  assert.equal(
    extractSummaryKeyValueEntries({ kind: "localized", values: { en: "Hello" } }, translate),
    null,
  );
  assert.equal(extractSummaryKeyValueEntries({ kind: "json", value: ["a", "b"] }, translate), null);
  assert.equal(extractSummaryKeyValueEntries({ kind: "json", value: "scalar" }, translate), null);
});

test("formatSummaryKvValue handles empty arrays and nested objects cleanly", () => {
  assert.equal(formatSummaryKvValue([], translate), "—");
  assert.equal(formatSummaryKvValue("", translate), "—");
  assert.equal(formatSummaryKvValue({ min: 1, max: 5 }, translate), '{"min":1,"max":5}');
});
