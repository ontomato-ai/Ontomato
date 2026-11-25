import { afterEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PageActionOutcome, PageActionRequestInput } from "@ontomato/contracts/agent-presentation";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { ATTRIBUTE, OBJECT_TYPE, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { DisplayPageController } from "../../../../../packages/agent-shell-ui/src/conversation-display";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/ontology-attributes/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/ontology-attributes/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/ontology-attributes/panel.mjs?raw";
import {
  sentPanelReadItems,
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
  "ontology-attributes",
  "ontology-attributes",
  "builtin-product-ontology-attributes",
  "/ontology/attributes",
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
    ...(component.componentId === "OperationButton" || component.componentId === "@ontomato/sdk:OperationButton"
      ? { config: [{ name: "operation", type: "string", description: "Local operation name", required: true }] }
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

const attributesPanel = {
  ...panelRecord(use.panelId, "Attributes", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface FixtureAttribute {
  primaryKey: string;
  className: string;
  classNameLabel: string;
  name: string;
  label: string;
  attrDesc?: string;
  type: string;
  primaryKeyFlag: boolean;
  businessKey: boolean;
  enable: boolean;
}

function toAttributeRecord(item: FixtureAttribute) {
  return {
    primaryKey: item.primaryKey,
    className: ATTRIBUTE,
    label: item.label,
    subtitle: item.name,
    fields: {
      className: item.className,
      classNameLabel: item.classNameLabel,
      ownerObject: {
        kind: "reference",
        className: OBJECT_TYPE,
        primaryKey: item.className,
        label: item.classNameLabel,
      },
      name: item.name,
      type: item.type,
      attrDesc: item.attrDesc ?? `${item.label} description`,
      enable: item.enable,
      businessKey: item.businessKey,
      primaryKey: item.primaryKeyFlag,
    },
    tones: {
      primaryKey: item.primaryKeyFlag ? "success" : "default",
      businessKey: item.businessKey ? "info" : "default",
      enable: item.enable ? "success" : "warning",
    },
    outputs: {
      isPrimaryKey: item.primaryKeyFlag,
      className: item.className,
    },
  };
}

const OBJECT_TYPE_OPTIONS = [
  { primaryKey: "Order", value: "Order", label: "Sales Order (Order)", description: "Customer order" },
  { primaryKey: "Customer", value: "Customer", label: "Customer" },
];

function createAttributeForm() {
  return {
    fields: [
      {
        path: "/className",
        label: "Object type",
        control: {
          kind: "select",
          options: OBJECT_TYPE_OPTIONS.map((item) => ({
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

function editAttributeForm(item: FixtureAttribute) {
  const attrDesc = item.attrDesc ?? `${item.label} description`;
  const primaryKeyReason = setPrimaryKeyUnavailableReason(item);
  const primaryKeyReadOnly = Boolean(primaryKeyReason);
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
      {
        path: "/attrDesc",
        label: "Description",
        control: { kind: "text" },
        valueSchema: {},
        required: false,
        readOnly: false,
      },
      {
        path: "/enable",
        label: "Enabled",
        control: { kind: "switch" },
        valueSchema: { type: "boolean" },
        required: false,
        readOnly: item.primaryKeyFlag,
        ...(item.primaryKeyFlag ? { help: "Primary key attributes cannot be disabled." } : {}),
      },
      {
        path: "/businessKey",
        label: "Business key",
        control: { kind: "switch" },
        valueSchema: { type: "boolean" },
        required: false,
        readOnly: false,
      },
      {
        path: "/primaryKey",
        label: "Primary key",
        control: { kind: "switch" },
        valueSchema: { type: "boolean" },
        required: false,
        readOnly: primaryKeyReadOnly,
        ...(primaryKeyReason ? { help: primaryKeyReason } : {}),
      },
    ],
    values: {
      showName: item.label,
      attrDesc,
      enable: item.enable,
      businessKey: item.businessKey,
      primaryKey: item.primaryKeyFlag,
    },
    errors: [],
    revision: 1,
    save: { method: "PUT", path: `/ontology/model/attribute/${item.primaryKey}`, bodySchema: {} },
  };
}

async function expandAttributeRow(container: HTMLElement, label: string) {
  const expandBtn = await vi.waitFor(() => {
    const row = [...container.querySelectorAll<HTMLTableRowElement>(".attrs-table-host tbody tr")]
      .find((tr) => tr.textContent?.includes(label));
    expect(row).toBeDefined();
    const btn = row!.querySelector<HTMLButtonElement>("button.sdk-object-list-expand-btn");
    expect(btn).not.toBeNull();
    return btn!;
  });
  expandBtn.click();
  await nextTick();
}

async function clickDialogButton(text: string) {
  await vi.waitFor(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>(".el-message-box")];
    const open = boxes.find((box) => box.closest<HTMLElement>(".el-overlay")?.style.display !== "none");
    expect(open).toBeDefined();
    const button = [...open!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text);
    expect(button).toBeDefined();
    button!.click();
  });
}

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;

function setPrimaryKeyUnavailableReason(attr: FixtureAttribute | undefined): string | undefined {
  if (!attr) return "This attribute is no longer available.";
  if (attr.primaryKeyFlag) return "This attribute is already a primary key.";
  if (attr.type !== "varchar" || !attr.enable) {
    return "Only enabled varchar attributes can be set as the primary key.";
  }
  return undefined;
}

function removeUnavailableReason(attr: FixtureAttribute | undefined): string | undefined {
  if (!attr) return "This attribute is no longer available.";
  if (attr.primaryKeyFlag) return "Primary key attributes cannot be deleted.";
  return undefined;
}

function mountAttributesRoute(options: {
  initialState?: Record<string, unknown>;
  attributes: FixtureAttribute[];
  onFormRead?: (key: string, defaultResponse: () => Response) => Response | Promise<Response>;
  onListRead?: (filterClass: string, defaultResponse: () => Response) => Response | Promise<Response>;
  onOperation?: (operationId: string, targetKey: string, call: PanelOperationCall) => unknown;
}) {
  let controller: DisplayPageController | null = null;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: use.path,
        component: PanelApplicationRoute,
        props: {
          applicationId: appId,
          registerPageController(next: DisplayPageController) {
            controller = next;
            return () => {
              if (controller === next) controller = null;
            };
          },
        },
      },
      { path: "/ontology/objects", component: { render: () => h("div", { class: "objects-stub" }, "Objects page") } },
    ],
  });

  const intents = humanIntents(
    (operationId, call) => {
      const targetKey = call.target?.kind === "object" ? call.target.primaryKey : "";
      if (options.onOperation) return options.onOperation(operationId, targetKey, call);
      return {
        kind: "success",
        data: {},
        affected: {
          objects: targetKey ? [{ objectType: ATTRIBUTE, primaryKey: targetKey }] : [],
          objectTypes: [ATTRIBUTE],
        },
      };
    },
    { source: "input", input: "target" },
    {
      creates: true,
      admitted: (member, inputs) => {
        if (member === "attributes") {
          return {
            delete: {
              kind: "action",
              handlerRef: "attributes.delete",
              label: "Delete attribute",
              effect: "write",
              target: { source: "row" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
            },
          };
        }
        if (member === "attributeRowForm") {
          return {
            save: {
              kind: "form.save",
              handlerRef: `${ATTRIBUTE}.save`,
              label: "Save",
              effect: "write",
              target: { source: "input", input: "target" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
            },
          };
        }
        if (member === "form") {
          return {
            save: {
              kind: "form.save",
              handlerRef: `${ATTRIBUTE}.save`,
              label: "Save",
              effect: "write",
              target: inputs.target ? { source: "input", input: "target" } : { source: "draft", slot: "form" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
            },
          };
        }
        return {};
      },
    },
  );

  const sent = installPlatform((request: Sent) => {
    const intentResponse = intents(request);
    if (intentResponse) return intentResponse;

    const { path } = request;
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (path === `/api/product-panels/${attributesPanel.id}`) return panelAnswer(attributesPanel, request);
    if (path === `/api/product-panels/${attributesPanel.id}/snapshot`) {
      return panelSnapshot(attributesPanel, Object.fromEntries(projections), request);
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as DataReadRequest;
      const member = body.memberPath[0]?.member;
      if (member === "ownerPicker" && body.dataName === "options") {
        return Response.json({ status: "ready", value: { options: OBJECT_TYPE_OPTIONS } });
      }
      if (member === "ownerPicker" && body.dataName === "selected") {
        const rawValues = Array.isArray((body.runtimeParams as { values?: unknown } | undefined)?.values)
          ? ((body.runtimeParams as { values: unknown[] }).values)
          : [];
        const resolved = rawValues.map((value) => {
          const className = String(value);
          return (
            OBJECT_TYPE_OPTIONS.find((item) => item.primaryKey === className) ?? {
              primaryKey: className,
              value: className,
              label: className,
              unavailable: { reason: "Object type is no longer available" },
            }
          );
        });
        return Response.json({ status: "ready", value: { options: resolved } });
      }
      if (member === "attributes" && body.dataName === "rows") {
        const filterClass = typeof body.inputs.className === "string" ? body.inputs.className : "";
        const makeResponse = () => {
          const matched = options.attributes.filter((item) => !filterClass || item.className === filterClass);
          const rows = matched.map(toAttributeRecord);
          const rowOperations = Object.fromEntries(
            matched.map((item) => {
              const reason = removeUnavailableReason(item);
              return [
                `${ATTRIBUTE}:${item.primaryKey}`,
                { delete: reason ? { available: false, unavailable: { reason } } : { available: true } },
              ];
            }),
          );
          return Response.json({ status: "ready", value: rows, rowOperations });
        };
        if (options.onListRead) return options.onListRead(filterClass, makeResponse);
        return makeResponse();
      }
      if (member === "attributeRowForm" && body.dataName === "form") {
        const key = (body.inputs.target as { primaryKey?: string } | undefined)?.primaryKey ?? "";
        const makeResponse = () => {
          const found = options.attributes.find((item) => item.primaryKey === key);
          return found ? Response.json({ status: "ready", value: editAttributeForm(found) }) : Response.json({ status: "empty" });
        };
        if (options.onFormRead) return options.onFormRead(key, makeResponse);
        return makeResponse();
      }
      if (member === "form" && body.dataName === "createForm") {
        return Response.json({ status: "ready", value: createAttributeForm() });
      }
      return Response.json({ status: "empty" });
    }
    return nothingAt(request);
  }, router);

  return {
    router,
    sent,
    controller: () => controller,
    async executeAction(request: PageActionRequestInput): Promise<PageActionOutcome> {
      if (!controller?.executeAction) throw new Error("Panel page controller is not registered");
      return controller.executeAction(request);
    },
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
      await router.push(panelAddress(use.path, options.initialState ?? {}, attributesPanel.manifest));
      return mountPlatformPage(() => h(RouterView), router);
    },
  };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
});

describe("ontology-attributes builtin panel", () => {
  it("contains zero PanelData, usePanelData, viewport units, or Element Plus tags/tokens and matches OA-01..OA-07 manifest contracts", () => {
    const manifestJson = JSON.stringify(source);
    expect(manifestJson).not.toContain("PanelData");
    expect(module).not.toContain("usePanelData");
    expect(module).not.toContain("PanelData");
    expect(html).not.toContain("PanelData");
    expect(html).not.toMatch(/\b\d+(?:\.\d+)?(?:vh|vw|dvh|svh|lvh)\b/);
    expect(module).not.toMatch(/\b\d+(?:\.\d+)?(?:vh|vw|dvh|svh|lvh)\b/);
    expect(html).not.toContain("<el-");
    expect(html).not.toContain("--el-");
    expect(html).not.toContain("v-loading");
    expect(module).toContain("usePanelNarrow");
    expect(html).toContain("narrow ? '94%' : '540px'");
    expect(html).not.toContain("<sdk-tooltip");
    expect(html).not.toContain("setPrimaryKeyDisabled");
    expect(module).not.toContain("setPrimaryKeyDisabled");
    expect(module).not.toContain("onSetPrimaryKeyDone");
    expect(manifestJson).not.toContain("attr.alreadyPrimaryKey");
    expect(manifestJson).not.toContain("attr.refresh");

    // OA-01/02/03/04/06/07 structural contracts: no selected/createIn state, non-URL editingAttribute,
    // no standalone detail/ownerCard/setPrimaryKey/remove members, no enable column, no fixedFields on create form.
    const rawState = source.manifest.state as Record<string, { type: unknown; deepLink?: boolean }>;
    expect(rawState.selected).toBeUndefined();
    expect(rawState.createIn).toBeUndefined();
    expect(rawState.editingAttribute).toBeDefined();
    expect(rawState.editingAttribute.type).toEqual({ kind: "object", objectType: ATTRIBUTE });
    expect(rawState.editingAttribute.deepLink).not.toBe(true);
    expect(attributesPanel.manifest.state.editingAttribute?.deepLink).toBe(false);

    const rawMembers = source.manifest.members as Record<string, unknown>;
    expect(rawMembers.detail).toBeUndefined();
    expect(rawMembers.ownerCard).toBeUndefined();
    expect(rawMembers.setPrimaryKey).toBeUndefined();
    expect(rawMembers.remove).toBeUndefined();
    expect(source.manifest.members.attributes.operations).toEqual({ delete: "attributes.delete" });
    expect((source.manifest.members.attributes.config as { columns: Array<{ key: string }>; searchFields?: string[] })).toMatchObject({
      searchFields: ["label", "name", "type", "classNameLabel"],
    });
    expect((source.manifest.members.attributes.config as { columns: Array<{ key: string }> }).columns.map((c) => c.key)).toEqual([
      "label",
      "ownerObject",
      "type",
      "businessKey",
      "primaryKey",
    ]);
    expect((source.manifest.members.form.config as { fixedFields?: unknown }).fixedFields).toBeUndefined();
    expect(source.manifest.members.attributeRowForm).toMatchObject({
      component: "ObjectForm",
      type: ATTRIBUTE,
      target: "editingAttribute",
      config: { actions: "footer" },
    });
  });

  it("lists attributes without Refresh button or Enable column, filters by object type via ReferencePicker, keeps owner freely selectable on create, and navigates via ownerObject", async () => {
    const fixture: FixtureAttribute[] = [
      { primaryKey: "Order.orderNo", className: "Order", classNameLabel: "Sales Order", name: "orderNo", label: "Order number", type: "varchar", primaryKeyFlag: true, businessKey: true, enable: true },
      { primaryKey: "Order.amount", className: "Order", classNameLabel: "Sales Order", name: "amount", label: "Amount", type: "number", primaryKeyFlag: false, businessKey: false, enable: true },
      { primaryKey: "Customer.email", className: "Customer", classNameLabel: "Customer", name: "email", label: "Email", type: "varchar", primaryKeyFlag: true, businessKey: false, enable: true },
    ];
    const route = mountAttributesRoute({ attributes: fixture });
    const { app, element } = await route.open();

    try {
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Order number");
        expect(element.textContent).toContain("Amount");
        expect(element.textContent).toContain("Email");
        expect(element.querySelector(".attrs-count")?.textContent?.trim()).toBe("3 items");
      });

      // OA-01: catalog header has no Refresh button; OA-02: no standalone Enable/Status column.
      expect(element.querySelector('button[aria-label="Refresh"]')).toBeNull();
      const headers = [...element.querySelectorAll<HTMLElement>(".attrs-table-host thead th")].map((th) => th.textContent?.trim());
      expect(headers).not.toContain("Status");
      expect(headers).not.toContain("Enabled");

      // Filter by object type via ReferencePicker options (display name + API name).
      const selectWrapper = await vi.waitFor(() => {
        const el = element.querySelector<HTMLElement>(".sdk-inline-reference-picker .el-select__wrapper");
        expect(el).not.toBeNull();
        return el!;
      });
      selectWrapper.click();
      const orderOption = await vi.waitFor(() => {
        const found = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
          .find((item) => item.textContent?.includes("Sales Order (Order)"));
        expect(found).toBeDefined();
        return found!;
      });
      orderOption.click();

      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.query.className).toBe("Order");
        expect(element.querySelector(".attrs-count")?.textContent?.trim()).toBe("2 items");
        expect(element.textContent).toContain("Order number");
        expect(element.textContent).toContain("Amount");
        expect(element.textContent).not.toContain("Email");
      });
      expect(
        sentPanelReadItems(route.sent).some(
          (req) =>
            (req.body as { memberPath?: { member: string }[]; dataName?: string })?.memberPath?.[0]?.member === "ownerPicker"
            && (req.body as { dataName?: string })?.dataName === "options",
        ),
      ).toBe(true);

      // OA-06: opening create dialog while filtered to Order leaves /className freely selectable (not locked).
      const createBtn = [...element.querySelectorAll<HTMLButtonElement>("button")]
        .find((btn) => btn.textContent?.includes("New attribute"));
      expect(createBtn).toBeDefined();
      createBtn!.click();

      await vi.waitFor(() => {
        const classField = document.querySelector<HTMLElement>('.el-dialog [data-field="/className"]');
        expect(classField).not.toBeNull();
        expect(classField!.querySelector(".el-select.is-disabled, .el-select__wrapper.is-disabled")).toBeNull();
      });

      // Close create dialog.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      const closeBtn = document.querySelector<HTMLButtonElement>(".el-dialog__headerbtn");
      closeBtn?.click();
      await vi.waitFor(() => {
        expect(document.querySelector('.el-dialog [data-field="/className"]')).toBeNull();
      });

      // Click ownerObject reference link in the list -> navigates to /ontology/objects?selected=Order.
      const refLink = await vi.waitFor(() => {
        const link = element.querySelector<HTMLButtonElement>(".attrs-table-host .sdk-object-ref-link");
        expect(link).not.toBeNull();
        return link!;
      });
      refLink.click();

      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.path).toBe("/ontology/objects");
        expect(route.router.currentRoute.value.query.selected).toBe("Order");
      });
    } finally {
      app.unmount();
    }
  });

  it("resolves a deep-linked unknown className through ownerPicker resolve read", async () => {
    const route = mountAttributesRoute({
      initialState: { className: "LegacyType" },
      attributes: [],
    });
    const { app } = await route.open();

    try {
      await vi.waitFor(() => {
        const resolveCall = sentPanelReadItems(route.sent).find(
          (req) =>
            (req.body as { memberPath?: { member: string }[]; dataName?: string })?.memberPath?.[0]?.member === "ownerPicker"
            && (req.body as { dataName?: string })?.dataName === "selected",
        );
        expect(resolveCall).toBeDefined();
        expect((resolveCall!.body as { runtimeParams?: { values?: unknown[] } }).runtimeParams).toEqual({
          values: ["LegacyType"],
        });
      });
    } finally {
      app.unmount();
    }
  });

  it("keeps owner class freely selectable for agent present({ creating: true }) whether filtered or unfiltered, without polluting the URL", async () => {
    const fixture: FixtureAttribute[] = [
      { primaryKey: "Order.orderNo", className: "Order", classNameLabel: "Sales Order", name: "orderNo", label: "Order number", type: "varchar", primaryKeyFlag: true, businessKey: true, enable: true },
      { primaryKey: "Customer.email", className: "Customer", classNameLabel: "Customer", name: "email", label: "Email", type: "varchar", primaryKeyFlag: true, businessKey: false, enable: true },
    ];
    const route = mountAttributesRoute({
      initialState: { className: "Order" },
      attributes: fixture,
    });
    const { app, element } = await route.open();

    try {
      await vi.waitFor(() => {
        expect(route.controller()).not.toBeNull();
        expect(element.textContent).toContain("Order number");
      });

      // 1. Filtered to Order: agent present({ creating: true }) opens create dialog with freely selectable /className.
      route.controller()!.applyState({ creating: true });
      await vi.waitFor(() => {
        const classField = document.querySelector<HTMLElement>('.el-dialog [data-field="/className"]');
        expect(classField).not.toBeNull();
        expect(classField!.querySelector(".el-select.is-disabled, .el-select__wrapper.is-disabled")).toBeNull();
      });
      expect(route.router.currentRoute.value.fullPath).not.toContain("creating");

      // 2. Closing create via present({ creating: false }) closes the dialog while staying in catalog.
      route.controller()!.applyState({ creating: false });
      await vi.waitFor(() => {
        expect(document.querySelector('.el-dialog [data-field="/className"]')).toBeNull();
      });

      // 3. Expanding a row edits inline inside the catalog without switching to a full-page detail view.
      await expandAttributeRow(element, "Order number");
      await vi.waitFor(() => {
        expect(element.querySelector(".attrs-row-editor")).not.toBeNull();
        expect(element.querySelector(".attrs-detail")).toBeNull();
      });
      expect(route.router.currentRoute.value.fullPath).not.toContain("editingAttribute");

      // 4. Unfiltered: present({ creating: true }) also keeps /className freely selectable.
      route.controller()!.applyState({ className: null, ownerFilter: null });
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Email");
      });

      route.controller()!.applyState({ creating: true });
      await vi.waitFor(() => {
        const classField = document.querySelector<HTMLElement>('.el-dialog [data-field="/className"]');
        expect(classField).not.toBeNull();
        expect(classField!.querySelector(".el-select.is-disabled, .el-select__wrapper.is-disabled")).toBeNull();
      });
    } finally {
      app.unmount();
    }
  });

  it("edits rows inline via ObjectList #row-detail without leaving catalog, submits primaryKey switch via attributeRowForm, relies on affected refresh, and deletes via row action", async () => {
    const fixture: FixtureAttribute[] = [
      { primaryKey: "Order.orderNo", className: "Order", classNameLabel: "Sales Order", name: "orderNo", label: "Order number", type: "varchar", primaryKeyFlag: true, businessKey: true, enable: true },
      { primaryKey: "Order.code", className: "Order", classNameLabel: "Sales Order", name: "code", label: "Order code", type: "varchar", primaryKeyFlag: false, businessKey: false, enable: true },
      { primaryKey: "Order.note", className: "Order", classNameLabel: "Sales Order", name: "note", label: "Note", type: "varchar", primaryKeyFlag: false, businessKey: false, enable: true },
    ];

    let firstFormRead = true;
    const formGate = deferred<Response>();
    const dispatched: string[] = [];
    let listReadCount = 0;

    const route = mountAttributesRoute({
      attributes: fixture,
      onListRead: (_filterClass, defaultResponse) => {
        listReadCount += 1;
        return defaultResponse();
      },
      onFormRead: (_key, defaultResponse) => {
        if (firstFormRead) {
          firstFormRead = false;
          return formGate.promise;
        }
        return defaultResponse();
      },
      onOperation: (operationId, targetKey, call) => {
        dispatched.push(`${operationId}:${targetKey}`);
        if (operationId === "attributeRowForm.save") {
          const values = ((call.input as { values?: Record<string, unknown> } | undefined)?.values ?? {});
          if (values.primaryKey === true) {
            for (const item of fixture) {
              if (item.className === "Order") item.primaryKeyFlag = item.primaryKey === targetKey;
            }
          }
          return {
            kind: "success",
            data: { primaryKey: targetKey, className: ATTRIBUTE },
            affected: {
              objects: [
                ...fixture.filter((item) => item.className === "Order").map((item) => ({ objectType: ATTRIBUTE, primaryKey: item.primaryKey })),
                { objectType: OBJECT_TYPE, primaryKey: "Order" },
              ],
              objectTypes: [ATTRIBUTE, OBJECT_TYPE],
            },
          };
        }
        if (operationId === "attributes.delete") {
          const idx = fixture.findIndex((item) => item.primaryKey === targetKey);
          if (idx >= 0) fixture.splice(idx, 1);
          return {
            kind: "success",
            data: {},
            affected: {
              objects: [],
              objectTypes: [ATTRIBUTE],
              removed: [{ objectType: ATTRIBUTE, primaryKey: targetKey }],
            },
          };
        }
        return { kind: "success", data: {} };
      },
    });

    const { app, element } = await route.open();

    try {
      // Wait for catalog list, then expand the non-primary-key varchar attribute row "Order code".
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Order code");
      });
      await expandAttributeRow(element, "Order code");

      // Inline row editor mounts inside the catalog without switching away to .attrs-detail.
      await vi.waitFor(() => {
        expect(element.querySelector(".attrs-row-editor")).not.toBeNull();
        expect(element.querySelector(".attrs-catalog")).not.toBeNull();
        expect(element.querySelector(".attrs-detail")).toBeNull();
      });

      // Resolve deferred form read -> inline editor renders fields and switches.
      formGate.resolve(Response.json({ status: "ready", value: editAttributeForm(fixture[1]!) }));

      await vi.waitFor(() => {
        const editor = element.querySelector<HTMLElement>(".attrs-row-editor");
        expect(editor).not.toBeNull();
        expect(editor!.querySelector<HTMLInputElement>('[data-field="/showName"] input')?.value).toBe("Order code");
        expect(editor!.querySelector('.attrs-switches [data-field="/enable"]')).not.toBeNull();
        expect(editor!.querySelector('.attrs-switches [data-field="/businessKey"]')).not.toBeNull();
        expect(editor!.querySelector('.attrs-switches [data-field="/primaryKey"]')).not.toBeNull();
        expect(editor!.textContent).not.toContain("Set as primary key");
        expect(editor!.querySelector(".attrs-row-delete button")?.textContent).toContain("Delete");
      });

      const listReadsBeforeSave = listReadCount;

      // Toggle /primaryKey switch and save -> owner affected refreshes list & row editor once (no manual refreshObjects).
      const pkSwitch = element.querySelector<HTMLElement>('.attrs-row-editor [data-field="/primaryKey"] .el-switch')!;
      pkSwitch.click();
      await nextTick();

      const saveBtn = await vi.waitFor(() => {
        const btn = [...element.querySelectorAll<HTMLButtonElement>(".attrs-row-editor .sdk-owner-form-actions button")]
          .find((item) => item.textContent?.trim() === "Save" && !item.disabled);
        expect(btn).toBeDefined();
        return btn!;
      });
      saveBtn.click();

      await vi.waitFor(() => {
        expect(dispatched).toContain("attributeRowForm.save:Order.code");
        const editor = element.querySelector<HTMLElement>(".attrs-row-editor");
        expect(editor?.querySelector('[data-field="/primaryKey"] .el-switch.is-disabled')).not.toBeNull();
        const deleteBtn = editor?.querySelector<HTMLButtonElement>(".attrs-row-delete button");
        expect(deleteBtn?.disabled).toBe(true);
      });
      expect(listReadCount - listReadsBeforeSave).toBe(1);

      // Expand a non-primary attribute "Note" and click Delete -> removes the row and stays in catalog.
      await expandAttributeRow(element, "Note");
      const deleteBtn = await vi.waitFor(() => {
        const editor = element.querySelector<HTMLElement>(".attrs-row-editor");
        expect(editor?.querySelector<HTMLInputElement>('[data-field="/showName"] input')?.value).toBe("Note");
        const btn = editor?.querySelector<HTMLButtonElement>(".attrs-row-delete button");
        expect(btn).not.toBeNull();
        expect(btn!.disabled).toBe(false);
        return btn!;
      });
      deleteBtn.click();

      await vi.waitFor(() => {
        expect(dispatched).toContain("attributes.delete:Order.note");
        expect(element.textContent).not.toContain("Note");
        expect(element.querySelector(".attrs-catalog")).not.toBeNull();
      });
    } finally {
      app.unmount();
    }
  });

  it("does not trigger manual refreshObjects after attributeRowForm save when owner reports empty affected", async () => {
    const fixture: FixtureAttribute[] = [
      { primaryKey: "Order.code", className: "Order", classNameLabel: "Sales Order", name: "code", label: "Order code", type: "varchar", primaryKeyFlag: false, businessKey: false, enable: true },
    ];
    let listReadCount = 0;
    const route = mountAttributesRoute({
      attributes: fixture,
      onListRead: (_filterClass, defaultResponse) => {
        listReadCount += 1;
        return defaultResponse();
      },
      onOperation: () => ({
        kind: "success",
        data: {},
        affected: { objects: [], objectTypes: [] },
      }),
    });
    const { app, element } = await route.open();

    try {
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Order code");
      });
      await expandAttributeRow(element, "Order code");

      const pkSwitch = await vi.waitFor(() => {
        const sw = element.querySelector<HTMLElement>('.attrs-row-editor [data-field="/primaryKey"] .el-switch');
        expect(sw).not.toBeNull();
        return sw!;
      });
      const readsBefore = listReadCount;
      pkSwitch.click();
      await nextTick();

      const saveBtn = await vi.waitFor(() => {
        const btn = [...element.querySelectorAll<HTMLButtonElement>(".attrs-row-editor .sdk-owner-form-actions button")]
          .find((item) => item.textContent?.trim() === "Save" && !item.disabled);
        expect(btn).toBeDefined();
        return btn!;
      });
      saveBtn.click();

      await vi.waitFor(() => {
        expect(route.sent.some((req) => req.path.includes("/dispatch"))).toBe(true);
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(listReadCount).toBe(readsBefore);
    } finally {
      app.unmount();
    }
  });

  it("shows real read failure in place inside inline row editor on first load, and keeps edit form mounted with unsaved edits on background refresh", async () => {
    // 1. First load of attributeRowForm fails with error -> shows real error text inline inside the expanded row.
    const firstFailRoute = mountAttributesRoute({
      attributes: [
        { primaryKey: "Order.amount", className: "Order", classNameLabel: "Sales Order", name: "amount", label: "Amount", type: "number", primaryKeyFlag: false, businessKey: false, enable: true },
      ],
      onFormRead: () => Response.json({ status: "error", message: "Ontology service timed out" }),
    });
    const firstFailMounted = await firstFailRoute.open();
    try {
      await expandAttributeRow(firstFailMounted.element, "Amount");
      await vi.waitFor(() => {
        const editor = firstFailMounted.element.querySelector<HTMLElement>(".attrs-row-editor");
        expect(editor).not.toBeNull();
        expect(editor!.textContent).toContain("Ontology service timed out");
      });
    } finally {
      firstFailMounted.app.unmount();
    }

    // 2. Background refresh while editing -> mounted inline form keeps unsaved edits and actions intact.
    let failNextFormRead = false;
    const fixture: FixtureAttribute[] = [
      {
        primaryKey: "Order.code",
        className: "Order",
        classNameLabel: "Sales Order",
        name: "code",
        label: "Order code",
        attrDesc: "Original description",
        type: "varchar",
        primaryKeyFlag: false,
        businessKey: false,
        enable: true,
      },
    ];
    const reloadFailRoute = mountAttributesRoute({
      attributes: fixture,
      onFormRead: (_key, defaultResponse) => {
        if (failNextFormRead) {
          return Response.json({ status: "error", message: "Temporary gateway 502" });
        }
        return defaultResponse();
      },
      onOperation: (operationId) => {
        if (operationId === "form.save") {
          fixture.push({
            primaryKey: "Order.region",
            className: "Order",
            classNameLabel: "Sales Order",
            name: "region",
            label: "Region",
            type: "varchar",
            primaryKeyFlag: false,
            businessKey: false,
            enable: true,
          });
          return {
            kind: "success",
            data: { primaryKey: "Order.region" },
            affected: {
              objects: [{ objectType: ATTRIBUTE, primaryKey: "Order.code" }],
              objectTypes: [ATTRIBUTE],
            },
          };
        }
        return { kind: "success", data: {} };
      },
    });
    const reloadMounted = await reloadFailRoute.open();
    try {
      await expandAttributeRow(reloadMounted.element, "Order code");
      const showNameInput = await vi.waitFor(() => {
        const input = reloadMounted.element.querySelector<HTMLInputElement>('.attrs-row-editor [data-field="/showName"] input');
        expect(input).not.toBeNull();
        expect(input!.value).toBe("Order code");
        return input!;
      });

      // Make an unsaved edit inside the inline row editor.
      showNameInput.value = "Unsaved draft title";
      showNameInput.dispatchEvent(new Event("input"));
      await vi.waitFor(() => {
        expect(reloadMounted.element.querySelector(".attrs-unsaved")?.textContent).toContain("Unsaved changes (1)");
      });

      // Trigger an ATTRIBUTE affected refresh via create dialog while form re-reads would fail.
      failNextFormRead = true;
      reloadFailRoute.controller()!.applyState({ creating: true });
      const createName = await vi.waitFor(() => {
        const input = document.querySelector<HTMLInputElement>('.el-dialog [data-field="/name"] input');
        expect(input).not.toBeNull();
        return input!;
      });
      const classSelect = document.querySelector<HTMLElement>('.el-dialog [data-field="/className"] .el-select__wrapper')!;
      classSelect.click();
      const orderOpt = await vi.waitFor(() => {
        const found = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
          .find((item) => item.textContent?.includes("Sales Order (Order)"));
        expect(found).toBeDefined();
        return found!;
      });
      orderOpt.click();
      createName.value = "region";
      createName.dispatchEvent(new Event("input"));
      await nextTick();

      const createSave = [...document.querySelectorAll<HTMLButtonElement>(".el-dialog .sdk-owner-form-actions button")]
        .find((btn) => btn.classList.contains("el-button--primary") || btn.textContent?.includes("Save") || btn.textContent?.includes("Create"))!;
      createSave.click();

      await vi.waitFor(() => {
        expect(document.querySelector('.el-dialog [data-field="/name"]')).toBeNull();
        expect(reloadMounted.element.textContent).toContain("Region");
      });

      // Inline form remained mounted with the user's unsaved edit intact and action bar still visible.
      const inputAfterRefresh = reloadMounted.element.querySelector<HTMLInputElement>('.attrs-row-editor [data-field="/showName"] input');
      expect(inputAfterRefresh).toBe(showNameInput);
      expect(inputAfterRefresh!.value).toBe("Unsaved draft title");
      expect(reloadMounted.element.querySelector(".attrs-row-editor .sdk-owner-form-actions")?.textContent).toContain("Delete");
    } finally {
      reloadMounted.app.unmount();
    }
  });

  it("preserves inline row-editor draft controls (disabled Save when clean, unsaved notice, Discard with confirmation, and platform:Attribute.save)", async () => {
    const fixture: FixtureAttribute[] = [
      {
        primaryKey: "Order.amount",
        className: "Order",
        classNameLabel: "Order",
        name: "amount",
        label: "Amount",
        attrDesc: "Order total amount",
        type: "number",
        primaryKeyFlag: false,
        businessKey: false,
        enable: true,
      },
    ];

    const rowFormProjection = projections.get("builtin-product-83e60864-e754-4960-aaf4-c1be3208e597");
    expect(rowFormProjection?.operations?.save?.operation).toEqual({
      kind: "PlatformOperation",
      id: `${ATTRIBUTE}.save`,
    });

    const saveCalls: Array<{ operationId: string; targetKey: string; values: Record<string, unknown> }> = [];
    const route = mountAttributesRoute({
      attributes: fixture,
      onOperation: (operationId, targetKey, call) => {
        if (operationId === "attributeRowForm.save") {
          const values = ((call.input as { values?: Record<string, unknown> } | undefined)?.values ?? {});
          saveCalls.push({ operationId, targetKey, values });
          const target = fixture.find((item) => item.primaryKey === targetKey);
          if (target) {
            if (typeof values.showName === "string") target.label = values.showName;
            if (typeof values.attrDesc === "string") target.attrDesc = values.attrDesc;
          }
          return {
            kind: "success",
            data: { primaryKey: targetKey, className: ATTRIBUTE },
            affected: {
              objects: [{ objectType: ATTRIBUTE, primaryKey: targetKey }],
              objectTypes: [ATTRIBUTE],
            },
          };
        }
        return { kind: "success", data: {} };
      },
    });

    const { app, element } = await route.open();

    try {
      await expandAttributeRow(element, "Amount");

      const actionsBar = () => element.querySelector<HTMLElement>(".attrs-row-editor .sdk-owner-form-actions");
      const saveBtn = () =>
        [...(actionsBar()?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
          .find((btn) => btn.textContent?.trim() === "Save") ?? null;
      const discardBtn = () =>
        [...(actionsBar()?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
          .find((btn) => btn.textContent?.trim() === "Discard") ?? null;
      const unsavedNotice = () =>
        element.querySelector<HTMLElement>(".attrs-row-editor .attrs-unsaved")?.textContent?.trim() ?? null;
      const showNameInput = () =>
        element.querySelector<HTMLInputElement>('.attrs-row-editor [data-field="/showName"] input');
      const attrDescInput = () =>
        element.querySelector<HTMLInputElement>('.attrs-row-editor [data-field="/attrDesc"] input');

      // 1. Once expanded row form is ready, Save is disabled in clean state with no Discard button or unsaved notice.
      await vi.waitFor(() => {
        expect(showNameInput()).not.toBeNull();
        expect(showNameInput()!.value).toBe("Amount");
        expect(saveBtn()).not.toBeNull();
        expect(saveBtn()!.disabled).toBe(true);
        expect(discardBtn()).toBeNull();
        expect(unsavedNotice()).toBeNull();
      });

      // 2. Editing an editable field makes the form dirty -> unsaved notice and Discard appear and Save becomes enabled.
      const input = showNameInput()!;
      input.value = "Total amount";
      input.dispatchEvent(new Event("input"));

      await vi.waitFor(() => {
        expect(saveBtn()!.disabled).toBe(false);
        expect(discardBtn()).not.toBeNull();
        expect(unsavedNotice()).toBe("Unsaved changes (1)");
      });

      // 3. Clicking Save dispatches attributeRowForm.save and settles back to clean state.
      saveBtn()!.click();

      await vi.waitFor(() => {
        expect(saveCalls).toHaveLength(1);
        expect(saveCalls[0]).toEqual({
          operationId: "attributeRowForm.save",
          targetKey: "Order.amount",
          values: {
            showName: "Total amount",
            attrDesc: "Order total amount",
            enable: true,
            businessKey: false,
            primaryKey: false,
          },
        });
        expect(saveBtn()!.disabled).toBe(true);
        expect(discardBtn()).toBeNull();
        expect(unsavedNotice()).toBeNull();
      });
      expect(showNameInput()!.value).toBe("Total amount");

      // 4. Editing again and clicking Discard confirms via dialog and restores the last saved values.
      const desc = attrDescInput()!;
      desc.value = "Temporary unsaved description";
      desc.dispatchEvent(new Event("input"));

      await vi.waitFor(() => {
        expect(saveBtn()!.disabled).toBe(false);
        expect(discardBtn()).not.toBeNull();
      });

      discardBtn()!.click();
      await clickDialogButton("Discard");

      await vi.waitFor(() => {
        expect(attrDescInput()!.value).toBe("Order total amount");
        expect(saveBtn()!.disabled).toBe(true);
        expect(discardBtn()).toBeNull();
        expect(unsavedNotice()).toBeNull();
      });
    } finally {
      app.unmount();
    }
  });

  it("renders read-only primaryKey switch reasons and delegates row Delete availability to owner rowOperations descriptors", async () => {
    // 1. Primary-key attribute: /primaryKey and /enable are read-only with owner reasons, and Delete is disabled with exact reason.
    const pkWriteCallback = vi.fn(() => ({ kind: "success", data: {} }));
    const pkRoute = mountAttributesRoute({
      attributes: [
        {
          primaryKey: "Order.orderNo",
          className: "Order",
          classNameLabel: "Sales Order",
          name: "orderNo",
          label: "Order number",
          type: "varchar",
          primaryKeyFlag: true,
          businessKey: true,
          enable: true,
        },
      ],
      onOperation: pkWriteCallback,
    });

    const pkMounted = await pkRoute.open();
    try {
      await expandAttributeRow(pkMounted.element, "Order number");
      await vi.waitFor(() => {
        const editor = pkMounted.element.querySelector<HTMLElement>(".attrs-row-editor");
        expect(editor).not.toBeNull();
        const pkField = editor!.querySelector<HTMLElement>('.attrs-switches [data-field="/primaryKey"]');
        expect(pkField).not.toBeNull();
        expect(pkField!.querySelector(".el-switch.is-disabled")).not.toBeNull();
        expect(pkField!.textContent).toContain("This attribute is already a primary key.");

        const enableField = editor!.querySelector<HTMLElement>('.attrs-switches [data-field="/enable"]');
        expect(enableField!.querySelector(".el-switch.is-disabled")).not.toBeNull();

        const deleteBtn = editor!.querySelector<HTMLButtonElement>(".attrs-row-delete button");
        expect(deleteBtn).not.toBeNull();
        expect(deleteBtn!.disabled).toBe(true);
        expect(deleteBtn!.title).toBe("Primary key attributes cannot be deleted.");
        expect(editor!.querySelector(".attrs-delete-reason")?.textContent).toBe("Primary key attributes cannot be deleted.");
      });
      pkMounted.element.querySelector<HTMLButtonElement>(".attrs-row-editor .attrs-row-delete button")!.click();
      expect(pkWriteCallback).toHaveBeenCalledTimes(0);
    } finally {
      pkMounted.app.unmount();
    }

    // 2. Non-varchar attribute: /primaryKey is read-only with exact owner reason while Delete remains available.
    const numberRoute = mountAttributesRoute({
      attributes: [
        {
          primaryKey: "Order.amount",
          className: "Order",
          classNameLabel: "Sales Order",
          name: "amount",
          label: "Amount",
          type: "number",
          primaryKeyFlag: false,
          businessKey: false,
          enable: true,
        },
      ],
    });
    const numberMounted = await numberRoute.open();
    try {
      await expandAttributeRow(numberMounted.element, "Amount");
      await vi.waitFor(() => {
        const editor = numberMounted.element.querySelector<HTMLElement>(".attrs-row-editor");
        expect(editor).not.toBeNull();
        const pkField = editor!.querySelector<HTMLElement>('.attrs-switches [data-field="/primaryKey"]');
        expect(pkField!.querySelector(".el-switch.is-disabled")).not.toBeNull();
        expect(pkField!.textContent).toContain("Only enabled varchar attributes can be set as the primary key.");

        const deleteBtn = editor!.querySelector<HTMLButtonElement>(".attrs-row-delete button");
        expect(deleteBtn).not.toBeNull();
        expect(deleteBtn!.disabled).toBe(false);
        expect(editor!.querySelector(".attrs-delete-reason")).toBeNull();
      });
    } finally {
      numberMounted.app.unmount();
    }

    // 3. Enabled non-primary varchar attribute: /primaryKey switch is editable, saving updates availability via affected refresh.
    const nonPkFixture: FixtureAttribute[] = [
      {
        primaryKey: "Order.orderNo",
        className: "Order",
        classNameLabel: "Sales Order",
        name: "orderNo",
        label: "Order number",
        type: "varchar",
        primaryKeyFlag: true,
        businessKey: true,
        enable: true,
      },
      {
        primaryKey: "Order.code",
        className: "Order",
        classNameLabel: "Sales Order",
        name: "code",
        label: "Order code",
        type: "varchar",
        primaryKeyFlag: false,
        businessKey: false,
        enable: true,
      },
    ];
    const nonPkWriteCallback = vi.fn((operationId: string, targetKey: string, call: PanelOperationCall) => {
      if (operationId === "attributeRowForm.save") {
        const values = ((call.input as { values?: Record<string, unknown> } | undefined)?.values ?? {});
        if (values.primaryKey === true) {
          for (const item of nonPkFixture) {
            if (item.className === "Order") item.primaryKeyFlag = item.primaryKey === targetKey;
          }
        }
      }
      return {
        kind: "success",
        data: { primaryKey: targetKey },
        affected: {
          objects: [
            ...nonPkFixture.map((item) => ({ objectType: ATTRIBUTE, primaryKey: item.primaryKey })),
            { objectType: OBJECT_TYPE, primaryKey: "Order" },
          ],
          objectTypes: [ATTRIBUTE, OBJECT_TYPE],
        },
      };
    });

    const nonPkRoute = mountAttributesRoute({
      attributes: nonPkFixture,
      onOperation: nonPkWriteCallback,
    });

    const nonPkMounted = await nonPkRoute.open();
    try {
      await expandAttributeRow(nonPkMounted.element, "Order code");
      const pkSwitch = await vi.waitFor(() => {
        const editor = nonPkMounted.element.querySelector<HTMLElement>(".attrs-row-editor");
        expect(editor).not.toBeNull();
        const sw = editor!.querySelector<HTMLElement>('.attrs-switches [data-field="/primaryKey"] .el-switch');
        expect(sw).not.toBeNull();
        expect(sw!.classList.contains("is-disabled")).toBe(false);
        expect(editor!.querySelector<HTMLButtonElement>(".attrs-row-delete button")?.disabled).toBe(false);
        return sw!;
      });

      pkSwitch.click();
      await nextTick();

      const saveBtn = await vi.waitFor(() => {
        const btn = [...nonPkMounted.element.querySelectorAll<HTMLButtonElement>(".attrs-row-editor .sdk-owner-form-actions button")]
          .find((item) => item.textContent?.trim() === "Save" && !item.disabled);
        expect(btn).toBeDefined();
        return btn!;
      });
      saveBtn.click();

      await vi.waitFor(() => {
        expect(nonPkWriteCallback).toHaveBeenCalledTimes(1);
        expect(nonPkWriteCallback).toHaveBeenCalledWith(
          "attributeRowForm.save",
          "Order.code",
          expect.objectContaining({
            input: expect.objectContaining({
              values: expect.objectContaining({ primaryKey: true }),
            }),
          }),
        );
      });

      // After affected refresh updates owner form & rowOperations, /primaryKey becomes read-only and Delete becomes disabled with exact reasons.
      await vi.waitFor(() => {
        const editor = nonPkMounted.element.querySelector<HTMLElement>(".attrs-row-editor");
        expect(editor!.querySelector('.attrs-switches [data-field="/primaryKey"] .el-switch.is-disabled')).not.toBeNull();
        expect(editor!.querySelector('.attrs-switches [data-field="/primaryKey"]')?.textContent).toContain(
          "This attribute is already a primary key.",
        );
        const deleteBtn = editor!.querySelector<HTMLButtonElement>(".attrs-row-delete button");
        expect(deleteBtn!.disabled).toBe(true);
        expect(editor!.querySelector(".attrs-delete-reason")?.textContent).toBe("Primary key attributes cannot be deleted.");
      });
    } finally {
      nonPkMounted.app.unmount();
    }
  });
});
