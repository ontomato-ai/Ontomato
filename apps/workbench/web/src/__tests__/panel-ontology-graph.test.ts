import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import {
  ACTION,
  APPLICATION,
  OBJECT_TYPE,
  ONTOLOGY_TYPE,
  ROLE,
  USER,
  WORKFLOW,
  platformOntologyLayers,
} from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { GraphCanvasEdge, GraphCanvasNode, GraphCanvasPoint } from "@ontomato/foundation-ui/graph/g6";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  ignoreChanges,
  inside,
  installPlatform,
  leaveFrame,
  nothingAt,
  panelFrame,
  panelRecord,
  panelUse,
  registered,
  writePanelDocument,
  type Sent,
} from "./panel-frame";

/*
 * Projection-level OntologyGraph (M3 four-layer capability map + M4 object browser instance graph) and object-union
 * panel state / pageContext selection through the platform's real host and bridge:
 * - checkPanelValue & panelSelection for object-union (explicit objectTypes and layers-derived) using contracts'
 *   matchesObjectType/objectUnionTypes, preserving full { className, primaryKey } and localized type display names.
 * - Type mode: four-layer column preset layout, counts/status badges (ok/refused/failed/unavailable), stored vs derived
 *   edges, internal layer filter (does not mutate panel state), query highlighting without hiding, selectedType output.
 * - Instance mode: default start(), 1-hop neighbors(), incremental merge on unexpanded click without losing or moving
 *   existing nodes, no redundant fetch on already-expanded node, query highlighting without hiding or refetching,
 *   drawn-only legend counts, and fit/relayout toolbar actions (no in-frame export button; host triggers exports).
 * - Three-state separation: no neighbors (all ok & 0 edges), owner refused, and read failed shown distinctly and never
 *   collapsed into an empty graph.
 */

const canvasRecorder = {
  nodes: [] as readonly GraphCanvasNode[],
  edges: [] as readonly GraphCanvasEdge[],
  selected: [] as readonly string[],
  categories: [] as readonly string[],
  fitCalls: 0,
  relayoutCalls: 0,
  exportCalls: 0,
  emitSelect: null as ((ids: string[]) => void) | null,
  emitBlank: null as (() => void) | null,
  emitMove: null as ((id: string, pos: GraphCanvasPoint) => void) | null,
};

function resetCanvasRecorder() {
  canvasRecorder.nodes = [];
  canvasRecorder.edges = [];
  canvasRecorder.selected = [];
  canvasRecorder.categories = [];
  canvasRecorder.fitCalls = 0;
  canvasRecorder.relayoutCalls = 0;
  canvasRecorder.exportCalls = 0;
  canvasRecorder.emitSelect = null;
  canvasRecorder.emitBlank = null;
  canvasRecorder.emitMove = null;
}

vi.mock("@ontomato/foundation-ui/graph/g6", async () => {
  const actual = await vi.importActual<typeof import("@ontomato/foundation-ui/graph/g6")>(
    "@ontomato/foundation-ui/graph/g6",
  );
  const G6GraphCanvas = defineComponent({
    name: "G6GraphCanvas",
    props: {
      label: { type: String, required: true },
      nodes: { type: Array, required: true },
      edges: { type: Array, default: () => [] },
      selected: { type: Array, default: () => [] },
      selection: { type: String, default: "single" },
      layout: { type: Object, default: () => ({ type: "grid" }) },
      categories: { type: Array, default: () => [] },
      maxHeight: { type: Number, default: undefined },
    },
    emits: ["update:selected", "blank", "move", "viewport"],
    setup(props, { emit, expose }) {
      canvasRecorder.emitSelect = (ids: string[]) => emit("update:selected", ids);
      canvasRecorder.emitBlank = () => emit("blank");
      canvasRecorder.emitMove = (id: string, pos: GraphCanvasPoint) => emit("move", id, pos);
      expose({
        fit: async () => {
          canvasRecorder.fitCalls += 1;
        },
        relayout: async () => {
          canvasRecorder.relayoutCalls += 1;
        },
        exportImage: async () => {
          canvasRecorder.exportCalls += 1;
          return new Blob(["png-bytes"], { type: "image/png" });
        },
      });
      return () => {
        canvasRecorder.nodes = props.nodes as readonly GraphCanvasNode[];
        canvasRecorder.edges = props.edges as readonly GraphCanvasEdge[];
        canvasRecorder.selected = props.selected as readonly string[];
        canvasRecorder.categories = props.categories as readonly string[];
        return h("div", { class: "mock-g6-canvas", "aria-label": props.label });
      };
    },
  });
  return { ...actual, G6GraphCanvas };
});

const current = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
  editable: false,
  visibility: "domain" as const,
};

const graphSource = { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } } as const;
const graphObject = { kind: "object-union" as const, layers: [...platformOntologyLayers] as [typeof platformOntologyLayers[number], ...typeof platformOntologyLayers[number][]] };
const graphProjection = (id: string): ProductProjection => ({
  ...current,
  id,
  name: "Platform Capability Graph",
  description: "",
  componentId: "@ontomato/sdk:OntologyGraph",
  inputs: {
    mode: { kind: "scalar", type: "string" },
    start: graphObject,
    selected: graphObject,
    query: { kind: "scalar", type: "string" },
    node: graphObject,
    layers: { kind: "json" },
    relationKinds: { kind: "json" },
  },
  outputs: {
    selectedNode: graphObject,
    selectedType: { kind: "scalar", type: "string" },
  },
  config: {},
  data: {
    schema: { source: graphSource, read: "schema", params: {} },
    counts: { source: graphSource, read: "counts", params: {} },
    start: { source: graphSource, read: "start", params: {} },
    neighbors: {
      source: graphSource, read: "neighbors",
      params: { node: { input: "node" }, layers: { input: "layers" }, relationKinds: { input: "relationKinds" } },
    },
  },
});

function hostWith(
  projections: Record<string, ProductProjection>,
  extra?: (request: Sent) => Response | Promise<Response> | undefined,
) {
  return async (request: Sent) => {
    const match = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (match && projections[match[1]!]) return Response.json({ projection: projections[match[1]!] });
    const handled = await extra?.(request);
    if (handled) return handled;
    return nothingAt(request);
  };
}

const nodeById = (id: string) => canvasRecorder.nodes.find((node) => node.id === id);

beforeEach(() => {
  resetCanvasRecorder();
});

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("validates object-union state via contracts and formats panelSelection with type display name, object name and identity", async () => {
  const { checkPanelValue, createPanelState, objectNameKey, panelSelection } = await import(
    "../../../../../packages/apps-sdk/src/panel/state"
  );
  const manifest = definePanel({
    state: {
      layered: { type: { kind: "object-union", layers: ["governance", "capability"] }, deepLink: false },
      explicit: { type: { kind: "object-union", objectTypes: [USER, ACTION] }, deepLink: false },
    },
    members: {},
    events: {},
  });

  // Accepts declared types and preserves full { className, primaryKey }
  expect(checkPanelValue(manifest, "layered", { className: USER, primaryKey: "u-1" })).toEqual({
    className: USER,
    primaryKey: "u-1",
  });
  expect(checkPanelValue(manifest, "explicit", { className: ACTION, primaryKey: "act-1" })).toEqual({
    className: ACTION,
    primaryKey: "act-1",
  });

  // Rejects types outside the declared union
  expect(() => checkPanelValue(manifest, "layered", { className: OBJECT_TYPE, primaryKey: "Order" })).toThrow(TypeError);
  expect(() => checkPanelValue(manifest, "explicit", { className: ROLE, primaryKey: "r-1" })).toThrow(TypeError);
  expect(() => checkPanelValue(manifest, "explicit", "not-an-object")).toThrow(TypeError);

  // panelSelection formats localized type display name + object name + (className primaryKey),
  // and at least type display name + (className primaryKey) when the object name was not read yet.
  const state = createPanelState(manifest, {
    layered: { className: USER, primaryKey: "u-1" },
    explicit: { className: ACTION, primaryKey: "act-1" },
  });
  const names = new Map<string, string>([[objectNameKey(USER, "u-1"), "Alice"]]);
  const translate = (key: string) =>
    ({
      "platformOntology.types.user": "User",
      "platformOntology.types.action": "Action",
    })[key] ?? key;

  expect(panelSelection(manifest, state.values.value, names, translate)).toEqual([
    { kind: USER, id: "u-1", label: "User Alice (platform:User u-1)" },
    { kind: ACTION, id: "act-1", label: "Action (platform:Action act-1)" },
  ]);
});

it("renders type mode in four-layer columns with count statuses, internal layer filter, query highlight and selectedType output", async () => {
  const projections = { "cap-graph": graphProjection("cap-graph") };
  const manifest = definePanel({
    state: {
      mode: { type: { kind: "scalar", type: "string" }, deepLink: false },
      start: { type: { kind: "object-union", layers: [...platformOntologyLayers] }, deepLink: false },
      selected: { type: { kind: "object-union", layers: [...platformOntologyLayers] }, deepLink: false },
      selectedType: { type: { kind: "scalar", type: "string" }, deepLink: false },
      query: { type: { kind: "scalar", type: "string" }, deepLink: false },
    },
    members: {
      graph: {
        target: { projectionId: "cap-graph" },
        inputs: {
          mode: { state: "mode" },
          start: { state: "start" },
          selected: { state: "selected" },
          query: { state: "query" },
        },
        outputs: {
          selectedNode: { state: "selected" },
          selectedType: { state: "selectedType" },
        },
      },
    },
    events: {},
  });
  const panel = panelRecord("panel-cap-type", "Capability Map", manifest);
  panel.content.html = `<div id="app"><Projection slot="graph"></Projection></div>`;
  const use = panelUse("use-cap-type", "cap-map-type", panel.id, "/ontology/assets/capability-map");

  installPlatform(hostWith(projections, (request) => {
    if (request.path === "/api/platform-ontology/schema") {
      return Response.json({
        layers: ["fact", "capability", "governance", "product"],
        objectTypes: [
          { id: OBJECT_TYPE, layer: "fact", labelKey: "platformOntology.types.objectType" },
          { id: ACTION, layer: "capability", labelKey: "platformOntology.types.action" },
          { id: WORKFLOW, layer: "capability", labelKey: "platformOntology.types.workflow" },
          { id: USER, layer: "governance", labelKey: "platformOntology.types.user" },
          { id: APPLICATION, layer: "product", labelKey: "platformOntology.types.application" },
        ],
        relationKinds: [
          {
            id: "action.targets-object-type",
            from: ACTION,
            to: OBJECT_TYPE,
            labelKey: "platformOntology.relations.action.targets-object-type",
            derived: false,
            owner: "java-action",
          },
          {
            id: "role.owns-workflow-step",
            from: USER,
            to: WORKFLOW,
            labelKey: "platformOntology.relations.role.owns-workflow-step",
            derived: true,
            owner: "java-workflow",
          },
        ],
      });
    }
    if (request.path === "/api/platform-ontology/counts") {
      return Response.json({
        counts: [
          { type: OBJECT_TYPE, layer: "fact", status: "ok", count: 12 },
          { type: ACTION, layer: "capability", status: "refused", reason: "No action permission" },
          { type: WORKFLOW, layer: "capability", status: "failed", reason: "Upstream 500" },
          { type: USER, layer: "governance", status: "ok", count: 5 },
          { type: APPLICATION, layer: "product", status: "unavailable" },
        ],
      });
    }
    if (request.path === "/api/platform-ontology/neighbors") {
      throw new Error("neighbors should not be called in type mode");
    }
    return undefined;
  }));
  const frame = panelFrame();
  platformPanelHost("app-test", use, ignoreChanges).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(registered("app-test", use, panel), use.path, { mode: "type" });
  inside(frame);

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const mounted = await mountPanel({});

  await vi.waitFor(() => expect(canvasRecorder.nodes.length).toBe(5));

  // Four-layer column order: fact.x < capability.x < governance.x < product.x
  expect(nodeById(OBJECT_TYPE)!.x!).toBeLessThan(nodeById(ACTION)!.x!);
  expect(nodeById(ACTION)!.x!).toBeLessThan(nodeById(USER)!.x!);
  expect(nodeById(USER)!.x!).toBeLessThan(nodeById(APPLICATION)!.x!);

  // Count and status labels on type nodes
  expect(nodeById(OBJECT_TYPE)!.label).toContain("12");
  expect(nodeById(ACTION)!.label).toContain("No permission");
  expect(nodeById(WORKFLOW)!.label).toContain("Read failed");
  expect(nodeById(APPLICATION)!.label).toContain("Pending");

  // Stored edge solid, derived edge dashed
  const storedEdge = canvasRecorder.edges.find((edge) => edge.source === ACTION && edge.target === OBJECT_TYPE);
  const derivedEdge = canvasRecorder.edges.find((edge) => edge.source === USER && edge.target === WORKFLOW);
  expect(storedEdge?.line).toBe("solid");
  expect(derivedEdge?.line).toBe("dashed");

  // Internal layer filter toggles fact layer OFF without mutating panel state
  const stateBeforeFilter = JSON.stringify(mounted.context.instance.state.values.value);
  const factToggle = document.querySelector<HTMLButtonElement>('[data-graph-layer="fact"]');
  expect(factToggle).not.toBeNull();
  factToggle!.click();
  await vi.waitFor(() => expect(nodeById(OBJECT_TYPE)).toBeUndefined());
  expect(JSON.stringify(mounted.context.instance.state.values.value)).toBe(stateBeforeFilter);

  // Query highlights matching drawn nodes and mutes others, never hides drawn nodes
  mounted.context.instance.state.set("query", "Action");
  await nextTick();
  await vi.waitFor(() => expect(nodeById(ACTION)?.tone).toBe("accent"));
  expect(canvasRecorder.nodes.length).toBe(4);
  expect(nodeById(USER)?.tone).toBe("muted");

  // Clicking a type node writes selectedType scalar state; clicking blank clears it
  canvasRecorder.emitSelect!([ACTION]);
  await nextTick();
  expect(mounted.context.instance.state.values.value.selectedType).toBe(ACTION);

  canvasRecorder.emitBlank!();
  await nextTick();
  expect(mounted.context.instance.state.values.value.selectedType).toBeNull();
});

it("runs instance mode with default start, incremental neighbor expand, full object-union identity, drawn-only legend, fit/relayout and U12 conditional export", async () => {
  const projections = { "cap-graph": graphProjection("cap-graph") };
  const manifest = definePanel({
    state: {
      mode: { type: { kind: "scalar", type: "string" }, deepLink: false },
      start: { type: { kind: "object-union", layers: [...platformOntologyLayers] }, deepLink: false },
      selected: { type: { kind: "object-union", layers: [...platformOntologyLayers] }, deepLink: false },
      query: { type: { kind: "scalar", type: "string" }, deepLink: false },
    },
    members: {
      graph: {
        target: { projectionId: "cap-graph" },
        inputs: {
          mode: { state: "mode" },
          start: { state: "start" },
          selected: { state: "selected" },
          query: { state: "query" },
        },
        outputs: {
          selectedNode: { state: "selected" },
        },
      },
    },
    events: {},
  });
  const panel = panelRecord("panel-cap-instance", "Capability Map", manifest);
  panel.content.html = `<div id="app"><Projection slot="graph"></Projection></div>`;
  const use = panelUse("use-cap-instance", "cap-map-inst", panel.id, "/ontology/assets/capability-map");

  const neighborCalls: Array<{ className: string; primaryKey: string }> = [];
  installPlatform(hostWith(projections, (request) => {
    if (request.path === "/api/platform-ontology/start") {
      return Response.json({
        node: { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" },
      });
    }
    if (request.path === "/api/platform-ontology/neighbors") {
      const { node } = request.body as { node: { className: string; primaryKey: string } };
      neighborCalls.push(node);
      if (node.className === USER && node.primaryKey === "u-1") {
        return Response.json({
          node: { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" },
          neighbors: [
            { className: ROLE, primaryKey: "r-admin", label: "Admin", layer: "governance" },
          ],
          edges: [
            {
              id: "e-u1-r1",
              relationKind: "user.holds-role",
              from: { className: USER, primaryKey: "u-1" },
              to: { className: ROLE, primaryKey: "r-admin" },
              direction: "outgoing",
              derived: false,
            },
          ],
          relations: [{ relationKind: "user.holds-role", status: "ok", edgeCount: 1 }],
        });
      }
      return Response.json({
        node: { className: ROLE, primaryKey: "r-admin", label: "Admin", layer: "governance" },
        neighbors: [
          { className: ACTION, primaryKey: "act-approve", label: "Approve Order", layer: "capability" },
        ],
        edges: [
          {
            id: "e-r1-act1",
            relationKind: "role.can-execute-action",
            from: { className: ROLE, primaryKey: "r-admin" },
            to: { className: ACTION, primaryKey: "act-approve" },
            direction: "outgoing",
            derived: false,
          },
        ],
        relations: [{ relationKind: "role.can-execute-action", status: "ok", edgeCount: 1 }],
      });
    }
    return undefined;
  }));
  const frame = panelFrame();
  platformPanelHost("app-test", use, ignoreChanges).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(registered("app-test", use, panel), use.path, { mode: "instance" });
  inside(frame);

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const mounted = await mountPanel({});

  const userId = JSON.stringify([USER, "u-1"]);
  const roleId = JSON.stringify([ROLE, "r-admin"]);
  const actionId = JSON.stringify([ACTION, "act-approve"]);

  await vi.waitFor(() => expect(canvasRecorder.nodes.length).toBe(2));
  expect(neighborCalls).toEqual([{ className: USER, primaryKey: "u-1" }]);

  // No in-frame Export PNG button: host owns the export action and requests PNG bytes over the bridge
  expect(document.querySelector('[data-graph-action="export-png"]')).toBeNull();

  // Record root position before expanding neighbor
  const rootPosBefore = { x: nodeById(userId)!.x!, y: nodeById(userId)!.y! };

  // Click unexpanded neighbor (Role) -> writes full identity to selected, updates pageContext.selection, expands 1 hop
  canvasRecorder.emitSelect!([roleId]);
  await vi.waitFor(() => expect(canvasRecorder.nodes.length).toBe(3));
  expect(mounted.context.instance.state.values.value.selected).toEqual({
    className: ROLE,
    primaryKey: "r-admin",
  });
  expect(mounted.context.instance.pageContext.value.selection).toEqual([
    { kind: ROLE, id: "r-admin", label: "Role Admin (platform:Role r-admin)" },
  ]);
  expect(neighborCalls).toHaveLength(2);
  // Existing root node was kept and not moved
  expect(nodeById(userId)).toBeDefined();
  expect(nodeById(userId)!.x).toBe(rootPosBefore.x);
  expect(nodeById(userId)!.y).toBe(rootPosBefore.y);

  // Clicking already-expanded node selects it without refetching neighbors
  canvasRecorder.emitSelect!([userId]);
  await nextTick();
  expect(mounted.context.instance.state.values.value.selected).toEqual({
    className: USER,
    primaryKey: "u-1",
  });
  expect(neighborCalls).toHaveLength(2);

  // Legend counts ONLY currently drawn nodes (1 User, 1 Role, 1 Action)
  const legendCounts = Object.fromEntries(
    [...document.querySelectorAll<HTMLElement>("[data-graph-legend-type]")].map((el) => [
      el.dataset.graphLegendType!,
      Number(el.querySelector("b")?.textContent?.trim()),
    ]),
  );
  expect(legendCounts).toEqual({ [USER]: 1, [ROLE]: 1, [ACTION]: 1 });

  // Query highlights matching drawn nodes only, does not hide or issue network requests
  mounted.context.instance.state.set("query", "Approve");
  await nextTick();
  await vi.waitFor(() => expect(nodeById(userId)?.tone).toBe("muted"));
  expect(nodeById(actionId)?.tone).toBe("accent");
  expect(canvasRecorder.nodes.length).toBe(3);
  expect(neighborCalls).toHaveLength(2);

  // Fit and relayout buttons invoke canvas actions (and relayout resets manual drag)
  canvasRecorder.emitMove!(userId, { x: 999, y: 888 });
  await nextTick();
  expect(nodeById(userId)?.x).toBe(999);

  const fitBefore = canvasRecorder.fitCalls;
  document.querySelector<HTMLButtonElement>('[data-graph-action="fit"]')!.click();
  await vi.waitFor(() => expect(canvasRecorder.fitCalls).toBeGreaterThan(fitBefore));

  const relayoutBefore = canvasRecorder.relayoutCalls;
  document.querySelector<HTMLButtonElement>('[data-graph-action="relayout"]')!.click();
  await vi.waitFor(() => expect(canvasRecorder.relayoutCalls).toBeGreaterThan(relayoutBefore));
  expect(nodeById(userId)?.x).toBe(0);
});

it("separates no-neighbors, owner-refused and read-failed states without collapsing into an empty graph", async () => {
  const projections = { "cap-graph": graphProjection("cap-graph") };
  const manifest = definePanel({
    state: {
      mode: { type: { kind: "scalar", type: "string" }, deepLink: false },
      start: { type: { kind: "object-union", layers: [...platformOntologyLayers] }, deepLink: false },
      selected: { type: { kind: "object-union", layers: [...platformOntologyLayers] }, deepLink: false },
    },
    members: {
      graph: {
        target: { projectionId: "cap-graph" },
        inputs: { mode: { state: "mode" }, start: { state: "start" }, selected: { state: "selected" } },
        outputs: { selectedNode: { state: "selected" } },
      },
    },
    events: {},
  });
  const panel = panelRecord("panel-cap-states", "Capability Map", manifest);
  panel.content.html = `<div id="app"><Projection slot="graph"></Projection></div>`;
  const use = panelUse("use-cap-states", "cap-map-states", panel.id, "/ontology/assets/capability-map");

  let scenario: "no-neighbors" | "refused" | "failed-and-refused" = "no-neighbors";
  installPlatform(hostWith(projections, (request) => {
    if (request.path === "/api/platform-ontology/start") {
      return Response.json({
        node: { className: USER, primaryKey: "u-oss", label: "admin", layer: "governance" },
      });
    }
    if (request.path === "/api/platform-ontology/neighbors") {
      const { node } = request.body as { node: { className: string; primaryKey: string } };
      if (scenario === "no-neighbors") {
        return Response.json({
          node: { className: node.className, primaryKey: node.primaryKey, label: "admin", layer: "governance" },
          neighbors: [],
          edges: [],
          relations: [{ relationKind: "user.holds-role", status: "ok", edgeCount: 0 }],
        });
      }
      if (scenario === "refused") {
        return Response.json({
          node: { className: node.className, primaryKey: node.primaryKey, label: "Bob", layer: "governance" },
          neighbors: [],
          edges: [],
          relations: [{ relationKind: "user.holds-role", status: "refused", edgeCount: 0, reason: "403 Forbidden" }],
        });
      }
      return Response.json({
        node: { className: node.className, primaryKey: node.primaryKey, label: "Carol", layer: "governance" },
        neighbors: [],
        edges: [],
        relations: [
          { relationKind: "user.holds-role", status: "refused", edgeCount: 0, reason: "403 Forbidden" },
          { relationKind: "user.created-action", status: "failed", edgeCount: 0, reason: "Timeout" },
        ],
      });
    }
    return undefined;
  }));
  const frame = panelFrame();
  platformPanelHost("app-test", use, ignoreChanges).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(registered("app-test", use, panel), use.path, { mode: "instance" });
  inside(frame);

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const mounted = await mountPanel({});

  // 1) All ok & 0 edges -> no-neighbors banner shown, root node still drawn (NOT empty graph)
  await vi.waitFor(() => expect(document.querySelector('[data-graph-state="no-neighbors"]')).not.toBeNull());
  expect(canvasRecorder.nodes.length).toBe(1);
  expect(document.querySelector('[data-graph-state="refused"]')).toBeNull();
  expect(document.querySelector('[data-graph-state="failed"]')).toBeNull();

  // 2) Refused with 0 edges -> refused banner shown, NOT mislabeled as no-neighbors
  scenario = "refused";
  mounted.context.instance.state.set("start", { className: USER, primaryKey: "u-bob" });
  await vi.waitFor(() => expect(document.querySelector('[data-graph-state="refused"]')).not.toBeNull());
  expect(document.querySelector('[data-graph-state="no-neighbors"]')).toBeNull();
  expect(document.querySelector('[data-graph-state="failed"]')).toBeNull();
  expect(canvasRecorder.nodes.length).toBe(1);

  // 3) Mixed refused + failed -> both banners shown separately, never merged or labeled no-neighbors
  scenario = "failed-and-refused";
  mounted.context.instance.state.set("start", { className: USER, primaryKey: "u-carol" });
  await vi.waitFor(() => {
    expect(document.querySelector('[data-graph-state="refused"]')).not.toBeNull();
    expect(document.querySelector('[data-graph-state="failed"]')).not.toBeNull();
  });
  expect(document.querySelector('[data-graph-state="no-neighbors"]')).toBeNull();
});
