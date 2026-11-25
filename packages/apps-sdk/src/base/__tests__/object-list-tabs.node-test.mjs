import assert from "node:assert/strict";
import test from "node:test";
import {
  computeRevealTabScrollLeft,
  computeTabScrollStep,
  resolveInlineRenameCommit,
  resolveInlineRenameFieldKey,
} from "../object-list-tabs.ts";

test("computeRevealTabScrollLeft reveals clipped left or right tabs without moving visible tabs", () => {
  // Already fully visible inside [100, 400]
  assert.equal(computeRevealTabScrollLeft(100, 300, 140, 120), 100);
  // Clipped past the left edge
  assert.equal(computeRevealTabScrollLeft(200, 300, 80, 120), 80);
  // Clipped past the right edge (tab spans [360, 480], viewport ends at 400 -> scroll to 180)
  assert.equal(computeRevealTabScrollLeft(100, 300, 360, 120), 180);
  // Zero viewport width keeps non-negative scrollLeft
  assert.equal(computeRevealTabScrollLeft(50, 0, 10, 100), 50);
});

test("computeTabScrollStep steps smoothly by the next clipped tab width", () => {
  const tabs = [
    { left: 0, width: 110 },
    { left: 114, width: 140 },
    { left: 258, width: 160 },
    { left: 422, width: 130 },
  ];

  // Viewport [0, 260]: third tab (width 160) is clipped on the right -> 160 + 4 gap
  assert.equal(computeTabScrollStep(tabs, 0, 260, 1, 4), 164);

  // Viewport [258, 518] aligned with tab 2: second tab (width 140) is clipped on the left -> 140 + 4 gap
  assert.equal(computeTabScrollStep(tabs, 258, 260, -1, 4), 144);
  // Viewport [260, 520]: third tab (left 258, width 160) is slightly clipped on the left -> 160 + 4 gap
  assert.equal(computeTabScrollStep(tabs, 260, 260, -1, 4), 164);

  // Fallback when tabs have no measurable width yet (e.g. headless layout)
  assert.equal(computeTabScrollStep([], 0, 400, 1, 4), 200);
  assert.equal(computeTabScrollStep([], 0, 180, -1, 4), 120);
});

test("resolveInlineRenameFieldKey honors explicit field or infers editable text parameter", () => {
  assert.equal(
    resolveInlineRenameFieldKey("customTitle", [{ name: "name", kind: "text" }]),
    "customTitle",
  );
  assert.equal(
    resolveInlineRenameFieldKey(undefined, [{ name: "title", kind: "text" }]),
    "title",
  );
  assert.equal(
    resolveInlineRenameFieldKey(undefined, [
      { name: "note", kind: "textarea" },
      { name: "name", kind: "text" },
    ]),
    "name",
  );
  assert.equal(
    resolveInlineRenameFieldKey(undefined, [
      { name: "count", kind: "integer" },
      { name: "alias", kind: "text" },
    ]),
    "alias",
  );
  assert.equal(resolveInlineRenameFieldKey(undefined, []), null);
});

test("resolveInlineRenameCommit trims changes and cancels blank or unchanged drafts", () => {
  assert.deepEqual(resolveInlineRenameCommit("  Q4 Revenue  ", "Q3 Revenue"), {
    kind: "commit",
    value: "Q4 Revenue",
  });
  assert.deepEqual(resolveInlineRenameCommit("  Q3 Revenue ", "Q3 Revenue"), {
    kind: "cancel",
  });
  assert.deepEqual(resolveInlineRenameCommit("   ", "Q3 Revenue"), {
    kind: "cancel",
  });
});
