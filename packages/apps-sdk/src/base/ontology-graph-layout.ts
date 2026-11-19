import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";
import type { GraphCanvasPoint } from "@ontomato/foundation-ui/graph/g6";
import type {
  PlatformGraphRelationStatus,
  PlatformGraphTypeSpec,
} from "../panel/platform-objects";

type PanelObjectValue = Extract<PanelStateValue, { className: string }>;

const COLUMN_GAP = 280;
const ROW_GAP = 76;
const RING_BASE_RADIUS = 220;
const RING_STEP_RADIUS = 150;
const MAX_PER_RING = 12;
const MIN_NODE_DISTANCE = 110;

/** Collision-free canvas node ID encoding a node's full `{ className, primaryKey }` identity. */
export function encodeGraphNodeId(ref: PanelObjectValue): string {
  return JSON.stringify([ref.className, ref.primaryKey]);
}

/**
 * Places type-mode nodes in vertical columns ordered by declared layers (e.g. fact -> capability -> governance ->
 * product), centering each column vertically so sparse layers align cleanly beside dense ones.
 */
export function layoutTypeColumns(
  types: readonly PlatformGraphTypeSpec[],
  layers: readonly string[],
): Map<string, GraphCanvasPoint> {
  const columns = new Map<string, PlatformGraphTypeSpec[]>();
  for (const layer of layers) columns.set(layer, []);
  for (const spec of types) {
    const key = spec.layer ?? "";
    let list = columns.get(key);
    if (!list) {
      list = [];
      columns.set(key, list);
    }
    list.push(spec);
  }

  const ordered = [...columns.entries()].filter(([, items]) => items.length > 0);
  const positions = new Map<string, GraphCanvasPoint>();
  const xOffset = ((ordered.length - 1) * COLUMN_GAP) / 2;

  ordered.forEach(([, items], columnIndex) => {
    const x = Math.round(columnIndex * COLUMN_GAP - xOffset);
    const yOffset = ((items.length - 1) * ROW_GAP) / 2;
    items.forEach((spec, rowIndex) => {
      positions.set(spec.id, {
        x,
        y: Math.round(rowIndex * ROW_GAP - yOffset),
      });
    });
  });

  return positions;
}

function isFree(candidate: GraphCanvasPoint, occupied: readonly GraphCanvasPoint[]): boolean {
  const minSq = MIN_NODE_DISTANCE * MIN_NODE_DISTANCE;
  for (const point of occupied) {
    const dx = candidate.x - point.x;
    const dy = candidate.y - point.y;
    if (dx * dx + dy * dy < minSq) return false;
  }
  return true;
}

/**
 * Places newly expanded neighbor nodes around `anchor` without moving any already-drawn node.
 * When expanding away from `origin`, fans outward along the anchor's radial direction; when expanding at `origin`,
 * distributes evenly in full circles.
 */
export function placeExpandedNeighbors(
  anchor: GraphCanvasPoint,
  origin: GraphCanvasPoint,
  newIds: readonly string[],
  existing: ReadonlyMap<string, GraphCanvasPoint>,
): Map<string, GraphCanvasPoint> {
  const result = new Map(existing);
  const occupied = [...existing.values()];
  const atOrigin = anchor.x === origin.x && anchor.y === origin.y;
  const baseAngle = atOrigin ? -Math.PI / 2 : Math.atan2(anchor.y - origin.y, anchor.x - origin.x);

  newIds.forEach((id, index) => {
    if (result.has(id)) return;
    const ring = Math.floor(index / MAX_PER_RING);
    const indexInRing = index % MAX_PER_RING;
    const countInRing = Math.min(MAX_PER_RING, newIds.length - ring * MAX_PER_RING);
    const radius = RING_BASE_RADIUS + ring * RING_STEP_RADIUS;
    const spread = atOrigin ? Math.PI * 2 : Math.min(Math.PI * 1.4, Math.max(Math.PI / 2, countInRing * 0.42));
    const step = atOrigin ? spread / countInRing : countInRing > 1 ? spread / (countInRing - 1) : 0;
    const angle = atOrigin
      ? baseAngle + indexInRing * step
      : baseAngle - spread / 2 + indexInRing * step;

    let placed: GraphCanvasPoint = {
      x: Math.round(anchor.x + Math.cos(angle) * radius),
      y: Math.round(anchor.y + Math.sin(angle) * radius),
    };
    for (let attempt = 1; attempt <= 10 && !isFree(placed, occupied); attempt++) {
      const shiftedRadius = radius + attempt * 64;
      const shiftedAngle = angle + (attempt % 2 === 0 ? 1 : -1) * 0.18 * Math.ceil(attempt / 2);
      placed = {
        x: Math.round(anchor.x + Math.cos(shiftedAngle) * shiftedRadius),
        y: Math.round(anchor.y + Math.sin(shiftedAngle) * shiftedRadius),
      };
    }
    result.set(id, placed);
    occupied.push(placed);
  });

  return result;
}

/** Recomputes a clean concentric BFS layout centered on `rootId` for the Relayout action. */
export function layoutInstanceRadial(
  rootId: string,
  nodeIds: readonly string[],
  edges: readonly { source: string; target: string }[],
): Map<string, GraphCanvasPoint> {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }

  const depth = new Map<string, number>();
  const queue: string[] = [];
  if (adjacency.has(rootId)) {
    depth.set(rootId, 0);
    queue.push(rootId);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    const nextDepth = depth.get(current)! + 1;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!depth.has(neighbor)) {
        depth.set(neighbor, nextDepth);
        queue.push(neighbor);
      }
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  for (const id of nodeIds) {
    if (!depth.has(id)) depth.set(id, maxDepth + 1);
  }

  const byRing = new Map<number, string[]>();
  for (const id of nodeIds) {
    const ring = depth.get(id)!;
    let bucket = byRing.get(ring);
    if (!bucket) {
      bucket = [];
      byRing.set(ring, bucket);
    }
    bucket.push(id);
  }

  const positions = new Map<string, GraphCanvasPoint>();
  for (const [ring, ids] of byRing) {
    if (ring === 0) {
      positions.set(ids[0]!, { x: 0, y: 0 });
      continue;
    }
    const radius = ring * RING_BASE_RADIUS;
    const step = (Math.PI * 2) / ids.length;
    ids.forEach((id, index) => {
      const angle = -Math.PI / 2 + index * step;
      positions.set(id, {
        x: Math.round(Math.cos(angle) * radius),
        y: Math.round(Math.sin(angle) * radius),
      });
    });
  }
  return positions;
}

export interface GraphRelationSummary {
  readonly noNeighbors: boolean;
  readonly refused: readonly PlatformGraphRelationStatus[];
  readonly failed: readonly PlatformGraphRelationStatus[];
  readonly unavailable: readonly PlatformGraphRelationStatus[];
}

/** Separates per-relation outcomes into no-neighbors, owner-refused, read-failed and unavailable states. */
export function summarizeGraphRelations(relations: readonly PlatformGraphRelationStatus[]): GraphRelationSummary {
  const refused = relations.filter((item) => item.status === "refused");
  const failed = relations.filter((item) => item.status === "failed");
  const unavailable = relations.filter((item) => item.status === "unavailable");
  const totalEdges = relations.reduce((sum, item) => sum + item.edgeCount, 0);
  const noNeighbors = refused.length === 0 && failed.length === 0 && totalEdges === 0;
  return { noNeighbors, refused, failed, unavailable };
}
