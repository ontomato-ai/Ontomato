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
    save: { method: "PUT", path: `/ontology/model/attribute/${item.primaryKey}`, bodySchema: {} },
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
        const targetKey = (inputs.target as { primaryKey?: string } | undefined)?.primaryKey ?? "";
        const found = options.attributes.find((item) => item.primaryKey === targetKey);
        if (member === "setPrimaryKey" && inputs.target) {
          const reason = setPrimaryKeyUnavailableReason(found);
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
              ...(reason ? { unavailable: { reason } } : {}),
            },
          };
        }
        if (member === "remove" && inputs.target) {
          const reason = removeUnavailableReason(found);
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
              ...(reason ? { unavailable: { reason } } : {}),
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
    expect(html).not.toContain("<sdk-tooltip");
    expect(html).not.toContain("setPrimaryKeyDisabled");
    expect(module).not.toContain("setPrimaryKeyDisabled");
    expect(module).not.toContain("onSetPrimaryKeyDone");
    expect(manifestJson).not.toContain("attr.alreadyPrimaryKey");
  });

  it("lists attributes, filters by object type via ReferencePicker options/resolve, prefills createIn on new attribute, and navigates via ownerObject", async () => {
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

      // Open create dialog while filtered to Order -> /className is fixed to Order via createIn.
      const createBtn = [...element.querySelectorAll<HTMLButtonElement>("button")]
        .find((btn) => btn.textContent?.includes("New attribute"));
      expect(createBtn).toBeDefined();
      createBtn!.click();

      await vi.waitFor(() => {
        const classField = document.querySelector<HTMLElement>('.el-dialog [data-field="/className"]');
        expect(classField).not.toBeNull();
        expect(classField!.textContent).toContain("Sales Order (Order)");
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

  it("unifies createIn for agent present({ creating: true }) when filtered, respects explicit createIn, allows free selection when unfiltered, and coordinates with selected", async () => {
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

      // 1. Filtered to Order: agent present({ creating: true }) auto-fixes createIn to "Order".
      route.controller()!.applyState({ creating: true });
      await vi.waitFor(() => {
        const classField = document.querySelector<HTMLElement>('.el-dialog [data-field="/className"]');
        expect(classField).not.toBeNull();
        expect(classField!.textContent).toContain("Sales Order (Order)");
        expect(classField!.querySelector(".el-select.is-disabled, .el-select__wrapper.is-disabled")).not.toBeNull();
      });

      // 2. Switching to an existing attribute while create dialog is open clears creating and createIn.
      route.controller()!.applyState({
        selected: { className: ATTRIBUTE, primaryKey: "Order.orderNo" },
      });
      await vi.waitFor(() => {
        expect(document.querySelector('.el-dialog [data-field="/className"]')).toBeNull();
        expect(element.querySelector(".attrs-detail")).not.toBeNull();
      });

      // 3. In detail view while filtered to Order: present({ creating: true }) without clearing selected clears selected and fixes createIn.
      route.controller()!.applyState({ creating: true });
      await vi.waitFor(() => {
        expect(element.querySelector(".attrs-detail")).toBeNull();
        const classField = document.querySelector<HTMLElement>('.el-dialog [data-field="/className"]');
        expect(classField).not.toBeNull();
        expect(classField!.textContent).toContain("Sales Order (Order)");
        expect(classField!.querySelector(".el-select.is-disabled, .el-select__wrapper.is-disabled")).not.toBeNull();
      });

      // 4. Closing create via present({ creating: false }) clears createIn; explicit createIn overrides className filter.
      route.controller()!.applyState({ creating: false });
      await vi.waitFor(() => {
        expect(document.querySelector('.el-dialog [data-field="/className"]')).toBeNull();
      });

      route.controller()!.applyState({ creating: true, createIn: "Customer" });
      await vi.waitFor(() => {
        const classField = document.querySelector<HTMLElement>('.el-dialog [data-field="/className"]');
        expect(classField).not.toBeNull();
        expect(classField!.textContent).toContain("Customer");
        expect(classField!.querySelector(".el-select.is-disabled, .el-select__wrapper.is-disabled")).not.toBeNull();
      });

      // 5. Unfiltered: present({ creating: true }) keeps createIn null so /className stays freely editable.
      route.controller()!.applyState({ creating: false, className: null, ownerFilter: null });
      await vi.waitFor(() => {
        expect(document.querySelector('.el-dialog [data-field="/className"]')).toBeNull();
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

  it("shows API name and data type in detail header, relies on owner affected refresh instead of manual refreshObjects on setPrimaryKey, and returns to list after remove", async () => {
    const fixture: FixtureAttribute[] = [
      { primaryKey: "Order.orderNo", className: "Order", classNameLabel: "Sales Order", name: "orderNo", label: "Order number", type: "varchar", primaryKeyFlag: true, businessKey: true, enable: true },
      { primaryKey: "Order.code", className: "Order", classNameLabel: "Sales Order", name: "code", label: "Order code", type: "varchar", primaryKeyFlag: false, businessKey: false, enable: true },
      { primaryKey: "Order.note", className: "Order", classNameLabel: "Sales Order", name: "note", label: "Note", type: "varchar", primaryKeyFlag: false, businessKey: false, enable: true },
    ];

    let firstDetailRead = true;
    const detailGate = deferred<Response>();
    const dispatched: string[] = [];
    let detailReadCount = 0;

    const route = mountAttributesRoute({
      attributes: fixture,
      onRecordRead: (_key, defaultResponse) => {
        detailReadCount += 1;
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
          // Return owner affected objects and types (R2-1 contract); panel no longer calls refreshObjects().
          return {
            kind: "success",
            data: {},
            affected: {
              objects: [
                ...fixture.filter((item) => item.className === "Order").map((item) => ({ objectType: ATTRIBUTE, primaryKey: item.primaryKey })),
                { objectType: OBJECT_TYPE, primaryKey: "Order" },
              ],
              objectTypes: [ATTRIBUTE, OBJECT_TYPE],
            },
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
      // Wait for list, then click the non-primary-key varchar attribute row "Order code".
      const codeRow = await vi.waitFor(() => {
        const rows = [...element.querySelectorAll<HTMLElement>(".attrs-table-host tbody tr")];
        const found = rows.find((tr) => tr.textContent?.includes("Order code"));
        expect(found).toBeDefined();
        return found!;
      });
      codeRow.click();

      // Detail enters loading state while record read is pending.
      await vi.waitFor(() => {
        expect(element.querySelector(".attrs-detail")).not.toBeNull();
        expect(element.textContent).toContain("Loading attribute");
      });

      // Resolve the deferred detail record -> detailStatus transitions loading -> ready.
      detailGate.resolve(Response.json({ status: "ready", value: toAttributeRecord(fixture[1]!) }));

      // Detail header displays display name, API name (subtitleField: "name"), and data type badge (statusField: "type").
      await vi.waitFor(() => {
        const header = element.querySelector<HTMLElement>(".attrs-detail .sdk-object-header");
        expect(header).not.toBeNull();
        expect(header!.querySelector(".sdk-object-header-title")?.textContent?.trim()).toBe("Order code");
        expect(header!.querySelector(".sdk-object-header-subtitle")?.textContent?.trim()).toBe("code");
        expect(header!.querySelector(".sdk-object-header-status")?.textContent?.trim()).toBe("varchar");
      });

      // Regression guard: PageHeader #actions renders both setPrimaryKey and remove buttons immediately.
      const actionsArea = await vi.waitFor(() => {
        const actions = element.querySelector<HTMLElement>(".attrs-detail .sdk-page-header-actions");
        expect(actions).not.toBeNull();
        expect(actions!.textContent).toContain("Set as primary key");
        expect(actions!.textContent).toContain("Delete");
        return actions!;
      });

      const readsBeforeSetPk = detailReadCount;
      const setPkBtn = [...actionsArea.querySelectorAll<HTMLButtonElement>("button")]
        .find((btn) => btn.textContent?.includes("Set as primary key") && !btn.disabled);
      expect(setPkBtn).toBeDefined();

      // Click Set as primary key -> platform refreshes via affected (no duplicate manual refreshObjects).
      setPkBtn!.click();

      await vi.waitFor(() => {
        expect(dispatched).toContain("setPrimaryKey.setPrimaryKey:Order.code");
        const disabledPkBtn = [...element.querySelectorAll<HTMLButtonElement>(".attrs-detail .sdk-page-header-actions button")]
          .find((btn) => btn.textContent?.includes("Set as primary key") && btn.disabled);
        expect(disabledPkBtn).toBeDefined();
        const disabledDeleteBtn = [...element.querySelectorAll<HTMLButtonElement>(".attrs-detail .sdk-page-header-actions button")]
          .find((btn) => btn.textContent?.includes("Delete") && btn.disabled);
        expect(disabledDeleteBtn).toBeDefined();
      });
      expect(detailReadCount - readsBeforeSetPk).toBe(1);

      // Navigate to a non-primary attribute "Note" and click Delete -> returns to list.
      route.controller()!.applyState({
        selected: { className: ATTRIBUTE, primaryKey: "Order.note" },
      });
      const deleteBtn = await vi.waitFor(() => {
        const btn = [...element.querySelectorAll<HTMLButtonElement>(".attrs-detail .sdk-page-header-actions button")]
          .find((item) => item.textContent?.includes("Delete") && !item.disabled);
        expect(btn).toBeDefined();
        return btn!;
      });
      deleteBtn.click();

      await vi.waitFor(() => {
        expect(dispatched).toContain("remove.delete:Order.note");
        expect(element.querySelector(".attrs-detail")).toBeNull();
        expect(element.querySelector(".attrs-catalog")).not.toBeNull();
        expect(route.router.currentRoute.value.query.selected).toBeUndefined();
      });
    } finally {
      app.unmount();
    }
  });

  it("does not trigger manual refreshObjects after setPrimaryKey when owner reports empty affected", async () => {
    const fixture: FixtureAttribute[] = [
      { primaryKey: "Order.code", className: "Order", classNameLabel: "Sales Order", name: "code", label: "Order code", type: "varchar", primaryKeyFlag: false, businessKey: false, enable: true },
    ];
    let detailReadCount = 0;
    const route = mountAttributesRoute({
      initialState: { selected: { className: ATTRIBUTE, primaryKey: "Order.code" } },
      attributes: fixture,
      onRecordRead: (_key, defaultResponse) => {
        detailReadCount += 1;
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
      const setPkBtn = await vi.waitFor(() => {
        const btn = [...element.querySelectorAll<HTMLButtonElement>(".attrs-detail .sdk-page-header-actions button")]
          .find((item) => item.textContent?.includes("Set as primary key") && !item.disabled);
        expect(btn).toBeDefined();
        return btn!;
      });
      const readsBefore = detailReadCount;
      setPkBtn.click();

      await vi.waitFor(() => {
        expect(route.sent.some((req) => req.path.includes("/dispatch"))).toBe(true);
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(detailReadCount).toBe(readsBefore);
    } finally {
      app.unmount();
    }
  });

  it("shows real read failure in place instead of notFound on first load, and keeps edit form mounted with unsaved edits on reload failure", async () => {
    // 1. First load fails with error -> shows real error text, NOT "Attribute not found or deleted".
    const firstFailRoute = mountAttributesRoute({
      initialState: { selected: { className: ATTRIBUTE, primaryKey: "Order.amount" } },
      attributes: [],
      onRecordRead: () => Response.json({ status: "error", message: "Ontology service timed out" }),
    });
    const firstFailMounted = await firstFailRoute.open();
    try {
      await vi.waitFor(() => {
        const errorBox = firstFailMounted.element.querySelector<HTMLElement>(".attrs-detail-error");
        expect(errorBox).not.toBeNull();
        expect(errorBox!.textContent).toContain("Ontology service timed out");
      });
      expect(firstFailMounted.element.textContent).not.toContain("Attribute not found or deleted");
      expect(firstFailMounted.element.querySelector(".attrs-detail-body")).toBeNull();
    } finally {
      firstFailMounted.app.unmount();
    }

    // 2. First load returns empty -> shows notFound empty state.
    const emptyRoute = mountAttributesRoute({
      initialState: { selected: { className: ATTRIBUTE, primaryKey: "Order.gone" } },
      attributes: [],
      onRecordRead: () => Response.json({ status: "empty" }),
    });
    const emptyMounted = await emptyRoute.open();
    try {
      await vi.waitFor(() => {
        expect(emptyMounted.element.querySelector(".attrs-missing")?.textContent).toContain("Attribute not found or deleted");
      });
    } finally {
      emptyMounted.app.unmount();
    }

    // 3. Reload failure while editing -> form stays mounted with unsaved edits intact, actions stay visible, danger banner shows real error.
    let failNextDetailRead = false;
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
      initialState: { selected: { className: ATTRIBUTE, primaryKey: "Order.code" } },
      attributes: fixture,
      onRecordRead: (_key, defaultResponse) => {
        if (failNextDetailRead) {
          return Response.json({ status: "error", message: "Temporary gateway 502" });
        }
        return defaultResponse();
      },
    });
    const reloadMounted = await reloadFailRoute.open();
    try {
      const showNameInput = await vi.waitFor(() => {
        const input = reloadMounted.element.querySelector<HTMLInputElement>('.attrs-form-wrap [data-field="/showName"] input');
        expect(input).not.toBeNull();
        expect(input!.value).toBe("Order code");
        return input!;
      });

      // Make an unsaved edit.
      showNameInput.value = "Unsaved draft title";
      showNameInput.dispatchEvent(new Event("input"));
      await vi.waitFor(() => {
        expect(reloadMounted.element.querySelector(".sdk-page-header-unsaved")?.textContent).toContain("Unsaved changes");
      });

      // Trigger a detail re-read failure via affected refresh on setPrimaryKey.
      failNextDetailRead = true;
      const setPkBtn = [...reloadMounted.element.querySelectorAll<HTMLButtonElement>(".attrs-detail .sdk-page-header-actions button")]
        .find((btn) => btn.textContent?.includes("Set as primary key") && !btn.disabled);
      expect(setPkBtn).toBeDefined();
      setPkBtn!.click();

      await vi.waitFor(() => {
        const banner = reloadMounted.element.querySelector<HTMLElement>(".attrs-detail-banner");
        expect(banner).not.toBeNull();
        expect(banner!.textContent).toContain("Temporary gateway 502");
      });

      // Form remained mounted with the user's unsaved edit intact and header actions still visible.
      const inputAfterError = reloadMounted.element.querySelector<HTMLInputElement>('.attrs-form-wrap [data-field="/showName"] input');
      expect(inputAfterError).toBe(showNameInput);
      expect(inputAfterError!.value).toBe("Unsaved draft title");
      expect(reloadMounted.element.querySelector(".attrs-detail .sdk-page-header-actions")?.textContent).toContain("Delete");
    } finally {
      reloadMounted.app.unmount();
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

  it("delegates setPrimaryKey and remove availability to owner unavailable descriptors with exact reasons for UI and agent executeAction", async () => {
    const agentRun = {
      sessionId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      toolCallId: "call-set-pk-1",
    };

    // 1. Primary-key attribute: owner marks both setPrimaryKey and remove unavailable with exact reasons.
    const pkWriteCallback = vi.fn(() => ({ kind: "success", data: {} }));
    const pkRoute = mountAttributesRoute({
      initialState: { selected: { className: ATTRIBUTE, primaryKey: "Order.orderNo" } },
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
      expect(memberHost!.textContent).toContain("This attribute is already a primary key.");

      const rejectedSetPk = await pkRoute.executeAction({
        operation: "setPrimaryKey.setPrimaryKey",
        agentRun,
      });
      expect(rejectedSetPk).toMatchObject({
        ok: false,
        reason: "action_unavailable",
        message: "This attribute is already a primary key.",
      });

      const rejectedDelete = await pkRoute.executeAction({
        operation: "remove.delete",
        agentRun: { ...agentRun, toolCallId: "call-del-pk-1" },
      });
      expect(rejectedDelete).toMatchObject({
        ok: false,
        reason: "action_unavailable",
        message: "Primary key attributes cannot be deleted.",
      });
      expect(pkWriteCallback).toHaveBeenCalledTimes(0);
    } finally {
      pkMounted.app.unmount();
    }

    // 2. Non-varchar attribute: owner marks setPrimaryKey unavailable with exact reason (while Delete remains available).
    const numberRoute = mountAttributesRoute({
      initialState: { selected: { className: ATTRIBUTE, primaryKey: "Order.amount" } },
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
      await vi.waitFor(() => {
        const host = numberMounted.element.querySelector<HTMLElement>('.attrs-detail .sdk-page-header-actions [data-member="setPrimaryKey"]');
        expect(host).not.toBeNull();
        expect(host!.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
        expect(host!.textContent).toContain("Only enabled varchar attributes can be set as the primary key.");
      });
      const rejectedNumeric = await numberRoute.executeAction({
        operation: "setPrimaryKey.setPrimaryKey",
        agentRun: { ...agentRun, toolCallId: "call-set-pk-num" },
      });
      expect(rejectedNumeric).toMatchObject({
        ok: false,
        reason: "action_unavailable",
        message: "Only enabled varchar attributes can be set as the primary key.",
      });
    } finally {
      numberMounted.app.unmount();
    }

    // 3. Enabled non-primary varchar attribute: button is enabled, executeAction dispatches, and affected refresh updates availability.
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
    const nonPkWriteCallback = vi.fn((operationId: string, targetKey: string) => {
      if (operationId === "setPrimaryKey.setPrimaryKey") {
        for (const item of nonPkFixture) {
          if (item.className === "Order") item.primaryKeyFlag = item.primaryKey === targetKey;
        }
      }
      return {
        kind: "success",
        data: {},
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
      initialState: { selected: { className: ATTRIBUTE, primaryKey: "Order.code" } },
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
        "Order.code",
        expect.anything(),
      );

      // After affected refresh updates owner availability, the same single button becomes disabled with exact owner reason.
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
      expect(blockedAfter).toMatchObject({
        ok: false,
        reason: "action_unavailable",
        message: "This attribute is already a primary key.",
      });
      expect(nonPkWriteCallback).toHaveBeenCalledTimes(1);
    } finally {
      nonPkMounted.app.unmount();
    }
  });
});
