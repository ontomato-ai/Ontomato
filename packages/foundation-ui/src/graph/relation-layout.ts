import { G6_LABEL_SIZE, G6_LABEL_WIDTH, G6_NODE_SIZE } from "./g6-elements";
import type { GraphCanvasEdge, GraphCanvasNode, GraphCanvasPoint } from "./types";

/*
 * Where nodes nobody placed go on the G6 canvas: by their relations. In each separate part of the graph the most
 * connected node stands first, the nodes one relation away in the column after it, two away in the one after that, each
 * column ordered after the nodes it joins in the column before so that edges cross as little as they can. A column
 * longer than a screen folds into several side by side.
 *
 * The parts share the room the graph is shown in (panelisation lead, 2026-11-22): each part a block as its relations lay
 * it out, the nodes with no relation at all one more block of rows, laid on shelves from the largest down — side by
 * side where the room is wide, one below another where it is tall. Of every width a shelf may take, the one that shows
 * the whole graph largest in the room is taken. A part keeps its own shape whatever the room: folding a part further to
 * fit would draw its relations through the nodes of the column it folds past (every other line, at the rows' spacing).
 *
 * Positions are node centres in graph units, as G6 places a node. The same graph in the same room is always laid out
 * the same way.
 */

/** From one column to the next: a node's name, at its widest, and a gap. */
export const RELATION_COLUMN_GAP = G6_LABEL_WIDTH + 60;
/** The sizes a page draws its nodes and their names at; each the canvas's own when absent. */
export interface RelationLayoutLook {
  nodeSize?: number;
  labelSize?: number;
}
/** From one row to the next for nodes and names drawn at `look`: a node, its name under it, and a gap. */
const rowGapFor = ({ nodeSize = G6_NODE_SIZE, labelSize = G6_LABEL_SIZE }: RelationLayoutLook = {}) =>
  Math.round(nodeSize + labelSize * 1.2 + 6 + 24);
/** From one row to the next at the canvas's own sizes. */
export const RELATION_ROW_GAP = rowGapFor();

/** The room the whole graph is to be shown in, in screen pixels (the canvas less its fit padding). */
export interface LayoutRoom {
  width: number;
  height: number;
}

export interface RelationLayout {
  positions: Map<string, GraphCanvasPoint>;
  /** The first node of the largest part: where a reader's view starts when nothing is chosen. */
  root: string | undefined;
}

export function layoutByRelations(
  nodes: readonly GraphCanvasNode[], edges: readonly GraphCanvasEdge[], room: LayoutRoom, look?: RelationLayoutLook,
): RelationLayout {
  const rowGap = rowGapFor(look);
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

  // Each part folded as its size folds it, its columns centred on its tallest.
  const blocks: Block[] = parts.map((columns) => {
    const rows = Math.max(6, Math.ceil(Math.sqrt(columns.flat().length) * 1.5));
    const folded = columns.flatMap((column) => Array.from({ length: Math.ceil(column.length / rows) }, (_, index) => column.slice(index * rows, (index + 1) * rows)));
    const height = Math.max(...folded.map((column) => column.length));
    const at = new Map(folded.flatMap((column, x) => column.map((id, y): [string, GraphCanvasPoint] => [id, { x, y: (height - column.length) / 2 + y }])));
    return { cols: folded.length, rows: height, at };
  });
  const positions = new Map<string, GraphCanvasPoint>();
  let top = 0;
  for (const shelf of shelve(blocks, alone.length, room, rowGap)) {
    let left = 0;
    for (const block of shelf.blocks) {
      const at = block.at ?? new Map(alone.map((id, index) => [id, { x: index % block.cols, y: Math.floor(index / block.cols) }]));
      for (const [id, place] of at) positions.set(id, { x: (left + place.x) * RELATION_COLUMN_GAP, y: (top + place.y) * rowGap });
      left += block.cols + 1;
    }
    top += shelf.rows + 1;
  }
  return { positions, root: parts[0]?.[0]?.[0] ?? alone[0] };
}

/** A block on a shelf, in columns and rows: a part with its nodes' places in it (`at`), or the nodes with no relation. */
interface Block {
  cols: number;
  rows: number;
  at?: ReadonlyMap<string, GraphCanvasPoint>;
}
interface Shelf {
  blocks: Block[];
  cols: number;
  rows: number;
}

/**
 * The shelves that show the whole graph largest in the room. For each width a shelf may take, in columns, each part —
 * the largest first — takes the first shelf with room for it, or a new one; the nodes with no relation take the number
 * of columns, and the place, that leaves the drawing least tall. The width whose drawing the room shows at the largest
 * zoom is taken, the narrower of equals.
 */
function shelve(parts: readonly Block[], alone: number, room: LayoutRoom, rowGap: number): Shelf[] {
  const options = alone ? Array.from({ length: alone }, (_, index) => ({ cols: index + 1, rows: Math.ceil(alone / (index + 1)) })) : [];
  if (!parts.length && !options.length) return [];
  const narrowest = Math.max(1, ...parts.map(({ cols }) => cols));
  const widest = parts.reduce((sum, { cols }) => sum + cols + 1, 0) + alone;
  const height = (shelves: readonly Shelf[]) => shelves.reduce((sum, shelf) => sum + shelf.rows, 0) + shelves.length - 1;
  const put = (shelves: Shelf[], block: Block, width: number) => {
    const shelf = shelves.find((candidate) => candidate.cols + 1 + block.cols <= width);
    if (!shelf) return [...shelves, { blocks: [block], cols: block.cols, rows: block.rows }];
    return shelves.map((candidate) => candidate === shelf
      ? { blocks: [...shelf.blocks, block], cols: shelf.cols + 1 + block.cols, rows: Math.max(shelf.rows, block.rows) } : candidate);
  };
  let best: { zoom: number; shelves: Shelf[] } | undefined;
  for (let width = narrowest; width <= widest; width += 1) {
    let shelves = parts.reduce<Shelf[]>((laid, block) => put(laid, block, width), []);
    if (options.length) {
      shelves = options.filter(({ cols }) => cols <= width).map((block) => put(shelves, block, width))
        .reduce((least, candidate) => (height(candidate) < height(least) ? candidate : least));
    }
    const cols = Math.max(...shelves.map((shelf) => shelf.cols));
    const zoom = Math.min(room.width / ((cols - 1) * RELATION_COLUMN_GAP + G6_LABEL_WIDTH), room.height / (height(shelves) * rowGap));
    if (!best || zoom > best.zoom) best = { zoom, shelves };
  }
  return best!.shelves;
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
