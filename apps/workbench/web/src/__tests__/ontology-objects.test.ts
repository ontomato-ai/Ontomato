import { afterEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
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
  OBJECT_TYPE,
  RELATIONSHIP,
  SET_PRIMARY_KEY,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/ontology-objects/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/ontology-objects/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/ontology-objects/panel.mjs?raw";
import {
  humanIntents,
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

const appId = "ontology";
const use = panelUse(
  "ontology-objects",
  "ontology-objects",
  "builtin-product-ontology-objects",
  "/ontology/objects",
);

const actionTargetInputs: Record<string, string> = {
  [DELETE_OBJECT_TYPE]: "objectType",
  [DELETE_ATTRIBUTE]: "attribute",
  [SET_PRIMARY_KEY]: "attribute",
};

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
          target: form ? { source: "draft" } : { source: "input", input: actionTargetInputs[id] ?? "target" },
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

const objectsPanel = {
  ...panelRecord(use.panelId, "Object types", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

const sampleObjectTypes = [
  {
    primaryKey: "warehouse",
    className: OBJECT_TYPE,
    label: "Warehouse",
    fields: {
      className: "warehouse",
      showName: "Warehouse",
      classDesc: "Storage facility",
      attributeCount: "2",
      businessKeyCount: "1",
      relationshipCount: "1",
      primaryKey: "ok",
      primaryKeyName: "id",
      searchableAttributes: ["ID", "id", "Code", "code"],
    },
    tones: { primaryKey: "success" },
    outputs: {
      primaryKeyStatus: "ok",
      primaryKeyName: "id",
      attributeCount: 2,
      businessKeyCount: 1,
      relationshipCount: 1,
    },
  },
  {
    primaryKey: "item",
    className: OBJECT_TYPE,
    label: "Item",
    fields: {
      className: "item",
      showName: "Item",
      classDesc: "Inventory item",
      attributeCount: "1",
      businessKeyCount: "0",
      relationshipCount: "1",
      primaryKey: "missing",
      searchableAttributes: ["SKU", "sku"],
    },
    tones: { primaryKey: "warning" },
    outputs: {
      primaryKeyStatus: "missing",
      primaryKeyName: "",
      attributeCount: 1,
      businessKeyCount: 0,
      relationshipCount: 1,
    },
  },
];

const sampleAttributes = [
  {
    primaryKey: JSON.stringify(["warehouse", "id"]),
    className: ATTRIBUTE,
    label: "ID",
    fields: {
      className: "warehouse",
      classNameLabel: "Warehouse",
      name: "id",
      type: "varchar",
      attrDesc: "Primary identifier",
      enable: "true",
      businessKey: "false",
      primaryKey: "true",
    },
    tones: { primaryKey: "success", businessKey: "default", enable: "success" },
    outputs: { isPrimaryKey: true, className: "warehouse" },
  },
  {
    primaryKey: JSON.stringify(["warehouse", "code"]),
    className: ATTRIBUTE,
    label: "Code",
    fields: {
      className: "warehouse",
      classNameLabel: "Warehouse",
      name: "code",
      type: "varchar",
      attrDesc: "Warehouse code",
      enable: "true",
      businessKey: "true",
      primaryKey: "false",
    },
    tones: { primaryKey: "default", businessKey: "info", enable: "success" },
    outputs: { isPrimaryKey: false, className: "warehouse" },
  },
];

const sampleRelationships = [
  {
    primaryKey: "contains",
    className: RELATIONSHIP,
    label: "Contains",
    subtitle: "Warehouse → Item",
    fields: {
      fromclass: "warehouse",
      toclass: "item",
      fromclassLabel: "Warehouse",
      toclassLabel: "Item",
      desc: "Contains",
      fromField: "code",
      toField: "warehouse_code",
    },
  },
];

function emptyForm() {
  return {
    fields: [],
    values: {},
    errors: [],
    revision: 1,
    save: { method: "PUT", path: "/ontology/model", bodySchema: {} },
  };
}

function createAttributeForm(classes: Array<{ primaryKey: string; label: string }>) {
  return {
    fields: [
      {
        path: "/className",
        label: "Object type",
        control: {
          kind: "select",
          options: classes.map((item) => ({
            value: item.primaryKey,
            label: item.label,
            description: null,
            disabled: false,
            disabledReason: null,
          })),
        },
        valueSchema: {},
        required: true,
        readOnly: false,
      },
      {
        path: "/name",
        label: "Attribute name",
        control: { kind: "text" },
        valueSchema: {},
        required: true,
        readOnly: false,
      },
    ],
    values: { className: "", name: "" },
    errors: [],
    revision: 1,
    save: { method: "POST", path: "/ontology/model/attribute/create", bodySchema: {} },
  };
}

function editAttributeForm(attr: { primaryKey: string; fields: { name: string } }) {
  return {
    fields: [
      {
        path: "/name",
        label: "Attribute name",
        control: { kind: "text" },
        valueSchema: {},
        required: true,
        readOnly: false,
      },
    ],
    values: { name: attr.fields.name },
    errors: [],
    revision: 1,
    save: { method: "PUT", path: `/ontology/model/attribute/${attr.primaryKey}`, bodySchema: {} },
  };
}

type PageControllerHandle = {
  applyState(patch: Readonly<Record<string, RuntimeJsonValue>>): void;
};

type SampleObjectType = (typeof sampleObjectTypes)[number];
type SampleAttribute = (typeof sampleAttributes)[number];

function mountObjectsRoute(
  initialState: Record<string, unknown> = {},
  options: {
    objectTypes?: SampleObjectType[];
    attributes?: SampleAttribute[];
    onSaveAttribute?: (values: Record<string, unknown>) => unknown;
  } = {},
) {
  const objectTypesList = options.objectTypes ? [...options.objectTypes] : [...sampleObjectTypes];
  const attributesList = options.attributes ? [...options.attributes] : [...sampleAttributes];
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
      { path: "/ontology/relations/detail", component: { render: () => h("div", "relation-detail") } },
      { path: "/browser/data/:className", component: { render: () => h("div", "data-browser") } },
      { path: "/ontology/objects/:className/view", component: { render: () => h("div", "view-editor") } },
    ],
  });

  const intents = humanIntents((operationId, call) => {
    if (operationId === "attributeForm.save" && options.onSaveAttribute) {
      const values = ((call.input as { values?: Record<string, unknown> } | undefined)?.values) ?? {};
      return options.onSaveAttribute(values);
    }
    return { kind: "success", data: {} };
  });

  installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (path === `/api/product-panels/${objectsPanel.id}`) return panelAnswer(objectsPanel, request);
    if (path === `/api/product-panels/${objectsPanel.id}/snapshot`) {
      return panelSnapshot(objectsPanel, Object.fromEntries(projections), request);
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      const member = body.memberPath[0]?.member;
      if ("operations" in body) {
        if (member === "deleteObject") {
          return Response.json({
            status: "ready",
            value: {
              delete: {
                handlerRef: DELETE_OBJECT_TYPE,
                kind: "action",
                label: "Delete object type",
                effect: "write",
                batch: false,
                target: { source: "input", input: "objectType" },
                inputSchema: {},
                resultSchema: {},
              },
            },
          });
        }
        if (member === "setPrimaryKey") {
          return Response.json({
            status: "ready",
            value: {
              setPrimaryKey: {
                handlerRef: SET_PRIMARY_KEY,
                kind: "action",
                label: "Set as primary key",
                effect: "write",
                batch: false,
                target: { source: "input", input: "attribute" },
                inputSchema: {},
                resultSchema: {},
              },
            },
          });
        }
        if (member === "deleteAttribute") {
          return Response.json({
            status: "ready",
            value: {
              delete: {
                handlerRef: DELETE_ATTRIBUTE,
                kind: "action",
                label: "Delete attribute",
                effect: "write",
                batch: false,
                target: { source: "input", input: "attribute" },
                inputSchema: {},
                resultSchema: {},
              },
            },
          });
        }
        if (member === "attributeForm") {
          const target = body.inputs?.target
            ? { source: "input", input: "target" }
            : { source: "draft", slot: "attributeForm" };
          return Response.json({
            status: "ready",
            value: {
              save: {
                handlerRef: `${ATTRIBUTE}.save`,
                kind: "form.save",
                label: "Save",
                effect: "write",
                batch: false,
                target,
                inputSchema: {},
                resultSchema: {},
              },
            },
          });
        }
        return Response.json({ status: "ready", value: {} });
      }
      if (member === "catalog") {
        return Response.json({ status: "ready", value: objectTypesList });
      }
      if (member === "detail" || member === "summary") {
        const key = (body.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey;
        const found = objectTypesList.find((item) => item.primaryKey === key);
        return Response.json(found ? { status: "ready", value: found } : { status: "empty" });
      }
      if (member === "objectForm") {
        return Response.json({ status: "ready", value: emptyForm() });
      }
      if (member === "attributes") {
        const className = body.inputs?.className;
        const matched = attributesList.filter((item) => item.fields.className === className);
        return Response.json(matched.length ? { status: "ready", value: matched } : { status: "empty" });
      }
      if (member === "attributeDetail") {
        const key = (body.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey;
        const found = attributesList.find((item) => item.primaryKey === key);
        return Response.json(found ? { status: "ready", value: found } : { status: "empty" });
      }
      if (member === "attributeForm") {
        if (body.dataName === "createForm") {
          return Response.json({ status: "ready", value: createAttributeForm(objectTypesList) });
        }
        const key = (body.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey;
        const found = attributesList.find((item) => item.primaryKey === key);
        return Response.json({
          status: "ready",
          value: found ? editAttributeForm(found) : emptyForm(),
        });
      }
      if (member === "relations") {
        const className = body.inputs?.className;
        const matched = sampleRelationships.filter(
          (item) => item.fields.fromclass === className || item.fields.toclass === className,
        );
        return Response.json(matched.length ? { status: "ready", value: matched } : { status: "empty" });
      }
    }
    const intentResponse = intents(request);
    if (intentResponse) return intentResponse;
    return nothingAt(request);
  }, router);

  return {
    router,
    controller: () => controller,
    attributes: attributesList,
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
      await router.push(panelAddress(use.path, initialState, objectsPanel.manifest));
      return mountPlatformPage(() => h(RouterView), router);
    },
  };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
});

describe("ontology-objects cleaned builtin panel", () => {
  it("renders catalog via ObjectList and transitions to detail view with summary, primary key banner, attributes, and relations", async () => {
    const route = mountObjectsRoute();
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Warehouse");
        expect(element.textContent).toContain("Item");
        expect(element.textContent).toContain("2 items");
      });

      // Local search filters catalog ObjectList and updates filteredCount output.
      const searchInput = element.querySelector<HTMLInputElement>(".ot-search input");
      expect(searchInput).toBeTruthy();
      searchInput!.value = "Storage";
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));

      await vi.waitFor(() => {
        expect(element.textContent).toContain("1 items");
        expect(element.textContent).toContain("Warehouse");
        expect(element.textContent).not.toContain("Inventory item");
      });

      const warehouseRow = Array.from(element.querySelectorAll<HTMLTableRowElement>("tbody tr"))
        .find((row) => row.textContent?.includes("Warehouse"));
      expect(warehouseRow).toBeTruthy();
      warehouseRow!.click();

      await vi.waitFor(() => {
        expect(element.textContent).toContain("Primary key property: id");
        expect(element.textContent).toContain("Code");
        expect(element.textContent).toContain("Contains");
      });

      // Clicking "Browse data" navigates to the data browser route for the selected class.
      const browseBtn = Array.from(element.querySelectorAll<HTMLButtonElement>("button"))
        .find((btn) => btn.textContent?.includes("Browse data"));
      expect(browseBtn).toBeTruthy();
      browseBtn!.click();

      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.fullPath).toBe("/browser/data/warehouse");
      });

      // Return to the detail route and test navigating to a relationship detail entry.
      await route.router.push(panelAddress(use.path, { selected: "warehouse" }, objectsPanel.manifest));
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Contains");
      });

      const relationRow = Array.from(element.querySelectorAll<HTMLTableRowElement>("tbody tr"))
        .find((row) => row.textContent?.includes("Contains"));
      expect(relationRow).toBeTruthy();
      relationRow!.click();

      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.fullPath).toBe("/ontology/relations/detail?selected=contains");
      });
    } finally {
      app.unmount();
    }
  });

  it("shows missing primary-key warning banner and toggles setPrimaryKey based on attributeDetail isPrimaryKey output", async () => {
    // Missing primary key object type
    const missingRoute = mountObjectsRoute({ selected: "item" });
    const missingMounted = await missingRoute.open();
    try {
      await vi.waitFor(() => {
        expect(missingMounted.element.textContent).toContain("This object type does not have a primary key property yet");
      });
    } finally {
      missingMounted.app.unmount();
      leaveFrame();
      document.body.innerHTML = "";
    }

    // Non-primary-key attribute shows Set as primary key button in edit drawer
    const nonPkRoute = mountObjectsRoute({
      selected: "warehouse",
      selectedAttribute: JSON.stringify(["warehouse", "code"]),
    });
    const nonPkMounted = await nonPkRoute.open();
    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Set as primary key");
      });
    } finally {
      nonPkMounted.app.unmount();
      leaveFrame();
      document.body.innerHTML = "";
    }

    // Primary-key attribute hides Set as primary key button in edit drawer
    const pkRoute = mountObjectsRoute({
      selected: "warehouse",
      selectedAttribute: JSON.stringify(["warehouse", "id"]),
    });
    const pkMounted = await pkRoute.open();
    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Delete");
        expect(document.body.textContent).toContain("ID");
      });
      expect(document.body.textContent).not.toContain("Set as primary key");
    } finally {
      pkMounted.app.unmount();
    }
  });

  it("declares non-deepLink boolean creatingAttribute state and adequate attribute table column widths", () => {
    const rawState = source.manifest.state as Record<string, { type: unknown; deepLink?: boolean }>;
    expect(rawState.creatingAttribute).toBeDefined();
    expect(rawState.creatingAttribute.type).toEqual({ kind: "scalar", type: "boolean" });
    expect(rawState.creatingAttribute.deepLink).not.toBe(true);
    expect(objectsPanel.manifest.state.creatingAttribute?.deepLink).toBe(false);

    const attrColumns = (source.manifest.members.attributes.config as { columns: Array<{ key: string; width?: number }> }).columns;
    expect(attrColumns.find((col) => col.key === "type")?.width).toBe(96);
    expect(attrColumns.find((col) => col.key === "businessKey")?.width).toBe(112);
    expect(attrColumns.find((col) => col.key === "primaryKey")?.width).toBe(112);
  });

  it("opens create-attribute dialog directly from catalog via atomic present without writing creatingAttribute to the address", async () => {
    const orderType: SampleObjectType = {
      primaryKey: "Order",
      className: OBJECT_TYPE,
      label: "Order",
      fields: {
        className: "Order",
        showName: "Order",
        classDesc: "Customer order",
        attributeCount: "0",
        businessKeyCount: "0",
        relationshipCount: "0",
        primaryKey: "missing",
        primaryKeyName: "",
        searchableAttributes: [],
      },
      tones: { primaryKey: "warning" },
      outputs: {
        primaryKeyStatus: "missing",
        primaryKeyName: "",
        attributeCount: 0,
        businessKeyCount: 0,
        relationshipCount: 0,
      },
    };
    const route = mountObjectsRoute({}, { objectTypes: [...sampleObjectTypes, orderType] });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Order");
        expect(route.controller()).not.toBeNull();
      });

      // Simulate agent present({ selected: Order, creatingAttribute: true }) directly from catalog.
      route.controller()!.applyState({
        selected: { className: OBJECT_TYPE, primaryKey: "Order" },
        creatingAttribute: true,
      });

      await vi.waitFor(() => {
        const classField = document.querySelector<HTMLElement>('.el-dialog [data-field="/className"]');
        expect(classField).not.toBeNull();
        expect(classField!.textContent).toContain("Order");
        expect(classField!.querySelector(".el-select.is-disabled, .el-select__wrapper.is-disabled")).not.toBeNull();
      });

      expect(document.querySelector(".el-drawer .sdk-owner-form")).toBeNull();
      expect(route.router.currentRoute.value.fullPath).toContain("selected=Order");
      expect(route.router.currentRoute.value.fullPath).not.toContain("creatingAttribute");
    } finally {
      app.unmount();
    }
  });

  it("clears selectedAttribute when switching from edit drawer to creatingAttribute and opens edit drawer for newly saved attribute", async () => {
    const submittedPayloads: Array<Record<string, unknown>> = [];
    const createdKey = JSON.stringify(["warehouse", "region"]);
    const route = mountObjectsRoute(
      {
        selected: "warehouse",
        selectedAttribute: JSON.stringify(["warehouse", "code"]),
      },
      {
        onSaveAttribute(values) {
          submittedPayloads.push(values);
          route.attributes.push({
            primaryKey: createdKey,
            className: ATTRIBUTE,
            label: "Region",
            fields: {
              className: String(values.className ?? "warehouse"),
              classNameLabel: "Warehouse",
              name: String(values.name ?? "region"),
              type: "varchar",
              attrDesc: "Warehouse region",
              enable: "true",
              businessKey: "false",
              primaryKey: "false",
            },
            tones: { primaryKey: "default", businessKey: "default", enable: "success" },
            outputs: { isPrimaryKey: false, className: "warehouse" },
          });
          return {
            kind: "success",
            data: {},
            affected: {
              objects: [{ objectType: ATTRIBUTE, primaryKey: createdKey }],
              objectTypes: [ATTRIBUTE],
            },
          };
        },
      },
    );
    const { app } = await route.open();
    try {
      // Initially editing "Code" attribute in drawer.
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Set as primary key");
        expect(document.querySelector('.el-drawer [data-field="/name"]')).not.toBeNull();
        expect(route.controller()).not.toBeNull();
      });

      // Switch to creatingAttribute: true -> clears selectedAttribute and opens create dialog in create mode.
      route.controller()!.applyState({ creatingAttribute: true });

      await vi.waitFor(() => {
        const classField = document.querySelector<HTMLElement>('.el-dialog [data-field="/className"]');
        expect(classField).not.toBeNull();
        expect(classField!.textContent).toContain("Warehouse");
        expect(classField!.querySelector(".el-select.is-disabled, .el-select__wrapper.is-disabled")).not.toBeNull();
        expect(document.querySelector('.el-drawer [data-field="/name"]')).toBeNull();
      });
      expect(route.router.currentRoute.value.query.selectedAttribute).toBeUndefined();
      expect(route.router.currentRoute.value.fullPath).not.toContain("creatingAttribute");

      // Fill attribute name and save from the create dialog.
      const nameInput = document.querySelector<HTMLInputElement>('.el-dialog [data-field="/name"] input')!;
      expect(nameInput).not.toBeNull();
      nameInput.value = "region";
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      await nextTick();

      const saveBtn = Array.from(document.querySelectorAll<HTMLButtonElement>(".el-dialog .sdk-owner-form-actions button"))
        .find((btn) => btn.classList.contains("el-button--primary") || btn.textContent?.includes("Save") || btn.textContent?.includes("Create"));
      expect(saveBtn).toBeTruthy();
      saveBtn!.click();

      // After save: create dialog closes, edit drawer opens for the newly created attribute.
      await vi.waitFor(() => {
        expect(submittedPayloads).toEqual([{ className: "warehouse", name: "region" }]);
        expect(document.querySelector('.el-dialog [data-field="/className"]')).toBeNull();
        expect(document.querySelector('.el-drawer [data-field="/name"]')).not.toBeNull();
        expect(document.querySelector(".el-drawer")?.textContent).toContain("Region");
      });
      expect(route.router.currentRoute.value.query.selectedAttribute).toBe(createdKey);
      expect(route.router.currentRoute.value.fullPath).not.toContain("creatingAttribute");
    } finally {
      app.unmount();
    }
  });
});
