import type { GraphCanvasEdge, GraphCanvasNode } from "@ontomato/foundation-ui/graph";

/** One node or edge named on a found path or as a path endpoint. */
export interface GraphPathEndpoint {
  readonly id: string;
  readonly label: string;
}

export type DirectedGraphPathResult =
  | { readonly status: "idle" }
  | {
    readonly status: "same-node";
    readonly from: GraphPathEndpoint;
    readonly to: GraphPathEndpoint;
    readonly hops: 0;
    readonly nodeIds: readonly [string];
    readonly edgeIds: readonly [];
    readonly nodes: readonly [GraphPathEndpoint];
    readonly edges: readonly [];
  }
  | {
    readonly status: "found";
    readonly from: GraphPathEndpoint;
    readonly to: GraphPathEndpoint;
    readonly hops: number;
    readonly nodeIds: readonly string[];
    readonly edgeIds: readonly string[];
    readonly nodes: readonly GraphPathEndpoint[];
    readonly edges: readonly GraphPathEndpoint[];
  }
  | {
    readonly status: "not-found";
    readonly from: GraphPathEndpoint;
    readonly to: GraphPathEndpoint;
    readonly hops: null;
    readonly nodeIds: readonly [];
    readonly edgeIds: readonly [];
    readonly nodes: readonly [];
    readonly edges: readonly [];
  };

/**
 * Finds the shortest directed path from `fromId` to `toId` along edges whose both endpoints exist in the currently
 * visible `nodes`. Returns `idle` until both endpoints are supplied, `same-node` (0 hops) when both name the same
 * visible node, `found` with ordered nodes/edges and hop count when reachable, and `not-found` otherwise.
 */
export function findDirectedGraphPath(
  nodes: readonly GraphCanvasNode[],
  links: readonly GraphCanvasEdge[],
  fromId: string | null,
  toId: string | null,
): DirectedGraphPathResult {
  if (!fromId || !toId) return { status: "idle" };

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const endpointOf = (id: string): GraphPathEndpoint => ({ id, label: nodeMap.get(id)?.label ?? id });
  const from = endpointOf(fromId);
  const to = endpointOf(toId);

  if (!nodeMap.has(fromId) || !nodeMap.has(toId)) {
    return { status: "not-found", from, to, hops: null, nodeIds: [], edgeIds: [], nodes: [], edges: [] };
  }
  if (fromId === toId) {
    return { status: "same-node", from, to, hops: 0, nodeIds: [fromId], edgeIds: [], nodes: [from], edges: [] };
  }

  // Adjacency along directed edges whose both ends are drawn in the visible graph.
  const outgoing = new Map<string, GraphCanvasEdge[]>();
  for (const edge of links) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    const list = outgoing.get(edge.source);
    if (list) list.push(edge);
    else outgoing.set(edge.source, [edge]);
  }

  const visited = new Set<string>([fromId]);
  const parent = new Map<string, { prev: string; edge: GraphCanvasEdge }>();
  const queue: string[] = [fromId];
  let cursor = 0;

  while (cursor < queue.length) {
    const current = queue[cursor++]!;
    for (const edge of outgoing.get(current) ?? []) {
      if (visited.has(edge.target)) continue;
      visited.add(edge.target);
      parent.set(edge.target, { prev: current, edge });
      if (edge.target === toId) {
        const nodeIds: string[] = [toId];
        const pathEdges: GraphCanvasEdge[] = [];
        let step = toId;
        while (step !== fromId) {
          const hop = parent.get(step)!;
          pathEdges.push(hop.edge);
          nodeIds.push(hop.prev);
          step = hop.prev;
        }
        nodeIds.reverse();
        pathEdges.reverse();
        return {
          status: "found",
          from,
          to,
          hops: pathEdges.length,
          nodeIds,
          edgeIds: pathEdges.map((item) => item.id),
          nodes: nodeIds.map(endpointOf),
          edges: pathEdges.map((item) => ({ id: item.id, label: item.label || item.id })),
        };
      }
      queue.push(edge.target);
    }
  }

  return { status: "not-found", from, to, hops: null, nodeIds: [], edgeIds: [], nodes: [], edges: [] };
}
