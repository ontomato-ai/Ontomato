import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { PanelManifest } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import {
  ACTION,
  OBJECT_TYPE,
  ONTOLOGY_TYPE,
  USER,
  platformOntologyLayers,
} from "@ontomato/contracts/platform-object-types";
import type {
  GraphCanvasEdge,
  GraphCanvasElement,
  GraphCanvasNode,
  GraphCanvasPoint,
  GraphCanvasViewport,
} from "@ontomato/foundation-ui/graph/g6";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import { encodeGraphNodeId } from "../../../../../packages/apps-sdk/src/base/ontology-graph-layout";
import { isOverviewGroupAnchorId } from "../../../../../packages/apps-sdk/src/base/ontology-graph-overview";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * Component tests for OntologyGraph sampled overview, grouped headings, aggregated edges, deferred connections,
 * paginated & filtered neighbor expansion, snapshot version-conflict recovery, per-person `positions`, toolbar /
 * overlay slots, and backward-compatible `type` / `instance` modes.
 */

const canvasRecorder = {
  nodes: [] as readonly GraphCanvasNode[],
  edges: [] as readonly GraphCanvasEdge[],
  selected: [] as readonly string[],
  viewport: null as GraphCanvasViewport | null,
  fitCalls: 0,
  relayoutCalls: 0,
  zoomRatios: [] as number[],
  emitSelect: null as ((ids: string[]) => void) | null,
  emitActivate: null as ((element: GraphCanvasElement) => void) | null,
  emitBlank: null as (() => void) | null,
  emitMove: null as ((id: string, pos: GraphCanvasPoint) => void) | null,
  emitViewport: null as ((viewport: GraphCanvasViewport) => void) | null,
};

function resetCanvasRecorder() {
  canvasRecorder.nodes = [];
  canvasRecorder.edges = [];
  canvasRecorder.selected = [];
  canvasRecorder.viewport = null;
  canvasRecorder.fitCalls = 0;
  canvasRecorder.relayoutCalls = 0;
  canvasRecorder.zoomRatios = [];
  canvasRecorder.emitSelect = null;
  canvasRecorder.emitActivate = null;
  canvasRecorder.emitBlank = null;
  canvasRecorder.emitMove = null;
  canvasRecorder.emitViewport = null;
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
      readableLabels: { type: Boolean, default: false },
      maxHeight: { type: Number, default: undefined },
    },
    emits: ["update:selected", "activate", "blank", "move", "viewport", "resized"],
    setup(props, { emit, expose }) {
      canvasRecorder.emitSelect = (ids: string[]) => emit("update:selected", ids);
      canvasRecorder.emitActivate = (element: GraphCanvasElement) => emit("activate", element);
      canvasRecorder.emitBlank = () => emit("blank");
      canvasRecorder.emitMove = (id: string, pos: GraphCanvasPoint) => emit("move", id, pos);
      canvasRecorder.emitViewport = (viewport: GraphCanvasViewport) => {
        canvasRecorder.viewport = viewport;
        emit("viewport", viewport);
      };
      expose({
        fit: async () => {
          canvasRecorder.fitCalls += 1;
          return true;
        },
        relayout: async () => {
          canvasRecorder.relayoutCalls += 1;
        },
        zoomBy: async (ratio: number) => {
          canvasRecorder.zoomRatios.push(ratio);
        },
        exportImage: async () => new Blob(["png-bytes"], { type: "image/png" }),
      });
      return () => {
        canvasRecorder.nodes = props.nodes as readonly GraphCanvasNode[];
        canvasRecorder.edges = props.edges as readonly GraphCanvasEdge[];
        canvasRecorder.selected = props.selected as readonly string[];
        return h("div", { class: "mock-g6-canvas", "aria-label": props.label });
      };
    },
  });
  return { ...actual, G6GraphCanvas };
});

const meta = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

type Layer = (typeof platformOntologyLayers)[number];
const allLayers: [Layer, ...Layer[]] = [platformOntologyLayers[0], ...platformOntologyLayers.slice(1)];
const typeSource = (id: string) => ({ type: { kind: "PlatformObjectType" as const, id } });
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

const domainNodeUnion = {
  kind: "object-union" as const,
  objectTypes: ["Factory", "Order", "Line"] as [string, ...string[]],
};

function overviewProjection(id = "sampled-graph", config: ProductProjection["config"] = {}): ProductProjection {
  return {
    ...meta,
    id,
    name: "Sampled Graph",
    componentId: "@ontomato/sdk:OntologyGraph",
    inputs: {
      mode: { kind: "scalar", type: "string" },
      start: domainNodeUnion,
      selected: domainNodeUnion,
      query: { kind: "scalar", type: "string" },
    },
    outputs: {
      selectedNode: domainNodeUnion,
      positions: { kind: "json" },
    },
    config,
    data: {
      overview: { source: typeSource(OBJECT_TYPE), read: "instanceGraphOverview", params: {} },
      connections: { source: typeSource(OBJECT_TYPE), read: "instanceGraphConnections", params: {} },
      neighbors: { source: typeSource(OBJECT_TYPE), read: "instanceNeighbors", params: {} },
    },
  };
}

function overviewManifest(projectionId = "sampled-graph"): PanelManifest {
  return {
    state: {
      start: { type: domainNodeUnion, personal: false, deepLink: false, external: false },
      selected: { type: domainNodeUnion, personal: false, deepLink: false, external: false },
      query: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false, default: "" },
      positions: { type: { kind: "json" }, personal: true, deepLink: false, external: false },
    },
    members: {
      graph: {
        target: { projectionId },
        inputs: {
          start: { state: "start" },
          selected: { state: "selected" },
          query: { state: "query" },
        },
        outputs: {
          selectedNode: { state: "selected" },
          positions: { state: "positions" },
        },
      },
    },
  };
}

let cleanup: (() => void) | null = null;

function mountDirect(
  manifest: PanelManifest,
  projections: Record<string, ProductProjection>,
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>,
  options: {
    initial?: Record<string, unknown>;
    slots?: Record<string, (props: Record<string, unknown>) => ReturnType<typeof h>>;
  } = {},
) {
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "overview-graph",
    url: () => "/overview-graph",
    label: () => "Overview Graph",
    initial: options.initial as never,
    text: createPanelText({}, ref("en"), "en"),
    ...noOperations,
    readProjection: async (id) => projections[id]!,
    read: async (request) => {
      reads.push(request);
      return answer(request);
    },
  });
  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp({
    setup: () => () => h("div", [h(PanelMember, { instance, member: "graph" }, options.slots)]),
  })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }))
    .use(ElementPlus);
  app.mount(element);
  cleanup = () => {
    app.unmount();
    element.remove();
  };
  return { instance, element, reads };
}

beforeEach(() => {
  resetCanvasRecorder();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const factory1 = { className: "Factory", primaryKey: "f-1", label: "Plant Alpha", typeLabel: "Factory", layer: "fact" as const };
const factory2 = { className: "Factory", primaryKey: "f-2", label: "Plant Beta", typeLabel: "Factory", layer: "fact" as const };
const order1 = { className: "Order", primaryKey: "o-1", label: "Order 101", typeLabel: "Order", layer: "fact" as const };
const order2 = { className: "Order", primaryKey: "o-2", label: "Order 102", typeLabel: "Order", layer: "fact" as const };
const line1 = { className: "Line", primaryKey: "l-1", label: "Line North", typeLabel: "Line", layer: "fact" as const };

const readyOverviewPayload = (withInlineEdges = true) => ({
  status: "READY" as const,
  version: "v-1",
  sampleToken: "tok-1",
  nodeCount: 25,
  edgeCount: 40,
  relationTypes: ["produces", "assigns"],
  groups: [
    { id: "Factory", label: "Factory", totalCount: 10, sampleCount: 2 },
    { id: "Order", label: "Order", totalCount: 15, sampleCount: 2 },
  ],
  nodes: [factory1, factory2, order1, order2],
  ...(withInlineEdges
    ? {
        edges: [
          {
            id: "e-1",
            relationKind: "produces",
            label: "Produces",
            from: { className: "Factory", primaryKey: "f-1" },
            to: { className: "Order", primaryKey: "o-1" },
            direction: "outgoing" as const,
            derived: false,
          },
          {
            id: "e-2",
            relationKind: "produces",
            label: "Produces",
            from: { className: "Factory", primaryKey: "f-2" },
            to: { className: "Order", primaryKey: "o-2" },
            direction: "outgoing" as const,
            derived: false,
          },
        ],
        edgesTruncated: false,
      }
    : {}),
});

it("renders sampled overview grouped clusters, obstacle-avoiding group headings, aggregated edges toggle, edge labels toggle, and toolbar/overlay slots", async () => {
  const { instance, element } = mountDirect(
    overviewManifest(),
    { "sampled-graph": overviewProjection() },
    (request) => {
      if (request.dataName === "overview") return ready(readyOverviewPayload(true));
      return ready({ node: factory1, neighbors: [], edges: [], relations: [] });
    },
    {
      slots: {
        toolbar: (slotProps) =>
          h("button", { type: "button", "data-custom-toolbar": String(slotProps.mode) }, "CustomTool"),
        overlay: (slotProps) =>
          h("div", { "data-custom-overlay": String(slotProps.status) }, `Nodes:${slotProps.nodeCount}`),
      },
    },
  );

  // 4 sample nodes + 2 synthetic group anchors when aggregateEdges is enabled by default
  await vi.waitFor(() => expect(canvasRecorder.nodes.length).toBe(6));
  const realNodes = canvasRecorder.nodes.filter((n) => !n.anchor);
  const anchors = canvasRecorder.nodes.filter((n) => n.anchor);
  expect(realNodes).toHaveLength(4);
  expect(anchors).toHaveLength(2);
  expect(anchors.every((a) => isOverviewGroupAnchorId(a.id))).toBe(true);

  // Aggregated edge merges the two Factory -> Order "produces" edges into one weighted edge
  expect(canvasRecorder.edges).toHaveLength(1);
  expect(canvasRecorder.edges[0]!.weight).toBe(2);
  expect(canvasRecorder.edges[0]!.label).toBe("Produces (2)");
  expect(canvasRecorder.edges[0]!.tone).toBe("default");

  // Read-only outputs and custom slots receive live overview summary
  expect(instance.outputs.graph?.activeMode).toBe("overview");
  expect(instance.outputs.graph?.graphStatus).toBe("READY");
  expect(instance.outputs.graph?.graphVersion).toBe("v-1");
  expect(instance.outputs.graph?.sampleToken).toBe("tok-1");
  expect(instance.outputs.graph?.nodeCount).toBe(25);
  expect(instance.outputs.graph?.edgeCount).toBe(40);
  expect(element.querySelector('[data-custom-toolbar="overview"]')).not.toBeNull();
  expect(element.querySelector('[data-custom-overlay="READY"]')?.textContent).toBe("Nodes:25");

  // Emit viewport so screen-space group headings are computed and placed
  canvasRecorder.emitViewport!({ x: -300, y: -250, width: 1200, height: 800, zoom: 1 });
  await nextTick();
  const headings = [...element.querySelectorAll<HTMLElement>("[data-graph-group-heading]")];
  expect(headings.map((el) => el.dataset.graphGroupHeading).sort()).toEqual(["Factory", "Order"]);
  expect(headings.find((el) => el.dataset.graphGroupHeading === "Factory")?.textContent).toContain("2 / 10");

  // Selecting a node fades aggregated edges and overlays the node's own direct edge
  const f1Id = encodeGraphNodeId(factory1);
  canvasRecorder.emitSelect!([f1Id]);
  await nextTick();
  expect(instance.state.values.value.selected).toEqual({ className: "Factory", primaryKey: "f-1" });
  expect(canvasRecorder.edges).toHaveLength(2);
  expect(canvasRecorder.edges.some((edge) => edge.tone === "muted" && edge.weight === 2)).toBe(true);
  expect(canvasRecorder.edges.some((edge) => edge.tone === "default" && edge.source === f1Id)).toBe(true);

  // Toggling aggregate edges off draws raw direct edges without anchors
  element.querySelector<HTMLButtonElement>('[data-graph-action="toggle-aggregate"]')!.click();
  await nextTick();
  expect(canvasRecorder.nodes).toHaveLength(4);
  expect(canvasRecorder.edges).toHaveLength(2);
  expect(canvasRecorder.edges.every((edge) => !isOverviewGroupAnchorId(edge.source))).toBe(true);

  // Toggling edge labels off removes labels from edges
  element.querySelector<HTMLButtonElement>('[data-graph-action="toggle-edge-labels"]')!.click();
  await nextTick();
  expect(canvasRecorder.edges.every((edge) => edge.label === undefined)).toBe(true);

  // Zoom controls forward zoom ratios to canvas
  element.querySelector<HTMLButtonElement>('[data-graph-action="zoom-in"]')!.click();
  element.querySelector<HTMLButtonElement>('[data-graph-action="zoom-out"]')!.click();
  expect(canvasRecorder.zoomRatios).toHaveLength(2);
  expect(canvasRecorder.zoomRatios[0]!).toBeGreaterThan(1);
  expect(canvasRecorder.zoomRatios[1]!).toBeLessThan(1);
});

it("handles GENERATING and NOT_GENERATED overview statuses and refreshes into READY", async () => {
  let stage: "NOT_GENERATED" | "GENERATING" | "READY" = "NOT_GENERATED";
  const { instance, element, reads } = mountDirect(
    overviewManifest(),
    { "sampled-graph": overviewProjection() },
    (request) => {
      if (request.dataName === "overview") {
        if (stage === "READY") return ready(readyOverviewPayload(true));
        return ready({ status: stage, groups: [], nodes: [] });
      }
      return ready({ node: factory1, neighbors: [], edges: [], relations: [] });
    },
  );

  await vi.waitFor(() => expect(element.querySelector('[data-graph-state="not-generated"]')).not.toBeNull());
  expect(instance.outputs.graph?.graphStatus).toBe("NOT_GENERATED");

  stage = "GENERATING";
  instance.refreshObjects();
  await vi.waitFor(() => expect(element.querySelector('[data-graph-state="generating"]')).not.toBeNull());
  expect(instance.outputs.graph?.graphStatus).toBe("GENERATING");

  stage = "READY";
  element.querySelector<HTMLButtonElement>('[data-graph-action="refresh"]')!.click();
  await vi.waitFor(() => expect(canvasRecorder.nodes.filter((n) => !n.anchor).length).toBe(4));
  expect(instance.outputs.graph?.graphStatus).toBe("READY");
  expect(reads.filter((r) => r.dataName === "overview")).toHaveLength(3);
  expect(reads.filter((r) => r.dataName === "connections")).toHaveLength(0);
});

it("loads deferred connections with version and sampleToken and displays non-blocking truncation notice", async () => {
  let resolveConnections!: (response: ProductPanelReadResponse) => void;
  const connectionsPromise = new Promise<ProductPanelReadResponse>((resolve) => {
    resolveConnections = resolve;
  });

  const { element, reads } = mountDirect(
    overviewManifest(),
    { "sampled-graph": overviewProjection() },
    (request) => {
      if (request.dataName === "overview") return ready(readyOverviewPayload(false));
      if (request.dataName === "connections") return connectionsPromise;
      return ready({ node: factory1, neighbors: [], edges: [], relations: [] });
    },
  );

  // Nodes draw immediately while deferred connections are still loading
  await vi.waitFor(() => expect(canvasRecorder.nodes.filter((n) => !n.anchor).length).toBe(4));
  expect(element.querySelector('[data-graph-state="connections-loading"]')).not.toBeNull();
  const connRead = reads.find((r) => r.dataName === "connections");
  expect(connRead?.runtimeParams).toEqual({ version: "v-1", sampleToken: "tok-1" });

  resolveConnections(ready({
    version: "v-1",
    truncated: true,
    edges: [
      {
        id: "e-conn-1",
        relationKind: "produces",
        label: "Produces",
        from: { className: "Factory", primaryKey: "f-1" },
        to: { className: "Order", primaryKey: "o-1" },
        direction: "outgoing",
        derived: false,
      },
    ],
  }));

  await vi.waitFor(() => expect(canvasRecorder.edges.length).toBe(1));
  expect(element.querySelector('[data-graph-state="connections-loading"]')).toBeNull();
  expect(element.querySelector('[data-graph-state="edges-truncated"]')).not.toBeNull();
});

it("supports paginated neighbor loading (nextOffset), direction/target-group filters, and overview <-> instance switching", async () => {
  const { instance, element, reads } = mountDirect(
    overviewManifest(),
    { "sampled-graph": overviewProjection("sampled-graph", { neighborPageSize: 2 }) },
    (request) => {
      if (request.dataName === "overview") return ready(readyOverviewPayload(true));
      if (request.dataName === "neighbors") {
        const params = request.runtimeParams ?? {};
        const offset = Number(params.offset ?? 0);
        const direction = String(params.direction ?? "both");
        const targetClass = typeof params.targetClass === "string" ? params.targetClass : "";

        if (direction === "incoming" && targetClass === "Line") {
          return ready({
            node: factory1,
            neighbors: [line1],
            edges: [
              {
                id: "e-line-1",
                relationKind: "supplies",
                label: "Supplies",
                from: { className: "Line", primaryKey: "l-1" },
                to: { className: "Factory", primaryKey: "f-1" },
                direction: "incoming",
                derived: false,
              },
            ],
            relations: [{ relationKind: "supplies", status: "ok", edgeCount: 1 }],
            nextOffset: null,
            total: 1,
            version: "v-1",
          });
        }

        if (offset === 0) {
          return ready({
            node: factory1,
            neighbors: [order1],
            edges: [
              {
                id: "e-page-1",
                relationKind: "produces",
                label: "Produces",
                from: { className: "Factory", primaryKey: "f-1" },
                to: { className: "Order", primaryKey: "o-1" },
                direction: "outgoing",
                derived: false,
              },
            ],
            relations: [{ relationKind: "produces", status: "ok", edgeCount: 1 }],
            nextOffset: 1,
            total: 2,
            version: "v-1",
          });
        }

        return ready({
          node: factory1,
          neighbors: [order2],
          edges: [
            {
              id: "e-page-2",
              relationKind: "produces",
              label: "Produces",
              from: { className: "Factory", primaryKey: "f-1" },
              to: { className: "Order", primaryKey: "o-2" },
              direction: "outgoing",
              derived: false,
            },
          ],
          relations: [{ relationKind: "produces", status: "ok", edgeCount: 2 }],
          nextOffset: null,
          total: 2,
          version: "v-1",
        });
      }
      return ready({});
    },
  );

  // Start in overview, select Factory 1, click "Explore neighbors"
  await vi.waitFor(() => expect(canvasRecorder.nodes.filter((n) => !n.anchor).length).toBe(4));
  canvasRecorder.emitSelect!([encodeGraphNodeId(factory1)]);
  await nextTick();
  element.querySelector<HTMLButtonElement>('[data-graph-action="explore-neighbors"]')!.click();

  // First neighbor page loads (1 of 2), showing Load More button and hasMoreNeighbors output
  await vi.waitFor(() => expect(instance.outputs.graph?.activeMode).toBe("instance"));
  await vi.waitFor(() => expect(canvasRecorder.nodes.length).toBe(2));
  expect(instance.outputs.graph?.hasMoreNeighbors).toBe(true);
  expect(element.querySelector('[data-graph-neighbors-progress]')?.textContent).toContain("1");
  expect(element.querySelector('[data-graph-neighbors-progress]')?.textContent).toContain("2");

  // Click Load More to append offset=1 neighbor without losing existing nodes
  element.querySelector<HTMLButtonElement>('[data-graph-action="load-more-neighbors"]')!.click();
  await vi.waitFor(() => expect(canvasRecorder.nodes.length).toBe(3));
  expect(instance.outputs.graph?.hasMoreNeighbors).toBe(false);
  const pageReads = reads.filter((r) => r.dataName === "neighbors");
  expect(pageReads[0]?.runtimeParams).toMatchObject({ limit: 2, offset: 0, direction: "both" });
  expect(pageReads[1]?.runtimeParams).toMatchObject({ limit: 2, offset: 1, direction: "both" });

  // Switch direction filter to incoming & target group filter to Line
  const directionSelect = element.querySelector<HTMLSelectElement>('[data-graph-filter="direction"]')!;
  directionSelect.value = "incoming";
  directionSelect.dispatchEvent(new Event("change"));
  await nextTick();
  await vi.waitFor(() => expect(reads.filter((r) => r.dataName === "neighbors").length).toBe(3));
  expect(reads.filter((r) => r.dataName === "neighbors").at(-1)?.runtimeParams).toMatchObject({
    direction: "incoming",
    offset: 0,
  });

  const targetGroupSelect = element.querySelector<HTMLSelectElement>('[data-graph-filter="target-group"]')!;
  targetGroupSelect.value = "Order";
  targetGroupSelect.dispatchEvent(new Event("change"));
  await nextTick();
  await vi.waitFor(() => expect(reads.filter((r) => r.dataName === "neighbors").length).toBe(4));
  expect(reads.filter((r) => r.dataName === "neighbors").at(-1)?.runtimeParams).toMatchObject({
    direction: "incoming",
    targetClass: "Order",
    offset: 0,
  });

  // Back to overview returns cleanly to sampled overview mode
  element.querySelector<HTMLButtonElement>('[data-graph-action="back-to-overview"]')!.click();
  await vi.waitFor(() => expect(instance.outputs.graph?.activeMode).toBe("overview"));
  expect(canvasRecorder.nodes.filter((n) => !n.anchor)).toHaveLength(4);
});

it("surfaces GRAPH_VERSION_CHANGED conflicts from connections and neighbors and recovers with one-click refresh", async () => {
  let version = "v-1";
  let failConnections = true;
  let failNeighbors = true;

  const { instance, element } = mountDirect(
    overviewManifest(),
    { "sampled-graph": overviewProjection() },
    (request) => {
      if (request.dataName === "overview") {
        return ready({ ...readyOverviewPayload(false), version });
      }
      if (request.dataName === "connections") {
        if (failConnections) {
          return { status: "error", code: "GRAPH_VERSION_CHANGED", message: "Graph version changed" };
        }
        return ready({
          version,
          truncated: false,
          edges: [
            {
              id: "e-v2",
              relationKind: "produces",
              label: "Produces",
              from: { className: "Factory", primaryKey: "f-1" },
              to: { className: "Order", primaryKey: "o-1" },
              direction: "outgoing",
              derived: false,
            },
          ],
        });
      }
      if (request.dataName === "neighbors") {
        if (failNeighbors) {
          return { status: "error", code: "GRAPH_VERSION_CHANGED", message: "Neighbor snapshot version changed" };
        }
        return ready({
          node: factory1,
          neighbors: [order1],
          edges: [],
          relations: [{ relationKind: "produces", status: "ok", edgeCount: 0 }],
          nextOffset: null,
          total: 1,
          version,
        });
      }
      return ready({});
    },
  );

  // Overview nodes stay visible while non-blocking version-changed notice appears
  await vi.waitFor(() => expect(element.querySelector('[data-graph-state="version-changed"]')).not.toBeNull());
  expect(canvasRecorder.nodes.filter((n) => !n.anchor)).toHaveLength(4);
  expect(instance.outputs.graph?.versionChanged).toBe(true);

  // One-click refresh reloads latest overview and connections
  version = "v-2";
  failConnections = false;
  element.querySelector<HTMLButtonElement>('[data-graph-action="refresh-version"]')!.click();
  await vi.waitFor(() => expect(element.querySelector('[data-graph-state="version-changed"]')).toBeNull());
  await vi.waitFor(() => expect(canvasRecorder.edges.length).toBe(1));
  expect(instance.outputs.graph?.graphVersion).toBe("v-2");
  expect(instance.outputs.graph?.versionChanged).toBe(false);

  // Version conflict during neighbor exploration also surfaces non-blockingly and recovers back to overview
  canvasRecorder.emitSelect!([encodeGraphNodeId(factory1)]);
  await nextTick();
  element.querySelector<HTMLButtonElement>('[data-graph-action="explore-neighbors"]')!.click();
  await vi.waitFor(() => expect(element.querySelector('[data-graph-state="version-changed"]')).not.toBeNull());
  expect(instance.outputs.graph?.versionChanged).toBe(true);

  version = "v-3";
  failNeighbors = false;
  element.querySelector<HTMLButtonElement>('[data-graph-action="refresh-version"]')!.click();
  await vi.waitFor(() => expect(instance.outputs.graph?.activeMode).toBe("overview"));
  await vi.waitFor(() => expect(instance.outputs.graph?.graphVersion).toBe("v-3"));
  expect(element.querySelector('[data-graph-state="version-changed"]')).toBeNull();
});

it("persists dragged coordinates in per-person json positions state, restores them alongside new nodes, and clears on relayout", async () => {
  const f1Id = encodeGraphNodeId(factory1);
  const o1Id = encodeGraphNodeId(order1);
  const l1Id = encodeGraphNodeId(line1);
  const localStorageSetSpy = vi.spyOn(Storage.prototype, "setItem");

  let includeLine = false;
  const { instance, element } = mountDirect(
    overviewManifest(),
    { "sampled-graph": overviewProjection() },
    (request) => {
      if (request.dataName === "overview") {
        const base = readyOverviewPayload(true);
        return ready(
          includeLine
            ? {
                ...base,
                groups: [...base.groups, { id: "Line", label: "Line", totalCount: 1, sampleCount: 1 }],
                nodes: [...base.nodes, line1],
              }
            : base,
        );
      }
      return ready({});
    },
    {
      initial: {
        positions: {
          [f1Id]: { x: 444, y: 555 },
        },
      },
    },
  );

  // Initial load restores saved position for Factory 1 while computing layout for Order 1
  await vi.waitFor(() => expect(canvasRecorder.nodes.filter((n) => !n.anchor).length).toBe(4));
  expect(canvasRecorder.nodes.find((n) => n.id === f1Id)).toMatchObject({ x: 444, y: 555 });
  const initialO1 = canvasRecorder.nodes.find((n) => n.id === o1Id)!;
  expect(typeof initialO1.x).toBe("number");

  // Dragging Order 1 writes personal positions state and never touches localStorage
  canvasRecorder.emitMove!(o1Id, { x: 777, y: 888 });
  await nextTick();
  expect(instance.state.values.value.positions).toEqual({
    [f1Id]: { x: 444, y: 555 },
    [o1Id]: { x: 777, y: 888 },
  });
  expect(localStorageSetSpy).not.toHaveBeenCalled();

  // Reloading with an added node keeps saved coordinates and lays out the new node
  includeLine = true;
  element.querySelector<HTMLButtonElement>('[data-graph-action="refresh"]')!.click();
  await vi.waitFor(() => expect(canvasRecorder.nodes.filter((n) => !n.anchor).length).toBe(5));
  expect(canvasRecorder.nodes.find((n) => n.id === f1Id)).toMatchObject({ x: 444, y: 555 });
  expect(canvasRecorder.nodes.find((n) => n.id === o1Id)).toMatchObject({ x: 777, y: 888 });
  expect(canvasRecorder.nodes.find((n) => n.id === l1Id)).toBeDefined();

  // Clicking Relayout clears personal positions and restores computed layout coordinates
  element.querySelector<HTMLButtonElement>('[data-graph-action="relayout"]')!.click();
  await vi.waitFor(() => expect(instance.state.values.value.positions).toBeNull());
  expect(canvasRecorder.nodes.find((n) => n.id === f1Id)?.x).not.toBe(444);
  expect(canvasRecorder.nodes.find((n) => n.id === o1Id)?.x).not.toBe(777);

  localStorageSetSpy.mockRestore();
});

it("keeps backward-compatible type and instance modes working without overview port", async () => {
  const legacyProjection: ProductProjection = {
    ...meta,
    id: "legacy-graph",
    name: "Legacy Graph",
    componentId: "@ontomato/sdk:OntologyGraph",
    inputs: {
      mode: { kind: "scalar", type: "string" },
      selected: { kind: "object-union", layers: allLayers },
      selectedType: { kind: "scalar", type: "string" },
    },
    outputs: {
      selectedNode: { kind: "object-union", layers: allLayers },
      selectedType: { kind: "scalar", type: "string" },
    },
    config: {},
    data: {
      schema: { source: typeSource(ONTOLOGY_TYPE), read: "schema", params: {} },
      counts: { source: typeSource(ONTOLOGY_TYPE), read: "counts", params: {} },
      start: { source: typeSource(ONTOLOGY_TYPE), read: "start", params: {} },
      neighbors: { source: typeSource(ONTOLOGY_TYPE), read: "neighbors", params: {} },
    },
  };

  const legacyManifest: PanelManifest = {
    state: {
      mode: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false, default: "type" },
      selected: { type: { kind: "object-union", layers: allLayers }, personal: false, deepLink: false, external: false },
      selectedType: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
    },
    members: {
      graph: {
        target: { projectionId: "legacy-graph" },
        inputs: {
          mode: { state: "mode" },
          selected: { state: "selected" },
          selectedType: { state: "selectedType" },
        },
        outputs: {
          selectedNode: { state: "selected" },
          selectedType: { state: "selectedType" },
        },
      },
    },
  };

  const { instance, reads } = mountDirect(legacyManifest, { "legacy-graph": legacyProjection }, (request) => {
    if (request.dataName === "schema") {
      return ready({
        layers: ["capability", "governance"],
        objectTypes: [
          { id: ACTION, layer: "capability", labelKey: "platformOntology.types.action" },
          { id: USER, layer: "governance", labelKey: "platformOntology.types.user" },
        ],
        relationKinds: [
          {
            id: "action.hasOwner",
            from: ACTION,
            to: USER,
            derived: false,
            owner: "java-action",
            labelKey: "platformOntology.relations.actionHasOwner",
          },
        ],
      });
    }
    if (request.dataName === "counts") {
      return ready({
        counts: [
          { type: ACTION, layer: "capability", status: "ok", count: 3 },
          { type: USER, layer: "governance", status: "ok", count: 2 },
        ],
      });
    }
    if (request.dataName === "start") {
      return ready({ node: { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" } });
    }
    if (request.dataName === "neighbors") {
      return ready({
        node: { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" },
        neighbors: [{ className: ACTION, primaryKey: "a-1", label: "Approve", layer: "capability" }],
        edges: [
          {
            id: "e-legacy-1",
            relationKind: "action.hasOwner",
            from: { className: ACTION, primaryKey: "a-1" },
            to: { className: USER, primaryKey: "u-1" },
            direction: "incoming",
            derived: false,
          },
        ],
        relations: [{ relationKind: "action.hasOwner", status: "ok", edgeCount: 1 }],
      });
    }
    return ready({});
  });

  await vi.waitFor(() => expect(canvasRecorder.nodes.length).toBe(2));
  expect(instance.outputs.graph?.activeMode).toBe("type");

  // Switch to instance mode: does not send unsupported limit/offset/direction params to platform:OntologyType.neighbors
  instance.state.set("mode", "instance");
  await vi.waitFor(() => expect(instance.outputs.graph?.activeMode).toBe("instance"));
  await vi.waitFor(() => expect(reads.some((r) => r.dataName === "neighbors")).toBe(true));
  const legacyNeighborRead = reads.find((r) => r.dataName === "neighbors");
  expect(legacyNeighborRead?.runtimeParams?.limit).toBeUndefined();
  expect(legacyNeighborRead?.runtimeParams?.offset).toBeUndefined();
  expect(legacyNeighborRead?.runtimeParams?.direction).toBeUndefined();
  expect(legacyNeighborRead?.runtimeParams?.targetClass).toBeUndefined();
});
