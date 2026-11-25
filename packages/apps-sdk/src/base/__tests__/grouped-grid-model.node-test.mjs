import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGroupedGridGroups,
  buildLayoutChangePayload,
  buildStaticGroupedGridState,
  moveGridItem,
  reorderGridGroups,
  resizeGridItem,
  serializeStaticGridLayout,
  setStaticGridItemHidden,
} from "../grouped-grid-model.ts";

function makeItem(id, groupId, extras = {}) {
  return {
    primaryKey: id,
    className: "test:Item",
    label: extras.label ?? `Item ${id}`,
    fields: {
      groupId,
      groupTitle: extras.groupTitle ?? `Group ${groupId}`,
      colSpan: extras.colSpan ?? 6,
      rowSpan: extras.rowSpan ?? 2,
      order: extras.order ?? 0,
      ...(extras.section ? { section: extras.section } : {}),
    },
  };
}

function makeContainer(groups) {
  return {
    primaryKey: "board-1",
    className: "test:Board",
    label: "Board 1",
    fields: {
      groups: {
        kind: "json",
        value: groups,
      },
    },
  };
}

test("buildGroupedGridGroups preserves empty groups and ordering from container record", () => {
  const container = makeContainer([
    { id: "g2", title: "Second Group", order: 1 },
    { id: "g1", title: "First Group", order: 0 },
    { id: "g-empty", title: "Empty Group", order: 2 },
  ]);
  const rows = [
    makeItem("a", "g2", { order: 1, colSpan: 4, rowSpan: 1 }),
    makeItem("b", "g2", { order: 0, colSpan: 8, rowSpan: 2 }),
    makeItem("c", "g1", { order: 0, colSpan: 99, rowSpan: 0 }),
  ];

  const groups = buildGroupedGridGroups({
    record: container,
    rows,
    rowObjectType: "test:Item",
    columns: 12,
    minColSpan: 2,
    maxColSpan: 12,
    minRowSpan: 1,
    maxRowSpan: 6,
    groupsField: "groups",
    groupKeyField: "groupId",
    groupTitleField: "groupTitle",
    colSpanField: "colSpan",
    rowSpanField: "rowSpan",
    orderField: "order",
  });

  assert.deepEqual(
    groups.map((g) => ({ id: g.id, title: g.title, count: g.items.length })),
    [
      { id: "g1", title: "First Group", count: 1 },
      { id: "g2", title: "Second Group", count: 2 },
      { id: "g-empty", title: "Empty Group", count: 0 },
    ],
  );
  // Clamping and sorting within groups
  assert.equal(groups[0].items[0].colSpan, 12);
  assert.equal(groups[0].items[0].rowSpan, 1);
  assert.deepEqual(groups[1].items.map((i) => i.primaryKey), ["b", "a"]);
});

test("buildGroupedGridGroups partitions items into ordered section tracks", () => {
  const rows = [
    makeItem("c1", "g1", { section: "visual", order: 0 }),
    makeItem("k1", "g1", { section: "summary", order: 1 }),
    makeItem("k2", "g1", { section: "summary", order: 0 }),
  ];

  const groups = buildGroupedGridGroups({
    record: null,
    rows,
    rowObjectType: "test:Item",
    columns: 12,
    minColSpan: 2,
    maxColSpan: 12,
    minRowSpan: 1,
    maxRowSpan: 6,
    groupsField: "groups",
    groupKeyField: "groupId",
    groupTitleField: "groupTitle",
    sectionField: "section",
    sectionOrder: ["summary", "visual"],
    colSpanField: "colSpan",
    rowSpanField: "rowSpan",
    orderField: "order",
  });

  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].sections.map((s) => ({ key: s.key, ids: s.items.map((i) => i.primaryKey) })),
    [
      { key: "summary", ids: ["k2", "k1"] },
      { key: "visual", ids: ["c1"] },
    ],
  );
});

test("reorderGridGroups, moveGridItem, and resizeGridItem produce deterministic layout payloads", () => {
  const container = makeContainer([
    { id: "g1", title: "Alpha", order: 0 },
    { id: "g2", title: "Beta", order: 1 },
    { id: "g3", title: "Empty", order: 2 },
  ]);
  const rows = [
    makeItem("a", "g1", { order: 0, colSpan: 6, rowSpan: 2 }),
    makeItem("b", "g1", { order: 1, colSpan: 6, rowSpan: 2 }),
    makeItem("c", "g2", { order: 0, colSpan: 12, rowSpan: 2 }),
  ];

  const initial = buildGroupedGridGroups({
    record: container,
    rows,
    rowObjectType: "test:Item",
    columns: 12,
    minColSpan: 2,
    maxColSpan: 12,
    minRowSpan: 1,
    maxRowSpan: 6,
    groupsField: "groups",
    groupKeyField: "groupId",
    groupTitleField: "groupTitle",
    colSpanField: "colSpan",
    rowSpanField: "rowSpan",
    orderField: "order",
  });

  // Reorder group g2 before g1
  const reordered = reorderGridGroups(initial, "g2", "g1", "before");
  assert.ok(reordered);
  assert.deepEqual(reordered.map((g) => g.id), ["g2", "g1", "g3"]);

  // Move item 'a' into empty group 'g3'
  const moved = moveGridItem(reordered, "test:Item:a", "g3");
  assert.ok(moved);
  assert.deepEqual(
    moved.map((g) => ({ id: g.id, ids: g.items.map((i) => i.primaryKey) })),
    [
      { id: "g2", ids: ["c"] },
      { id: "g1", ids: ["b"] },
      { id: "g3", ids: ["a"] },
    ],
  );

  // Resize item 'a'
  const resized = resizeGridItem(moved, "test:Item:a", 8, 3);
  assert.ok(resized);
  const payload = buildLayoutChangePayload(resized);
  assert.equal(payload.groups[2].items[0].colSpan, 8);
  assert.equal(payload.groups[2].items[0].rowSpan, 3);
  assert.deepEqual(payload.groups[2].items[0].ref, { className: "test:Item", primaryKey: "a" });

  // No-op resize returns null
  assert.equal(resizeGridItem(resized, "test:Item:a", 8, 3), null);
});

test("buildStaticGroupedGridState merges saved layout, preserves hidden items, drops stale IDs, and appends new items", () => {
  const groups = [
    { id: "primary", title: "Primary" },
    { id: "secondary", title: "Secondary" },
  ];
  const items = [
    { id: "alpha", title: "Alpha", groupId: "primary", colSpan: 6, rowSpan: 2, minColSpan: 3, maxColSpan: 8 },
    { id: "beta", title: "Beta", groupId: "primary", colSpan: 6, rowSpan: 2 },
    { id: "gamma", title: "Gamma", groupId: "secondary", colSpan: 12, rowSpan: 2 },
    { id: "delta", titleKey: "blocks.delta", title: "Delta Fallback", groupId: "secondary", colSpan: 4, rowSpan: 1 },
  ];
  const savedLayout = {
    groups: [
      {
        id: "secondary",
        items: [
          { id: "stale-removed", colSpan: 6, rowSpan: 2 },
          { id: "gamma", colSpan: 8, rowSpan: 3 },
        ],
      },
      {
        id: "primary",
        items: [
          { id: "beta", colSpan: 4, rowSpan: 2, hidden: true },
          { id: "alpha", colSpan: 12, rowSpan: 9 },
        ],
      },
    ],
  };

  const built = buildStaticGroupedGridState({
    items,
    groups,
    layout: savedLayout,
    columns: 12,
    minColSpan: 2,
    maxColSpan: 12,
    minRowSpan: 1,
    maxRowSpan: 6,
    resolveTitle: (entry) => (entry.titleKey === "blocks.delta" ? "Delta Translated" : (entry.title ?? entry.id)),
  });

  // Saved group order is respected, stale ID is dropped, delta is appended to secondary
  assert.deepEqual(built.visibleGroups.map((g) => g.id), ["secondary", "primary"]);
  assert.deepEqual(
    built.visibleGroups.map((g) => g.items.map((i) => ({ id: i.itemId, title: i.title, colSpan: i.colSpan, rowSpan: i.rowSpan }))),
    [
      [
        { id: "gamma", title: "Gamma", colSpan: 8, rowSpan: 3 },
        { id: "delta", title: "Delta Translated", colSpan: 4, rowSpan: 1 },
      ],
      [
        // beta is omitted from visibleGroups; alpha is clamped to maxColSpan=8 and grid maxRowSpan=6
        { id: "alpha", title: "Alpha", colSpan: 8, rowSpan: 6 },
      ],
    ],
  );
  assert.equal(built.hiddenCount, 1);
  // Synthetic record and itemRef use grid:item
  assert.deepEqual(built.visibleGroups[1].items[0].itemRef, { className: "grid:item", primaryKey: "alpha" });
  assert.equal(built.visibleGroups[1].items[0].row.label, "Alpha");
  // Full layoutState preserves hidden beta at index 0 of primary with its span
  assert.deepEqual(built.layoutState.groups[1].items, [
    { id: "beta", colSpan: 4, rowSpan: 2, hidden: true },
    { id: "alpha", colSpan: 8, rowSpan: 6 },
  ]);
});

test("serializeStaticGridLayout and setStaticGridItemHidden preserve hidden item order and spans across edits", () => {
  const items = [
    { id: "a", title: "A", colSpan: 4, rowSpan: 2 },
    { id: "b", title: "B", colSpan: 4, rowSpan: 2 },
    { id: "c", title: "C", colSpan: 4, rowSpan: 2 },
  ];

  const initial = buildStaticGroupedGridState({
    items,
    layout: {
      groups: [
        {
          id: "main",
          items: [
            { id: "a", colSpan: 4, rowSpan: 2 },
            { id: "b", colSpan: 5, rowSpan: 3, hidden: true },
            { id: "c", colSpan: 4, rowSpan: 2 },
          ],
        },
      ],
    },
    columns: 12,
    minColSpan: 2,
    maxColSpan: 12,
    minRowSpan: 1,
    maxRowSpan: 6,
  });

  // Reorder c before a among visible items, then serialize: hidden b stays at index 1 with 5x3 span
  const reordered = moveGridItem(initial.visibleGroups, "grid:item:c", "main", {
    targetItemKey: "grid:item:a",
    position: "before",
  });
  assert.ok(reordered);
  const serialized = serializeStaticGridLayout(reordered, initial.layoutState, items);
  assert.deepEqual(serialized, {
    groups: [
      {
        id: "main",
        items: [
          { id: "c", colSpan: 4, rowSpan: 2 },
          { id: "b", colSpan: 5, rowSpan: 3, hidden: true },
          { id: "a", colSpan: 4, rowSpan: 2 },
        ],
      },
    ],
  });

  // Hide 'a' and unhide 'b' via setStaticGridItemHidden
  const afterHide = setStaticGridItemHidden(serialized, "a", true);
  assert.equal(afterHide.groups[0].items[2].hidden, true);
  const afterUnhide = setStaticGridItemHidden(afterHide, "b", false);
  assert.equal(afterUnhide.groups[0].items[1].hidden, undefined);
  assert.equal(afterUnhide.groups[0].items[1].colSpan, 5);
  assert.equal(afterUnhide.groups[0].items[1].rowSpan, 3);
});
