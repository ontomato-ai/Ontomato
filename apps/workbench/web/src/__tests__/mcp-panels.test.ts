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
          effect: "write",
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
          menu: { groups: [], panelUses: [publishedUse, externalUse] },
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
  it("published-mcp renders published services, copyable endpoint summary, and collapsible tool schema", async () => {
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
                fields: { mcpUrl: "http://example/mcp/analysis-agents", status: "Published", toolCount: "1" },
                fieldLabels: { mcpUrl: "Service address", status: "Status", toolCount: "Available tools" },
                tones: { status: "success" },
              },
            ],
          });
        }
        if (member === "serviceSummary") {
          return Response.json({
            status: "ready",
            value: {
              primaryKey: "analysis-agents",
              label: "Agent service",
              fields: {
                mcpUrl: "http://example/mcp/analysis-agents",
                status: "Published",
                toolCount: "1",
                authHint: "Use an API key",
              },
              fieldLabels: {
                mcpUrl: "Service address",
                status: "Status",
                toolCount: "Available tools",
                authHint: "Authentication",
              },
              tones: { status: "success" },
            },
          });
        }
        if (member === "serviceTools") {
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
            ],
          });
        }
        return Response.json({ status: "empty" });
      },
    });

    await vi.waitFor(() => {
      expect(root.textContent).toContain("Agent service");
      expect(root.textContent).toContain("http://example/mcp/analysis-agents");
      expect(root.textContent).toContain("List Agents");
      expect(root.textContent).toContain("Lists enabled agents");
      expect(root.querySelector(".sdk-object-summary-copy-btn")).not.toBeNull();
      expect(root.querySelector("details.pm-schema-details pre")?.textContent).toContain('"type": "object"');
    });

    expect(reads).toContain("services");
    expect(reads).toContain("serviceSummary");
    expect(reads).toContain("serviceTools");
  });

  it("external-mcp never probes tools on initial load and checks tools only on demand", async () => {
    const SERVICE_ID = "11111111-1111-4111-8111-111111111111";
    const reads: string[] = [];
    let failTools = false;

    const { root } = await openBuiltPanel(externalUse, builtExternal, {
      read(request) {
        const member = request.memberPath.at(-1)?.member ?? "";
        if ("operations" in request && request.operations) {
          if (member === "services") {
            return Response.json({
              status: "ready",
              value: {
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
                primaryKey: SERVICE_ID,
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
            ],
          });
        }
        if (member === "inspectedSummary") {
          return Response.json({
            status: "ready",
            value: {
              primaryKey: SERVICE_ID,
              label: "Orders MCP",
              fields: {
                url: "https://orders.example/mcp",
                usedBy: "Sales Agent",
                headerNames: "authorization",
              },
              fieldLabels: {
                url: "Service address",
                usedBy: "Used by",
                headerNames: "Request headers",
              },
            },
          });
        }
        if (member === "inspectedTools") {
          if (failTools) {
            return Response.json({
              status: "error",
              message: "Unable to connect to MCP service",
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
      expect(root.textContent).toContain("https://orders.example/mcp");
      expect(root.textContent).toContain("Sales Agent");
    });

    // Plan A: tools must NOT be probed automatically on page load.
    expect(reads).not.toContain("inspectedTools");
    expect(reads).not.toContain("inspectedSummary");

    // Click the row's "Check" action to mount inspectedTools on demand.
    const checkBtn = [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Check");
    expect(checkBtn).toBeDefined();
    checkBtn!.click();

    await vi.waitFor(() => {
      expect(reads).toContain("inspectedTools");
      expect(document.body.textContent).toContain("Create Order");
      expect(document.body.textContent).toContain("Creates an order");
    });

    // Simulate upstream failure on recheck: error renders in drawer without breaking main list.
    failTools = true;
    const recheckBtn = [...document.body.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Check again");
    expect(recheckBtn).toBeDefined();
    recheckBtn!.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Unable to connect to MCP service");
    });
    expect(root.textContent).toContain("Orders MCP");
    expect(DELETE_EXTERNAL_MCP_SERVICE).toBe("externalMcp.delete");
  });
});
