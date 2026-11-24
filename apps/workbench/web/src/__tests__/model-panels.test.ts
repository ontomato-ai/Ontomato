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
  ADD_MODEL_ENTRY,
  DELETE_MODEL_CONNECTION,
  DELETE_MODEL_ENTRY,
  DISCOVER_MODEL_CONNECTION,
  MODEL_CONNECTION,
  MODEL_ENTRY,
  MODEL_USAGE,
  PAUSE_VECTOR_REBUILD,
  REBUILD_VECTORS,
  TEST_MODEL_CONNECTION,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import connectionsSource from "../../../../../packages/platform-admin/resources/builtin-panels/model-connections/panel.json";
import connectionsHtml from "../../../../../packages/platform-admin/resources/builtin-panels/model-connections/panel.html?raw";
import connectionsModule from "../../../../../packages/platform-admin/resources/builtin-panels/model-connections/panel.mjs?raw";
import usageSource from "../../../../../packages/platform-admin/resources/builtin-panels/model-usage/panel.json";
import usageHtml from "../../../../../packages/platform-admin/resources/builtin-panels/model-usage/panel.html?raw";
import usageModule from "../../../../../packages/platform-admin/resources/builtin-panels/model-usage/panel.mjs?raw";
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
const connectionsUse = panelUse(
  "model-connections",
  "model-connections",
  "builtin-product-model-connections",
  "/settings/model-config/providers",
);
const usageUse = {
  ...panelUse(
    "model-usage",
    "model-usage",
    "builtin-product-model-usage",
    "/settings/model-config/usage",
  ),
  inputs: {
    domain: { literal: { className: MODEL_USAGE, primaryKey: "domain" } },
  },
};

const READ_OPS = new Set([DISCOVER_MODEL_CONNECTION, TEST_MODEL_CONNECTION]);
const FORM_SAVE_OPS = new Set([`${MODEL_CONNECTION}.save`, ADD_MODEL_ENTRY, `${MODEL_ENTRY}.save`, `${MODEL_USAGE}.save`]);

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
          target: readOnly ? { source: "none" } : form ? { source: "draft" } : { source: "input", input: "target" },
        };
      }),
    }),
  ]),
);

const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "OperationButton" ? { config: [{ name: "operation", type: "string", required: true, description: "Operation" }] } : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);

function buildPanel(
  panelId: string,
  name: string,
  source: typeof connectionsSource | typeof usageSource,
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
        createdAt: "2026-11-23T00:00:00Z",
        updatedAt: "2026-11-23T00:00:00Z",
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

const builtConnections = buildPanel(
  connectionsUse.panelId,
  "Connections & models",
  connectionsSource,
  connectionsHtml,
  connectionsModule,
);
const builtUsage = buildPanel(
  usageUse.panelId,
  "Model usage",
  usageSource,
  usageHtml,
  usageModule,
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
  use: typeof connectionsUse | typeof usageUse,
  built: ReturnType<typeof buildPanel>,
  handlers: {
    read: (request: ProductPanelReadRequest) => Response;
    readOperation?: (body: Record<string, unknown>) => Response;
  },
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: { render: () => h(RouterView) },
        children: [
          { path: "/settings/model-config/providers", component: PanelApplicationRoute, props: { applicationId: appId } },
          { path: "/settings/model-config/usage", component: PanelApplicationRoute, props: { applicationId: appId } },
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
          panelUses: [connectionsUse, usageUse],
        }],
      });
    }
    if (path === "/api/data-query/platform/applications/resolve-entry") {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/settings", renderer: "settings" }, use, menu: { groups: [], panelUses: [connectionsUse, usageUse] } },
      });
    }
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/settings", renderer: "settings" }, panelUses: [connectionsUse, usageUse] },
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
    entryAccess: ["system-config"],
    scheduleAdapter: null,
    releaseId: null,
    names: { en: "System settings" },
    descriptions: {},
    icon: "settings",
    panelUses: [connectionsUse, usageUse],
  }];
  await router.push(use.path);
  await router.isReady();
  const mounted = mountPlatformPage(() => h(RouterView), router);
  unmount = () => {
    mounted.app.unmount();
    mounted.element.remove();
  };
  return { router };
}

describe("built-in model panels", () => {
  it("mounts the model connections panel with a blank password input, tests a model row, and discovers models", async () => {
    const readOps: Record<string, unknown>[] = [];
    await openBuiltPanel(connectionsUse, builtConnections, {
      read(request) {
        const slot = request.memberPath.at(-1)!.member;
        if ("operations" in request && request.operations) {
          if (slot === "connectionForm") {
            return Response.json({
              status: "ready",
              value: {
                save: {
                  kind: "form.save",
                  handlerRef: `${MODEL_CONNECTION}.save`,
                  label: "Save connection",
                  effect: "write",
                  target: { source: "input", input: "target" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              },
            });
          }
          if (slot === "deleteConnection") {
            return Response.json({
              status: "ready",
              value: {
                delete: {
                  kind: "action",
                  handlerRef: DELETE_MODEL_CONNECTION,
                  label: "Delete connection",
                  effect: "write",
                  target: { source: "input", input: "target" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              },
            });
          }
          if (slot === "discoverModels") {
            return Response.json({
              status: "ready",
              value: {
                discover: {
                  kind: "action",
                  handlerRef: DISCOVER_MODEL_CONNECTION,
                  label: "Fetch model list",
                  effect: "read",
                  target: { source: "none" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              },
            });
          }
          if (slot === "testModel") {
            return Response.json({
              status: "ready",
              value: {
                test: {
                  kind: "action",
                  handlerRef: TEST_MODEL_CONNECTION,
                  label: "Test connection",
                  effect: "read",
                  target: { source: "none" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              },
            });
          }
          if (slot === "modelsList") {
            return Response.json({
              status: "ready",
              value: {
                deleteModel: {
                  kind: "action",
                  handlerRef: DELETE_MODEL_ENTRY,
                  label: "Delete",
                  effect: "write",
                  target: { source: "input", input: "target" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              },
            });
          }
          return Response.json({ status: "ready", value: {} });
        }
        if (slot === "connections") {
          return Response.json({
            status: "ready",
            value: [{
              primaryKey: "openai-main",
              label: "openai-main",
              subtitle: "OpenAI / OpenAI Compatible (Responses) · 1 models",
              fields: { provider: "openai", providerLabel: "OpenAI", apiBase: "https://api.openai.com/v1", modelCount: "1" },
            }],
          });
        }
        if (slot === "connectionHeader") {
          return Response.json({
            status: "ready",
            value: {
              primaryKey: "openai-main",
              label: "openai-main",
              subtitle: "OpenAI · 1 models",
              fields: {},
              outputs: { provider: "openai", supportsEmbeddings: true, modelCount: 1 },
            },
          });
        }
        if (slot === "connectionForm") {
          return Response.json({
            status: "ready",
            value: {
              values: { name: "openai-main", provider: "openai", apiBase: "https://api.openai.com/v1", apiKey: "", extraHeaders: [] },
              fields: [
                { path: "/name", label: "Connection name", required: true, readOnly: true, valueSchema: { type: "string" }, control: { kind: "text" } },
                { path: "/apiKey", label: "API key", required: false, readOnly: false, valueSchema: { type: "string" }, control: { kind: "text", secret: true } },
              ],
              errors: [],
              save: { method: "POST", path: "/api/data-query/model-settings/save", bodySchema: {} },
            },
          });
        }
        if (slot === "modelsList") {
          return Response.json({
            status: "ready",
            value: [{
              primaryKey: "gpt-4o",
              className: MODEL_ENTRY,
              label: "gpt-4o",
              fields: { upstreamModel: "gpt-4o", type: "chat", typeLabel: "Chat", specs: "262,144 ctx", defaultTag: "Default chat" },
            }],
            rowOperations: {
              [`${MODEL_ENTRY}:gpt-4o`]: {
                deleteModel: { available: true },
              },
            },
          });
        }
        if (slot === "usagesList") {
          return Response.json({ status: "empty" });
        }
        return Response.json({ status: "empty" });
      },
      readOperation(body) {
        readOps.push(body);
        if (String(body.operationId).endsWith(".test")) {
          return Response.json({ kind: "json", value: { type: "chat", content: "pong" } });
        }
        return Response.json({ kind: "json", value: { models: [{ id: "gpt-4o" }, { id: "gpt-4.1" }] } });
      },
    });

    await vi.waitFor(() => {
      const apiKeyInput = document.querySelector<HTMLInputElement>('[data-field="/apiKey"] input');
      expect(apiKeyInput?.type).toBe("password");
      expect(apiKeyInput?.value).toBe("");
    }, { timeout: 3000 });

    const testBtn = await vi.waitFor(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-local-action="test"]');
      expect(btn).not.toBeNull();
      return btn!;
    });
    testBtn.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".mc-test-status")?.textContent).toContain("pong");
    });
    expect(readOps.some((entry) => String(entry.operationId).endsWith(".test"))).toBe(true);

    const discoverBtn = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Fetch model list")!;
    discoverBtn.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("gpt-4.1");
    });
    expect(readOps.some((entry) => String(entry.operationId).endsWith(".discover"))).toBe(true);
  });

  it("mounts model-usage panel, shows domain defaults, vector rebuild banner/button from owner outputs, and agent usages", async () => {
    await openBuiltPanel(usageUse, builtUsage, {
      read(request) {
        const slot = request.memberPath.at(-1)!.member;
        if ("operations" in request && request.operations) {
          if (slot === "usageForm") {
            return Response.json({
              status: "ready",
              value: {
                save: {
                  kind: "form.save",
                  handlerRef: `${MODEL_USAGE}.save`,
                  label: "Save model usage",
                  effect: "write",
                  target: { source: "input", input: "target" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              },
            });
          }
          if (slot === "rebuildVectors") {
            return Response.json({
              status: "ready",
              value: {
                rebuildVectors: {
                  kind: "action",
                  handlerRef: REBUILD_VECTORS,
                  label: "Rebuild vectors",
                  effect: "write",
                  target: { source: "input", input: "target" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              },
            });
          }
          if (slot === "pauseVectorRebuild") {
            return Response.json({
              status: "ready",
              value: {
                pauseVectorRebuild: {
                  kind: "action",
                  handlerRef: PAUSE_VECTOR_REBUILD,
                  label: "Pause rebuild",
                  effect: "write",
                  target: { source: "input", input: "target" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              },
            });
          }
          return Response.json({ status: "ready", value: {} });
        }
        if (slot === "usageForm") {
          return Response.json({
            status: "ready",
            value: {
              values: { defaultModel: "gpt-4o", embeddingModel: "embed-3" },
              fields: [
                {
                  path: "/defaultModel",
                  label: "Domain default chat model",
                  required: false,
                  readOnly: false,
                  valueSchema: { type: "string" },
                  control: {
                    kind: "select",
                    options: [
                      { value: "", label: "No default", description: null, disabled: false, disabledReason: null },
                      { value: "gpt-4o", label: "gpt-4o", description: null, disabled: false, disabledReason: null },
                    ],
                  },
                },
                {
                  path: "/embeddingModel",
                  label: "Domain embedding model",
                  required: false,
                  readOnly: false,
                  valueSchema: { type: "string" },
                  control: {
                    kind: "select",
                    options: [
                      { value: "", label: "No embedding", description: null, disabled: false, disabledReason: null },
                      { value: "embed-3", label: "embed-3 · 1536 dim", description: null, disabled: false, disabledReason: null },
                    ],
                  },
                },
              ],
              errors: [],
              save: { method: "POST", path: "/api/data-query/model-settings/save", bodySchema: {} },
            },
          });
        }
        if (slot === "vectorStatus") {
          return Response.json({
            status: "ready",
            value: {
              primaryKey: "domain",
              label: "Rebuild needed",
              fields: {
                stateLabel: "Rebuild needed",
                progress: "0 / 10",
                message: "Embedding configuration changed; rebuild vectors (0/10).",
                tone: "warning",
              },
              outputs: {
                configured: true,
                state: "PENDING",
                tone: "warning",
                alive: false,
                canRebuild: true,
                canResume: false,
                canPause: false,
              },
            },
          });
        }
        if (slot === "agentUsages") {
          return Response.json({
            status: "ready",
            value: [{
              primaryKey: "agent-1",
              label: "Ontology QA",
              fields: { agent: "Ontology QA", model: "gpt-4o", status: "Configured" },
            }],
          });
        }
        return Response.json({ status: "empty" });
      },
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Embedding configuration changed; rebuild vectors (0/10).");
      expect(document.body.textContent).toContain("Ontology QA");
    }, { timeout: 3000 });
    const rebuildBtn = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Rebuild vectors");
    expect(rebuildBtn).toBeDefined();
  });
});
