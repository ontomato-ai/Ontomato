import assert from "node:assert/strict";
import test from "node:test";
import { filterVisibleColumns, toggleColumnKeyVisibility } from "../object-list-dynamic.ts";
import { filterResponsiveColumns } from "../object-list-responsive.ts";

const sampleColumns = [
  { key: "name" },
  { key: "status", minContainerWidth: 520 },
  { key: "owner", minContainerWidth: 720 },
  { key: "updatedAt", minContainerWidth: 960 },
];

test("filterResponsiveColumns keeps all columns when container width is unmeasured (<= 0)", () => {
  assert.deepEqual(
    filterResponsiveColumns(sampleColumns, 0).map((col) => col.key),
    ["name", "status", "owner", "updatedAt"],
  );
  assert.deepEqual(
    filterResponsiveColumns(sampleColumns, -10).map((col) => col.key),
    ["name", "status", "owner", "updatedAt"],
  );
});

test("filterResponsiveColumns hides columns above threshold and restores them as container widens", () => {
  assert.deepEqual(
    filterResponsiveColumns(sampleColumns, 400).map((col) => col.key),
    ["name"],
  );
  assert.deepEqual(
    filterResponsiveColumns(sampleColumns, 520).map((col) => col.key),
    ["name", "status"],
  );
  assert.deepEqual(
    filterResponsiveColumns(sampleColumns, 800).map((col) => col.key),
    ["name", "status", "owner"],
  );
  assert.deepEqual(
    filterResponsiveColumns(sampleColumns, 1024).map((col) => col.key),
    ["name", "status", "owner", "updatedAt"],
  );
});

test("filterResponsiveColumns always preserves at least one column when all thresholds exceed container width", () => {
  const gatedColumns = [
    { key: "description", minContainerWidth: 900 },
    { key: "title", minContainerWidth: 480 },
    { key: "meta", minContainerWidth: 640 },
  ];
  assert.deepEqual(
    filterResponsiveColumns(gatedColumns, 320).map((col) => col.key),
    ["title"],
  );

  const tiedColumns = [
    { key: "first", minContainerWidth: 600 },
    { key: "second", minContainerWidth: 600 },
  ];
  assert.deepEqual(
    filterResponsiveColumns(tiedColumns, 300).map((col) => col.key),
    ["first"],
  );
});

test("filterResponsiveColumns composes safely with manual column visibility toggles", () => {
  const responsiveAt800 = filterResponsiveColumns(sampleColumns, 800);
  let hidden = new Set();
  hidden = toggleColumnKeyVisibility(responsiveAt800, hidden, "owner", false);
  assert.deepEqual(
    filterVisibleColumns(responsiveAt800, hidden).map((col) => col.key),
    ["name", "status"],
  );
  // Narrowing further keeps at least one visible column even if remaining responsive columns were manually hidden.
  hidden = toggleColumnKeyVisibility(responsiveAt800, hidden, "name", false);
  const responsiveAt400 = filterResponsiveColumns(sampleColumns, 400);
  assert.deepEqual(
    filterVisibleColumns(responsiveAt400, hidden).map((col) => col.key),
    ["name"],
  );
  // Widening restores responsive-eligible columns while respecting manual hides.
  const responsiveAt1024 = filterResponsiveColumns(sampleColumns, 1024);
  assert.deepEqual(
    filterVisibleColumns(responsiveAt1024, hidden).map((col) => col.key),
    ["status", "updatedAt"],
  );
});
