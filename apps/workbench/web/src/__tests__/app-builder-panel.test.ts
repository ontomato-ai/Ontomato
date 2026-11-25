import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import {
  AGENT_DEFINITION,
  AGENT_SESSION,
  APPLICATION,
  APPLICATION_CREATE_DRAFT,
  APPLICATION_DELETE_DRAFT,
  APPLICATION_PUBLISH_BUILDER_SOURCE,
  APPLICATION_RESTART_BUILD_TEST,
  APPLICATION_RESTORE_SOURCE_COMMIT,
  APPLICATION_ROLLBACK_BUILDER_RELEASE,
  APPLICATION_SYNC_BUILDER_SOURCE,
  APPLICATION_UPDATE_BUILDER_META,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/workbench-ui/resources/builtin-panels/app-builder/panel.json";
import html from "../../../../../packages/workbench-ui/resources/builtin-panels/app-builder/panel.html?raw";
import module from "../../../../../packages/workbench-ui/resources/builtin-panels/app-builder/panel.mjs?raw";
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

const APP_ID = "app-builder";
const ENTRY_PATH = "/app-builder";

const use = panelUse(
  "app-builder-main",
  "app-builder",
  "builtin-product-app-builder",
  ENTRY_PATH,
);

const applicationTypeEntry = platformTypeTableEntrySchema.parse({
  ...platformObjectTypes[APPLICATION],
  operations: [
    { id: APPLICATION_DELETE_DRAFT, kind: "action", effect: "write", batch: false, inputSchema: { type: "object" }, target: { source: "input", input: "target" } },
    { id: "applications.delete", kind: "action", effect: "write", batch: false, inputSchema: { type: "object" }, target: { source: "input", input: "target" } },
    { id: APPLICATION_SYNC_BUILDER_SOURCE, kind: "action", effect: "write", batch: false, inputSchema: { type: "object" }, target: { source: "input", input: "target" } },
    { id: APPLICATION_RESTART_BUILD_TEST, kind: "action", effect: "write", batch: false, inputSchema: { type: "object" }, target: { source: "input", input: "target" } },
    { id: APPLICATION_RESTORE_SOURCE_COMMIT, kind: "action", effect: "write", batch: false, inputSchema: { type: "object", properties: { commit: { type: "string" } } }, target: { source: "input", input: "target" } },
    { id: APPLICATION_CREATE_DRAFT, kind: "action", effect: "write", batch: false, inputSchema: { type: "object" }, target: { source: "none" } },
    { id: APPLICATION_UPDATE_BUILDER_META, kind: "action", effect: "write", batch: false, inputSchema: { type: "object" }, target: { source: "input", input: "target" } },
    { id: APPLICATION_PUBLISH_BUILDER_SOURCE, kind: "action", effect: "write", batch: false, inputSchema: { type: "object" }, target: { source: "input", input: "target" } },
    { id: APPLICATION_ROLLBACK_BUILDER_RELEASE, kind: "action", effect: "write", batch: false, inputSchema: { type: "object", properties: { releaseId: { type: "string" } } }, target: { source: "input", input: "target" } },
  ],
});

const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ports: { props: [], events: [], slots: [] },
  }),
);
const projections = new Map<string, ProductProjection>();
const members = Object.fromEntries(
  Object.entries(authoring).map(([name, definition]) => {
    if (!("component" in definition)) throw new Error(`Expected an authored projection for ${name}`);
    const { projection, placement } = expandPanelAuthoringMember(name, definition, {
      state: manifest.state,
      typeTable: {
        objectTypes: {
          [APPLICATION]: applicationTypeEntry,
          [AGENT_SESSION]: platformTypeTableEntrySchema.parse({ ...platformObjectTypes[AGENT_SESSION], operations: [] }),
          [AGENT_DEFINITION]: platformTypeTableEntrySchema.parse({ ...platformObjectTypes[AGENT_DEFINITION], operations: [] }),
        },
      },
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
      createdAt: "2026-11-25T00:00:00Z",
      updatedAt: "2026-11-25T00:00:00Z",
    });
    return [name, { ...placement, target: { projectionId: definition.id! } }];
  }),
);

const appBuilderPanel = {
  ...panelRecord(use.panelId, "App builder", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("builtin-product-app-builder three-column panel", () => {
  it("mounts without Vue warnings, renders left rail, AgentChat, AppPreview, tabs, and publish drawer", async () => {
    const vueWarnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      const msg = args.map(String).join(" ");
      if (msg.includes("[Vue warn]")) vueWarnings.push(msg);
    });

    const previewRequests: string[] = [];
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: use.path, component: { template: "<div />" } }],
    });

    installPlatform((request: Sent) => {
      const { path } = request;
      if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
        return Response.json({
          data: { applicationId: APP_ID, entry: { path: ENTRY_PATH, renderer: "panels" }, panelUses: [use] },
        });
      }
      if (path === `/api/product-panels/${appBuilderPanel.id}`) return panelAnswer(appBuilderPanel, request);
      if (path === `/api/product-panels/${appBuilderPanel.id}/snapshot`) {
        return panelSnapshot(appBuilderPanel, Object.fromEntries(projections), request);
      }
      if (path.startsWith("/api/product-projections/")) {
        return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
      }
      if (path.startsWith("/api/product-panels/preview/app/")) {
        previewRequests.push(path);
        return Response.json({ kind: "empty", appId: "app-orders" });
      }
      if (path === "/api/assistant/agents") {
        return Response.json({
          agents: [
            {
              id: "agent-app-builder",
              name: "App Builder",
              description: "Builds applications",
              icon: null,
              kind: "app-builder",
              enabled: true,
              workspaceBound: true,
            },
          ],
        });
      }
      if (path === "/api/assistant/sessions") {
        return Response.json({ sessions: [], hasMore: false, nextCursor: null });
      }
      if (path === "/api/product-panels/read") {
        const body = request.body as ProductPanelReadRequest;
        const member = body.memberPath[0]?.member;
        if ("operations" in body) {
          return Response.json({ status: "ready", value: {} });
        }
        if (member === "projects") {
          return Response.json({
            status: "ready",
            value: [
              {
                className: APPLICATION,
                primaryKey: "app-orders",
                label: "Orders Portal",
                fields: { icon: "package", statusTag: "Draft", published: false },
              },
            ],
          });
        }
        if (member === "project") {
          return Response.json({
            status: "ready",
            value: {
              className: APPLICATION,
              primaryKey: "app-orders",
              label: "Orders Portal",
              fields: {
                shortHeadCommit: "abc1234",
                busyLabel: "Idle",
                buildTestStatusLabel: "Ready",
                buildTestSampleName: "sample-orders.json",
              },
              outputs: {
                name: "Orders Portal",
                icon: "package",
                published: false,
                openPath: "",
                managePath: "",
                headCommit: "abc1234567890",
                busy: false,
                hasDrift: true,
                driftCount: 1,
                driftItemsJson: JSON.stringify([{ kind: "panel", id: "panel-orders", label: "Orders Panel", status: "modified" }]),
                hasConflicts: false,
                conflictCount: 0,
                conflictFilesJson: "[]",
                previewEntriesJson: JSON.stringify([{ id: "main", label: "Main" }]),
                buildTestStatus: "READY",
                buildTestSampleName: "sample-orders.json",
                buildTestCanRestart: true,
              },
            },
          });
        }
        if (member === "sourceFiles") {
          return Response.json({
            status: "ready",
            value: [
              {
                primaryKey: "application.json",
                label: "application.json",
                fields: { path: "application.json", size: 120, isText: true, language: "json" },
              },
            ],
          });
        }
        if (member === "sourceFile") {
          return Response.json({
            status: "ready",
            value: {
              primaryKey: "application.json",
              label: "application.json",
              fields: {
                path: "application.json",
                content: '{"id":"app-orders"}',
                language: "json",
                isText: true,
                nonTextNotice: "",
              },
            },
          });
        }
        if (member === "sourceDiff") {
          return Response.json({
            status: "ready",
            value: {
              className: APPLICATION,
              primaryKey: "app-orders",
              label: "Diff",
              fields: {
                content: "diff --git a/application.json b/application.json\n--- a/application.json\n+++ b/application.json\n@@ -1 +1 @@\n-old\n+new",
              },
            },
          });
        }
        if (member === "sourceCommits") {
          return Response.json({
            status: "ready",
            value: {
              rows: [
                {
                  className: APPLICATION,
                  primaryKey: "abc1234567890",
                  label: "Initial scaffold",
                  fields: {
                    id: "abc1234567890",
                    shortId: "abc1234",
                    message: "Initial scaffold",
                    createdAt: "2026-11-25T10:00:00Z",
                    isPublishable: true,
                    isHead: true,
                  },
                },
              ],
              hasMore: false,
              total: 1,
            },
          });
        }
        if (member === "releases") {
          return Response.json({ status: "ready", value: [] });
        }
        return Response.json({ status: "empty" });
      }
      return nothingAt(request);
    });

    useApplicationCatalog().applications.value = [
      {
        id: APP_ID,
        kind: "product",
        names: { en: "App builder" },
        descriptions: {},
        icon: "builder",
        rail: "apps",
        category: "build",
        sort: 0,
        entry: { path: ENTRY_PATH, renderer: "panels" },
        entryAccess: ["domain-member"],
        scheduleAdapter: null,
        releaseId: null,
        panelUses: [use],
      },
    ];

    await router.push(panelAddress(use.path, {}, appBuilderPanel.manifest));
    const Host = defineComponent({
      setup() {
        return () => h(PanelApplicationRoute, { applicationId: APP_ID });
      },
    });

    const mounted = mountPlatformPage(() => h(Host), router);
    await waitFor(() => mounted.element.querySelector(".ab-rail") !== null, "app-builder rail rendered");
    await waitFor(
      () => previewRequests.some((url) => url.includes("/api/product-panels/preview/app/app-orders")),
      "AppPreview queried preview descriptor for app-orders",
    );

    // Verify all three columns render, chat agent resolved, and carried context chip reflects active app.
    expect(mounted.element.querySelector(".ab-chat-col")).not.toBeNull();
    expect(mounted.element.querySelector(".ab-pane")).not.toBeNull();
    await waitFor(
      () => {
        const chatCol = mounted.element.querySelector(".ab-chat-col");
        return chatCol !== null && chatCol.querySelector("textarea") !== null;
      },
      "embedded AgentChat resolved app-builder preset and rendered composer",
    );
    expect(mounted.element.querySelector(".ab-chat-col")?.textContent ?? "").not.toContain("This agent is not available");
    await waitFor(
      () => (mounted.element.textContent ?? "").includes("Orders Portal"),
      "carried page chip shows Orders Portal",
    );

    // Switch right pane tabs to Files, Changes, and History, waiting for each tab's data read to settle.
    const tabs = Array.from(mounted.element.querySelectorAll<HTMLButtonElement>(".ab-tab"));
    expect(tabs.length).toBe(4);
    tabs[1]!.click();
    await waitFor(
      () => {
        const filesTab = mounted.element.querySelector(".ab-files-tab");
        return filesTab !== null && (filesTab.textContent ?? "").includes("application.json");
      },
      "Files tab rendered sourceFiles tree",
    );
    tabs[2]!.click();
    await waitFor(
      () => {
        const changesTab = mounted.element.querySelector(".ab-changes-tab");
        return changesTab !== null && (changesTab.textContent ?? "").includes("application.json");
      },
      "Changes tab rendered sourceDiff content",
    );
    tabs[3]!.click();
    await waitFor(
      () => {
        const historyTab = mounted.element.querySelector(".ab-history-tab");
        return historyTab !== null && (historyTab.textContent ?? "").includes("Initial scaffold");
      },
      "History tab rendered sourceCommits row",
    );

    // Toggle full pane and closed pane, then restore via composer context chip.
    const fullBtn = mounted.element.querySelector<HTMLButtonElement>(".ab-tool-btn[aria-label]");
    expect(fullBtn).not.toBeNull();
    const closeBtn = Array.from(mounted.element.querySelectorAll<HTMLButtonElement>(".ab-tool-btn")).at(-1)!;
    closeBtn.click();
    await waitFor(() => mounted.element.querySelector(".ab-pane") === null, "pane closed");
    await waitFor(() => mounted.element.querySelector(".ab-chip-btn") !== null, "expand chip rendered");
    const expandChip = mounted.element.querySelector<HTMLButtonElement>(".ab-chip-btn")!;
    expandChip.click();
    await waitFor(() => mounted.element.querySelector(".ab-pane") !== null, "pane re-expanded");

    // Open Publish Drawer and verify live-definition drift banner appears.
    const publishBtn = Array.from(mounted.element.querySelectorAll<HTMLButtonElement>(".ab-pane-tools button"))
      .find((btn) => (btn.textContent ?? "").includes("Publish"));
    expect(publishBtn).toBeDefined();
    publishBtn!.click();
    await waitFor(
      () => (document.body.textContent ?? "").includes("Orders Panel"),
      "Publish drawer renders drift item",
    );

    // Assert zero Vue undefined-property warnings occurred.
    expect(vueWarnings.filter((w) => w.includes("was accessed during render"))).toEqual([]);
  });

  it("reconciles a stale ?app= query to the first available project once projects load", async () => {
    const previewRequests: string[] = [];
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: use.path, component: { template: "<div />" } }],
    });

    installPlatform((request: Sent) => {
      const { path } = request;
      if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
        return Response.json({
          data: { applicationId: APP_ID, entry: { path: ENTRY_PATH, renderer: "panels" }, panelUses: [use] },
        });
      }
      if (path === `/api/product-panels/${appBuilderPanel.id}`) return panelAnswer(appBuilderPanel, request);
      if (path === `/api/product-panels/${appBuilderPanel.id}/snapshot`) {
        return panelSnapshot(appBuilderPanel, Object.fromEntries(projections), request);
      }
      if (path.startsWith("/api/product-projections/")) {
        return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
      }
      if (path.startsWith("/api/product-panels/preview/app/")) {
        previewRequests.push(path);
        return Response.json({ kind: "empty", appId: path.split("/").at(-1) });
      }
      if (path === "/api/assistant/agents") {
        return Response.json({
          agents: [
            {
              id: "agent-app-builder",
              name: "App Builder",
              description: "Builds applications",
              icon: null,
              kind: "app-builder",
              enabled: true,
              workspaceBound: true,
            },
          ],
        });
      }
      if (path === "/api/assistant/sessions") {
        return Response.json({ sessions: [], hasMore: false, nextCursor: null });
      }
      if (path === "/api/product-panels/read") {
        const body = request.body as ProductPanelReadRequest;
        const member = body.memberPath[0]?.member;
        if ("operations" in body) return Response.json({ status: "ready", value: {} });
        if (member === "projects") {
          return Response.json({
            status: "ready",
            value: [
              {
                className: APPLICATION,
                primaryKey: "app-orders",
                label: "Orders Portal",
                fields: { icon: "package", statusTag: "Draft", published: false },
              },
            ],
          });
        }
        if (member === "project") {
          const targetKey = (body.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey;
          if (targetKey !== "app-orders") {
            return Response.json({ status: "error", message: "Application not found" });
          }
          return Response.json({
            status: "ready",
            value: {
              className: APPLICATION,
              primaryKey: "app-orders",
              label: "Orders Portal",
              fields: { shortHeadCommit: "abc1234", busyLabel: "Idle", buildTestStatusLabel: "Ready", buildTestSampleName: "" },
              outputs: {
                name: "Orders Portal",
                icon: "package",
                published: false,
                openPath: "",
                managePath: "",
                headCommit: "abc1234567890",
                busy: false,
                hasDrift: false,
                driftCount: 0,
                driftItemsJson: "[]",
                hasConflicts: false,
                conflictCount: 0,
                conflictFilesJson: "[]",
                previewEntriesJson: "[]",
                buildTestStatus: "NONE",
                buildTestSampleName: "",
                buildTestCanRestart: false,
              },
            },
          });
        }
        if (member === "sessions" || member === "releases" || member === "sourceFiles") {
          return Response.json({ status: "ready", value: [] });
        }
        return Response.json({ status: "ready", value: { primaryKey: "app-orders", label: "Orders Portal", fields: {} } });
      }
      return nothingAt(request);
    });

    const catalog = useApplicationCatalog();
    catalog.applications.value = [
      {
        id: APP_ID,
        kind: "product",
        names: { en: "App builder" },
        descriptions: {},
        icon: "builder",
        rail: "apps",
        category: "build",
        sort: 0,
        entry: { path: ENTRY_PATH, renderer: "panels" },
        entryAccess: ["domain-member"],
        scheduleAdapter: null,
        releaseId: null,
        panelUses: [use],
      },
    ];

    await router.push(
      panelAddress(use.path, { app: { className: APPLICATION, primaryKey: "app-deleted-stale" } }, appBuilderPanel.manifest),
    );
    const Host = defineComponent({
      setup() {
        return () => h(PanelApplicationRoute, { applicationId: APP_ID });
      },
    });
    const mounted = mountPlatformPage(() => h(Host), router);
    await waitFor(
      () => previewRequests.some((url) => url.includes("/api/product-panels/preview/app/app-orders")),
      "stale app state reconciled to first available project app-orders",
    );
    expect(mounted.element.textContent ?? "").toContain("Orders Portal");
  });
});
