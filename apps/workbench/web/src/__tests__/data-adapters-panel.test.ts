import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { ElMessageBox } from "element-plus";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { currentPanelRecordSchema, type ProductProjection } from "@ontomato/contracts/product-panels";
import {
  CHECK_DATA_ADAPTER_SANDBOX_PERMISSION,
  DATA_ADAPTER_CONFIG,
  SAVE_DATA_ADAPTER_ROUTING,
  TEST_DATA_ADAPTER_CONNECTION,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import panelSource from "../../../../../packages/platform-admin/resources/builtin-panels/data-adapters/panel.json";
import panelHtml from "../../../../../packages/platform-admin/resources/builtin-panels/data-adapters/panel.html?raw";
import panelModule from "../../../../../packages/platform-admin/resources/builtin-panels/data-adapters/panel.mjs?raw";
import {
  confirmDiscard,
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

const appId = "settings";
const adaptersUse = {
  ...panelUse(
    "data-adapters",
    "data-adapters",
    "builtin-product-data-adapters",
    "/settings/system-config/data-adapters",
  ),
  inputs: {
    domain: { literal: { className: DATA_ADAPTER_CONFIG, primaryKey: "domain" } },
  },
};

const READ_OPS = new Set([TEST_DATA_ADAPTER_CONNECTION]);
const FORM_SAVE_OPS = new Set([`${DATA_ADAPTER_CONFIG}.save`, SAVE_DATA_ADAPTER_ROUTING]);

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => {
        const readOnly = READ_OPS.has(id);
        const form = FORM_SAVE_OPS.has(id);
        return {
          id,
          kind: form ? "form.save" : "action",
          effect: readOnly ? "read" : "write",
          batch: false,
          inputSchema: {},
          target: readOnly || form ? { source: "draft" } : { source: "input", input: "target" },
        };
      }),
    }),
  ]),
);

const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation" }] }
      : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);

function buildDataAdaptersPanel() {
  const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(panelSource.manifest);
  const projections = new Map<string, ProductProjection>();
  const members = Object.fromEntries(
    Object.entries(authoring).map(([memberName, definition]) => {
      if (!("component" in definition)) throw new Error(`Expected authored projection for ${memberName}`);
      const { projection, placement } = expandPanelAuthoringMember(memberName, definition, {
        state: manifest.state,
        typeTable: { objectTypes },
        components: catalogue,
      });
      projections.set(definition.id!, {
        ...projection,
        id: definition.id!,
        name: memberName,
        description: memberName,
        visibility: "platform",
        domainId: null,
        ownerId: null,
        editable: false,
        revision: 1,
        createdAt: "2026-11-25T00:00:00.000Z",
        updatedAt: "2026-11-25T00:00:00.000Z",
      });
      return [memberName, { ...placement, target: { projectionId: definition.id! } }];
    }),
  );
  const panel = currentPanelRecordSchema.parse({
    ...panelRecord("builtin-product-data-adapters", "Data adapters", definePanel({ ...manifest, members })),
    visibility: "platform",
    domainId: null,
    ownerId: null,
    editable: false,
    content: {
      html: panelHtml,
      module: panelModule,
      messages: panelSource.content.messages,
    },
  });
  return { panel, projections };
}

const builtPanel = buildDataAdaptersPanel();

let unmount = () => {};
afterEach(async () => {
  vi.restoreAllMocks();
  unmount();
  unmount = () => {};
  useApplicationCatalog().applications.value = [];
  await leaveFrame();
});

async function openDataAdaptersPanel(handlers: {
  read: (request: ProductPanelReadRequest) => Response;
  readOp?: (body: Record<string, unknown>) => Response;
  extra?: (sent: Sent) => Response | undefined;
}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/settings/:rest(.*)*", component: PanelApplicationRoute, props: { applicationId: appId } },
    ],
  });

  installPlatform((sent: Sent) => {
    const extra = handlers.extra?.(sent);
    if (extra) return extra;
    const path = sent.path;
    if (path === "/api/auth/me") {
      return Response.json({ username: "admin", role: "ADMIN", permissions: ["*"] });
    }
    if (path === "/api/auth/domains") {
      return Response.json({ domains: [{ id: "d1", name: "Default", current: true }] });
    }
    if (path === "/api/data-query/platform/applications") {
      return Response.json({
        data: [{
          id: appId,
          kind: "native",
          rail: "bottom",
          category: "admin",
          sort: 20,
          entry: { path: "/settings", renderer: "settings" },
          entryAccess: ["system-config"],
          scheduleAdapter: null,
          releaseId: null,
          names: { en: "System settings" },
          descriptions: {},
          icon: "settings",
          panelUses: [adaptersUse],
        }],
      });
    }
    if (path === "/api/data-query/platform/applications/resolve-entry") {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/settings", renderer: "settings" }, use: adaptersUse, menu: { singleEntry: false, groups: [], panelUses: [adaptersUse] } },
      });
    }
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/settings", renderer: "settings" }, panelUses: [adaptersUse] },
      });
    }
    if (path === `/api/product-panels/${adaptersUse.panelId}`) {
      return panelAnswer(builtPanel.panel, sent);
    }
    if (path === `/api/product-panels/${adaptersUse.panelId}/snapshot`) {
      return panelSnapshot(builtPanel.panel, Object.fromEntries(builtPanel.projections), sent);
    }
    if (path.startsWith("/api/product-projections/")) {
      const id = decodeURIComponent(path.slice("/api/product-projections/".length));
      const projection = builtPanel.projections.get(id);
      if (projection) return Response.json({ projection });
    }
    if (path === "/api/product-panels/read") {
      return handlers.read(sent.body as ProductPanelReadRequest);
    }
    if (path === "/api/panel-operations/read" && handlers.readOp) {
      return handlers.readOp(sent.body as Record<string, unknown>);
    }
    if (path === "/api/product-panels/page-skill") {
      return Response.json({ pageKey: adaptersUse.pageKey, applicationId: appId, useId: adaptersUse.id, panelId: adaptersUse.panelId, skills: [] });
    }
    return nothingAt(sent);
  }, router);

  useApplicationCatalog().applications.value = [{
    id: appId,
    kind: "native",
    rail: "bottom",
    category: "admin",
    sort: 20,
    entry: { path: "/settings", renderer: "settings" },
    entryAccess: ["system-config"],
    scheduleAdapter: null,
    releaseId: null,
    names: { en: "System settings" },
    descriptions: {},
    icon: "settings",
    panelUses: [adaptersUse],
  }];
  await router.push(adaptersUse.path);
  await router.isReady();
  const mounted = mountPlatformPage(() => h(RouterView), router);
  unmount = () => {
    mounted.app.unmount();
    mounted.element.remove();
  };
  return { router };
}

function adapterFormOperationsResponse() {
  return Response.json({
    status: "ready",
    value: {
      save: {
        kind: "form.save",
        handlerRef: `${DATA_ADAPTER_CONFIG}.save`,
        label: "Save data adapter configuration",
        effect: "write",
        target: { source: "input", input: "target" },
        inputSchema: {},
        resultSchema: {},
        batch: false,
      },
    },
  });
}

function routingFormOperationsResponse() {
  return Response.json({
    status: "ready",
    value: {
      saveRouting: {
        kind: "form.save",
        handlerRef: SAVE_DATA_ADAPTER_ROUTING,
        label: "Save ontology routing",
        effect: "write",
        target: { source: "input", input: "target" },
        inputSchema: {},
        resultSchema: {},
        batch: false,
      },
    },
  });
}

function testButtonOperationsResponse() {
  return Response.json({
    status: "ready",
    value: {
      testConnection: {
        kind: "action",
        handlerRef: TEST_DATA_ADAPTER_CONNECTION,
        label: "Test connection",
        effect: "read",
        target: { source: "draft", slot: "adapterForm" },
        inputSchema: {},
        resultSchema: {},
        batch: false,
      },
    },
  });
}

function checkSandboxOperationsResponse() {
  return Response.json({
    status: "ready",
    value: {
      checkSandboxPermission: {
        kind: "action",
        handlerRef: CHECK_DATA_ADAPTER_SANDBOX_PERMISSION,
        label: "Check permission",
        effect: "write",
        batch: false,
        target: { source: "input", input: "target" },
        inputSchema: {},
        resultSchema: {},
      },
    },
  });
}

function sandboxCapabilityRecordResponse() {
  return Response.json({
    status: "ready",
    value: {
      primaryKey: "domain",
      label: "PostgreSQL",
      fields: {
        sandboxStatus: "Not checked yet",
        sandboxDetail: "Sandbox permissions have not been checked.",
      },
      outputs: { configured: true, sandboxStatus: "unchecked", sandboxSupported: true },
    },
  });
}

function multiSourceAdapterFormResponse() {
  return Response.json({
    status: "ready",
    value: {
      sections: [
        { key: "mode", title: "Data adapter mode" },
        { key: "dataSources", title: "Data sources" },
      ],
      values: {
        adapterMode: "multi",
        dataSources: [
          {
            id: "crm",
            label: "CRM DB",
            readOnly: false,
            adapter: {
              adapterType: "postgresql",
              connection: { url: "jdbc:postgresql://crm/db", user: "crm", password: "" },
            },
          },
          {
            id: "graph",
            label: "M3 Graph",
            readOnly: true,
            adapter: {
              adapterType: "m3",
              connection: { url: "https://search:9200", user: "admin", password: "" },
            },
          },
        ],
      },
      fields: [
        {
          path: "/adapterMode",
          section: "mode",
          fullWidth: true,
          label: "Adapter mode",
          required: true,
          readOnly: false,
          refreshOnChange: true,
          valueSchema: { type: "string" },
          control: {
            kind: "select",
            presentation: "radio",
            options: [
              { value: "postgresql", label: "PostgreSQL", description: null, disabled: false, disabledReason: null },
              { value: "multi", label: "Multi-source", description: null, disabled: false, disabledReason: null },
            ],
          },
        },
        {
          path: "/dataSources",
          section: "dataSources",
          fullWidth: true,
          label: "Data sources",
          required: true,
          readOnly: false,
          valueSchema: { type: "array" },
          control: {
            kind: "object-array",
            columns: 2,
            reorderable: false,
            itemKeyPath: "/id",
            itemFields: [
              {
                path: "/id",
                label: "Source ID",
                required: true,
                readOnly: false,
                valueSchema: { type: "string" },
                control: { kind: "text", clearable: true },
              },
              {
                path: "/label",
                label: "Display name",
                required: false,
                readOnly: false,
                valueSchema: { type: "string" },
                control: { kind: "text", clearable: true },
              },
            ],
          },
        },
      ],
      errors: [],
      save: { method: "POST", path: "/api/data-query/businessConfig/useMultiDataSource", bodySchema: {} },
    },
  });
}

function multiSourceRoutingFormResponse() {
  return Response.json({
    status: "ready",
    value: {
      sections: [
        { key: "classRoutes", title: "Class routing" },
        { key: "relationshipRoutes", title: "Relationship routing" },
      ],
      values: {
        sourceCatalog: [
          { id: "crm", adapterType: "postgresql" },
          { id: "graph", adapterType: "m3" },
        ],
        classRoutes: [
          { className: "Order", sourceId: "crm" },
          { className: "Device", sourceId: "graph" },
          { className: "Rack", sourceId: "graph" },
        ],
        relationshipRoutes: [
          {
            relationship: "MOUNTED_ON",
            ends: "Device → Rack",
            source: "graph",
            fromSource: "graph",
            toSource: "graph",
            crossSource: false,
            edgeEditable: true,
            realEdge: "mounted_in_rack",
          },
          {
            relationship: "ORDER_DEVICE",
            ends: "Order → Device",
            source: "",
            fromSource: "crm",
            toSource: "graph",
            crossSource: true,
            edgeEditable: false,
            realEdge: "",
          },
          {
            relationship: "SELF_ORDER",
            ends: "Order → Order",
            source: "crm",
            fromSource: "crm",
            toSource: "crm",
            crossSource: false,
            edgeEditable: false,
            realEdge: "",
          },
        ],
      },
      fields: [
        {
          path: "/sourceCatalog",
          label: "Data sources",
          required: false,
          readOnly: false,
          refreshOnChange: true,
          valueSchema: { type: "array" },
          control: { kind: "hidden" },
        },
        {
          path: "/classRoutes",
          section: "classRoutes",
          label: "Class routing",
          required: false,
          readOnly: false,
          valueSchema: { type: "array" },
          control: {
            kind: "object-array",
            presentation: "table",
            fixedRows: true,
            reorderable: false,
            itemKeyPath: "/className",
            itemFields: [
              {
                path: "/className",
                label: "Class",
                required: false,
                readOnly: true,
                valueSchema: { type: "string" },
                control: { kind: "text" },
              },
              {
                path: "/sourceId",
                label: "Data source",
                required: false,
                readOnly: false,
                refreshOnChange: true,
                valueSchema: { type: "string" },
                control: {
                  kind: "select",
                  clearable: true,
                  options: [
                    { value: "crm", label: "crm", description: null, disabled: false, disabledReason: null },
                    { value: "graph", label: "graph", description: null, disabled: false, disabledReason: null },
                  ],
                },
              },
            ],
          },
        },
        {
          path: "/relationshipRoutes",
          section: "relationshipRoutes",
          label: "Relationship routing",
          required: false,
          readOnly: false,
          valueSchema: { type: "array" },
          control: {
            kind: "object-array",
            presentation: "table",
            fixedRows: true,
            reorderable: false,
            itemKeyPath: "/relationship",
            itemFields: [
              {
                path: "/relationship",
                label: "Relationship",
                required: false,
                readOnly: true,
                valueSchema: { type: "string" },
                control: { kind: "text" },
              },
              {
                path: "/ends",
                label: "Endpoints",
                required: false,
                readOnly: true,
                valueSchema: { type: "string" },
                control: { kind: "text" },
              },
              {
                path: "/source",
                label: "Data source",
                required: false,
                readOnly: true,
                valueSchema: { type: "string" },
                control: { kind: "text" },
              },
              {
                path: "/realEdge",
                label: "Physical edge name",
                required: false,
                readOnly: false,
                valueSchema: { type: "string" },
                control: { kind: "text", clearable: true },
              },
            ],
          },
        },
      ],
      errors: [],
      save: { method: "POST", path: "/api/data-query/businessConfig/useMultiDataSource", bodySchema: {} },
    },
  });
}

describe("builtin-product-data-adapters panel", () => {
  it("renders single-source 2-column form without TOC, displays structured test report, handles errors, and clears stale report on edit (DA-03/04/05/06)", async () => {
    const readOpCalls: Record<string, unknown>[] = [];
    let failNextTest = false;
    await openDataAdaptersPanel({
      read(request) {
        const slot = request.memberPath.at(-1)!.member;
        if ("operations" in request && request.operations) {
          if (slot === "adapterForm") return adapterFormOperationsResponse();
          if (slot === "testConnection") return testButtonOperationsResponse();
          if (slot === "checkSandboxPermission") return checkSandboxOperationsResponse();
          return Response.json({ status: "ready", value: {} });
        }
        if (slot === "sandboxCapability") return sandboxCapabilityRecordResponse();
        if (slot === "adapterForm") {
          return Response.json({
            status: "ready",
            value: {
              values: {
                adapterMode: "postgresql",
                connection: { url: "jdbc:postgresql://db:5432/app", user: "postgres", password: "" },
              },
              fields: [
                {
                  path: "/adapterMode",
                  fullWidth: true,
                  label: "Adapter mode",
                  required: true,
                  readOnly: false,
                  refreshOnChange: true,
                  valueSchema: { type: "string" },
                  control: {
                    kind: "select",
                    presentation: "radio",
                    options: [
                      { value: "postgresql", label: "PostgreSQL", description: null, disabled: false, disabledReason: null },
                      { value: "multi", label: "Multi-source", description: null, disabled: false, disabledReason: null },
                    ],
                  },
                },
                {
                  path: "/connection/url",
                  fullWidth: true,
                  label: "Connection URL",
                  required: true,
                  readOnly: false,
                  valueSchema: { type: "string" },
                  control: { kind: "text", clearable: true, placeholder: "jdbc:postgresql://host:5432/db" },
                },
                {
                  path: "/connection/user",
                  label: "Username",
                  required: true,
                  readOnly: false,
                  valueSchema: { type: "string" },
                  control: { kind: "text", clearable: true },
                },
                {
                  path: "/connection/password",
                  label: "Password",
                  help: "Already saved. Leave blank to keep the existing value.",
                  required: false,
                  readOnly: false,
                  valueSchema: { type: "string" },
                  control: { kind: "text", secret: true, clearable: true, placeholder: "******" },
                },
              ],
              errors: [],
              save: { method: "POST", path: "/api/data-query/businessConfig/useDataAdapter", bodySchema: {} },
            },
          });
        }
        return Response.json({ status: "empty" });
      },
      readOp(body) {
        readOpCalls.push(body);
        if (failNextTest) {
          return Response.json({ message: "Connection refused by host" }, { status: 422 });
        }
        return Response.json({
          kind: "json",
          value: {
            kind: "catalog",
            elapsedMs: 14,
            databaseProduct: "PostgreSQL",
            databaseVersion: "16.2",
            driverName: "PostgreSQL JDBC Driver",
            driverVersion: "42.7.3",
            catalog: "app",
            schema: "public",
            tables: [
              { name: "orders", type: "TABLE" },
              { name: "active_orders", type: "VIEW" },
            ],
          },
        });
      },
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Data adapters");
      expect(document.body.textContent).toContain("Connection URL");
      expect(document.body.textContent).toContain("Not checked yet");
      expect(document.body.textContent).toContain("Already saved. Leave blank to keep the existing value.");
    }, { timeout: 3000 });

    // DA-03 & DA-04: no TOC sidebar; 2-column grid with fullWidth fields spanning full width.
    expect(document.querySelector(".sdk-owner-form-toc")).toBeNull();
    expect(document.querySelector(".sdk-owner-form-field-list.is-two-col")).not.toBeNull();
    expect(document.querySelectorAll(".sdk-form-field-full-width").length).toBeGreaterThanOrEqual(2);

    let testBtn: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      testBtn = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((btn) => btn.textContent?.trim() === "Test connection");
      expect(testBtn).toBeDefined();
      expect(testBtn!.disabled).toBe(false);
    }, { timeout: 3000 });
    testBtn!.click();

    await vi.waitFor(() => {
      expect(readOpCalls).toHaveLength(1);
      const report = document.querySelector(".sdk-adapter-test-result");
      expect(report).not.toBeNull();
      expect(report!.textContent).toContain("14 ms");
      expect(report!.textContent).toContain("PostgreSQL 16.2");
      expect(report!.textContent).toContain("PostgreSQL JDBC Driver 42.7.3");
      expect(report!.textContent).toContain("orders");
      expect(report!.textContent).toContain("active_orders");
    }, { timeout: 3000 });

    expect(readOpCalls[0]).toMatchObject({
      applicationId: "settings",
      useId: "data-adapters",
      call: {
        input: {
          draft: {
            adapterMode: "postgresql",
            connection: { url: "jdbc:postgresql://db:5432/app", user: "postgres", password: "" },
          },
          parameters: { sourceId: "" },
        },
      },
    });

    // Editing the URL clears the stale structured report automatically.
    const urlInput = [...document.querySelectorAll<HTMLInputElement>("input")]
      .find((el) => el.value === "jdbc:postgresql://db:5432/app");
    expect(urlInput).toBeDefined();
    urlInput!.value = "jdbc:postgresql://new-db:5432/app";
    urlInput!.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-adapter-test-result")).toBeNull();
    }, { timeout: 3000 });

    // Failed test renders the error alert inside <data-adapter-test-report>.
    failNextTest = true;
    testBtn!.click();
    await vi.waitFor(() => {
      const report = document.querySelector(".sdk-adapter-test-result");
      expect(report).not.toBeNull();
      expect(report!.querySelector(".el-alert--error")).not.toBeNull();
      expect(report!.textContent).toContain("Connection refused by host");
    }, { timeout: 3000 });
  });

  it("renders per-card test connection with independent inline reports and compact class/relationship routing tables (DA-03/05/06/07)", async () => {
    const readOpCalls: Record<string, unknown>[] = [];
    await openDataAdaptersPanel({
      read(request) {
        const slot = request.memberPath.at(-1)!.member;
        if ("operations" in request && request.operations) {
          if (slot === "adapterForm") return adapterFormOperationsResponse();
          if (slot === "routingForm") return routingFormOperationsResponse();
          if (slot === "testConnection") return testButtonOperationsResponse();
          if (slot === "checkSandboxPermission") return checkSandboxOperationsResponse();
          return Response.json({ status: "ready", value: {} });
        }
        if (slot === "sandboxCapability") return sandboxCapabilityRecordResponse();
        if (slot === "adapterForm") return multiSourceAdapterFormResponse();
        if (slot === "routingForm") return multiSourceRoutingFormResponse();
        return Response.json({ status: "empty" });
      },
      readOp(body) {
        readOpCalls.push(body);
        const sourceId = ((body.call as { input?: { parameters?: { sourceId?: string } } })?.input?.parameters?.sourceId) ?? "";
        if (sourceId === "graph") {
          return Response.json({
            kind: "json",
            value: {
              kind: "search",
              elapsedMs: 9,
              databaseProduct: "OpenSearch",
              databaseVersion: "2.13.0",
              clusterName: "prod-es",
              indices: ["orders-2026"],
            },
          });
        }
        return Response.json({
          kind: "json",
          value: {
            kind: "catalog",
            elapsedMs: 11,
            databaseProduct: "PostgreSQL",
            databaseVersion: "16.2",
            driverName: "PostgreSQL JDBC Driver",
            driverVersion: "42.7.3",
            catalog: "crm",
            schema: "public",
            tables: [{ name: "orders", type: "TABLE" }],
          },
        });
      },
    });

    await vi.waitFor(() => {
      expect(document.querySelectorAll(".da-source-card-footer")).toHaveLength(2);
      expect(document.querySelectorAll(".sdk-form-table")).toHaveLength(2);
    }, { timeout: 3000 });

    // DA-03: no TOC sidebar in multi-source mode and no bottom standalone connection test section.
    expect(document.querySelector(".sdk-owner-form-toc")).toBeNull();
    expect(document.querySelector(".da-test-action")).toBeNull();

    // DA-05 & DA-06: test card 0 (crm) and card 1 (graph) independently; reports coexist inside their own cards.
    const footers = [...document.querySelectorAll<HTMLElement>(".da-source-card-footer")];
    const card0Btn = footers[0]!.querySelector<HTMLButtonElement>("button")!;
    const card1Btn = footers[1]!.querySelector<HTMLButtonElement>("button")!;
    await vi.waitFor(() => {
      expect(card0Btn.disabled).toBe(false);
      expect(card1Btn.disabled).toBe(false);
    }, { timeout: 3000 });

    card0Btn.click();
    await vi.waitFor(() => {
      expect(footers[0]!.querySelector(".sdk-adapter-test-result")?.textContent).toContain("PostgreSQL 16.2");
      expect(footers[1]!.querySelector(".sdk-adapter-test-result")).toBeNull();
    }, { timeout: 3000 });

    card1Btn.click();
    await vi.waitFor(() => {
      expect(footers[1]!.querySelector(".sdk-adapter-test-result")?.textContent).toContain("OpenSearch 2.13.0");
      expect(footers[1]!.querySelector(".sdk-adapter-test-result")?.textContent).toContain("prod-es");
      // Card 0's report stays visible alongside card 1's report.
      expect(footers[0]!.querySelector(".sdk-adapter-test-result")?.textContent).toContain("PostgreSQL 16.2");
    }, { timeout: 3000 });

    expect(readOpCalls.map((c) => (c.call as { input: { parameters: { sourceId: string } } }).input.parameters.sourceId))
      .toEqual(["crm", "graph"]);

    // DA-07: compact 2-col class routing table + 4-col relationship routing table.
    const [classTable, relTable] = [...document.querySelectorAll<HTMLTableElement>(".sdk-form-table")];
    expect(classTable!.querySelectorAll("thead th")).toHaveLength(2);
    const classRows = [...classTable!.querySelectorAll("tbody tr")];
    expect(classRows).toHaveLength(3);
    expect(classRows[0]!.querySelector(".da-routing-name")?.textContent).toBe("Order");
    // Class name cell renders clean plain text, never a disabled input box.
    expect(classRows[0]!.querySelector("td:first-child input")).toBeNull();

    expect(relTable!.querySelectorAll("thead th")).toHaveLength(4);
    const relRows = [...relTable!.querySelectorAll("tbody tr")];
    expect(relRows).toHaveLength(3);

    // Row 0 (MOUNTED_ON): graph -> editable realEdge input
    expect(relRows[0]!.textContent).toContain("MOUNTED_ON");
    expect(relRows[0]!.textContent).toContain("Device → Rack");
    expect(relRows[0]!.querySelector(".el-tag--warning")).toBeNull();
    expect(relRows[0]!.querySelector<HTMLInputElement>("td:nth-child(4) input")?.value).toBe("mounted_in_rack");

    // Row 1 (ORDER_DEVICE): cross-source orange warning tag + empty realEdge cell (no input)
    expect(relRows[1]!.querySelector(".el-tag--warning")?.textContent?.trim()).toBe("Cross-source");
    expect(relRows[1]!.textContent).toContain("crm → graph");
    expect(relRows[1]!.querySelector("td:nth-child(4) input")).toBeNull();

    // Row 2 (SELF_ORDER): SQL same-source -> plain source text + empty realEdge cell (no input)
    expect(relRows[2]!.querySelector(".el-tag--warning")).toBeNull();
    expect(relRows[2]!.textContent).toContain("crm");
    expect(relRows[2]!.querySelector("td:nth-child(4) input")).toBeNull();
  });

  it("renders aggregated rejection problems alert on MULTI_DATA_SOURCE_REJECTED refusal (DA-08)", async () => {
    const intents = humanIntents(() => ({
      kind: "refusal",
      code: "MULTI_DATA_SOURCE_REJECTED",
      message: "Invalid multi-source configuration",
      errors: [{ field: "/dataSources/0/id", code: "invalid_format", message: "dataSources[crm]: invalid" }],
      details: {
        problems: [
          { path: "dataSources[crm]", message: "data source crm has invalid adapter type" },
          { path: "classDef[Order]", message: "class Order is not routed to a data source" },
        ],
      },
    }), { source: "input", input: "target" });

    await openDataAdaptersPanel({
      extra(sent) {
        if (sent.path.startsWith("/api/panel-operations/") || sent.path.startsWith("/api/panel-operation-intents/")) {
          return intents(sent);
        }
        return undefined;
      },
      read(request) {
        const slot = request.memberPath.at(-1)!.member;
        if ("operations" in request && request.operations) {
          if (slot === "adapterForm") return adapterFormOperationsResponse();
          if (slot === "routingForm") return routingFormOperationsResponse();
          if (slot === "testConnection") return testButtonOperationsResponse();
          return Response.json({ status: "ready", value: {} });
        }
        if (slot === "sandboxCapability") return sandboxCapabilityRecordResponse();
        if (slot === "adapterForm") return multiSourceAdapterFormResponse();
        if (slot === "routingForm") return multiSourceRoutingFormResponse();
        return Response.json({ status: "empty" });
      },
    });

    await vi.waitFor(() => {
      expect(document.querySelectorAll(".da-source-card-footer")).toHaveLength(2);
    }, { timeout: 3000 });

    const labelInput = [...document.querySelectorAll<HTMLInputElement>("input")]
      .find((el) => el.value === "CRM DB");
    expect(labelInput).toBeDefined();
    labelInput!.value = "CRM Updated";
    labelInput!.dispatchEvent(new Event("input", { bubbles: true }));

    let saveBtn: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      saveBtn = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((btn) => btn.textContent?.trim() === "Save");
      expect(saveBtn).toBeDefined();
      expect(saveBtn!.disabled).toBe(false);
    }, { timeout: 3000 });
    saveBtn!.click();

    await vi.waitFor(() => {
      const problemAlert = document.querySelector(".sdk-owner-form-refusal-problems");
      expect(problemAlert).not.toBeNull();
      const codes = [...problemAlert!.querySelectorAll("code")].map((el) => el.textContent?.trim());
      expect(codes).toEqual(["dataSources[crm]", "classDef[Order]"]);
      expect(problemAlert!.textContent).toContain("data source crm has invalid adapter type");
      expect(problemAlert!.textContent).toContain("class Order is not routed to a data source");
    }, { timeout: 3000 });
  });

  it("preserves inactive branch unsaved draft when switching adapterMode A -> B -> A (DA-09)", async () => {
    const pgForm = {
      values: {
        adapterMode: "postgresql",
        connection: { url: "jdbc:postgresql://db:5432/app", user: "postgres" },
      },
      fields: [
        {
          path: "/adapterMode",
          fullWidth: true,
          label: "Adapter mode",
          required: true,
          readOnly: false,
          refreshOnChange: true,
          valueSchema: { type: "string" },
          control: {
            kind: "select",
            presentation: "radio",
            options: [
              { value: "postgresql", label: "PostgreSQL", description: null, disabled: false, disabledReason: null },
              { value: "m3", label: "M3 Graph", description: null, disabled: false, disabledReason: null },
            ],
          },
        },
        {
          path: "/connection/url",
          fullWidth: true,
          label: "Connection URL",
          required: true,
          readOnly: false,
          valueSchema: { type: "string" },
          control: { kind: "text", clearable: true },
        },
        {
          path: "/connection/user",
          label: "Username",
          required: true,
          readOnly: false,
          valueSchema: { type: "string" },
          control: { kind: "text", clearable: true },
        },
      ],
      errors: [],
      save: { method: "POST", path: "/api/data-query/businessConfig/useDataAdapter", bodySchema: {} },
    };

    const m3Form = {
      values: {
        adapterMode: "m3",
        connection: { url: "", company: "" },
      },
      fields: [
        pgForm.fields[0]!,
        {
          path: "/connection/url",
          fullWidth: true,
          label: "Graph URL",
          required: true,
          readOnly: false,
          valueSchema: { type: "string" },
          control: { kind: "text", clearable: true },
        },
        {
          path: "/connection/company",
          label: "Company",
          required: true,
          readOnly: false,
          valueSchema: { type: "string" },
          control: { kind: "text", clearable: true },
        },
      ],
      errors: [],
      save: { method: "POST", path: "/api/data-query/businessConfig/useDataAdapter", bodySchema: {} },
    };

    await openDataAdaptersPanel({
      read(request) {
        const slot = request.memberPath.at(-1)!.member;
        if ("operations" in request && request.operations) {
          if (slot === "adapterForm") return adapterFormOperationsResponse();
          if (slot === "testConnection") return testButtonOperationsResponse();
          return Response.json({ status: "ready", value: {} });
        }
        if (slot === "sandboxCapability") return sandboxCapabilityRecordResponse();
        if (slot === "adapterForm") {
          const reqValues = (request.runtimeParams?.values as { adapterMode?: string } | undefined);
          const mode = reqValues?.adapterMode ?? "postgresql";
          return Response.json({ status: "ready", value: mode === "m3" ? m3Form : pgForm });
        }
        return Response.json({ status: "empty" });
      },
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Connection URL");
    }, { timeout: 3000 });

    // Edit branch A (postgresql)
    const pgUrl = [...document.querySelectorAll<HTMLInputElement>("input")]
      .find((el) => el.value === "jdbc:postgresql://db:5432/app")!;
    pgUrl.value = "jdbc:postgresql://draft-a:5432/app";
    pgUrl.dispatchEvent(new Event("input", { bubbles: true }));

    // Switch to branch B (m3)
    const clickRadio = (label: string) => {
      const radioLabel = [...document.querySelectorAll<HTMLLabelElement>("label.el-radio")]
        .find((el) => el.textContent?.trim() === label);
      expect(radioLabel, `radio ${label}`).toBeDefined();
      radioLabel!.click();
    };
    clickRadio("M3 Graph");

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Graph URL");
    }, { timeout: 3000 });

    // Edit branch B (m3)
    const m3Inputs = [...document.querySelectorAll<HTMLInputElement>('input:not([type="radio"])')];
    m3Inputs[0]!.value = "m3://draft-b:8080";
    m3Inputs[0]!.dispatchEvent(new Event("input", { bubbles: true }));

    // Switch back to branch A (postgresql) => unsaved draft A is restored!
    clickRadio("PostgreSQL");

    await vi.waitFor(() => {
      const restored = [...document.querySelectorAll<HTMLInputElement>("input")]
        .find((el) => el.value === "jdbc:postgresql://draft-a:5432/app");
      expect(restored).toBeDefined();
    }, { timeout: 3000 });

    // Switch back to branch B (m3) => unsaved draft B is also restored!
    clickRadio("M3 Graph");

    await vi.waitFor(() => {
      const restored = [...document.querySelectorAll<HTMLInputElement>("input")]
        .find((el) => el.value === "m3://draft-b:8080");
      expect(restored).toBeDefined();
    }, { timeout: 3000 });
  });

  it("asks once before discarding combined adapterForm and routingForm drafts, preserving on cancel and resetting both on confirm (DA-10)", async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, "confirm");
    await openDataAdaptersPanel({
      read(request) {
        const slot = request.memberPath.at(-1)!.member;
        if ("operations" in request && request.operations) {
          if (slot === "adapterForm") return adapterFormOperationsResponse();
          if (slot === "routingForm") return routingFormOperationsResponse();
          if (slot === "testConnection") return testButtonOperationsResponse();
          return Response.json({ status: "ready", value: {} });
        }
        if (slot === "sandboxCapability") return sandboxCapabilityRecordResponse();
        if (slot === "adapterForm") return multiSourceAdapterFormResponse();
        if (slot === "routingForm") return multiSourceRoutingFormResponse();
        return Response.json({ status: "empty" });
      },
      readOp() {
        return Response.json({
          kind: "json",
          value: {
            kind: "catalog",
            elapsedMs: 8,
            databaseProduct: "PostgreSQL",
            databaseVersion: "16.2",
            driverName: "PostgreSQL JDBC Driver",
            driverVersion: "42.7.3",
            catalog: "crm",
            schema: "public",
            tables: [],
          },
        });
      },
    });

    await vi.waitFor(() => {
      expect(document.querySelectorAll(".da-source-card-footer")).toHaveLength(2);
      expect(document.querySelectorAll(".sdk-form-table")).toHaveLength(2);
    }, { timeout: 3000 });

    // Run a card test so we also verify discard clears card test results.
    const card0Btn = document.querySelector<HTMLButtonElement>(".da-source-card-footer button")!;
    await vi.waitFor(() => expect(card0Btn.disabled).toBe(false), { timeout: 3000 });
    card0Btn.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-adapter-test-result")).not.toBeNull();
    }, { timeout: 3000 });

    // Dirty BOTH adapterForm and routingForm.
    const labelInput = [...document.querySelectorAll<HTMLInputElement>("input")]
      .find((el) => el.value === "CRM DB")!;
    labelInput.value = "CRM Edited";
    labelInput.dispatchEvent(new Event("input", { bubbles: true }));

    const edgeInput = [...document.querySelectorAll<HTMLInputElement>("input")]
      .find((el) => el.value === "mounted_in_rack")!;
    edgeInput.value = "mounted_edited";
    edgeInput.dispatchEvent(new Event("input", { bubbles: true }));

    let discardBtn: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      discardBtn = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((btn) => btn.textContent?.trim() === "Discard");
      expect(discardBtn).toBeDefined();
      expect(discardBtn!.disabled).toBe(false);
    }, { timeout: 3000 });

    // 1. Click Discard and choose "Keep editing" -> both drafts and test report stay intact.
    discardBtn!.click();
    const cancelBox = await vi.waitFor(() => {
      const open = [...document.querySelectorAll<HTMLElement>(".el-message-box")]
        .filter((item) => item.closest<HTMLElement>(".el-overlay")?.style.display !== "none");
      if (!open.length) throw new Error("Expected discard confirm dialog");
      return open.at(-1)!;
    });
    [...cancelBox.querySelectorAll<HTMLButtonElement>("button")]
      .find((btn) => btn.textContent?.trim() === "Keep editing")!.click();
    await vi.waitFor(() => {
      if (cancelBox.closest<HTMLElement>(".el-overlay")?.style.display !== "none") {
        throw new Error("Dialog still open");
      }
    });
    await new Promise((resolve) => setTimeout(resolve));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect([...document.querySelectorAll<HTMLInputElement>("input")].some((el) => el.value === "CRM Edited")).toBe(true);
    expect([...document.querySelectorAll<HTMLInputElement>("input")].some((el) => el.value === "mounted_edited")).toBe(true);
    expect(document.querySelector(".sdk-adapter-test-result")).not.toBeNull();

    // 2. Click Discard again and confirm -> ONLY ONE more confirmation prompt, both forms reset & test report clears!
    discardBtn!.click();
    await confirmDiscard();

    await vi.waitFor(() => {
      expect([...document.querySelectorAll<HTMLInputElement>("input")].some((el) => el.value === "CRM DB")).toBe(true);
      expect([...document.querySelectorAll<HTMLInputElement>("input")].some((el) => el.value === "mounted_in_rack")).toBe(true);
      expect(document.querySelector(".sdk-adapter-test-result")).toBeNull();
    }, { timeout: 3000 });
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });
});
