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
 *
 * Two canvases draw it. `GraphCanvas` is the light SVG one: it lays the graph out at natural size and scrolls, and it
 * draws ids, labels, tones, selection and positions. `G6GraphCanvas` (`@ontomato/foundation-ui/graph/g6`) draws with G6
 * for graphs a reader pans, zooms and drags: it also draws everything marked "G6 canvas" below.
 */

/**
 * How a node or an edge stands out, as the caller decides it: `default` is plain, `accent` is marked for the reader's
 * attention without being selected (such as search matches or nodes adjacent to a chosen one), `path` marks a found
 * directed path distinctly from search matches, and `muted` is faded back so the rest stands out (what lies outside a
 * search hit, a path or a chosen node's relations; G6 canvas). Selection is not a tone: it is the `selected` IDs, drawn
 * on top of the tone.
 */
export type GraphCanvasTone = "default" | "accent" | "path" | "muted";

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
  /**
   * What kind of thing the node is, in its caller's words (an object type, a kind of capability). Each category takes
   * one colour of the edition's categorical palette, the same in light and dark mode; see the canvas's `categories`.
   * G6 canvas.
   */
  category?: string;
  /**
   * Draws the node as nothing: an invisible point that edges can end at, such as the middle of a group of nodes that an
   * aggregated relation joins. It cannot be chosen. `radius` is how far its group reaches around it, so that an edge from
   * it to itself loops round the group rather than through it. G6 canvas.
   */
  anchor?: { radius: number };
}

export interface GraphCanvasEdge {
  /** The edge's stable identity. */
  id: string;
  /** The IDs of the nodes it joins; an edge naming a node that is not drawn is not drawn either. */
  source: string;
  target: string;
  tone?: GraphCanvasTone;
  /** The text drawn along the edge, such as the relation's name; none when absent. G6 canvas. */
  label?: string;
  /** `dashed` marks an edge its caller wants read apart from the solid ones (a relation derived rather than stored). G6 canvas. */
  line?: "solid" | "dashed";
  /** How many relations the edge stands for when it aggregates several (1 when absent); a heavier one is drawn thicker. G6 canvas. */
  weight?: number;
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

/** One drawn element a reader acted on: a node or an edge, by its ID. */
export interface GraphCanvasElement {
  kind: "node" | "edge";
  id: string;
}

/** A point in graph coordinates. */
export interface GraphCanvasPoint {
  x: number;
  y: number;
}
