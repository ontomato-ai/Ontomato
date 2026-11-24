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
  ATTRIBUTE,
  DELETE_ATTRIBUTE,
  DELETE_OBJECT_TYPE,
  DELETE_RELATIONSHIP,
  OBJECT_TYPE,
  RELATIONSHIP,
  SET_PRIMARY_KEY,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { provideUnsavedChanges } from "@ontomato/platform-shell";
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
    },
    emits: ["update:selected", "update:selected-edges", "blank", "move", "connect", "viewport"],
    setup(_props, { expose }) {
      expose({
        fit: async () => true,
        focus: async () => undefined,
        zoomBy: async () => 1,
        relayout: async () => undefined,
        exportImage: async () => new Blob(["png"], { type: "image/png" }),
      });
      return () => h("div", { class: "mock-g6-canvas" });
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

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;
type PageControllerHandle = {
  applyState(patch: Readonly<Record<string, RuntimeJsonValue>>): void;
};

function mountVisualModeling(options: {
  initialState?: Record<string, unknown>;
  onRead?: (body: DataReadRequest) => Response | undefined;
  confirmLeave?: () => boolean | Promise<boolean>;
} = {}) {
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
        if (member === "attributeDelete") map.delete = describeOp(DELETE_ATTRIBUTE, "Delete attribute");
        if (member === "attributePrimaryKey") map.setPrimaryKey = describeOp(SET_PRIMARY_KEY, "Set primary key");
        if (member === "classCreate") map.save = describeFormSave(`${OBJECT_TYPE}.save`, "classCreate", true);
        if (member === "relationCreate") map.save = describeFormSave(`${RELATIONSHIP}.save`, "relationCreate", true);
        if (member === "classForm") map.save = describeFormSave(`${OBJECT_TYPE}.save`, "classForm", false);
        if (member === "relationForm") map.save = describeFormSave(`${RELATIONSHIP}.save`, "relationForm", false);
        if (member === "attributeForm") {
          map.save = describeFormSave(`${ATTRIBUTE}.save`, "attributeForm", !body.inputs.target);
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
        return Response.json({
          status: "ready",
          value: cls === "Order" ? sampleAttributes : [],
        });
      }
      if (member === "classForm") {
        return Response.json({ status: "ready", value: simpleForm(OBJECT_TYPE, { showName: "订单" }) });
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
      if (member === "attributeForm") {
        return Response.json({ status: "ready", value: simpleForm(ATTRIBUTE, { name: "id" }) });
      }
      return Response.json({ status: "empty" });
    }
    const deleteIntentId = "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d07";
    const deletePreparation = {
      intentId: deleteIntentId,
      operationId: "classDelete.delete",
      label: "Delete object type",
      confirmation: { kind: "none" },
    };
    if (path === "/api/panel-operations/intents") {
      return Response.json(deletePreparation);
    }
    if (path === `/api/panel-operation-intents/${deleteIntentId}`) {
      return Response.json(deletePreparation);
    }
    if (path === `/api/panel-operations/intents/${deleteIntentId}/dispatch`) {
      return Response.json({
        kind: "dispatched",
        intentId: deleteIntentId,
        outcome: {
          kind: "success",
          data: {},
          affected: {
            objects: [{ objectType: OBJECT_TYPE, primaryKey: "Order" }],
            objectTypes: [OBJECT_TYPE],
          },
        },
      });
    }
    return nothingAt(request);
  }, router);

  return {
    router,
    sent,
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
    expect(source.manifest.members.nodeHeader.component).toBe("ObjectHeader");
    expect(source.manifest.members.edgeHeader.component).toBe("ObjectHeader");
    expect(source.manifest.members.attributes.component).toBe("ObjectList");
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
    expect(html).not.toContain(":inputs=");
    expect(html).not.toContain("update:listed");
    expect(module).not.toContain("onAttributesListed");
    expect("toggleable" in source.manifest.members.attributes.config).toBe(false);
  });

  it("renders ObjectHeader and attribute cards with all metadata fields and keeps selection on repeated card click", async () => {
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
        expect(element.querySelector(".vm-side")?.textContent).toContain("Order");
        const attrsText = element.querySelector(".vm-attributes")?.textContent ?? "";
        expect(attrsText).toContain("订单编号");
        expect(attrsText).toContain("销售订单唯一标识");
        expect(attrsText).toContain("金额");
        expect(attrsText).toContain("STRING");
        expect(attrsText).toContain("DOUBLE");
        expect(attrsText).toContain("Disabled");
        expect(attrsText).toContain("Enabled");
        expect(element.querySelector(".vm-section-head")?.textContent).toMatch(/2/);
      }, { timeout: 5000 });
      // Deep-linked attribute stayed selected instead of being wiped on initial mount.
      expect(element.querySelector("[data-member='attributeDelete']")).not.toBeNull();

      // Clicking the already-selected attribute card again keeps it selected (no toggle back to new-attribute mode).
      const cards = element.querySelectorAll<HTMLElement>(".vm-attributes .sdk-object-list-card");
      expect(cards).toHaveLength(2);
      cards[0]!.click();
      await vi.waitFor(() => {
        expect(element.querySelector("[data-member='attributeDelete']")).not.toBeNull();
      });

      // Clicking "Browse data" navigates to /browser/data/Order.
      const browseBtn = Array.from(element.querySelectorAll<HTMLButtonElement>(".vm-side-actions button"))
        .find((btn) => btn.textContent?.includes("浏览数据") || btn.textContent?.includes("Browse data"));
      expect(browseBtn).toBeDefined();
      browseBtn!.click();
      await vi.waitFor(() => {
        expect(harness.router.currentRoute.value.path).toBe("/browser/data/Order");
      });
    } finally {
      app.unmount();
    }
  });

  it("renders ObjectHeader for a deep-linked relationship edge", async () => {
    const harness = mountVisualModeling({
      initialState: { selectedEdge: relationRef("placedBy") },
    });
    const { app, element } = await harness.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelector(".vm-side")?.textContent).toContain("下单客户");
        expect(element.querySelector(".vm-side")?.textContent).toContain("订单 → 客户");
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
      initialState: { selectedNode: objectRef("Order") },
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
        expect(element.querySelector("[data-member='classForm']")).not.toBeNull();
      });

      failing = true;
      const refreshBtn = element.querySelector<HTMLButtonElement>(".sdk-page-header button");
      expect(refreshBtn).not.toBeNull();
      refreshBtn!.click();
      await vi.waitFor(() => {
        expect(element.querySelector("[data-member='nodeHeader']")?.textContent).toContain("Temporary read failure");
      });
      // Selection, side panel, and edit form remain mounted instead of being silently closed.
      expect(element.querySelector(".vm-side")).not.toBeNull();
      expect(element.querySelector("[data-member='classForm']")).not.toBeNull();
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
      expect(element.querySelector("[data-member='classForm']")).toBeNull();
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

      // Patching selectedEdge while selectedNode is active switches to the edge and clears selectedNode/selectedAttribute.
      harness.controller()!.applyState({ selectedEdge: relationRef("placedBy") });
      await vi.waitFor(() => {
        expect(element.querySelector(".vm-side")?.textContent).toContain("下单客户");
        expect(element.querySelector("[data-member='relationForm']")).not.toBeNull();
        expect(element.querySelector("[data-member='classForm']")).toBeNull();
      });

      // Patching selectedNode while selectedEdge is active switches back to the node and clears selectedEdge.
      harness.controller()!.applyState({ selectedNode: objectRef("Customer") });
      await vi.waitFor(() => {
        expect(element.querySelector(".vm-side")?.textContent).toContain("客户");
        expect(element.querySelector("[data-member='classForm']")).not.toBeNull();
        expect(element.querySelector("[data-member='relationForm']")).toBeNull();
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
