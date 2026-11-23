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
/** The widest a node's name is drawn unless its caller says otherwise: about 24 Latin or 13 Chinese characters. */
export const G6_LABEL_WIDTH = 160;
/** How far a node's first loop reaches above it, and how much further each next loop does. */
export const G6_LOOP_DIST = 60;
export const G6_LOOP_STEP = 28;
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
  /** The ring and edge of an `accent` element (such as search matches). */
  accent: string;
  /** The solid ring and thickened edge of a `path` element, distinct from `accent`. */
  path?: string;
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
    path: role("--el-color-warning"),
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
/** How large a graph draws its nodes and their names, and how wide a name may run: a page's own, else the canvas's. */
export interface G6Look {
  nodeSize: number;
  labelSize: number;
  labelWidth: number;
}

export function g6NodeStyle(node: GraphCanvasNode, colors: G6Colors, categories: readonly string[], choosable: boolean, look: G6Look) {
  // An anchor is drawn transparent at size 1, not 0: G6 places a node of size 0 at the origin, whatever its x and y.
  if (node.anchor) return { size: 1, opacity: 0, lineWidth: 0, labelText: "", cursor: "default" as const };
  const warmHighlight = node.tone === "path" || node.tone === "neighbor";
  return {
    size: look.nodeSize,
    fill: node.category === undefined
      ? colors.primary
      : colors.palette[graphCategorySlot(node.category, categories, colors.palette.length)],
    stroke: warmHighlight ? (colors.path || colors.primary) : node.tone === "accent" ? colors.accent : colors.surface,
    lineWidth: warmHighlight ? 5 : 4,
    lineDash: node.tone === "accent" ? [4, 3] : [],
    opacity: node.tone === "muted" ? 0.18 : 1,
    labelText: node.label,
    // G6 only cuts a node's name when it wraps; one line of wrapping ends it in an ellipsis.
    labelMaxWidth: look.labelWidth,
    labelWordWrap: true,
    labelMaxLines: 1,
    labelTextOverflow: "…",
    labelFill: colors.text,
    labelFontSize: look.labelSize,
    labelFontWeight: 600,
    labelPlacement: "bottom" as const,
    labelOffsetY: 6,
    // Edges run under the nodes; the backing keeps a name readable where one crosses it.
    labelBackground: true,
    labelBackgroundFill: colors.surface,
    labelBackgroundOpacity: 0.92,
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
      ? { type: "cubic", style: { loop: true, loopPlacement: "top" as const, loopDist: (nodes.get(edge.source)!.anchor?.radius ?? 0) + G6_LOOP_DIST + place * G6_LOOP_STEP } }
      : { type: pair.length > 1 ? "quadratic" : "line", style: { curveOffset: edge.source < edge.target ? offset : -offset } };
    const dashed = edge.line === "dashed";
    const warmHighlight = edge.tone === "path" || edge.tone === "neighbor";
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: geometry.type,
      style: {
        ...geometry.style,
        stroke: warmHighlight ? (colors.path || colors.primary) : edge.tone === "accent" ? colors.primary : dashed ? colors.muted : colors.edge,
        lineWidth: Math.min(7, (warmHighlight ? 3 : edge.tone === "accent" ? 2 : 1.5) + (edge.weight === undefined ? 0 : Math.log2(edge.weight + 1))),
        lineDash: dashed ? [5, 4] : [],
        opacity: edge.tone === "muted" ? 0.15 : 1,
        endArrow: !large,
        labelText: edge.label ?? "",
        labelFill: warmHighlight ? colors.text : colors.muted,
        labelFontSize: 11,
        labelBackground: true,
        labelBackgroundFill: colors.surface,
        labelBackgroundOpacity: 0.92,
        labelBackgroundPadding: [2, 4],
      },
    };
  });
}
