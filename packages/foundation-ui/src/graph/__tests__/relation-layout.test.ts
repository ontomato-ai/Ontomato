import { expect, it } from "vitest";
import { layoutByRelations, RELATION_COLUMN_GAP, RELATION_ROW_GAP } from "../relation-layout";
import type { GraphCanvasEdge, GraphCanvasNode } from "../types";

/*
 * Where the G6 canvas's callers put nodes nobody placed (G-01, 2026-11-21): by their relations, not in the order given.
 * The most connected node stands first, the nodes one relation away in the column after it, two away in the one after
 * that; a column too long for a screen folds into several. No two names share a place, and the same graph is always
 * laid out the same way, so a reader finds a node where it was.
 */

const node = (id: string): GraphCanvasNode => ({ id, label: id });
const edge = (source: string, target: string): GraphCanvasEdge => ({ id: `${source}-${target}`, source, target });

function apart(positions: ReadonlyMap<string, { x: number; y: number }>) {
  const points = [...positions.values()];
  for (let a = 0; a < points.length; a += 1)
    for (let b = a + 1; b < points.length; b += 1)
      expect(Math.abs(points[a]!.x - points[b]!.x) >= RELATION_COLUMN_GAP || Math.abs(points[a]!.y - points[b]!.y) >= RELATION_ROW_GAP).toBe(true);
}

it("puts the most connected node first and each node one relation further on in the next column", () => {
  // Given in an order that a grid would draw as rows: the hub third, its far end last.
  const nodes = ["a", "b", "hub", "c", "far"].map(node);
  const edges = [edge("a", "hub"), edge("hub", "b"), edge("c", "hub"), edge("far", "c")];
  const { positions, root } = layoutByRelations(nodes, edges);
  expect(root).toBe("hub");
  const column = (id: string) => Math.round((positions.get(id)!.x - positions.get("hub")!.x) / RELATION_COLUMN_GAP);
  expect(["hub", "a", "b", "c", "far"].map(column)).toEqual([0, 1, 1, 1, 2]);
  apart(positions);
  // The same graph, the same places.
  expect(layoutByRelations(nodes, edges).positions).toEqual(positions);
});

it("folds a long column, lays each separate part out on its own, and leaves no node out", () => {
  const leaves = Array.from({ length: 30 }, (_, index) => `leaf${index}`);
  const nodes = [...leaves, "hub", "x", "y", "alone"].map(node);
  const edges = [...leaves.map((leaf) => edge("hub", leaf)), edge("x", "y"), edge("hub", "missing")];
  const { positions, root } = layoutByRelations(nodes, edges);
  expect(root).toBe("hub");
  expect([...positions.keys()].sort()).toEqual(nodes.map(({ id }) => id).sort());
  apart(positions);
  // Thirty leaves are not one column taller than a screen.
  const rows = new Set(leaves.map((leaf) => positions.get(leaf)!.y));
  expect(rows.size).toBeLessThanOrEqual(10);
  // The second part and the lone node are below the first, not mixed into it.
  const bottom = Math.max(...leaves.map((leaf) => positions.get(leaf)!.y));
  for (const id of ["x", "y", "alone"]) expect(positions.get(id)!.y).toBeGreaterThan(bottom);
});

it("has no first node when there are no nodes", () => {
  expect(layoutByRelations([], [])).toEqual({ positions: new Map(), root: undefined });
});
