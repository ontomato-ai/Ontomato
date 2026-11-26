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

/** A panel whose members are one fixed projection, one fixed nested panel and two switchable lists. */
const mainPanel: AssetGraphSources["panels"][number] = {
  id: "main",
  name: "Main panel",
  revision: 2,
  template: true,
  manifest: {
    members: {
      fixedProjection: { target: { projectionId: "view" } },
      fixedPanel: { target: { panelId: "child" } },
      switchProjection: { target: { fromState: "view", candidates: { projectionIds: ["view", "shared-view"] } } },
      switchPanel: { target: { fromState: "panel", candidates: { panelIds: ["main", "child"] } } },
    },
  },
};

const childPanel: AssetGraphSources["panels"][number] = {
  id: "child",
  name: "Child panel",
  revision: 1,
  manifest: { members: { order: { target: { projectionId: "child-view" } } } },
};

/** Binds platform-owned objects only: it says nothing about the business ontology. */
const platformPanel: AssetGraphSources["panels"][number] = {
  id: "platform-panel",
  name: "Platform panel",
  revision: 1,
  manifest: { members: { user: { target: { projectionId: "platform-view" } } } },
};

const memberView: AssetGraphSources["projections"][number] = {
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
    panelIds: ["main", "child", "platform-panel"],
    defaultAgentIds: ["assistant", "missing-agent"],
  }],
  panels: [mainPanel, childPanel, platformPanel],
  projections: [
    memberView,
    { ...memberView, id: "shared-view", name: "", data: { order: memberView.data.order }, operations: undefined, metricId: undefined, shared: true },
    { ...memberView, id: "child-view", name: "Child order projection", data: { order: memberView.data.order }, operations: undefined, metricId: undefined },
    {
      ...memberView, id: "platform-view", name: "Platform user projection", operations: undefined, metricId: undefined,
      data: { platform: memberView.data.platform },
    },
  ],
  agents: [{ id: "assistant", name: "Orders assistant" }],
  objectDetailMappings: [{ className: "Order", panelId: "child" }, { className: "HiddenClass", panelId: "missing-panel" }],
  objectTypeLabel: name => name === "Order" ? "Orders" : name,
};

it.each([
  ["asset:app", "application", "bundle", "Orders"],
  ["asset:main", "page", "composition", "Main panel"],
  ["asset:child", "page", "composition", "Child panel"],
  ["asset:shared-view", "object-projection", "element", "shared-view"],
  ["object-type:Order", "object-type", "ontology", "Orders"],
  ["object-type:platform:User", "object-type", "ontology", "platform:User"],
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

it("draws a member projection as part of its panel, unless it is shared to the domain", () => {
  const ids = buildProductAssetGraph(sources).nodes.map(node => node.id);
  expect(ids).not.toContain("asset:view");
  expect(ids).not.toContain("asset:child-view");
  expect(ids).toContain("asset:shared-view");
});

it.each([
  ["asset:app", "asset:main", "navigates", "product-index"],
  ["asset:app", "asset:child", "navigates", "product-index"],
  ["asset:main", "asset:child", "contains", "product-index"],
  ["asset:main", "asset:shared-view", "contains", "product-index"],
  ["asset:main", "object-type:Order", "renders", "ontology"],
  ["asset:main", "object-type:platform:User", "depends-on", "ontology"],
  ["asset:main", "metric:order-count", "renders", "ontology"],
  ["asset:main", "action:ApproveOrder", "renders", "ontology"],
  ["asset:main", "definition:OrderItems", "depends-on", "ontology"],
  ["asset:child", "object-type:Order", "renders", "ontology"],
  ["asset:shared-view", "object-type:Order", "renders", "ontology"],
  ["asset:app", "agent:assistant", "identity", "product-index"],
])("links %s to %s through %s", (source, target, relation, storage) => {
  expect(buildProductAssetGraph(sources).edges).toContainEqual({ source, target, relation, storage });
});

it("folds a member projection into its panel once per target", () => {
  const fromMain = buildProductAssetGraph(sources).edges.filter(edge => edge.source === "asset:main" && edge.target === "object-type:Order");
  expect(fromMain).toEqual([{ source: "asset:main", target: "object-type:Order", relation: "renders", storage: "ontology" }]);
});

it("treats a definition over a platform class as platform metadata, not a seed", () => {
  const platformOnly = buildProductAssetGraph({
    ...sources,
      panels: [platformPanel],
    projections: [{
      ...memberView, id: "platform-view", data: { platform: memberView.data.platform },
      operations: { remove: { operation: { kind: "PlatformOperation", id: "agents.delete" } } },
    }],
    applications: [{ id: "app", name: "Orders", panelIds: ["platform-panel"], defaultAgentIds: [] }],
    agents: [],
    objectDetailMappings: [],
  });
  expect(platformOnly).toEqual({ nodes: [], edges: [] });
});

it("drops assets that reach no business object type or definition, and what only they use", () => {
  const { nodes, edges } = buildProductAssetGraph(sources);
  const ids = new Set(nodes.map(node => node.id));
  expect(ids.has("asset:platform-panel")).toBe(false);
  expect(ids.has("asset:platform-view")).toBe(false);
  expect(ids.has("object-type:HiddenClass")).toBe(false);
  expect(edges.some(edge => edge.source === "asset:app" && edge.target === "asset:platform-panel")).toBe(false);
});

it("excludes legacy nodes and relations outside the current reference graph", () => {
  const { nodes, edges } = buildProductAssetGraph(sources);
  const legacyKinds = ["navigation", "widget", "widget-group", "agent-profile", "object-view", "collection-view", "metric-widget", "action-view"];
  expect(nodes.map(node => node.category)).not.toContain("legacy");
  expect(nodes.some(node => legacyKinds.includes(node.kind))).toBe(false);
  expect(edges.some(edge => ["use", "edit", "embodies", "tools", "context"].includes(edge.relation))).toBe(false);
});

it("omits unavailable targets and panel self-references", () => {
  const { nodes, edges } = buildProductAssetGraph(sources);
  const ids = new Set(nodes.map(node => node.id));
  expect(edges.every(edge => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target)).toBe(true);
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
