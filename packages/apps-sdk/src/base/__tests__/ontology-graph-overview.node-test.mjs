import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAggregatedOverviewEdges,
  isLargeGraph,
  isOverviewGroupAnchorId,
  layoutGrid,
  layoutGroupedOverview,
  mergeNodePositions,
  overviewGroupAnchorId,
  placeGroupHeadings,
  placeRadialNeighbor,
  sanitizeSavedPositions,
} from "../ontology-graph-overview.ts";

test("isLargeGraph detects graphs above node or edge thresholds", () => {
  assert.equal(isLargeGraph(1000, 2000), false);
  assert.equal(isLargeGraph(1001, 10), true);
  assert.equal(isLargeGraph(10, 2001), true);
});

test("layoutGrid arranges node IDs in a deterministic grid", () => {
  const positions = layoutGrid(["a", "b", "c", "d", "e"], 100, 80);
  assert.deepEqual(positions.get("a"), { x: 0, y: 0 });
  assert.deepEqual(positions.get("b"), { x: 100, y: 0 });
  assert.deepEqual(positions.get("c"), { x: 200, y: 0 });
  assert.deepEqual(positions.get("d"), { x: 0, y: 80 });
  assert.deepEqual(positions.get("e"), { x: 100, y: 80 });
});

test("placeRadialNeighbor places paginated neighbors along an expanding golden-angle spiral", () => {
  const center = { x: 100, y: 200 };
  const p0 = placeRadialNeighbor(0, center);
  const p1 = placeRadialNeighbor(1, center);
  const p5 = placeRadialNeighbor(5, center);
  const dist = (p) => Math.hypot(p.x - center.x, p.y - center.y);

  assert.ok(Math.abs(dist(p0) - 180) <= 2);
  assert.ok(dist(p1) > dist(p0));
  assert.ok(dist(p5) > dist(p1));
  assert.notDeepEqual(p0, p1);
});

test("layoutGroupedOverview clusters nodes by group and honors declared groupOrder", () => {
  const nodes = [
    { id: "n1", groupId: "Order", label: "Order 1" },
    { id: "n2", groupId: "Order", label: "Order 2" },
    { id: "n3", groupId: "Order", label: "Order 3" },
    { id: "n4", groupId: "Factory", label: "Factory 1" },
    { id: "n5", groupId: "Factory", label: "Factory 2" },
    { id: "n6", groupId: "Line", label: "Line 1" },
  ];

  const positions = layoutGroupedOverview(nodes, ["Factory", "Order"]);
  assert.equal(positions.size, 6);

  // First group ("Factory") is centered at (0, 0); second ("Order") sits in column 1 (x >= 520).
  const factory0 = positions.get("n4");
  const order0 = positions.get("n1");
  const line0 = positions.get("n6");
  assert.deepEqual(factory0, { x: 0, y: 0 });
  assert.ok(order0.x >= 520);
  assert.equal(order0.y, 0);
  assert.equal(line0.x, 0);
  assert.ok(line0.y >= 520);

  // Nodes within the same cluster stay close together relative to inter-cluster spacing.
  const intraDist = Math.hypot(positions.get("n2").x - order0.x, positions.get("n2").y - order0.y);
  const interDist = Math.hypot(order0.x - factory0.x, order0.y - factory0.y);
  assert.ok(intraDist < 100);
  assert.ok(interDist >= 520);
});

test("placeGroupHeadings places headings above clusters, falls back below when blocked, and omits when both sides collide", () => {
  const viewport = { x: 0, y: 0, width: 1000, height: 800 };

  const normalGroup = {
    id: "Factory",
    label: "Factory",
    countText: "4 / 20",
    bounds: { x: 200, y: 200, width: 120, height: 100 },
    width: 120,
    height: 26,
  };
  const topClippedGroup = {
    id: "Order",
    label: "Order",
    countText: "2 / 10",
    bounds: { x: 500, y: 20, width: 120, height: 80 },
    width: 120,
    height: 26,
  };
  const fullyBlockedGroup = {
    id: "Line",
    label: "Line",
    countText: "1 / 1",
    bounds: { x: 750, y: 200, width: 120, height: 80 },
    width: 120,
    height: 26,
  };

  const obstacles = [
    // Block both above and below "Line"
    { x: 740, y: 150, width: 140, height: 40 },
    { x: 740, y: 290, width: 140, height: 40 },
  ];

  const placed = placeGroupHeadings([normalGroup, topClippedGroup, fullyBlockedGroup], obstacles, viewport);
  assert.equal(placed.length, 2);

  const factoryHeading = placed.find((h) => h.id === "Factory");
  const orderHeading = placed.find((h) => h.id === "Order");
  assert.ok(factoryHeading);
  assert.ok(orderHeading);

  // Factory fits cleanly above its cluster (200 - 16 - 26 = 158)
  assert.equal(factoryHeading.y, 158);
  // Order is clipped at top (20 - 16 - 26 < 0) so it falls back below (20 + 80 + 16 = 116)
  assert.equal(orderHeading.y, 116);
  // Line is omitted because both above and below collide with obstacles
  assert.equal(placed.find((h) => h.id === "Line"), undefined);
});

test("buildAggregatedOverviewEdges aggregates edges by group pair and relation kind, and overlays direct edges for selected node", () => {
  const nodes = [
    { id: "f1", groupId: "Factory", label: "F1" },
    { id: "f2", groupId: "Factory", label: "F2" },
    { id: "o1", groupId: "Order", label: "O1" },
    { id: "o2", groupId: "Order", label: "O2" },
  ];
  const positions = layoutGroupedOverview(nodes, ["Factory", "Order"]);
  const edges = [
    { id: "e1", source: "f1", target: "o1", relationKind: "produces", label: "Produces" },
    { id: "e2", source: "f2", target: "o2", relationKind: "produces", label: "Produces" },
    { id: "e3", source: "f1", target: "o2", relationKind: "audits", derived: true },
  ];

  const unselected = buildAggregatedOverviewEdges(nodes, edges, positions, {
    formatAggregatedLabel: (kind, count, sample) => `${sample ?? kind} (${count})`,
  });

  assert.equal(unselected.anchors.length, 2);
  assert.ok(unselected.anchors.every((anchor) => isOverviewGroupAnchorId(anchor.id) && anchor.anchor));
  assert.equal(unselected.edges.length, 2);

  const producesEdge = unselected.edges.find((edge) => edge.relationKind === "produces");
  const auditsEdge = unselected.edges.find((edge) => edge.relationKind === "audits");
  assert.equal(producesEdge.source, overviewGroupAnchorId("Factory"));
  assert.equal(producesEdge.target, overviewGroupAnchorId("Order"));
  assert.equal(producesEdge.count, 2);
  assert.equal(producesEdge.weight, 2);
  assert.equal(producesEdge.line, "solid");
  assert.equal(producesEdge.tone, "default");
  assert.equal(producesEdge.label, "Produces (2)");
  assert.equal(auditsEdge.line, "dashed");
  assert.equal(auditsEdge.count, 1);

  const selected = buildAggregatedOverviewEdges(nodes, edges, positions, {
    selectedNodeId: "f1",
    formatDirectLabel: (edge) => edge.label ?? edge.relationKind,
  });

  const aggregated = selected.edges.filter((edge) => edge.aggregated);
  const direct = selected.edges.filter((edge) => !edge.aggregated);
  assert.equal(aggregated.length, 2);
  assert.ok(aggregated.every((edge) => edge.tone === "muted"));
  assert.equal(direct.length, 2);
  assert.ok(direct.every((edge) => edge.tone === "default" && (edge.source === "f1" || edge.target === "f1")));
});

test("sanitizeSavedPositions filters invalid entries and mergeNodePositions keeps layout coordinates for new nodes", () => {
  const saved = sanitizeSavedPositions({
    a: { x: 120, y: -40 },
    badNaN: { x: Number.NaN, y: 10 },
    badShape: "invalid",
    staleNode: { x: 500, y: 500 },
  });
  assert.equal(saved.size, 2);
  assert.deepEqual(saved.get("a"), { x: 120, y: -40 });

  const computed = new Map([
    ["a", { x: 0, y: 0 }],
    ["b", { x: 200, y: 100 }],
  ]);
  const merged = mergeNodePositions(computed, saved, ["a", "b", "c"]);
  assert.deepEqual(merged.get("a"), { x: 120, y: -40 });
  assert.deepEqual(merged.get("b"), { x: 200, y: 100 });
  assert.deepEqual(merged.get("c"), { x: 0, y: 0 });
});
