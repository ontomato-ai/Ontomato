import type { EdgeData, NodeData } from "@antv/g6";
import { graphCategorySlot, readGraphPalette } from "./palette";
import type { GraphCanvasEdge, GraphCanvasNode, GraphCanvasPoint } from "./types";

/*
 * What the G6 canvas hands G6 for each node and edge. Kept apart from the component so the drawing rules — colours,
 * tones, curves for parallel edges, loops — can be checked without a renderer.
 */

/** A node's diameter in graph units: at zoom 1, screen pixels. */
export const G6_NODE_SIZE = 32;
/** The size of a node's name, in graph units. */
export const G6_LABEL_SIZE = 12;
/** The least zoom at which a node's name is still drawn 10 pixels high: below it names cannot be read. */
export const G6_READABLE_ZOOM = 10 / G6_LABEL_SIZE;
/** The widest a node's name is drawn unless its caller says otherwise: about 24 Latin or 13 Chinese characters. */
export const G6_LABEL_WIDTH = 160;
/** From this size on a graph is drawn without arrowheads: at that density they only add noise and drawing time. */
const LARGE_NODES = 1000;
const LARGE_EDGES = 2000;

/** The colours a graph is drawn in, resolved where it is drawn: G6 draws on a canvas, which takes no CSS variables. */
export interface G6Colors {
  /** ink: node labels */
  text: string;
  /** muted: edge labels and dashed edges */
  muted: string;
  /** surface: label backings and the ring around a node */
  surface: string;
  /** line-strong: edges */
  edge: string;
  primary: string;
  /** The ring and edge of an `accent` element. */
  accent: string;
  /** The categorical palette, in slot order. */
  palette: string[];
}

export function readG6Colors(element: Element): G6Colors {
  const style = getComputedStyle(element);
  const role = (name: string) => style.getPropertyValue(name).trim();
  return {
    text: role("--el-text-color-primary"),
    muted: role("--el-text-color-secondary"),
    surface: role("--el-bg-color"),
    edge: role("--el-border-color-dark"),
    primary: role("--el-color-primary"),
    accent: role("--el-color-primary-light-5"),
    palette: readGraphPalette(element),
  };
}

export function isLargeGraph(nodes: number, edges: number) {
  return nodes > LARGE_NODES || edges > LARGE_EDGES;
}

/**
 * A node's look, without its position: the position is applied only when its caller moves it. Its name is drawn under
 * it on one line, no wider than `labelWidth`, ending in an ellipsis where it would run on.
 */
export function g6NodeStyle(node: GraphCanvasNode, colors: G6Colors, categories: readonly string[], choosable: boolean, labelWidth: number) {
  // An anchor is drawn transparent at size 1, not 0: G6 places a node of size 0 at the origin, whatever its x and y.
  if (node.anchor) return { size: 1, opacity: 0, lineWidth: 0, labelText: "", cursor: "default" as const };
  return {
    size: G6_NODE_SIZE,
    fill: node.category === undefined
      ? colors.primary
      : colors.palette[graphCategorySlot(node.category, categories, colors.palette.length)],
    stroke: node.tone === "accent" ? colors.accent : colors.surface,
    lineWidth: 4,
    lineDash: node.tone === "accent" ? [4, 3] : [],
    opacity: node.tone === "muted" ? 0.25 : 1,
    labelText: node.label,
    // G6 only cuts a node's name when it wraps; one line of wrapping ends it in an ellipsis.
    labelMaxWidth: labelWidth,
    labelWordWrap: true,
    labelMaxLines: 1,
    labelTextOverflow: "…",
    labelFill: colors.text,
    labelFontSize: G6_LABEL_SIZE,
    labelFontWeight: 600,
    labelPlacement: "bottom" as const,
    labelOffsetY: 6,
    // Edges run under the nodes; the backing keeps a name readable where one crosses it.
    labelBackground: true,
    labelBackgroundFill: colors.surface,
    labelBackgroundPadding: [1, 4],
    cursor: choosable ? ("pointer" as const) : ("default" as const),
  };
}

export function g6Node(node: GraphCanvasNode, position: GraphCanvasPoint, style: ReturnType<typeof g6NodeStyle>): NodeData {
  return { id: node.id, data: { anchor: !!node.anchor }, style: { ...style, ...position } };
}

/**
 * Each edge as G6 draws it. Edges between the same two nodes fan out into arcs so each stays visible; an edge from a
 * node to itself is a loop above it, further out for each further loop, and round the whole group when the node is an
 * anchor of one. Edges naming a node that is not drawn are left out.
 */
export function g6Edges(edges: readonly GraphCanvasEdge[], nodes: ReadonlyMap<string, GraphCanvasNode>, colors: G6Colors): EdgeData[] {
  const drawn = edges.filter((edge) => nodes.has(edge.source) && nodes.has(edge.target));
  const large = isLargeGraph(nodes.size, drawn.length);
  const pairs = new Map<string, number[]>();
  drawn.forEach((edge, index) => {
    const key = JSON.stringify([edge.source, edge.target].sort());
    pairs.set(key, [...(pairs.get(key) ?? []), index]);
  });
  return drawn.map((edge, index) => {
    const pair = pairs.get(JSON.stringify([edge.source, edge.target].sort()))!;
    const place = pair.indexOf(index);
    const offset = (place - (pair.length - 1) / 2) * 36;
    const geometry = edge.source === edge.target
      ? { type: "cubic", style: { loop: true, loopPlacement: "top" as const, loopDist: (nodes.get(edge.source)!.anchor?.radius ?? 0) + 60 + place * 28 } }
      : { type: pair.length > 1 ? "quadratic" : "line", style: { curveOffset: edge.source < edge.target ? offset : -offset } };
    const dashed = edge.line === "dashed";
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: geometry.type,
      style: {
        ...geometry.style,
        stroke: edge.tone === "accent" ? colors.primary : dashed ? colors.muted : colors.edge,
        lineWidth: Math.min(7, (edge.tone === "accent" ? 2 : 1.5) + (edge.weight === undefined ? 0 : Math.log2(edge.weight + 1))),
        lineDash: dashed ? [5, 4] : [],
        opacity: edge.tone === "muted" ? 0.15 : 1,
        endArrow: !large,
        labelText: edge.label ?? "",
        labelFill: colors.muted,
        labelBackground: true,
        labelBackgroundFill: colors.surface,
        labelBackgroundPadding: [2, 4],
      },
    };
  });
}
