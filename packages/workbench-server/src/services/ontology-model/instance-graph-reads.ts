import { z } from "zod";
import type { PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import {
  platformOntologyEdgeSchema, platformOntologyNodeRefSchema,
  type PlatformOntologyEdge, type PlatformOntologyNode, type PlatformOntologyNodeRef,
} from "@ontomato/contracts/platform-ontology-data";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { tForLocale } from "../../i18n";
import { backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";

const graphReply = z.discriminatedUnion("success", [
  z.object({ success: z.literal(false), code: z.string().optional(), message: z.string() }),
  z.object({ success: z.literal(true), status: z.enum(["READY", "GENERATING", "NOT_GENERATED"]), data: z.unknown() }),
]);
const rawNode = z.object({
  class: z.string(), primaryKey: z.string(), name: z.string().nullish(), classLabel: z.string().nullish(),
});
const rawEdge = z.object({
  from: platformOntologyNodeRefSchema,
  to: platformOntologyNodeRefSchema,
  type: platformOntologyEdgeSchema.shape.relationKind,
});
const rawClassCount = z.object({ class: z.string(), instanceCount: z.number().int().nonnegative() });
const rawConnections = z.object({
  overviewEdges: z.array(rawEdge), overviewEdgesTruncated: z.boolean(),
});
const rawOverview = rawConnections.partial().extend({
  classes: z.array(rawClassCount.extend({
    classLabel: z.string().nullish(), sampleCount: z.number().int().nonnegative(),
  })),
  overviewNodes: z.array(rawNode),
  version: z.string(), sampleToken: z.string(),
  nodeCount: z.number().int().nonnegative(), edgeCount: z.number().int().nonnegative().nullish(),
  relationTypes: z.array(z.string()),
});
const rawStatistics = z.object({ classes: z.array(rawClassCount) });
const rawSearch = z.object({
  nodes: z.array(rawNode), total: z.number().int().nonnegative(), hasMore: z.boolean(),
});
const rawNeighbors = z.object({
  nodes: z.array(rawNode).nonempty(), edges: z.array(rawEdge),
  nextOffset: z.number().int().nonnegative().nullish(), total: z.number().int().nonnegative().nullish(),
  version: z.string(),
});

function toNode(raw: z.infer<typeof rawNode>): PlatformOntologyNode {
  return {
    className: raw.class, primaryKey: raw.primaryKey,
    label: raw.name ?? raw.primaryKey, typeLabel: raw.classLabel ?? raw.class, layer: "fact",
  };
}

function toEdge({ from, to, type }: z.infer<typeof rawEdge>, direction: PlatformOntologyEdge["direction"] = "outgoing"): PlatformOntologyEdge {
  return {
    id: JSON.stringify([type, from.className, from.primaryKey, to.className, to.primaryKey, direction]),
    from, to, relationKind: type, direction, derived: false,
  };
}

export function createInstanceGraphReadAdapter(viewer: AssistantCredentials) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  const text = (field: string) => tForLocale(viewer.locale, `panels.objectDetail.${field}`);

  async function read(operation: string, body?: Record<string, unknown>) {
    const url = `${config.dataQuery.baseUrl}/data/instanceGraph/${operation}`;
    const response = body === undefined
      ? await backendGet(`instance-graph-${operation}`, url, options)
      : await backendPost(`instance-graph-${operation}`, url, body, options);
    const answer = graphReply.parse(JSON.parse(response.text));
    if (!answer.success) {
      const conflict = answer.code === "GRAPH_VERSION_CHANGED";
      throw new HttpError(conflict ? 409 : 502, answer.message, answer.code ?? "INSTANCE_GRAPH_READ_FAILED");
    }
    return answer;
  }

  async function ready(operation: string, body?: Record<string, unknown>): Promise<unknown> {
    const answer = await read(operation, body);
    if (answer.status !== "READY") throw new HttpError(409, text("graphUnavailable"), "INSTANCE_GRAPH_UNAVAILABLE");
    return answer.data;
  }

  return {
    async overview() {
      const { status, data } = await read("nodes");
      if (status !== "READY") return { status, groups: [], nodes: [] };
      const graph = rawOverview.parse(data);
      return {
        status, version: graph.version, sampleToken: graph.sampleToken,
        nodeCount: graph.nodeCount, edgeCount: graph.edgeCount,
        relationTypes: graph.relationTypes,
        groups: graph.classes.map(group => ({
          id: group.class, label: group.classLabel ?? group.class,
          totalCount: group.instanceCount, sampleCount: group.sampleCount,
        })),
        nodes: graph.overviewNodes.map(toNode),
        edges: graph.overviewEdges?.map(edge => toEdge(edge)),
        edgesTruncated: graph.overviewEdgesTruncated,
      };
    },
    async connections(version: string, sampleToken?: string) {
      const graph = rawConnections.extend({ version: z.string() }).parse(await ready("connections", { version, sampleToken }));
      return { version: graph.version, edges: graph.overviewEdges.map(edge => toEdge(edge)), truncated: graph.overviewEdgesTruncated };
    },
    async statistics() {
      const graph = rawStatistics.parse(await ready("statistics"));
      return { counts: graph.classes.map(item => ({ type: item.class, layer: "fact", status: "ok", count: item.instanceCount })) };
    },
    async search(term?: string, className?: string, version?: string): Promise<PanelRecordQuery> {
      const graph = rawSearch.parse(await ready("search", { term, class: className, version }));
      const fieldLabels = { className: text("className"), classLabel: text("classLabel"), primaryKey: text("primaryKey") };
      const rows = graph.nodes.map(toNode).map(node => ({
        className: node.className, primaryKey: node.primaryKey, label: node.label,
        fields: { className: node.className, classLabel: node.typeLabel ?? node.className, primaryKey: node.primaryKey },
        fieldLabels,
      }));
      return { rows, fieldLabels, total: graph.total, hasMore: graph.hasMore };
    },
    async neighbors(node: PlatformOntologyNodeRef, params: {
      relationKinds?: readonly string[]; targetClass?: string;
      direction?: "incoming" | "outgoing" | "both"; limit?: number; offset?: number;
    }) {
      const { targetClass, ...filters } = params;
      const graph = rawNeighbors.parse(await ready("neighborhood", { node, neighborClass: targetClass, ...filters }));
      const [center, ...neighbors] = graph.nodes.map(toNode);
      const edges = graph.edges.map(edge => toEdge(edge,
        edge.from.className === node.className && edge.from.primaryKey === node.primaryKey ? "outgoing" : "incoming"));
      const counts = new Map<string, number>();
      for (const edge of edges) counts.set(edge.relationKind, (counts.get(edge.relationKind) ?? 0) + 1);
      return {
        node: center, neighbors, edges,
        relations: [...counts].map(([relationKind, edgeCount]) => ({
          relationKind, edgeCount, status: "ok", truncated: graph.nextOffset != null,
        })),
        nextOffset: graph.nextOffset ?? null, total: graph.total ?? null, version: graph.version,
      };
    },
  };
}
