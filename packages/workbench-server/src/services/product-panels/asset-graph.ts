import { projectionReadReferences } from "@ontomato/contracts/panel-projection";
import { platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import type { ProductGraph } from "@ontomato/contracts/product-graph";
import type { ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { tForLocale } from "../../i18n";

type GraphNode = ProductGraph["nodes"][number];
type GraphEdge = ProductGraph["edges"][number];
type PanelSource = Pick<ProductPanel, "id" | "name" | "revision" | "template"> & {
  manifest: Pick<ProductPanel["manifest"], "members">;
};
type ProjectionSource = Pick<ProductProjection, "id" | "name" | "revision"> & Parameters<typeof projectionReadReferences>[0];

export interface AssetGraphSources {
  panels: readonly PanelSource[];
  projections: readonly ProjectionSource[];
  applications: readonly {
    id: string;
    name: string;
    framePanelId?: string;
    panelIds: readonly string[];
    defaultAgentIds: readonly string[];
  }[];
  agents: readonly { id: string; name: string }[];
  objectDetailMappings: readonly { className: string; panelId: string }[];
  objectTypeLabel: (className: string) => string;
}

export function createAssetGraph() {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  return {
    addNode(node: GraphNode) {
      if (!nodes.has(node.id)) nodes.set(node.id, node);
    },
    addEdge(source: string, target: string, relation: GraphEdge["relation"], storage: GraphEdge["storage"] = "product-index") {
      if (!nodes.has(source) || !nodes.has(target)) return;
      const key = JSON.stringify([source, target, relation]);
      if (!edges.has(key)) edges.set(key, { source, target, relation, storage });
    },
    build(): ProductGraph {
      return { nodes: [...nodes.values()], edges: [...edges.values()] };
    },
  };
}

const assetKinds = {
  application: { kind: "application", category: "bundle" },
  panel: { kind: "page", category: "composition" },
  projection: { kind: "object-projection", category: "element" },
} as const;

export function assetGraphNode(
  kind: keyof typeof assetKinds, record: { id: string; name: string; revision?: number; template?: boolean },
): GraphNode {
  return {
    id: `asset:${record.id}`,
    assetId: record.id,
    name: record.name || record.id,
    ...assetKinds[kind],
    ...(record.revision !== undefined && { revision: record.revision }),
    ...(record.template !== undefined && { isTemplate: record.template }),
  };
}

export function resolveObjectTypeLabel(typeId: string, language: string): string | undefined {
  const entry = Object.hasOwn(platformObjectTypes, typeId) ? platformObjectTypes[typeId] : undefined;
  return entry?.labelKey ? tForLocale(language, entry.labelKey) : undefined;
}

export function objectTypeGraphNode(className: string, name: string): GraphNode {
  return { id: `object-type:${className}`, name, kind: "object-type", category: "ontology" };
}

export function panelGraphMembers(panel: Pick<PanelSource, "id" | "manifest">) {
  const members: { kind: "panel" | "projection"; id: string }[] = [];
  for (const { target } of Object.values(panel.manifest.members)) {
    if ("projectionId" in target) {
      members.push({ kind: "projection", id: target.projectionId });
    } else if ("panelId" in target) {
      members.push({ kind: "panel", id: target.panelId });
    } else if ("fromState" in target) {
      const { candidates } = target;
      if ("projectionIds" in candidates) {
        for (const id of candidates.projectionIds) members.push({ kind: "projection", id });
      } else if ("panelIds" in candidates) {
        for (const id of candidates.panelIds) members.push({ kind: "panel", id });
      }
    }
  }
  return members.filter(member => member.kind !== "panel" || member.id !== panel.id);
}

export function addProjectionGraphReferences(
  graph: ReturnType<typeof createAssetGraph>, projection: ProjectionSource, objectTypeLabel: AssetGraphSources["objectTypeLabel"],
) {
  const source = `asset:${projection.id}`;
  for (const ref of projectionReadReferences(projection)) {
    const kind = ref.kind === "MetricView" ? "metric" : ref.kind === "Action" ? "action" : "definition";
    const isObjectType = ref.kind === "ObjectType" || ref.kind === "PlatformObjectType";
    const node = isObjectType
      ? objectTypeGraphNode(ref.id, objectTypeLabel(ref.id))
      : { id: `${kind}:${ref.id}`, name: ref.id, kind, category: "ontology" as const };
    const renders = ref.kind === "ObjectType" || ref.kind === "MetricView" || ref.kind === "Action";
    graph.addNode(node);
    graph.addEdge(source, node.id, renders ? "renders" : "depends-on", "ontology");
  }
}

export function buildProductAssetGraph(sources: AssetGraphSources): ProductGraph {
  const graph = createAssetGraph();
  const panelIds = new Set(sources.panels.map(panel => panel.id));
  const projectionIds = new Set(sources.projections.map(projection => projection.id));
  for (const app of sources.applications) graph.addNode(assetGraphNode("application", app));
  for (const panel of sources.panels) graph.addNode(assetGraphNode("panel", panel));
  for (const projection of sources.projections) graph.addNode(assetGraphNode("projection", projection));
  for (const agent of sources.agents) {
    graph.addNode({ id: `agent:${agent.id}`, name: agent.name, kind: "AgentDefinition", category: "ontology" });
  }

  for (const app of sources.applications) {
    const source = `asset:${app.id}`;
    const panels = app.framePanelId === undefined ? app.panelIds : [app.framePanelId, ...app.panelIds];
    for (const id of panels) {
      if (panelIds.has(id)) graph.addEdge(source, `asset:${id}`, "navigates");
    }
    for (const id of app.defaultAgentIds) graph.addEdge(source, `agent:${id}`, "identity");
  }
  for (const panel of sources.panels) {
    for (const { kind, id } of panelGraphMembers(panel)) {
      if ((kind === "panel" ? panelIds : projectionIds).has(id)) {
        graph.addEdge(`asset:${panel.id}`, `asset:${id}`, "contains");
      }
    }
  }
  for (const { className, panelId } of sources.objectDetailMappings) {
    if (!panelIds.has(panelId)) continue;
    const node = objectTypeGraphNode(className, sources.objectTypeLabel(className));
    graph.addNode(node);
    graph.addEdge(`asset:${panelId}`, node.id, "renders", "ontology");
  }
  for (const projection of sources.projections) addProjectionGraphReferences(graph, projection, sources.objectTypeLabel);
  return graph.build();
}
