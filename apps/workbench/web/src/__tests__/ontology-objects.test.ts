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

interface SampleObjectType {
  primaryKey: string;
  className: string;
  label: string;
  fields: {
    className: string;
    showName: string;
    classDesc: string;
    attributeCount: string;
    businessKeyCount: string;
    primaryKeyCount: string;
    relationshipCount: string;
    primaryKey: string;
    primaryKeyName?: string;
    searchableAttributes: string[];
  };
  tones: { primaryKey: string };
  outputs: {
    className: string;
    primaryKeyStatus: string;
    primaryKeyName: string;
    primaryKeyShowName: string;
    primaryKeyCount: number;
    attributeCount: number;
    businessKeyCount: number;
    relationshipCount: number;
  };
}

interface SampleAttribute {
  primaryKey: string;
  className: string;
  label: string;
  fields: {
    className: string;
    classNameLabel: string;
    name: string;
    type: string;
    attrDesc: string;
    enable: string;
    businessKey: string;
    primaryKey: string;
  };
  tones: { primaryKey: string; businessKey: string; enable: string };
  outputs: { isPrimaryKey: boolean; className: string };
}

const sampleObjectTypes: SampleObjectType[] = [
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
      primaryKeyCount: "1",
      relationshipCount: "1",
      primaryKey: "ok",
      primaryKeyName: "id",
      searchableAttributes: ["Warehouse ID", "id", "Code", "code"],
    },
    tones: { primaryKey: "success" },
    outputs: {
      className: "warehouse",
      primaryKeyStatus: "ok",
      primaryKeyName: "id",
      primaryKeyShowName: "Warehouse ID",
      primaryKeyCount: 1,
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
      primaryKeyCount: "0",
      relationshipCount: "1",
      primaryKey: "missing",
      searchableAttributes: ["SKU", "sku"],
    },
    tones: { primaryKey: "warning" },
    outputs: {
      className: "item",
      primaryKeyStatus: "missing",
      primaryKeyName: "",
      primaryKeyShowName: "",
      primaryKeyCount: 0,
      attributeCount: 1,
      businessKeyCount: 0,
      relationshipCount: 1,
    },
  },
];

const sampleAttributes: SampleAttribute[] = [
  {
    primaryKey: JSON.stringify(["warehouse", "id"]),
    className: ATTRIBUTE,
    label: "Warehouse ID",
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
  {
    primaryKey: JSON.stringify(["item", "sku"]),
    className: ATTRIBUTE,
    label: "SKU",
    fields: {
      className: "item",
      classNameLabel: "Item",
      name: "sku",
      type: "varchar",
      attrDesc: "Item SKU",
      enable: "true",
      businessKey: "false",
      primaryKey: "false",
    },
    tones: { primaryKey: "default", businessKey: "default", enable: "success" },
    outputs: { isPrimaryKey: false, className: "item" },
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

function createObjectForm() {
  return {
    fields: [
      {
        path: "/className",
        label: "API name",
        control: { kind: "text" },
        valueSchema: {},
        required: true,
        readOnly: false,
      },
      {
        path: "/showName",
        label: "Display name",
        control: { kind: "text" },
        valueSchema: {},
        required: true,
        readOnly: false,
      },
    ],
    values: { className: "", showName: "" },
    errors: [],
    revision: 1,
    save: { method: "POST", path: "/ontology/model/object/create", bodySchema: {} },
  };
}

function editObjectForm(item: SampleObjectType) {
  return {
    fields: [
      {
        path: "/showName",
        label: "Display name",
        control: { kind: "text" },
        valueSchema: {},
        required: true,
        readOnly: false,
      },
    ],
    values: { showName: item.fields.showName },
    errors: [],
    revision: 1,
    save: { method: "PUT", path: `/ontology/model/object/${item.primaryKey}`, bodySchema: {} },
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

function mountObjectsRoute(
  initialState: Record<string, unknown> = {},
  options: {
    objectTypes?: SampleObjectType[];
    attributes?: SampleAttribute[];
    onSaveObject?: (values: Record<string, unknown>, target: unknown) => unknown;
    onSaveAttribute?: (values: Record<string, unknown>) => unknown;
    onSetPrimaryKey?: (target: unknown) => unknown;
    onDeleteAttribute?: (target: unknown) => unknown;
    onRead?: (body: ProductPanelReadRequest) => Response | undefined;
    attributeUnavailable?: (
      member: "setPrimaryKey" | "deleteAttribute",
      attribute: SampleAttribute | undefined,
    ) => { reason: string } | undefined;
  } = {},
) {
  const objectTypesList = options.objectTypes ? [...options.objectTypes] : [...sampleObjectTypes];
  const attributesList = options.attributes ? [...options.attributes] : [...sampleAttributes];
  const reads: ProductPanelReadRequest[] = [];
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
    if (operationId === "objectForm.save" && options.onSaveObject) {
      const values = ((call.input as { values?: Record<string, unknown> } | undefined)?.values) ?? {};
      return options.onSaveObject(values, call.target);
    }
    if (operationId === "attributeForm.save" && options.onSaveAttribute) {
      const values = ((call.input as { values?: Record<string, unknown> } | undefined)?.values) ?? {};
      return options.onSaveAttribute(values);
    }
    if (operationId === "setPrimaryKey.setPrimaryKey" && options.onSetPrimaryKey) {
      return options.onSetPrimaryKey(call.target);
    }
    if (operationId === "deleteAttribute.delete" && options.onDeleteAttribute) {
      return options.onDeleteAttribute(call.target);
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
      reads.push(body);
      const custom = options.onRead?.(body);
      if (custom) return custom;
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
          const key = (body.inputs?.attribute as { primaryKey?: string } | undefined)?.primaryKey;
          const attr = attributesList.find((item) => item.primaryKey === key);
          const unavailable = options.attributeUnavailable
            ? options.attributeUnavailable("setPrimaryKey", attr)
            : attr?.outputs.isPrimaryKey
              ? { reason: "This attribute is already the primary key" }
              : undefined;
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
                ...(unavailable && { unavailable }),
              },
            },
          });
        }
        if (member === "deleteAttribute") {
          const key = (body.inputs?.attribute as { primaryKey?: string } | undefined)?.primaryKey;
          const attr = attributesList.find((item) => item.primaryKey === key);
          const unavailable = options.attributeUnavailable
            ? options.attributeUnavailable("deleteAttribute", attr)
            : attr?.outputs.isPrimaryKey
              ? { reason: "Cannot delete the current primary key attribute" }
              : undefined;
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
                ...(unavailable && { unavailable }),
              },
            },
          });
        }
        if (member === "objectForm") {
          const target = body.inputs?.target
            ? { source: "input", input: "target" }
            : { source: "draft", slot: "objectForm" };
          return Response.json({
            status: "ready",
            value: {
              save: {
                handlerRef: `${OBJECT_TYPE}.save`,
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
        if (body.dataName === "createForm") {
          return Response.json({ status: "ready", value: createObjectForm() });
        }
        const key = (body.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey;
        const found = objectTypesList.find((item) => item.primaryKey === key);
        return Response.json({
          status: "ready",
          value: found ? editObjectForm(found) : emptyForm(),
        });
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
    reads,
    controller: () => controller,
    objectTypes: objectTypesList,
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
  it("renders catalog via ObjectList and transitions to detail view with 4-item summary, primary key showName banner, attributes, and relations", async () => {
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
        // Primary key banner displays the attribute's showName instead of its raw API name.
        expect(element.textContent).toContain("Primary key property: Warehouse ID");
        expect(element.textContent).not.toContain("Primary key property: id");
        // Summary card renders all 4 metrics including primary key count.
        expect(element.textContent).toContain("Attributes");
        expect(element.textContent).toContain("Business keys");
        expect(element.textContent).toContain("Primary keys");
        expect(element.textContent).toContain("Relationships");
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

  it("declares no writable className state, binds attributes/relations to detail.className output, and never sends unfiltered list reads", async () => {
    const rawState = source.manifest.state as Record<string, { type: unknown; deepLink?: boolean }>;
    expect(rawState.className).toBeUndefined();
    expect(objectsPanel.manifest.state.className).toBeUndefined();
    expect(rawState.creatingAttribute).toBeDefined();
    expect(rawState.creatingAttribute.type).toEqual({ kind: "scalar", type: "boolean" });
    expect(rawState.creatingAttribute.deepLink).not.toBe(true);
    expect(objectsPanel.manifest.state.creatingAttribute?.deepLink).toBe(false);
    expect(rawState.selectedAttribute?.deepLink).toBe(true);

    expect(source.manifest.members.attributes.inputs).toEqual({
      className: { output: { member: "detail", name: "className" } },
    });
    expect(source.manifest.members.relations.inputs).toEqual({
      className: { output: { member: "detail", name: "className" } },
    });
    expect((source.manifest.members.summary.config as { columns: number; items: Array<{ field: string }> })).toMatchObject({
      columns: 4,
      items: [
        { field: "attributeCount" },
        { field: "businessKeyCount" },
        { field: "primaryKeyCount" },
        { field: "relationshipCount" },
      ],
    });
    expect((source.manifest.members.attributeDetail.config as { subtitleField?: string; statusField?: string })).toMatchObject({
      subtitleField: "name",
      statusField: "type",
    });

    const attrColumns = (source.manifest.members.attributes.config as { columns: Array<{ key: string; width?: number }> }).columns;
    expect(attrColumns.find((col) => col.key === "type")?.width).toBe(96);
    expect(attrColumns.find((col) => col.key === "businessKey")?.width).toBe(112);
    expect(attrColumns.find((col) => col.key === "primaryKey")?.width).toBe(112);

    // Mount detail view for warehouse, then switch to item: every attributes/relations read carries the active detail className.
    const route = mountObjectsRoute({ selected: "warehouse" });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Code");
        expect(element.textContent).toContain("Contains");
      });

      const listReads = () => route.reads.filter(
        (req) => !("operations" in req) && (req.memberPath[0]?.member === "attributes" || req.memberPath[0]?.member === "relations"),
      );
      expect(listReads().length).toBeGreaterThanOrEqual(2);
      for (const req of listReads()) {
        expect(req.inputs?.className).toBe("warehouse");
      }

      // Switch selected object type to item; attributes and relations follow detail's new className output.
      route.controller()!.applyState({
        selected: { className: OBJECT_TYPE, primaryKey: "item" },
      });

      await vi.waitFor(() => {
        expect(element.textContent).toContain("SKU");
      });

      for (const req of listReads()) {
        expect(req.inputs?.className === "warehouse" || req.inputs?.className === "item").toBe(true);
      }
      expect(listReads().some((req) => req.memberPath[0]?.member === "attributes" && req.inputs?.className === "item")).toBe(true);
    } finally {
      app.unmount();
    }
  });

  it("clears selected class when creating becomes true from detail view so objectForm opens in create mode instead of editing the old class", async () => {
    const savedCalls: Array<{ values: Record<string, unknown>; target: unknown }> = [];
    const route = mountObjectsRoute(
      {
        selected: "warehouse",
        selectedAttribute: JSON.stringify(["warehouse", "code"]),
      },
      {
        onSaveObject(values, target) {
          savedCalls.push({ values, target });
          const createdKey = String(values.className ?? "shipment");
          route.objectTypes.push({
            primaryKey: createdKey,
            className: OBJECT_TYPE,
            label: String(values.showName ?? createdKey),
            fields: {
              className: createdKey,
              showName: String(values.showName ?? createdKey),
              classDesc: "",
              attributeCount: "1",
              businessKeyCount: "0",
              primaryKeyCount: "1",
              relationshipCount: "0",
              primaryKey: "ok",
              primaryKeyName: "id",
              searchableAttributes: [],
            },
            tones: { primaryKey: "success" },
            outputs: {
              className: createdKey,
              primaryKeyStatus: "ok",
              primaryKeyName: "id",
              primaryKeyShowName: "ID",
              primaryKeyCount: 1,
              attributeCount: 1,
              businessKeyCount: 0,
              relationshipCount: 0,
            },
          });
          return {
            kind: "success",
            data: { primaryKey: createdKey },
            affected: {
              objects: [{ objectType: OBJECT_TYPE, primaryKey: createdKey }],
              objectTypes: [OBJECT_TYPE],
            },
          };
        },
      },
    );
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Primary key property: Warehouse ID");
        expect(document.querySelector('.el-drawer [data-field="/name"]')).not.toBeNull();
        expect(route.controller()).not.toBeNull();
      });

      // Agent sets creating: true directly from detail view without explicitly clearing selected.
      route.controller()!.applyState({ creating: true });

      await vi.waitFor(() => {
        expect(document.querySelector('.el-dialog [data-field="/className"]')).not.toBeNull();
        expect(document.querySelector('.el-drawer [data-field="/name"]')).toBeNull();
      });
      expect(route.router.currentRoute.value.query.selected).toBeUndefined();
      expect(route.router.currentRoute.value.query.selectedAttribute).toBeUndefined();

      // Fill create form and save: targets draft (create mode), never the old warehouse class.
      const classInput = document.querySelector<HTMLInputElement>('.el-dialog [data-field="/className"] input')!;
      const showInput = document.querySelector<HTMLInputElement>('.el-dialog [data-field="/showName"] input')!;
      classInput.value = "shipment";
      classInput.dispatchEvent(new Event("input", { bubbles: true }));
      showInput.value = "Shipment";
      showInput.dispatchEvent(new Event("input", { bubbles: true }));
      await nextTick();

      const saveBtn = Array.from(document.querySelectorAll<HTMLButtonElement>(".el-dialog .sdk-owner-form-actions button"))
        .find((btn) => btn.classList.contains("el-button--primary") || btn.textContent?.includes("Save"));
      expect(saveBtn).toBeTruthy();
      saveBtn!.click();

      await vi.waitFor(() => {
        expect(savedCalls).toHaveLength(1);
        expect(savedCalls[0]).toEqual({
          values: { className: "shipment", showName: "Shipment" },
          target: { kind: "draft" },
        });
      });

      // Reverse direction: selecting a class while creating dialog is open closes the dialog without fighting.
      route.controller()!.applyState({ creating: true });
      await vi.waitFor(() => {
        expect(document.querySelector('.el-dialog [data-field="/className"]')).not.toBeNull();
      });
      route.controller()!.applyState({ selected: { className: OBJECT_TYPE, primaryKey: "item" } });
      await vi.waitFor(() => {
        expect(document.querySelector('.el-dialog [data-field="/className"]')).toBeNull();
        expect(element.textContent).toContain("This object type does not have a primary key property yet");
      });
    } finally {
      app.unmount();
    }
  });

  it("shows missing and multiple primary-key banners with count and delegates attribute footer actions to owner unavailable descriptors", async () => {
    const multiPkType: SampleObjectType = {
      primaryKey: "invoice",
      className: OBJECT_TYPE,
      label: "Invoice",
      fields: {
        className: "invoice",
        showName: "Invoice",
        classDesc: "Billing invoice",
        attributeCount: "3",
        businessKeyCount: "1",
        primaryKeyCount: "2",
        relationshipCount: "0",
        primaryKey: "multiple",
        searchableAttributes: [],
      },
      tones: { primaryKey: "danger" },
      outputs: {
        className: "invoice",
        primaryKeyStatus: "multiple",
        primaryKeyName: "",
        primaryKeyShowName: "",
        primaryKeyCount: 2,
        attributeCount: 3,
        businessKeyCount: 1,
        relationshipCount: 0,
      },
    };

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

    // Multiple primary keys object type shows exact count
    const multiRoute = mountObjectsRoute({ selected: "invoice" }, { objectTypes: [...sampleObjectTypes, multiPkType] });
    const multiMounted = await multiRoute.open();
    try {
      await vi.waitFor(() => {
        expect(multiMounted.element.textContent).toContain("This object type has 2 primary key properties");
      });
    } finally {
      multiMounted.app.unmount();
      leaveFrame();
      document.body.innerHTML = "";
    }

    // Non-primary-key attribute renders enabled Set as primary key and Delete buttons plus type status in drawer header
    const nonPkRoute = mountObjectsRoute({
      selected: "warehouse",
      selectedAttribute: JSON.stringify(["warehouse", "code"]),
    });
    const nonPkMounted = await nonPkRoute.open();
    try {
      await vi.waitFor(() => {
        const drawer = document.querySelector(".el-drawer");
        expect(drawer?.textContent).toContain("Code");
        expect(drawer?.textContent).toContain("code");
        expect(drawer?.textContent).toContain("varchar");
        const setPkBtn = Array.from(document.querySelectorAll<HTMLButtonElement>(".ot-drawer-footer button"))
          .find((btn) => btn.textContent?.includes("Set as primary key"));
        expect(setPkBtn).toBeTruthy();
        expect(setPkBtn!.disabled).toBe(false);
      });
    } finally {
      nonPkMounted.app.unmount();
      leaveFrame();
      document.body.innerHTML = "";
    }

    // Primary-key attribute STILL renders Set as primary key and Delete buttons, disabled with owner unavailable reasons
    const pkRoute = mountObjectsRoute({
      selected: "warehouse",
      selectedAttribute: JSON.stringify(["warehouse", "id"]),
    });
    const pkMounted = await pkRoute.open();
    try {
      await vi.waitFor(() => {
        const footer = document.querySelector(".ot-drawer-footer")!;
        const footerBtns = Array.from(footer.querySelectorAll<HTMLButtonElement>("button"));
        const setPkBtn = footerBtns.find((btn) => btn.textContent?.includes("Set as primary key"));
        const deleteBtn = footerBtns.find((btn) => btn.textContent?.includes("Delete"));
        expect(setPkBtn).toBeTruthy();
        expect(deleteBtn).toBeTruthy();
        expect(setPkBtn!.disabled).toBe(true);
        expect(deleteBtn!.disabled).toBe(true);
        const reasons = Array.from(footer.querySelectorAll(".sdk-operation-unavailable")).map((el) => el.textContent);
        expect(reasons).toContain("This attribute is already the primary key");
        expect(reasons).toContain("Cannot delete the current primary key attribute");
      });
    } finally {
      pkMounted.app.unmount();
    }
  });

  it("shows real error message instead of missing state on initial detail/attribute read failure", async () => {
    // Initial detail read failure
    const detailErrorRoute = mountObjectsRoute(
      { selected: "warehouse" },
      {
        onRead(body) {
          if (!("operations" in body) && body.memberPath[0]?.member === "detail") {
            return Response.json({ status: "error", message: "Upstream ontology service unavailable (503)" });
          }
          return undefined;
        },
      },
    );
    const detailErrorMounted = await detailErrorRoute.open();
    try {
      await vi.waitFor(() => {
        expect(detailErrorMounted.element.textContent).toContain("Upstream ontology service unavailable (503)");
      });
      expect(detailErrorMounted.element.textContent).not.toContain("Object type does not exist or has been deleted");
      expect(detailErrorMounted.element.querySelector(".ot-detail-body")).toBeNull();
    } finally {
      detailErrorMounted.app.unmount();
      leaveFrame();
      document.body.innerHTML = "";
    }

    // Initial attributeDetail read failure inside drawer
    const attrErrorRoute = mountObjectsRoute(
      {
        selected: "warehouse",
        selectedAttribute: JSON.stringify(["warehouse", "code"]),
      },
      {
        onRead(body) {
          if (!("operations" in body) && body.memberPath[0]?.member === "attributeDetail") {
            return Response.json({ status: "error", message: "Attribute metadata endpoint timed out" });
          }
          return undefined;
        },
      },
    );
    const attrErrorMounted = await attrErrorRoute.open();
    try {
      await vi.waitFor(() => {
        const drawer = document.querySelector(".el-drawer");
        expect(drawer?.textContent).toContain("Attribute metadata endpoint timed out");
      });
      expect(document.querySelector(".el-drawer")?.textContent).not.toContain("Object type does not exist or has been deleted");
      expect(document.querySelector(".ot-drawer-footer")).toBeNull();
    } finally {
      attrErrorMounted.app.unmount();
    }
  });

  it("keeps mounted edit forms and unsaved input alive when re-reading detail or attributeDetail fails, and shows an inline error banner", async () => {
    let failDetailReread = false;
    let failAttrDetailReread = false;
    const route = mountObjectsRoute(
      {
        selected: "warehouse",
        selectedAttribute: JSON.stringify(["warehouse", "code"]),
      },
      {
        onRead(body) {
          if (!("operations" in body) && body.memberPath[0]?.member === "detail" && failDetailReread) {
            return Response.json({ status: "error", message: "Temporary class refresh failure" });
          }
          if (!("operations" in body) && body.memberPath[0]?.member === "attributeDetail" && failAttrDetailReread) {
            return Response.json({ status: "error", message: "Temporary attribute refresh failure" });
          }
          return undefined;
        },
        onSetPrimaryKey() {
          // Return affected for both OBJECT_TYPE and ATTRIBUTE so both detail and attributeDetail re-read.
          return {
            kind: "success",
            data: {},
            affected: {
              objects: [
                { objectType: OBJECT_TYPE, primaryKey: "warehouse" },
                { objectType: ATTRIBUTE, primaryKey: JSON.stringify(["warehouse", "code"]) },
              ],
              objectTypes: [OBJECT_TYPE, ATTRIBUTE],
            },
          };
        },
      },
    );
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelector<HTMLInputElement>('.ot-basic-form [data-field="/showName"] input')).not.toBeNull();
        expect(document.querySelector<HTMLInputElement>('.el-drawer [data-field="/name"] input')).not.toBeNull();
      });

      // Type unsaved edits into both objectForm and attributeForm.
      const objectInput = element.querySelector<HTMLInputElement>('.ot-basic-form [data-field="/showName"] input')!;
      objectInput.value = "Warehouse Draft Title";
      objectInput.dispatchEvent(new Event("input", { bubbles: true }));

      const attrInput = document.querySelector<HTMLInputElement>('.el-drawer [data-field="/name"] input')!;
      attrInput.value = "code_unsaved_draft";
      attrInput.dispatchEvent(new Event("input", { bubbles: true }));
      await nextTick();

      // Cause subsequent detail and attributeDetail re-reads to fail, then trigger an affected refresh via setPrimaryKey.
      failDetailReread = true;
      failAttrDetailReread = true;

      const setPkBtn = Array.from(document.querySelectorAll<HTMLButtonElement>(".ot-drawer-footer button"))
        .find((btn) => btn.textContent?.includes("Set as primary key"))!;
      expect(setPkBtn).toBeTruthy();
      setPkBtn.click();

      await vi.waitFor(() => {
        expect(element.querySelector(".ot-detail-error")?.textContent).toContain("Temporary class refresh failure");
        expect(document.querySelector(".el-drawer")?.textContent).toContain("Temporary attribute refresh failure");
      });

      // Both forms remain mounted with their unsaved values intact, and the drawer footer stays mounted.
      expect(element.querySelector<HTMLInputElement>('.ot-basic-form [data-field="/showName"] input')?.value)
        .toBe("Warehouse Draft Title");
      expect(document.querySelector<HTMLInputElement>('.el-drawer [data-field="/name"] input')?.value)
        .toBe("code_unsaved_draft");
      expect(document.querySelector(".ot-drawer-footer")).not.toBeNull();
    } finally {
      app.unmount();
    }
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
        primaryKeyCount: "0",
        relationshipCount: "0",
        primaryKey: "missing",
        primaryKeyName: "",
        searchableAttributes: [],
      },
      tones: { primaryKey: "warning" },
      outputs: {
        className: "Order",
        primaryKeyStatus: "missing",
        primaryKeyName: "",
        primaryKeyShowName: "",
        primaryKeyCount: 0,
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

  it("clears selectedAttribute when switching to creatingAttribute, opens edit drawer on save, and does not trigger manual refreshObjects after attribute writes", async () => {
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
            data: { primaryKey: createdKey },
            affected: {
              objects: [{ objectType: ATTRIBUTE, primaryKey: createdKey }],
              objectTypes: [ATTRIBUTE],
            },
          };
        },
        onSetPrimaryKey() {
          return {
            kind: "success",
            data: {},
            affected: {
              objects: [{ objectType: ATTRIBUTE, primaryKey: createdKey }],
              objectTypes: [ATTRIBUTE],
            },
          };
        },
        onDeleteAttribute() {
          const idx = route.attributes.findIndex((item) => item.primaryKey === createdKey);
          if (idx >= 0) route.attributes.splice(idx, 1);
          return {
            kind: "success",
            data: {},
            affected: {
              objects: [],
              objectTypes: [ATTRIBUTE],
              removed: [{ objectType: ATTRIBUTE, primaryKey: createdKey }],
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

      const relationsReadsBeforeWrites = route.reads.filter(
        (req) => !("operations" in req) && req.memberPath[0]?.member === "relations",
      ).length;

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

      // Trigger setPrimaryKey then deleteAttribute on the newly created attribute.
      const setPkBtn = Array.from(document.querySelectorAll<HTMLButtonElement>(".ot-drawer-footer button"))
        .find((btn) => btn.textContent?.includes("Set as primary key"))!;
      expect(setPkBtn).toBeTruthy();
      setPkBtn.click();
      await nextTick();

      const deleteBtn = Array.from(document.querySelectorAll<HTMLButtonElement>(".ot-drawer-footer button"))
        .find((btn) => btn.textContent?.includes("Delete"))!;
      expect(deleteBtn).toBeTruthy();
      deleteBtn.click();

      await vi.waitFor(() => {
        expect(document.querySelector('.el-drawer [data-field="/name"]')).toBeNull();
      });

      // None of attributeSaved / setPrimaryKey / deleteAttribute called manual refreshObjects(),
      // so unrelated `relations` member was never re-read.
      const relationsReadsAfterWrites = route.reads.filter(
        (req) => !("operations" in req) && req.memberPath[0]?.member === "relations",
      ).length;
      expect(relationsReadsAfterWrites).toBe(relationsReadsBeforeWrites);
    } finally {
      app.unmount();
    }
  });

  it("keeps manual catalog header refresh button working via instance.refreshObjects()", async () => {
    const route = mountObjectsRoute();
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Warehouse");
      });

      const catalogReadsBefore = route.reads.filter(
        (req) => !("operations" in req) && req.memberPath[0]?.member === "catalog",
      ).length;

      const refreshBtn = element.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]');
      expect(refreshBtn).toBeTruthy();
      refreshBtn!.click();

      await vi.waitFor(() => {
        const catalogReadsAfter = route.reads.filter(
          (req) => !("operations" in req) && req.memberPath[0]?.member === "catalog",
        ).length;
        expect(catalogReadsAfter).toBeGreaterThan(catalogReadsBefore);
      });
    } finally {
      app.unmount();
    }
  });
});
