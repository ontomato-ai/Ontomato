import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCsvContent,
  collectDynamicFieldLabels,
  columnSchemaKey,
  deriveDynamicColumns,
  escapeCsvCell,
  filterVisibleColumns,
  resolveCsvFileName,
  toggleColumnKeyVisibility,
} from "../object-list-dynamic.ts";

function record(overrides) {
  return {
    fields: {},
    ...overrides,
  };
}

test("deriveDynamicColumns orders by fieldLabels then fields and excludes array-valued columns", () => {
  const rows = [
    record({
      primaryKey: "r-1",
      label: "Alpha",
      fieldLabels: {
        name: "Name",
        status: "Status",
        tagsList: "Tags",
        owner: "Owner",
      },
      fields: {
        extra: "Extra value",
        name: "Alpha",
        status: "active",
        tagsList: ["vip", "west"],
        owner: { kind: "reference", className: "User", primaryKey: "u-1", label: "Alice" },
      },
    }),
    record({
      primaryKey: "r-2",
      label: "Beta",
      fields: {
        name: "Beta",
        status: "draft",
        laterField: 42,
        extra: "Second",
        maybeArray: ["a"],
      },
    }),
  ];

  assert.deepEqual(deriveDynamicColumns(rows), [
    { key: "name" },
    { key: "status" },
    { key: "owner" },
    { key: "extra" },
    { key: "laterField" },
  ]);
  assert.deepEqual(collectDynamicFieldLabels(rows), {
    name: "Name",
    status: "Status",
    tagsList: "Tags",
    owner: "Owner",
  });
});

test("deriveDynamicColumns returns empty for empty rows and falls back to label when all fields are arrays", () => {
  assert.deepEqual(deriveDynamicColumns([]), []);

  const arrayOnlyRows = [
    record({
      primaryKey: "r-1",
      label: "Only arrays",
      fieldLabels: { items: "Items" },
      fields: { items: ["one", "two"] },
    }),
  ];
  assert.deepEqual(deriveDynamicColumns(arrayOnlyRows), [{ key: "label" }]);
});

test("filterVisibleColumns and toggleColumnKeyVisibility keep at least one column visible", () => {
  const columns = [{ key: "a" }, { key: "b" }, { key: "c" }];
  let hidden = new Set();

  hidden = toggleColumnKeyVisibility(columns, hidden, "b", false);
  assert.deepEqual(filterVisibleColumns(columns, hidden).map((c) => c.key), ["a", "c"]);

  hidden = toggleColumnKeyVisibility(columns, hidden, "c", false);
  assert.deepEqual(filterVisibleColumns(columns, hidden).map((c) => c.key), ["a"]);

  // Attempting to hide the last remaining column is ignored.
  const unchanged = toggleColumnKeyVisibility(columns, hidden, "a", false);
  assert.equal(unchanged, hidden);
  assert.deepEqual(filterVisibleColumns(columns, unchanged).map((c) => c.key), ["a"]);

  // Even if every key is somehow in hiddenKeys, filterVisibleColumns keeps the first column.
  assert.deepEqual(
    filterVisibleColumns(columns, new Set(["a", "b", "c"])).map((c) => c.key),
    ["a"],
  );

  // Re-showing a hidden column restores it in its original order.
  hidden = toggleColumnKeyVisibility(columns, hidden, "b", true);
  assert.deepEqual(filterVisibleColumns(columns, hidden).map((c) => c.key), ["a", "b"]);
});

test("columnSchemaKey distinguishes column sets across object classes", () => {
  const classA = columnSchemaKey([{ key: "code" }, { key: "name" }]);
  const classASame = columnSchemaKey([{ key: "code" }, { key: "name" }]);
  const classB = columnSchemaKey([{ key: "orderNo" }, { key: "amount" }]);
  assert.equal(classA, classASame);
  assert.notEqual(classA, classB);
});

test("escapeCsvCell and buildCsvContent follow RFC 4180 with UTF-8 BOM", () => {
  assert.equal(escapeCsvCell("plain"), "plain");
  assert.equal(escapeCsvCell("a,b"), '"a,b"');
  assert.equal(escapeCsvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(escapeCsvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(escapeCsvCell("line1\r\nline2"), '"line1\r\nline2"');

  const csv = buildCsvContent(
    ["名称", "Note, with comma"],
    [
      ["客户 A", 'Quote "1"\nNext line'],
      ["客户 B", "Simple"],
    ],
  );
  assert.ok(csv.startsWith("\uFEFF"));
  assert.equal(
    csv,
    '\uFEFF名称,"Note, with comma"\r\n客户 A,"Quote ""1""\nNext line"\r\n客户 B,Simple',
  );
});

test("resolveCsvFileName normalizes custom names and formats dated default", () => {
  const fixedDate = new Date(2026, 10, 5); // 2026-11-05 local
  assert.equal(resolveCsvFileName(undefined, fixedDate), "records-2026-11-05.csv");
  assert.equal(resolveCsvFileName("   ", fixedDate), "records-2026-11-05.csv");
  assert.equal(resolveCsvFileName("customers", fixedDate), "customers.csv");
  assert.equal(resolveCsvFileName("customers.CSV", fixedDate), "customers.csv");
  assert.equal(resolveCsvFileName("../dir/sub\\report\u0000name", fixedDate), "-dir-sub-report-name.csv");
  assert.equal(resolveCsvFileName("... .csv", fixedDate), "records-2026-11-05.csv");
  assert.equal(resolveCsvFileName("a".repeat(300), fixedDate).length, 255);
  assert.ok(resolveCsvFileName("a".repeat(300), fixedDate).endsWith(".csv"));
});
