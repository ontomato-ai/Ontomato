import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { PresentationFrame } from "@ontomato/contracts/agent-presentation";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { panelRowOperationKey } from "@ontomato/contracts/panel-projection";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import {
  DELETE_SKILL,
  EXPORT_SKILL,
  IMPORT_SKILL,
  SKILL,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { useConversationDisplay } from "../../../../../packages/agent-shell-ui/src/conversation-display";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import { clearPanelDefinitionCache } from "../../../../../packages/platform-web/src/panel-definition-cache";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import catalogSource from "../../../../../packages/ontology-manager/resources/builtin-panels/skills-library/panel.json";
import catalogHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/skills-library/panel.html?raw";
import catalogModule from "../../../../../packages/ontology-manager/resources/builtin-panels/skills-library/panel.mjs?raw";
import detailSource from "../../../../../packages/ontology-manager/resources/builtin-panels/skills-library-detail/panel.json";
import detailHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/skills-library-detail/panel.html?raw";
import detailModule from "../../../../../packages/ontology-manager/resources/builtin-panels/skills-library-detail/panel.mjs?raw";
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
const catalogUse = panelUse(
  "ontology-skills",
  "skills-library",
  "builtin-product-skills-library",
  "/ontology/skills",
);
const detailUse = panelUse(
  "ontology-skill-detail",
  "skills-library-detail",
  "builtin-product-skills-library-detail",
  "/ontology/skills/detail",
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

function buildPanel(
  panelId: string,
  name: string,
  source: { manifest: unknown; content: { messages: Record<string, Record<string, string>> } },
  html: string,
  module: string,
) {
  const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
  const members = Object.fromEntries(
    Object.entries(authoring).map(([memberName, definition]) => {
      if (!("component" in definition)) throw new Error(`Expected an authored projection for ${memberName}`);
      const { projection, placement } = expandPanelAuthoringMember(memberName, definition, {
        state: manifest.state,
        typeTable: { objectTypes: { [SKILL]: skillTypeEntry } },
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
        createdAt: "2026-11-24T00:00:00Z",
        updatedAt: "2026-11-24T00:00:00Z",
      });
      return [memberName, { ...placement, target: { projectionId: definition.id! } }];
    }),
  );
  return {
    ...panelRecord(panelId, name, definePanel({ ...manifest, members })),
    visibility: "platform" as const,
    domainId: null,
    ownerId: null,
    editable: false as const,
    content: { html, module, messages: source.content.messages },
  };
}

const catalogPanel = buildPanel(
  catalogUse.panelId,
  "Skill",
  catalogSource,
  catalogHtml,
  catalogModule,
);
const detailPanel = buildPanel(
  detailUse.panelId,
  "Skill Detail",
  detailSource,
  detailHtml,
  detailModule,
);

const panelsById = new Map([
  [catalogPanel.id, catalogPanel],
  [detailPanel.id, detailPanel],
]);
const allUses = [catalogUse, detailUse];

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

const importOpDescriptor = {
  kind: "action",
  handlerRef: IMPORT_SKILL,
  effect: "write",
  batch: false,
  label: "Import Skill",
  target: { source: "none" },
  inputSchema: {},
  resultSchema: {},
  upload: {
    input: "file",
    accept: [{ mime: "application/zip", extension: ".zip" }],
    maxBytes: 20 * 1024 * 1024,
  },
};

const exportOpDescriptor = {
  kind: "action",
  handlerRef: EXPORT_SKILL,
  effect: "read",
  batch: false,
  label: "Export",
  target: { source: "input", input: "skill" },
  inputSchema: {},
  resultSchema: {},
};

const deleteOpDescriptor = {
  kind: "action",
  handlerRef: DELETE_SKILL,
  effect: "write",
  batch: false,
  label: "Delete",
  target: { source: "input", input: "skill" },
  inputSchema: {},
  resultSchema: {},
};

const listOperations = {
  export: { ...exportOpDescriptor, target: { source: "row" } },
  remove: { ...deleteOpDescriptor, target: { source: "row" } },
};

function mountSkillsRoutes(options: {
  initialPath?: string;
  initialState?: Record<string, unknown>;
  onRead: (body: DataReadRequest) => Response | Promise<Response>;
  onOperations?: (body: OpsReadRequest) => Response | Promise<Response>;
  onOperate?: (request: Sent) => Response | Promise<Response>;
}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: catalogUse.path, component: PanelApplicationRoute, props: { applicationId: appId } },
      { path: detailUse.path, component: PanelApplicationRoute, props: { applicationId: appId } },
    ],
  });
  const sent = installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/ontology", renderer: "panels" }, panelUses: allUses },
      });
    }
    const panelMatch = /^\/api\/product-panels\/([^/]+)(\/snapshot)?$/.exec(path);
    if (panelMatch) {
      const panel = panelsById.get(panelMatch[1]!);
      if (panel) {
        return panelMatch[2]
          ? panelSnapshot(panel, Object.fromEntries(projections), request)
          : panelAnswer(panel, request);
      }
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
      && (path === "/api/panel-operations/uploads"
        || path === "/api/panel-operations/intents"
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
          panelUses: allUses,
        },
      ];
      const targetPath = options.initialPath ?? catalogUse.path;
      const manifest = targetPath === detailUse.path ? detailPanel.manifest : catalogPanel.manifest;
      await router.push(panelAddress(targetPath, options.initialState ?? {}, manifest));
      return mountPlatformPage(() => h(RouterView), router);
    },
  };
}

const waitFor = <T>(check: () => T | Promise<T>) => vi.waitFor(check, { timeout: 2500 });

afterEach(() => {
  leaveFrame();
  clearPanelDefinitionCache();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("skills-library two-entry builtin panels", () => {
  it("renders full-width card grid with search, diagnostics, per-card export/delete (including read-only reason), and card-click navigation to detail", async () => {
    const queryReads: Array<Record<string, unknown>> = [];
    const readOpCalls: unknown[] = [];
    const deleteIntents: unknown[] = [];
    const domainSkill = skillRow("domain-skill", "Domain Skill", "Reusable domain skill instructions", "Domain");
    const builtinSkill = skillRow("builtin-skill", "Built-in Skill", "Platform built-in guidance", "Built-in");
    let availableRows = [domainSkill, builtinSkill];

    const route = mountSkillsRoutes({
      initialPath: catalogUse.path,
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "list") {
          queryReads.push({ ...body.inputs, ...(body.runtimeParams ?? {}) });
          const search = String(body.inputs.search ?? body.runtimeParams?.search ?? "").trim().toLowerCase();
          const filtered = search
            ? availableRows.filter(
                (row) => row.label.toLowerCase().includes(search) || row.subtitle.toLowerCase().includes(search),
              )
            : availableRows;
          return Response.json({
            status: "ready",
            value: {
              rows: filtered,
              total: filtered.length,
              diagnostics: ["broken-skill · SKILL.md · Invalid frontmatter"],
            },
            rowOperations: {
              [panelRowOperationKey(domainSkill, SKILL)]: {
                export: { available: true },
                remove: { available: true },
              },
              [panelRowOperationKey(builtinSkill, SKILL)]: {
                export: { available: true },
                remove: { available: false, unavailable: { reason: "Built-in skills are read-only" } },
              },
            },
          });
        }
        if (member === "headerTitle" || member === "summary") {
          return Response.json({ status: "ready", value: domainSkill });
        }
        if (member === "tree") {
          return Response.json({
            status: "ready",
            value: [{ primaryKey: "SKILL.md", label: "SKILL.md", fieldLabels: { size: "Size" }, fields: { size: "12" } }],
          });
        }
        if (member === "content") {
          return Response.json({
            status: "ready",
            value: { primaryKey: "SKILL.md", label: "SKILL.md", fieldLabels: { content: "Content" }, fields: { content: "# Domain Skill" } },
          });
        }
        return Response.json({ status: "empty" });
      },
      onOperations(body) {
        const member = body.memberPath[0]?.member;
        if (member === "list") return Response.json({ status: "ready", value: listOperations });
        if (member === "exportSkill") return Response.json({ status: "ready", value: { export: exportOpDescriptor } });
        if (member === "remove") return Response.json({ status: "ready", value: { delete: deleteOpDescriptor } });
        return Response.json({ status: "ready", value: {} });
      },
      onOperate(request) {
        if (request.path === "/api/panel-operations/read") {
          readOpCalls.push(request.body);
          return new Response(new Uint8Array([0x50, 0x4b, 0x05, 0x06]), {
            status: 200,
            headers: {
              "content-type": "application/zip",
              "content-disposition": 'attachment; filename="domain-skill.zip"',
            },
          });
        }
        const intentId = "22222222-2222-4222-8222-222222222222";
        if (request.path === "/api/panel-operations/intents") {
          deleteIntents.push(request.body);
          return Response.json({ intentId, operationId: "list.remove", label: "Delete", confirmation: { kind: "none" } });
        }
        if (request.path === `/api/panel-operation-intents/${intentId}`) {
          return Response.json({ intentId, operationId: "list.remove", label: "Delete", confirmation: { kind: "none" } });
        }
        if (request.path === `/api/panel-operations/intents/${intentId}/dispatch`) {
          availableRows = [builtinSkill];
          return Response.json({
            kind: "dispatched",
            intentId,
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
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:card-export");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      savedDownloads.push(this.download);
    });

    const { app, element } = await route.open();
    try {
      await waitFor(() => {
        expect(element.querySelectorAll(".sdk-object-list-card").length).toBe(2);
      });

      // Diagnostics banner rendered by ObjectList.
      expect(element.querySelector(".sdk-object-list-diagnostics")?.textContent).toContain("broken-skill");

      // Cards render title, source badge, description, and per-card Export / Delete buttons.
      const cards = [...element.querySelectorAll<HTMLElement>(".sdk-object-list-card")];
      expect(cards[0]!.querySelector(".sdk-object-list-card-title")?.textContent?.trim()).toBe("Domain Skill");
      expect(cards[0]!.querySelector(".sdk-object-list-tag")?.textContent?.trim()).toBe("Domain");
      expect(cards[0]!.querySelector(".sdk-object-list-card-sub")?.textContent?.trim()).toBe("Reusable domain skill instructions");

      const domainButtons = [...cards[0]!.querySelectorAll<HTMLButtonElement>(".sdk-object-list-card-actions button")];
      expect(domainButtons.map((btn) => btn.textContent?.trim())).toEqual(["Export", "Delete"]);
      expect(domainButtons[1]!.classList.contains("is-danger")).toBe(true);
      expect(domainButtons[1]!.disabled).toBe(false);

      const builtinButtons = [...cards[1]!.querySelectorAll<HTMLButtonElement>(".sdk-object-list-card-actions button")];
      expect(builtinButtons[1]!.disabled).toBe(true);
      expect(builtinButtons[1]!.title).toBe("Built-in skills are read-only");

      // Clicking card Export runs list.export without navigating away from catalog.
      domainButtons[0]!.click();
      await waitFor(() => {
        expect(savedDownloads).toEqual(["domain-skill.zip"]);
      });
      expect(route.router.currentRoute.value.path).toBe("/ontology/skills");

      // Server search updates URL (`search` deepLink) and shows distinct no-match state when 0 results return.
      const searchInput = element.querySelector<HTMLInputElement>(".sdk-object-list-search");
      expect(searchInput).not.toBeNull();
      searchInput!.value = "nonexistent-keyword";
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor(() => {
        expect(route.router.currentRoute.value.query.search).toBe("nonexistent-keyword");
        expect(queryReads.some((entry) => entry.search === "nonexistent-keyword")).toBe(true);
        expect(element.querySelector(".sdk-object-list-card")).toBeNull();
        expect(element.textContent).toContain("No matching skills");
      });

      // Clear search restores both cards.
      searchInput!.value = "";
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor(() => {
        expect(element.querySelectorAll(".sdk-object-list-card").length).toBe(2);
      });

      // Clicking a card (outside action buttons) navigates to the full-width detail entry.
      const refreshedCard = element.querySelector<HTMLElement>(".sdk-object-list-card")!;
      refreshedCard.click();
      await waitFor(() => {
        expect(route.router.currentRoute.value.path).toBe("/ontology/skills/detail");
        expect(route.router.currentRoute.value.query.selected).toBe("domain-skill");
        expect(element.querySelector(".sdk-object-header-title")?.textContent?.trim()).toBe("Domain Skill");
      });

      // Clicking Back in detail <page-header> returns to /ontology/skills.
      const backButton = element.querySelector<HTMLButtonElement>(".sdk-page-header-back");
      expect(backButton).not.toBeNull();
      backButton!.click();
      await waitFor(() => {
        expect(route.router.currentRoute.value.path).toBe("/ontology/skills");
        expect(element.querySelectorAll(".sdk-object-list-card").length).toBe(2);
      });

      // Clicking card Delete dispatches list.remove and refreshes the catalog list.
      const firstDeleteBtn = element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-card-actions button")[1]!;
      firstDeleteBtn.click();
      await waitFor(() => {
        expect(deleteIntents.length).toBe(1);
        expect(element.querySelectorAll(".sdk-object-list-card").length).toBe(1);
      });
    } finally {
      app.unmount();
    }
  });

  it("opens centered ZIP import dialog (not deep-linked), handles SKILL_EXISTS overwrite confirmation, closes and refreshes catalog", async () => {
    const importInputs: Array<Record<string, unknown>> = [];
    let catalogReadCount = 0;
    let imported = false;

    const route = mountSkillsRoutes({
      initialPath: catalogUse.path,
      onRead(body) {
        if (body.memberPath[0]?.member === "list") {
          catalogReadCount += 1;
          const rows = imported
            ? [skillRow("new-skill", "New Skill", "Imported package", "Domain")]
            : [];
          return Response.json({ status: "ready", value: { rows, total: rows.length } });
        }
        return Response.json({ status: "empty" });
      },
      onOperations(body) {
        if (body.memberPath[0]?.member === "import") {
          return Response.json({ status: "ready", value: { import: importOpDescriptor } });
        }
        if (body.memberPath[0]?.member === "list") {
          return Response.json({ status: "ready", value: listOperations });
        }
        return Response.json({ status: "ready", value: {} });
      },
      onOperate(request) {
        if (request.path === "/api/panel-operations/uploads") {
          return Response.json({
            uploadId: "55555555-5555-4555-8555-555555555555",
            name: "new-skill.zip",
            size: 128,
            mime: "application/zip",
          });
        }
        if (request.path === "/api/panel-operations/intents") {
          const body = request.body as { call?: { input?: Record<string, unknown> } };
          const input = body.call?.input ?? {};
          importInputs.push(input);
          const intentId = input.overwrite
            ? "44444444-4444-4444-8444-444444444444"
            : "33333333-3333-4333-8333-333333333333";
          return Response.json({ intentId, operationId: "import.import", label: "Import Skill", confirmation: { kind: "none" } });
        }
        if (request.path === "/api/panel-operation-intents/33333333-3333-4333-8333-333333333333") {
          return Response.json({
            intentId: "33333333-3333-4333-8333-333333333333",
            operationId: "import.import",
            label: "Import Skill",
            confirmation: { kind: "none" },
          });
        }
        if (request.path === "/api/panel-operations/intents/33333333-3333-4333-8333-333333333333/dispatch") {
          return Response.json({
            kind: "dispatched",
            intentId: "33333333-3333-4333-8333-333333333333",
            outcome: {
              kind: "refusal",
              code: "SKILL_EXISTS",
              message: "Skill new-skill already exists",
            },
          });
        }
        if (request.path === "/api/panel-operation-intents/44444444-4444-4444-8444-444444444444") {
          return Response.json({
            intentId: "44444444-4444-4444-8444-444444444444",
            operationId: "import.import",
            label: "Import Skill",
            confirmation: { kind: "none" },
          });
        }
        if (request.path === "/api/panel-operations/intents/44444444-4444-4444-8444-444444444444/dispatch") {
          imported = true;
          return Response.json({
            kind: "dispatched",
            intentId: "44444444-4444-4444-8444-444444444444",
            outcome: {
              kind: "success",
              message: "Imported New Skill",
              data: { id: "new-skill", title: "New Skill" },
              affected: {
                objects: [{ objectType: SKILL, primaryKey: "new-skill" }],
                objectTypes: [SKILL],
              },
            },
          });
        }
        return nothingAt(request);
      },
    });

    const { app, element } = await route.open();
    try {
      await waitFor(() => {
        expect(element.textContent).toContain("No skills yet");
      });
      const initialReads = catalogReadCount;

      // Click page header primary Import button -> opens centered <sdk-dialog> without writing `importing` to URL.
      const importTrigger = [...element.querySelectorAll<HTMLButtonElement>(".sdk-page-header-actions button")]
        .find((button) => button.textContent?.includes("Import Skill"));
      expect(importTrigger).toBeDefined();
      importTrigger!.click();

      await waitFor(() => {
        const dialog = document.body.querySelector(".el-dialog");
        expect(dialog).not.toBeNull();
        expect(dialog!.textContent).toContain("SKILL.md");
        expect(document.body.querySelector(".sdk-file-upload-input")).not.toBeNull();
      });
      expect(route.router.currentRoute.value.query.importing).toBeUndefined();

      // Simulate human selecting a .zip file -> stages upload, hits SKILL_EXISTS, retries with overwrite: true, closes & refreshes.
      const fileInput = document.body.querySelector<HTMLInputElement>(".sdk-file-upload-input")!;
      const zipFile = new File([new Uint8Array([0x50, 0x4b, 0x05, 0x06])], "new-skill.zip", { type: "application/zip" });
      Object.defineProperty(fileInput, "files", { value: [zipFile], configurable: true });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));

      await waitFor(() => {
        expect(importInputs).toEqual([
          { file: { kind: "upload", uploadId: "55555555-5555-4555-8555-555555555555" } },
          { file: { kind: "upload", uploadId: "55555555-5555-4555-8555-555555555555" }, overwrite: true },
        ]);
        expect(catalogReadCount).toBeGreaterThan(initialReads);
        expect(element.querySelector(".sdk-object-list-card-title")?.textContent?.trim()).toBe("New Skill");
      });
    } finally {
      app.unmount();
    }
  });

  it("renders read-only detail page header (no save bar) with title, source badge, description, operations, and loads tree/content in parallel", async () => {
    const detailGate = deferred<Response>();
    const reads: DataReadRequest[] = [];

    const route = mountSkillsRoutes({
      initialPath: detailUse.path,
      initialState: { selected: skillRef("domain-skill") },
      onRead(body) {
        reads.push(body);
        const member = body.memberPath[0]?.member;
        if (member === "headerTitle") return detailGate.promise;
        if (member === "summary") {
          return Response.json({
            status: "ready",
            value: skillRow("domain-skill", "Domain Skill", "Reusable domain skill instructions", "Domain"),
          });
        }
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
        const member = body.memberPath[0]?.member;
        if (member === "exportSkill") return Response.json({ status: "ready", value: { export: exportOpDescriptor } });
        if (member === "remove") {
          return Response.json({
            status: "ready",
            value: {
              delete: { ...deleteOpDescriptor, unavailable: { reason: "Built-in skills are read-only" } },
            },
          });
        }
        return Response.json({ status: "ready", value: {} });
      },
    });

    const { app, element } = await route.open();
    try {
      // While headerTitle is still loading, tree is already requested in parallel (not gated on detailReady), and body stays hidden.
      await waitFor(() => {
        const summary = reads.map((r) => ({ member: r.memberPath[0]?.member, inputs: r.inputs }));
        expect(summary).toContainEqual(expect.objectContaining({ member: "headerTitle" }));
        expect(summary).toContainEqual(expect.objectContaining({ member: "tree" }));
      });
      const detailBody = element.querySelector<HTMLElement>(".skill-detail-body");
      expect(detailBody).not.toBeNull();
      expect(detailBody!.style.display).toBe("none");

      // Resolve headerTitle record -> header renders title, source badge, description, Export + disabled Delete with reason, no save bar, and default SKILL.md content loads.
      detailGate.resolve(
        Response.json({
          status: "ready",
          value: skillRow("domain-skill", "Domain Skill", "Reusable domain skill instructions", "Domain"),
        }),
      );

      await waitFor(() => {
        expect(element.querySelector(".sdk-object-header-title")?.textContent?.trim()).toBe("Domain Skill");
        expect(element.querySelector(".sdk-object-header-status")?.textContent?.trim()).toBe("Domain");
        expect(element.querySelector(".sdk-page-header-description")?.textContent?.trim()).toBe("Reusable domain skill instructions");
        expect(element.querySelector<HTMLElement>(".skill-detail-body")?.style.display).not.toBe("none");
        expect(element.querySelector(".sdk-operation-unavailable")?.textContent?.trim()).toBe("Built-in skills are read-only");
        expect(reads.some((r) => r.memberPath[0]?.member === "content" && r.inputs.path === "SKILL.md")).toBe(true);
      });

      expect(element.querySelector(".sdk-page-header-draft")).toBeNull();
      const headerButtons = [...element.querySelectorAll(".sdk-page-header-actions button")].map((btn) => btn.textContent?.trim());
      expect(headerButtons).toEqual(["Export", "Delete"]);
    } finally {
      app.unmount();
    }
  });

  it("keeps deep-linked filePath on initial load and renders forbidden and missing states in place on detail entry", async () => {
    const requestedPaths: unknown[] = [];

    const route = mountSkillsRoutes({
      initialPath: detailUse.path,
      initialState: { selected: skillRef("restricted-skill"), filePath: "references/guide.md" },
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "headerTitle") return Response.json({ status: "forbidden", reason: "No permission for this skill" });
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
      await waitFor(() => {
        const stateBox = element.querySelector(".skill-detail-state[role='alert']");
        expect(stateBox).not.toBeNull();
        expect(stateBox!.textContent).toContain("You do not have permission to view this skill.");
      });
      expect(element.querySelector<HTMLElement>(".skill-detail-body")?.style.display).toBe("none");
      expect(requestedPaths).toContain("references/guide.md");
      expect(requestedPaths).not.toContain("SKILL.md");
    } finally {
      app.unmount();
    }
  });

  it("preserves filePath on detail export and navigates back to /ontology/skills after detail delete", async () => {
    const dispatchedOperationIds: string[] = [];
    const readOperationIds: string[] = [];
    const route = mountSkillsRoutes({
      initialPath: detailUse.path,
      initialState: { selected: skillRef("domain-skill"), filePath: "references/guide.md" },
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "list") {
          return Response.json({ status: "ready", value: { rows: [], total: 0 } });
        }
        if (member === "headerTitle" || member === "summary") {
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
        const member = body.memberPath[0]?.member;
        if (member === "exportSkill") return Response.json({ status: "ready", value: { export: exportOpDescriptor } });
        if (member === "remove") return Response.json({ status: "ready", value: { delete: deleteOpDescriptor } });
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
            operationId: "remove.delete",
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
      await waitFor(() => {
        expect(element.querySelectorAll(".sdk-page-header-actions button").length).toBe(2);
      });

      // 1. Export downloads the ZIP and keeps filePath intact.
      const [exportButton, deleteButton] = [...element.querySelectorAll<HTMLButtonElement>(".sdk-page-header-actions button")];
      exportButton!.click();
      await waitFor(() => {
        expect(readOperationIds).toEqual(["exportSkill.export"]);
        expect(savedDownloads).toEqual(["domain-skill.zip"]);
      });
      expect(route.router.currentRoute.value.query.filePath).toBe("references/guide.md");
      expect(createObjectUrl).toHaveBeenCalled();

      // 2. Delete clears selection and navigates back to /ontology/skills.
      deleteButton!.click();
      await waitFor(() => {
        expect(dispatchedOperationIds).toEqual(["remove.delete"]);
        expect(route.router.currentRoute.value.path).toBe("/ontology/skills");
      });
    } finally {
      app.unmount();
    }
  });

  it("shows error state with retry in place on detail entry and recovers into the package view on retry", async () => {
    let headerReads = 0;
    const route = mountSkillsRoutes({
      initialPath: detailUse.path,
      initialState: { selected: skillRef("flaky-skill") },
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "headerTitle") {
          headerReads += 1;
          if (headerReads === 1) return Response.json({ status: "error", message: "Skill service unavailable" });
          return Response.json({
            status: "ready",
            value: skillRow("flaky-skill", "Recovered Skill", "Back online", "Domain"),
          });
        }
        if (member === "summary") {
          return Response.json({
            status: "ready",
            value: skillRow("flaky-skill", "Recovered Skill", "Back online", "Domain"),
          });
        }
        if (member === "tree") {
          return Response.json({
            status: "ready",
            value: [{ primaryKey: "SKILL.md", label: "SKILL.md", fieldLabels: { size: "Size" }, fields: { size: "10" } }],
          });
        }
        if (member === "content") {
          return Response.json({
            status: "ready",
            value: { primaryKey: "SKILL.md", label: "SKILL.md", fieldLabels: { content: "Content" }, fields: { content: "# OK" } },
          });
        }
        return Response.json({ status: "empty" });
      },
      onOperations(body) {
        const member = body.memberPath[0]?.member;
        if (member === "exportSkill") return Response.json({ status: "ready", value: { export: exportOpDescriptor } });
        if (member === "remove") return Response.json({ status: "ready", value: { delete: deleteOpDescriptor } });
        return Response.json({ status: "ready", value: {} });
      },
    });

    const { app, element } = await route.open();
    try {
      await waitFor(() => {
        const alert = element.querySelector(".skill-detail-state[role='alert']");
        expect(alert?.textContent).toContain("Skill service unavailable");
      });
      expect(element.querySelector<HTMLElement>(".skill-detail-body")?.style.display).toBe("none");

      const retryButton = [...element.querySelectorAll<HTMLButtonElement>(".skill-detail-state-actions button")]
        .find((button) => button.textContent?.trim() === "Retry");
      expect(retryButton).toBeDefined();
      retryButton!.click();

      await waitFor(() => {
        expect(element.querySelector(".sdk-object-header-title")?.textContent?.trim()).toBe("Recovered Skill");
        expect(element.querySelector<HTMLElement>(".skill-detail-body")?.style.display).not.toBe("none");
      });
    } finally {
      app.unmount();
    }
  });

  it("preserves explicit filePath across same-page present switches, handles missing filePath in place, selects SKILL.md or first file on plain switch, and renders Markdown frontmatter and read-only code", async () => {
    const SESSION = "11111111-1111-4111-8111-111111111111";
    const RUN = "22222222-2222-4222-8222-222222222222";
    const filesBySkill: Record<string, Record<string, string>> = {
      "skill-a": {
        "SKILL.md": "---\nname: skill-a\ndescription: Skill A\n---\n# Skill A Guide\n\nInstructions for A.",
        "references/readme.md": "# Skill A Reference\nFrom skill A.",
        "scripts/run.py": "def run_a():\n    return 'A'\n",
      },
      "skill-b": {
        "SKILL.md": "---\nname: skill-b\ndescription: Skill B\n---\n# Skill B Guide\n\nInstructions for B.",
        "references/readme.md": "# Skill B Reference\nFrom skill B.",
        "config.json": "{\n  \"enabled\": true\n}\n",
      },
      "skill-no-md": {
        "scripts/entry.py": "print('first in tree')\n",
        "zebra.txt": "plain file\n",
      },
    };
    const contentReads: Array<{ skill: string; path: unknown }> = [];
    const presentFrame = (state: Record<string, unknown>, address = detailUse.path): PresentationFrame => ({
      type: "presentation",
      sessionId: SESSION,
      runId: RUN,
      toolCallId: `call-${Math.random()}`,
      target: {
        kind: "page",
        address,
        state: state as PresentationFrame["target"] extends { state?: infer S } ? S : never,
      },
    });

    installPlatform((request: Sent) => {
      const { path } = request;
      if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
        return Response.json({
          data: { applicationId: appId, entry: { path: "/ontology", renderer: "panels" }, panelUses: allUses },
        });
      }
      const panelMatch = /^\/api\/product-panels\/([^/]+)(\/snapshot)?$/.exec(path);
      if (panelMatch) {
        const panel = panelsById.get(panelMatch[1]!);
        if (panel) {
          return panelMatch[2]
            ? panelSnapshot(panel, Object.fromEntries(projections), request)
            : panelAnswer(panel, request);
        }
      }
      if (path.startsWith("/api/product-projections/")) {
        return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
      }
      if (path === "/api/product-panels/read") {
        const body = request.body as ProductPanelReadRequest;
        if ("operations" in body) {
          const member = body.memberPath[0]?.member;
          if (member === "exportSkill") return Response.json({ status: "ready", value: { export: exportOpDescriptor } });
          if (member === "remove") return Response.json({ status: "ready", value: { delete: deleteOpDescriptor } });
          return Response.json({ status: "ready", value: {} });
        }
        const member = body.memberPath[0]?.member;
        const skillInput = Object.values(body.inputs).find(
          (value): value is { className?: string; primaryKey?: string } =>
            Boolean(value && typeof value === "object" && "primaryKey" in value),
        );
        const skillId = skillInput?.primaryKey ?? "";
        if (member === "headerTitle" || member === "summary") {
          return Response.json({ status: "ready", value: skillRow(skillId, `Title ${skillId}`, `Desc ${skillId}`, "Domain") });
        }
        if (member === "tree") {
          const entries = Object.keys(filesBySkill[skillId] ?? {});
          return Response.json({
            status: "ready",
            value: entries.map((entry) => ({
              primaryKey: entry,
              label: entry,
              fieldLabels: { size: "Size" },
              fields: { size: String(filesBySkill[skillId]![entry]!.length) },
            })),
          });
        }
        if (member === "content") {
          const requestedPath = body.inputs.path;
          contentReads.push({ skill: skillId, path: requestedPath });
          const text = typeof requestedPath === "string" ? filesBySkill[skillId]?.[requestedPath] : undefined;
          if (text === undefined) {
            return Response.json({ status: "error", message: `File not found: ${String(requestedPath)}` });
          }
          return Response.json({
            status: "ready",
            value: { primaryKey: requestedPath, label: requestedPath, fieldLabels: { content: "Content" }, fields: { content: text } },
          });
        }
        return Response.json({ status: "empty" });
      }
      return nothingAt(request);
    });

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
        panelUses: allUses,
      },
    ];

    type ObservedContext = { state?: Record<string, unknown> } | null;
    const observed = { context: null as ObservedContext };
    const display = useConversationDisplay({
      features: () => [{ id: "panel", label: "Skills", icon: "pages", availability: "page", withConversation: true }],
      resolve: (address) => (address.split("?")[0] === detailUse.path ? { featureId: "panel", address, instance: detailUse.path } : null),
      serialize: async () => true,
      context: (page, reported) => ({
        url: page.address,
        label: reported?.label || "Skills",
        selection: reported?.selection ?? [],
        ...(reported?.state ? { state: reported.state } : {}),
      }),
      leave: { leaves: () => false, confirm: async () => true },
    });
    display.placed(() => "side");

    const initialAddress = panelAddress(
      detailUse.path,
      { selected: skillRef("skill-a"), filePath: "references/readme.md" },
      detailPanel.manifest,
    );
    await display.present({
      type: "presentation",
      sessionId: SESSION,
      runId: RUN,
      toolCallId: "open-initial",
      target: { kind: "page", address: initialAddress },
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/chat", component: { template: "<div />" } }],
    });
    await router.push("/chat");

    const Host = defineComponent({
      setup() {
        return () =>
          display.page.value
            ? h(PanelApplicationRoute, {
                applicationId: appId,
                address: display.page.value.address,
                liveState: display.liveState.value,
                registerPageController: (controller: unknown) =>
                  display.registerPageController(display.page.value!.instance, controller as never),
                onDisplayAddress: display.address,
                onDisplayLoaded: display.loaded,
                onContext: (reported: ObservedContext) => {
                  observed.context = reported;
                  display.context(reported as never);
                },
              })
            : null;
      },
    });
    const { app, element } = mountPlatformPage(() => h(Host), router);
    try {
      // 1. Cold start on skill-a at references/readme.md explicitly.
      await waitFor(() => {
        expect(element.querySelector(".markdown-view")?.textContent).toContain("From skill A.");
      });
      expect(observed.context?.state?.filePath).toBe("references/readme.md");

      // 2. Atomic same-page present switching to skill-b with the same filename preserves references/readme.md.
      contentReads.length = 0;
      await display.present(
        presentFrame({ selected: skillRef("skill-b"), filePath: "references/readme.md" }, display.page.value!.address),
      );
      await waitFor(() => {
        expect(element.querySelector(".markdown-view")?.textContent).toContain("From skill B.");
      });
      expect(observed.context?.state?.filePath).toBe("references/readme.md");
      expect(contentReads.some((entry) => entry.skill === "skill-b" && entry.path === "SKILL.md")).toBe(false);

      // 3. Same-page present with a nonexistent filePath keeps filePath intact and shows DataState error in place.
      contentReads.length = 0;
      await display.present(
        presentFrame({ selected: skillRef("skill-b"), filePath: "references/missing.md" }, display.page.value!.address),
      );
      await waitFor(() => {
        const alert = element.querySelector(".package-viewer .fui-data-state-error [role='alert']");
        expect(alert?.textContent).toContain("File not found: references/missing.md");
      });
      expect(observed.context?.state?.filePath).toBe("references/missing.md");

      // 4. Switching skills without specifying filePath selects SKILL.md (with frontmatter + Markdown) when present.
      await display.present(presentFrame({ selected: skillRef("skill-a") }, display.page.value!.address));
      await waitFor(() => {
        expect(observed.context?.state?.filePath).toBe("SKILL.md");
        expect(element.querySelector(".sdk-object-text-reader-frontmatter")?.textContent).toContain("name: skill-a");
        expect(element.querySelector(".markdown-view")?.textContent).toContain("Skill A Guide");
      });

      // 5. Opening a code file (.json) renders the read-only CodeEditor.
      await display.present(
        presentFrame({ selected: skillRef("skill-b"), filePath: "config.json" }, display.page.value!.address),
      );
      await waitFor(() => {
        const editor = element.querySelector(".package-viewer .sdk-object-text-reader-code .cm-content");
        expect(editor).not.toBeNull();
        expect(editor?.textContent).toContain('"enabled": true');
        expect(editor?.getAttribute("contenteditable")).toBe("false");
      });

      // 6. Switching without filePath to a package lacking SKILL.md selects the first file in tree order (scripts/entry.py)
      //    and renders it as read-only code without ever requesting SKILL.md.
      contentReads.length = 0;
      await display.present(presentFrame({ selected: skillRef("skill-no-md") }, display.page.value!.address));
      await waitFor(() => {
        expect(observed.context?.state?.filePath).toBe("scripts/entry.py");
        const editor = element.querySelector(".package-viewer .sdk-object-text-reader-code .cm-content");
        expect(editor?.textContent).toContain("print('first in tree')");
      });
      expect(contentReads.some((entry) => entry.skill === "skill-no-md" && entry.path === "SKILL.md")).toBe(false);
    } finally {
      app.unmount();
    }
  });

  it("keeps a nonexistent cold-start deep-linked filePath intact and shows ObjectTextReader error in place on detail entry", async () => {
    const contentReads: unknown[] = [];
    const route = mountSkillsRoutes({
      initialPath: detailUse.path,
      initialState: { selected: skillRef("domain-skill"), filePath: "references/does-not-exist.md" },
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "headerTitle" || member === "summary") {
          return Response.json({ status: "ready", value: skillRow("domain-skill", "Domain Skill", "Desc", "Domain") });
        }
        if (member === "tree") {
          return Response.json({
            status: "ready",
            value: [
              { primaryKey: "SKILL.md", label: "SKILL.md", fieldLabels: { size: "Size" }, fields: { size: "42" } },
            ],
          });
        }
        if (member === "content") {
          contentReads.push(body.inputs.path);
          return Response.json({ status: "error", message: "Requested file does not exist" });
        }
        return Response.json({ status: "empty" });
      },
      onOperations(body) {
        const member = body.memberPath[0]?.member;
        if (member === "exportSkill") return Response.json({ status: "ready", value: { export: exportOpDescriptor } });
        if (member === "remove") return Response.json({ status: "ready", value: { delete: deleteOpDescriptor } });
        return Response.json({ status: "ready", value: {} });
      },
    });

    const { app, element } = await route.open();
    try {
      await waitFor(() => {
        const alert = element.querySelector(".package-viewer .fui-data-state-error [role='alert']");
        expect(alert?.textContent).toContain("Requested file does not exist");
      });
      expect(route.router.currentRoute.value.query.filePath).toBe("references/does-not-exist.md");
      expect(contentReads).toEqual(["references/does-not-exist.md"]);
    } finally {
      app.unmount();
    }
  });
});
