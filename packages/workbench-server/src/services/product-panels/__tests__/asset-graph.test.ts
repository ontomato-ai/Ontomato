import { expect, it } from "vitest";
import { createAssetGraph, buildProductAssetGraph, type AssetGraphSources } from "../asset-graph";

const empty: AssetGraphSources = {
  applications: [],
  panels: [],
  projections: [],
  agents: [],
  objectDetailMappings: [],
  objectTypeLabel: name => name,
};

const mainPanel: AssetGraphSources["panels"][number] = {
  id: "main",
  name: "Main panel",
  revision: 2,
  template: true,
  manifest: {
    members: {
      fixedProjection: { target: { projectionId: "view" } },
      fixedPanel: { target: { panelId: "child" } },
      switchProjection: { target: { fromState: "view", candidates: { projectionIds: ["view", "other-view", "hidden-view"] } } },
      switchPanel: { target: { fromState: "panel", candidates: { panelIds: ["main", "frame", "hidden-panel"] } } },
    },
  },
};

const view: AssetGraphSources["projections"][number] = {
  id: "view",
  name: "Order projection",
  revision: 1,
  componentId: "fixture",
  config: {},
  inputs: {},
  outputs: {},
  data: {
    order: { source: { type: { kind: "ObjectType", id: "Order" } }, read: "list", params: {} },
    platform: { source: { type: { kind: "PlatformObjectType", id: "platform:User" } }, read: "list", params: {} },
    relationship: { source: { type: { kind: "Relationship", id: "OrderItems" } }, read: "list", params: {} },
  },
  operations: { approve: { operation: { kind: "Action", id: "ApproveOrder" } } },
  metricId: "order-count",
};

const sources: AssetGraphSources = {
  applications: [{
    id: "app",
    name: "Orders",
    framePanelId: "frame",
    panelIds: ["main", "missing-entry-panel"],
    defaultAgentIds: ["assistant", "missing-agent"],
  }],
  panels: [mainPanel, ...["frame", "child"].map(id => ({ id, name: "", revision: 1, manifest: { members: {} } }))],
  projections: [view, { ...view, id: "other-view", name: "", data: {}, operations: undefined, metricId: undefined }],
  agents: [{ id: "assistant", name: "Orders assistant" }],
  objectDetailMappings: [{ className: "Order", panelId: "main" }, { className: "HiddenClass", panelId: "hidden-panel" }],
  objectTypeLabel: name => name === "Order" ? "Orders" : name,
};

it.each([
  ["asset:app", "application", "bundle", "Orders"],
  ["asset:main", "page", "composition", "Main panel"],
  ["asset:other-view", "object-projection", "element", "other-view"],
  ["object-type:Order", "object-type", "ontology", "Orders"],
  ["metric:order-count", "metric", "ontology", "order-count"],
  ["action:ApproveOrder", "action", "ontology", "ApproveOrder"],
  ["definition:OrderItems", "definition", "ontology", "OrderItems"],
  ["agent:assistant", "AgentDefinition", "ontology", "Orders assistant"],
])("emits a current node for %s", (id, kind, category, name) => {
  expect(buildProductAssetGraph(sources).nodes.find(node => node.id === id)).toMatchObject({ kind, category, name });
});

it("keeps the panel template marker", () => {
  expect(buildProductAssetGraph(sources).nodes.find(node => node.id === "asset:main")).toMatchObject({ isTemplate: true });
});

it.each([
  ["asset:app", "asset:frame", "navigates", "product-index"],
  ["asset:app", "asset:main", "navigates", "product-index"],
  ["asset:main", "asset:view", "contains", "product-index"],
  ["asset:main", "asset:other-view", "contains", "product-index"],
  ["asset:main", "asset:child", "contains", "product-index"],
  ["asset:main", "asset:frame", "contains", "product-index"],
  ["asset:main", "object-type:Order", "renders", "ontology"],
  ["asset:view", "object-type:Order", "renders", "ontology"],
  ["asset:view", "object-type:platform:User", "depends-on", "ontology"],
  ["asset:view", "metric:order-count", "renders", "ontology"],
  ["asset:view", "action:ApproveOrder", "renders", "ontology"],
  ["asset:view", "definition:OrderItems", "depends-on", "ontology"],
  ["asset:app", "agent:assistant", "identity", "product-index"],
])("links %s to %s through %s", (source, target, relation, storage) => {
  expect(buildProductAssetGraph(sources).edges).toContainEqual({ source, target, relation, storage });
});

it("excludes legacy nodes and relations outside the current reference graph", () => {
  const { nodes, edges } = buildProductAssetGraph(sources);
  const legacyKinds = ["navigation", "widget", "widget-group", "agent-profile", "object-view", "collection-view", "metric-widget", "action-view"];
  expect(nodes.some(node => node.category === "legacy" || legacyKinds.includes(node.kind))).toBe(false);
  expect(edges.some(edge => ["use", "edit", "embodies", "tools", "context"].includes(edge.relation))).toBe(false);
});

it("omits unavailable targets and panel self-references", () => {
  const { nodes, edges } = buildProductAssetGraph(sources);
  const ids = new Set(nodes.map(node => node.id));
  expect(edges.every(edge => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target)).toBe(true);
  expect(ids.has("object-type:HiddenClass")).toBe(false);
});

it("deduplicates nodes and edges and rejects edges with either endpoint missing", () => {
  const graph = createAssetGraph();
  const panel = { id: "asset:panel", name: "Panel", kind: "page", category: "composition" } as const;
  const view = { id: "asset:view", name: "View", kind: "object-projection", category: "element" } as const;
  graph.addNode(panel);
  graph.addNode({ ...panel, name: "Duplicate" });
  graph.addEdge(panel.id, view.id, "contains");
  graph.addEdge(view.id, panel.id, "contains");
  expect(graph.build().edges).toEqual([]);
  graph.addNode(view);
  graph.addEdge(panel.id, view.id, "contains");
  graph.addEdge(panel.id, view.id, "contains", "ontology");
  expect(graph.build()).toEqual({
    nodes: [panel, view],
    edges: [{ source: panel.id, target: view.id, relation: "contains", storage: "product-index" }],
  });
});

it("builds an empty graph from an empty catalogue", () => {
  expect(buildProductAssetGraph(empty)).toEqual({ nodes: [], edges: [] });
});
