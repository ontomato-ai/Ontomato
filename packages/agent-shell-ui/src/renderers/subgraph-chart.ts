import type { QuerySubgraph } from "@ontomato/contracts/query-subgraph";

/**
 * Positions and styles a dataset's source analysis as an ECharts graph, exactly as delivered:
 * class occurrences, their fields, operations and output columns, left to right. Nothing is
 * inferred; layout only places the given nodes and edges. Filters mark their targets with a
 * dashed border; the component lists them under the graph.
 */

type GraphNode = QuerySubgraph["nodes"][number];

export interface SubgraphColors {
  text: string;
  muted: string;
  line: string;
  surface: string;
  class: string;
  field: string;
  operation: string;
  output: string;
}

const ROW = 46;
const GAP = 56;
const NODE_HEIGHT = 28;
const MARGIN = 16;
const CLASS_STEP = 1.8;

const boxWidth = (label: string, textWidth: (label: string) => number) =>
  Math.min(170, Math.max(56, textWidth(label) + 24));

function layout(graph: QuerySubgraph, textWidth: (label: string) => number) {
  const { nodes, edges, queries } = graph;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const inputs = new Map<string, string[]>();
  const owner = new Map<string, string>();
  for (const edge of edges) {
    if (edge.kind === "dependency") inputs.set(edge.target, [...(inputs.get(edge.target) ?? []), edge.source]);
    if (edge.kind === "contains") owner.set(edge.target, edge.source);
  }
  // Operations step right along their dependency depth; the contract guarantees no cycles.
  const depth = new Map<string, number>();
  const operationDepth = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const parents = (inputs.get(id) ?? []).filter((source) => byId.get(source)?.kind === "operation");
    const value = parents.length ? 1 + Math.max(...parents.map(operationDepth)) : 0;
    depth.set(id, value);
    return value;
  };
  const operationColumns = Math.max(0, ...nodes.filter((n) => n.kind === "operation").map((n) => operationDepth(n.id) + 1));
  const column = (node: GraphNode) =>
    node.kind === "class" ? 0 : node.kind === "field" ? 1 : node.kind === "operation" ? 2 + operationDepth(node.id) : 2 + operationColumns;

  // Classes and fields stack in one band per query; operations and outputs sit at their inputs' mean height.
  const queryOf = (node: GraphNode): string | null => {
    if (node.kind === "class") return node.queryId;
    if (node.kind === "field") {
      const parent = byId.get(owner.get(node.id) ?? "");
      return parent?.kind === "class" ? parent.queryId : null;
    }
    return null;
  };
  const y = new Map<string, number>();
  let offset = 0;
  for (const query of queries) {
    const classes = nodes.filter((n) => n.kind === "class" && queryOf(n) === query.id);
    const fields = nodes.filter((n) => n.kind === "field" && queryOf(n) === query.id);
    // Classes keep extra room between them for relation edges and their names.
    const classRows = classes.length ? (classes.length - 1) * CLASS_STEP + 1 : 0;
    const rows = Math.max(classRows, fields.length);
    classes.forEach((n, i) => y.set(n.id, (offset + i * CLASS_STEP + (rows - classRows) / 2) * ROW));
    fields.forEach((n, i) => y.set(n.id, (offset + i + (rows - fields.length) / 2) * ROW));
    if (rows) offset += rows + 0.6;
  }
  const flowing = nodes.filter((n) => n.kind === "operation" || n.kind === "output").sort((a, b) => column(a) - column(b));
  for (const node of flowing) {
    const ys = (inputs.get(node.id) ?? []).map((source) => y.get(source)).filter((v): v is number => v !== undefined);
    y.set(node.id, ys.length ? ys.reduce((sum, v) => sum + v, 0) / ys.length : 0);
  }
  // Nodes sharing a column keep at least one row apart.
  const columns = new Map<number, GraphNode[]>();
  for (const node of nodes) columns.set(column(node), [...(columns.get(column(node)) ?? []), node]);
  for (const group of columns.values()) {
    group.sort((a, b) => (y.get(a.id) ?? 0) - (y.get(b.id) ?? 0));
    for (let i = 1; i < group.length; i++) {
      const previous = y.get(group[i - 1].id) ?? 0;
      if ((y.get(group[i].id) ?? 0) - previous < ROW) y.set(group[i].id, previous + ROW);
    }
  }
  // Columns are as wide as their widest node, so boxes never overlap at scale 1.
  const widths: number[] = [];
  for (const [index, group] of columns) widths[index] = Math.max(...group.map((n) => boxWidth(n.label, textWidth)));
  const centers: number[] = [];
  let left = 0;
  widths.forEach((width = 0, index) => {
    centers[index] = left + width / 2;
    left += width + GAP;
  });
  const ys = nodes.map((n) => y.get(n.id) ?? 0);
  const top = Math.min(...ys) - NODE_HEIGHT / 2 - MARGIN;
  const bottom = Math.max(...ys) + NODE_HEIGHT / 2 + MARGIN;
  const width = Math.max(0, left - GAP) + MARGIN * 2;
  return {
    x: (node: GraphNode) => (centers[column(node)] ?? 0) + MARGIN,
    y: (node: GraphNode) => (y.get(node.id) ?? 0) - top,
    width,
    height: bottom - top,
  };
}

/** The graph's natural pixel size; the canvas uses it so nodes keep their size and scroll if needed. */
export function subgraphSize(graph: QuerySubgraph, textWidth: (label: string) => number) {
  const { width, height } = layout(graph, textWidth);
  return { width, height };
}

function detail(node: GraphNode) {
  if (node.kind === "class") return node.className;
  if (node.kind === "field") return node.attrName;
  if (node.kind === "operation") return node.expression;
  return node.key;
}

/** The ECharts option for the graph; `escape` makes labels safe inside HTML tooltips. */
export function subgraphOption(
  graph: QuerySubgraph,
  colors: SubgraphColors,
  textWidth: (label: string) => number,
  escape: (value: string) => string,
) {
  const { x, y, width: canvasWidth, height: canvasHeight } = layout(graph, textWidth);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const filtered = new Set(graph.filters.flatMap((filter) => filter.targetIds));
  const width = (label: string) => boxWidth(label, textWidth);
  const nodes = graph.nodes.map((node) => ({
    id: node.id,
    name: node.label,
    x: x(node),
    y: y(node),
    symbol: "roundRect",
    symbolSize: [width(node.label), NODE_HEIGHT],
    itemStyle: {
      color: node.kind === "class" ? colors.class : colors.surface,
      borderColor: colors[node.kind],
      borderWidth: 1.5,
      borderType: filtered.has(node.id) ? "dashed" : "solid",
    },
    label: {
      show: true,
      color: node.kind === "class" ? colors.surface : colors.text,
      fontSize: 12,
      width: width(node.label) - 12,
      overflow: "truncate",
    },
    tooltip: { formatter: `${escape(node.label)}<br/>${escape(detail(node))}` },
  }));
  // ECharts turns mid-edge labels along the line; relation names sit on their own anchor at the
  // edge's midpoint instead, so they stay horizontal.
  const relationLabels: object[] = [];
  const links = graph.edges.map((edge) => {
    if (edge.kind === "relation") {
      const hops = edge.hops.min === 1 && edge.hops.max === 1 ? "" : ` [${edge.hops.min}–${edge.hops.max ?? "∞"}]`;
      const from = byId.get(edge.source)!, to = byId.get(edge.target)!;
      relationLabels.push({
        id: `relation-label:${edge.id}`,
        name: `${edge.label}${hops}`,
        x: (x(from) + x(to)) / 2,
        y: (y(from) + y(to)) / 2,
        symbol: "rect",
        symbolSize: 1,
        itemStyle: { color: "transparent" },
        silent: true,
        label: { show: true, color: colors.muted, fontSize: 11, backgroundColor: colors.surface, padding: [1, 4] },
        tooltip: { show: false },
      });
      return {
        source: edge.source,
        target: edge.target,
        symbol: edge.direction === "forward" ? ["none", "arrow"] : edge.direction === "reverse" ? ["arrow", "none"] : ["arrow", "arrow"],
        lineStyle: { color: colors.class, width: 1.5, opacity: 0.9 },
        tooltip: { formatter: `${escape(edge.label + hops)}<br/>${escape(`${edge.name} · ${edge.relationType}`)}` },
      };
    }
    if (edge.kind === "contains")
      return { source: edge.source, target: edge.target, symbol: ["none", "none"], lineStyle: { color: colors.line, width: 1 } };
    return {
      source: edge.source,
      target: edge.target,
      symbol: ["none", "arrow"],
      lineStyle: { color: colors.muted, width: 1, type: edge.role === "value" ? "solid" : "dashed" },
      label: { show: Boolean(edge.label), formatter: edge.label, color: colors.muted, fontSize: 11 },
    };
  });
  return {
    tooltip: { confine: true },
    series: [{
      type: "graph",
      layout: "none",
      // Two invisible corner anchors make the graph's extent equal the canvas, so it draws at scale 1.
      left: 0, right: 0, top: 0, bottom: 0,
      edgeSymbolSize: 7,
      data: [...nodes, ...relationLabels, ...[[0, 0], [canvasWidth, canvasHeight]].map(([ax, ay], index) => ({
        id: `frame:${index}`, name: "", x: ax, y: ay, symbol: "rect", symbolSize: 0, silent: true, label: { show: false }, tooltip: { show: false },
      }))],
      links,
      emphasis: { focus: "adjacency" },
    }],
  };
}
