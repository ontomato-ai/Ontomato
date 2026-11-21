import { G6_LABEL_WIDTH } from "./g6-elements";
import type { GraphCanvasEdge, GraphCanvasNode, GraphCanvasPoint } from "./types";

/*
 * Where nodes nobody placed go on the G6 canvas: by their relations. In each separate part of the graph the most
 * connected node stands first, the nodes one relation away in the column after it, two away in the one after that, each
 * column ordered after the nodes it joins in the column before so that edges cross as little as they can. A column
 * longer than a screen folds into several side by side. Parts are stacked below one another, the largest first, and
 * nodes with no relation at all close the drawing in rows.
 *
 * Positions are node centres in graph units, as G6 places a node. The same graph is always laid out the same way.
 */

/** From one column to the next: a node's name, at its widest, and a gap. */
export const RELATION_COLUMN_GAP = G6_LABEL_WIDTH + 60;
/** From one row to the next: a node, its name under it, and a gap. */
export const RELATION_ROW_GAP = 76;

export interface RelationLayout {
  positions: Map<string, GraphCanvasPoint>;
  /** The first node of the largest part: where a reader's view starts when nothing is chosen. */
  root: string | undefined;
}

export function layoutByRelations(nodes: readonly GraphCanvasNode[], edges: readonly GraphCanvasEdge[]): RelationLayout {
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const neighbours = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const { source, target } of edges) {
    if (source === target || !neighbours.has(source) || !neighbours.has(target)) continue;
    neighbours.get(source)!.add(target);
    neighbours.get(target)!.add(source);
  }
  const byOrder = (a: string, b: string) => order.get(a)! - order.get(b)!;
  const degree = (id: string) => neighbours.get(id)!.size;

  // The separate parts, the largest first; within each, its columns by distance from its most connected node.
  const seen = new Set<string>();
  const parts: string[][][] = [];
  const alone: string[] = [];
  for (const { id } of nodes) {
    if (seen.has(id)) continue;
    if (!degree(id)) {
      seen.add(id);
      alone.push(id);
      continue;
    }
    const members: string[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length) {
      const current = queue.shift()!;
      members.push(current);
      for (const next of [...neighbours.get(current)!].sort(byOrder))
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    }
    const root = members.reduce((best, candidate) => (degree(candidate) > degree(best) ? candidate : best));
    parts.push(columnsFrom(root, neighbours, byOrder));
  }
  parts.sort((a, b) => b.flat().length - a.flat().length);

  const positions = new Map<string, GraphCanvasPoint>();
  let top = 0;
  for (const columns of parts) {
    const rows = Math.max(6, Math.ceil(Math.sqrt(columns.flat().length) * 1.5));
    const folded = columns.flatMap((column) => Array.from({ length: Math.ceil(column.length / rows) }, (_, index) => column.slice(index * rows, (index + 1) * rows)));
    const height = Math.max(...folded.map((column) => column.length));
    folded.forEach((column, x) => {
      const offset = (height - column.length) / 2;
      column.forEach((id, y) => positions.set(id, { x: x * RELATION_COLUMN_GAP, y: top + (offset + y) * RELATION_ROW_GAP }));
    });
    top += (height + 1) * RELATION_ROW_GAP;
  }
  const width = Math.max(4, ...[...positions.values()].map(({ x }) => Math.round(x / RELATION_COLUMN_GAP) + 1));
  alone.forEach((id, index) =>
    positions.set(id, { x: (index % width) * RELATION_COLUMN_GAP, y: top + Math.floor(index / width) * RELATION_ROW_GAP }));
  return { positions, root: parts[0]?.[0]?.[0] ?? alone[0] };
}

/** One part's columns: the root, then each node in the column after the nearest one it joins, ordered after it. */
function columnsFrom(root: string, neighbours: ReadonlyMap<string, ReadonlySet<string>>, byOrder: (a: string, b: string) => number): string[][] {
  const columns: string[][] = [[root]];
  const placed = new Set([root]);
  for (;;) {
    const previous = columns.at(-1)!;
    const rank = new Map(previous.map((id, index) => [id, index]));
    const next = [...new Set(previous.flatMap((id) => [...neighbours.get(id)!].filter((other) => !placed.has(other))))];
    if (!next.length) return columns;
    // Each after the mean place of the nodes it joins in the column before.
    const centre = (id: string) => {
      const joined = [...neighbours.get(id)!].filter((other) => rank.has(other)).map((other) => rank.get(other)!);
      return joined.reduce((sum, value) => sum + value, 0) / joined.length;
    };
    next.sort((a, b) => centre(a) - centre(b) || byOrder(a, b));
    for (const id of next) placed.add(id);
    columns.push(next);
  }
}
