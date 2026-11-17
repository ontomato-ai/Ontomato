/**
 * Geometry and labels for the capability map.
 *
 * <p>Positions are computed rather than measured, for the same reason the instance graph computes its overview: there
 * is no force simulation to settle, so a redraw of the same domain in the same window lands in the same place.</p>
 *
 * <p>Each kind is one block of columns, and the blocks follow the legend's order, so authority reads the way it flows: a
 * subject holds a role, the role reaches a capability. A cell is as wide as a label may be drawn, so no two names
 * overlap, and the map opens at a zoom where those names can still be read. A domain too large for that runs on to the
 * right and is dragged into view, instead of being shrunk until every name is a few pixels high — which is what the
 * rings this replaced did: every object sat on one circle whose size grew with the count, and fitting ninety of them
 * into the page drew their names at two pixels.</p>
 */

export type CapabilityLayer = "governance" | "capability";

export type CapabilityKind = "subject" | "role" | "action" | "workflow" | "trigger" | "metric" | "function" | "skill";

/** Every kind in draw order: the legend lists them, the palette colours them and the layout places them in this order. */
export const capabilityKinds: readonly CapabilityKind[] = [
  "subject",
  "role",
  "action",
  "workflow",
  "trigger",
  "metric",
  "function",
  "skill",
];

export interface CapabilityNode {
  id: string;
  kind: CapabilityKind;
  layer: CapabilityLayer;
  label: string;
  detail: string;
}

export interface CapabilityEdge {
  from: string;
  to: string;
  label: string;
  derived?: boolean;
}

/** Node diameter and label size in canvas units; at zoom 1 they are screen pixels. */
export const CAPABILITY_NODE_SIZE = 28;
export const CAPABILITY_LABEL_SIZE = 12;
/** The widest a label is drawn: a longer name ends in an ellipsis rather than running into the next column. */
export const CAPABILITY_LABEL_WIDTH = 160;

const CELL_WIDTH = CAPABILITY_LABEL_WIDTH + 16;
/** One node, its label below it, and the gap before the next row. */
const CELL_HEIGHT = 68;
/** Where a node's centre sits in its cell: the white ring around the node stays inside the cell. */
const NODE_Y = CAPABILITY_NODE_SIZE / 2 + 4;
/** Between two kinds: wider than between two columns of one kind, so a kind reads as one group. */
const BLOCK_GAP = 48;
/** Between two shelves of blocks; the cells above already end in a row gap. */
const SHELF_GAP = 32;
/** Kept clear around the map when it is placed in the window. */
const MARGIN = 24;
/** The smallest zoom the map opens at: below it a label is drawn under 11 screen pixels. */
const CAPABILITY_MIN_OPEN_ZOOM = 11 / CAPABILITY_LABEL_SIZE;
/** Opening never enlarges: a small domain is drawn at its natural size, as the other graphs fit theirs. */
const MAX_OPEN_ZOOM = 1;

export interface CapabilityMapLayout {
  positions: Record<string, { x: number; y: number }>;
  /** The whole map, in canvas units, with its top-left corner at the canvas origin. */
  width: number;
  height: number;
  /** The zoom the map opens at. */
  zoom: number;
  /** Where the canvas origin sits in the window at that zoom, in screen pixels. */
  offset: { x: number; y: number };
}

interface Arrangement {
  rows: number;
  shelves: CapabilityNode[][][];
  width: number;
  height: number;
}

/**
 * The blocks in order, `rows` cells high at most, cut into shelves after every block whose bit is set in `cuts`.
 *
 * <p>A shelf is as tall as its tallest block, and the map as wide as its widest shelf.</p>
 */
function arrange(blocks: CapabilityNode[][], rows: number, cuts: number): Arrangement {
  const shelves: CapabilityNode[][][] = [[]];
  blocks.forEach((block, index) => {
    shelves[shelves.length - 1]!.push(block);
    if (index < blocks.length - 1 && cuts & (1 << index)) shelves.push([]);
  });
  const shelfWidth = (shelf: CapabilityNode[][]) =>
    shelf.reduce((sum, block) => sum + Math.ceil(block.length / rows) * CELL_WIDTH, 0) +
    (shelf.length - 1) * BLOCK_GAP;
  const shelfHeight = (shelf: CapabilityNode[][]) =>
    Math.max(...shelf.map((block) => Math.min(rows, block.length))) * CELL_HEIGHT;
  return {
    rows,
    shelves,
    width: Math.max(...shelves.map(shelfWidth)),
    height: shelves.reduce((sum, shelf) => sum + shelfHeight(shelf), 0) + (shelves.length - 1) * SHELF_GAP,
  };
}

/**
 * Where every node goes, and how the map opens in a window of `viewport` pixels.
 *
 * <p>Every way to give the blocks a row count and to cut them into shelves is tried — eight kinds make 128 ways to cut —
 * and the one drawn largest wins, up to natural size; among those that fit at natural size, the one with fewest shelves,
 * so the map keeps reading left to right. When even the best would draw the names under {@link CAPABILITY_MIN_OPEN_ZOOM},
 * the blocks stay on one shelf, as many rows high as the window holds at that zoom, and the map opens at its left edge
 * — the subjects — with the rest to the right.</p>
 */
export function capabilityMapLayout(
  nodes: CapabilityNode[],
  viewport: { width: number; height: number },
): CapabilityMapLayout {
  const blocks = capabilityKinds
    .map((kind) => nodes.filter((node) => node.kind === kind))
    .filter((block) => block.length > 0);
  // A filter that matches nothing still draws the canvas, with nothing on it.
  if (blocks.length === 0) {
    return { positions: {}, width: 0, height: 0, zoom: MAX_OPEN_ZOOM, offset: { x: MARGIN, y: MARGIN } };
  }
  const room = { width: viewport.width - 2 * MARGIN, height: viewport.height - 2 * MARGIN };
  const scaleOf = (arrangement: Arrangement) =>
    Math.min(room.width / arrangement.width, room.height / arrangement.height);
  const fitOf = (arrangement: Arrangement) => Math.min(MAX_OPEN_ZOOM, scaleOf(arrangement));
  /** Drawn larger, up to natural size; at the same size, on fewer shelves; then with more room to spare. */
  const outranks = (candidate: Arrangement, best: Arrangement) =>
    fitOf(candidate) !== fitOf(best)
      ? fitOf(candidate) > fitOf(best)
      : candidate.shelves.length !== best.shelves.length
        ? candidate.shelves.length < best.shelves.length
        : scaleOf(candidate) > scaleOf(best);

  const tallest = Math.max(...blocks.map((block) => block.length));
  let best = arrange(blocks, 1, 0);
  for (let rows = 1; rows <= tallest; rows++) {
    for (let cuts = 0; cuts < 1 << (blocks.length - 1); cuts++) {
      const candidate = arrange(blocks, rows, cuts);
      if (outranks(candidate, best)) best = candidate;
    }
  }
  const readable = fitOf(best) >= CAPABILITY_MIN_OPEN_ZOOM;
  const chosen = readable
    ? best
    : arrange(blocks, Math.max(1, Math.floor(room.height / (CAPABILITY_MIN_OPEN_ZOOM * CELL_HEIGHT))), 0);
  const zoom = readable ? fitOf(chosen) : CAPABILITY_MIN_OPEN_ZOOM;

  const positions: Record<string, { x: number; y: number }> = {};
  let top = 0;
  for (const shelf of chosen.shelves) {
    let left = 0;
    for (const block of shelf) {
      block.forEach((node, index) => {
        positions[node.id] = {
          x: left + Math.floor(index / chosen.rows) * CELL_WIDTH + CELL_WIDTH / 2,
          y: top + (index % chosen.rows) * CELL_HEIGHT + NODE_Y,
        };
      });
      left += Math.ceil(block.length / chosen.rows) * CELL_WIDTH + BLOCK_GAP;
    }
    top += Math.max(...shelf.map((block) => Math.min(chosen.rows, block.length))) * CELL_HEIGHT + SHELF_GAP;
  }

  // Centred along an axis the map fits in; from the margin along one it overflows, so the start stays in view.
  const place = (size: number, window: number) =>
    size * zoom <= window - 2 * MARGIN ? (window - size * zoom) / 2 : MARGIN;
  return {
    positions,
    width: chosen.width,
    height: chosen.height,
    zoom,
    offset: { x: place(chosen.width, viewport.width), y: place(chosen.height, viewport.height) },
  };
}

/** A node's label: the name, or a dash for an object without one. Width is capped where it is drawn. */
export function capabilityNodeLabel(label: string | undefined) {
  return label?.trim() || "—";
}

/** One node's neighbours, for the relation list beside the graph. */
export function capabilityNeighbours(edges: CapabilityEdge[], id: string) {
  return edges.filter((edge) => edge.from === id || edge.to === id);
}
