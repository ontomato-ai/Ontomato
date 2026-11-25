import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOperationInputInitialValues,
  resolveRowOperationPrefill,
  resolveRowPrefillSource,
} from "../operation-prefill.ts";

const sampleRow = {
  primaryKey: "card-1",
  className: "platform:DashboardCard",
  label: "Monthly Revenue",
  subtitle: "Metric view",
  fields: {
    title: "Monthly Revenue (Q4)",
    colSpan: 6,
    pinned: true,
    owner: { kind: "reference", className: "User", primaryKey: "u-1", label: "Alice" },
    displayName: { kind: "localized", values: { en: "Revenue", "zh-CN": "营收" } },
    meta: { kind: "json", value: "compact" },
  },
};

const fields = [
  { name: "name", label: "Name", kind: "text", required: true, defaultValue: undefined },
  { name: "colSpan", label: "Columns", kind: "integer", required: false, defaultValue: 4 },
  { name: "pinned", label: "Pinned", kind: "boolean", required: false, defaultValue: false },
  { name: "mode", label: "Mode", kind: "select", required: false, defaultValue: "full" },
  { name: "secretToken", label: "Token", kind: "password", required: false, defaultValue: undefined },
];

test("resolveRowPrefillSource reads top-level properties, fields.<key>, references, and wrapped values", () => {
  assert.equal(resolveRowPrefillSource(sampleRow, "label"), "Monthly Revenue");
  assert.equal(resolveRowPrefillSource(sampleRow, "primaryKey"), "card-1");
  assert.equal(resolveRowPrefillSource(sampleRow, "subtitle"), "Metric view");
  assert.equal(resolveRowPrefillSource(sampleRow, "fields.title"), "Monthly Revenue (Q4)");
  assert.equal(resolveRowPrefillSource(sampleRow, "colSpan"), 6);
  assert.equal(resolveRowPrefillSource(sampleRow, "fields.owner"), "Alice");
  assert.equal(resolveRowPrefillSource(sampleRow, "fields.displayName"), "Revenue");
  assert.equal(resolveRowPrefillSource(sampleRow, "fields.meta"), "compact");
  assert.equal(resolveRowPrefillSource(sampleRow, "fields.missing"), undefined);
});

test("resolveRowOperationPrefill supports explicit mappings, boolean auto-match, and excludes password fields", () => {
  assert.deepEqual(resolveRowOperationPrefill(sampleRow, fields, undefined), {});
  assert.deepEqual(resolveRowOperationPrefill(sampleRow, fields, false), {});

  assert.deepEqual(resolveRowOperationPrefill(sampleRow, fields, true), {
    name: "Monthly Revenue",
    colSpan: 6,
    pinned: true,
  });

  assert.deepEqual(
    resolveRowOperationPrefill(sampleRow, fields, {
      name: "fields.title",
      mode: "fields.meta",
      secretToken: "label",
      unknown: "label",
    }),
    {
      name: "Monthly Revenue (Q4)",
      mode: "compact",
    },
  );
});

test("applyOperationInputInitialValues overlays initial values by field kind without prefilling passwords", () => {
  const baseDraft = {
    name: "",
    colSpan: "4",
    pinned: false,
    mode: "full",
    secretToken: "",
  };

  const merged = applyOperationInputInitialValues(fields, baseDraft, {
    name: "Monthly Revenue",
    colSpan: 6,
    pinned: true,
    mode: "compact",
    secretToken: "should-not-prefill",
  });

  assert.deepEqual(merged, {
    name: "Monthly Revenue",
    colSpan: "6",
    pinned: true,
    mode: "compact",
    secretToken: "",
  });
});
