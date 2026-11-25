import { z } from "zod";
import type { PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import {
  platformOntologyEdgeSchema, platformOntologyNodeRefSchema,
  type PlatformOntologyEdge, type PlatformOntologyNode, type PlatformOntologyNodeRef,
  type PlatformOntologyRelationStatus,
} from "@ontomato/contracts/platform-ontology-data";
import { config } from "../../config/application";
import { createLogger } from "../../logging/logger";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { tForLocale } from "../../i18n";
import { backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";

const logger = createLogger("instance-graph-reads");

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
const rawRelationStatus = z.object({
  relationKind: platformOntologyEdgeSchema.shape.relationKind,
  label: z.string().nullish(),
  status: z.enum(["ok", "refused", "failed", "unavailable"]),
  edgeCount: z.number().int().nonnegative(),
  reasonCode: z.string().nullish(),
  truncated: z.boolean().optional(),
});
const rawClassCount = z.object({ class: z.string(), instanceCount: z.number().int().nonnegative() });
const rawConnections = z.object({
  overviewEdges: z.array(rawEdge),
  overviewEdgesTruncated: z.boolean(),
  relations: z.array(rawRelationStatus).optional(),
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
  relations: z.array(rawRelationStatus).optional(),
  nextOffset: z.number().int().nonnegative().nullish(), total: z.number().int().nonnegative().nullish(),
  version: z.string(),
});

const RELATION_REASON_KEYS: Readonly<Record<string, string>> = {
  RELATION_MISSING_JOIN_FIELDS: "relationMissingJoinFields",
  RELATION_GRAPH_TYPE_UNSUPPORTED: "relationGraphTypeUnsupported",
  RELATION_CROSS_SOURCE_UNSUPPORTED: "relationCrossSourceUnsupported",
  RELATION_SOURCE_UNSUPPORTED: "relationSourceUnsupported",
  RELATION_FORBIDDEN: "relationForbidden",
  RELATION_READ_FAILED: "relationReadFailed",
};

function relationReasonText(
  entry: z.infer<typeof rawRelationStatus>,
  text: (field: string) => string,
): string | undefined {
  if (entry.status === "ok") return undefined;
  const mappedKey = entry.reasonCode ? RELATION_REASON_KEYS[entry.reasonCode] : undefined;
  if (mappedKey) return text(mappedKey);
  if (entry.status === "refused") return text("relationForbidden");
  if (entry.status === "unavailable") return text("relationSourceUnsupported");
  return text("relationReadFailed");
}

function toRelationStatus(
  entry: z.infer<typeof rawRelationStatus>,
  text: (field: string) => string,
): PlatformOntologyRelationStatus {
  const reason = relationReasonText(entry, text);
  return {
    relationKind: entry.relationKind,
    ...(entry.label ? { label: entry.label } : {}),
    status: entry.status,
    edgeCount: entry.edgeCount,
    ...(reason ? { reason } : {}),
  };
}

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
      logger.warn("Instance graph read failed", {
        operation,
        code: answer.code ?? "INSTANCE_GRAPH_READ_FAILED",
        ownerMessage: answer.message,
      });
      if (answer.code === "GRAPH_VERSION_CHANGED") {
        throw new HttpError(409, text("graphVersionChanged"), "GRAPH_VERSION_CHANGED");
      }
      if (answer.code === "GRAPH_SAMPLE_EXPIRED") {
        throw new HttpError(409, text("graphSampleExpired"), "GRAPH_SAMPLE_EXPIRED");
      }
      throw new HttpError(502, text("graphReadFailed"), answer.code ?? "INSTANCE_GRAPH_READ_FAILED");
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
        ...(graph.relations ? { relations: graph.relations.map(entry => toRelationStatus(entry, text)) } : {}),
      };
    },
    async connections(version: string, sampleToken?: string) {
      const graph = rawConnections.extend({ version: z.string() }).parse(await ready("connections", { version, sampleToken }));
      return {
        version: graph.version,
        edges: graph.overviewEdges.map(edge => toEdge(edge)),
        truncated: graph.overviewEdgesTruncated,
        ...(graph.relations ? { relations: graph.relations.map(entry => toRelationStatus(entry, text)) } : {}),
      };
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
      const relations = graph.relations
        ? graph.relations.map(entry => ({
          ...toRelationStatus(entry, text),
          ...(entry.truncated !== undefined ? { truncated: entry.truncated } : {}),
        }))
        : (() => {
          const counts = new Map<string, number>();
          for (const edge of edges) counts.set(edge.relationKind, (counts.get(edge.relationKind) ?? 0) + 1);
          return [...counts].map(([relationKind, edgeCount]) => ({
            relationKind, edgeCount, status: "ok" as const, truncated: graph.nextOffset != null,
          }));
        })();
      return {
        node: center, neighbors, edges,
        relations,
        nextOffset: graph.nextOffset ?? null, total: graph.total ?? null, version: graph.version,
      };
    },
  };
}
