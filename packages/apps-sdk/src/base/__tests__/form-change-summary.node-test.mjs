import assert from "node:assert/strict";
import test from "node:test";
import { collectFormChangeSummary } from "../form-change-summary.ts";

const translate = (key) => {
  if (key === "platform.booleanTrue") return "Yes";
  if (key === "platform.booleanFalse") return "No";
  return key;
};

test("collectFormChangeSummary lists edited editable fields with option labels, booleans, and placeholders", () => {
  const fields = [
    { path: "/region", label: "Region", control: { kind: "select", options: [{ value: "east", label: "East" }, { value: "west", label: "West" }] } },
    { path: "/limit", label: "Row limit", control: { kind: "number" } },
    { path: "/enabled", label: "Enabled", control: { kind: "switch" } },
    { path: "/note", label: "Note", control: { kind: "text" } },
    { path: "/locked", label: "Locked", readOnly: true, control: { kind: "text" } },
    { path: "/internalId", label: "Internal", control: { kind: "hidden" } },
  ];

  const before = { region: "east", limit: 10, enabled: false, note: "", locked: "a", internalId: "1" };
  const after = { region: "west", limit: 25, enabled: true, note: "Updated", locked: "b", internalId: "2" };

  assert.deepEqual(collectFormChangeSummary(fields, before, after, { translate }), [
    { path: "/region", label: "Region", from: "East", to: "West" },
    { path: "/limit", label: "Row limit", from: "10", to: "25" },
    { path: "/enabled", label: "Enabled", from: "No", to: "Yes" },
    { path: "/note", label: "Note", from: "—", to: "Updated" },
  ]);

  // Reverting values back to baseline produces an empty summary.
  assert.deepEqual(collectFormChangeSummary(fields, before, { ...before }, { translate }), []);
});

test("collectFormChangeSummary expands nested object fields and masks secret fields", () => {
  const fields = [
    {
      path: "/query",
      label: "Query",
      control: {
        kind: "object",
        fields: [
          { path: "/dateRange", label: "Date range", control: { kind: "text" } },
          { path: "/tags", label: "Tags", control: { kind: "text" } },
        ],
      },
    },
    {
      path: "/apiKey",
      label: "API Key",
      control: { kind: "text" },
    },
    {
      path: "/title",
      label: "Title",
      control: { kind: "localized-text" },
    },
  ];

  const before = {
    query: { dateRange: "7d", tags: ["a"] },
    apiKey: "old-secret",
    title: { en: "Sales", "zh-CN": "销售" },
  };
  const after = {
    query: { dateRange: "30d", tags: ["a", "b"] },
    apiKey: "new-secret",
    title: { en: "Revenue", "zh-CN": "营收" },
  };

  assert.deepEqual(
    collectFormChangeSummary(fields, before, after, {
      locale: "zh-CN",
      secretPaths: new Set(["/apiKey"]),
      translate,
    }),
    [
      { path: "/query/dateRange", label: "Query · Date range", from: "7d", to: "30d" },
      { path: "/query/tags", label: "Query · Tags", from: "a", to: "a, b" },
      { path: "/apiKey", label: "API Key", from: "••••••", to: "••••••" },
      { path: "/title", label: "Title", from: "销售", to: "营收" },
    ],
  );
});
