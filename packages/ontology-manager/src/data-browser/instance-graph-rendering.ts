import type { GraphCanvasEdge, GraphCanvasNode } from "@ontomato/foundation-ui/graph/g6";
import type { InstanceGraphEdge, InstanceGraphNode } from "../api";

/** A neighbourhood this large is relaid out on a plain grid: clustering it by class is not worth the wait. */
export function isLargeInstanceGraph(nodeCount: number, edgeCount: number) {
  return nodeCount > 1000 || edgeCount > 2000;
}

export function instanceNodePosition(index: number, nodeCount: number) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodeCount)));
  return { x: (index % columns) * 160, y: Math.floor(index / columns) * 120 };
}

export function neighborNodePosition(index: number, center: { x: number; y: number }) {
  const angle = index * 2.399963229728653;
  const radius = 180 + Math.sqrt(index) * 45;
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
}

export interface OverviewRect { x: number; y: number; width: number; height: number }

/** Keep headings near their cluster and omit them when neither side has room. */
export function overviewClassHeadings(
  groups: Array<{ name: string; bounds: OverviewRect; width: number; height: number }>,
  instances: OverviewRect[],
  viewport?: OverviewRect,
) {
  const placed: OverviewRect[] = [];
  return [...groups].sort((a, b) => a.bounds.y - b.bounds.y || a.name.localeCompare(b.name)).flatMap((group) => {
    const heading = {
      name: group.name,
      x: group.bounds.x + (group.bounds.width - group.width) / 2,
      y: group.bounds.y - 16 - group.height,
      width: group.width,
      height: group.height,
    };
    const obstacles = [...instances, ...placed];
    const fits = (y: number) => (!viewport || (heading.x >= viewport.x
      && heading.x + heading.width <= viewport.x + viewport.width
      && y >= viewport.y && y + heading.height <= viewport.y + viewport.height))
      && !obstacles.some((rect) => heading.x < rect.x + rect.width + 8
        && heading.x + heading.width > rect.x - 8
        && y < rect.y + rect.height + 8 && y + heading.height > rect.y - 8);
    const above = heading.y;
    const below = group.bounds.y + group.bounds.height + 16;
    if (!fits(above)) {
      if (!fits(below)) return [];
      heading.y = below;
    }
    placed.push(heading);
    return [heading];
  });
}

export function overviewPositions(nodes: InstanceGraphNode[]) {
  const groups = new Map<string, InstanceGraphNode[]>();
  nodes.forEach((node) => groups.set(node.class, [...(groups.get(node.class) || []), node]));
  const classes = [...groups.keys()].sort();
  const columns = Math.max(1, Math.ceil(Math.sqrt(classes.length)));
  const clusterRadius = (className: string) => 28 * Math.sqrt(Math.max(0, groups.get(className)!.length - 1));
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: Math.ceil(classes.length / columns) }, () => 0);
  classes.forEach((className, index) => {
    const diameter = clusterRadius(className) * 2;
    columnWidths[index % columns] = Math.max(columnWidths[index % columns], diameter);
    rowHeights[Math.floor(index / columns)] = Math.max(rowHeights[Math.floor(index / columns)], diameter);
  });
  const centers = (sizes: number[]) => sizes.reduce<number[]>((result, size, index) => {
    result.push(index === 0 ? 0 : result[index - 1] + Math.max(520, (sizes[index - 1] + size) / 2 + 120));
    return result;
  }, []);
  const xCenters = centers(columnWidths);
  const yCenters = centers(rowHeights);
  const positions: Record<string, { x: number; y: number }> = {};
  classes.forEach((className, groupIndex) => {
    const items = groups.get(className)!;
    items.forEach((node, index) => {
      const angle = index * 2.399963229728653;
      const radius = 28 * Math.sqrt(index);
      positions[node.id] = { x: xCenters[groupIndex % columns] + Math.cos(angle) * radius,
        y: yCenters[Math.floor(groupIndex / columns)] + Math.sin(angle) * radius };
    });
  });
  return positions;
}

export function overviewAnchorId(className: string) {
  return `overview-class:${JSON.stringify(className)}`;
}

/** An overview relation as the page labels it: the instance edge's type, and how many sample edges it stands for. */
export interface OverviewRelation extends GraphCanvasEdge {
  type?: string;
  count?: number;
}

/**
 * The overview's relations between classes, aggregated from the loaded sample edges only — counts never imply
 * datasource totals. Each class gets an anchor in the middle of its cluster for the aggregated edges to end at; the
 * selected instance's own edges are drawn on top, and the aggregated ones fade behind them.
 */
export function overviewRelations(
  nodes: InstanceGraphNode[], edges: InstanceGraphEdge[],
  positions: Record<string, { x: number; y: number }>, selectedId = "",
): { anchors: GraphCanvasNode[]; edges: OverviewRelation[] } {
  const classes = new Map(nodes.map((node) => [node.id, node.class]));
  const groups = new Map<string, OverviewRelation>();
  for (const edge of edges) {
    const source = classes.get(edge.source), target = classes.get(edge.target);
    if (source == null || target == null) continue;
    const key = JSON.stringify([source, target, edge.type ?? ""]);
    const group = groups.get(key);
    if (group) group.count! += 1;
    else groups.set(key, {
      id: `overview-relation:${key}`, source: overviewAnchorId(source), target: overviewAnchorId(target),
      type: edge.type, count: 1, weight: 1, tone: selectedId ? "muted" : "default",
    });
  }
  for (const group of groups.values()) group.weight = group.count;
  const anchors = [...new Set(classes.values())].map((name) => {
    const points = nodes.filter((node) => node.class === name).map((node) => positions[node.id]).filter(Boolean);
    const x = points.length ? (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2 : 0;
    const y = points.length ? (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2 : 0;
    const radius = Math.max(0, ...points.map((point) => Math.hypot(point.x - x, point.y - y)));
    return { id: overviewAnchorId(name), label: "", anchor: { radius }, x, y };
  });
  const direct = edges.filter((edge) => edge.source === selectedId || edge.target === selectedId);
  return { anchors, edges: [...groups.values(), ...direct.map((edge, index) => ({
    id: `overview-direct:${index}`, source: edge.source, target: edge.target, type: edge.type,
  }))] };
}
