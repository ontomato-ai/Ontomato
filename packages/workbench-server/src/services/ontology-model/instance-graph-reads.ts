import { z } from "zod";
import { panelReadParameterSchemas, type PanelRecord, type PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import { OBJECT_TYPE } from "@ontomato/contracts/platform-object-types";
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

function graphText(locale?: string) {
  return (field: string) => tForLocale(locale, `panels.objectDetail.${field}`);
}

function parseGraphReply(payload: unknown, operation: string, text: ReturnType<typeof graphText>) {
  const answer = graphReply.parse(payload);
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

function requireGraphReady(answer: ReturnType<typeof parseGraphReply>, text: ReturnType<typeof graphText>) {
  if (answer.status !== "READY") throw new HttpError(409, text("graphUnavailable"), "INSTANCE_GRAPH_UNAVAILABLE");
  return answer.data;
}

const instanceNeighborsSchema = z.object({
  node: panelReadParameterSchemas.graphNode,
  relationKinds: panelReadParameterSchemas.relationKinds.optional(),
  targetClass: panelReadParameterSchemas.className.optional(),
  direction: panelReadParameterSchemas.neighborDirection.optional(),
  limit: panelReadParameterSchemas.neighborsLimit.optional(),
  offset: panelReadParameterSchemas.nonNegativeInt.optional(),
});
type NeighborFilters = Omit<z.input<typeof instanceNeighborsSchema>, "node" | "relationKinds"> & {
  relationKinds?: readonly string[];
};

export function instanceNeighborsParams(params: Record<string, unknown>) {
  return instanceNeighborsSchema.parse(params);
}

export function instanceNeighborsRequest(node: PlatformOntologyNodeRef, { targetClass, ...filters }: NeighborFilters) {
  return { node, ...(targetClass !== undefined && { neighborClass: targetClass }), ...filters };
}

function renderInstanceNeighbors(node: PlatformOntologyNodeRef, payload: unknown, text: ReturnType<typeof graphText>) {
  const graph = rawNeighbors.parse(payload);
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
}

export function instanceGraphConnectionsRequest(params: Record<string, unknown>) {
  const version = panelReadParameterSchemas.keyword.parse(params.version);
  const sampleToken = panelReadParameterSchemas.keyword.optional().parse(params.sampleToken);
  return { version, ...(sampleToken !== undefined && { sampleToken }) };
}

export function instanceGraphSearchRequest(params: Record<string, unknown>) {
  const term = panelReadParameterSchemas.keyword.optional().parse(params.search);
  const className = panelReadParameterSchemas.className.optional().parse(params.className);
  const version = panelReadParameterSchemas.keyword.optional().parse(params.version);
  return {
    ...(term !== undefined && { term }),
    ...(className !== undefined && { class: className }),
    ...(version !== undefined && { version }),
  };
}

export function createInstanceGraphReadPresenter(locale?: string) {
  const text = graphText(locale);
  const ready = (operation: string, payload: unknown) => requireGraphReady(parseGraphReply(payload, operation, text), text);
  return {
    overview(payload: unknown) {
      const { status, data } = parseGraphReply(payload, "nodes", text);
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
    connections(payload: unknown) {
      const graph = rawConnections.extend({ version: z.string() }).parse(ready("connections", payload));
      return {
        version: graph.version,
        edges: graph.overviewEdges.map(edge => toEdge(edge)),
        truncated: graph.overviewEdgesTruncated,
        ...(graph.relations ? { relations: graph.relations.map(entry => toRelationStatus(entry, text)) } : {}),
      };
    },
    statistics(payload: unknown) {
      const graph = rawStatistics.parse(ready("statistics", payload));
      return { counts: graph.classes.map(item => ({ type: item.class, layer: "fact", status: "ok", count: item.instanceCount })) };
    },
    classes(payload: unknown): PanelRecord[] {
      const { status, data } = parseGraphReply(payload, "nodes", text);
      if (status !== "READY") return [];
      const graph = rawOverview.parse(data);
      const fieldLabels = {
        className: text("className"),
        classLabel: text("classLabel"),
        instanceCount: text("instanceCount"),
        sampleCount: text("sampleCount"),
      };
      return graph.classes.map(group => {
        const label = group.classLabel ?? group.class;
        return {
          className: OBJECT_TYPE,
          primaryKey: group.class,
          label,
          fields: {
            className: group.class,
            classLabel: label,
            instanceCount: group.instanceCount,
            sampleCount: group.sampleCount,
          },
          fieldLabels,
        };
      });
    },
    search(payload: unknown): PanelRecordQuery {
      const graph = rawSearch.parse(ready("search", payload));
      const fieldLabels = { className: text("className"), classLabel: text("classLabel"), primaryKey: text("primaryKey") };
      const rows = graph.nodes.map(toNode).map(node => ({
        className: node.className, primaryKey: node.primaryKey, label: node.label,
        fields: { className: node.className, classLabel: node.typeLabel ?? node.className, primaryKey: node.primaryKey },
        fieldLabels,
      }));
      return { rows, fieldLabels, total: graph.total, hasMore: graph.hasMore };
    },
    neighbors(node: PlatformOntologyNodeRef, payload: unknown) {
      return renderInstanceNeighbors(node, ready("neighborhood", payload), text);
    },
  };
}

export function createInstanceGraphReadAdapter(viewer: AssistantCredentials) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  const present = createInstanceGraphReadPresenter(viewer.locale);

  async function read(operation: string, body?: Record<string, unknown>): Promise<unknown> {
    const url = `${config.dataQuery.baseUrl}/data/instanceGraph/${operation}`;
    const response = body === undefined
      ? await backendGet(`instance-graph-${operation}`, url, options)
      : await backendPost(`instance-graph-${operation}`, url, body, options);
    return JSON.parse(response.text);
  }

  return {
    overview: async () => present.overview(await read("nodes")),
    connections: async (params: Record<string, unknown>) => present.connections(await read("connections", instanceGraphConnectionsRequest(params))),
    statistics: async () => present.statistics(await read("statistics")),
    classes: async () => present.classes(await read("nodes")),
    search: async (params: Record<string, unknown>) => present.search(await read("search", instanceGraphSearchRequest(params))),
    neighbors: async (node: PlatformOntologyNodeRef, params: NeighborFilters) =>
      present.neighbors(node, await read("neighborhood", instanceNeighborsRequest(node, params))),
  };
}
