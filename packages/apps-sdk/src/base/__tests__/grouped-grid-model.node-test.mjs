import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGroupedGridGroups,
  buildLayoutChangePayload,
  moveGridItem,
  reorderGridGroups,
  resizeGridItem,
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
