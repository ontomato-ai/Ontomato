import assert from "node:assert/strict";
import test from "node:test";
import {
  addExpandedRowKey,
  isInteractiveRowClickTarget,
  matchesRowExpandedKey,
  normalizeExpandedKeys,
  removeExpandedRowAliases,
} from "../object-list-expand.ts";

test("normalizeExpandedKeys deduplicates, drops empty/non-string values, and honors single vs multiple mode", () => {
  assert.deepEqual(normalizeExpandedKeys(["a", "b", "a", "", 42, null], "multiple"), ["a", "b"]);
  assert.deepEqual(normalizeExpandedKeys(["a", "b", "c"], "single"), ["a"]);
  assert.deepEqual(normalizeExpandedKeys(null, "single"), []);
  assert.deepEqual(normalizeExpandedKeys(undefined, "multiple"), []);
});

test("matchesRowExpandedKey matches any row key alias", () => {
  const expanded = new Set(["row-2"]);
  assert.equal(matchesRowExpandedKey(expanded, ["ClassA:row-2", "row-2"]), true);
  assert.equal(matchesRowExpandedKey(expanded, ["ClassA:row-1", "row-1"]), false);
  assert.equal(matchesRowExpandedKey(new Set(), ["row-2"]), false);
});

test("addExpandedRowKey replaces prior keys in single mode and appends uniquely in multiple mode", () => {
  assert.deepEqual(
    addExpandedRowKey(["row-1"], "row-2", ["ClassA:row-2", "row-2"], "single"),
    ["row-2"],
  );
  assert.deepEqual(
    addExpandedRowKey(["row-1"], "row-2", ["ClassA:row-2", "row-2"], "multiple"),
    ["row-1", "row-2"],
  );
  assert.deepEqual(
    addExpandedRowKey(["row-1", "ClassA:row-2"], "row-2", ["ClassA:row-2", "row-2"], "multiple"),
    ["row-1", "ClassA:row-2"],
  );
});

test("removeExpandedRowAliases removes every alias belonging to the collapsed row", () => {
  assert.deepEqual(
    removeExpandedRowAliases(["row-1", "ClassA:row-2", "row-2", "row-3"], ["ClassA:row-2", "row-2"]),
    ["row-1", "row-3"],
  );
});

test("isInteractiveRowClickTarget safely returns false outside DOM environments or for null targets", () => {
  assert.equal(isInteractiveRowClickTarget(null, null), false);
  assert.equal(isInteractiveRowClickTarget({}, {}), false);
});
