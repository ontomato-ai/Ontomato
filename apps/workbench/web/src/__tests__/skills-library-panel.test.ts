import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { DELETE_SKILL, EXPORT_SKILL, IMPORT_SKILL, SKILL, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/skills-library/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/skills-library/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/skills-library/panel.mjs?raw";
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

const appId = "ontology";
const use = panelUse(
  "ontology-skills",
  "skills-library",
  "builtin-product-skills-library",
  "/ontology/skills",
);

const skillTypeEntry = platformTypeTableEntrySchema.parse({
  ...platformObjectTypes[SKILL],
  operations: [
    {
      id: IMPORT_SKILL,
      kind: "action",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "none" },
      upload: {
        input: "file",
        accept: [{ mime: "application/zip", extension: ".zip" }],
        maxBytes: 20 * 1024 * 1024,
      },
    },
    {
      id: EXPORT_SKILL,
      kind: "action",
      effect: "read",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "input", input: "skill" },
    },
    {
      id: DELETE_SKILL,
      kind: "action",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "input", input: "skill" },
    },
  ],
});

const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "FileUploadControl" || component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation local name" }] }
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
      typeTable: { objectTypes: { [SKILL]: skillTypeEntry } },
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

const skillsPanel = {
  ...panelRecord(use.panelId, "Skill", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

const skillRef = (primaryKey: string) => ({ className: SKILL, primaryKey });

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

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;
type OpsReadRequest = Extract<ProductPanelReadRequest, { operations: true }>;

function skillRow(id: string, title: string, description: string, sourceLabel: string) {
  return {
    primaryKey: id,
    label: title,
    subtitle: description,
    fieldLabels: { description: "Description", source: "Source", writeRestriction: "Write access" },
    fields: { description, source: sourceLabel, writeRestriction: "" },
  };
}

function mountSkillsRoute(options: {
  initialState?: Record<string, unknown>;
  onRead: (body: DataReadRequest) => Response | Promise<Response>;
  onOperations?: (body: OpsReadRequest) => Response | Promise<Response>;
  onOperate?: (request: Sent) => Response | Promise<Response>;
}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: use.path, component: PanelApplicationRoute, props: { applicationId: appId } }],
  });
  const sent = installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (path === `/api/product-panels/${skillsPanel.id}`) return panelAnswer(skillsPanel, request);
    if (path === `/api/product-panels/${skillsPanel.id}/snapshot`) {
      return panelSnapshot(skillsPanel, Object.fromEntries(projections), request);
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      if ("operations" in body) {
        return options.onOperations
          ? options.onOperations(body)
          : Response.json({ status: "ready", value: {} });
      }
      return options.onRead(body);
    }
    if (
      options.onOperate
      && (path === "/api/panel-operations/intents"
        || path === "/api/panel-operations/read"
        || /^\/api\/panel-operation-intents\/[^/]+$/.test(path)
        || /^\/api\/panel-operations\/intents\/[^/]+\/dispatch$/.test(path))
    ) {
      return options.onOperate(request);
    }
    return nothingAt(request);
  }, router);

  return {
    router,
    sent,
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
      await router.push(panelAddress(use.path, options.initialState ?? {}, skillsPanel.manifest));
      return mountPlatformPage(() => h(RouterView), router);
    },
  };
}

const detailOperations = {
  export: {
    kind: "action",
    handlerRef: EXPORT_SKILL,
    effect: "read",
    batch: false,
    label: "Export",
    target: { source: "input", input: "skill" },
    inputSchema: {},
    resultSchema: {},
  },
  remove: {
    kind: "action",
    handlerRef: DELETE_SKILL,
    effect: "write",
    batch: false,
    label: "Delete",
    target: { source: "input", input: "skill" },
    inputSchema: {},
    resultSchema: {},
  },
};

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("skills-library builtin panel", () => {
  it("renders ObjectHeader title, source badge, description, and operations without usePanelData, and loads tree/content in parallel", async () => {
    const detailGate = deferred<Response>();
    const reads: DataReadRequest[] = [];

    const route = mountSkillsRoute({
      initialState: { selected: skillRef("domain-skill") },
      onRead(body) {
        reads.push(body);
        const member = body.memberPath[0]?.member;
        if (member === "list") {
          return Response.json({
            status: "ready",
            value: {
              rows: [skillRow("domain-skill", "Domain Skill", "Reusable domain skill instructions", "Domain")],
              total: 1,
            },
          });
        }
        if (member === "detail") return detailGate.promise;
        if (member === "tree") {
          return Response.json({
            status: "ready",
            value: [
              { primaryKey: "SKILL.md", label: "SKILL.md", fieldLabels: { size: "Size" }, fields: { size: "42" } },
              { primaryKey: "references/guide.md", label: "references/guide.md", fieldLabels: { size: "Size" }, fields: { size: "12" } },
            ],
          });
        }
        if (member === "content") {
          return Response.json({
            status: "ready",
            value: { primaryKey: "SKILL.md", label: "SKILL.md", fieldLabels: { content: "Content" }, fields: { content: "# Domain Skill\n" } },
          });
        }
        return Response.json({ status: "empty" });
      },
      onOperations(body) {
        if (body.memberPath[0]?.member === "detail") {
          return Response.json({ status: "ready", value: detailOperations });
        }
        return Response.json({ status: "ready", value: {} });
      },
    });

    const { app, element } = await route.open();
    try {
      // While detail is still loading, tree and content already requested SKILL.md in parallel, and .package stays hidden.
      await vi.waitFor(() => {
        expect(reads.some((r) => r.memberPath[0]?.member === "tree")).toBe(true);
        expect(reads.some((r) => r.memberPath[0]?.member === "content" && r.inputs.path === "SKILL.md")).toBe(true);
      });
      const pkg = element.querySelector<HTMLElement>(".package");
      expect(pkg).not.toBeNull();
      expect(pkg!.style.display).toBe("none");
      expect(element.querySelector(".detail-head")?.classList.contains("is-ready")).toBe(false);

      // Resolve detail record -> ObjectHeader renders title, source badge, description, and inline operations; .package becomes visible.
      detailGate.resolve(
        Response.json({
          status: "ready",
          value: skillRow("domain-skill", "Domain Skill", "Reusable domain skill instructions", "Domain"),
        }),
      );

      await vi.waitFor(() => {
        expect(element.querySelector(".sdk-object-header-title")?.textContent?.trim()).toBe("Domain Skill");
        expect(element.querySelector(".sdk-object-header-status")?.textContent?.trim()).toBe("Domain");
        expect(element.querySelector(".sdk-object-header-subtitle")?.textContent?.trim()).toBe("Reusable domain skill instructions");
        expect(element.querySelector(".detail-head")?.classList.contains("is-ready")).toBe(true);
        expect(element.querySelector<HTMLElement>(".package")?.style.display).not.toBe("none");
      });

      const headerButtons = [...element.querySelectorAll(".sdk-object-header-actions button")].map((btn) => btn.textContent?.trim());
      expect(headerButtons).toEqual(["Export", "Delete"]);
    } finally {
      app.unmount();
    }
  });

  it("keeps deep-linked filePath on initial load and shows ObjectHeader DataState when detail is forbidden", async () => {
    const requestedPaths: unknown[] = [];

    const route = mountSkillsRoute({
      initialState: { selected: skillRef("restricted-skill"), filePath: "references/guide.md" },
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "list") return Response.json({ status: "ready", value: { rows: [], total: 0 } });
        if (member === "detail") return Response.json({ status: "forbidden", reason: "No permission for this skill" });
        if (member === "tree") return Response.json({ status: "ready", value: [] });
        if (member === "content") {
          requestedPaths.push(body.inputs.path);
          return Response.json({ status: "empty" });
        }
        return Response.json({ status: "empty" });
      },
    });

    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        const forbidden = element.querySelector(".fui-data-state-forbidden");
        expect(forbidden).not.toBeNull();
        expect(forbidden!.textContent).toContain("No permission for this skill");
      });
      expect(element.querySelector(".detail-head")?.classList.contains("is-ready")).toBe(false);
      expect(element.querySelector<HTMLElement>(".package")?.style.display).toBe("none");
      expect(requestedPaths).toContain("references/guide.md");
      expect(requestedPaths).not.toContain("SKILL.md");
    } finally {
      app.unmount();
    }
  });

  it("preserves filePath on detail.export and clears selected and filePath on detail.remove via ObjectHeader", async () => {
    const dispatchedOperationIds: string[] = [];
    const readOperationIds: string[] = [];
    const route = mountSkillsRoute({
      initialState: { selected: skillRef("domain-skill"), filePath: "references/guide.md" },
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "list") {
          return Response.json({
            status: "ready",
            value: {
              rows: [skillRow("domain-skill", "Domain Skill", "Reusable domain skill", "Domain")],
              total: 1,
            },
          });
        }
        if (member === "detail") {
          return Response.json({
            status: "ready",
            value: skillRow("domain-skill", "Domain Skill", "Reusable domain skill", "Domain"),
          });
        }
        if (member === "tree") {
          return Response.json({
            status: "ready",
            value: [
              { primaryKey: "SKILL.md", label: "SKILL.md", fieldLabels: { size: "Size" }, fields: { size: "10" } },
              { primaryKey: "references/guide.md", label: "references/guide.md", fieldLabels: { size: "Size" }, fields: { size: "20" } },
            ],
          });
        }
        if (member === "content") {
          return Response.json({
            status: "ready",
            value: { primaryKey: "references/guide.md", label: "references/guide.md", fieldLabels: { content: "Content" }, fields: { content: "# Guide" } },
          });
        }
        return Response.json({ status: "empty" });
      },
      onOperations(body) {
        if (body.memberPath[0]?.member === "detail") {
          return Response.json({ status: "ready", value: detailOperations });
        }
        return Response.json({ status: "ready", value: {} });
      },
      onOperate(request) {
        if (request.path === "/api/panel-operations/read") {
          const body = request.body as { operationId: string };
          readOperationIds.push(body.operationId);
          return new Response(new Uint8Array([0x50, 0x4b, 0x05, 0x06]), {
            status: 200,
            headers: {
              "content-type": "application/zip",
              "content-disposition": 'attachment; filename="domain-skill.zip"',
            },
          });
        }
        const deleteIntentId = "11111111-1111-4111-8111-111111111111";
        if (request.path === "/api/panel-operations/intents") {
          const body = request.body as { operationId: string };
          dispatchedOperationIds.push(body.operationId);
          return Response.json({
            intentId: deleteIntentId,
            operationId: body.operationId,
            label: "Delete",
            confirmation: { kind: "none" },
          });
        }
        if (request.path === `/api/panel-operation-intents/${deleteIntentId}`) {
          return Response.json({
            intentId: deleteIntentId,
            operationId: "detail.remove",
            label: "Delete",
            confirmation: { kind: "none" },
          });
        }
        if (request.path === `/api/panel-operations/intents/${deleteIntentId}/dispatch`) {
          return Response.json({
            kind: "dispatched",
            intentId: deleteIntentId,
            outcome: {
              kind: "success",
              message: "Deleted Domain Skill",
              data: {},
              affected: {
                objects: [{ objectType: SKILL, primaryKey: "domain-skill" }],
                objectTypes: [SKILL],
                removed: [{ objectType: SKILL, primaryKey: "domain-skill" }],
              },
            },
          });
        }
        return nothingAt(request);
      },
    });

    const savedDownloads: string[] = [];
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:skills-export");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      savedDownloads.push(this.download);
    });

    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelectorAll(".sdk-object-header-actions button").length).toBe(2);
      });

      // 1. Export via detail.export downloads the ZIP and must not clear filePath.
      const [exportButton, deleteButton] = [...element.querySelectorAll<HTMLButtonElement>(".sdk-object-header-actions button")];
      exportButton!.click();
      await vi.waitFor(() => {
        expect(readOperationIds).toEqual(["detail.export"]);
        expect(savedDownloads).toEqual(["domain-skill.zip"]);
      });
      expect(route.router.currentRoute.value.query.filePath).toBe("references/guide.md");
      expect(createObjectUrl).toHaveBeenCalled();

      // 2. Delete via detail.remove clears selected and filePath.
      deleteButton!.click();
      await vi.waitFor(() => {
        expect(dispatchedOperationIds).toEqual(["detail.remove"]);
        expect(element.querySelector(".skills-hint")).not.toBeNull();
        expect(route.router.currentRoute.value.query.selected).toBeUndefined();
        expect(route.router.currentRoute.value.query.filePath).toBeUndefined();
      });
    } finally {
      app.unmount();
    }
  });

  it("shows ObjectHeader DataState error with retry and keeps package hidden when detail fails", async () => {
    let attempts = 0;
    const route = mountSkillsRoute({
      initialState: { selected: skillRef("broken-skill") },
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "list") return Response.json({ status: "ready", value: { rows: [], total: 0 } });
        if (member === "detail") {
          attempts += 1;
          if (attempts === 1) return Response.json({ status: "error", message: "Skill service unavailable" });
          return Response.json({
            status: "ready",
            value: skillRow("broken-skill", "Recovered Skill", "Loaded after retry", "Domain"),
          });
        }
        if (member === "tree") return Response.json({ status: "ready", value: [] });
        return Response.json({ status: "empty" });
      },
      onOperations(body) {
        if (body.memberPath[0]?.member === "detail") {
          return Response.json({ status: "ready", value: detailOperations });
        }
        return Response.json({ status: "ready", value: {} });
      },
    });

    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        const alert = element.querySelector(".fui-data-state-error [role='alert']");
        expect(alert?.textContent).toContain("Skill service unavailable");
      });
      expect(element.querySelector(".detail-head")?.classList.contains("is-ready")).toBe(false);
      expect(element.querySelector<HTMLElement>(".package")?.style.display).toBe("none");

      const retryButton = element.querySelector<HTMLButtonElement>(".fui-data-state-error button");
      expect(retryButton).not.toBeNull();
      retryButton!.click();

      await vi.waitFor(() => {
        expect(element.querySelector(".sdk-object-header-title")?.textContent?.trim()).toBe("Recovered Skill");
        expect(element.querySelector(".detail-head")?.classList.contains("is-ready")).toBe(true);
        expect(element.querySelector<HTMLElement>(".package")?.style.display).not.toBe("none");
      });
    } finally {
      app.unmount();
    }
  });
});
