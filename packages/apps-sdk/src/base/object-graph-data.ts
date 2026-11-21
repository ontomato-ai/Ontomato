import { computed, type ComputedRef } from "vue";
import { useI18n } from "vue-i18n";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import type { GraphCanvasEdge, GraphCanvasNode } from "@ontomato/foundation-ui/graph";
import { valueAt } from "../panel/form-values";
import { useMember, useMemberData } from "../panel/member";

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
}

/** The node an edge record names at a declared pointer: its owner's key there, or a visible failure. */
function endpoint(edge: string, fields: Readonly<Record<string, string>>, path: string): string {
  const value = valueAt({ ...fields }, path);
  if (typeof value !== "string") throw new Error(`Edge '${edge}' names no node at ${path}`);
  return value;
}

/**
 * The member's `nodes` and `edges` datums (`panelRecordList`) as a graph: a node per node record, an edge per edge
 * record between the node keys its fields name at `edgeEnds`. Either read still running is loading; a refusal or a
 * failure of either is the graph's.
 */
export function useGraphRecords(edgeEnds?: EdgeEndsConfig): ComputedRef<GraphRecords> {
  const { t } = useI18n();
  const member = useMember();
  const ends = (() => {
    const candidate = (edgeEnds ?? member.projection.config.edgeEnds) as Partial<EdgeEndsConfig> | undefined;
    if (!candidate || typeof candidate.source !== "string" || typeof candidate.target !== "string")
      throw new Error(`The projection in member '${member.key}' declares no edgeEnds (source, target)`);
    return { source: candidate.source, target: candidate.target };
  })();
  const nodesState = useMemberData("nodes");
  const edgesState = useMemberData("edges");
  return computed(() => {
    const n = nodesState.value;
    const e = edgesState.value;
    if (n.status === "loading" || e.status === "loading") return { nodes: [], links: [], loading: true, error: null };
    if (n.status === "forbidden" || e.status === "forbidden") return { nodes: [], links: [], loading: false, error: t("platform.dataForbidden") };
    if (n.status === "error") return { nodes: [], links: [], loading: false, error: n.message };
    if (e.status === "error") return { nodes: [], links: [], loading: false, error: e.message };
    if (n.status !== "ready" || (e.status !== "ready" && e.status !== "empty")) return { nodes: [], links: [], loading: false, error: null };
    const nodeRecords = n.value as unknown as readonly PanelRecord[];
    const edgeRecords = e.status === "ready" ? (e.value as unknown as readonly PanelRecord[]) : [];
    try {
      return {
        nodes: nodeRecords.map((record) => ({ id: record.primaryKey, label: record.label })),
        links: edgeRecords.map((record) => ({
          id: record.primaryKey,
          label: record.label,
          source: endpoint(record.primaryKey, record.fields, ends.source),
          target: endpoint(record.primaryKey, record.fields, ends.target),
        })),
        loading: false,
        error: null,
      };
    } catch (reason: unknown) {
      return { nodes: [], links: [], loading: false, error: reason instanceof Error ? reason.message : String(reason) };
    }
  });
}
