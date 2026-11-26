import { computed, type ComputedRef } from "vue";
import { useI18n } from "vue-i18n";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import type { GraphCanvasEdge, GraphCanvasNode } from "@ontomato/foundation-ui/graph";
import { valueAt } from "../panel/form-values";
import { useMember } from "../panel/member";
import { useCollectionData, type CollectionCoverage } from "./collection-data";

/** JSON Pointers into each edge record's `fields` naming its source and target node keys. */
export interface EdgeEndsConfig {
  readonly source: string;
  readonly target: string;
}

export interface GraphRecords {
  readonly nodes: readonly GraphCanvasNode[];
  readonly links: readonly GraphCanvasEdge[];
  readonly loading: boolean;
  readonly error: string | null;
  /** Non-blocking notice explaining that relations cannot be viewed when `edges` is forbidden while nodes stay readable. */
  readonly edgesNotice: string | null;
  /** Non-blocking notice explaining that `nodes` and/or `edges` were truncated by the owner. */
  readonly coverageNotice: string | null;
  /** True when either `edges` were refused or `nodes`/`edges` were truncated. */
  readonly isPartialGraph: boolean;
}

/** The node an edge record names at a declared pointer: its owner's key there, or a visible failure. */
function endpoint(edge: string, fields: PanelRecord["fields"], path: string): string {
  const value = valueAt({ ...fields }, path);
  if (typeof value !== "string") throw new Error(`Edge '${edge}' names no node at ${path}`);
  return value;
}

/** The category a node record names at `pointer` (none when no pointer is given), or a visible failure. */
function categoryOf(record: PanelRecord, pointer: string | undefined): { category?: string } {
  if (pointer === undefined) return {};
  const value = valueAt({ ...record.fields }, pointer);
  if (typeof value !== "string") throw new Error(`Node '${record.primaryKey}' names no category at ${pointer}`);
  return { category: value };
}

/**
 * The line an edge record draws: dashed when the projection names the field that marks it (`edgeDashedField`, a JSON
 * Pointer into the record's fields) and that field holds `true` — a relation derived rather than stored — and solid when
 * it names no such field or the field holds anything else.
 */
function lineOf(record: PanelRecord, pointer: string | undefined): "solid" | "dashed" {
  if (pointer === undefined) return "solid";
  return valueAt({ ...record.fields }, pointer) === true ? "dashed" : "solid";
}

function formatGraphCoverageNotice(
  nodesCoverage: CollectionCoverage,
  edgesCoverage: CollectionCoverage,
  t: (key: string, params?: Record<string, unknown>) => string,
): string | null {
  if (!nodesCoverage.truncated && !edgesCoverage.truncated) return null;
  if (nodesCoverage.truncated && edgesCoverage.truncated) {
    return t("platform.graphNodesAndEdgesTruncated", {
      nodesLoaded: nodesCoverage.loaded,
      edgesLoaded: edgesCoverage.loaded,
    });
  }
  if (nodesCoverage.truncated) {
    return nodesCoverage.total !== null
      ? t("platform.graphNodesTruncatedWithTotal", { loaded: nodesCoverage.loaded, total: nodesCoverage.total })
      : t("platform.graphNodesTruncated", { loaded: nodesCoverage.loaded });
  }
  return edgesCoverage.total !== null
    ? t("platform.graphEdgesTruncatedWithTotal", { loaded: edgesCoverage.loaded, total: edgesCoverage.total })
    : t("platform.graphEdgesTruncatedPartial", { loaded: edgesCoverage.loaded });
}

/**
 * The member's `nodes` and `edges` datums (`panelRecordList` or `panelRecordQuery`) as a graph: a node per node record,
 * an edge per edge record between the node keys its fields name at `edgeEnds`. Either read still running is loading;
 * node refusal or an error is the graph's, while edge refusal keeps all readable nodes with a non-blocking notice.
 * When `nodes` are truncated, edges with missing endpoints are omitted so the graph and adjacency stay consistent.
 */
export function useGraphRecords(
  edgeEnds?: EdgeEndsConfig,
  nodeCategory?: string,
  edgeDashedField?: string,
): ComputedRef<GraphRecords> {
  const { t } = useI18n();
  const member = useMember();
  const ends = (() => {
    const candidate = (edgeEnds ?? member.projection.config.edgeEnds) as Partial<EdgeEndsConfig> | undefined;
    if (!candidate || typeof candidate.source !== "string" || typeof candidate.target !== "string")
      throw new Error(`The projection in member '${member.key}' declares no edgeEnds (source, target)`);
    return { source: candidate.source, target: candidate.target };
  })();
  const nodesCollection = useCollectionData("nodes");
  const edgesCollection = useCollectionData("edges");
  return computed(() => {
    const n = nodesCollection.state.value;
    const e = edgesCollection.state.value;
    if (n.status === "loading" || e.status === "loading") {
      return { nodes: [], links: [], loading: true, error: null, edgesNotice: null, coverageNotice: null, isPartialGraph: false };
    }
    if (n.status === "forbidden") {
      return { nodes: [], links: [], loading: false, error: t("platform.dataForbidden"), edgesNotice: null, coverageNotice: null, isPartialGraph: false };
    }
    if (n.status === "error") {
      return { nodes: [], links: [], loading: false, error: n.message, edgesNotice: null, coverageNotice: null, isPartialGraph: false };
    }
    if (e.status === "error") {
      return { nodes: [], links: [], loading: false, error: e.message, edgesNotice: null, coverageNotice: null, isPartialGraph: false };
    }
    const edgesForbidden = e.status === "forbidden";
    const edgesNotice = edgesForbidden ? t("platform.graphEdgesForbidden") : null;
    if (n.status !== "ready" || (e.status !== "ready" && e.status !== "empty" && !edgesForbidden)) {
      return { nodes: [], links: [], loading: false, error: null, edgesNotice, coverageNotice: null, isPartialGraph: Boolean(edgesNotice) };
    }
    const nodeRecords = nodesCollection.rows.value as readonly PanelRecord[];
    const edgeRecords = e.status === "ready" ? (edgesCollection.rows.value as readonly PanelRecord[]) : [];
    const nodesCoverage = nodesCollection.coverage.value;
    const edgesCoverage = edgesCollection.coverage.value;
    const coverageNotice = formatGraphCoverageNotice(nodesCoverage, edgesCoverage, t);
    try {
      const nodes = nodeRecords.map((record) => ({ id: record.primaryKey, label: record.label, ...categoryOf(record, nodeCategory) }));
      const rawLinks = edgeRecords.map((record) => ({
        id: record.primaryKey,
        label: record.label,
        source: endpoint(record.primaryKey, record.fields, ends.source),
        target: endpoint(record.primaryKey, record.fields, ends.target),
        line: lineOf(record, edgeDashedField),
      }));
      const links = nodesCoverage.truncated
        ? (() => {
            const loadedIds = new Set(nodes.map((node) => node.id));
            return rawLinks.filter((link) => loadedIds.has(link.source) && loadedIds.has(link.target));
          })()
        : rawLinks;
      return {
        nodes,
        links,
        loading: false,
        error: null,
        edgesNotice,
        coverageNotice,
        isPartialGraph: Boolean(edgesNotice || coverageNotice),
      };
    } catch (reason: unknown) {
      return {
        nodes: [],
        links: [],
        loading: false,
        error: reason instanceof Error ? reason.message : String(reason),
        edgesNotice: null,
        coverageNotice: null,
        isPartialGraph: false,
      };
    }
  });
}
