import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { englishMessages, managerMessageTree } from "@ontomato/ontology-manager/i18n";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import {
  AGENT_DEFINITION,
  APPLICATION,
  OBJECT_TYPE,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  RELATIONSHIP,
} from "@ontomato/contracts/platform-object-types";
import type {
  GraphCanvasEdge,
  GraphCanvasExportOptions,
  GraphCanvasNode,
  GraphCanvasNodeViewportBox,
  GraphCanvasStyleOverrides,
} from "@ontomato/foundation-ui/graph/g6";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import ProductAssetGraph from "../../../../../packages/apps-sdk/src/base/ProductAssetGraph.vue";
import {
  computeProductAssetGraphLayout,
  extractProductAssetGraph,
  productAssetEdgePath,
  resolveProductAssetTarget,
  type ProductAssetGraphData,
  type ProductAssetGraphTarget,
} from "../../../../../packages/apps-sdk/src/base/product-asset-graph-types";
import { PENDING_GRAPH_EDGE_ID } from "../../../../../packages/apps-sdk/src/base/object-graph-export";
import type { ObjectListRef } from "../../../../../packages/apps-sdk/src/base/object-list-types";
import { noOperations } from "./panel-frame";

const savedFiles: Array<{ mime: string; suggestedName: string; size: number }> = [];
vi.mock("../../../../../packages/apps-sdk/src/panel/save-file", () => ({
  savePanelFile: (file: { bytes: Uint8Array; mime: string; suggestedName: string }) => {
    savedFiles.push({ mime: file.mime, suggestedName: file.suggestedName, size: file.bytes.byteLength });
  },
}));

const canvasState = {
  nodes: [] as readonly GraphCanvasNode[],
  edges: [] as readonly GraphCanvasEdge[],
  selected: [] as readonly string[],
  selectedEdges: [] as readonly string[],
  editable: false,
  styleOverrides: undefined as GraphCanvasStyleOverrides | undefined,
  emit: null as null | ((event: string, ...args: unknown[]) => void),
  exportCalls: [] as Array<GraphCanvasExportOptions | undefined>,
  zooms: [] as unknown[],
  fits: [] as unknown[],
  viewportBoxes: new Map<string, GraphCanvasNodeViewportBox>([
    ["person", { id: "person", x: 100, y: 120, radius: 31 }],
    ["org", { id: "org", x: 320, y: 120, radius: 31 }],
  ]),
};

vi.mock("@ontomato/foundation-ui/graph/g6", async () => {
  const actual = await vi.importActual<typeof import("@ontomato/foundation-ui/graph/g6")>("@ontomato/foundation-ui/graph/g6");
  const G6GraphCanvas = defineComponent({
    name: "G6GraphCanvas",
    props: {
      label: { type: String, required: true },
      nodes: { type: Array, required: true },
      edges: { type: Array, default: () => [] },
      selected: { type: Array, default: () => [] },
      selectedEdges: { type: Array, default: () => [] },
      selection: { type: String, default: "single" },
      layout: { type: Object, default: () => ({ type: "grid" }) },
      editable: { type: Boolean, default: false },
      maxHeight: { type: Number, default: undefined },
      categories: { type: Array, default: () => [] },
      readableLabels: { type: Boolean, default: false },
      nodeSize: { type: Number, default: undefined },
      labelSize: { type: Number, default: undefined },
      styleOverrides: { type: Object, default: undefined },
    },
    emits: ["update:selected", "update:selectedEdges", "blank", "connect", "move", "activate", "hover-node", "viewport", "resized"],
    setup(props, { emit, expose }) {
      canvasState.emit = emit as never;
      expose({
        zoomBy: async (ratio: number) => void canvasState.zooms.push(["by", ratio]),
        zoomTo: async (zoom: number) => void canvasState.zooms.push(["to", zoom]),
        focus: async (id: string) => void canvasState.zooms.push(["focus", id]),
        fit: async (options: unknown) => {
          canvasState.fits.push(options);
          return true;
        },
        relayout: async () => {},
        nodeViewportBox: (id: string) => canvasState.viewportBoxes.get(id) ?? null,
        nodeViewportRects: () => [...canvasState.viewportBoxes.values()],
        frameRect: () => ({ left: 0, top: 0, right: 640, bottom: 480, width: 640, height: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect),
        exportImage: async (options?: GraphCanvasExportOptions) => {
          canvasState.exportCalls.push(options);
          return new Blob(["png"], { type: "image/png" });
        },
      });
      return () => {
        canvasState.nodes = props.nodes as never;
        canvasState.edges = props.edges as never;
        canvasState.selected = props.selected as never;
        canvasState.selectedEdges = props.selectedEdges as never;
        canvasState.editable = props.editable;
        canvasState.styleOverrides = props.styleOverrides as GraphCanvasStyleOverrides | undefined;
        return h("div", { class: "mock-g6-canvas" });
      };
    },
  });
  return { ...actual, G6GraphCanvas };
});

const baseRecord = {
  domainId: "d",
  ownerId: "o",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const twoClasses = [
  { primaryKey: "org", label: "Organization", fields: { layer: "fact" } },
  { primaryKey: "person", label: "Person", fields: { layer: "capability" } },
];
const oneRelation = [
  { primaryKey: "works-in", label: "Works in", fields: { fromclass: "person", toclass: "org" } },
];

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

const mounted: Array<{ unmount(): void }> = [];

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: "en",
    messages: {
      en: {
        ...publicEn,
        ...managerMessageTree(englishMessages),
      },
    },
  });
}

async function flushUi() {
  await Promise.resolve();
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await nextTick();
}

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount();
  document.body.innerHTML = "";
  savedFiles.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.assign(canvasState, {
    nodes: [],
    edges: [],
    selected: [],
    selectedEdges: [],
    editable: false,
    styleOverrides: undefined,
    emit: null,
    exportCalls: [],
    zooms: [],
    fits: [],
  });
});

function mountGraphMember(options: {
  componentId: "@ontomato/sdk:RecordGraph" | "@ontomato/sdk:OntologyTypeGraph" | "@ontomato/sdk:ModelingGraphEditor";
  config?: Record<string, unknown>;
  initial?: Record<string, unknown>;
  slots?: Record<string, (scope: Record<string, unknown>) => unknown>;
  onChoose?: (value: ObjectListRef) => void;
}) {
  const projectionId = `proj-${options.componentId.split(":")[1]}`;
  const includeConnect = options.componentId !== "@ontomato/sdk:OntologyTypeGraph";
  const projection: DirectProjection = {
    ...baseRecord,
    id: projectionId,
    name: "Ontology Graph",
    componentId: options.componentId,
    inputs: {
      highlightedNodes: { kind: "list", items: { kind: "object", objectType: OBJECT_TYPE } },
      highlightedEdges: { kind: "list", items: { kind: "object", objectType: RELATIONSHIP } },
      pathFrom: { kind: "object", objectType: OBJECT_TYPE },
      pathTo: { kind: "object", objectType: OBJECT_TYPE },
      zoom: { kind: "scalar", type: "number" },
    },
    outputs: {
      selectedNode: { kind: "object", objectType: OBJECT_TYPE },
      selectedEdge: { kind: "object", objectType: RELATIONSHIP },
      ...(includeConnect
        ? {
            connectFrom: { kind: "scalar", type: "string" },
            connectTo: { kind: "scalar", type: "string" },
          }
        : {}),
      positions: { kind: "json" },
      zoom: { kind: "scalar", type: "number" },
    },
    config: {
      edgeEnds: { source: "/fromclass", target: "/toclass" },
      categories: ["fact", "capability"],
      nodeCategory: "/layer",
      ...(options.config ?? {}),
    },
    data: {
      nodes: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} },
      edges: { source: { type: { kind: "PlatformObjectType", id: RELATIONSHIP } }, read: "list", params: {} },
    },
  };

  const manifest: DirectPanelManifest = {
    state: {
      selectedClass: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: true, external: false },
      selectedRelation: { type: { kind: "object", objectType: RELATIONSHIP }, personal: false, deepLink: true, external: false },
      connectFrom: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
      connectTo: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
      positions: { type: { kind: "json" }, personal: true, deepLink: false, external: false },
      pathClasses: { type: { kind: "list", items: { kind: "object", objectType: OBJECT_TYPE } }, personal: false, deepLink: false, external: false },
      pathRelations: { type: { kind: "list", items: { kind: "object", objectType: RELATIONSHIP } }, personal: false, deepLink: false, external: false },
      pathFrom: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: false, external: false },
      pathTo: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: false, external: false },
      graphZoom: { type: { kind: "scalar", type: "number" }, personal: false, deepLink: false, external: false },
    },
    members: {
      graph: {
        target: { projectionId },
        inputs: {
          highlightedNodes: { state: "pathClasses" },
          highlightedEdges: { state: "pathRelations" },
          pathFrom: { state: "pathFrom" },
          pathTo: { state: "pathTo" },
          zoom: { state: "graphZoom" },
        },
        outputs: {
          selectedNode: { state: "selectedClass" },
          selectedEdge: { state: "selectedRelation" },
          ...(includeConnect
            ? {
                connectFrom: { state: "connectFrom" },
                connectTo: { state: "connectTo" },
              }
            : {}),
          positions: { state: "positions" },
          zoom: { state: "graphZoom" },
        },
      },
    },
  };

  const instance = createDirectPanelInstance(manifest, {
    pageKey: "graph-pack-c",
    url: () => "/graph-pack-c",
    label: () => "Graph Pack C",
    initial: (options.initial ?? {}) as never,
    text: createPanelText({}, ref("en"), "en"),
    ...noOperations,
    readProjection: async () => projection,
    read: async (request) => {
      if (request.operations) return ready({});
      return ready(request.dataName === "nodes" ? twoClasses : oneRelation);
    },
  });

  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 640, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 480, configurable: true });
  document.body.appendChild(host);

  const app = createApp(
    defineComponent({
      setup() {
        return () =>
          h(
            PanelMember,
            {
              member: "graph",
              instance,
              onChoose: options.onChoose,
            },
            options.slots,
          );
      },
    }),
  );
  app.use(ElementPlus);
  app.use(createTestI18n());
  app.mount(host);
  mounted.push(app);
  return { host, instance };
}

describe("RecordGraph Pack C enhancements (G3 + G4)", () => {
  it("emits choose with real object identity on double-click while keeping single-click selection-only", async () => {
    const chosen: ObjectListRef[] = [];
    const { instance } = mountGraphMember({
      componentId: "@ontomato/sdk:RecordGraph",
      onChoose: (value) => chosen.push(value),
    });
    await vi.waitFor(() => expect(canvasState.nodes).toHaveLength(2), { timeout: 5000 });
    await nextTick();

    // Single-click selects the node without firing choose.
    canvasState.emit?.("update:selected", ["person"]);
    await nextTick();
    expect(instance.state.values.value.selectedClass).toEqual({ className: OBJECT_TYPE, primaryKey: "person" });
    expect(chosen).toEqual([]);

    // Double-click activates the node and emits choose with real identity.
    canvasState.emit?.("activate", { kind: "node", id: "org" });
    await nextTick();
    expect(instance.state.values.value.selectedClass).toEqual({ className: OBJECT_TYPE, primaryKey: "org" });
    expect(chosen).toEqual([{ className: OBJECT_TYPE, primaryKey: "org" }]);

    // Double-click activates an edge, selects it, and emits choose with RELATIONSHIP className.
    canvasState.emit?.("activate", { kind: "edge", id: "works-in" });
    await nextTick();
    expect(instance.state.values.value.selectedRelation).toEqual({ className: RELATIONSHIP, primaryKey: "works-in" });
    expect(instance.state.values.value.selectedClass).toBeNull();
    expect(chosen).toEqual([
      { className: OBJECT_TYPE, primaryKey: "org" },
      { className: RELATIONSHIP, primaryKey: "works-in" },
    ]);
  });
});

describe("ProductAssetGraph (D1, panelUsable: false)", () => {
  const sampleGraph: ProductAssetGraphData = {
    nodes: [
      { id: "grant:role:r-1", name: "Admins", kind: "role", category: "principal" },
      { id: "asset:app-1", assetId: "app-1", name: "Ops Suite", kind: "application", category: "bundle", revision: 2 },
      { id: "asset:page-1", assetId: "page-1", name: "Overview", kind: "page", category: "composition", revision: 1 },
      { id: "asset:proj-1", assetId: "proj-1", name: "Order List", kind: "object-projection", category: "element", revision: 3 },
      { id: "object-type:Order", name: "Order", kind: "object-type", category: "ontology" },
    ],
    edges: [
      { source: "grant:role:r-1", target: "asset:app-1", relation: "use", storage: "governance" },
      { source: "asset:app-1", target: "asset:page-1", relation: "contains", storage: "product-index" },
      { source: "asset:page-1", target: "asset:proj-1", relation: "contains", storage: "product-index" },
      { source: "asset:proj-1", target: "object-type:Order", relation: "renders", storage: "ontology" },
    ],
  };

  it("extracts graph payloads, computes ordered columns and Bezier paths, and resolves real asset identities", () => {
    expect(extractProductAssetGraph({ fields: { graph: sampleGraph } })).toEqual(sampleGraph);
    expect(extractProductAssetGraph({ graph: sampleGraph })).toEqual(sampleGraph);
    expect(extractProductAssetGraph(null)).toBeNull();

    const layout = computeProductAssetGraphLayout(sampleGraph);
    expect(layout.visibleColumns.map((col) => col.id)).toEqual([
      "principal",
      "bundle",
      "composition",
      "element",
      "ontology",
    ]);
    expect(layout.validEdges).toHaveLength(4);
    expect(productAssetEdgePath(sampleGraph.edges[1]!, layout.positions)).toMatch(/^M \d+ \d+ C /);

    expect(resolveProductAssetTarget(sampleGraph.nodes[0]!)).toBeNull();
    expect(resolveProductAssetTarget(sampleGraph.nodes[1]!)?.ref).toEqual({
      className: APPLICATION,
      primaryKey: "app-1",
    });
    expect(resolveProductAssetTarget(sampleGraph.nodes[2]!)?.ref).toEqual({
      className: PRODUCT_PANEL,
      primaryKey: "page-1",
    });
    expect(resolveProductAssetTarget(sampleGraph.nodes[3]!)?.ref).toEqual({
      className: PRODUCT_PROJECTION,
      primaryKey: "proj-1",
    });
  });

  it("renders columns, highlights incident edges on hover/focus, emits open/navigate on click & Enter, and supports zoom/expand", async () => {
    const opened: ProductAssetGraphTarget[] = [];
    const navigated: ProductAssetGraphTarget[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);

    const app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(ProductAssetGraph, {
              graph: sampleGraph,
              onOpen: (target: ProductAssetGraphTarget) => opened.push(target),
              onNavigate: (target: ProductAssetGraphTarget) => navigated.push(target),
            });
        },
      }),
    );
    app.use(ElementPlus);
    app.use(createTestI18n());
    app.mount(host);
    mounted.push(app);
    await flushUi();

    expect(host.querySelector("[data-product-graph-counts]")?.textContent).toContain("5");
    expect(host.querySelector("[data-product-graph-counts]")?.textContent).toContain("4");
    expect(host.querySelectorAll("[data-product-graph-column]")).toHaveLength(5);
    expect(host.querySelector("[data-product-graph-scale]")?.textContent?.trim()).toBe("100%");

    // Hover highlights incident edges and mutes non-incident edges.
    const pageNode = host.querySelector<SVGGElement>("[data-product-graph-node='asset:page-1']")!;
    pageNode.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await nextTick();
    expect(host.querySelectorAll(".related-edge")).toHaveLength(2);
    expect(host.querySelectorAll(".muted-edge")).toHaveLength(2);
    expect(host.querySelectorAll("[data-product-graph-edge-label]")).toHaveLength(2);

    pageNode.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    await nextTick();
    expect(host.querySelectorAll(".related-edge")).toHaveLength(0);
    expect(host.querySelectorAll(".muted-edge")).toHaveLength(0);

    // Keyboard focus also highlights incident edges, and Enter activates the asset.
    pageNode.dispatchEvent(new FocusEvent("focus"));
    await nextTick();
    expect(host.querySelectorAll(".related-edge")).toHaveLength(2);
    pageNode.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await nextTick();
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ assetId: "page-1", className: PRODUCT_PANEL, primaryKey: "page-1" });
    expect(navigated).toEqual(opened);

    // Click on non-asset node does nothing; click on projection asset emits real identity.
    host.querySelector<SVGGElement>("[data-product-graph-node='object-type:Order']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(opened).toHaveLength(1);

    host.querySelector<SVGGElement>("[data-product-graph-node='asset:proj-1']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(opened).toHaveLength(2);
    expect(opened[1]).toMatchObject({ assetId: "proj-1", className: PRODUCT_PROJECTION, primaryKey: "proj-1" });

    // Zoom controls update scale percentage and expand button is shown when not expanded.
    host.querySelector<HTMLButtonElement>("[data-product-graph-action='zoom-in']")!.click();
    await nextTick();
    expect(host.querySelector("[data-product-graph-scale]")?.textContent?.trim()).toBe("125%");
    host.querySelector<HTMLButtonElement>("[data-product-graph-action='actual-size']")!.click();
    await nextTick();
    expect(host.querySelector("[data-product-graph-scale]")?.textContent?.trim()).toBe("100%");
    expect(host.querySelector("[data-product-graph-action='expand']")).not.toBeNull();
  });

  it("opens a large expanded graph readably with overflowing content and keeps manual fit to canvas", async () => {
    class TestResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);

    const pageCount = 80;
    const largeGraph: ProductAssetGraphData = {
      nodes: [
        { id: "asset:app-large", assetId: "app-large", name: "Ops Suite", kind: "application", category: "bundle" },
        ...Array.from({ length: pageCount }, (_, index): ProductAssetGraphData["nodes"][number] => ({
          id: `asset:page-${index}`,
          assetId: `page-${index}`,
          name: `Page ${index}`,
          kind: "page",
          category: "composition",
        })),
      ],
      edges: Array.from({ length: pageCount }, (_, index): ProductAssetGraphData["edges"][number] => ({
        source: "asset:app-large",
        target: `asset:page-${index}`,
        relation: "contains",
      })),
    };
    const largeLayout = computeProductAssetGraphLayout(largeGraph);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(ProductAssetGraph, { graph: largeGraph, expanded: true });
    app.use(ElementPlus);
    app.use(createTestI18n());
    app.mount(host);
    mounted.push(app);
    await flushUi();

    const canvas = host.querySelector<HTMLElement>("[data-product-graph-canvas]")!;
    const svg = canvas.querySelector<SVGElement>("svg")!;
    expect(host.querySelector("[data-product-graph-scale]")?.textContent?.trim()).toBe("50%");
    expect(Number.parseFloat(svg.style.height)).toBeCloseTo(largeLayout.height * 0.5);
    expect(Number.parseFloat(svg.style.height)).toBeGreaterThan(600);

    host.querySelector<HTMLButtonElement>("[data-product-graph-action='fit']")!.click();
    await nextTick();
    expect(host.querySelector("[data-product-graph-scale]")?.textContent?.trim()).toBe("8%");
    expect(Number.parseFloat(svg.style.height)).toBeCloseTo(largeLayout.height * 0.08);
  });

  it("hides the expand button in expanded mode and binds via a panel graph datum", async () => {
    const projection: DirectProjection = {
      ...baseRecord,
      id: "proj-product-asset-graph",
      name: "Product Asset Graph",
      componentId: "@ontomato/sdk:ProductAssetGraph",
      inputs: {
        asset: { kind: "object", objectType: APPLICATION },
      },
      outputs: {
        navigate: { kind: "object-union", layers: ["product"], objectTypes: [AGENT_DEFINITION] },
      },
      config: { expanded: true },
      data: {
        graph: { source: { object: { input: "asset" } }, read: "record", params: {} },
      },
    };
    const manifest: DirectPanelManifest = {
      state: {
        currentAsset: {
          type: { kind: "object", objectType: APPLICATION },
          personal: false,
          deepLink: false,
          external: false,
        },
        targetAsset: {
          type: { kind: "object-union", layers: ["product"], objectTypes: [AGENT_DEFINITION] },
          personal: false,
          deepLink: false,
          external: false,
        },
      },
      members: {
        assetGraph: {
          target: { projectionId: projection.id },
          inputs: { asset: { state: "currentAsset" } },
          outputs: { navigate: { state: "targetAsset" } },
        },
      },
    };
    const instance = createDirectPanelInstance(manifest, {
      pageKey: "product-overview",
      url: () => "/product-overview",
      label: () => "Product Overview",
      initial: { currentAsset: { className: APPLICATION, primaryKey: "app-1" } } as never,
      text: createPanelText({}, ref("en"), "en"),
      ...noOperations,
      readProjection: async () => projection,
      read: async (request) => {
        if (request.operations) return ready({});
        return ready({ primaryKey: "app-1", label: "Ops Suite", fields: { graph: { kind: "json", value: sampleGraph } } });
      },
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(
      defineComponent({
        setup() {
          return () => h(PanelMember, { member: "assetGraph", instance });
        },
      }),
    );
    app.use(ElementPlus);
    app.use(createTestI18n());
    app.mount(host);
    mounted.push(app);
    await vi.waitFor(() => expect(host.querySelector("[data-product-graph-node='asset:app-1']")).not.toBeNull(), { timeout: 5000 });

    expect(host.querySelector("[data-product-graph-action='expand']")).toBeNull();
    host.querySelector<SVGGElement>("[data-product-graph-node='asset:app-1']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(instance.state.values.value.targetAsset).toEqual({ className: APPLICATION, primaryKey: "app-1" });
  });
});

describe("OntologyTypeGraph (D2, panelUsable: false)", () => {
  it("applies fixed ontology graph styling and dated solid-background PNG export", async () => {
    const { host } = mountGraphMember({
      componentId: "@ontomato/sdk:OntologyTypeGraph",
    });
    await vi.waitFor(() => expect(canvasState.nodes).toHaveLength(2));
    await nextTick();

    expect(canvasState.styleOverrides).toEqual({
      nodeLineWidth: 5,
      highlightedNodeLineWidth: 7,
      selectedNodeLineWidth: 6,
      nodeShadowBlur: 12,
      nodeLabelOffsetY: 8,
      mutedNodeOpacity: 0.16,
      edgeLineWidth: 2,
      highlightedEdgeLineWidth: 4,
      selectedEdgeLineWidth: 4,
      mutedEdgeOpacity: 0.12,
      edgeLabelShape: "plain",
      edgeLabelFontSize: 11,
      edgeLabelRadius: 4,
    });

    // Focus-selected button is hidden; download exports with solid page background and ontology-graph-YYYY-MM-DD.png.
    expect(host.querySelector("[data-graph-action='focus-selected']")).toBeNull();
    host.querySelector<HTMLButtonElement>("[data-graph-action='download']")!.click();
    await flushUi();

    expect(canvasState.exportCalls).toEqual([{ background: "var(--el-bg-color-page)" }]);
    expect(savedFiles[0]!.suggestedName).toMatch(/^ontology-graph-\d{4}-\d{2}-\d{2}\.png$/);
  });
});

describe("ModelingGraphEditor (D2 + D3 + D4 + G3, panelUsable: false)", () => {
  it("renders top-left 4-action toolbar with right slots, halo/pill styles, 4-direction hover connect ports, pending edge, and choose", async () => {
    const chosen: ObjectListRef[] = [];
    const { host, instance } = mountGraphMember({
      componentId: "@ontomato/sdk:ModelingGraphEditor",
      onChoose: (value) => chosen.push(value),
      slots: {
        "toolbar-actions": (scope) => h("span", { class: "custom-toolbar-slot" }, `nodes:${scope.nodeCount}`),
      },
    });
    await vi.waitFor(() => expect(canvasState.nodes).toHaveLength(2));
    await nextTick();

    // D3: Top-left 4-action toolbar, no floating toolbar, no focus-selected, no download button, right slot rendered.
    const topToolbar = host.querySelector("[data-graph-top-toolbar]");
    expect(topToolbar).not.toBeNull();
    expect(host.querySelector(".sdk-object-graph-canvas-tools")).toBeNull();
    expect(topToolbar!.querySelectorAll("[data-graph-action]")).toHaveLength(4);
    expect(topToolbar!.querySelector("[data-graph-action='zoom-in']")).not.toBeNull();
    expect(topToolbar!.querySelector("[data-graph-action='zoom-out']")).not.toBeNull();
    expect(topToolbar!.querySelector("[data-graph-action='fit']")).not.toBeNull();
    expect(topToolbar!.querySelector("[data-graph-action='relayout']")).not.toBeNull();
    expect(host.querySelector("[data-graph-action='focus-selected']")).toBeNull();
    expect(host.querySelector("[data-graph-action='download']")).toBeNull();
    expect(host.querySelector(".custom-toolbar-slot")?.textContent).toBe("nodes:2");

    // D2: Fixed halo selection ring and pill edge labels.
    expect(canvasState.styleOverrides).toEqual({
      nodeLineWidth: 5,
      selectedNodeLineWidth: 6,
      selectedNodeHalo: true,
      selectedNodeHaloWidth: 12,
      nodeLabelOffsetY: 8,
      edgeLineWidth: 2,
      selectedEdgeLineWidth: 4,
      edgeLabelShape: "pill",
      edgeLabelFontSize: 12,
      edgeLabelRadius: 999,
    });

    // D4: Hovering a node shows four directional connection ports.
    canvasState.emit?.("hover-node", "person");
    await nextTick();
    const ports = host.querySelectorAll<HTMLButtonElement>("[data-connect-port]");
    expect(ports).toHaveLength(4);
    expect([...ports].map((p) => p.dataset.connectPort)).toEqual(["top", "right", "bottom", "left"]);

    // Dragging from the right port of 'person' onto 'org' displays preview line and sets connectFrom/connectTo.
    const rightPort = host.querySelector<HTMLButtonElement>("[data-connect-port='right']")!;
    rightPort.dispatchEvent(new MouseEvent("pointerdown", { clientX: 131, clientY: 120, bubbles: true }));
    await nextTick();
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 320, clientY: 120 }));
    await nextTick();
    expect(host.querySelector("[data-connect-preview]")).not.toBeNull();

    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 320, clientY: 120 }));
    await nextTick();
    expect(instance.state.values.value.connectFrom).toBe("person");
    expect(instance.state.values.value.connectTo).toBe("org");

    // D4: While connectFrom/connectTo remain populated (e.g. create dialog open), a purely visual pending edge is drawn.
    expect(canvasState.edges.some((edge) => edge.id === PENDING_GRAPH_EDGE_ID && edge.source === "person" && edge.target === "org" && edge.line === "dashed")).toBe(true);

    // Clearing connectFrom/connectTo (dialog cancel) immediately removes the temporary visual edge.
    instance.state.set("connectFrom", null as never);
    instance.state.set("connectTo", null as never);
    await nextTick();
    expect(canvasState.edges.some((edge) => edge.id === PENDING_GRAPH_EDGE_ID)).toBe(false);

    // G3: Double-click emits choose with real identity.
    canvasState.emit?.("activate", { kind: "node", id: "person" });
    await nextTick();
    expect(chosen).toEqual([{ className: OBJECT_TYPE, primaryKey: "person" }]);
  });
});
