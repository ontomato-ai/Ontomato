import type { GraphCanvasLayout, GraphCanvasNode } from "./types";

/*
 * Where the light canvas draws each node. Nodes keep one size, so a name stays readable however many there are: the
 * drawing grows and the canvas scrolls rather than shrinking the text to fit.
 */
export const NODE_WIDTH = 152;
export const NODE_HEIGHT = 44;
const COLUMN_GAP = 24;
const ROW_GAP = 20;
export const MARGIN = 16;

export interface PlacedNode extends GraphCanvasNode {
  x: number;
  y: number;
}

/** Each node at its top-left corner, under the layout the caller chose. */
export function placeNodes(nodes: readonly GraphCanvasNode[], layout: GraphCanvasLayout): PlacedNode[] {
  if (layout.type === "preset") {
    return nodes.map((node) => {
      if (node.x === undefined || node.y === undefined) throw new Error(`Graph node '${node.id}' has no position for the preset layout`);
      return { ...node, x: node.x, y: node.y };
    });
  }
  // A near-square block, a little wider than tall, so the drawing fits a page's width before it needs to scroll.
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length / 1.4)));
  return nodes.map((node, index) => ({
    ...node,
    x: MARGIN + (index % columns) * (NODE_WIDTH + COLUMN_GAP),
    y: MARGIN + Math.floor(index / columns) * (NODE_HEIGHT + ROW_GAP),
  }));
}

/** The text drawn on a node: its label, cut with an ellipsis where it would not fit. */
export function shownLabel(label: string): string {
  return label.length > 16 ? `${label.slice(0, 15)}…` : label;
}
