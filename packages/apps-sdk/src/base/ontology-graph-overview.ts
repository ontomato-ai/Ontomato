import type { GraphCanvasEdge, GraphCanvasNode, GraphCanvasPoint } from "@ontomato/foundation-ui/graph/g6";

const GOLDEN_ANGLE = 2.399963229728653;
const CLUSTER_SPIRAL_STEP = 28;
const CLUSTER_MIN_GAP = 520;
const CLUSTER_PADDING = 120;
const HEADING_GAP = 16;
const HEADING_OBSTACLE_MARGIN = 8;
const LARGE_GRAPH_NODE_LIMIT = 1000;
const LARGE_GRAPH_EDGE_LIMIT = 2000;

export interface OverviewNodeInput {
  readonly id: string;
  readonly groupId: string;
  readonly label: string;
}

export interface OverviewEdgeInput {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relationKind: string;
  readonly label?: string;
  readonly derived?: boolean;
}

export interface OverviewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OverviewHeadingInput {
  readonly id: string;
  readonly label: string;
  readonly countText: string;
  readonly bounds: OverviewRect;
  readonly width: number;
  readonly height: number;
}

export interface OverviewHeadingPlacement {
  readonly id: string;
  readonly label: string;
  readonly countText: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AggregatedOverviewEdge extends GraphCanvasEdge {
  readonly relationKind: string;
  readonly count?: number;
  readonly aggregated: boolean;
}

export interface AggregatedOverviewGraph {
  readonly anchors: GraphCanvasNode[];
  readonly edges: AggregatedOverviewEdge[];
}

export interface AggregatedOverviewOptions {
  readonly selectedNodeId?: string | null;
  readonly formatAggregatedLabel?: (relationKind: string, count: number, sampleLabel?: string) => string | undefined;
  readonly formatDirectLabel?: (edge: OverviewEdgeInput) => string | undefined;
}

/**
 * Reports whether a graph exceeds the clustered-layout threshold and should fall back to a plain grid layout.
 */
export function isLargeGraph(nodeCount: number, edgeCount: number): boolean {
  return nodeCount > LARGE_GRAPH_NODE_LIMIT || edgeCount > LARGE_GRAPH_EDGE_LIMIT;
}

/**
 * Deterministic grid fallback layout for large graphs where clustered or radial placement is unnecessary.
 */
export function layoutGrid(
  nodeIds: readonly string[],
  spacingX = 160,
  spacingY = 120,
): Map<string, GraphCanvasPoint> {
  const positions = new Map<string, GraphCanvasPoint>();
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodeIds.length)));
  nodeIds.forEach((id, index) => {
    positions.set(id, {
      x: (index % columns) * spacingX,
      y: Math.floor(index / columns) * spacingY,
    });
  });
  return positions;
}

/**
 * Places a paginated neighbor at a deterministic golden-angle spiral offset around `center`.
 */
export function placeRadialNeighbor(
  index: number,
  center: GraphCanvasPoint,
  baseRadius = 180,
  radiusStep = 45,
): GraphCanvasPoint {
  const angle = index * GOLDEN_ANGLE;
  const radius = baseRadius + Math.sqrt(Math.max(0, index)) * radiusStep;
  return {
    x: Math.round(center.x + Math.cos(angle) * radius),
    y: Math.round(center.y + Math.sin(angle) * radius),
  };
}

/**
 * Arranges sampled overview nodes into per-group spiral clusters placed in a balanced grid.
 * When `groupOrder` is supplied, declared groups are ordered first, followed by any remaining groups sorted by ID.
 */
export function layoutGroupedOverview(
  nodes: readonly OverviewNodeInput[],
  groupOrder?: readonly string[],
): Map<string, GraphCanvasPoint> {
  const groups = new Map<string, OverviewNodeInput[]>();
  for (const node of nodes) {
    let bucket = groups.get(node.groupId);
    if (!bucket) {
      bucket = [];
      groups.set(node.groupId, bucket);
    }
    bucket.push(node);
  }

  const orderedGroups: string[] = [];
  if (groupOrder) {
    for (const id of groupOrder) {
      if (groups.has(id) && !orderedGroups.includes(id)) orderedGroups.push(id);
    }
  }
  const remaining = [...groups.keys()].filter((id) => !orderedGroups.includes(id)).sort();
  orderedGroups.push(...remaining);

  const positions = new Map<string, GraphCanvasPoint>();
  if (orderedGroups.length === 0) return positions;

  const columns = Math.max(1, Math.ceil(Math.sqrt(orderedGroups.length)));
  const rows = Math.ceil(orderedGroups.length / columns);
  const clusterRadius = (groupId: string) =>
    CLUSTER_SPIRAL_STEP * Math.sqrt(Math.max(0, (groups.get(groupId)?.length ?? 0) - 1));

  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);
  orderedGroups.forEach((groupId, index) => {
    const diameter = clusterRadius(groupId) * 2;
    const col = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[col] = Math.max(columnWidths[col]!, diameter);
    rowHeights[row] = Math.max(rowHeights[row]!, diameter);
  });

  const centers = (sizes: readonly number[]): number[] =>
    sizes.reduce<number[]>((result, size, index) => {
      result.push(
        index === 0 ? 0 : result[index - 1]! + Math.max(CLUSTER_MIN_GAP, (sizes[index - 1]! + size) / 2 + CLUSTER_PADDING),
      );
      return result;
    }, []);

  const xCenters = centers(columnWidths);
  const yCenters = centers(rowHeights);

  orderedGroups.forEach((groupId, groupIndex) => {
    const items = groups.get(groupId)!;
    const centerX = xCenters[groupIndex % columns]!;
    const centerY = yCenters[Math.floor(groupIndex / columns)]!;
    items.forEach((node, index) => {
      const angle = index * GOLDEN_ANGLE;
      const radius = CLUSTER_SPIRAL_STEP * Math.sqrt(index);
      positions.set(node.id, {
        x: Math.round(centerX + Math.cos(angle) * radius),
        y: Math.round(centerY + Math.sin(angle) * radius),
      });
    });
  });

  return positions;
}

/**
 * Places cluster headings above (or below if blocked) their group bounding box while avoiding nodes, toolbars,
 * previously placed headings, and viewport edges. Omits any heading that cannot fit without overlap.
 */
export function placeGroupHeadings(
  groups: readonly OverviewHeadingInput[],
  obstacles: readonly OverviewRect[],
  viewport?: OverviewRect,
): OverviewHeadingPlacement[] {
  const placed: OverviewRect[] = [];
  const sorted = [...groups].sort((a, b) => a.bounds.y - b.bounds.y || a.id.localeCompare(b.id));
  const result: OverviewHeadingPlacement[] = [];

  for (const group of sorted) {
    const x = group.bounds.x + (group.bounds.width - group.width) / 2;
    const aboveY = group.bounds.y - HEADING_GAP - group.height;
    const belowY = group.bounds.y + group.bounds.height + HEADING_GAP;

    const fits = (y: number): boolean => {
      if (
        viewport
        && (x < viewport.x
          || x + group.width > viewport.x + viewport.width
          || y < viewport.y
          || y + group.height > viewport.y + viewport.height)
      ) {
        return false;
      }
      for (const rect of obstacles) {
        if (
          x < rect.x + rect.width + HEADING_OBSTACLE_MARGIN
          && x + group.width > rect.x - HEADING_OBSTACLE_MARGIN
          && y < rect.y + rect.height + HEADING_OBSTACLE_MARGIN
          && y + group.height > rect.y - HEADING_OBSTACLE_MARGIN
        ) {
          return false;
        }
      }
      for (const rect of placed) {
        if (
          x < rect.x + rect.width + HEADING_OBSTACLE_MARGIN
          && x + group.width > rect.x - HEADING_OBSTACLE_MARGIN
          && y < rect.y + rect.height + HEADING_OBSTACLE_MARGIN
          && y + group.height > rect.y - HEADING_OBSTACLE_MARGIN
        ) {
          return false;
        }
      }
      return true;
    };

    let y = aboveY;
    if (!fits(aboveY)) {
      if (!fits(belowY)) continue;
      y = belowY;
    }

    placed.push({ x, y, width: group.width, height: group.height });
    result.push({
      id: group.id,
      label: group.label,
      countText: group.countText,
      x,
      y,
      width: group.width,
      height: group.height,
    });
  }

  return result;
}

/** Deterministic anchor ID for an overview group's invisible center node. */
export function overviewGroupAnchorId(groupId: string): string {
  return `overview-group:${JSON.stringify(groupId)}`;
}

/** Returns true when a canvas node ID represents a synthetic overview group anchor. */
export function isOverviewGroupAnchorId(id: string): boolean {
  return id.startsWith("overview-group:");
}

/**
 * Aggregates sample overview edges by `(sourceGroup, targetGroup, relationKind)` and creates invisible center anchors
 * per group. When a node is selected, aggregated edges fade to `"muted"` and the selected node's direct edges are
 * overlaid in `"default"` tone.
 */
export function buildAggregatedOverviewEdges(
  nodes: readonly OverviewNodeInput[],
  edges: readonly OverviewEdgeInput[],
  positions: ReadonlyMap<string, GraphCanvasPoint>,
  options: AggregatedOverviewOptions = {},
): AggregatedOverviewGraph {
  const { selectedNodeId = null, formatAggregatedLabel, formatDirectLabel } = options;
  const groupByNodeId = new Map(nodes.map((node) => [node.id, node.groupId]));
  const bucketMap = new Map<string, {
    sourceGroup: string;
    targetGroup: string;
    relationKind: string;
    sampleLabel?: string;
    count: number;
    allDerived: boolean;
  }>();

  for (const edge of edges) {
    const sourceGroup = groupByNodeId.get(edge.source);
    const targetGroup = groupByNodeId.get(edge.target);
    if (sourceGroup === undefined || targetGroup === undefined) continue;
    const key = JSON.stringify([sourceGroup, targetGroup, edge.relationKind]);
    const existing = bucketMap.get(key);
    if (existing) {
      existing.count += 1;
      existing.allDerived = existing.allDerived && Boolean(edge.derived);
      if (!existing.sampleLabel && edge.label) existing.sampleLabel = edge.label;
    } else {
      bucketMap.set(key, {
        sourceGroup,
        targetGroup,
        relationKind: edge.relationKind,
        sampleLabel: edge.label,
        count: 1,
        allDerived: Boolean(edge.derived),
      });
    }
  }

  const groupIds = [...new Set(nodes.map((node) => node.groupId))];
  const anchors: GraphCanvasNode[] = groupIds.map((groupId) => {
    const points: GraphCanvasPoint[] = [];
    for (const node of nodes) {
      if (node.groupId !== groupId) continue;
      const point = positions.get(node.id);
      if (point) points.push(point);
    }
    const x = points.length
      ? (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2
      : 0;
    const y = points.length
      ? (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2
      : 0;
    const radius = Math.max(0, ...points.map((point) => Math.hypot(point.x - x, point.y - y)));
    return {
      id: overviewGroupAnchorId(groupId),
      label: "",
      anchor: { radius },
      x,
      y,
    };
  });

  const aggregatedEdges: AggregatedOverviewEdge[] = [...bucketMap.entries()].map(([key, entry]) => ({
    id: `overview-aggregated:${key}`,
    source: overviewGroupAnchorId(entry.sourceGroup),
    target: overviewGroupAnchorId(entry.targetGroup),
    relationKind: entry.relationKind,
    count: entry.count,
    weight: entry.count,
    line: entry.allDerived ? "dashed" : "solid",
    tone: selectedNodeId ? "muted" : "default",
    label: formatAggregatedLabel
      ? formatAggregatedLabel(entry.relationKind, entry.count, entry.sampleLabel)
      : entry.sampleLabel,
    aggregated: true,
  }));

  const directEdges: AggregatedOverviewEdge[] = selectedNodeId
    ? edges
      .filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)
      .map((edge, index) => ({
        id: `overview-direct:${edge.id}:${index}`,
        source: edge.source,
        target: edge.target,
        relationKind: edge.relationKind,
        line: edge.derived ? "dashed" : "solid",
        tone: "default",
        label: formatDirectLabel ? formatDirectLabel(edge) : edge.label,
        aggregated: false,
      }))
    : [];

  return {
    anchors,
    edges: [...aggregatedEdges, ...directEdges],
  };
}

/**
 * Safely parses a personal `positions` JSON value into a map of valid finite coordinates.
 */
export function sanitizeSavedPositions(raw: unknown): Map<string, GraphCanvasPoint> {
  const result = new Map<string, GraphCanvasPoint>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && typeof (value as { x?: unknown }).x === "number"
      && typeof (value as { y?: unknown }).y === "number"
      && Number.isFinite((value as { x: number }).x)
      && Number.isFinite((value as { y: number }).y)
    ) {
      result.set(key, {
        x: (value as { x: number }).x,
        y: (value as { y: number }).y,
      });
    }
  }
  return result;
}

/**
 * Merges saved per-person node coordinates over computed layout positions, keeping layout coordinates for new nodes.
 */
export function mergeNodePositions(
  computed: ReadonlyMap<string, GraphCanvasPoint>,
  saved: ReadonlyMap<string, GraphCanvasPoint>,
  nodeIds: readonly string[],
): Map<string, GraphCanvasPoint> {
  const merged = new Map<string, GraphCanvasPoint>();
  for (const id of nodeIds) {
    merged.set(id, saved.get(id) ?? computed.get(id) ?? { x: 0, y: 0 });
  }
  return merged;
}
