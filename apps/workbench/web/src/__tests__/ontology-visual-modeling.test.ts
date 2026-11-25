import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import {
  ATTRIBUTE,
  DELETE_ATTRIBUTE,
  DELETE_OBJECT_TYPE,
  DELETE_RELATIONSHIP,
  OBJECT_TYPE,
  RELATIONSHIP,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type {
  GraphCanvasEdge,
  GraphCanvasNode,
  GraphCanvasNodeViewportBox,
  GraphCanvasStyleOverrides,
} from "@ontomato/foundation-ui/graph/g6";
import { provideUnsavedChanges } from "@ontomato/platform-shell";
import { PENDING_GRAPH_EDGE_ID } from "../../../../../packages/apps-sdk/src/base/object-graph-export";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/ontology-visual-modeling/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/ontology-visual-modeling/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/ontology-visual-modeling/panel.mjs?raw";
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

const canvasState = {
  nodes: [] as readonly GraphCanvasNode[],
  edges: [] as readonly GraphCanvasEdge[],
  styleOverrides: undefined as GraphCanvasStyleOverrides | undefined,
  emit: null as null | ((event: string, ...args: unknown[]) => void),
  viewportBoxes: new Map<string, GraphCanvasNodeViewportBox>([
    ["Order", { id: "Order", x: 120, y: 120, radius: 31 }],
    ["Customer", { id: "Customer", x: 340, y: 120, radius: 31 }],
  ]),
};

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
    emits: ["update:selected", "update:selected-edges", "blank", "move", "connect", "activate", "hover-node", "viewport", "resized"],
    setup(props, { emit, expose }) {
      canvasState.emit = emit as never;
      expose({
        fit: async () => true,
        focus: async () => undefined,
        zoomBy: async () => 1,
        relayout: async () => undefined,
        nodeViewportBox: (id: string) => canvasState.viewportBoxes.get(id) ?? null,
        nodeViewportRects: () => [...canvasState.viewportBoxes.values()],
        frameRect: () => ({ left: 0, top: 0, right: 640, bottom: 480, width: 640, height: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect),
        exportImage: async () => new Blob(["png"], { type: "image/png" }),
      });
      return () => {
        canvasState.nodes = props.nodes as readonly GraphCanvasNode[];
        canvasState.edges = props.edges as readonly GraphCanvasEdge[];
        canvasState.styleOverrides = props.styleOverrides as GraphCanvasStyleOverrides | undefined;
        return h("div", { class: "mock-g6-canvas" });
      };
    },
  });
  return { ...actual, G6GraphCanvas };
});

const appId = "ontology";
const use = panelUse(
  "ontology-visual-modeling",
  "ontology-visual-modeling",
  "builtin-product-ontology-visual-modeling",
  "/ontology/visual-modeling",
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

const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
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
const members = Object.fromEntries(
  Object.entries(authoring).map(([name, definition]) => {
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
      createdAt: "2026-11-23T00:00:00Z",
      updatedAt: "2026-11-23T00:00:00Z",
    });
    return [name, { ...placement, target: { projectionId: definition.id! } }];
  }),
);

const visualModelingPanel = {
  ...panelRecord(use.panelId, "Visual modeling", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

const objectRef = (primaryKey: string) => ({ className: OBJECT_TYPE, primaryKey });
const relationRef = (primaryKey: string) => ({ className: RELATIONSHIP, primaryKey });
const attrRef = (className: string, name: string) => ({ className: ATTRIBUTE, primaryKey: JSON.stringify([className, name]) });

const sampleNodes = [
  { primaryKey: "Order", label: "订单", fields: { className: "Order", showName: "订单", classDesc: "销售订单" } },
  { primaryKey: "Customer", label: "客户", fields: { className: "Customer", showName: "客户", classDesc: "购买客户" } },
];

const sampleEdges = [
  {
    primaryKey: "placedBy",
    label: "下单客户",
    subtitle: "订单 → 客户",
    fields: { fromclass: "Order", toclass: "Customer", desc: "下单客户" },
  },
];

const sampleAttributes = [
  {
    primaryKey: JSON.stringify(["Order", "id"]),
    label: "订单编号",
    fields: {
      className: "Order",
      name: "id",
      type: "STRING",
      attrDesc: "销售订单唯一标识",
      primaryKey: "true",
      businessKey: "false",
      enable: "true",
    },
  },
  {
    primaryKey: JSON.stringify(["Order", "amount"]),
    label: "金额",
    fields: {
      className: "Order",
      name: "amount",
      type: "DOUBLE",
      attrDesc: "",
      primaryKey: "false",
      businessKey: "true",
      enable: "false",
    },
  },
];

function simpleForm(objectType: string, values: Record<string, RuntimeJsonValue>) {
  return {
    revision: 1,
    fields: Object.keys(values).map((key) => ({
      path: `/${key}`,
      label: key,
      required: false,
      readOnly: false,
      valueSchema: { type: "string" },
      control: { kind: "text" },
    })),
    values,
    errors: [],
    save: { method: "POST", path: `/mock/${objectType}`, bodySchema: {} },
  };
}

function classInlineFormDescription(primaryKey: string) {
  const node = sampleNodes.find((item) => item.primaryKey === primaryKey);
  return {
    revision: 1,
    fields: [
      {
        path: "/showName",
        label: "Display name",
        required: false,
        readOnly: false,
        submitOn: "blur",
        valueSchema: { type: "string" },
        control: { kind: "text" },
      },
      {
        path: "/className",
        label: "API name",
        required: false,
        readOnly: true,
        valueSchema: { type: "string" },
        control: { kind: "hidden" },
      },
      {
        path: "/classDesc",
        label: "Business description",
        required: false,
        readOnly: false,
        submitOn: "blur",
        valueSchema: { type: "string" },
        control: { kind: "text", multiline: true },
      },
    ],
    values: {
      className: node?.primaryKey ?? primaryKey,
      showName: node?.fields.showName ?? "",
      classDesc: node?.fields.classDesc ?? "",
    },
    errors: [],
    save: { method: "POST", path: `/mock/${OBJECT_TYPE}`, bodySchema: {} },
  };
}

function attributeInlineFormDescription(primaryKey: string) {
  const attr = sampleAttributes.find((item) => item.primaryKey === primaryKey);
  const isPk = attr?.fields.primaryKey === "true";
  const isVarchar = attr?.fields.type === "varchar" || attr?.fields.type === "STRING";
  return {
    revision: 1,
    fields: [
      {
        path: "/className",
        label: "Owner",
        required: true,
        readOnly: true,
        valueSchema: { type: "string" },
        control: { kind: "hidden" },
      },
      {
        path: "/name",
        label: "API name",
        required: true,
        readOnly: true,
        valueSchema: { type: "string" },
        control: { kind: "hidden" },
      },
      {
        path: "/type",
        label: "Data type",
        required: true,
        readOnly: true,
        valueSchema: { type: "string" },
        control: { kind: "text" },
      },
      {
        path: "/showName",
        label: "Display name",
        required: false,
        readOnly: false,
        submitOn: "blur",
        valueSchema: { type: "string" },
        control: { kind: "text" },
      },
      {
        path: "/attrDesc",
        label: "Description",
        required: false,
        readOnly: false,
        submitOn: "blur",
        valueSchema: { type: "string" },
        control: { kind: "text", multiline: true },
      },
      {
        path: "/enable",
        label: "Enabled",
        required: false,
        readOnly: isPk,
        submitOn: "change",
        valueSchema: { type: "boolean" },
        control: { kind: "switch" },
      },
      {
        path: "/businessKey",
        label: "Business key",
        required: false,
        readOnly: false,
        submitOn: "change",
        valueSchema: { type: "boolean" },
        control: { kind: "switch" },
      },
      {
        path: "/primaryKey",
        label: "Primary key",
        required: false,
        readOnly: isPk || !isVarchar,
        submitOn: "change",
        valueSchema: { type: "boolean" },
        control: { kind: "switch" },
      },
    ],
    values: {
      className: attr?.fields.className ?? "Order",
      name: attr?.fields.name ?? "id",
      type: attr?.fields.type ?? "STRING",
      showName: attr?.label ?? "",
      attrDesc: attr?.fields.attrDesc ?? "",
      enable: attr?.fields.enable === "true",
      businessKey: attr?.fields.businessKey === "true",
      primaryKey: isPk,
    },
    errors: [],
    save: { method: "POST", path: `/mock/${ATTRIBUTE}`, bodySchema: {} },
  };
}

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;
type PageControllerHandle = {
  applyState(patch: Readonly<Record<string, RuntimeJsonValue>>): void;
};

function mountVisualModeling(options: {
  initialState?: Record<string, unknown>;
  onRead?: (body: DataReadRequest) => Response | undefined;
  onIntent?: (body: Record<string, unknown>) => { confirmation?: Record<string, unknown> } | undefined;
  confirmLeave?: () => boolean | Promise<boolean>;
} = {}) {
  canvasState.nodes = [];
  canvasState.edges = [];
  canvasState.styleOverrides = undefined;
  canvasState.emit = null;
  const dispatchedIntents: Array<Record<string, unknown>> = [];
  let controller: PageControllerHandle | null = null;
  const confirmLeaveUnsaved = vi.fn(async () => (options.confirmLeave ? await options.confirmLeave() : true));
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
      {
        path: "/browser/data/:className",
        component: { render: () => h("div", { class: "mock-browser-data" }) },
      },
    ],
  });

  const sent = installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (path === `/api/product-panels/${visualModelingPanel.id}`) return panelAnswer(visualModelingPanel, request);
    if (path === `/api/product-panels/${visualModelingPanel.id}/snapshot`) {
      return panelSnapshot(visualModelingPanel, Object.fromEntries(projections), request);
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      const member = body.memberPath[0]?.member;
      if ("operations" in body) {
        const describeOp = (handlerRef: string, label: string) => ({
          handlerRef,
          kind: "action",
          label,
          effect: "write",
          batch: false,
          target: { source: "input", input: "target" },
          inputSchema: { type: "object" },
          resultSchema: { type: "object" },
        });
        const describeFormSave = (handlerRef: string, slot: string, isDraft: boolean) => ({
          kind: "form.save",
          handlerRef,
          label: "Save",
          effect: "write",
          batch: false,
          target: isDraft ? { source: "draft", slot } : { source: "input", input: "target" },
          inputSchema: { type: "object" },
          resultSchema: { type: "object" },
        });
        const map: Record<string, unknown> = {};
        if (member === "classDelete") map.delete = describeOp(DELETE_OBJECT_TYPE, "Delete object type");
        if (member === "relationDelete") map.delete = describeOp(DELETE_RELATIONSHIP, "Delete relationship");
        if (member === "attributes") {
          map.delete = {
            ...describeOp(DELETE_ATTRIBUTE, "Delete attribute"),
            target: { source: "row" },
          };
        }
        if (member === "classCreate") map.save = describeFormSave(`${OBJECT_TYPE}.save`, "classCreate", true);
        if (member === "relationCreate") map.save = describeFormSave(`${RELATIONSHIP}.save`, "relationCreate", true);
        if (member === "attributeCreate") map.save = describeFormSave(`${ATTRIBUTE}.save`, "attributeCreate", true);
        if (member === "classForm") map.save = describeFormSave(`${OBJECT_TYPE}.save`, "classForm", false);
        if (member === "classInlineForm") map.save = describeFormSave(`${OBJECT_TYPE}.save`, "classInlineForm", false);
        if (member === "relationForm") map.save = describeFormSave(`${RELATIONSHIP}.save`, "relationForm", false);
        if (member === "attributeInlineForm") {
          map.save = describeFormSave(`${ATTRIBUTE}.save`, "attributeInlineForm", false);
        }
        return Response.json({ status: "ready", value: map });
      }
      const custom = options.onRead?.(body);
      if (custom) return custom;
      if (member === "graph" && body.dataName === "nodes") {
        return Response.json({ status: "ready", value: sampleNodes });
      }
      if (member === "graph" && body.dataName === "edges") {
        return Response.json({ status: "ready", value: sampleEdges });
      }
      if (member === "nodeHeader" && body.dataName === "record") {
        const key = (body.inputs.target as { primaryKey?: string } | undefined)?.primaryKey ?? "";
        const found = sampleNodes.find((item) => item.primaryKey === key);
        return found
          ? Response.json({ status: "ready", value: found })
          : Response.json({ status: "error", message: "Not found" });
      }
      if (member === "edgeHeader" && body.dataName === "record") {
        const key = (body.inputs.target as { primaryKey?: string } | undefined)?.primaryKey ?? "";
        const found = sampleEdges.find((item) => item.primaryKey === key);
        return found
          ? Response.json({ status: "ready", value: found })
          : Response.json({ status: "error", message: "Not found" });
      }
      if (member === "attributes" && body.dataName === "rows") {
        const cls = body.inputs.className;
        const rows = cls === "Order" ? sampleAttributes : [];
        return Response.json({
          status: "ready",
          value: rows,
          rowOperations: Object.fromEntries(
            rows.map((row) => [
              row.primaryKey,
              {
                delete: {
                  available: row.fields.primaryKey !== "true",
                  ...(row.fields.primaryKey === "true"
                    ? { unavailable: { reason: "Primary key attributes cannot be deleted." } }
                    : {}),
                },
              },
            ]),
          ),
        });
      }
      if (member === "classForm") {
        return Response.json({ status: "ready", value: simpleForm(OBJECT_TYPE, { showName: "订单" }) });
      }
      if (member === "classInlineForm") {
        const key = (body.inputs.target as { primaryKey?: string } | undefined)?.primaryKey ?? "Order";
        return Response.json({ status: "ready", value: classInlineFormDescription(key) });
      }
      if (member === "classCreate") {
        return Response.json({ status: "ready", value: simpleForm(OBJECT_TYPE, { className: "" }) });
      }
      if (member === "relationForm") {
        return Response.json({ status: "ready", value: simpleForm(RELATIONSHIP, { desc: "下单客户" }) });
      }
      if (member === "relationCreate") {
        return Response.json({ status: "ready", value: simpleForm(RELATIONSHIP, { relationship: "" }) });
      }
      if (member === "attributeInlineForm") {
        const key = (body.inputs.target as { primaryKey?: string } | undefined)?.primaryKey ?? JSON.stringify(["Order", "id"]);
        return Response.json({ status: "ready", value: attributeInlineFormDescription(key) });
      }
      return Response.json({ status: "empty" });
    }
    const intentId = "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d07";
    if (path === "/api/panel-operations/intents") {
      const body = request.body as Record<string, unknown>;
      dispatchedIntents.push(body);
      const customIntent = options.onIntent?.(body);
      const preparation = {
        intentId,
        operationId: String(body.operationId ?? "classDelete.delete"),
        label: "Execute operation",
        confirmation: customIntent?.confirmation ?? { kind: "none" },
      };
      return Response.json(preparation);
    }
    if (path === `/api/panel-operation-intents/${intentId}`) {
      return Response.json({
        intentId,
        operationId: String(dispatchedIntents.at(-1)?.operationId ?? "classDelete.delete"),
        label: "Execute operation",
        confirmation: { kind: "none" },
      });
    }
    if (path === `/api/panel-operations/intents/${intentId}/cancel`) {
      return Response.json({ kind: "cancelled", intentId });
    }
    if (path === `/api/panel-operations/intents/${intentId}/dispatch`) {
      return Response.json({
        kind: "dispatched",
        intentId,
        outcome: {
          kind: "success",
          data: {},
          affected: {
            objects: [{ objectType: OBJECT_TYPE, primaryKey: "Order" }],
            objectTypes: [OBJECT_TYPE, ATTRIBUTE],
          },
        },
      });
    }
    return nothingAt(request);
  }, router);

  return {
    router,
    sent,
    dispatchedIntents,
    confirmLeaveUnsaved,
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
          entryAccess: ["domain-member"],
          scheduleAdapter: null,
          releaseId: null,
          panelUses: [use],
        },
      ];
      await router.push(panelAddress(use.path, options.initialState ?? {}, visualModelingPanel.manifest));
      const Shell = defineComponent({
        setup() {
          provideUnsavedChanges(confirmLeaveUnsaved);
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

describe("ontology-visual-modeling builtin panel", () => {
  it("composes exclusively from official projections with zero PanelData or DOM fit hacks", () => {
    expect(module).not.toContain("usePanelData");
    expect(module).not.toContain("querySelector");
    expect(html).not.toMatch(/100vh|@media|--el-|<el-/u);
    for (const member of Object.values(source.manifest.members)) {
      expect(member.component).not.toBe("PanelData");
    }
    expect(source.manifest.members.graph.component).toBe("VisualModelingGraph");
    expect(source.manifest.members.nodeHeader.component).toBe("ObjectHeader");
    expect(source.manifest.members.edgeHeader.component).toBe("ObjectHeader");
    expect(source.manifest.members.attributes.component).toBe("ObjectList");
    expect(source.manifest.members.classInlineForm.data).toEqual({ form: "inlineForm" });
    expect(source.manifest.members.attributeInlineForm.data).toEqual({ form: "inlineForm" });
    expect(source.manifest.state.positions.personal).toBe(true);
    expect(source.manifest.state.selectedNode.deepLink).toBe(true);
    expect(source.manifest.state.selectedEdge.deepLink).toBe(true);
    expect(source.manifest.state.selectedAttribute.deepLink).toBe(true);
    expect("deepLink" in source.manifest.state.dialog).toBe(false);
    expect("className" in source.manifest.state).toBe(false);
    expect(source.manifest.members.attributes.data.rows.params.className).toEqual({
      state: "selectedNode",
      field: "primaryKey",
    });
    expect(html).not.toContain("update:listed");
    expect(module).not.toContain("onAttributesListed");
    expect("toggleable" in source.manifest.members.attributes.config).toBe(false);
  });

  it("renders ObjectHeader, inline blur-save classInlineForm, and per-card inline editable attributeInlineForm cards (VM-07 / VM-08)", async () => {
    const harness = mountVisualModeling({
      initialState: {
        selectedNode: objectRef("Order"),
      },
    });
    const { app, element } = await harness.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelector(".vm-side")?.textContent).toContain("订单");
        expect(element.querySelector(".vm-side")?.textContent).toContain("Order");
        expect(element.querySelector("[data-member='classInlineForm']")).not.toBeNull();
        expect(element.querySelectorAll(".vm-attr-card")).toHaveLength(2);
        expect(element.querySelector(".vm-section-head")?.textContent).toMatch(/2/);
      }, { timeout: 5000 });

      const cards = element.querySelectorAll<HTMLElement>(".vm-attr-card");
      expect(cards[0]!.textContent).toContain("订单编号");
      expect(cards[0]!.textContent).toContain("id");
      expect(cards[0]!.textContent).toContain("STRING");
      expect(cards[1]!.textContent).toContain("金额");
      expect(cards[1]!.textContent).toContain("amount");
      expect(cards[1]!.textContent).toContain("DOUBLE");

      // VM-07: Right-panel object displayName / description save on blur with submittedFields, without manual Save button.
      expect(element.querySelector("[data-member='classInlineForm'] .sdk-owner-form-actions")).toBeNull();
      const classShowName = element.querySelector<HTMLInputElement>('[data-member="classInlineForm"] [data-field="/showName"] input')!;
      classShowName.value = "销售订单";
      classShowName.dispatchEvent(new Event("input", { bubbles: true }));
      expect(harness.dispatchedIntents).toHaveLength(0);
      classShowName.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await vi.waitFor(() => {
        expect(harness.dispatchedIntents.length).toBeGreaterThanOrEqual(1);
      });
      expect(harness.dispatchedIntents.at(-1)).toMatchObject({
        operationId: "classInlineForm.save",
        call: {
          input: {
            submittedFields: ["/showName"],
            values: expect.objectContaining({ showName: "销售订单" }),
          },
        },
      });

      // VM-08: Attribute card showName saves on blur, and businessKey switch saves immediately on change.
      const card1ShowName = cards[1]!.querySelector<HTMLInputElement>('[data-field="/showName"] input')!;
      card1ShowName.value = "订单金额";
      card1ShowName.dispatchEvent(new Event("input", { bubbles: true }));
      card1ShowName.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await vi.waitFor(() => {
        expect(harness.dispatchedIntents.some((intent) =>
          intent.operationId === "attributeInlineForm.save"
          && Array.isArray((intent.call as { input?: { submittedFields?: string[] } })?.input?.submittedFields)
          && (intent.call as { input: { submittedFields: string[] } }).input.submittedFields.includes("/showName"),
        )).toBe(true);
      });

      const card1BizKey = cards[1]!.querySelector<HTMLElement>('[data-field="/businessKey"] .el-switch')!;
      card1BizKey.click();
      await vi.waitFor(() => {
        expect(harness.dispatchedIntents.some((intent) =>
          intent.operationId === "attributeInlineForm.save"
          && Array.isArray((intent.call as { input?: { submittedFields?: string[] } })?.input?.submittedFields)
          && (intent.call as { input: { submittedFields: string[] } }).input.submittedFields.includes("/businessKey"),
        )).toBe(true);
      });

      // VM-06: Extra "Browse data" button is removed from the node side inspector.
      const browseBtn = Array.from(element.querySelectorAll<HTMLButtonElement>(".vm-side button"))
        .find((btn) => btn.textContent?.includes("浏览数据") || btn.textContent?.includes("Browse data"));
      expect(browseBtn).toBeUndefined();
    } finally {
      app.unmount();
    }
  });

  it("VM-02 / VM-03 / VM-04 / VM-05: wires VisualModelingGraph top-four toolbar, halo/pill style, hover ports + pending edge, and double-click choose edit dialogs", async () => {
    const harness = mountVisualModeling();
    const { app, element } = await harness.open();
    try {
      await vi.waitFor(() => {
        expect(canvasState.nodes).toHaveLength(2);
      });

      // VM-02: Top-left 4-action toolbar with right actions slot; floating toolbar, focus-selected, and download omitted.
      const topToolbar = element.querySelector("[data-graph-top-toolbar]");
      expect(topToolbar).not.toBeNull();
      expect(element.querySelector(".sdk-object-graph-canvas-tools")).toBeNull();
      expect(topToolbar!.querySelectorAll("[data-graph-action]")).toHaveLength(4);
      expect(topToolbar!.querySelector("[data-graph-action='zoom-in']")).not.toBeNull();
      expect(topToolbar!.querySelector("[data-graph-action='zoom-out']")).not.toBeNull();
      expect(topToolbar!.querySelector("[data-graph-action='fit']")).not.toBeNull();
      expect(topToolbar!.querySelector("[data-graph-action='relayout']")).not.toBeNull();
      expect(element.querySelector("[data-graph-action='focus-selected']")).toBeNull();
      expect(element.querySelector("[data-graph-action='download']")).toBeNull();

      // VM-05: Independent node selection halo and capsule pill edge labels.
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

      // VM-03: Double-clicking a node opens editClassDialog; double-clicking an edge opens editRelationDialog.
      canvasState.emit?.("activate", { kind: "node", id: "Order" });
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='classForm']")).not.toBeNull();
      });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='classForm']")).toBeNull();
      });

      canvasState.emit?.("activate", { kind: "edge", id: "placedBy" });
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='relationForm']")).not.toBeNull();
      });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='relationForm']")).toBeNull();
      });

      // VM-04: Hovering a node shows four directional connection ports; dragging opens relationCreate with visual pending edge, and cancel removes it.
      canvasState.emit?.("hover-node", "Order");
      await nextTick();
      const ports = element.querySelectorAll<HTMLButtonElement>("[data-connect-port]");
      expect(ports).toHaveLength(4);
      expect([...ports].map((port) => port.dataset.connectPort)).toEqual(["top", "right", "bottom", "left"]);

      const rightPort = element.querySelector<HTMLButtonElement>("[data-connect-port='right']")!;
      rightPort.dispatchEvent(new MouseEvent("pointerdown", { clientX: 151, clientY: 120, bubbles: true }));
      await nextTick();
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 340, clientY: 120 }));
      await nextTick();
      expect(element.querySelector("[data-connect-preview]")).not.toBeNull();

      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 340, clientY: 120 }));
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='relationCreate']")).not.toBeNull();
        expect(canvasState.edges.some((edge) => edge.id === PENDING_GRAPH_EDGE_ID && edge.source === "Order" && edge.target === "Customer" && edge.line === "dashed")).toBe(true);
      });

      // Cancelling the create dialog clears connectFrom/connectTo and immediately removes the temporary pending edge.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='relationCreate']")).toBeNull();
        expect(canvasState.edges.some((edge) => edge.id === PENDING_GRAPH_EDGE_ID)).toBe(false);
      });
    } finally {
      app.unmount();
    }
  });

  it("keeps the side inspector closed for a deep-linked relationship edge and opens edit dialog from the toolbar", async () => {
    const harness = mountVisualModeling({
      initialState: { selectedEdge: relationRef("placedBy") },
    });
    const { app, element } = await harness.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelector(".vm-side")).toBeNull();
        expect(element.querySelector("[data-graph-top-toolbar]")?.textContent).toContain("下单客户");
      });
      const editBtn = Array.from(element.querySelectorAll<HTMLButtonElement>(".vm-selection-actions button"))
        .find((btn) => btn.textContent?.includes("Edit") || btn.textContent?.includes("编辑"));
      expect(editBtn).toBeDefined();
      expect(editBtn!.disabled).toBe(false);
      editBtn!.click();
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='relationForm']")).not.toBeNull();
        expect(document.body.querySelector("[data-member='relationEditFrom']")).not.toBeNull();
        expect(document.body.querySelector("[data-member='relationEditTo']")).not.toBeNull();
      });
    } finally {
      app.unmount();
    }
  });

  it("opens relation create dialog on Shift-connect and closes dialog before selection on Escape", async () => {
    const harness = mountVisualModeling({
      initialState: { selectedNode: objectRef("Order") },
    });
    const { app, element } = await harness.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelector(".vm-side")?.textContent).toContain("订单");
      });

      harness.controller()!.applyState({ connectFrom: "Order", connectTo: "Customer" });
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='relationCreate']")).not.toBeNull();
      });

      // First Escape closes the create dialog while keeping the side inspector open.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='relationCreate']")).toBeNull();
      });
      expect(element.querySelector(".vm-side")).not.toBeNull();

      // Second Escape clears selectedNode and closes the side inspector.
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      await vi.waitFor(() => {
        expect(element.querySelector(".vm-side")).toBeNull();
      });
    } finally {
      app.unmount();
    }
  });

  it("keeps selectedNode and forms mounted when a refresh read fails, showing the error in place", async () => {
    let failing = false;
    const harness = mountVisualModeling({
      initialState: {
        selectedNode: objectRef("Order"),
        selectedAttribute: attrRef("Order", "amount"),
      },
      onRead: (body) => {
        if (body.memberPath[0]?.member === "nodeHeader" && body.dataName === "record" && failing) {
          return Response.json({ status: "error", message: "Temporary read failure" });
        }
        return undefined;
      },
    });
    const { app, element } = await harness.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelector(".vm-side")?.textContent).toContain("订单");
        expect(element.querySelector("[data-member='classInlineForm']")).not.toBeNull();
        expect(element.querySelectorAll(".vm-attr-card")).toHaveLength(2);
      });

      failing = true;
      // Trigger an affected refresh on Order via an inline blur save on classInlineForm.
      const showNameInput = element.querySelector<HTMLInputElement>('[data-member="classInlineForm"] [data-field="/showName"] input')!;
      showNameInput.value = "订单重命名";
      showNameInput.dispatchEvent(new Event("input", { bubbles: true }));
      showNameInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await vi.waitFor(() => {
        expect(element.querySelector(".vm-side")?.textContent).toContain("Temporary read failure");
      });
      // Selection, side panel, and edit form remain mounted instead of being silently closed.
      expect(element.querySelector(".vm-side")).not.toBeNull();
      expect(element.querySelector("[data-member='classInlineForm']")).not.toBeNull();
    } finally {
      app.unmount();
    }
  });

  it("hides edit forms while showing the real error when opening a missing object directly", async () => {
    const harness = mountVisualModeling({
      initialState: { selectedNode: objectRef("MissingClass") },
    });
    const { app, element } = await harness.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelector("[data-member='nodeHeader']")?.textContent).toContain("Not found");
      });
      expect(element.querySelector("[data-member='classInlineForm']")).toBeNull();
    } finally {
      app.unmount();
    }
  });

  it("enforces node/edge mutual exclusion on agent present patches and cleans stale connect endpoints for relation dialog", async () => {
    const harness = mountVisualModeling({
      initialState: {
        selectedNode: objectRef("Order"),
        selectedAttribute: attrRef("Order", "id"),
      },
    });
    const { app, element } = await harness.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelector(".vm-side")?.textContent).toContain("订单");
      });

      // Patching selectedEdge while selectedNode is active switches to the edge, closes the node side inspector,
      // and clears selectedNode/selectedAttribute (VM-06: selecting an edge keeps full-width canvas).
      harness.controller()!.applyState({ selectedEdge: relationRef("placedBy") });
      await vi.waitFor(() => {
        expect(element.querySelector(".vm-side")).toBeNull();
        expect(element.querySelector("[data-graph-top-toolbar]")?.textContent).toContain("下单客户");
        expect(element.querySelector("[data-member='classInlineForm']")).toBeNull();
      });

      // Patching selectedNode while selectedEdge is active switches back to the node and clears selectedEdge.
      harness.controller()!.applyState({ selectedNode: objectRef("Customer") });
      await vi.waitFor(() => {
        expect(element.querySelector(".vm-side")?.textContent).toContain("客户");
        expect(element.querySelector("[data-member='classInlineForm']")).not.toBeNull();
      });

      // Shift-connect opens relationCreate with endpoints; closing dialog via present({ dialog: null }) clears them,
      // and directly presenting dialog: "relation" without endpoints clears any stale connectFrom/connectTo.
      harness.controller()!.applyState({ connectFrom: "Order", connectTo: "Customer" });
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='relationCreate']")).not.toBeNull();
      });

      harness.controller()!.applyState({ dialog: null });
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='relationCreate']")).toBeNull();
      });

      // Leave a stale single endpoint, then open dialog: "relation" cleanly via present.
      harness.controller()!.applyState({ connectFrom: "Order" });
      harness.controller()!.applyState({ dialog: "relation" });
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='relationCreate']")).not.toBeNull();
      });
      // Re-triggering Shift-connect with the same pair still opens the dialog after closing (proves endpoints were cleared).
      harness.controller()!.applyState({ dialog: null });
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='relationCreate']")).toBeNull();
      });
      harness.controller()!.applyState({ connectFrom: "Order", connectTo: "Customer" });
      await vi.waitFor(() => {
        expect(document.body.querySelector("[data-member='relationCreate']")).not.toBeNull();
      });
    } finally {
      app.unmount();
    }
  });

  it("clears selectedNode immediately when classDelete operation succeeds", async () => {
    const harness = mountVisualModeling({
      initialState: { selectedNode: objectRef("Order") },
    });
    const { app, element } = await harness.open();
    try {
      await vi.waitFor(() => {
        const delBtn = element.querySelector<HTMLButtonElement>("[data-member='classDelete'] button");
        expect(delBtn).not.toBeNull();
        expect(delBtn?.disabled).toBe(false);
      });

      const delBtn = element.querySelector<HTMLButtonElement>("[data-member='classDelete'] button")!;
      delBtn.click();
      await vi.waitFor(() => {
        expect(element.querySelector(".vm-side")).toBeNull();
      });
    } finally {
      app.unmount();
    }
  });

  it("guards create dialog close via before-close so cancelling keeps unsaved fields intact", async () => {
    let allowLeave = false;
    const harness = mountVisualModeling({
      confirmLeave: () => allowLeave,
    });
    const { app, element } = await harness.open();
    try {
      let addClassBtn: HTMLButtonElement | undefined;
      await vi.waitFor(() => {
        addClassBtn = Array.from(element.querySelectorAll<HTMLButtonElement>(".sdk-page-header button"))
          .find((btn) => btn.textContent?.includes("Add object type") || btn.textContent?.includes("添加对象类型"));
        expect(addClassBtn).toBeDefined();
      });
      // Unselected node leaves `attributes` awaiting without issuing a read request.
      const attrReadsWhileUnselected = harness.sent.filter(
        (req) =>
          req.path === "/api/product-panels/read" &&
          (req.body as ProductPanelReadRequest).memberPath[0]?.member === "attributes",
      );
      expect(attrReadsWhileUnselected).toHaveLength(0);
      addClassBtn!.click();

      let input: HTMLInputElement | null = null;
      await vi.waitFor(() => {
        input = document.body.querySelector<HTMLInputElement>("[data-member='classCreate'] input");
        expect(input).not.toBeNull();
      });

      input!.value = "Invoice";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.waitFor(() => {
        const createBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>("[data-member='classCreate'] button"))
          .find((btn) => btn.classList.contains("el-button--primary"));
        expect(createBtn).toBeDefined();
        expect(createBtn?.disabled).toBe(false);
      });

      // Clicking the dialog header close button (X) prompts before hiding; cancelling keeps dialog and draft intact.
      const closeBtn = document.body.querySelector<HTMLButtonElement>(".el-dialog__headerbtn");
      expect(closeBtn).not.toBeNull();
      closeBtn!.click();

      await vi.waitFor(() => {
        expect(harness.confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const keptInput = document.body.querySelector<HTMLInputElement>("[data-member='classCreate'] input");
      expect(keptInput).not.toBeNull();
      expect(keptInput?.value).toBe("Invoice");

      // Confirming discard closes the dialog and removes the form.
      allowLeave = true;
      closeBtn!.click();
      await vi.waitFor(() => {
        expect(harness.confirmLeaveUnsaved).toHaveBeenCalledTimes(2);
        expect(document.body.querySelector("[data-member='classCreate']")).toBeNull();
      });
    } finally {
      app.unmount();
    }
  });
});
