/*
 * The graph canvas's interface: what a caller hands it and what it hands back. It is the one interface every graph of
 * the platform is drawn through, whatever draws it — the light SVG canvas here, and a G6 one where a page needs G6 — so
 * a caller that switches between them changes nothing it passes or hears.
 *
 * The canvas only draws and reports. What the nodes and edges are, which of them a reader may choose, what a choice
 * implies (the object types one relation away, say) and who may see what all belong to the caller and its data's owner:
 * the caller works them out and passes the result as nodes, edges, tones and the selected IDs.
 *
 * Extending it adds optional fields or events; an existing field never changes its meaning.
 */

/**
 * How a node or an edge stands out, as the caller decides it: `default` is plain, `accent` is marked for the reader's
 * attention without being selected (the data scope marks the object types adjacent to a chosen one with it). Selection
 * is not a tone: it is the `selected` IDs, drawn on top of the tone.
 */
export type GraphCanvasTone = "default" | "accent";

export interface GraphCanvasNode {
  /** The node's stable identity: what `selected` holds and the events name. */
  id: string;
  /** The short text drawn on the node; a long one is cut with an ellipsis, and `title` keeps it whole. */
  label: string;
  /** The node's full name, for its tooltip and its accessible name; `label` when absent. */
  title?: string;
  tone?: GraphCanvasTone;
  /** The node's position in graph coordinates, read only under the `preset` layout. */
  x?: number;
  y?: number;
}

export interface GraphCanvasEdge {
  /** The edge's stable identity. */
  id: string;
  /** The IDs of the nodes it joins; an edge naming a node that is not drawn is not drawn either. */
  source: string;
  target: string;
  tone?: GraphCanvasTone;
}

/**
 * Where the canvas places the nodes. `grid` puts them in the order given, row by row, in a near-square block; `preset`
 * puts each at the `x`/`y` the caller gave it, for a layout the caller works out itself.
 */
export type GraphCanvasLayout = { type: "grid" } | { type: "preset" };

/**
 * How a reader chooses nodes: `none` draws only, `single` keeps at most one chosen node (choosing it again lets go),
 * `multiple` adds and removes one node at a time.
 */
export type GraphCanvasSelection = "none" | "single" | "multiple";

/** The part of the graph the reader sees, in graph coordinates: its top-left corner, its size and the zoom. */
export interface GraphCanvasViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}
