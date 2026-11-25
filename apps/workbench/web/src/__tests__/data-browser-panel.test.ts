import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import {
  panelAddress,
  type ProductPanelReadRequest,
} from "@ontomato/contracts/panel-host";
import type { ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import {
  CLEAR_OBJECT_DETAIL_PANEL,
  OBJECT_TYPE,
  SAVE_OBJECT_DETAIL_PANEL,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type {
  GraphCanvasEdge,
  GraphCanvasElement,
  GraphCanvasNode,
  GraphCanvasPoint,
} from "@ontomato/foundation-ui/graph/g6";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { encodeGraphNodeId } from "../../../../../packages/apps-sdk/src/base/ontology-graph-layout";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import dataBrowserSource from "../../../../../packages/ontology-manager/resources/builtin-panels/data-browser/panel.json";
import dataBrowserHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/data-browser/panel.html?raw";
import dataBrowserModule from "../../../../../packages/ontology-manager/resources/builtin-panels/data-browser/panel.mjs?raw";
import {
  humanIntents,
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  nothingAt,
  panelAnswer,
  panelSnapshot,
  panelUse,
  type Sent,
} from "./panel-frame";

const canvasRecorder = {
  nodes: [] as readonly GraphCanvasNode[],
  edges: [] as readonly GraphCanvasEdge[],
  emitSelect: null as ((ids: string[]) => void) | null,
  emitActivate: null as ((element: GraphCanvasElement) => void) | null,
  emitBlank: null as (() => void) | null,
  emitMove: null as ((id: string, pos: GraphCanvasPoint) => void) | null,
};

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
      expose({
        fit: async () => true,
        relayout: async () => undefined,
        zoomBy: async () => undefined,
        exportImage: async () => new Blob(["png"], { type: "image/png" }),
      });
      return () => {
        canvasRecorder.nodes = props.nodes as readonly GraphCanvasNode[];
        canvasRecorder.edges = props.edges as readonly GraphCanvasEdge[];
        return h("div", { class: "mock-g6-canvas", "aria-label": props.label });
      };
    },
  });
  return { ...actual, G6GraphCanvas };
});

const APP_ID = "browser";
const dataBrowserUse = panelUse(
  "browser-data",
  "browser-data",
  "builtin-product-data-browser",
  "/browser/data",
);

const actionTargets: Record<string, { source: "input"; input: string } | { source: "none" }> = {
  [CLEAR_OBJECT_DETAIL_PANEL]: { source: "input", input: "objectType" },
};

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => {
        const form = id.endsWith(".save") || id.endsWith(".create") || id === SAVE_OBJECT_DETAIL_PANEL;
        return {
          id,
          kind: form ? "form.save" : "action",
          effect: "write",
          batch: false,
          inputSchema: {},
          target: form ? { source: "draft" } : (actionTargets[id] ?? { source: "input", input: "target" }),
        };
      }),
    }),
  ]),
);

const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation local name" }] }
      : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);

function expandDataBrowserPanel() {
  const projections = new Map<string, ProductProjection>();
  const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(dataBrowserSource.manifest);
  const members = Object.fromEntries(
    Object.entries(authoring).map(([key, definition]) => {
      if (!("component" in definition)) return [key, definition];
      const { projection, placement } = expandPanelAuthoringMember(key, definition, {
        state: manifest.state,
        typeTable: { objectTypes },
        components: catalogue,
      });
      const id = definition.id!;
      projections.set(id, {
        ...projection,
        id,
        name: definition.name ?? key,
        description: definition.description ?? "",
        visibility: "platform",
        domainId: null,
        ownerId: null,
        revision: 1,
        createdAt: "2026-11-25T00:00:00.000Z",
        updatedAt: "2026-11-25T00:00:00.000Z",
        editable: false,
      } as ProductProjection);
      return [key, { target: { projectionId: id }, ...placement }];
    }),
  );
  const panel: ProductPanel = {
    id: "builtin-product-data-browser",
    name: "Object browser",
    description: "Browse object records and explore relationships between instances",
    visibility: "platform",
    domainId: null,
    ownerId: null,
    revision: 1,
    createdAt: "2026-11-25T00:00:00.000Z",
    updatedAt: "2026-11-25T00:00:00.000Z",
    editable: false,
    manifest: definePanel({ ...manifest, members }),
    content: {
      html: dataBrowserHtml,
      module: dataBrowserModule,
      messages: dataBrowserSource.content.messages,
    },
  };
  return { panel, projections };
}

const { panel: browserPanel, projections } = expandDataBrowserPanel();

interface HarnessOptions {
  canConfigure?: boolean;
  savedPositions?: Record<string, { x: number; y: number }>;
  overviewNodeCount?: number;
  overviewTruncated?: boolean;
  overviewComplete?: boolean;
  overviewFailures?: readonly string[];
}

function mountBrowserRoute(options: HarnessOptions = {}) {
  const canConfigure = options.canConfigure ?? true;
  let boundPanelId = "panel-order-custom";
  let panelStatus = "configured";
  let personalState: Record<string, unknown> = options.savedPositions ? { positions: options.savedPositions } : {};
  const personalStateSaves: Array<Record<string, unknown>> = [];
  const readLog: Array<{ member: string; dataName: string; inputs: Record<string, unknown>; runtimeParams?: Record<string, unknown> }> = [];
  const intentCalls: Array<{ operationId: string; input: unknown }> = [];

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: dataBrowserUse.path, component: PanelApplicationRoute, props: { applicationId: APP_ID } },
      { path: "/browser/views", component: { render: () => h("div", "object-detail") } },
      { path: "/ontology/panels", component: { render: () => h("div", "panels-directory") } },
    ],
  });

  const intents = humanIntents((operationId, call) => {
    intentCalls.push({ operationId, input: call.input });
    if (operationId === "clearDetailPanel.clearDetailPanel") {
      boundPanelId = "";
      panelStatus = "unconfigured";
      return {
        kind: "success",
        data: {},
        affected: { objectTypes: [OBJECT_TYPE], objects: [{ objectType: OBJECT_TYPE, primaryKey: "Order" }] },
      };
    }
    if (operationId === "detailPanelForm.saveDetailPanel") {
      const next = ((call.input as { values?: { panelId?: string | null } } | undefined)?.values?.panelId) ?? "";
      boundPanelId = next;
      panelStatus = next ? "configured" : "unconfigured";
      return {
        kind: "success",
        data: { panelId: boundPanelId },
        affected: { objectTypes: [OBJECT_TYPE], objects: [{ objectType: OBJECT_TYPE, primaryKey: "Order" }] },
      };
    }
    return { kind: "success", data: {} };
  });

  function answerRead(request: ProductPanelReadRequest) {
    const member = request.memberPath[0]!.member;
    if ("operations" in request) {
      if (member === "clearDetailPanel") {
        return {
          status: "ready",
          value: {
            clearDetailPanel: {
              handlerRef: CLEAR_OBJECT_DETAIL_PANEL,
              kind: "action",
              label: "Clear detail panel binding",
              effect: "write",
              batch: false,
              target: { source: "input", input: "objectType" },
              inputSchema: {},
              resultSchema: {},
              ...(!boundPanelId ? { unavailable: { reason: "Default read-only detail" } } : {}),
            },
          },
        };
      }
      if (member === "detailPanelForm") {
        return {
          status: "ready",
          value: {
            saveDetailPanel: {
              handlerRef: SAVE_OBJECT_DETAIL_PANEL,
              kind: "form.save",
              label: "Save detail panel",
              effect: "write",
              batch: false,
              target: { source: "draft", slot: "detailPanelForm" },
              inputSchema: {},
              resultSchema: {},
            },
          },
        };
      }
      return { status: "ready", value: {} };
    }

    readLog.push({
      member,
      dataName: request.dataName,
      inputs: request.inputs as Record<string, unknown>,
      runtimeParams: request.runtimeParams as Record<string, unknown> | undefined,
    });

    if (member === "instanceGraph" && request.dataName === "overview") {
      return {
        status: "ready",
        value: {
          status: "READY",
          version: "v-1",
          sampleToken: "tok-1",
          nodeCount: options.overviewNodeCount ?? 2,
          edgeCount: 1,
          relationTypes: ["placedBy"],
          ...(options.overviewComplete !== undefined ? { complete: options.overviewComplete } : {}),
          ...(options.overviewFailures ? { failures: options.overviewFailures } : {}),
          groups: [
            { id: "Order", label: "Order", totalCount: 12, sampleCount: 1 },
            { id: "Customer", label: "Customer", totalCount: 5, sampleCount: 1 },
          ],
          nodes: [
            { className: "Order", primaryKey: "ord-1", label: "ORD-001", typeLabel: "Order", layer: "fact" },
            { className: "Customer", primaryKey: "cus-1", label: "Acme Corp", typeLabel: "Customer", layer: "fact" },
          ],
        },
      };
    }
    if (member === "instanceGraph" && request.dataName === "connections") {
      return {
        status: "ready",
        value: {
          version: "v-1",
          truncated: options.overviewTruncated ?? false,
          edges: [
            {
              id: "edge-1",
              from: { className: "Order", primaryKey: "ord-1" },
              to: { className: "Customer", primaryKey: "cus-1" },
              relationKind: "placedBy",
              direction: "outgoing",
              derived: false,
            },
          ],
        },
      };
    }
    if (member === "instanceGraph" && request.dataName === "counts") {
      return {
        status: "ready",
        value: {
          counts: [
            { type: "Order", layer: "fact", status: "ok", count: 12 },
            { type: "Customer", layer: "fact", status: "ok", count: 5 },
          ],
        },
      };
    }
    if (member === "instanceGraph" && request.dataName === "neighbors") {
      const node = (request.runtimeParams?.node ?? request.inputs?.node) as { className: string; primaryKey: string };
      return {
        status: "ready",
        value: {
          node: { className: node.className, primaryKey: node.primaryKey, label: node.primaryKey === "ord-1" ? "ORD-001" : "Acme Corp", typeLabel: node.className, layer: "fact" },
          neighbors: [
            { className: "Customer", primaryKey: "cus-1", label: "Acme Corp", typeLabel: "Customer", layer: "fact" },
          ],
          edges: [
            {
              id: "edge-n-1",
              from: { className: "Order", primaryKey: "ord-1" },
              to: { className: "Customer", primaryKey: "cus-1" },
              relationKind: "placedBy",
              direction: "outgoing",
              derived: false,
            },
          ],
          relations: [{ relationKind: "placedBy", edgeCount: 1, status: "ok", truncated: false }],
          nextOffset: null,
          total: 1,
          version: "v-1",
        },
      };
    }
    if (member === "graphSearchResults") {
      return {
        status: "ready",
        value: {
          rows: [
            {
              className: "Order",
              primaryKey: "ord-1",
              label: "ORD-001",
              fields: { className: "Order", classLabel: "Order", primaryKey: "ord-1" },
              fieldLabels: { className: "Class", classLabel: "Type", primaryKey: "Key" },
            },
          ],
          fieldLabels: { className: "Class", classLabel: "Type", primaryKey: "Key" },
          total: 1,
          hasMore: false,
        },
      };
    }
    if (member === "nodeHeader" || member === "nodeSummary") {
      const obj = request.inputs.object as { className: string; primaryKey: string } | undefined;
      if (!obj) return { status: "empty" };
      return {
        status: "ready",
        value: {
          className: obj.className,
          primaryKey: obj.primaryKey,
          label: obj.primaryKey === "ord-1" ? "ORD-001" : "Acme Corp",
          fields: { orderNo: "ORD-001", amount: "4200", status: "Paid" },
          fieldLabels: { orderNo: "Order No", amount: "Amount", status: "Status" },
        },
      };
    }
    if (member === "graphSearchClassPicker") {
      return {
        status: "ready",
        value: [
          {
            className: OBJECT_TYPE,
            primaryKey: "Order",
            label: "Order Display",
            fields: { className: "Order", classLabel: "Order Display", instanceCount: 12, sampleCount: 1 },
          },
          {
            className: OBJECT_TYPE,
            primaryKey: "Customer",
            label: "Customer Display",
            fields: { className: "Customer", classLabel: "Customer Display", instanceCount: 5, sampleCount: 1 },
          },
        ],
      };
    }
    if (member === "classPicker" || member === "classCatalogProbe" || member === "classNamesProbe") {
      return {
        status: "ready",
        value: [
          { className: OBJECT_TYPE, primaryKey: "Order", label: "Order Display", fields: { className: "Order", showName: "Order Display" } },
          { className: OBJECT_TYPE, primaryKey: "Customer", label: "Customer Display", fields: { className: "Customer", showName: "Customer Display" } },
        ],
      };
    }
    if (member === "classAttributesProbe") {
      return {
        status: "ready",
        value: [
          { className: "platform:Attribute", primaryKey: JSON.stringify(["Order", "orderNo"]), label: "Order No", fields: { name: "orderNo" } },
          { className: "platform:Attribute", primaryKey: JSON.stringify(["Order", "amount"]), label: "Amount", fields: { name: "amount" } },
          { className: "platform:Attribute", primaryKey: JSON.stringify(["Order", "note"]), label: "Note", fields: { name: "note" } },
        ],
      };
    }
    if (member === "instanceTable") {
      return {
        status: "ready",
        value: {
          rows: [
            {
              className: "Order",
              primaryKey: "ord-1",
              label: "ORD-001",
              fields: { orderNo: "ORD-001", amount: "4200", note: "Priority" },
              fieldLabels: { orderNo: "Order No", amount: "Amount", note: "Note" },
            },
            {
              className: "Order",
              primaryKey: "ord-2",
              label: "ORD-002",
              fields: { orderNo: "ORD-002", amount: "1800", note: "Standard" },
              fieldLabels: { orderNo: "Order No", amount: "Amount", note: "Note" },
            },
          ],
          fieldLabels: { orderNo: "Order No", amount: "Amount", note: "Note" },
          total: 2,
        },
      };
    }
    if (member === "detailBinding" || member === "detailBindingSummary") {
      return {
        status: "ready",
        value: {
          className: OBJECT_TYPE,
          primaryKey: "Order",
          label: "Order",
          fields: {
            status: panelStatus === "configured" ? "Configured" : "Default",
            panelName: boundPanelId ? "Custom Order Detail" : "",
            unavailableReason: "",
          },
          fieldLabels: { status: "Status", panelName: "Detail panel", unavailableReason: "Reason" },
          outputs: {
            configured: Boolean(boundPanelId),
            panelId: boundPanelId,
            panelStatus,
            canConfigure,
          },
        },
      };
    }
    if (member === "detailPanelForm") {
      return {
        status: "ready",
        value: {
          values: { panelId: boundPanelId || null },
          fields: [
            {
              path: "/panelId",
              label: "Detail panel",
              required: false,
              readOnly: !canConfigure,
              control: { kind: "reference", objectType: "platform:ProductPanel", multiple: false },
              valueSchema: { type: ["string", "null"] },
            },
          ],
          errors: [],
          save: {
            operation: SAVE_OBJECT_DETAIL_PANEL,
            method: "PUT",
            path: "/api/object-details/Order",
            bodySchema: {},
          },
          revision: "1",
        },
      };
    }
    if (member === "detailPanelPicker") {
      return {
        status: "ready",
        value: {
          options: [
            { primaryKey: "panel-order-custom", value: "panel-order-custom", label: "Custom Order Detail" },
            { primaryKey: "panel-order-v2", value: "panel-order-v2", label: "Order Detail V2" },
          ],
        },
      };
    }
    return { status: "empty" };
  }

  installPlatform(async (request: Sent) => {
    if (request.path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
      return Response.json({
        success: true,
        data: { applicationId: APP_ID, entry: { path: "/browser", renderer: "browser" }, panelUses: [dataBrowserUse] },
      });
    }
    if (request.path === "/api/product-panels/application-entry") {
      return Response.json({
        applicationId: APP_ID,
        use: dataBrowserUse,
        menu: { singleEntry: true, names: { en: "Object browser" }, groups: [], panelUses: [dataBrowserUse] },
      });
    }
    if (request.path === `/api/product-panels/${browserPanel.id}/snapshot`) {
      return panelSnapshot(browserPanel, Object.fromEntries(projections), request);
    }
    if (request.path === `/api/product-panels/${browserPanel.id}`) {
      return panelAnswer(browserPanel, request);
    }
    if (request.path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(request.path.split("/").at(-1)!) });
    }
    if (request.path === "/api/product-panels/personal-state/read" && request.method === "POST") {
      return Response.json({ values: personalState });
    }
    if (request.path === "/api/product-panels/personal-state" && request.method === "PUT") {
      const payload = request.body as { values?: Record<string, unknown> };
      personalState = { ...personalState, ...(payload.values ?? {}) };
      personalStateSaves.push({ ...(payload.values ?? {}) });
      return Response.json({ values: personalState });
    }
    if (request.path === "/api/product-panels/read" && request.method === "POST") {
      return Response.json(answerRead(request.body as ProductPanelReadRequest));
    }
    if (request.path === "/api/product-panels/read-batch" && request.method === "POST") {
      const { reads } = request.body as { reads: ProductPanelReadRequest[] };
      return Response.json({ results: reads.map(answerRead) });
    }
    return intents(request) ?? nothingAt(request);
  }, router);

  useApplicationCatalog().applications.value = [
    {
      id: APP_ID,
      kind: "native",
      rail: "top",
      category: "business",
      sort: 40,
      entry: { path: "/browser", renderer: "browser", home: "/browser/data" },
      scheduleAdapter: null,
      releaseId: null,
      names: { en: "Object browser" },
      descriptions: { en: "Browse objects" },
      icon: "objects",
      panelUses: [dataBrowserUse],
    },
  ];

  return {
    router,
    readLog,
    personalStateSaves,
    intentCalls,
    async open(address: string) {
      await router.push(address);
      await router.isReady();
      return mountPlatformPage(() => h(RouterView), router);
    },
  };
}

describe("builtin-product-data-browser panel", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    leaveFrame();
    useApplicationCatalog().applications.value = [];
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("loads instance graph overview & connections by default, inspects selected node with ObjectSummary, navigates to /browser/views, and saves per-person positions without localStorage", async () => {
    const route = mountBrowserRoute();
    const { app, element } = await route.open(dataBrowserUse.path);
    try {
      await vi.waitFor(() => {
        expect(element.querySelector(".sdk-page-header h1")?.textContent).toContain("Object browser");
        expect(route.readLog.some((r) => r.member === "instanceGraph" && r.dataName === "overview")).toBe(true);
        expect(route.readLog.some((r) => r.member === "instanceGraph" && r.dataName === "connections")).toBe(true);
      }, { timeout: 5000 });

      // Permanent right inspector renders empty guidance before selection, without duplicate overlay chips, top legend, or header refresh.
      await vi.waitFor(() => {
        expect(element.querySelector("[data-graph-inspector]")).not.toBeNull();
        expect(element.querySelector("[data-inspector-empty]")).not.toBeNull();
        expect(element.querySelector("[data-graph-class-stats]")).toBeNull();
        expect(element.querySelector(".sdk-ontology-graph-legend")).toBeNull();
        expect(element.querySelector('.sdk-page-header button[aria-label="Refresh"]')).toBeNull();
        expect(element.querySelector("[data-graph-stats-summary]")?.textContent).toContain("2");
      });

      // Dragging a node persists per-person positions through panel personal state, never localStorage.
      const orderNodeId = encodeGraphNodeId({ className: "Order", primaryKey: "ord-1" });
      canvasRecorder.emitMove?.(orderNodeId, { x: 240, y: 180 });
      await vi.waitFor(() => {
        expect(route.personalStateSaves.length).toBeGreaterThan(0);
      });
      const saved = route.personalStateSaves.at(-1)?.positions as Record<string, { x: number; y: number }>;
      expect(saved?.[orderNodeId]).toEqual({ x: 240, y: 180 });
      expect(localStorage.length).toBe(0);

      // Selecting a node switches the permanent inspector to node details with Box icon, key, display class label, and ObjectSummary.
      canvasRecorder.emitSelect?.([orderNodeId]);
      await vi.waitFor(() => {
        const inspector = element.querySelector("[data-node-inspector]");
        expect(inspector).not.toBeNull();
        expect(inspector?.querySelector(".db-resource-icon")).not.toBeNull();
        expect(inspector?.querySelector(".db-detail-key")?.textContent?.trim()).toBe("ord-1");
        expect(inspector?.querySelector("[data-node-class-label]")?.textContent?.trim()).toBe("Order Display");
        expect(inspector?.textContent).toContain("ORD-001");
        expect(inspector?.textContent).toContain("4200");
        expect(inspector?.textContent).toContain("Paid");
      });

      // Clicking "View full details" navigates to E2-3 /browser/views?selected=Order~ord-1.
      const detailBtn = Array.from(element.querySelectorAll<HTMLButtonElement>("[data-node-inspector] button")).find(
        (btn) => btn.textContent?.includes("View full details"),
      )!;
      expect(detailBtn).toBeTruthy();
      detailBtn.click();
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.fullPath).toBe("/browser/views?selected=Order~ord-1");
      });
    } finally {
      app.unmount();
    }
  });

  it("switches to table mode, pushes server filters & sort to platform:ObjectType.instances, supports column toggle & CSV export, opens object detail on row click, and keeps page/size out of public state", async () => {
    const downloads: Array<{ filename: string; content: string }> = [];
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      void (blob as Blob).text().then((text) => {
        const latest = downloads.at(-1);
        if (latest) latest.content = text;
      });
      return "blob:csv-mock";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: Parameters<typeof document.createElement>[1]) => {
      const el = origCreateElement(tagName, options);
      if (tagName.toLowerCase() === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {
          downloads.push({ filename: (el as HTMLAnchorElement).download, content: "" });
        });
      }
      return el;
    }) as typeof document.createElement);

    const route = mountBrowserRoute();
    const { app, element } = await route.open(dataBrowserUse.path);
    try {
      await vi.waitFor(() => {
        expect(element.querySelector(".sdk-page-header")).not.toBeNull();
      }, { timeout: 5000 });

      // Switch to Table mode via official SegmentedControl in PageHeader.
      const tableTab = Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(
        (btn) => btn.textContent?.trim() === "Table",
      )!;
      expect(tableTab).toBeTruthy();
      tableTab.click();

      // Auto-selects first object type ("Order") and renders dynamic table columns & rows in a single unified toolbar without row chevrons.
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Order No");
        expect(element.textContent).toContain("ORD-001");
        expect(element.textContent).toContain("ORD-002");
      }, { timeout: 5000 });
      expect(element.querySelector(".db-table-toolbar")).toBeNull();
      expect(element.querySelector(".sdk-object-list-row-chevron")).toBeNull();
      const instanceTableProjection = projections.get("builtin-product-9f3c1e20-4b7d-4e92-a814-000000000009");
      expect(instanceTableProjection?.config?.pagination).toBe("pages");
      expect(instanceTableProjection?.config?.pageSizes).toEqual([20, 50, 100]);
      expect(instanceTableProjection?.config?.showRowIndex).toBe(true);
      expect(instanceTableProjection?.config?.pinPrimaryColumn).toBe(true);
      expect(instanceTableProjection?.config?.rowActivation).toBe("dblclick");
      expect(instanceTableProjection?.config?.showPageJumper).not.toBe(false);
      expect(instanceTableProjection?.config?.showRangeBar).toBe(true);
      expect(element.querySelector('[data-testid="object-list-range-bar"]')).not.toBeNull();
      expect(route.router.currentRoute.value.fullPath).toContain("viewMode=table");
      expect(route.router.currentRoute.value.fullPath).not.toContain("page=");
      expect(route.router.currentRoute.value.fullPath).not.toContain("size=");

      // Table search commits only on Enter (not on intermediate keystrokes).
      const tableSearchEl = element.querySelector<HTMLInputElement>(".db-table-search input")!;
      expect(tableSearchEl).toBeTruthy();
      tableSearchEl.value = "ORD-001";
      tableSearchEl.dispatchEvent(new Event("input", { bubbles: true }));
      expect(route.router.currentRoute.value.fullPath).not.toContain("search=ORD-001");
      tableSearchEl.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.fullPath).toContain("search=ORD-001");
      });
      tableSearchEl.value = "";
      tableSearchEl.dispatchEvent(new Event("input", { bubbles: true }));
      tableSearchEl.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.fullPath).not.toContain("search=ORD-001");
      });

      // Toggle a column locally via ObjectList's Columns popover (no extra read).
      const beforeToggleReads = route.readLog.filter((r) => r.member === "instanceTable").length;
      const columnsBtn = Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(
        (btn) => btn.textContent?.includes("Columns"),
      )!;
      expect(columnsBtn).toBeTruthy();
      columnsBtn.click();
      await vi.waitFor(() => {
        expect(document.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0);
      });
      const noteCheckbox = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(
        (lbl) => lbl.textContent?.includes("Note"),
      )?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      expect(noteCheckbox).toBeTruthy();
      noteCheckbox!.click();
      await vi.waitFor(() => {
        const headers = Array.from(element.querySelectorAll("th")).map((th) => th.textContent?.trim());
        expect(headers).not.toContain("Note");
      });
      expect(route.readLog.filter((r) => r.member === "instanceTable").length).toBe(beforeToggleReads);

      // Export current page CSV with dynamic class-based file name.
      const exportBtn = Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(
        (btn) => btn.textContent?.includes("Export"),
      )!;
      expect(exportBtn).toBeTruthy();
      exportBtn.click();
      await vi.waitFor(() => {
        expect(downloads.length).toBe(1);
        expect(downloads[0]!.filename).toMatch(/^Order-\d{4}-\d{2}-\d{2}\.csv$/);
        expect(downloads[0]!.content).toContain("Order No,Amount");
        expect(downloads[0]!.content).not.toContain("Note");
      });
      expect(createObjectURL).toHaveBeenCalled();

      // Open Filter & sort drawer, add filter + sort, and verify server pushdown to platform:ObjectType.instances.
      const filterBtn = Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(
        (btn) => btn.textContent?.includes("Filter & sort"),
      )!;
      filterBtn.click();
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Filter conditions");
        expect(document.body.textContent).toContain("Sort");
      });

      const drawer = document.querySelector(".el-drawer")!;
      expect(drawer).not.toBeNull();
      // Opening the drawer with no active conditions starts empty instead of pre-inserting a blank row.
      expect(drawer.querySelectorAll(".db-filter-row").length).toBe(0);

      async function pickSelectOption(selectEl: HTMLElement, label: string) {
        (selectEl.querySelector<HTMLElement>(".el-select__wrapper") ?? selectEl).click();
        await vi.waitFor(() => {
          const listboxId = selectEl.querySelector<HTMLElement>("[aria-controls]")?.getAttribute("aria-controls");
          const scope = (listboxId ? document.getElementById(listboxId) : null) ?? document;
          const items = Array.from(scope.querySelectorAll<HTMLElement>(".el-select-dropdown__item")).filter(
            (item) => {
              if (item.textContent?.trim() !== label) return false;
              const popper = item.closest<HTMLElement>(".el-popper");
              return !popper || (popper.style.display !== "none" && popper.getAttribute("aria-hidden") !== "true");
            },
          );
          expect(items.length).toBeGreaterThan(0);
          items.at(-1)!.click();
        });
        await vi.waitFor(() => {
          expect(selectEl.textContent).toContain(label);
        });
      }

      const addCondBtn = Array.from(drawer.querySelectorAll<HTMLButtonElement>("button")).find(
        (btn) => btn.textContent?.includes("Add condition"),
      )!;
      addCondBtn.click();
      await vi.waitFor(() => {
        expect(drawer.querySelectorAll(".db-filter-row").length).toBe(1);
      });
      const firstRowSelects = Array.from(drawer.querySelectorAll(".db-filter-row")[0]!.querySelectorAll<HTMLElement>(".el-select"));
      await pickSelectOption(firstRowSelects[0]!, "Amount");
      await pickSelectOption(firstRowSelects[1]!, "Greater than or equal");

      const valueInput = drawer.querySelector<HTMLInputElement>('input[placeholder="Value"]')!;
      valueInput.value = "2000";
      valueInput.dispatchEvent(new Event("input", { bubbles: true }));

      // Add a second null-check condition (value omitted per recordFiltersSchema).
      addCondBtn.click();
      await vi.waitFor(() => {
        expect(drawer.querySelectorAll(".db-filter-row").length).toBe(2);
      });
      const secondRowSelects = Array.from(drawer.querySelectorAll(".db-filter-row")[1]!.querySelectorAll<HTMLElement>(".el-select"));
      await pickSelectOption(secondRowSelects[0]!, "Note");
      await pickSelectOption(secondRowSelects[1]!, "Is not empty");

      // Pick sort field & Descending order.
      const sortSelect = drawer.querySelectorAll<HTMLElement>(".db-drawer-section")[1]!.querySelector<HTMLElement>(".el-select")!;
      await pickSelectOption(sortSelect, "Amount");
      const descRadio = Array.from(drawer.querySelectorAll<HTMLElement>(".el-radio")).find(
        (radio) => radio.textContent?.includes("Descending"),
      );
      descRadio?.click();

      const applyBtn = Array.from(drawer.querySelectorAll<HTMLButtonElement>("button")).find(
        (btn) => btn.textContent?.trim() === "Apply",
      )!;
      applyBtn.click();

      await vi.waitFor(() => {
        const filteredRead = route.readLog.find(
          (r) => r.member === "instanceTable" && Array.isArray(r.inputs.filters) && r.inputs.filters.length === 2,
        );
        expect(filteredRead).toBeTruthy();
        expect(filteredRead!.inputs.filters).toEqual([
          { field: "amount", operator: "gte", value: "2000" },
          { field: "note", operator: "notnull" },
        ]);
        expect(filteredRead!.inputs.sort).toEqual({ field: "amount", order: "desc" });
        expect(element.querySelector("[data-table-filter-tag]")?.textContent).toContain("3 filters");
      });

      // Single-clicking a table row highlights without navigating; double-clicking opens object detail /browser/views?selected=Order~ord-1.
      const firstRow = element.querySelector<HTMLElement>("tbody tr")!;
      expect(firstRow).toBeTruthy();
      firstRow.click();
      await Promise.resolve();
      expect(route.router.currentRoute.value.fullPath).toContain("/browser/data");
      firstRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.fullPath).toBe("/browser/views?selected=Order~ord-1");
      });
    } finally {
      app.unmount();
    }
  });

  it("opens in-page presentation configuration dialog in table mode and invokes detailPanelForm, clearDetailPanel, and /ontology/panels navigation", async () => {
    const route = mountBrowserRoute({ canConfigure: true });
    const { app, element } = await route.open(
      panelAddress(dataBrowserUse.path, { selectedClass: "Order", viewMode: "table" }),
    );
    try {
      const configBtn = await vi.waitFor(() => {
        const found = Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(
          (btn) => btn.textContent?.includes("Configure presentation"),
        );
        expect(found).toBeTruthy();
        return found!;
      }, { timeout: 5000 });

      const urlBefore = route.router.currentRoute.value.fullPath;
      configBtn.click();

      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Configure object presentation");
        expect(document.body.textContent).toContain("Custom Order Detail");
        expect(route.readLog.some((r) => r.member === "detailPanelForm")).toBe(true);
      }, { timeout: 5000 });
      // Dialog toggle stays purely local and never enters the URL.
      expect(route.router.currentRoute.value.fullPath).toBe(urlBefore);

      // Restore default detail invokes CLEAR_OBJECT_DETAIL_PANEL.
      const clearBtn = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (btn) => btn.textContent?.includes("Restore default detail"),
      )!;
      expect(clearBtn).toBeTruthy();
      clearBtn.click();
      await vi.waitFor(() => {
        expect(route.intentCalls.some((call) => call.operationId === "clearDetailPanel.clearDetailPanel")).toBe(true);
      });

      // Re-open dialog, select a detail panel, save via SAVE_OBJECT_DETAIL_PANEL, then navigate to /ontology/panels.
      configBtn.click();
      const formSelect = await vi.waitFor(() => {
        const select = document.querySelector<HTMLElement>(".db-dialog-form .el-select__wrapper");
        expect(select).toBeTruthy();
        return select!;
      });
      formSelect.click();
      await vi.waitFor(() => {
        const option = Array.from(document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")).find(
          (item) => item.textContent?.includes("Order Detail V2"),
        );
        expect(option).toBeTruthy();
        option!.click();
      });
      const saveBtn = await vi.waitFor(() => {
        const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(".db-dialog-form button")).find(
          (item) => item.textContent?.trim() === "Save" && !item.disabled,
        );
        expect(btn).toBeTruthy();
        return btn!;
      });
      saveBtn.click();
      await vi.waitFor(() => {
        expect(route.intentCalls.some((call) => call.operationId === "detailPanelForm.saveDetailPanel")).toBe(true);
      });

      configBtn.click();
      const manageBtn = await vi.waitFor(() => {
        const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
          (btn) => btn.textContent?.includes("Manage detail panels"),
        );
        expect(found).toBeTruthy();
        return found!;
      });
      manageBtn.click();
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.fullPath).toBe("/ontology/panels");
      });
    } finally {
      app.unmount();
    }
  });

  it("searches instances via instanceGraphSearch and focuses/explores neighborhood via instanceNeighbors", async () => {
    const route = mountBrowserRoute();
    const { app, element } = await route.open(dataBrowserUse.path);
    try {
      await vi.waitFor(() => {
        expect(route.readLog.some((r) => r.member === "instanceGraph" && r.dataName === "overview")).toBe(true);
      }, { timeout: 5000 });

      const searchInput = element.querySelector<HTMLInputElement>('[data-graph-inspector] .db-graph-search-input input')!;
      expect(searchInput).toBeTruthy();
      searchInput.focus();
      searchInput.value = "ORD";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));

      await vi.waitFor(() => {
        expect(route.readLog.some((r) => r.member === "graphSearchResults" && r.inputs.search === "ORD")).toBe(true);
        expect(element.querySelector("[data-graph-candidates]")?.textContent).toContain("ORD-001");
      });

      const resultItem = element.querySelector<HTMLButtonElement>("[data-graph-candidates] .sdk-object-list-item-btn")!;
      expect(resultItem).toBeTruthy();
      resultItem.click();

      await vi.waitFor(() => {
        expect(route.readLog.some((r) => r.member === "instanceGraph" && r.dataName === "neighbors")).toBe(true);
        expect(element.querySelector("[data-node-inspector]")?.textContent).toContain("ORD-001");
      });

      // Inspector neighborhood filter commits atomically to state.neighborFilter on Apply (no immediate re-read on draft edit).
      await vi.waitFor(() => {
        expect(element.querySelector("[data-inspector-neighbor-filter]")).not.toBeNull();
      });
      const neighborReadsBefore = route.readLog.filter((r) => r.member === "instanceGraph" && r.dataName === "neighbors").length;
      const directionSelect = element.querySelector<HTMLElement>('[data-inspector-filter="direction"]')!;
      (directionSelect.querySelector<HTMLElement>(".el-select__wrapper") ?? directionSelect).click();
      await vi.waitFor(() => {
        const option = Array.from(document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")).find(
          (item) => item.textContent?.trim() === "Incoming",
        );
        expect(option).toBeTruthy();
        option!.click();
      });
      expect(route.readLog.filter((r) => r.member === "instanceGraph" && r.dataName === "neighbors").length).toBe(neighborReadsBefore);

      const applyNeighborBtn = element.querySelector<HTMLButtonElement>('[data-inspector-filter="apply"]')!;
      applyNeighborBtn.click();
      await vi.waitFor(() => {
        const filteredRead = route.readLog.find(
          (r) => r.member === "instanceGraph" && r.dataName === "neighbors" && r.runtimeParams?.direction === "incoming",
        );
        expect(filteredRead).toBeTruthy();
      });
    } finally {
      app.unmount();
    }
  });

  it("wires Category 2 graph config, displays sampled counts & truncation/failure info popover, and renders metaField counts on class picker", async () => {
    const instanceGraphProjection = projections.get("builtin-product-9f3c1e20-4b7d-4e92-a814-000000000001");
    expect(instanceGraphProjection?.config?.fitMode).toBe("fit");
    expect(instanceGraphProjection?.config?.expandOn).toBe("activate");
    expect(instanceGraphProjection?.config?.showHint).not.toBe(false);
    expect(instanceGraphProjection?.config?.showNeighborControls).toBe(false);
    const classPickerProjection = projections.get("builtin-product-9f3c1e20-4b7d-4e92-a814-000000000002");
    expect(classPickerProjection?.config?.metaField).toBe("instanceCount");
    const nodeSummaryProjection = projections.get("builtin-product-9f3c1e20-4b7d-4e92-a814-000000000005");
    expect(nodeSummaryProjection?.config?.density).toBe("compact");

    const route = mountBrowserRoute({
      overviewNodeCount: 17,
      overviewTruncated: true,
      overviewComplete: false,
      overviewFailures: ["LegacyType: data source unavailable"],
    });
    const { app, element } = await route.open(dataBrowserUse.path);
    try {
      await vi.waitFor(() => {
        expect(element.querySelector("[data-graph-stats-summary]")?.textContent).toContain("Showing 2 / 17 instances");
      }, { timeout: 5000 });

      const infoBtn = element.querySelector<HTMLButtonElement>("[data-graph-info-trigger]")!;
      expect(infoBtn).toBeTruthy();
      expect(infoBtn.classList.contains("is-warning")).toBe(true);
      infoBtn.click();
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Overview connections reached the display limit");
        expect(document.body.textContent).toContain("LegacyType: data source unavailable");
      });

      // Opening the graph search class picker renders instanceCount meta values via ReferencePicker metaField.
      const pickerTrigger = element.querySelector<HTMLElement>("[data-graph-inspector] .el-select__wrapper")!;
      expect(pickerTrigger).toBeTruthy();
      pickerTrigger.click();
      await vi.waitFor(() => {
        const metas = Array.from(document.querySelectorAll<HTMLElement>("[data-picker-option-meta]")).map(
          (el) => el.textContent?.trim(),
        );
        expect(metas).toContain("12");
        expect(metas).toContain("5");
      });
    } finally {
      app.unmount();
    }
  });
});
