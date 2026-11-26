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
 * Component tests for InstanceGraph sampled overview, grouped headings, aggregated edges, deferred connections,
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
  emitProgress: null as ((progress: { drawn: number; total: number }) => void) | null,
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
  canvasRecorder.emitProgress = null;
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
    emits: ["update:selected", "activate", "blank", "move", "viewport", "resized", "progress"],
    setup(props, { emit, expose }) {
      canvasRecorder.emitSelect = (ids: string[]) => emit("update:selected", ids);
      canvasRecorder.emitActivate = (element: GraphCanvasElement) => emit("activate", element);
      canvasRecorder.emitBlank = () => emit("blank");
      canvasRecorder.emitMove = (id: string, pos: GraphCanvasPoint) => emit("move", id, pos);
      canvasRecorder.emitProgress = (progress: { drawn: number; total: number }) => emit("progress", progress.drawn, progress.total);
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
    componentId: "@ontomato/sdk:InstanceGraph",
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

  // Start in overview, emit viewport, select Factory 1, click floating "Explore neighbors"
  await vi.waitFor(() => expect(canvasRecorder.nodes.filter((n) => !n.anchor).length).toBe(4));
  canvasRecorder.emitViewport!({ x: -1200, y: -1200, width: 2400, height: 2400, zoom: 1 });
  canvasRecorder.emitSelect!([encodeGraphNodeId(factory1)]);
  await nextTick();
  expect(element.querySelector('[data-graph-node-actions]')).not.toBeNull();
  element.querySelector<HTMLButtonElement>('[data-graph-action="explore-neighbors"]')!.click();

  // First neighbor page loads (1 of 2), showing Load More button in floating actions and hasMoreNeighbors / neighborProgress outputs
  await vi.waitFor(() => expect(instance.outputs.graph?.activeMode).toBe("instance"));
  await vi.waitFor(() => expect(canvasRecorder.nodes.length).toBe(2));
  expect(instance.outputs.graph?.hasMoreNeighbors).toBe(true);
  expect(instance.outputs.graph?.neighborProgress).toEqual({ loaded: 1, total: 2, hasMore: true });

  // Single-click on another node in instance mode selects it without expanding
  const readsBeforeSingleClick = reads.filter((r) => r.dataName === "neighbors").length;
  canvasRecorder.emitSelect!([encodeGraphNodeId(order1)]);
  await nextTick();
  expect(reads.filter((r) => r.dataName === "neighbors").length).toBe(readsBeforeSingleClick);

  // Re-select root Factory 1 and click Load More to append offset=1 neighbor without losing existing nodes
  canvasRecorder.emitSelect!([encodeGraphNodeId(factory1)]);
  await nextTick();
  element.querySelector<HTMLButtonElement>('[data-graph-action="load-more-neighbors"]')!.click();
  await vi.waitFor(() => expect(canvasRecorder.nodes.length).toBe(3));
  expect(instance.outputs.graph?.hasMoreNeighbors).toBe(false);
  const pageReads = reads.filter((r) => r.dataName === "neighbors");
  expect(pageReads[0]?.runtimeParams).toMatchObject({ limit: 2, offset: 0, direction: "both" });
  expect(pageReads[1]?.runtimeParams).toMatchObject({ limit: 2, offset: 1, direction: "both" });

  // Open neighbor filter popover: changing direction/target group drafts does NOT trigger reads until Apply is clicked
  const filterBtn = element.querySelector<HTMLButtonElement>('[data-graph-action="neighbor-filters"]')!;
  filterBtn.click();
  const applyBtn = await vi.waitFor(() => {
    const btn = document.querySelector<HTMLButtonElement>('[data-graph-action="apply-filters"]');
    expect(btn).not.toBeNull();
    return btn!;
  });
  const directionWrapper = document.querySelector<HTMLElement>('[data-graph-filter="direction"] .el-select__wrapper')!;
  directionWrapper.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await nextTick();
  const incomingOpt = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
    .find((el) => el.textContent?.includes("Incoming"))!;
  incomingOpt.click();
  await nextTick();
  // Draft change must NOT fire a neighbor read before Apply
  expect(reads.filter((r) => r.dataName === "neighbors").length).toBe(2);

  const targetWrapper = document.querySelector<HTMLElement>('[data-graph-filter="target-group"] .el-select__wrapper')!;
  targetWrapper.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await nextTick();
  const orderOpt = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
    .find((el) => el.textContent?.trim() === "Order")!;
  orderOpt.click();
  await nextTick();
  expect(reads.filter((r) => r.dataName === "neighbors").length).toBe(2);

  applyBtn.click();
  await vi.waitFor(() => expect(reads.filter((r) => r.dataName === "neighbors").length).toBe(3));
  expect(reads.filter((r) => r.dataName === "neighbors").at(-1)?.runtimeParams).toMatchObject({
    direction: "incoming",
    targetClass: "Order",
    offset: 0,
  });

  // Back to overview floating button returns cleanly to sampled overview mode
  await vi.waitFor(() => {
    const btn = element.querySelector<HTMLButtonElement>('[data-graph-action="back-to-overview"]');
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(false);
  });
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
  canvasRecorder.emitViewport!({ x: -1200, y: -1200, width: 2400, height: 2400, zoom: 1 });
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
    componentId: "@ontomato/sdk:InstanceGraph",
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

  instance.state.set("mode", "instance");
  await vi.waitFor(() => expect(instance.outputs.graph?.activeMode).toBe("instance"));
  const neighborId = encodeGraphNodeId({ className: ACTION, primaryKey: "a-1" });
  await vi.waitFor(() => expect(canvasRecorder.nodes.some((node) => node.id === neighborId)).toBe(true));
  expect(reads.some((read) => read.dataName === "overview")).toBe(false);
});

it("exposes overview diagnostics outputs, clickable group headings, NOT_GENERATED refresh, GENERATING auto-poll, and drawing progress", async () => {
  let phase: "not-generated" | "generating" | "ready" = "not-generated";
  const baseProjection = overviewProjection();
  const projection: ProductProjection = {
    ...baseProjection,
    inputs: {
      ...baseProjection.inputs,
      selectedGroup: { kind: "scalar", type: "string" },
    },
    outputs: {
      ...baseProjection.outputs,
      selectedGroup: { kind: "scalar", type: "string" },
    },
  };
  const manifest: PanelManifest = {
    ...overviewManifest(),
    state: {
      ...overviewManifest().state,
      selectedGroup: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
    },
    members: {
      graph: {
        target: { projectionId: "sampled-graph" },
        inputs: {
          start: { state: "start" },
          selected: { state: "selected" },
          selectedGroup: { state: "selectedGroup" },
          query: { state: "query" },
        },
        outputs: {
          selectedNode: { state: "selected" },
          selectedGroup: { state: "selectedGroup" },
          positions: { state: "positions" },
        },
      },
    },
  };
  const { instance, element, reads } = mountDirect(
    manifest,
    { "sampled-graph": projection },
    (request) => {
      if (request.dataName === "overview") {
        if (phase === "not-generated") {
          return ready({
            status: "NOT_GENERATED",
            complete: true,
            groups: [],
            nodes: [],
            edges: [],
            failures: [],
            edgesTruncated: false,
          });
        }
        if (phase === "generating") {
          return ready({
            status: "GENERATING",
            complete: false,
            groups: [],
            nodes: [],
            edges: [],
            failures: [],
            edgesTruncated: false,
          });
        }
        return ready({
          ...readyOverviewPayload(true),
          complete: false,
          edgesTruncated: true,
          failures: ["Line: timeout"],
        });
      }
      return ready({});
    },
  );

  // 1. NOT_GENERATED shows empty state with refresh button
  await vi.waitFor(() => expect(element.querySelector('[data-graph-state="not-generated"]')).not.toBeNull());
  const refreshBtn = element.querySelector<HTMLButtonElement>('[data-graph-state="not-generated"] [data-graph-action="refresh"]')!;
  expect(refreshBtn).not.toBeNull();

  // 2. Click refresh -> GENERATING -> auto-polls after 2000ms into READY
  vi.useFakeTimers();
  try {
    phase = "generating";
    refreshBtn.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(instance.outputs.graph?.graphStatus).toBe("GENERATING");
    const readsBeforePoll = reads.filter((r) => r.dataName === "overview").length;
    phase = "ready";
    await vi.advanceTimersByTimeAsync(2050);
    expect(reads.filter((r) => r.dataName === "overview").length).toBeGreaterThan(readsBeforePoll);
  } finally {
    vi.useRealTimers();
  }
  await vi.waitFor(() => expect(instance.outputs.graph?.graphStatus).toBe("READY"));

  // 3. Diagnostic outputs reflect overview metadata
  expect(instance.outputs.graph?.groups).toEqual([
    { id: "Factory", label: "Factory", totalCount: 10, sampleCount: 2 },
    { id: "Order", label: "Order", totalCount: 15, sampleCount: 2 },
  ]);
  expect(instance.outputs.graph?.drawnNodeCount).toBe(4);
  expect(instance.outputs.graph?.overviewEdgesTruncated).toBe(true);
  expect(instance.outputs.graph?.complete).toBe(false);
  expect(instance.outputs.graph?.failures).toEqual(["Line: timeout"]);

  // 4. @progress event updates drawingProgress output
  canvasRecorder.emitProgress!({ drawn: 2, total: 4 });
  await nextTick();
  expect(instance.outputs.graph?.drawingProgress).toEqual({ drawn: 2, total: 4 });
  canvasRecorder.emitProgress!({ drawn: 4, total: 4 });
  await nextTick();
  expect(instance.outputs.graph?.drawingProgress).toBeNull();

  // 5. Clicking a group heading button toggles selectedGroup state
  canvasRecorder.emitViewport!({ x: -1200, y: -1200, width: 2400, height: 2400, zoom: 1 });
  await nextTick();
  const factoryHeading = element.querySelector<HTMLButtonElement>('[data-graph-group-heading="Factory"]');
  expect(factoryHeading).not.toBeNull();
  factoryHeading!.click();
  await nextTick();
  expect(instance.state.values.value.selectedGroup).toBe("Factory");
  expect(factoryHeading!.classList.contains("is-selected")).toBe(true);
});

it("displays an overview notice listing omitted relationships and their reasons from deferred connections", async () => {
  const { element } = mountDirect(
    overviewManifest(),
    { "sampled-graph": overviewProjection() },
    (request) => {
      if (request.dataName === "overview") return ready(readyOverviewPayload(false));
      if (request.dataName === "connections") {
        return ready({
          version: "v-1",
          truncated: false,
          edges: [
            {
              id: "e-conn-1",
              relationKind: "produces",
              label: "Produces",
              from: { className: "Factory", primaryKey: "f-1" },
              to: { className: "Order", primaryKey: "o-1" },
              direction: "outgoing" as const,
              derived: false,
            },
          ],
          relations: [
            { relationKind: "produces", label: "Produces", status: "ok", edgeCount: 1 },
            {
              relationKind: "rel_r014",
              label: "Related task",
              status: "unavailable",
              edgeCount: 0,
              reason: "This relationship does not declare join fields; add them to read it.",
            },
          ],
        });
      }
      return ready({ node: factory1, neighbors: [], edges: [], relations: [] });
    },
  );

  await vi.waitFor(() => {
    const notice = element.querySelector("[data-graph-state='overview-relations-omitted']");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("1");
    expect(notice?.textContent).toContain("Related task");
    expect(notice?.textContent).toContain("This relationship does not declare join fields; add them to read it.");
  });
});

it("syncs applied neighborFilter bidirectionally without revision and keeps unapplied popover drafts internal", async () => {
  const baseProjection = overviewProjection();
  const projection: ProductProjection = {
    ...baseProjection,
    inputs: {
      ...baseProjection.inputs,
      neighborFilter: { kind: "json" },
    },
    outputs: {
      ...baseProjection.outputs,
      neighborFilter: { kind: "json" },
    },
  };
  const baseManifest = overviewManifest();
  const manifest: PanelManifest = {
    state: {
      ...baseManifest.state,
      neighborFilter: { type: { kind: "json" }, personal: false, deepLink: false, external: false },
    },
    members: {
      graph: {
        ...baseManifest.members.graph!,
        inputs: {
          ...baseManifest.members.graph!.inputs,
          neighborFilter: { state: "neighborFilter" },
        },
        outputs: {
          ...baseManifest.members.graph!.outputs,
          neighborFilter: { state: "neighborFilter" },
        },
      },
    },
  };

  const { instance, element, reads } = mountDirect(
    manifest,
    { "sampled-graph": projection },
    (request) => {
      if (request.dataName === "overview") return ready(readyOverviewPayload(false));
      if (request.dataName === "connections") return ready({ version: "v-1", truncated: false, edges: [] });
      if (request.dataName === "neighbors") {
        return ready({
          version: "v-1",
          node: factory1,
          neighbors: [order1],
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
          ],
          relations: [{ relationKind: "produces", status: "ok", edgeCount: 1 }],
          total: 1,
          nextOffset: null,
        });
      }
      return { status: "empty" };
    },
    { initial: { start: { className: factory1.className, primaryKey: factory1.primaryKey } } },
  );

  await vi.waitFor(() => expect(instance.outputs.graph?.activeMode).toBe("instance"));
  await vi.waitFor(() => expect(canvasRecorder.nodes.length).toBe(2));
  expect(reads.filter((r) => r.dataName === "neighbors")).toHaveLength(1);
  expect(instance.state.values.value.neighborFilter).toBeNull();

  // 1. Open popover, edit draft direction without clicking Apply -> public state stays null and no read fires
  element.querySelector<HTMLButtonElement>('[data-graph-action="neighbor-filters"]')!.click();
  const applyBtn = await vi.waitFor(() => {
    const btn = document.querySelector<HTMLButtonElement>('[data-graph-action="apply-filters"]');
    expect(btn).not.toBeNull();
    return btn!;
  });
  document.querySelector<HTMLElement>('[data-graph-filter="direction"] .el-select__wrapper')!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await nextTick();
  [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
    .find((el) => el.textContent?.includes("Incoming"))!
    .click();
  await nextTick();
  expect(instance.state.values.value.neighborFilter).toBeNull();
  expect(reads.filter((r) => r.dataName === "neighbors")).toHaveLength(1);

  // 2. Click Apply -> updates public neighborFilter state (no revision field) and reloads once
  applyBtn.click();
  await vi.waitFor(() => expect(reads.filter((r) => r.dataName === "neighbors")).toHaveLength(2));
  expect(instance.state.values.value.neighborFilter).toEqual({
    direction: "incoming",
    targetClass: null,
    relationKind: null,
    fitAfterExpand: false,
  });

  // 3. Updating neighborFilter state externally applies immediately without any revision token
  instance.state.set("neighborFilter", {
    direction: "outgoing",
    targetClass: "Order",
    relationKind: "produces",
    fitAfterExpand: true,
  });
  await vi.waitFor(() => expect(reads.filter((r) => r.dataName === "neighbors")).toHaveLength(3));
  expect(reads.filter((r) => r.dataName === "neighbors").at(-1)?.runtimeParams).toMatchObject({
    direction: "outgoing",
    targetClass: "Order",
    relationKinds: ["produces"],
    offset: 0,
  });

  // 4. Resetting neighborFilter state to null restores defaults and reloads
  instance.state.set("neighborFilter", null);
  await vi.waitFor(() => expect(reads.filter((r) => r.dataName === "neighbors")).toHaveLength(4));
  expect(reads.filter((r) => r.dataName === "neighbors").at(-1)?.runtimeParams).toMatchObject({
    direction: "both",
    offset: 0,
  });
});
