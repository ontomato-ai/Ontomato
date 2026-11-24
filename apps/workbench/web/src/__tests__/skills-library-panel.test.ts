import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { PresentationFrame } from "@ontomato/contracts/agent-presentation";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { DELETE_SKILL, EXPORT_SKILL, IMPORT_SKILL, SKILL, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { useConversationDisplay } from "../../../../../packages/agent-shell-ui/src/conversation-display";
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

  it("preserves explicit filePath across same-page present switches (including shared filenames), handles missing filePath in place, selects SKILL.md or first file on plain switch, and renders Markdown frontmatter and read-only code", async () => {
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
    const presentFrame = (state: Record<string, unknown>, address = use.path): PresentationFrame => ({
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
          return Response.json({ status: "ready", value: body.memberPath[0]?.member === "detail" ? detailOperations : {} });
        }
        const member = body.memberPath[0]?.member;
        const skillInput = Object.values(body.inputs).find(
          (value): value is { className?: string; primaryKey?: string } =>
            Boolean(value && typeof value === "object" && "primaryKey" in value),
        );
        const skillId = skillInput?.primaryKey ?? "";
        if (member === "list") {
          return Response.json({
            status: "ready",
            value: {
              rows: [
                skillRow("skill-a", "Skill A", "First skill", "Domain"),
                skillRow("skill-b", "Skill B", "Second skill", "Domain"),
                skillRow("skill-no-md", "Skill No MD", "Package without SKILL.md", "Domain"),
              ],
              total: 3,
            },
          });
        }
        if (member === "detail") {
          return Response.json({ status: "ready", value: skillRow(skillId, `Title ${skillId}`, `Desc ${skillId}`, "Domain") });
        }
        if (member === "tree") {
          const entries = Object.keys(filesBySkill[skillId] ?? {});
          return Response.json({
            status: "ready",
            value: entries.map((entry) => ({ primaryKey: entry, label: entry, fieldLabels: { size: "Size" }, fields: { size: "10" } })),
          });
        }
        if (member === "content") {
          const requestedPath = String(body.inputs.path ?? "");
          contentReads.push({ skill: skillId, path: requestedPath });
          const text = filesBySkill[skillId]?.[requestedPath];
          if (text === undefined) {
            return Response.json({ status: "error", message: `File not found: ${requestedPath}` });
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
        panelUses: [use],
      },
    ];

    type ObservedContext = { state?: Record<string, unknown> } | null;
    const observed = { context: null as ObservedContext };
    const display = useConversationDisplay({
      features: () => [{ id: "panel", label: "Skills", icon: "pages", availability: "page", withConversation: true }],
      resolve: (address) => (address.split("?")[0] === use.path ? { featureId: "panel", address, instance: use.path } : null),
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
      use.path,
      { selected: skillRef("skill-a"), filePath: "references/readme.md" },
      skillsPanel.manifest,
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
      // 1. Cold start on skill-a with references/readme.md keeps that file and renders Markdown.
      await vi.waitFor(() => {
        expect(element.querySelector(".markdown-view")?.textContent).toContain("From skill A.");
      });
      expect(observed.context?.state?.filePath).toBe("references/readme.md");

      // 2. Same-page present({ selected: skill-b, filePath: "references/readme.md" }) (same filename across skills)
      //    keeps references/readme.md and NEVER resets to SKILL.md.
      contentReads.length = 0;
      await display.present(
        presentFrame({ selected: skillRef("skill-b"), filePath: "references/readme.md" }, display.page.value!.address),
      );
      await vi.waitFor(() => {
        expect(element.querySelector(".markdown-view")?.textContent).toContain("From skill B.");
      });
      expect(observed.context?.state?.filePath).toBe("references/readme.md");
      expect(contentReads.some((entry) => entry.skill === "skill-b" && entry.path === "SKILL.md")).toBe(false);

      // 3. Same-page present with a nonexistent filePath keeps filePath intact and shows DataState error in place.
      contentReads.length = 0;
      await display.present(
        presentFrame({ selected: skillRef("skill-b"), filePath: "references/missing.md" }, display.page.value!.address),
      );
      await vi.waitFor(() => {
        const alert = element.querySelector(".package-viewer .fui-data-state-error [role='alert']");
        expect(alert?.textContent).toContain("File not found: references/missing.md");
      });
      expect(observed.context?.state?.filePath).toBe("references/missing.md");

      // 4. Switching skills without specifying filePath selects SKILL.md (with frontmatter + Markdown) when present.
      await display.present(presentFrame({ selected: skillRef("skill-a") }, display.page.value!.address));
      await vi.waitFor(() => {
        expect(observed.context?.state?.filePath).toBe("SKILL.md");
        expect(element.querySelector(".sdk-object-text-reader-frontmatter")?.textContent).toContain("name: skill-a");
        expect(element.querySelector(".markdown-view")?.textContent).toContain("Skill A Guide");
      });

      // 5. Opening a code file (.py / .json) renders the read-only CodeEditor.
      await display.present(
        presentFrame({ selected: skillRef("skill-b"), filePath: "config.json" }, display.page.value!.address),
      );
      await vi.waitFor(() => {
        const editor = element.querySelector(".package-viewer .sdk-object-text-reader-code .cm-content");
        expect(editor).not.toBeNull();
        expect(editor?.textContent).toContain('"enabled": true');
        expect(editor?.getAttribute("contenteditable")).toBe("false");
      });

      // 6. Switching without filePath to a package lacking SKILL.md selects the first file in tree order (scripts/entry.py)
      //    and renders it as read-only code without ever requesting SKILL.md.
      contentReads.length = 0;
      await display.present(presentFrame({ selected: skillRef("skill-no-md") }, display.page.value!.address));
      await vi.waitFor(() => {
        expect(observed.context?.state?.filePath).toBe("scripts/entry.py");
        const editor = element.querySelector(".package-viewer .sdk-object-text-reader-code .cm-content");
        expect(editor?.textContent).toContain("print('first in tree')");
      });
      expect(contentReads.some((entry) => entry.skill === "skill-no-md" && entry.path === "SKILL.md")).toBe(false);
    } finally {
      app.unmount();
    }
  });

  it("keeps a nonexistent cold-start deep-linked filePath intact and shows ObjectTextReader error in place", async () => {
    const contentReads: unknown[] = [];
    const route = mountSkillsRoute({
      initialState: { selected: skillRef("domain-skill"), filePath: "references/does-not-exist.md" },
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "list") {
          return Response.json({
            status: "ready",
            value: { rows: [skillRow("domain-skill", "Domain Skill", "Desc", "Domain")], total: 1 },
          });
        }
        if (member === "detail") {
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
        return Response.json({ status: "ready", value: body.memberPath[0]?.member === "detail" ? detailOperations : {} });
      },
    });

    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
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
