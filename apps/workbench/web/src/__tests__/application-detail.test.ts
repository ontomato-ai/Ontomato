import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddress, panelAddressState, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { APPLICATION, PRODUCT_PANEL, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/application-detail/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/application-detail/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/application-detail/panel.mjs?raw";
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
  "use-ontology-application-detail",
  "ontology-application-detail",
  "builtin-product-ontology-application-detail",
  "/ontology/applications/detail",
);

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => {
        const form = id.endsWith(".save") || id.endsWith(".create");
        return {
          id,
          kind: form ? "form.save" : "action",
          effect: "write",
          batch: false,
          inputSchema: {},
          target: form ? { source: "draft" } : { source: "input", input: "target" },
        };
      }),
    }),
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
      createdAt: "2026-11-23T00:00:00Z",
      updatedAt: "2026-11-23T00:00:00Z",
    });
    return [name, { ...placement, target: { projectionId: definition.id! } }];
  }),
);

const detailPanel = {
  ...panelRecord(use.panelId, "Application detail", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

const appRef = (primaryKey: string) => ({ className: APPLICATION, primaryKey });
const panelRef = (primaryKey: string) => ({ className: PRODUCT_PANEL, primaryKey });

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
type ReadAnswer = Response | Promise<Response>;
type PageControllerHandle = {
  applyState(patch: Readonly<Record<string, RuntimeJsonValue>>): void;
  applyAddress?(url: string, options?: { overwriteUnsavedDraft?: boolean }): void;
};

function mountDetailRoute(
  initialState: Record<string, unknown>,
  onRead: (body: DataReadRequest) => ReadAnswer,
) {
  let controller: PageControllerHandle | null = null;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: use.path,
        component: PanelApplicationRoute,
        props: {
          applicationId: appId,
          registerPageController(next: PageControllerHandle) {
            controller = next;
            return () => {
              if (controller === next) controller = null;
            };
          },
        },
      },
    ],
  });
  const sent = installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (path === `/api/product-panels/${detailPanel.id}`) return panelAnswer(detailPanel, request);
    if (path === `/api/product-panels/${detailPanel.id}/snapshot`) {
      return panelSnapshot(detailPanel, Object.fromEntries(projections), request);
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      if ("operations" in body) return Response.json({ status: "ready", value: {} });
      return onRead(body);
    }
    return nothingAt(request);
  }, router);

  return {
    router,
    sent,
    controller: () => controller,
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
      await router.push(panelAddress(use.path, initialState, detailPanel.manifest));
      return mountPlatformPage(() => h(RouterView), router);
    },
  };
}

function appRecord(
  primaryKey: string,
  label: string,
  outputs: { canMaintain: boolean; canEditEntries: boolean; canGrant?: boolean },
) {
  return {
    primaryKey,
    className: APPLICATION,
    label,
    fields: { id: primaryKey },
    outputs: {
      canMaintain: outputs.canMaintain,
      canEditEntries: outputs.canEditEntries,
      canGrant: outputs.canGrant ?? false,
      domainShared: false,
      openPath: `/${primaryKey}`,
    },
  };
}

function emptyForm(id: string) {
  return {
    fields: [],
    values: {},
    errors: [],
    revision: 1,
    save: { method: "PUT", path: `/applications/${id}`, bodySchema: {}, draftOperation: `${APPLICATION}.save` },
  };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
});

describe("application-detail panel regressions (#2 nullable totals, #4 cross-app address restore)", () => {
  it("does not display fake 0 when entriesList or usedPanelsList total is null (bulk edit unmount / loading), while showing real 0 accurately", async () => {
    const entriesGate = deferred<unknown>();
    const panelsGate = deferred<unknown>();

    const entriesByApp: Record<string, Array<{ primaryKey: string; label: string; fields: Record<string, unknown> }>> = {
      "app-editable": [
        { primaryKey: "e-1", label: "Home", fields: { path: "/home", canEdit: true } },
        { primaryKey: "e-2", label: "Settings", fields: { path: "/settings", canEdit: true } },
      ],
    };

    const route = mountDetailRoute(
      { selected: appRef("app-editable"), tab: "entries" },
      (body) => {
        const targetKey = (body.inputs.target as { primaryKey?: string } | undefined)?.primaryKey ?? "";
        const member = body.memberPath[0]?.member;
        if (body.dataName === "record") {
          if (targetKey === "app-non-panel") {
            return Response.json({
              status: "ready",
              value: appRecord("app-non-panel", "Non-panel App", { canMaintain: true, canEditEntries: false }),
            });
          }
          if (targetKey === "app-no-panels") {
            return Response.json({
              status: "ready",
              value: appRecord("app-no-panels", "No Panels App", { canMaintain: true, canEditEntries: true }),
            });
          }
          return Response.json({
            status: "ready",
            value: appRecord("app-editable", "Editable App", { canMaintain: true, canEditEntries: true }),
          });
        }
        if (member === "entriesList" && body.dataName === "rows") {
          if (targetKey === "app-non-panel") return entriesGate.promise.then((payload) => Response.json(payload));
          return Response.json({ status: "ready", value: entriesByApp[targetKey] ?? [] });
        }
        if (member === "entriesForm" && body.dataName === "form") {
          return Response.json({ status: "ready", value: emptyForm(targetKey) });
        }
        if (member === "usedPanelsList" && body.dataName === "rows") {
          if (targetKey === "app-editable") return panelsGate.promise.then((payload) => Response.json(payload));
          return Response.json({ status: "empty" });
        }
        return Response.json({ status: "empty" });
      },
    );

    const { app, element } = await route.open();
    try {
      // 1. Entries list loaded with 2 entries -> shows "2 entries".
      await vi.waitFor(() => {
        expect(element.querySelector(".apps-table-bar .apps-muted")?.textContent?.trim()).toBe("2 entries");
      });

      // 2. Toggle to bulk edit mode -> entriesList unmounts and total output becomes null.
      //    Count must NOT fake "0 entries" while action buttons remain present on the bar.
      const bulkBtn = Array.from(element.querySelectorAll<HTMLButtonElement>(".apps-table-bar-actions button"))
        .find((btn) => btn.textContent?.includes("Edit full table"));
      expect(bulkBtn).toBeDefined();
      bulkBtn!.click();

      await vi.waitFor(() => {
        expect(element.querySelector(".apps-table-bar-actions")?.textContent).toContain("Back to list");
      });
      const bulkCountText = element.querySelector(".apps-table-bar .apps-muted")?.textContent?.trim() ?? "";
      expect(bulkCountText).toBe("");
      expect(bulkCountText).not.toContain("0");

      // 3. Switch to non-panel app with entriesList still loading (total === null):
      //    Must NOT show "0 entries" or flash the empty-entries InfoBanner.
      await route.router.push(panelAddress(use.path, { selected: appRef("app-non-panel"), tab: "entries" }, detailPanel.manifest));
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Non-panel App");
      });
      expect(element.querySelector(".apps-table-bar .apps-muted")?.textContent?.trim() ?? "").toBe("");
      expect(element.textContent).not.toContain("not a panel application");

      // 4. Resolve non-panel app entriesList as empty (real total === 0):
      //    Now shows "0 entries" AND the empty-entries InfoBanner.
      entriesGate.resolve({ status: "empty" });
      await vi.waitFor(() => {
        expect(element.querySelector(".apps-table-bar .apps-muted")?.textContent?.trim()).toBe("0 entries");
        expect(element.textContent).toContain("not a panel application");
      });

      // 5. Switch to Assets tab on app-editable while usedPanelsList is still pending (total === null):
      //    Heading shows count-less "Used panels", NOT "Used panels (0)".
      await route.router.push(panelAddress(use.path, { selected: appRef("app-editable"), tab: "assets" }, detailPanel.manifest));
      await vi.waitFor(() => {
        const heading = element.querySelector(".apps-assets-grid .apps-card-title")?.textContent?.trim();
        expect(heading).toBe("Used panels");
      });

      // 6. Resolve usedPanelsList with 2 panels -> heading updates to "Used panels (2)".
      panelsGate.resolve({
        status: "ready",
        value: [
          { primaryKey: "panel-1", className: PRODUCT_PANEL, label: "Panel One", fields: {} },
          { primaryKey: "panel-2", className: PRODUCT_PANEL, label: "Panel Two", fields: {} },
        ],
      });
      await vi.waitFor(() => {
        const heading = element.querySelector(".apps-assets-grid .apps-card-title")?.textContent?.trim();
        expect(heading).toBe("Used panels (2)");
      });

      // 7. Switch to app-no-panels whose usedPanelsList returns empty (real total === 0):
      //    Heading accurately displays "Used panels (0)".
      await route.router.push(panelAddress(use.path, { selected: appRef("app-no-panels"), tab: "assets" }, detailPanel.manifest));
      await vi.waitFor(() => {
        const heading = element.querySelector(".apps-assets-grid .apps-card-title")?.textContent?.trim();
        expect(heading).toBe("Used panels (0)");
      });
    } finally {
      app.unmount();
    }
  });

  it("preserves inspectedPanel when the same panel instance restores another app with a different or shared panel ID, and clears it when switching app without inspectedPanel", async () => {
    const usedPanelsByApp: Record<string, Array<{ primaryKey: string; className: string; label: string; fields: Record<string, unknown> }>> = {
      "app-a": [
        { primaryKey: "panel-a1", className: PRODUCT_PANEL, label: "Alpha First", fields: {} },
        { primaryKey: "panel-shared", className: PRODUCT_PANEL, label: "Shared Panel", fields: {} },
      ],
      "app-b": [
        { primaryKey: "panel-b1", className: PRODUCT_PANEL, label: "Beta First", fields: {} },
        { primaryKey: "panel-b2", className: PRODUCT_PANEL, label: "Beta Second", fields: {} },
      ],
      "app-c": [
        { primaryKey: "panel-c1", className: PRODUCT_PANEL, label: "Gamma First", fields: {} },
        { primaryKey: "panel-b2", className: PRODUCT_PANEL, label: "Beta Second", fields: {} },
      ],
    };

    const route = mountDetailRoute(
      { selected: appRef("app-a"), tab: "assets", inspectedPanel: panelRef("panel-a1") },
      (body) => {
        const targetKey = (body.inputs.target as { primaryKey?: string } | undefined)?.primaryKey ?? "";
        const member = body.memberPath[0]?.member;
        if (body.dataName === "record") {
          return Response.json({
            status: "ready",
            value: appRecord(targetKey, `App ${targetKey}`, { canMaintain: false, canEditEntries: false }),
          });
        }
        if (member === "usedPanelsList" && body.dataName === "rows") {
          return Response.json({ status: "ready", value: usedPanelsByApp[targetKey] ?? [] });
        }
        if (member === "panelMembersList" && body.dataName === "rows") {
          return Response.json({
            status: "ready",
            value: [{ primaryKey: `member-of-${targetKey}`, label: `Member of ${targetKey}`, fields: { slot: "main" } }],
          });
        }
        return Response.json({ status: "empty" });
      },
    );

    const { app, element } = await route.open();
    try {
      const rootNode = await vi.waitFor(() => {
        const el = element.querySelector(".apps-detail");
        expect(el).not.toBeNull();
        return el!;
      });

      // Initial state: App A + panel-a1.
      await vi.waitFor(() => {
        expect(element.querySelector(".apps-assets-grid .sdk-object-list-item-btn.chosen")?.textContent).toContain("Alpha First");
        expect(element.querySelector(".apps-card-head .apps-card-title")?.textContent?.trim()).toBe("Alpha First");
      });

      // 1. Address restore on the SAME panel instance: App B + panel-b2 (non-first item).
      //    Must keep inspectedPanel = panel-b2 and NOT clear or fall back to panel-b1.
      await route.router.push(
        panelAddress(use.path, { selected: appRef("app-b"), tab: "assets", inspectedPanel: panelRef("panel-b2") }, detailPanel.manifest),
      );
      await vi.waitFor(() => {
        expect(element.querySelector(".apps-assets-grid .sdk-object-list-item-btn.chosen")?.textContent).toContain("Beta Second");
        expect(element.querySelector(".apps-card-head .apps-card-title")?.textContent?.trim()).toBe("Beta Second");
      });
      // Confirm same panel DOM instance was reused, and URL state kept panel-b2.
      expect(element.querySelector(".apps-detail")).toBe(rootNode);
      expect(panelAddressState(route.router.currentRoute.value.fullPath, detailPanel.manifest)).toMatchObject({
        selected: appRef("app-b"),
        tab: "assets",
        inspectedPanel: panelRef("panel-b2"),
      });
      // Confirm panelMembersList never read panel-b1; it read panel-b2 directly.
      const memberReadsAfterB = route.sent
        .filter((req) => req.path === "/api/product-panels/read")
        .map((req) => req.body as ProductPanelReadRequest)
        .filter((b) => b.memberPath[0]?.member === "panelMembersList")
        .map((b) => (b.inputs.target as { primaryKey?: string } | undefined)?.primaryKey);
      expect(memberReadsAfterB).toContain("panel-b2");
      expect(memberReadsAfterB).not.toContain("panel-b1");

      // 2. Address restore to App C carrying the SAME panel ID (panel-b2, non-first item in App C).
      //    Must STILL preserve panel-b2 instead of clearing it and falling back to panel-c1.
      await route.router.push(
        panelAddress(use.path, { selected: appRef("app-c"), tab: "assets", inspectedPanel: panelRef("panel-b2") }, detailPanel.manifest),
      );
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Gamma First");
        expect(element.querySelector(".apps-assets-grid .sdk-object-list-item-btn.chosen")?.textContent).toContain("Beta Second");
        expect(element.querySelector(".apps-card-head .apps-card-title")?.textContent?.trim()).toBe("Beta Second");
      });
      expect(panelAddressState(route.router.currentRoute.value.fullPath, detailPanel.manifest)).toMatchObject({
        selected: appRef("app-c"),
        tab: "assets",
        inspectedPanel: panelRef("panel-b2"),
      });

      // 3. Normal application switch WITHOUT inspectedPanel in the address:
      //    Old inspectedPanel (panel-b2) must be cleared so usedPanelsList falls back to App A's first item (panel-a1).
      await route.router.push(
        panelAddress(use.path, { selected: appRef("app-a"), tab: "assets" }, detailPanel.manifest),
      );
      await vi.waitFor(() => {
        expect(element.querySelector(".apps-assets-grid .sdk-object-list-item-btn.chosen")?.textContent).toContain("Alpha First");
        expect(element.querySelector(".apps-card-head .apps-card-title")?.textContent?.trim()).toBe("Alpha First");
      });
      expect(panelAddressState(route.router.currentRoute.value.fullPath, detailPanel.manifest)).toMatchObject({
        selected: appRef("app-a"),
        tab: "assets",
        inspectedPanel: panelRef("panel-a1"),
      });
    } finally {
      app.unmount();
    }
  });

  it("handles atomic live setState switches: keeps explicitly specified inspectedPanel (different or same ID) and clears stale sub-views on plain selected switch", async () => {
    const usedPanelsByApp: Record<string, Array<{ primaryKey: string; className: string; label: string; fields: Record<string, unknown> }>> = {
      "app-a": [
        { primaryKey: "panel-a1", className: PRODUCT_PANEL, label: "Alpha First", fields: {} },
        { primaryKey: "panel-shared", className: PRODUCT_PANEL, label: "Shared Panel", fields: {} },
      ],
      "app-b": [
        { primaryKey: "panel-b1", className: PRODUCT_PANEL, label: "Beta First", fields: {} },
        { primaryKey: "panel-b2", className: PRODUCT_PANEL, label: "Beta Second", fields: {} },
      ],
      "app-c": [
        { primaryKey: "panel-c1", className: PRODUCT_PANEL, label: "Gamma First", fields: {} },
        { primaryKey: "panel-b2", className: PRODUCT_PANEL, label: "Beta Second", fields: {} },
      ],
    };

    const route = mountDetailRoute(
      { selected: appRef("app-a"), tab: "assets", inspectedPanel: panelRef("panel-a1"), entriesView: "bulk" },
      (body) => {
        const targetKey = (body.inputs.target as { primaryKey?: string } | undefined)?.primaryKey ?? "";
        const member = body.memberPath[0]?.member;
        if (body.dataName === "record") {
          return Response.json({
            status: "ready",
            value: appRecord(targetKey, `App ${targetKey}`, { canMaintain: false, canEditEntries: false }),
          });
        }
        if (member === "usedPanelsList" && body.dataName === "rows") {
          return Response.json({ status: "ready", value: usedPanelsByApp[targetKey] ?? [] });
        }
        if (member === "panelMembersList" && body.dataName === "rows") {
          return Response.json({ status: "ready", value: [] });
        }
        return Response.json({ status: "empty" });
      },
    );

    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelector(".apps-assets-grid .sdk-object-list-item-btn.chosen")?.textContent).toContain("Alpha First");
      });

      // 1. Live setState specifying both selected and a different inspectedPanel:
      //    Keeps panel-b2 and resets unspecified entriesView back to default "list" (omitted from flat URL).
      route.controller()!.applyState({
        selected: appRef("app-b"),
        inspectedPanel: panelRef("panel-b2"),
      });
      await vi.waitFor(() => {
        expect(element.querySelector(".apps-assets-grid .sdk-object-list-item-btn.chosen")?.textContent).toContain("Beta Second");
      });
      const stateAfterB = panelAddressState(route.router.currentRoute.value.fullPath, detailPanel.manifest);
      expect(stateAfterB).toMatchObject({
        selected: appRef("app-b"),
        inspectedPanel: panelRef("panel-b2"),
      });
      expect(stateAfterB.entriesView).toBeUndefined();

      // 2. Live setState switching to App C while explicitly naming the SAME panel-b2 ID:
      //    Must STILL keep panel-b2 instead of falling back to panel-c1.
      route.controller()!.applyState({
        selected: appRef("app-c"),
        inspectedPanel: panelRef("panel-b2"),
      });
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Gamma First");
        expect(element.querySelector(".apps-assets-grid .sdk-object-list-item-btn.chosen")?.textContent).toContain("Beta Second");
      });
      expect(panelAddressState(route.router.currentRoute.value.fullPath, detailPanel.manifest)).toMatchObject({
        selected: appRef("app-c"),
        inspectedPanel: panelRef("panel-b2"),
      });

      // 3. Plain live setState switching only `selected` without specifying `inspectedPanel`:
      //    Clears old panel-b2 so usedPanelsList falls back to App A's first panel (panel-a1).
      route.controller()!.applyState({
        selected: appRef("app-a"),
      });
      await vi.waitFor(() => {
        expect(element.querySelector(".apps-assets-grid .sdk-object-list-item-btn.chosen")?.textContent).toContain("Alpha First");
      });
      expect(panelAddressState(route.router.currentRoute.value.fullPath, detailPanel.manifest)).toMatchObject({
        selected: appRef("app-a"),
        inspectedPanel: panelRef("panel-a1"),
      });
    } finally {
      app.unmount();
    }
  });
});
