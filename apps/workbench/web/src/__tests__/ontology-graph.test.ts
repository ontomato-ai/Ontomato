import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import {
  OBJECT_TYPE,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type {
  GraphCanvasEdge,
  GraphCanvasNode,
  GraphCanvasStyleOverrides,
} from "@ontomato/foundation-ui/graph/g6";
import { provideUnsavedChanges } from "@ontomato/platform-shell";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import {
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  nothingAt,
  panelAnswer,
  panelRecord,
  panelSnapshot,
  panelUse,
  type Sent,
} from "./panel-frame";

/*
 * Built-in ontology-graph panel contract (OG-01 / OG-08 / OG-10 / OG-11):
 * - OG-01: Header "Product relation graph" button opens fullscreen dialog hosting ProductAssetGraph reading
 *   `productGraph`, rendering categorized asset columns, highlighting incident edges on hover/focus, and
 *   navigating to real asset detail routes on click.
 * - OG-08: Main graph member uses OntologyModelGraph with 5px node strokes, 6px/7px selected/path strokes,
 *   4px selected/path edge strokes, and 0.16 node / 0.12 edge non-match dimming.
 * - OG-10: PNG export passes solid background to G6 exportImage and downloads with dated `ontology-graph-YYYY-MM-DD.png`.
 * - OG-11: Technical/stack read errors are sanitized to reader-safe text and same-target reread failures keep
 *   previous content visible under an inline retry banner.
 */

const graphCanvasState = {
  nodes: [] as readonly GraphCanvasNode[],
  edges: [] as readonly GraphCanvasEdge[],
  styleOverrides: undefined as GraphCanvasStyleOverrides | undefined,
  exportCalls: [] as Array<Record<string, unknown> | undefined>,
};
const savedFiles: Array<{ mime: string; suggestedName: string; size: number }> = [];

vi.mock("../../../../../packages/apps-sdk/src/panel/save-file", () => ({
  savePanelFile: (file: { bytes: Uint8Array; mime: string; suggestedName: string }) => {
    savedFiles.push({ mime: file.mime, suggestedName: file.suggestedName, size: file.bytes.byteLength });
  },
}));

vi.mock("@ontomato/foundation-ui/graph/g6", async () => {
  const actual = await vi.importActual<typeof import("@ontomato/foundation-ui/graph/g6")>(
    "@ontomato/foundation-ui/graph/g6",
  );
  const G6GraphCanvas = defineComponent({
    name: "G6GraphCanvas",
    props: {
      label: { type: String, required: true },
      nodes: { type: Array, default: () => [] },
      edges: { type: Array, default: () => [] },
      selected: { type: Array, default: () => [] },
      selectedEdges: { type: Array, default: () => [] },
      styleOverrides: { type: Object, default: undefined },
    },
    emits: ["update:selected", "update:selected-edges", "blank", "move", "connect", "activate", "viewport"],
    setup(props, { expose }) {
      expose({
        fit: async () => true,
        focus: async () => undefined,
        zoomBy: async () => 1,
        relayout: async () => undefined,
        exportImage: async (options?: Record<string, unknown>) => {
          graphCanvasState.exportCalls.push(options);
          return new Blob(["png"], { type: "image/png" });
        },
      });
      return () => {
        graphCanvasState.nodes = props.nodes as readonly GraphCanvasNode[];
        graphCanvasState.edges = props.edges as readonly GraphCanvasEdge[];
        graphCanvasState.styleOverrides = props.styleOverrides as GraphCanvasStyleOverrides | undefined;
        return h("div", { class: "mock-g6-canvas" });
      };
    },
  });
  return { ...actual, G6GraphCanvas };
});

const appId = "ontology";
const use = panelUse(
  "ontology-graph",
  "ontology-graph",
  "builtin-product-ontology-graph",
  "/ontology/graph",
);

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => {
        const form = id.endsWith(".save") || id.endsWith(".create");
        return {
          id,
          kind: form ? "form.save" : "action",
          effect: "write",
          batch: false,
          inputSchema: {},
          target: form ? { source: "draft" } : { source: "input", input: "target" },
        };
      }),
    }),
  ]),
);

const dir = resolve(process.cwd(), "../../packages/ontology-manager/resources/builtin-panels/ontology-graph");
const source = JSON.parse(readFileSync(resolve(dir, "panel.json"), "utf8"));
const html = readFileSync(resolve(dir, "panel.html"), "utf8");
const module = readFileSync(resolve(dir, "panel.mjs"), "utf8");
const { members: authoringMembers, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation local name" }] }
      : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);
const projections = new Map<string, ProductProjection>();
const manifestMembers = Object.fromEntries(
  Object.entries(authoringMembers).map(([name, definition]) => {
    if (!("component" in definition)) throw new Error(`Expected an authored projection for ${name}`);
    const { projection, placement } = expandPanelAuthoringMember(name, definition, {
      state: manifest.state,
      typeTable: { objectTypes },
      components: catalogue,
    });
    projections.set(definition.id!, {
      ...projection,
      id: definition.id!,
      name,
      description: name,
      visibility: "platform",
      domainId: null,
      ownerId: null,
      editable: false,
      revision: 1,
      createdAt: "2026-11-26T00:00:00Z",
      updatedAt: "2026-11-26T00:00:00Z",
    });
    return [name, { ...placement, target: { projectionId: definition.id! } }];
  }),
);

const ontologyGraphPanel = {
  ...panelRecord(use.panelId, "Ontology graph", definePanel({ ...manifest, members: manifestMembers })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: {
    html,
    module,
    messages: source.content.messages,
  },
};

const sampleObjects = [
  {
    primaryKey: "Order",
    label: "订单",
    fields: {
      className: "Order",
      showName: "订单",
      classDesc: "客户销售订单",
      searchableAttributes: "Order 订单",
    },
  },
  {
    primaryKey: "Customer",
    label: "客户",
    fields: {
      className: "Customer",
      showName: "客户",
      classDesc: "企业与个人客户",
      searchableAttributes: "Customer 客户",
    },
  },
];

const sampleRelations = [
  {
    primaryKey: "placedBy",
    label: "下单客户",
    fields: {
      relationship: "placedBy",
      desc: "下单客户",
      fromclass: "Order",
      toclass: "Customer",
      fromObject: { kind: "reference" as const, className: OBJECT_TYPE, primaryKey: "Order", label: "订单" },
      toObject: { kind: "reference" as const, className: OBJECT_TYPE, primaryKey: "Customer", label: "客户" },
    },
  },
];

const sampleAttributes = [
  {
    primaryKey: JSON.stringify(["Order", "id"]),
    label: "订单编号",
    fields: {
      name: "id",
      showName: "订单编号",
      type: "STRING",
      primaryKey: "true",
      businessKey: "true",
      enable: "true",
    },
  },
];

const sampleProductGraphPayload = {
  nodes: [
    { id: "asset:app-1", assetId: "app-1", name: "Operations Console", kind: "application", category: "bundle" },
    { id: "asset:panel-1", assetId: "panel-1", name: "Order Overview Panel", kind: "page", category: "composition" },
    { id: "asset:proj-1", assetId: "proj-1", name: "Order Summary Card", kind: "object-projection", category: "element" },
    { id: "object-type:Order", name: "Order", kind: "object-type", category: "ontology" },
  ],
  edges: [
    { source: "asset:app-1", target: "asset:panel-1", relation: "includes", storage: "document" },
    { source: "asset:panel-1", target: "asset:proj-1", relation: "uses", storage: "document" },
    { source: "asset:proj-1", target: "object-type:Order", relation: "renders", storage: "ontology" },
  ],
};

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;
type PageControllerHandle = {
  applyState(patch: Readonly<Record<string, RuntimeJsonValue>>): void;
};

function mountOntologyGraph(options: {
  initialState?: Record<string, unknown>;
  onRead?: (body: DataReadRequest) => Response | undefined;
} = {}) {
  graphCanvasState.nodes = [];
  graphCanvasState.edges = [];
  graphCanvasState.styleOverrides = undefined;
  graphCanvasState.exportCalls = [];
  savedFiles.length = 0;

  let controller: PageControllerHandle | null = null;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: use.path,
        component: PanelApplicationRoute,
        props: {
          applicationId: appId,
          registerPageController(next: PageControllerHandle) {
            controller = next;
            return () => {
              if (controller === next) controller = null;
            };
          },
        },
      },
      { path: "/ontology/panels/detail", component: { render: () => h("div", { class: "mock-panel-detail" }) } },
      { path: "/ontology/projections/detail", component: { render: () => h("div", { class: "mock-projection-detail" }) } },
      { path: "/ontology/applications/detail", component: { render: () => h("div", { class: "mock-app-detail" }) } },
      { path: "/ontology/agents/detail", component: { render: () => h("div", { class: "mock-agent-detail" }) } },
      { path: "/ontology/visual-modeling", component: { render: () => h("div", { class: "mock-visual-modeling" }) } },
    ],
  });

  const sent = installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (path === `/api/product-panels/${ontologyGraphPanel.id}`) return panelAnswer(ontologyGraphPanel, request);
    if (path === `/api/product-panels/${ontologyGraphPanel.id}/snapshot`) {
      return panelSnapshot(ontologyGraphPanel, Object.fromEntries(projections), request);
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      const member = body.memberPath[0]?.member;
      if ("operations" in body) {
        return Response.json({ status: "ready", value: {} });
      }
      const custom = options.onRead?.(body);
      if (custom) return custom;
      if (member === "objectStats") return Response.json({ status: "ready", value: { rows: [], total: sampleObjects.length } });
      if (member === "attributeStats") return Response.json({ status: "ready", value: { rows: [], total: sampleAttributes.length } });
      if (member === "relationStats") return Response.json({ status: "ready", value: { rows: [], total: sampleRelations.length } });
      if (member === "objectList" || (member === "graph" && body.dataName === "nodes") || member === "pathFromPicker" || member === "pathToPicker") {
        return Response.json({ status: "ready", value: sampleObjects });
      }
      if (member === "relationList" || (member === "graph" && body.dataName === "edges")) {
        return Response.json({ status: "ready", value: sampleRelations });
      }
      if (member === "productGraph" && body.dataName === "graph") {
        return Response.json({
          status: "ready",
          value: {
            className: OBJECT_TYPE,
            primaryKey: "product-graph",
            label: "Product graph",
            fields: { graph: { kind: "json", value: sampleProductGraphPayload } },
          },
        });
      }
      if ((member === "objectHeader" || member === "objectDesc") && body.dataName === "record") {
        const pk = (body.inputs.target as { primaryKey?: string } | undefined)?.primaryKey ?? "";
        const found = sampleObjects.find((item) => item.primaryKey === pk);
        return found ? Response.json({ status: "ready", value: found }) : Response.json({ status: "empty" });
      }
      if (member === "objectAttributes" && body.dataName === "rows") {
        return Response.json({ status: "ready", value: sampleAttributes });
      }
      if (member === "objectRelations" && body.dataName === "rows") {
        return Response.json({ status: "ready", value: sampleRelations });
      }
      if ((member === "relationHeader" || member === "relationFrom" || member === "relationTo" || member === "relationName") && body.dataName === "record") {
        const pk = (body.inputs.target as { primaryKey?: string } | undefined)?.primaryKey ?? "";
        const found = sampleRelations.find((item) => item.primaryKey === pk);
        return found ? Response.json({ status: "ready", value: found }) : Response.json({ status: "empty" });
      }
      return Response.json({ status: "empty" });
    }
    return nothingAt(request);
  }, router);

  return {
    router,
    sent,
    controller: () => controller,
    async open() {
      useApplicationCatalog().applications.value = [
        {
          id: appId,
          kind: "product",
          names: { en: "Ontology" },
          descriptions: {},
          icon: "ontology",
          rail: "apps",
          category: "build",
          sort: 0,
          entry: { path: "/ontology", renderer: "panels" },
          scheduleAdapter: null,
          releaseId: null,
          panelUses: [use],
        },
      ];
      await router.push(panelAddress(use.path, options.initialState ?? {}, ontologyGraphPanel.manifest));
      const Shell = defineComponent({
        setup() {
          provideUnsavedChanges(async () => true);
          return () => h(RouterView);
        },
      });
      return mountPlatformPage(() => h(Shell), router);
    },
  };
}

afterEach(() => {
  leaveFrame();
  vi.restoreAllMocks();
});

describe("ontology-graph builtin panel (OG-01 / OG-08 / OG-10 / OG-11)", () => {
  it("OG-08 / OG-10: wires OntologyModelGraph styling overrides and solid-background dated PNG export", async () => {
    expect("component" in authoringMembers.graph && authoringMembers.graph.component).toBe("OntologyModelGraph");
    expect("component" in authoringMembers.productGraph && authoringMembers.productGraph.component).toBe("ProductAssetGraph");

    const harness = mountOntologyGraph();
    const { app, element } = await harness.open();
    try {
      await vi.waitFor(() => {
        expect(graphCanvasState.nodes).toHaveLength(2);
        expect(graphCanvasState.edges).toHaveLength(1);
      });

      // OG-08: Exact OntologyModelGraph fixed visual language.
      expect(graphCanvasState.styleOverrides).toEqual({
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

      // OG-10: PNG download passes solid exportBackground and saves under dated ontology-graph-YYYY-MM-DD.png.
      const downloadBtn = element.querySelector<HTMLButtonElement>("[data-graph-action='download']");
      expect(downloadBtn).not.toBeNull();
      downloadBtn!.click();
      await vi.waitFor(() => {
        expect(graphCanvasState.exportCalls).toHaveLength(1);
        expect(savedFiles).toHaveLength(1);
      });
      expect(graphCanvasState.exportCalls[0]).toMatchObject({ background: expect.any(String) });
      expect((graphCanvasState.exportCalls[0] as { background?: string }).background?.trim().length).toBeGreaterThan(0);
      expect(savedFiles[0]!.mime).toBe("image/png");
      expect(savedFiles[0]!.suggestedName).toMatch(/^ontology-graph-\d{4}-\d{2}-\d{2}\.png$/);
    } finally {
      app.unmount();
    }
  });

  it("OG-01: opens fullscreen ProductAssetGraph dialog, highlights incident edges on hover, and navigates to clicked asset", async () => {
    const harness = mountOntologyGraph();
    const { app, element } = await harness.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelector("[data-action='product-relation-graph']")).not.toBeNull();
      });

      const openBtn = element.querySelector<HTMLButtonElement>("[data-action='product-relation-graph']")!;
      openBtn.click();

      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-product-graph-dialog]")).not.toBeNull();
        expect(document.body.querySelectorAll("[data-product-graph-node]")).toHaveLength(4);
      });

      // Verify categorized columns render and hover highlights incident edges while muting unrelated ones.
      expect(
        Array.from(document.body.querySelectorAll<Element>("[data-product-graph-column]")).map((el) =>
          el.getAttribute("data-product-graph-column"),
        ),
      ).toEqual(["bundle", "composition", "element", "ontology"]);
      const panelCard = document.body.querySelector<SVGGElement>('[data-product-graph-node="asset:panel-1"]')!;
      expect(panelCard).not.toBeNull();
      expect(panelCard.textContent).toContain("Order Overview Panel");
      panelCard.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      await vi.waitFor(() => {
        expect(document.body.querySelectorAll("[data-product-graph-edge].related-edge")).toHaveLength(2);
        expect(document.body.querySelectorAll("[data-product-graph-edge].muted-edge")).toHaveLength(1);
      });

      // Clicking an asset card navigates to the panel detail route with real asset primaryKey.
      panelCard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.waitFor(() => {
        expect(harness.router.currentRoute.value.path).toBe("/ontology/panels/detail");
        expect(harness.router.currentRoute.value.query.selected).toBe("panel-1");
      });
    } finally {
      app.unmount();
    }
  });

  it("OG-11: sanitizes raw backend stack traces to reader-safe error text and preserves loaded graph on reread failure", async () => {
    let failGraph = true;
    const harness = mountOntologyGraph({
      onRead: (body) => {
        if (body.memberPath[0]?.member === "graph" && body.dataName === "nodes" && failGraph) {
          return Response.json({
            status: "error",
            message: "Error: ECONNREFUSED 10.0.0.12:8080\n    at fetch (http://internal-service:8080/api)",
          });
        }
        return undefined;
      },
    });
    const { app, element } = await harness.open();
    try {
      // Initial read failure hides empty canvas and renders reader-safe error without technical stack text.
      await vi.waitFor(() => {
        const banner = element.querySelector("[data-graph-read-error]");
        expect(banner).not.toBeNull();
        expect(banner!.textContent).toContain("Unable to read the ontology graph right now");
        expect(banner!.textContent).not.toContain("ECONNREFUSED");
        expect(banner!.textContent).not.toContain("10.0.0.12");
      });
      expect(element.querySelector<HTMLElement>(".og-grid")?.style.display).toBe("none");

      // Retry succeeds and loads the graph workspace.
      failGraph = false;
      const retryBtn = element.querySelector<HTMLButtonElement>("[data-graph-read-error] button")!;
      retryBtn.click();
      await vi.waitFor(() => {
        expect(element.querySelector("[data-graph-read-error]")).toBeNull();
        expect(graphCanvasState.nodes).toHaveLength(2);
      });
      expect(element.querySelector<HTMLElement>(".og-grid")?.style.display).not.toBe("none");

      // Subsequent reread failure preserves the workspace and previous nodes while showing a compact reader-safe banner.
      failGraph = true;
      const headerRefreshBtn = element.querySelector<HTMLButtonElement>("button[title='Refresh']")!;
      headerRefreshBtn.click();
      await vi.waitFor(() => {
        const banner = element.querySelector("[data-graph-read-error]");
        expect(banner).not.toBeNull();
        expect(banner!.textContent).toContain("Unable to read the ontology graph right now");
        expect(banner!.textContent).not.toContain("ECONNREFUSED");
      });
      expect(element.querySelector<HTMLElement>(".og-grid")?.style.display).not.toBe("none");
      expect(graphCanvasState.nodes).toHaveLength(2);
    } finally {
      app.unmount();
    }
  });
});
