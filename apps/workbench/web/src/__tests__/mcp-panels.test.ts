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
  CHECK_EXTERNAL_MCP_SERVICE,
  CREATE_EXTERNAL_MCP_SERVICE,
  DELETE_EXTERNAL_MCP_SERVICE,
  EXTERNAL_MCP_SERVICE,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import publishedSource from "../../../../../packages/platform-admin/resources/builtin-panels/published-mcp/panel.json";
import publishedHtml from "../../../../../packages/platform-admin/resources/builtin-panels/published-mcp/panel.html?raw";
import publishedModule from "../../../../../packages/platform-admin/resources/builtin-panels/published-mcp/panel.mjs?raw";
import externalSource from "../../../../../packages/platform-admin/resources/builtin-panels/external-mcp/panel.json";
import externalHtml from "../../../../../packages/platform-admin/resources/builtin-panels/external-mcp/panel.html?raw";
import externalModule from "../../../../../packages/platform-admin/resources/builtin-panels/external-mcp/panel.mjs?raw";
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
const publishedUse = panelUse(
  "published-mcp",
  "published-mcp",
  "builtin-product-published-mcp",
  "/settings/mcp-services",
);
const externalUse = panelUse(
  "external-mcp",
  "external-mcp",
  "builtin-product-external-mcp",
  "/settings/external-mcp",
);

const FORM_SAVE_OPS = new Set([CREATE_EXTERNAL_MCP_SERVICE, `${EXTERNAL_MCP_SERVICE}.save`]);
const READ_OPS = new Set([CHECK_EXTERNAL_MCP_SERVICE]);

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => {
        const form = FORM_SAVE_OPS.has(id);
        return {
          id,
          kind: form ? "form.save" : "action",
          effect: READ_OPS.has(id) ? "read" : "write",
          batch: false,
          inputSchema: {},
          target: form ? { source: "draft" } : { source: "input", input: "service" },
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

function buildPanel(
  panelId: string,
  name: string,
  source: typeof publishedSource | typeof externalSource,
  html: string,
  module: string,
) {
  const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
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
        createdAt: "2026-11-25T00:00:00Z",
        updatedAt: "2026-11-25T00:00:00Z",
      });
      return [memberName, { ...placement, target: { projectionId: definition.id! } }];
    }),
  );
  return {
    panel: currentPanelRecordSchema.parse({
      ...panelRecord(panelId, name, definePanel({ ...manifest, members })),
      visibility: "platform" as const,
      domainId: null,
      ownerId: null,
      editable: false,
      content: { ...source.content, html, module },
    }),
    projections,
  };
}

const builtPublished = buildPanel(
  publishedUse.panelId,
  "Published MCP services",
  publishedSource,
  publishedHtml,
  publishedModule,
);
const builtExternal = buildPanel(
  externalUse.panelId,
  "External MCP services",
  externalSource,
  externalHtml,
  externalModule,
);

let unmount = () => {};
afterEach(async () => {
  unmount();
  unmount = () => {};
  useApplicationCatalog().applications.value = [];
  await leaveFrame();
  vi.restoreAllMocks();
});

async function openBuiltPanel(
  use: typeof publishedUse | typeof externalUse,
  built: ReturnType<typeof buildPanel>,
  handlers: {
    read: (request: ProductPanelReadRequest) => Response;
    readOperation?: (body: Record<string, unknown>) => Response | Promise<Response>;
  },
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: { render: () => h(RouterView) },
        children: [
          { path: "/settings/mcp-services", component: PanelApplicationRoute, props: { applicationId: appId } },
          { path: "/settings/external-mcp", component: PanelApplicationRoute, props: { applicationId: appId } },
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
          panelUses: [publishedUse, externalUse],
        }],
      });
    }
    if (path === "/api/data-query/platform/applications/resolve-entry") {
      return Response.json({
        data: {
          applicationId: appId,
          entry: { path: "/settings", renderer: "settings" },
          use,
          menu: { singleEntry: false, groups: [], panelUses: [publishedUse, externalUse] },
        },
      });
    }
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: {
          applicationId: appId,
          entry: { path: "/settings", renderer: "settings" },
          panelUses: [publishedUse, externalUse],
        },
      });
    }
    if (path === `/api/product-panels/${use.panelId}`) {
      return panelAnswer(built.panel, sent);
    }
    if (path === `/api/product-panels/${use.panelId}/snapshot`) {
      return panelSnapshot(built.panel, Object.fromEntries(built.projections), sent);
    }
    if (path.startsWith("/api/product-projections/")) {
      const id = decodeURIComponent(path.slice("/api/product-projections/".length));
      const projection = built.projections.get(id);
      if (projection) return Response.json({ projection });
    }
    if (path === "/api/product-panels/read") {
      return handlers.read(sent.body as ProductPanelReadRequest);
    }
    if (path === "/api/product-panels/read-batch") {
      const { reads } = sent.body as { reads: ProductPanelReadRequest[] };
      const results = await Promise.all(
        reads.map(async (request) => {
          const response = handlers.read(request);
          return response.json();
        }),
      );
      return Response.json({ results });
    }
    if (path === "/api/panel-operations/read" && handlers.readOperation) {
      return handlers.readOperation(sent.body as Record<string, unknown>);
    }
    if (path === "/api/product-panels/page-skill") {
      return Response.json({ pageKey: use.pageKey, applicationId: appId, useId: use.id, panelId: use.panelId, skills: [] });
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
    entryAccess: ["mcp-service"],
    scheduleAdapter: null,
    releaseId: null,
    names: { en: "System settings" },
    descriptions: {},
    icon: "settings",
    panelUses: [publishedUse, externalUse],
  }];
  await router.push(use.path);
  await router.isReady();
  const mounted = mountPlatformPage(() => h(RouterView), router);
  unmount = () => {
    mounted.app.unmount();
    mounted.element.remove();
  };
  return { root: mounted.element, router };
}

describe("built-in MCP settings panels", () => {
  it("published-mcp renders multiple cards with concurrent accordion serviceTools (PM-03, PM-04, PM-05)", async () => {
    const reads: string[] = [];
    const { root } = await openBuiltPanel(publishedUse, builtPublished, {
      read(request) {
        const member = request.memberPath.at(-1)?.member ?? "";
        if ("operations" in request && request.operations) {
          return Response.json({ status: "ready", value: {} });
        }
        reads.push(member);
        if (member === "services") {
          return Response.json({
            status: "ready",
            value: [
              {
                primaryKey: "analysis-agents",
                label: "Agent service",
                fields: { mcpUrl: "http://example/mcp/analysis-agents", status: "Published", toolCount: "2" },
                fieldLabels: { mcpUrl: "Service address", status: "Status", toolCount: "Available tools" },
                tones: { status: "success" },
              },
              {
                primaryKey: "ops-agents",
                label: "Ops agent service",
                fields: { mcpUrl: "http://example/mcp/ops-agents", status: "Published", toolCount: "1" },
                fieldLabels: { mcpUrl: "Service address", status: "Status", toolCount: "Available tools" },
                tones: { status: "success" },
              },
            ],
          });
        }
        if (member === "serviceSummary") {
          const targetKey = (request.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey;
          if (targetKey === "ops-agents") {
            return Response.json({
              status: "ready",
              value: {
                primaryKey: "ops-agents",
                label: "Ops agent service",
                fields: {
                  mcpUrl: "http://example/mcp/ops-agents",
                  authHint: "Use an ops API key",
                },
                fieldLabels: {
                  mcpUrl: "Service address",
                  authHint: "Authentication",
                },
              },
            });
          }
          return Response.json({
            status: "ready",
            value: {
              primaryKey: "analysis-agents",
              label: "Agent service",
              fields: {
                mcpUrl: "http://example/mcp/analysis-agents",
                authHint: "Use an API key",
              },
              fieldLabels: {
                mcpUrl: "Service address",
                authHint: "Authentication",
              },
            },
          });
        }
        if (member === "serviceTools") {
          const targetKey = (request.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey;
          if (targetKey === "ops-agents") {
            return Response.json({
              status: "ready",
              value: [
                {
                  primaryKey: "inspect_alert",
                  label: "Inspect Alert",
                  subtitle: "inspect_alert",
                  fields: {
                    name: "inspect_alert",
                    description: "Inspects an active alert",
                    inputSchema: "{\n  \"type\": \"object\",\n  \"required\": [\"alertId\"]\n}",
                  },
                  fieldLabels: {
                    name: "Tool name",
                    description: "Description",
                    inputSchema: "Input schema",
                  },
                },
              ],
            });
          }
          return Response.json({
            status: "ready",
            value: [
              {
                primaryKey: "list_agents",
                label: "List Agents",
                subtitle: "list_agents",
                fields: {
                  name: "list_agents",
                  description: "Lists enabled agents",
                  inputSchema: "{\n  \"type\": \"object\"\n}",
                },
                fieldLabels: {
                  name: "Tool name",
                  description: "Description",
                  inputSchema: "Input schema",
                },
              },
              {
                primaryKey: "ask_agent",
                label: "Ask Agent",
                subtitle: "ask_agent",
                fields: {
                  name: "ask_agent",
                  description: "Asks one enabled agent",
                  inputSchema: "{\n  \"type\": \"object\",\n  \"required\": [\"prompt\"]\n}",
                },
                fieldLabels: {
                  name: "Tool name",
                  description: "Description",
                  inputSchema: "Input schema",
                },
              },
            ],
          });
        }
        return Response.json({ status: "empty" });
      },
    });

    await vi.waitFor(() => {
      expect(root.textContent).toContain("Agent service");
      expect(root.textContent).toContain("Ops agent service");
      expect(root.textContent).toContain("http://example/mcp/analysis-agents");
      expect(root.querySelector(".sdk-object-summary-copy-btn")).not.toBeNull();
    });

    // Tools stay collapsed by default until each service card's tools disclosure is opened.
    expect(reads).toContain("services");
    expect(reads).toContain("serviceSummary");
    expect(reads).not.toContain("serviceTools");

    // PM-05: expand BOTH cards simultaneously; each mounts its own scoped serviceTools projection.
    const toolsDetails = [...root.querySelectorAll("details.pm-tools-details")] as HTMLDetailsElement[];
    expect(toolsDetails).toHaveLength(2);
    for (const detail of toolsDetails) {
      detail.open = true;
      detail.dispatchEvent(new Event("toggle"));
    }

    await vi.waitFor(() => {
      expect(root.textContent).toContain("List Agents");
      expect(root.textContent).toContain("list_agents");
      expect(root.textContent).toContain("Inspect Alert");
      expect(root.textContent).toContain("inspect_alert");
    });

    // PM-03: accordion tools start collapsed; clicking expands description and JSON schema <pre>.
    expect(root.textContent).not.toContain("Lists enabled agents");
    const accordionSummaries = [...root.querySelectorAll("button.sdk-object-list-accordion-summary")] as HTMLButtonElement[];
    expect(accordionSummaries.length).toBe(3);
    accordionSummaries[0]!.click();
    accordionSummaries[2]!.click();

    await vi.waitFor(() => {
      expect(root.textContent).toContain("Lists enabled agents");
      expect(root.textContent).toContain("Inspects an active alert");
      const preBlocks = [...root.querySelectorAll("pre.sdk-object-list-accordion-pre")].map((el) => el.textContent);
      expect(preBlocks.some((text) => text?.includes('"type": "object"'))).toBe(true);
      expect(preBlocks.some((text) => text?.includes('"alertId"'))).toBe(true);
    });

    expect(reads).toContain("serviceTools");
  });

  it("external-mcp probes on demand with status resultFrom, accordion tools, and multi-card stacking (EM-04, EM-05, EM-07, EM-08)", async () => {
    const SERVICE_ID_1 = "11111111-1111-4111-8111-111111111111";
    const SERVICE_ID_2 = "22222222-2222-4222-8222-222222222222";
    const reads: string[] = [];
    const checkCalls: string[] = [];
    let failService1 = false;

    const { root } = await openBuiltPanel(externalUse, builtExternal, {
      readOperation(body) {
        const call = body.call as { target?: { primaryKey?: string } } | undefined;
        const primaryKey = call?.target?.primaryKey ?? "";
        checkCalls.push(primaryKey);
        if (primaryKey === SERVICE_ID_1 && failService1) {
          return Response.json({
            kind: "json",
            value: {
              reachable: false,
              toolCount: 0,
              error: "Unable to connect to MCP service",
              status: { label: "Unreachable", tone: "danger" },
            },
            message: "Service unreachable: Unable to connect to MCP service",
          });
        }
        return Response.json({
          kind: "json",
          value: {
            reachable: true,
            toolCount: 1,
            status: { label: "Available", tone: "success" },
          },
          message: "Service available (1 tools)",
        });
      },
      read(request) {
        const member = request.memberPath.at(-1)?.member ?? "";
        if ("operations" in request && request.operations) {
          if (member === "services") {
            return Response.json({
              status: "ready",
              value: {
                check: {
                  kind: "action",
                  handlerRef: CHECK_EXTERNAL_MCP_SERVICE,
                  label: "Check",
                  effect: "read",
                  target: { source: "row" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
                delete: {
                  kind: "action",
                  handlerRef: DELETE_EXTERNAL_MCP_SERVICE,
                  label: "Delete",
                  effect: "write",
                  target: { source: "row" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              },
            });
          }
          return Response.json({ status: "ready", value: {} });
        }
        reads.push(member);
        if (member === "services") {
          return Response.json({
            status: "ready",
            value: [
              {
                primaryKey: SERVICE_ID_1,
                className: EXTERNAL_MCP_SERVICE,
                label: "Orders MCP",
                subtitle: "https://orders.example/mcp",
                fields: {
                  name: "Orders MCP",
                  url: "https://orders.example/mcp",
                  usedBy: "Sales Agent",
                  headerNames: "authorization",
                },
                fieldLabels: {
                  name: "Service name",
                  url: "Service address",
                  usedBy: "Used by",
                  headerNames: "Request headers",
                },
              },
              {
                primaryKey: SERVICE_ID_2,
                className: EXTERNAL_MCP_SERVICE,
                label: "Inventory MCP",
                subtitle: "https://inventory.example/mcp",
                fields: {
                  name: "Inventory MCP",
                  url: "https://inventory.example/mcp",
                  usedBy: "Not used",
                  headerNames: "",
                },
                fieldLabels: {
                  name: "Service name",
                  url: "Service address",
                  usedBy: "Used by",
                  headerNames: "Request headers",
                },
              },
            ],
          });
        }
        if (member === "inspectedSummary") {
          const targetKey = (request.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey;
          return Response.json({
            status: "ready",
            value: {
              primaryKey: targetKey ?? SERVICE_ID_1,
              label: targetKey === SERVICE_ID_2 ? "Inventory MCP" : "Orders MCP",
              fields: {
                url: targetKey === SERVICE_ID_2 ? "https://inventory.example/mcp" : "https://orders.example/mcp",
                usedBy: targetKey === SERVICE_ID_2 ? "Not used" : "Sales Agent",
              },
              fieldLabels: {
                url: "Service address",
                usedBy: "Used by",
              },
            },
          });
        }
        if (member === "inspectedTools") {
          const targetKey = (request.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey;
          if (targetKey === SERVICE_ID_2) {
            return Response.json({
              status: "ready",
              value: [
                {
                  primaryKey: "check_stock",
                  label: "Check Stock",
                  subtitle: "check_stock",
                  fields: {
                    name: "check_stock",
                    description: "Checks warehouse inventory",
                    inputSchema: "{\n  \"type\": \"object\",\n  \"required\": [\"sku\"]\n}",
                  },
                  fieldLabels: {
                    name: "Tool name",
                    description: "Description",
                    inputSchema: "Input schema",
                  },
                },
              ],
            });
          }
          return Response.json({
            status: "ready",
            value: [
              {
                primaryKey: "create_order",
                label: "Create Order",
                subtitle: "create_order",
                fields: {
                  name: "create_order",
                  description: "Creates an order",
                  inputSchema: "{\n  \"type\": \"object\"\n}",
                },
                fieldLabels: {
                  name: "Tool name",
                  description: "Description",
                  inputSchema: "Input schema",
                },
              },
            ],
          });
        }
        return Response.json({ status: "empty" });
      },
    });

    await vi.waitFor(() => {
      expect(root.textContent).toContain("Orders MCP");
      expect(root.textContent).toContain("Inventory MCP");
      expect(root.textContent).toContain("Unchecked");
    });

    // Tools must NOT be probed automatically on initial load.
    expect(reads).not.toContain("inspectedTools");
    expect(reads).not.toContain("inspectedSummary");

    // EM-05: row tail delete action is icon-only with danger tone.
    const deleteButtons = [...root.querySelectorAll("button[aria-label='Delete']")];
    expect(deleteButtons).toHaveLength(2);
    expect(deleteButtons[0]!.textContent?.trim()).toBe("");

    // EM-04 & EM-08: click Check on Service 1, then on Service 2 — both cards stack below the table.
    const checkButtons = [...root.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Check");
    expect(checkButtons).toHaveLength(2);
    checkButtons[0]!.click();

    await vi.waitFor(() => {
      expect(checkCalls).toContain(SERVICE_ID_1);
      expect(root.querySelector(".sdk-object-list-tag[data-tone='success']")?.textContent?.trim()).toBe("Available");
      expect(root.querySelectorAll(".em-discovered-card")).toHaveLength(1);
      expect(root.textContent).toContain("Create Order");
      expect(root.textContent).toContain("create_order");
    });

    // EM-07: accordion expands tool description and JSON schema <pre>.
    expect(root.textContent).not.toContain("Creates an order");
    (root.querySelector(".em-discovered-card button.sdk-object-list-accordion-summary") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain("Creates an order");
      expect(root.querySelector(".em-discovered-card pre.sdk-object-list-accordion-pre")?.textContent).toContain('"type": "object"');
    });

    // Check Service 2: both Service 1 and Service 2 cards stay visible simultaneously.
    checkButtons[1]!.click();
    await vi.waitFor(() => {
      expect(checkCalls).toContain(SERVICE_ID_2);
      expect(root.querySelectorAll(".em-discovered-card")).toHaveLength(2);
      expect(root.textContent).toContain("Create Order");
      expect(root.textContent).toContain("Check Stock");
    });

    // Recheck Service 1 when unreachable: status updates to Unreachable, Service 1 card displays the error, Service 2 card remains.
    failService1 = true;
    const recheckBtns = [...root.querySelectorAll(".em-discovered-card button")].filter(
      (button) => button.textContent?.trim() === "Check again",
    ) as HTMLButtonElement[];
    expect(recheckBtns).toHaveLength(2);
    recheckBtns[0]!.click();

    await vi.waitFor(() => {
      expect(root.querySelector(".sdk-object-list-tag[data-tone='danger']")?.textContent?.trim()).toBe("Unreachable");
      expect(root.querySelector(".em-discovered-card-error")?.textContent?.trim()).toBe("Unable to connect to MCP service");
      expect(root.textContent).toContain("Check Stock");
      expect(root.textContent).not.toContain("Create Order");
    });

    // Close both cards independently via their Close buttons.
    const closeBtns = [...root.querySelectorAll(".em-discovered-card button")].filter(
      (button) => button.textContent?.trim() === "Close",
    ) as HTMLButtonElement[];
    expect(closeBtns).toHaveLength(2);
    closeBtns[0]!.click();

    await vi.waitFor(() => {
      expect(root.querySelectorAll(".em-discovered-card")).toHaveLength(1);
      expect(root.textContent).toContain("Check Stock");
    });

    const remainingCloseBtn = [...root.querySelectorAll(".em-discovered-card button")].find(
      (button) => button.textContent?.trim() === "Close",
    ) as HTMLButtonElement;
    remainingCloseBtn.click();

    await vi.waitFor(() => {
      expect(root.querySelectorAll(".em-discovered-card")).toHaveLength(0);
    });
    expect(root.textContent).toContain("Orders MCP");
    expect(DELETE_EXTERNAL_MCP_SERVICE).toBe("externalMcp.delete");
  });
});
