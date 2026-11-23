import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
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

const OBJECT_TYPE_ROWS = [
  { primaryKey: "Order", className: OBJECT_TYPE, label: "Order", fields: { name: "Order" } },
  { primaryKey: "Customer", className: OBJECT_TYPE, label: "Customer", fields: { name: "Customer" } },
];

function createAttributeForm() {
  return {
    fields: [
      {
        path: "/className",
        label: "Object type",
        control: {
          kind: "select",
          options: OBJECT_TYPE_ROWS.map((item) => ({
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
    save: { method: "POST", path: "/ontology/model/attribute/create", bodySchema: {}, draftOperation: `${ATTRIBUTE}.save` },
  };
}

function editAttributeForm(item: FixtureAttribute) {
  const attrDesc = item.attrDesc ?? `${item.label} description`;
  return {
    fields: [
      {
        path: "/name",
        label: "Attribute name",
        control: { kind: "text" },
        valueSchema: {},
        required: true,
        readOnly: true,
      },
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
    ],
    values: { name: item.name, showName: item.label, attrDesc },
    errors: [],
    revision: 1,
    save: { method: "PUT", path: `/ontology/model/attribute/${item.primaryKey}`, bodySchema: {}, draftOperation: `${ATTRIBUTE}.save` },
  };
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

function mountAttributesRoute(options: {
  initialState?: Record<string, unknown>;
  attributes: FixtureAttribute[];
  onRecordRead?: (key: string, defaultResponse: () => Response) => Response | Promise<Response>;
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
        if (member === "setPrimaryKey" && inputs.target) {
          return {
            setPrimaryKey: {
              kind: "action",
              handlerRef: "attributes.setPrimaryKey",
              label: "Set as primary key",
              effect: "write",
              target: { source: "input", input: "target" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
            },
          };
        }
        if (member === "remove" && inputs.target) {
          return {
            delete: {
              kind: "action",
              handlerRef: "attributes.delete",
              label: "Delete attribute",
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
      if (member === "ownerPicker" && body.dataName === "rows") {
        return Response.json({ status: "ready", value: OBJECT_TYPE_ROWS });
      }
      if (member === "attributes" && body.dataName === "rows") {
        const filterClass = typeof body.inputs.className === "string" ? body.inputs.className : "";
        const rows = options.attributes
          .filter((item) => !filterClass || item.className === filterClass)
          .map(toAttributeRecord);
        return Response.json({ status: "ready", value: rows });
      }
      if (body.dataName === "record") {
        const key = (body.inputs.target as { primaryKey?: string } | undefined)?.primaryKey ?? "";
        const makeResponse = () => {
          const found = options.attributes.find((item) => item.primaryKey === key);
          return found ? Response.json({ status: "ready", value: toAttributeRecord(found) }) : Response.json({ status: "empty" });
        };
        if (member === "detail" && options.onRecordRead) {
          return options.onRecordRead(key, makeResponse);
        }
        return makeResponse();
      }
      if (member === "form" && body.dataName === "form") {
        const key = (body.inputs.target as { primaryKey?: string } | undefined)?.primaryKey ?? "";
        const found = options.attributes.find((item) => item.primaryKey === key);
        return found ? Response.json({ status: "ready", value: editAttributeForm(found) }) : Response.json({ status: "empty" });
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
          entryAccess: ["domain-member"],
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
  it("contains zero PanelData, usePanelData, viewport units, or Element Plus tags/tokens", () => {
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
  });

  it("lists attributes, filters by object type via ReferencePicker, prefills createIn on new attribute, and navigates via ownerObject", async () => {
    const fixture: FixtureAttribute[] = [
      { primaryKey: "Order.orderNo", className: "Order", classNameLabel: "Order", name: "orderNo", label: "Order number", type: "string", primaryKeyFlag: true, businessKey: true, enable: true },
      { primaryKey: "Order.amount", className: "Order", classNameLabel: "Order", name: "amount", label: "Amount", type: "number", primaryKeyFlag: false, businessKey: false, enable: true },
      { primaryKey: "Customer.email", className: "Customer", classNameLabel: "Customer", name: "email", label: "Email", type: "string", primaryKeyFlag: true, businessKey: false, enable: true },
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

      // Filter by object type via ReferencePicker.
      const selectWrapper = await vi.waitFor(() => {
        const el = element.querySelector<HTMLElement>(".sdk-inline-reference-picker .el-select__wrapper");
        expect(el).not.toBeNull();
        return el!;
      });
      selectWrapper.click();
      const orderOption = await vi.waitFor(() => {
        const found = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
          .find((item) => item.textContent?.trim() === "Order");
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

      // Open create dialog while filtered to Order -> /className is fixed to Order via createIn.
      const createBtn = [...element.querySelectorAll<HTMLButtonElement>("button")]
        .find((btn) => btn.textContent?.includes("New attribute"));
      expect(createBtn).toBeDefined();
      createBtn!.click();

      await vi.waitFor(() => {
        const classField = document.querySelector<HTMLElement>('.el-dialog [data-field="/className"]');
        expect(classField).not.toBeNull();
        expect(classField!.textContent).toContain("Order");
        expect(classField!.querySelector(".el-select.is-disabled, .el-select__wrapper.is-disabled")).not.toBeNull();
      });

      // Close create dialog via Escape.
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

  it("renders header actions immediately after detail transitions from loading to ready, refreshes on setPrimaryKey, shows disabled hint when already primary key, and returns to list after remove", async () => {
    const fixture: FixtureAttribute[] = [
      { primaryKey: "Order.orderNo", className: "Order", classNameLabel: "Order", name: "orderNo", label: "Order number", type: "string", primaryKeyFlag: true, businessKey: true, enable: true },
      { primaryKey: "Order.amount", className: "Order", classNameLabel: "Order", name: "amount", label: "Amount", type: "number", primaryKeyFlag: false, businessKey: false, enable: true },
    ];

    let firstDetailRead = true;
    const detailGate = deferred<Response>();
    const dispatched: string[] = [];

    const route = mountAttributesRoute({
      attributes: fixture,
      onRecordRead: (_key, defaultResponse) => {
        if (firstDetailRead) {
          firstDetailRead = false;
          return detailGate.promise;
        }
        return defaultResponse();
      },
      onOperation: (operationId, targetKey) => {
        dispatched.push(`${operationId}:${targetKey}`);
        if (operationId === "setPrimaryKey.setPrimaryKey") {
          for (const item of fixture) {
            if (item.className === "Order") item.primaryKeyFlag = item.primaryKey === targetKey;
          }
          // Return empty `affected` to prove `onSetPrimaryKeyDone` triggers `instance.refreshObjects()`.
          return {
            kind: "success",
            data: {},
            affected: { objects: [], objectTypes: [] },
          };
        }
        if (operationId === "remove.delete") {
          const idx = fixture.findIndex((item) => item.primaryKey === targetKey);
          if (idx >= 0) fixture.splice(idx, 1);
          return {
            kind: "success",
            data: {},
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
      // Wait for list, then click the non-primary-key attribute row "Amount".
      const amountRow = await vi.waitFor(() => {
        const rows = [...element.querySelectorAll<HTMLElement>(".attrs-table-host tbody tr")];
        const found = rows.find((tr) => tr.textContent?.includes("Amount"));
        expect(found).toBeDefined();
        return found!;
      });
      amountRow.click();

      // Detail enters loading state while record read is pending.
      await vi.waitFor(() => {
        expect(element.querySelector(".attrs-detail")).not.toBeNull();
        expect(element.textContent).toContain("Loading attribute");
      });

      // Resolve the deferred detail record -> detailStatus transitions loading -> ready.
      detailGate.resolve(Response.json({ status: "ready", value: toAttributeRecord(fixture[1]!) }));

      // Regression guard: PageHeader #actions MUST render both setPrimaryKey and remove buttons immediately.
      const actionsArea = await vi.waitFor(() => {
        const actions = element.querySelector<HTMLElement>(".attrs-detail .sdk-page-header-actions");
        expect(actions).not.toBeNull();
        expect(actions!.textContent).toContain("Set as primary key");
        expect(actions!.textContent).toContain("Delete");
        return actions!;
      });

      const setPkBtn = [...actionsArea.querySelectorAll<HTMLButtonElement>("button")]
        .find((btn) => btn.textContent?.includes("Set as primary key") && !btn.disabled);
      expect(setPkBtn).toBeDefined();

      // Click Set as primary key -> triggers refreshObjects -> header switches to disabled primary-key button.
      setPkBtn!.click();

      await vi.waitFor(() => {
        expect(dispatched).toContain("setPrimaryKey.setPrimaryKey:Order.amount");
        const disabledPkBtn = [...element.querySelectorAll<HTMLButtonElement>(".attrs-detail .sdk-page-header-actions button")]
          .find((btn) => btn.textContent?.includes("Set as primary key") && btn.disabled);
        expect(disabledPkBtn).toBeDefined();
      });

      // Click Delete -> dispatches remove.delete -> onRemoveDone clears selection and returns to list.
      const deleteBtn = [...element.querySelectorAll<HTMLButtonElement>(".attrs-detail .sdk-page-header-actions button")]
        .find((btn) => btn.textContent?.includes("Delete"));
      expect(deleteBtn).toBeDefined();
      deleteBtn!.click();

      await vi.waitFor(() => {
        expect(dispatched).toContain("remove.delete:Order.amount");
        expect(element.querySelector(".attrs-detail")).toBeNull();
        expect(element.querySelector(".attrs-catalog")).not.toBeNull();
        expect(route.router.currentRoute.value.query.selected).toBeUndefined();
      });
    } finally {
      app.unmount();
    }
  });

  it("renders page-header Save and Discard controls while editing an existing attribute, submits platform:Attribute.save, and restores on Discard", async () => {
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

    const formProjection = projections.get("builtin-product-296cb589-24bc-4ea4-b615-6e0e6b111092");
    expect(formProjection?.operations?.save?.operation).toEqual({
      kind: "PlatformOperation",
      id: `${ATTRIBUTE}.save`,
    });

    const saveCalls: Array<{ operationId: string; targetKey: string; values: Record<string, unknown> }> = [];
    const route = mountAttributesRoute({
      initialState: { selected: { className: ATTRIBUTE, primaryKey: "Order.amount" } },
      attributes: fixture,
      onOperation: (operationId, targetKey, call) => {
        if (operationId === "form.save") {
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
      const saveBtn = () => element.querySelector<HTMLButtonElement>(".attrs-detail .sdk-page-header button.primary");
      const discardBtn = () => element.querySelector<HTMLButtonElement>(".attrs-detail .sdk-page-header button.secondary");
      const unsavedNotice = () =>
        element.querySelector<HTMLElement>(".attrs-detail .sdk-page-header .sdk-page-header-unsaved")?.textContent?.trim() ?? null;
      const showNameInput = () =>
        element.querySelector<HTMLInputElement>('.attrs-form-wrap [data-field="/showName"] input');
      const attrDescInput = () =>
        element.querySelector<HTMLInputElement>('.attrs-form-wrap [data-field="/attrDesc"] input');

      // 1. Once detail is ready, PageHeader renders Save in a disabled clean state with no Discard button.
      await vi.waitFor(() => {
        expect(showNameInput()).not.toBeNull();
        expect(showNameInput()!.value).toBe("Amount");
        expect(saveBtn()).not.toBeNull();
        expect(saveBtn()!.textContent?.trim()).toBe("Save");
        expect(saveBtn()!.disabled).toBe(true);
        expect(discardBtn()).toBeNull();
        expect(unsavedNotice()).toBeNull();
      });

      // 2. Editing an editable field makes the form dirty -> Discard appears and Save becomes enabled.
      const input = showNameInput()!;
      input.value = "Total amount";
      input.dispatchEvent(new Event("input"));

      await vi.waitFor(() => {
        expect(saveBtn()!.disabled).toBe(false);
        expect(discardBtn()).not.toBeNull();
        expect(discardBtn()!.textContent?.trim()).toBe("Discard");
        expect(unsavedNotice()).toBe("Unsaved changes");
      });

      // 3. Clicking header Save dispatches owner save and settles the form back to clean state.
      saveBtn()!.click();

      await vi.waitFor(() => {
        expect(saveCalls).toHaveLength(1);
        expect(saveCalls[0]).toEqual({
          operationId: "form.save",
          targetKey: "Order.amount",
          values: { name: "amount", showName: "Total amount", attrDesc: "Order total amount" },
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

  it("renders a single real setPrimaryKey OperationButton that blocks executeAction when already primary key and dispatches when non-primary", async () => {
    const agentRun = {
      sessionId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      toolCallId: "call-set-pk-1",
    };

    // 1. Primary-key attribute (isPrimaryKey: true): single real disabled button, no hidden duplicate, executeAction rejected.
    const pkWriteCallback = vi.fn(() => ({ kind: "success", data: {} }));
    const pkRoute = mountAttributesRoute({
      initialState: { selected: { className: ATTRIBUTE, primaryKey: "Order.orderNo" } },
      attributes: [
        {
          primaryKey: "Order.orderNo",
          className: "Order",
          classNameLabel: "Order",
          name: "orderNo",
          label: "Order number",
          type: "string",
          primaryKeyFlag: true,
          businessKey: true,
          enable: true,
        },
      ],
      onOperation: pkWriteCallback,
    });

    const pkMounted = await pkRoute.open();
    try {
      const pkButtons = await vi.waitFor(() => {
        const actions = pkMounted.element.querySelector<HTMLElement>(".attrs-detail .sdk-page-header-actions");
        expect(actions).not.toBeNull();
        const buttons = [...actions!.querySelectorAll<HTMLButtonElement>("button")]
          .filter((btn) => btn.textContent?.includes("Set as primary key"));
        expect(buttons).toHaveLength(1);
        expect(buttons[0]!.disabled).toBe(true);
        return buttons;
      });

      const memberHost = pkMounted.element.querySelector<HTMLElement>('.attrs-detail .sdk-page-header-actions [data-member="setPrimaryKey"]');
      expect(memberHost).not.toBeNull();
      expect(memberHost!.style.display).not.toBe("none");
      expect(memberHost!.contains(pkButtons[0]!)).toBe(true);

      const rejected = await pkRoute.executeAction({
        operation: "setPrimaryKey.setPrimaryKey",
        agentRun,
      });
      expect(rejected).toMatchObject({ ok: false, reason: "action_unavailable" });
      expect(pkWriteCallback).toHaveBeenCalledTimes(0);
    } finally {
      pkMounted.app.unmount();
    }

    // 2. Non-primary-key attribute (isPrimaryKey: false): same single button is enabled and executeAction dispatches write.
    const nonPkFixture: FixtureAttribute[] = [
      {
        primaryKey: "Order.orderNo",
        className: "Order",
        classNameLabel: "Order",
        name: "orderNo",
        label: "Order number",
        type: "string",
        primaryKeyFlag: true,
        businessKey: true,
        enable: true,
      },
      {
        primaryKey: "Order.amount",
        className: "Order",
        classNameLabel: "Order",
        name: "amount",
        label: "Amount",
        type: "number",
        primaryKeyFlag: false,
        businessKey: false,
        enable: true,
      },
    ];
    const nonPkWriteCallback = vi.fn((operationId: string, targetKey: string) => {
      if (operationId === "setPrimaryKey.setPrimaryKey") {
        for (const item of nonPkFixture) {
          if (item.className === "Order") item.primaryKeyFlag = item.primaryKey === targetKey;
        }
      }
      return {
        kind: "success",
        data: {},
        affected: { objects: [], objectTypes: [] },
      };
    });

    const nonPkRoute = mountAttributesRoute({
      initialState: { selected: { className: ATTRIBUTE, primaryKey: "Order.amount" } },
      attributes: nonPkFixture,
      onOperation: nonPkWriteCallback,
    });

    const nonPkMounted = await nonPkRoute.open();
    try {
      const enabledBtn = await vi.waitFor(() => {
        const actions = nonPkMounted.element.querySelector<HTMLElement>(".attrs-detail .sdk-page-header-actions");
        expect(actions).not.toBeNull();
        const buttons = [...actions!.querySelectorAll<HTMLButtonElement>("button")]
          .filter((btn) => btn.textContent?.includes("Set as primary key"));
        expect(buttons).toHaveLength(1);
        expect(buttons[0]!.disabled).toBe(false);
        return buttons[0]!;
      });

      const memberHost = nonPkMounted.element.querySelector<HTMLElement>('.attrs-detail .sdk-page-header-actions [data-member="setPrimaryKey"]');
      expect(memberHost).not.toBeNull();
      expect(memberHost!.contains(enabledBtn)).toBe(true);

      const executed = await nonPkRoute.executeAction({
        operation: "setPrimaryKey.setPrimaryKey",
        agentRun: { ...agentRun, toolCallId: "call-set-pk-2" },
      });
      expect(executed).toMatchObject({ ok: true, kind: "executed", operation: "setPrimaryKey.setPrimaryKey" });
      expect(nonPkWriteCallback).toHaveBeenCalledTimes(1);
      expect(nonPkWriteCallback).toHaveBeenCalledWith(
        "setPrimaryKey.setPrimaryKey",
        "Order.amount",
        expect.anything(),
      );

      // After refresh updates isPrimaryKey to true, the same single button becomes disabled and blocks re-execution.
      await vi.waitFor(() => {
        const buttons = [...nonPkMounted.element.querySelectorAll<HTMLButtonElement>(".attrs-detail .sdk-page-header-actions button")]
          .filter((btn) => btn.textContent?.includes("Set as primary key"));
        expect(buttons).toHaveLength(1);
        expect(buttons[0]!.disabled).toBe(true);
      });

      const blockedAfter = await nonPkRoute.executeAction({
        operation: "setPrimaryKey.setPrimaryKey",
        agentRun: { ...agentRun, toolCallId: "call-set-pk-3" },
      });
      expect(blockedAfter).toMatchObject({ ok: false, reason: "action_unavailable" });
      expect(nonPkWriteCallback).toHaveBeenCalledTimes(1);
    } finally {
      nonPkMounted.app.unmount();
    }
  });
});
