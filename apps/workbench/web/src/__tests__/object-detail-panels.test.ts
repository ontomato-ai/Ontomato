import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import {
  panelAddress,
  type ProductPanelNestedReadRequest,
  type ProductPanelReadRequest,
} from "@ontomato/contracts/panel-host";
import type { ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import {
  ADD_FAVORITE,
  CLEAR_OBJECT_DETAIL_PANEL,
  FAVORITE,
  OBJECT_TYPE,
  PRODUCT_PANEL,
  REMOVE_FAVORITE,
  SAVE_OBJECT_DETAIL_PANEL,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import outerSource from "../../../../../packages/ontology-manager/resources/builtin-panels/object-detail/panel.json";
import outerHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/object-detail/panel.html?raw";
import outerModule from "../../../../../packages/ontology-manager/resources/builtin-panels/object-detail/panel.mjs?raw";
import bodySource from "../../../../../packages/ontology-manager/resources/builtin-panels/object-detail-body/panel.json";
import bodyHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/object-detail-body/panel.html?raw";
import bodyModule from "../../../../../packages/ontology-manager/resources/builtin-panels/object-detail-body/panel.mjs?raw";
import {
  humanIntents,
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

const APP_ID = "browser";
const detailUse = panelUse(
  "browser-object-detail",
  "browser-object-detail",
  "builtin-product-object-detail",
  "/browser/views",
);

const actionTargets: Record<string, { source: "input"; input: string } | { source: "none" }> = {
  [CLEAR_OBJECT_DETAIL_PANEL]: { source: "input", input: "objectType" },
  [ADD_FAVORITE]: { source: "input", input: "target" },
  [REMOVE_FAVORITE]: { source: "input", input: "target" },
};

const favoriteTargetTypes = {
  platformTypes: ["platform:Application", "platform:AgentDefinition", "platform:Dashboard", "platform:DashboardCard", "platform:AgentSession"],
  customerObjects: true,
};

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => {
        const form = id.endsWith(".save") || id.endsWith(".create") || id === SAVE_OBJECT_DETAIL_PANEL;
        const multiTarget = id === ADD_FAVORITE || id === REMOVE_FAVORITE;
        return {
          id,
          kind: form ? "form.save" : "action",
          effect: "write",
          batch: false,
          inputSchema: {},
          target: form ? { source: "draft" } : (actionTargets[id] ?? { source: "input", input: "target" }),
          ...(multiTarget ? { targetTypes: favoriteTargetTypes } : {}),
        };
      }),
    }),
  ]),
);

const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation local name" }] }
      : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);

function expandPanel(
  panelId: string,
  name: string,
  source: { manifest: unknown; content: { messages: Record<string, Record<string, string>> } },
  html: string,
  module: string,
  projections: Map<string, ProductProjection>,
): ProductPanel {
  const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
  const members = Object.fromEntries(
    Object.entries(authoring).map(([key, definition]) => {
      if (!("component" in definition)) return [key, definition];
      const { projection, placement } = expandPanelAuthoringMember(key, definition, {
        state: manifest.state,
        typeTable: { objectTypes },
        components: catalogue,
      });
      const id = definition.id!;
      projections.set(id, {
        ...projection,
        id,
        name: definition.name ?? key,
        description: definition.description ?? "",
        visibility: "platform",
        domainId: null,
        ownerId: null,
        revision: 1,
        createdAt: "2026-11-25T00:00:00.000Z",
        updatedAt: "2026-11-25T00:00:00.000Z",
        editable: false,
      } as ProductProjection);
      return [key, { target: { projectionId: id }, ...placement }];
    }),
  );
  return {
    id: panelId,
    name,
    description: name,
    visibility: "platform" as const,
    domainId: null,
    ownerId: null,
    revision: 1,
    createdAt: "2026-11-25T00:00:00.000Z",
    updatedAt: "2026-11-25T00:00:00.000Z",
    editable: false,
    manifest: definePanel({ ...manifest, members }),
    content: { html, module, messages: source.content.messages },
  };
}

const projections = new Map<string, ProductProjection>();
const bodyPanel = expandPanel(
  "builtin-product-object-detail-body",
  "Object detail body",
  bodySource,
  bodyHtml,
  bodyModule,
  projections,
);
const detailPanel = expandPanel(
  "builtin-product-object-detail",
  "Object detail",
  outerSource,
  outerHtml,
  outerModule,
  projections,
);
const customOrderPanel: ProductPanel = {
  ...panelRecord(
    "panel-order-custom",
    "Custom Order Detail",
    definePanel({
      state: {
        selected: { type: { kind: "object", objectType: "Order" }, external: true, deepLink: false },
      },
      members: {},
    }),
  ),
  content: {
    html: '<div id="app"><section class="custom-order-panel"><p>Custom order view for {{ selected?.primaryKey }}</p><button class="switch-order" @click="switchOrder">Switch order</button></section></div>',
    module: `import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";
await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected ?? null);
    function switchOrder() {
      instance.state.set("selected", { className: "Order", primaryKey: "ord-2" });
    }
    return { selected, switchOrder };
  },
});`,
  },
};

interface HarnessOptions {
  panelStatus?: "unconfigured" | "configured" | "unavailable" | "forbidden";
  unavailableReason?: string;
  canConfigure?: boolean;
  initialFavorited?: boolean;
}

function mountDetailRoute(options: HarnessOptions = {}) {
  let favorited = options.initialFavorited ?? false;
  let panelStatus = options.panelStatus ?? "unconfigured";
  let boundPanelId = panelStatus === "configured" ? customOrderPanel.id : "";
  const unavailableReason = options.unavailableReason ?? "";
  const canConfigure = options.canConfigure ?? true;
  const intentCalls: Array<{ operationId: string; target?: unknown; input: unknown }> = [];

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: detailUse.path, component: PanelApplicationRoute, props: { applicationId: APP_ID } },
      { path: "/browser/data/:className?", component: { render: () => h("div", "data-browser") } },
      { path: "/workspace", component: { render: () => h("div", "workspace") } },
      { path: "/ontology/panels", component: { render: () => h("div", "panels-directory") } },
    ],
  });

  const intents = humanIntents((operationId, call) => {
    intentCalls.push({ operationId, target: call.target, input: call.input });
    if (operationId === "addFavorite.add") {
      favorited = true;
      return {
        kind: "success",
        data: { favorited: true },
        affected: { objectTypes: [FAVORITE], objects: [] },
      };
    }
    if (operationId === "removeFavorite.remove") {
      favorited = false;
      return {
        kind: "success",
        data: { favorited: false },
        affected: { objectTypes: [FAVORITE], objects: [] },
      };
    }
    if (operationId === "clearDetailPanel.clearDetailPanel") {
      panelStatus = "unconfigured";
      boundPanelId = "";
      return {
        kind: "success",
        data: {},
        affected: { objectTypes: [OBJECT_TYPE], objects: [{ objectType: OBJECT_TYPE, primaryKey: "Order" }] },
      };
    }
    if (operationId === "detailPanelForm.saveDetailPanel") {
      const nextId = ((call.input as { values?: { panelId?: string | null } } | undefined)?.values?.panelId) ?? "";
      boundPanelId = nextId || "";
      panelStatus = boundPanelId ? "configured" : "unconfigured";
      return {
        kind: "success",
        data: {},
        affected: { objectTypes: [OBJECT_TYPE], objects: [{ objectType: OBJECT_TYPE, primaryKey: "Order" }] },
      };
    }
    return { kind: "success", data: {} };
  });

  installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
      return Response.json({
        data: { applicationId: APP_ID, entry: { path: "/browser", renderer: "browser" }, panelUses: [detailUse] },
      });
    }
    if (path === `/api/product-panels/${detailPanel.id}`) return panelAnswer(detailPanel, request);
    if (path === `/api/product-panels/${detailPanel.id}/snapshot`) {
      return panelSnapshot(detailPanel, Object.fromEntries(projections), request);
    }
    if (path === "/api/product-panels/nested") {
      const body = request.body as ProductPanelNestedReadRequest;
      const last = body.memberPath.at(-1)?.member;
      if (last === "body") {
        return Response.json({
          panel: { id: bodyPanel.id, revision: bodyPanel.revision, content: bodyPanel.content, manifest: bodyPanel.manifest },
        });
      }
      if (last === "customDetail") {
        return Response.json({
          panel: {
            id: customOrderPanel.id,
            revision: customOrderPanel.revision,
            content: customOrderPanel.content,
            manifest: customOrderPanel.manifest,
          },
        });
      }
      return nothingAt(request);
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      const member = body.memberPath.at(-1)?.member;
      if ("operations" in body) {
        if (member === "addFavorite") {
          return Response.json({
            status: "ready",
            value: {
              add: {
                handlerRef: ADD_FAVORITE,
                kind: "action",
                label: "Add to favorites",
                effect: "write",
                batch: false,
                target: { source: "input", input: "target" },
                targetTypes: favoriteTargetTypes,
                inputSchema: { type: "object", properties: { title: { type: "string" } } },
                resultSchema: {},
              },
            },
          });
        }
        if (member === "removeFavorite") {
          return Response.json({
            status: "ready",
            value: {
              remove: {
                handlerRef: REMOVE_FAVORITE,
                kind: "action",
                label: "Remove from favorites",
                effect: "write",
                batch: false,
                target: { source: "input", input: "target" },
                targetTypes: favoriteTargetTypes,
                inputSchema: { type: "object", properties: {} },
                resultSchema: {},
              },
            },
          });
        }
        if (member === "clearDetailPanel") {
          return Response.json({
            status: "ready",
            value: {
              clearDetailPanel: {
                handlerRef: CLEAR_OBJECT_DETAIL_PANEL,
                kind: "action",
                label: "Clear detail panel binding",
                effect: "write",
                batch: false,
                target: { source: "input", input: "objectType" },
                inputSchema: {},
                resultSchema: {},
                ...(!boundPanelId ? { unavailable: { reason: "Default read-only detail" } } : {}),
              },
            },
          });
        }
        if (member === "detailPanelForm") {
          return Response.json({
            status: "ready",
            value: {
              saveDetailPanel: {
                handlerRef: SAVE_OBJECT_DETAIL_PANEL,
                kind: "form.save",
                label: "Save detail panel",
                effect: "write",
                batch: false,
                target: { source: "draft", slot: "detailPanelForm" },
                inputSchema: {},
                resultSchema: {},
              },
            },
          });
        }
        return Response.json({ status: "ready", value: {} });
      }

      if (member === "headerTitle" || member === "defaultSummary") {
        const obj = body.inputs?.object as { className?: string; primaryKey?: string } | undefined;
        const pk = obj?.primaryKey ?? "ord-1";
        return Response.json({
          status: "ready",
          value: {
            className: obj?.className ?? "Order",
            primaryKey: pk,
            label: pk === "ord-2" ? "Order #2" : "Order #1",
            fields: { code: pk.toUpperCase(), status: "Open" },
            fieldLabels: { code: "Order code", status: "Status" },
          },
        });
      }
      if (member === "defaultRelations") {
        const node = body.inputs?.node as { className?: string; primaryKey?: string } | undefined;
        const anchorRef = { className: node?.className ?? "Order", primaryKey: node?.primaryKey ?? "ord-1" };
        const neighborRef = { className: "Customer", primaryKey: "cust-1" };
        return Response.json({
          status: "ready",
          value: {
            node: { ...anchorRef, label: "Order #1", layer: "fact" },
            neighbors: [{ ...neighborRef, label: "Acme Corp", typeLabel: "Customer", layer: "fact" }],
            edges: [
              {
                id: "edge-1",
                relationKind: "belongs_to",
                label: "Belongs to",
                from: anchorRef,
                to: neighborRef,
                direction: "outgoing",
                derived: false,
              },
            ],
            relations: [
              {
                relationKind: "belongs_to",
                label: "Belongs to",
                status: "ok",
                edgeCount: 1,
              },
            ],
          },
        });
      }
      if (member === "detailBinding" || member === "detailBindingSummary") {
        return Response.json({
          status: "ready",
          value: {
            className: OBJECT_TYPE,
            primaryKey: "Order",
            label: "Detail panel",
            outputs: {
              configured: panelStatus !== "unconfigured",
              panelId: boundPanelId,
              panelStatus,
              canConfigure,
            },
            fields: {
              panelId: boundPanelId,
              panelName: boundPanelId ? customOrderPanel.name : "",
              status: panelStatus,
              unavailableReason,
            },
            fieldLabels: {
              panelId: "Panel ID",
              panelName: "Detail panel",
              status: "Status",
              unavailableReason: "Reason",
            },
          },
        });
      }
      if (member === "detailPanelForm") {
        return Response.json({
          status: "ready",
          value: {
            fields: [
              {
                path: "/panelId",
                label: "Detail panel",
                help: "Leave empty to use the default read-only detail.",
                required: false,
                valueSchema: { anyOf: [{ type: "string" }, { type: "null" }] },
                control: { kind: "reference", objectType: PRODUCT_PANEL, multiple: false },
                readOnly: !canConfigure,
              },
            ],
            values: { panelId: boundPanelId || null },
            errors: [],
            save: {
              operation: SAVE_OBJECT_DETAIL_PANEL,
              method: "PUT",
              path: "/api/object-details/Order",
              bodySchema: { type: "object", properties: { panelId: { anyOf: [{ type: "string" }, { type: "null" }] } } },
            },
          },
        });
      }
      if (member === "detailPanelPicker") {
        return Response.json({
          status: "ready",
          value: {
            options: [{ primaryKey: customOrderPanel.id, label: customOrderPanel.name }],
          },
        });
      }
      if (member === "favoriteStatus") {
        const obj = body.inputs?.object as { className?: string; primaryKey?: string } | undefined;
        return Response.json({
          status: "ready",
          value: {
            className: FAVORITE,
            primaryKey: JSON.stringify([obj?.className ?? "Order", obj?.primaryKey ?? "ord-1"]),
            label: "Order #1",
            fields: { className: obj?.className ?? "Order", primaryKey: obj?.primaryKey ?? "ord-1", title: "Order #1", status: "" },
            outputs: {
              favorited,
              className: obj?.className ?? "Order",
              primaryKey: obj?.primaryKey ?? "ord-1",
              title: "Order #1",
            },
          },
        });
      }
      return Response.json({ status: "empty" });
    }
    return intents(request) ?? nothingAt(request);
  }, router);

  useApplicationCatalog().applications.value = [
    {
      id: APP_ID,
      kind: "native",
      rail: "top",
      category: "business",
      sort: 40,
      entry: { path: "/browser", renderer: "browser", home: "/browser/data" },
      entryAccess: ["data-browser"],
      scheduleAdapter: null,
      releaseId: null,
      names: { en: "Object browser" },
      descriptions: { en: "Browse objects" },
      icon: "objects",
      panelUses: [detailUse],
    },
  ];

  async function open(address: string) {
    await router.push(address);
    await router.isReady();
    return mountPlatformPage(() => h(RouterView), router);
  }

  return { router, open, intentCalls };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  vi.restoreAllMocks();
});

describe("builtin object-detail and object-detail-body panels", () => {
  it("renders default read-only summary + relations when unconfigured and toggles favorite via platform:Favorite", async () => {
    const route = mountDetailRoute({ panelStatus: "unconfigured", initialFavorited: false });
    const { app, element } = await route.open(
      panelAddress(detailUse.path, { selected: { className: "Order", primaryKey: "ord-1" } }),
    );
    try {
      await vi.waitFor(() => {
        expect(element.querySelector("header")?.textContent).toContain("Order #1");
        expect(element.textContent).toContain("ORD-1");
        expect(element.textContent).toContain("Acme Corp");
        const star = element.querySelector<HTMLButtonElement>('.sdk-page-header-title-slot button[aria-label="Add to favorites"]');
        expect(star).toBeTruthy();
        expect(star?.disabled).toBe(false);
      });

      const starAdd = element.querySelector<HTMLButtonElement>('.sdk-page-header-title-slot button[aria-label="Add to favorites"]');
      expect(starAdd).toBeTruthy();
      expect(starAdd?.getAttribute("aria-pressed")).toBe("false");
      starAdd!.click();

      await vi.waitFor(() => {
        const starRemove = element.querySelector<HTMLButtonElement>('.sdk-page-header-title-slot button[aria-label="Remove from favorites"]');
        expect(starRemove).toBeTruthy();
        expect(starRemove?.getAttribute("aria-pressed")).toBe("true");
        expect(starRemove?.classList.contains("od-star-active")).toBe(true);
      });
      expect(route.intentCalls.at(-1)).toMatchObject({
        operationId: "addFavorite.add",
        target: { kind: "object", objectType: "Order", primaryKey: "ord-1" },
        input: { title: "Order #1" },
      });

      element.querySelector<HTMLButtonElement>('button[aria-label="Remove from favorites"]')!.click();
      await vi.waitFor(() => {
        expect(element.querySelector<HTMLButtonElement>('button[aria-label="Add to favorites"]')).toBeTruthy();
      });
      expect(route.intentCalls.at(-1)).toMatchObject({
        operationId: "removeFavorite.remove",
        target: { kind: "object", objectType: "Order", primaryKey: "ord-1" },
        input: {},
      });
    } finally {
      app.unmount();
    }
  });

  it("renders in-place unavailable/forbidden reason without silently falling back to default summary", async () => {
    for (const [status, reason] of [
      ["unavailable", "The configured panel no longer exists."],
      ["forbidden", "You cannot use this panel."],
    ] as const) {
      const route = mountDetailRoute({
        panelStatus: status,
        unavailableReason: reason,
        canConfigure: false,
      });
      const { app, element } = await route.open(
        panelAddress(detailUse.path, { selected: { className: "Order", primaryKey: "ord-1" } }),
      );
      try {
        await vi.waitFor(() => {
          expect(element.textContent).toContain(reason);
        });
        expect(element.textContent).not.toContain("ORD-1");
        expect(element.textContent).not.toContain("Acme Corp");
        expect(
          Array.from(element.querySelectorAll("button")).some((btn) =>
            btn.textContent?.includes("Configure presentation"),
          ),
        ).toBe(false);
      } finally {
        app.unmount();
      }
    }
  });

  it("renders configured custom detail panel via objectDetail rule and syncs selected two-way", async () => {
    const route = mountDetailRoute({ panelStatus: "configured", canConfigure: true });
    const { app, element } = await route.open(
      panelAddress(detailUse.path, {
        selected: { className: "Order", primaryKey: "ord-1" },
        returnTo: "workspace",
      }),
    );
    try {
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Custom order view for ord-1");
      });

      element.querySelector<HTMLButtonElement>(".switch-order")!.click();
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.fullPath).toContain("selected=Order~ord-2");
        expect(element.textContent).toContain("Custom order view for ord-2");
      });

      // Open configure presentation dialog without changing URL, then navigate to /ontology/panels.
      const beforeUrl = route.router.currentRoute.value.fullPath;
      const configBtn = Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find((btn) =>
        btn.textContent?.includes("Configure presentation"),
      )!;
      expect(configBtn).toBeTruthy();
      configBtn.click();

      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Configure object presentation");
        expect(document.body.textContent).toContain("Manage detail panels");
      });
      expect(route.router.currentRoute.value.fullPath).toBe(beforeUrl);

      const manageBtn = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((btn) =>
        btn.textContent?.includes("Manage detail panels"),
      )!;
      manageBtn.click();
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.fullPath).toBe("/ontology/panels");
      });
    } finally {
      app.unmount();
    }
  });

  it("navigates back to /workspace when returnTo=workspace and to /browser/data/<className> otherwise", async () => {
    const fromWorkspace = mountDetailRoute({ panelStatus: "unconfigured" });
    const pageA = await fromWorkspace.open(
      panelAddress(detailUse.path, {
        selected: { className: "Order", primaryKey: "ord-1" },
        returnTo: "workspace",
      }),
    );
    try {
      await vi.waitFor(() => expect(pageA.element.textContent).toContain("Back to workspace"));
      const backBtn = Array.from(pageA.element.querySelectorAll<HTMLButtonElement>("button")).find((btn) =>
        btn.textContent?.includes("Back to workspace"),
      )!;
      backBtn.click();
      await vi.waitFor(() => expect(fromWorkspace.router.currentRoute.value.fullPath).toBe("/workspace"));
    } finally {
      pageA.app.unmount();
    }

    const fromBrowser = mountDetailRoute({ panelStatus: "unconfigured" });
    const pageB = await fromBrowser.open(
      panelAddress(detailUse.path, { selected: { className: "Order", primaryKey: "ord-1" } }),
    );
    try {
      await vi.waitFor(() => expect(pageB.element.textContent).toContain("Back to data browser"));
      const backBtn = Array.from(pageB.element.querySelectorAll<HTMLButtonElement>("button")).find((btn) =>
        btn.textContent?.includes("Back to data browser"),
      )!;
      backBtn.click();
      await vi.waitFor(() => expect(fromBrowser.router.currentRoute.value.fullPath).toBe("/browser/data/Order"));
    } finally {
      pageB.app.unmount();
    }
  });
});
