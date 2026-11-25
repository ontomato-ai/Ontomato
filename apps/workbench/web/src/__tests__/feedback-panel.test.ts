import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { PageActionOutcome, PageActionRequestInput } from "@ontomato/contracts/agent-presentation";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { EXPORT_FEEDBACK, FEEDBACK_RECORD, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/platform-admin/resources/builtin-panels/feedback/panel.json";
import html from "../../../../../packages/platform-admin/resources/builtin-panels/feedback/panel.html?raw";
import module from "../../../../../packages/platform-admin/resources/builtin-panels/feedback/panel.mjs?raw";
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

const APP_ID = "admin";
const ENTRY_PATH = "/admin/feedback";
const AGENT_RUN = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  toolCallId: "tool-call-feedback-1",
};

const use = panelUse(
  "admin-feedback",
  "feedback",
  "builtin-product-admin-feedback",
  ENTRY_PATH,
);

const feedbackTypeEntry = platformTypeTableEntrySchema.parse({
  ...platformObjectTypes[FEEDBACK_RECORD],
  operations: [
    {
      id: EXPORT_FEEDBACK,
      kind: "action",
      effect: "read",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "none" },
    },
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
      typeTable: { objectTypes: { [FEEDBACK_RECORD]: feedbackTypeEntry } },
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
      createdAt: "2026-11-24T00:00:00Z",
      updatedAt: "2026-11-24T00:00:00Z",
    });
    return [name, { ...placement, target: { projectionId: definition.id! } }];
  }),
);

const feedbackPanel = {
  ...panelRecord(use.panelId, "Feedback", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

interface PageControllerHandle {
  executeAction?: (request: PageActionRequestInput) => Promise<PageActionOutcome>;
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
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

describe("feedback builtin panel export operation", () => {
  it("dispatches exportCsv.export on human click without self-blocking on busy, and also supports agent action", async () => {
    const readOperations: Array<{ operationId: string; input: Record<string, unknown> }> = [];
    let exportOpsRead = false;
    let controller: PageControllerHandle | null = null;
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: use.path, component: { template: "<div />" } }],
    });

    let createdBlobUrls = 0;
    const downloadedNames: string[] = [];
    const createObjectUrl = vi.fn(() => {
      createdBlobUrls += 1;
      return "blob:http://localhost/feedback-test";
    });
    Object.defineProperty(URL, "createObjectURL", { value: createObjectUrl, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadedNames.push(this.download);
    });

    installPlatform((request: Sent) => {
      const { path } = request;
      if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
        return Response.json({
          data: { applicationId: APP_ID, entry: { path: "/admin", renderer: "panels" }, panelUses: [use] },
        });
      }
      if (path === `/api/product-panels/${feedbackPanel.id}`) return panelAnswer(feedbackPanel, request);
      if (path === `/api/product-panels/${feedbackPanel.id}/snapshot`) {
        return panelSnapshot(feedbackPanel, Object.fromEntries(projections), request);
      }
      if (path.startsWith("/api/product-projections/")) {
        return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
      }
      if (path === "/api/panel-operations/read") {
        const body = request.body as { operationId: string; input?: Record<string, unknown> };
        readOperations.push({ operationId: body.operationId, input: body.input ?? {} });
        return new Response("id,rating\nfb-1,up\n", {
          status: 200,
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": 'attachment; filename="feedback.csv"',
          },
        });
      }
      if (path === "/api/product-panels/read") {
        const body = request.body as ProductPanelReadRequest;
        const member = body.memberPath[0]?.member;
        if ("operations" in body) {
          if (member === "exportCsv") {
            exportOpsRead = true;
            return Response.json({
              status: "ready",
              value: {
                export: {
                  kind: "action",
                  handlerRef: EXPORT_FEEDBACK,
                  label: "Export CSV",
                  effect: "read",
                  target: { source: "none" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              },
            });
          }
          return Response.json({ status: "ready", value: {} });
        }
        if (member === "source" || member === "rating") {
          return Response.json({ status: "ready", value: [{ key: "all", label: "All", count: 1 }] });
        }
        if (member === "list") {
          return Response.json({
            status: "ready",
            value: {
              rows: [{ className: FEEDBACK_RECORD, primaryKey: "fb-1", label: "Feedback 1", fields: { userInput: "Great" } }],
              total: 1,
            },
          });
        }
        return Response.json({ status: "empty" });
      }
      return nothingAt(request);
    });

    useApplicationCatalog().applications.value = [
      {
        id: APP_ID,
        kind: "product",
        names: { en: "Admin" },
        descriptions: {},
        icon: "admin",
        rail: "apps",
        category: "admin",
        sort: 0,
        entry: { path: "/admin", renderer: "panels" },
        scheduleAdapter: null,
        releaseId: null,
        panelUses: [use],
      },
    ];
    await router.push(panelAddress(use.path, {}, feedbackPanel.manifest));
    const Host = defineComponent({
      setup() {
        return () =>
          h(PanelApplicationRoute, {
            applicationId: APP_ID,
            registerPageController(next: PageControllerHandle) {
              controller = next;
              return () => {
                if (controller === next) controller = null;
              };
            },
          });
      },
    });
    const mounted = await mountPlatformPage(() => h(Host), router);
    try {
      const exportBtn = () =>
        Array.from(mounted.element.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
          b.textContent?.includes("Export CSV"),
        );
      await waitFor(
        () => Boolean(exportBtn() && !exportBtn()!.disabled && controller !== null && exportOpsRead),
        "Export CSV button ready",
      );
      await new Promise((resolve) => setTimeout(resolve, 30));

      exportBtn()!.click();
      await waitFor(
        () =>
          readOperations.length === 1
          && readOperations[0]?.operationId === "exportCsv.export"
          && createdBlobUrls === 1
          && Boolean(exportBtn() && !exportBtn()!.disabled),
        "human click on Export CSV dispatches exportCsv.export, saves CSV, and settles",
      );

      const agentResult = await controller!.executeAction!({
        operation: "exportCsv.export",
        agentRun: AGENT_RUN,
      });
      expect(agentResult).toMatchObject({ ok: true, kind: "executed", operation: "exportCsv.export" });
      expect(readOperations).toHaveLength(2);
      expect(createdBlobUrls).toBe(2);
      expect(downloadedNames).toEqual(["feedback.csv", "feedback.csv"]);
    } finally {
      mounted.app.unmount();
    }
  });
});
