import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
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
  unmount();
  unmount = () => {};
  useApplicationCatalog().applications.value = [];
  await leaveFrame();
  vi.restoreAllMocks();
});

async function openDataAdaptersPanel(handlers: {
  read: (request: ProductPanelReadRequest) => Response;
  readOp?: (body: Record<string, unknown>) => Response;
}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: { render: () => h(RouterView) },
        children: [
          { path: adaptersUse.path, component: PanelApplicationRoute, props: { applicationId: appId } },
        ],
      },
    ],
  });

  installPlatform(async (sent: Sent) => {
    const { path } = sent;
    if (path === "/api/data-query/platform/applications") {
      return Response.json({
        data: [{
          id: appId,
          kind: "native",
          rail: "bottom",
          category: "admin",
          sort: 20,
          entry: { path: "/settings", renderer: "settings" },
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

describe("builtin-product-data-adapters panel", () => {
  it("renders single-source form, runs draft connection test via OperationButton, and clears stale report when draft changes", async () => {
    const readOpCalls: Record<string, unknown>[] = [];
    await openDataAdaptersPanel({
      read(request) {
        const slot = request.memberPath.at(-1)!.member;
        if ("operations" in request && request.operations) {
          if (slot === "adapterForm") return adapterFormOperationsResponse();
          if (slot === "testConnection") return testButtonOperationsResponse();
          if (slot === "checkSandboxPermission") {
            return Response.json({ status: "ready", value: {
              checkSandboxPermission: {
                kind: "action", handlerRef: CHECK_DATA_ADAPTER_SANDBOX_PERMISSION, label: "Check permission",
                effect: "write", batch: false, target: { source: "input", input: "target" }, inputSchema: {}, resultSchema: {},
              },
            } });
          }
          return Response.json({ status: "ready", value: {} });
        }
        if (slot === "sandboxCapability") {
          return Response.json({ status: "ready", value: {
            primaryKey: "domain", label: "PostgreSQL",
            fields: { sandboxStatus: "Not checked yet", sandboxDetail: "Sandbox permissions have not been checked." },
            outputs: { configured: true, sandboxStatus: "unchecked", sandboxSupported: true },
          } });
        }
        if (slot === "adapterForm") {
          return Response.json({
            status: "ready",
            value: {
              sections: [
                { key: "mode", title: "Data adapter mode" },
                { key: "connection", title: "PostgreSQL" },
              ],
              values: {
                adapterMode: "postgresql",
                connection: { url: "jdbc:postgresql://db:5432/app", user: "postgres", password: "" },
              },
              fields: [
                {
                  path: "/adapterMode",
                  section: "mode",
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
                  section: "connection",
                  label: "Connection URL",
                  required: true,
                  readOnly: false,
                  valueSchema: { type: "string" },
                  control: { kind: "text", placeholder: "jdbc:postgresql://host:5432/db" },
                },
                {
                  path: "/connection/password",
                  section: "connection",
                  label: "Password",
                  help: "Already saved. Leave blank to keep the existing value.",
                  required: false,
                  readOnly: false,
                  valueSchema: { type: "string" },
                  control: { kind: "text", secret: true, placeholder: "******" },
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
        return Response.json({
          kind: "markdown",
          markdown: "### Connection test succeeded\n\n- PostgreSQL 16.2 (`orders`)",
        });
      },
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Data adapters");
      expect(document.body.textContent).toContain("Connection URL");
      expect(document.body.textContent).toContain("Not checked yet");
      expect(document.body.textContent).toContain("immediately deletes one empty probe table");
      expect(document.querySelector('[data-member="checkSandboxPermission"] button')?.textContent).toContain("Check permission");
      expect(document.body.textContent).toContain("Already saved. Leave blank to keep the existing value.");
    }, { timeout: 3000 });

    expect(readOpCalls).toHaveLength(0);
    let testBtn: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      testBtn = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((btn) => btn.textContent?.trim() === "Test connection");
      expect(testBtn, document.body.textContent ?? "").toBeDefined();
      expect(testBtn!.disabled).toBe(false);
    }, { timeout: 3000 });
    testBtn!.click();

    await vi.waitFor(() => {
      expect(readOpCalls).toHaveLength(1);
      expect(document.body.textContent).toContain("Connection test succeeded");
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

    // Editing the URL clears the stale test report automatically
    const urlInput = [...document.querySelectorAll<HTMLInputElement>("input")]
      .find((el) => el.value === "jdbc:postgresql://db:5432/app");
    expect(urlInput).toBeDefined();
    urlInput!.value = "jdbc:postgresql://new-db:5432/app";
    urlInput!.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain("Connection test succeeded");
    }, { timeout: 3000 });
  });

  it("shows multi-source data source selector and passes selected sourceId to testConnection", async () => {
    const readOpCalls: Record<string, unknown>[] = [];
    await openDataAdaptersPanel({
      read(request) {
        const slot = request.memberPath.at(-1)!.member;
        if ("operations" in request && request.operations) {
          if (slot === "adapterForm") return adapterFormOperationsResponse();
          if (slot === "testConnection") return testButtonOperationsResponse();
          if (slot === "checkSandboxPermission") {
            return Response.json({ status: "ready", value: {
              checkSandboxPermission: {
                kind: "action", handlerRef: CHECK_DATA_ADAPTER_SANDBOX_PERMISSION, label: "Check permission",
                effect: "write", batch: false, target: { source: "input", input: "target" }, inputSchema: {}, resultSchema: {},
              },
            } });
          }
          return Response.json({ status: "ready", value: {} });
        }
        if (slot === "sandboxCapability") {
          return Response.json({ status: "ready", value: {
            primaryKey: "domain", label: "PostgreSQL",
            fields: { sandboxStatus: "Not checked yet", sandboxDetail: "Sandbox permissions have not been checked." },
            outputs: { configured: true, sandboxStatus: "unchecked", sandboxSupported: true },
          } });
        }
        if (slot === "adapterForm") {
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
                    adapter: { adapterType: "postgresql", connection: { url: "jdbc:postgresql://crm/db", user: "crm", password: "" } },
                  },
                ],
              },
              fields: [
                {
                  path: "/adapterMode",
                  section: "mode",
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
                  label: "Data sources",
                  required: true,
                  readOnly: false,
                  refreshOnChange: true,
                  valueSchema: { type: "array" },
                  control: {
                    kind: "object-array",
                    itemKeyPath: "/id",
                    itemFields: [
                      {
                        path: "/id",
                        label: "Source ID",
                        required: true,
                        readOnly: false,
                        valueSchema: { type: "string" },
                        control: { kind: "text" },
                      },
                      {
                        path: "/label",
                        label: "Display name",
                        required: false,
                        readOnly: false,
                        valueSchema: { type: "string" },
                        control: { kind: "text" },
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
        return Response.json({ status: "empty" });
      },
      readOp(body) {
        readOpCalls.push(body);
        return Response.json({
          kind: "markdown",
          markdown: "### Connection test succeeded\n\n- Data source: `crm`",
        });
      },
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Select one configured data source from the draft");
    }, { timeout: 3000 });

    expect(readOpCalls).toHaveLength(0);
    let testBtn: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      testBtn = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((btn) => btn.textContent?.trim() === "Test connection");
      expect(testBtn, document.body.textContent ?? "").toBeDefined();
      expect(testBtn!.disabled).toBe(false);
    }, { timeout: 3000 });
    testBtn!.click();

    await vi.waitFor(() => {
      expect(readOpCalls).toHaveLength(1);
    }, { timeout: 3000 });

    expect(readOpCalls[0]).toMatchObject({
      applicationId: "settings",
      useId: "data-adapters",
      call: {
        input: {
          parameters: { sourceId: "crm" },
        },
      },
    });
  });
});
