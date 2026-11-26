import { afterEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { SDK_COMPONENT, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/sdk-components/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/sdk-components/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/sdk-components/panel.mjs?raw";
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

const APP_ID = "ontology";
const ENTRY_PATH = "/ontology/components";

const use = panelUse(
  "ontology-components",
  "ontology-components",
  "builtin-product-sdk-components",
  ENTRY_PATH,
);

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({ ...entry, operations: [] }),
  ]),
);

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
      typeTable: { objectTypes },
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

const sdkComponentsPanel = {
  ...panelRecord(use.panelId, "Base components", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

const LONG_LIST_MEANING = "Lists objects as a table, cards, or list rows, supporting server-side search, filtering, grouping, and row actions across large catalogues.";

const sampleCatalogue = [
  {
    primaryKey: "@ontomato/sdk:ObjectList",
    className: SDK_COMPONENT,
    label: "ObjectList",
    searchText: LONG_LIST_MEANING,
    fields: {
      package: "@ontomato/sdk",
      role: "Control",
      panelUsable: "Panel-usable",
      group: "Lists",
    },
    tags: { bindsElement: ["PlatformObjectType:*", "ObjectType:*"] },
    tones: { role: "info", panelUsable: "success" },
    fieldLabels: {
      package: "SDK package",
      role: "Role",
      panelUsable: "Availability",
      group: "Purpose group",
      bindsElement: "Applicable object types",
    },
  },
  {
    primaryKey: "@ontomato/sdk:ObjectSummary",
    className: SDK_COMPONENT,
    label: "ObjectSummary",
    searchText: "Displays structured fields for one selected object.",
    fields: {
      package: "@ontomato/sdk",
      role: "Presentation",
      panelUsable: "Panel-usable",
      group: "Details",
    },
    tags: { bindsElement: ["PlatformObjectType:*", "ObjectType:*"] },
    tones: { role: "default", panelUsable: "success" },
    fieldLabels: {
      package: "SDK package",
      role: "Role",
      panelUsable: "Availability",
      group: "Purpose group",
      bindsElement: "Applicable object types",
    },
  },
  {
    primaryKey: "@ontomato/sdk:MarkdownView",
    className: SDK_COMPONENT,
    label: "MarkdownView",
    searchText: "Renders markdown content in light or dark theme.",
    fields: {
      package: "@ontomato/sdk",
      role: "Presentation",
      panelUsable: "Panel-usable",
      group: "Content",
    },
    tones: { role: "default", panelUsable: "success" },
    fieldLabels: {
      package: "SDK package",
      role: "Role",
      panelUsable: "Availability",
      group: "Purpose group",
      bindsElement: "Applicable object types",
    },
  },
];

const sampleRecords: Record<string, Record<string, unknown>> = {
  "@ontomato/sdk:ObjectList": {
    primaryKey: "@ontomato/sdk:ObjectList",
    className: SDK_COMPONENT,
    label: "ObjectList",
    subtitle: "@ontomato/sdk",
    fields: {
      componentId: "ObjectList",
      package: "@ontomato/sdk",
      module: "@ontomato/sdk/base",
      exportName: "ObjectList",
      role: "Control",
      group: "Lists",
      panelUsable: "Panel-usable",
      meaning: LONG_LIST_MEANING,
      effects: "Emits row selection events.",
    },
    tags: { bindsElement: ["PlatformObjectType:*", "ObjectType:*"] },
    tones: { role: "info", panelUsable: "success" },
    fieldLabels: {
      componentId: "Component ID",
      package: "SDK package",
      module: "Module",
      exportName: "Export name",
      role: "Role",
      group: "Purpose group",
      panelUsable: "Availability",
      bindsElement: "Applicable object types",
      meaning: "Purpose",
      effects: "Effects",
    },
  },
  "@ontomato/sdk:ObjectSummary": {
    primaryKey: "@ontomato/sdk:ObjectSummary",
    className: SDK_COMPONENT,
    label: "ObjectSummary",
    subtitle: "@ontomato/sdk",
    fields: {
      componentId: "ObjectSummary",
      package: "@ontomato/sdk",
      module: "@ontomato/sdk/base",
      exportName: "ObjectSummary",
      role: "Presentation",
      group: "Details",
      panelUsable: "Panel-usable",
      meaning: "Displays structured fields for one selected object.",
    },
    tags: { bindsElement: ["PlatformObjectType:*", "ObjectType:*"] },
    tones: { role: "default", panelUsable: "success" },
    fieldLabels: {
      componentId: "Component ID",
      package: "SDK package",
      module: "Module",
      exportName: "Export name",
      role: "Role",
      group: "Purpose group",
      panelUsable: "Availability",
      bindsElement: "Applicable object types",
      meaning: "Purpose",
      effects: "Effects",
    },
  },
};

const sampleDataRows = [
  {
    primaryKey: "rows",
    label: "rows",
    fields: { required: "Yes" },
    tags: { results: ["panelRecordList"], runtimeParams: ["search"] },
    tones: { required: "warning" },
  },
];

const sampleConfigRows = [
  {
    primaryKey: "layout",
    label: "layout",
    fields: {
      type: "\"list\" | \"table\" | \"cards\"",
      required: "No",
      defaultValue: "\"list\"",
      description: "Visual layout mode.",
    },
    tones: { required: "default" },
  },
];

const sampleInputRows = [
  {
    primaryKey: "slot:empty",
    label: "#empty",
    fields: { kind: "Slot", type: "slot", description: "Custom empty content." },
    tones: { kind: "default" },
  },
];

const sampleOutputRows = [
  {
    primaryKey: "readOnlyOutput:filteredCount",
    label: "filteredCount",
    fields: { kind: "Read-only output", type: "number", description: "Filtered row count." },
    tones: { kind: "info" },
  },
];

function mountComponentsRoute(initialState: Record<string, unknown> = {}) {
  const reads: ProductPanelReadRequest[] = [];
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: ENTRY_PATH,
        component: PanelApplicationRoute,
        props: { applicationId: APP_ID },
      },
      {
        path: "/ontology/assets/capability-map",
        component: { render: () => h("div", "capability-map") },
      },
    ],
  });

  installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
      return Response.json({
        data: { applicationId: APP_ID, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (path === `/api/product-panels/${sdkComponentsPanel.id}`) return panelAnswer(sdkComponentsPanel, request);
    if (path === `/api/product-panels/${sdkComponentsPanel.id}/snapshot`) {
      return panelSnapshot(sdkComponentsPanel, Object.fromEntries(projections), request);
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      reads.push(body);
      if ("operations" in body) return Response.json({ status: "ready", value: {} });
      const member = body.memberPath[0]?.member;
      if (member === "list" && body.dataName === "rows") {
        const term = String(body.inputs?.search ?? "").trim().toLowerCase();
        const rows = sampleCatalogue
          .filter((item) =>
            !term
            || [
              item.primaryKey,
              item.label,
              item.fields.package,
              item.fields.role,
              item.fields.panelUsable,
              item.fields.group,
              ...(item.tags?.bindsElement ?? []),
              item.searchText,
            ].some((text) => text.toLowerCase().includes(term)),
          )
          .map(({ searchText: _searchText, ...row }) => row);
        return Response.json(rows.length ? { status: "ready", value: rows } : { status: "empty" });
      }
      const targetKey = (body.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey ?? "";
      const record = sampleRecords[targetKey];
      if (!record) {
        return Response.json({
          status: "error",
          message: `SDK component '${targetKey}' is not in the current release.`,
        });
      }
      if ((member === "header" || member === "summary" || member === "meaningCard") && body.dataName === "record") {
        return Response.json({ status: "ready", value: record });
      }
      if (member === "dataTable" && body.dataName === "rows") {
        return Response.json({ status: "ready", value: sampleDataRows });
      }
      if (member === "configTable" && body.dataName === "rows") {
        return Response.json({ status: "ready", value: sampleConfigRows });
      }
      if (member === "inputTable" && body.dataName === "rows") {
        return Response.json({ status: "ready", value: sampleInputRows });
      }
      if (member === "outputTable" && body.dataName === "rows") {
        return Response.json({ status: "ready", value: sampleOutputRows });
      }
      if (member === "operationTable" && body.dataName === "rows") {
        return Response.json({ status: "empty" });
      }
      return Response.json({ status: "empty" });
    }
    return nothingAt(request);
  }, router);

  return {
    router,
    reads,
    async open() {
      useApplicationCatalog().applications.value = [
        {
          id: APP_ID,
          kind: "product",
          names: { en: "Ontology" },
          descriptions: {},
          icon: "ontology",
          rail: "apps",
          category: "build",
          sort: 0,
          entry: { path: "/ontology", renderer: "panels" },
          scheduleAdapter: null,
          releaseId: null,
          panelUses: [use],
        },
      ];
      await router.push(panelAddress(ENTRY_PATH, initialState, sdkComponentsPanel.manifest));
      await router.isReady();
      // Mount inside a scrollable host container matching the platform shell's main pane.
      const scrollHost = document.createElement("div");
      scrollHost.style.overflowY = "auto";
      Object.defineProperty(scrollHost, "scrollHeight", { value: 1200, configurable: true });
      Object.defineProperty(scrollHost, "clientHeight", { value: 400, configurable: true });
      document.body.appendChild(scrollHost);

      const mounted = mountPlatformPage(() => h(RouterView), router);
      scrollHost.appendChild(mounted.element);
      return {
        ...mounted,
        scrollHost,
        cleanup() {
          mounted.app.unmount();
          scrollHost.remove();
        },
      };
    },
  };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
});

describe("sdk-components builtin panel", () => {
  it("renders a grouped 5-column catalog without meaning, filters via search, and shows full meaning in detail", async () => {
    const route = mountComponentsRoute();
    const { element, cleanup } = await route.open();
    try {
      await vi.waitFor(() => {
        const rows = element.querySelectorAll('.sdk-table-host tbody tr[data-row-item="true"]');
        expect(rows.length).toBe(3);
      }, { timeout: 5000 });

      // Full-width catalog table headers, purpose group headers, and no redundant group dropdown filter.
      const headers = Array.from(element.querySelectorAll(".sdk-table-host thead th")).map((th) => th.textContent?.trim());
      expect(headers.slice(0, 5)).toEqual(["Component", "Role", "Availability", "Applicable types", "Package"]);
      expect(element.querySelector(".sdk-group-filter")).toBeNull();
      const groupLabels = Array.from(element.querySelectorAll(".sdk-table-host .sdk-object-list-group-label")).map((el) => el.textContent?.trim());
      expect(groupLabels).toEqual(["Lists", "Details", "Content"]);
      expect(element.querySelector(".sdk-count")?.textContent?.trim()).toBe("3 items");
      expect(element.querySelector(".sdk-detail-view")).toBeNull();

      // Meaning text is kept out of the first-screen catalog; tags render for applicable types and dash for UI-only rows.
      expect(element.querySelector(".sdk-table-host")?.textContent).not.toContain(LONG_LIST_MEANING);
      const rows = Array.from(element.querySelectorAll<HTMLElement>('.sdk-table-host tbody tr[data-row-item="true"]'));
      expect(rows[0]!.textContent).toContain("Control");
      expect(rows[0]!.textContent).toContain("Panel-usable");
      expect(rows[0]!.textContent).toContain("PlatformObjectType:*");
      expect(rows[2]!.querySelector("td:nth-child(4)")?.textContent?.trim()).toBe("—");

      // Typing in the search input updates deep-linked search state and narrows rows.
      const searchInput = element.querySelector<HTMLInputElement>(".sdk-search input")!;
      expect(searchInput).not.toBeNull();
      searchInput.value = "Object";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      await nextTick();

      await vi.waitFor(() => {
        expect(element.querySelectorAll('.sdk-table-host tbody tr[data-row-item="true"]').length).toBe(2);
        expect(element.querySelector(".sdk-count")?.textContent?.trim()).toBe("2 items");
      });
      expect(route.router.currentRoute.value.query.search).toBe("Object");

      // Clicking a row shows the full meaning in the first card, then purpose group and availability in basic information.
      element.querySelector<HTMLElement>('.sdk-table-host tbody tr[data-row-item="true"]')!.click();
      await vi.waitFor(() => {
        const cards = Array.from(element.querySelectorAll(".sdk-detail-card"));
        expect(cards[0]?.querySelector(".sdk-section-group-title")?.textContent?.trim()).toBe("Meaning");
        expect(cards[1]?.querySelector(".sdk-section-group-title")?.textContent?.trim()).toBe("Basic information");
        expect(cards[0]?.textContent).toContain(LONG_LIST_MEANING);
        expect(cards[1]?.textContent).not.toContain(LONG_LIST_MEANING);
        expect(element.querySelector(".sdk-detail-body")?.textContent).toContain("Lists");
        expect(element.querySelector(".sdk-detail-body")?.textContent).toContain("Panel-usable");
      });

      // Returning preserves search; unmatched search shows empty no-match description and 0 items cleanly.
      element.querySelector<HTMLButtonElement>(".sdk-detail-view .sdk-page-header-back")!.click();
      await vi.waitFor(() => {
        expect(element.querySelector(".sdk-detail-view")).toBeNull();
        expect(element.querySelectorAll('.sdk-table-host tbody tr[data-row-item="true"]').length).toBe(2);
      });

      searchInput.value = "does-not-match-anything";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      await nextTick();

      await vi.waitFor(() => {
        expect(element.querySelector(".sdk-table-host")?.textContent).toContain("No matching base components");
        expect(element.querySelector(".sdk-count")?.textContent?.trim()).toBe("0 items");
      });
    } finally {
      cleanup();
    }
  });

  it("opens full-width detail on row click, keeps search intact, and restores search and scroll position on back", async () => {
    const route = mountComponentsRoute({ search: "Object" });
    const { element, scrollHost, cleanup } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelectorAll('.sdk-table-host tbody tr[data-row-item="true"]').length).toBe(2);
      });

      // Simulate scrolling down in the catalog before opening a component.
      scrollHost.scrollTop = 240;

      const firstRow = element.querySelector<HTMLElement>('.sdk-table-host tbody tr[data-row-item="true"]')!;
      firstRow.click();

      // Detail view mounts with ObjectHeader (name, role badge, package), the meaning card, summary, and all five detail tables.
      await vi.waitFor(() => {
        expect(element.querySelector(".sdk-detail-view")).not.toBeNull();
        expect(element.querySelector(".sdk-detail-body")).not.toBeNull();
        expect(element.querySelectorAll(".sdk-detail-card").length).toBe(7);
        expect(element.querySelector(".sdk-detail-body")?.textContent).toContain(LONG_LIST_MEANING);
        expect(element.querySelector(".sdk-detail-body")?.textContent).toContain("panelRecordList");
        expect(element.querySelector(".sdk-detail-body")?.textContent).toContain("filteredCount");
      });

      // Catalog stays mounted (v-show hidden) while detail is visible, and scroll resets to top.
      const catalogView = element.querySelector<HTMLElement>(".sdk-catalog-view")!;
      expect(catalogView.style.display).toBe("none");
      expect(scrollHost.scrollTop).toBe(0);

      // URL keeps both search and selected; detail header preserves name, package, role, and class link action.
      expect(route.router.currentRoute.value.query.search).toBe("Object");
      expect(route.router.currentRoute.value.query.selected).toBe("@ontomato/sdk:ObjectList");
      const detailHeader = element.querySelector(".sdk-detail-view .sdk-page-header")!;
      expect(detailHeader.textContent).toContain("ObjectList");
      expect(detailHeader.textContent).toContain("Control");
      expect(detailHeader.textContent).toContain("@ontomato/sdk");
      expect(detailHeader.querySelector('[data-panel-action="open-component-class"]')).not.toBeNull();
      expect(element.querySelector(".sdk-detail-body")?.textContent).toContain(LONG_LIST_MEANING);
      expect(element.querySelector(".sdk-detail-body")?.textContent).toContain("panelRecordList");
      expect(element.querySelector(".sdk-detail-body")?.textContent).toContain("filteredCount");

      // Click Back: clears selected, preserves search and filtered rows, and restores scrollTop.
      const backButton = element.querySelector<HTMLButtonElement>(".sdk-detail-view .sdk-page-header-back")!;
      expect(backButton).not.toBeNull();
      backButton.click();

      await vi.waitFor(() => {
        expect(element.querySelector(".sdk-detail-view")).toBeNull();
        expect(catalogView.style.display).not.toBe("none");
        expect(scrollHost.scrollTop).toBe(240);
      });
      expect(route.router.currentRoute.value.query.selected).toBeUndefined();
      expect(route.router.currentRoute.value.query.search).toBe("Object");
      expect(element.querySelector<HTMLInputElement>(".sdk-search input")?.value).toBe("Object");
      expect(element.querySelectorAll('.sdk-table-host tbody tr[data-row-item="true"]').length).toBe(2);

      // Clicking the same row again still enters detail cleanly (no stale selected state blocking re-open).
      element.querySelector<HTMLElement>('.sdk-table-host tbody tr[data-row-item="true"]')!.click();
      await vi.waitFor(() => {
        expect(element.querySelector(".sdk-detail-body")).not.toBeNull();
        expect(route.router.currentRoute.value.query.selected).toBe("@ontomato/sdk:ObjectList");
      });

      // Pressing Escape also invokes usePanelBack to return to the catalog while keeping search and restoring scroll.
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await vi.waitFor(() => {
        expect(element.querySelector(".sdk-detail-view")).toBeNull();
        expect(catalogView.style.display).not.toBe("none");
        expect(scrollHost.scrollTop).toBe(240);
      });
      expect(route.router.currentRoute.value.query.selected).toBeUndefined();
      expect(route.router.currentRoute.value.query.search).toBe("Object");

      // Re-open once more and verify "View its class" navigates to capability map type view for platform:SDKComponent.
      element.querySelector<HTMLElement>('.sdk-table-host tbody tr[data-row-item="true"]')!.click();
      await vi.waitFor(() => {
        expect(element.querySelector('[data-panel-action="open-component-class"]')).not.toBeNull();
      });
      element.querySelector<HTMLButtonElement>('[data-panel-action="open-component-class"]')!.click();
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.path).toBe("/ontology/assets/capability-map");
        expect(route.router.currentRoute.value.query).toEqual({
          mode: "type",
          selectedType: SDK_COMPONENT,
        });
      });
    } finally {
      cleanup();
    }
  });

  it("opens full-width detail directly when deep-linked with an existing selected component", async () => {
    const route = mountComponentsRoute({ selected: "@ontomato/sdk:ObjectSummary" });
    const { element, cleanup } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelector(".sdk-detail-body")).not.toBeNull();
        expect(element.querySelectorAll(".sdk-detail-card").length).toBe(7);
        expect(element.querySelector(".sdk-detail-body")?.textContent).toContain("Displays structured fields for one selected object.");
      });

      const catalogView = element.querySelector<HTMLElement>(".sdk-catalog-view")!;
      expect(catalogView.style.display).toBe("none");
      expect(element.querySelector(".sdk-detail-view .sdk-page-header")?.textContent).toContain("ObjectSummary");
    } finally {
      cleanup();
    }
  });

  it("shows a single in-place explanation for a missing deep-linked component without mounting the five tables and allows returning to the catalog", async () => {
    const route = mountComponentsRoute({ selected: "@ontomato/sdk:DoesNotExist" });
    const { element, cleanup } = await route.open();
    try {
      await vi.waitFor(() => {
        const missing = element.querySelector(".sdk-detail-missing");
        expect(missing).not.toBeNull();
        expect(missing!.textContent).toContain("SDK component '@ontomato/sdk:DoesNotExist' is not in the current release.");
      });

      // Fallback title shows the missing ID; ObjectHeader is hidden so no duplicate DataState error box is visible.
      expect(element.querySelector(".sdk-detail-title-fallback")?.textContent?.trim()).toBe("@ontomato/sdk:DoesNotExist");
      const headerWrap = element.querySelector<HTMLElement>(".sdk-detail-title-wrap")!;
      expect(headerWrap.style.display).toBe("none");

      // Summary and all five detail tables are NOT mounted and NEVER queried.
      expect(element.querySelector(".sdk-detail-body")).toBeNull();
      const queriedDetailMembers = route.reads
        .map((r) => r.memberPath[0]?.member)
        .filter((member) => ["summary", "dataTable", "configTable", "inputTable", "outputTable", "operationTable"].includes(member ?? ""));
      expect(queriedDetailMembers).toEqual([]);

      // Back button returns cleanly to the full-width catalog.
      element.querySelector<HTMLButtonElement>(".sdk-detail-view .sdk-page-header-back")!.click();
      await vi.waitFor(() => {
        expect(element.querySelector(".sdk-detail-view")).toBeNull();
        expect(element.querySelector<HTMLElement>(".sdk-catalog-view")!.style.display).not.toBe("none");
        expect(element.querySelectorAll('.sdk-table-host tbody tr[data-row-item="true"]').length).toBe(3);
      });
      expect(route.router.currentRoute.value.query.selected).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});
