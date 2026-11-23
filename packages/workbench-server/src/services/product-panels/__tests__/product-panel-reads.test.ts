import {
  APPLICATION,
  APPLICATION_PANEL_USE,
  OBJECT_TYPE,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
} from "@ontomato/contracts/platform-object-types";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

const listCurrentProductsMock = vi.hoisted(() => vi.fn());
const currentProductUsedByMock = vi.hoisted(() => vi.fn());
const currentProductGrantsMock = vi.hoisted(() => vi.fn());
const copyCurrentProductMock = vi.hoisted(() => vi.fn());
const deleteCurrentProductMock = vi.hoisted(() => vi.fn());
const readCurrentPanelMock = vi.hoisted(() => vi.fn());
const readCataloguePanelMock = vi.hoisted(() => vi.fn());
const searchProductGrantPrincipalsMock = vi.hoisted(() => vi.fn());

vi.mock("../catalog", () => ({
  listCurrentProducts: listCurrentProductsMock,
  readCataloguePanel: readCataloguePanelMock,
  currentProductUsedBy: currentProductUsedByMock,
  currentProductGrants: currentProductGrantsMock,
  copyCurrentProduct: copyCurrentProductMock,
  deleteCurrentProduct: deleteCurrentProductMock,
  changeCurrentProductGrant: vi.fn(),
  changeCurrentProductDomainGrant: vi.fn(),
}));

vi.mock("../current", () => ({
  readCurrentPanel: readCurrentPanelMock,
  readCurrentPanelLabel: vi.fn(),
  readCurrentProjection: vi.fn(),
  requireCurrentProduct: vi.fn(),
  saveCurrentPanel: vi.fn(),
  saveCurrentProjection: vi.fn(),
}));

vi.mock("../../product-governance/grants", () => ({
  searchProductGrantPrincipals: searchProductGrantPrincipalsMock,
}));

import { createProductPanelReadAdapter } from "../catalog-reads";

beforeAll(() => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], runtimeResources: [] });
  configureI18n({
    defaultLocale: "en",
    appTextLocale: "en",
    languageSwitchEnabled: true,
    packs: {
      en: { ...enLocaleMeta, messages: en },
    },
  });
});

const owner = { domainId: "domain-1", userId: "user-1" };
const viewer = { token: "token-1", locale: "en" };

const samplePanel = {
  id: "orders-panel",
  domainId: "domain-1",
  ownerId: "user-1",
  name: "Orders Overview",
  description: "Tracks open orders",
  visibility: "domain" as const,
  template: true,
  editable: true,
  revision: 3,
  createdAt: "2026-11-20T08:00:00.000Z",
  updatedAt: "2026-11-23T10:00:00.000Z",
  content: {
    html: "<div id=\"app\"><h1>Orders</h1></div>",
    module: "import { mountPanel } from '@ontomato/sdk/panel';\nawait mountPanel({});",
    style: ".orders { color: var(--sdk-text-color-primary); }",
    recipes: "# Orders\nSelect an order.",
    messages: { en: { "panel.name": "Orders" } },
  },
  manifest: {
    state: {
      selected: { type: { kind: "object", objectType: "Order" }, deepLink: true, personal: false, external: false },
    },
    members: {
      list: {
        target: { projectionId: "proj-orders-list" },
        inputs: { search: { state: "search" } },
        outputs: { selected: { state: "selected" } },
      },
      child: {
        target: { panelId: "panel-order-detail" },
      },
      preview: {
        target: { fromState: "selected", candidates: { rule: "usable" } },
      },
      content: {
        target: { fromPlatform: "currentEntry", candidates: { rule: "applicationEntry" } },
      },
    },
  },
  theme: { light: { "--sdk-color-primary": "#336699" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  readCurrentPanelMock.mockResolvedValue(samplePanel);
  readCataloguePanelMock.mockResolvedValue({ panel: samplePanel });
  searchProductGrantPrincipalsMock.mockResolvedValue({
    options: [{ id: "user-1", name: "Alice Chen" }],
  });
  currentProductGrantsMock.mockResolvedValue({
    grants: [
      { principalKind: "domain", principalId: "*", verb: "use" },
      { principalKind: "principal", principalId: "user-1", principalName: "Alice Chen", verb: "edit" },
      { principalKind: "role", principalId: "role-ops", principalName: "Operators", verb: "use" },
    ],
  });
  currentProductUsedByMock.mockResolvedValue({
    applicationEntries: [
      { applicationId: "app-orders", applicationName: "Orders App", entryId: "entry-1", path: "/applications/app-orders/list" },
    ],
    panels: [{ id: "panel-home", name: "Operations Home" }],
    classNames: ["Order"],
    hiddenCount: 2,
  });
});

describe("createProductPanelReadAdapter", () => {
  it("returns panelRecordQuery with resolved owner display names, counts, and unavailable diagnostics", async () => {
    listCurrentProductsMock.mockResolvedValue({
      items: [
        {
          id: "orders-panel",
          ownerId: "user-1",
          name: "Orders Overview",
          description: "Tracks open orders",
          visibility: "domain",
          template: true,
          revision: 3,
          updatedAt: "2026-11-23T10:00:00.000Z",
          editable: true,
        },
        {
          id: "builtin-product-home",
          ownerId: null,
          name: "Built-in Home",
          description: "",
          visibility: "platform",
          revision: 1,
          updatedAt: "2026-11-21T00:00:00.000Z",
          editable: false,
        },
      ],
      nextCursor: "cursor-next",
      total: 2,
      unavailableItems: [{ id: "broken-panel", reason: "Invalid manifest" }],
    });

    const adapter = createProductPanelReadAdapter(owner, viewer);
    const result = panelReadResultSchemas.panelRecordQuery.parse(await adapter.query({ scope: "all", sort: "updated", template: true }));

    expect(result.total).toBe(2);
    expect(result.nextCursor).toBe("cursor-next");
    expect(result.diagnostics).toEqual(["broken-panel: Invalid manifest"]);
    expect(result.rows[0]).toMatchObject({
      primaryKey: "orders-panel",
      className: PRODUCT_PANEL,
      label: "Orders Overview",
      subtitle: "Tracks open orders",
      fields: {
        owner: "Alice Chen",
        visibility: "Domain",
        template: "Template",
        isTemplate: true,
        editable: "Editable",
        revision: 3,
      },
      tones: { visibility: "success", template: "info", editable: "success" },
    });
    expect(result.rows[1]).toMatchObject({
      primaryKey: "builtin-product-home",
      fields: {
        owner: "Platform",
        visibility: "Platform",
        template: "Ordinary",
        isTemplate: false,
        editable: "Read only",
      },
      tones: { visibility: "info", template: "default", editable: "info" },
    });
  });

  it("returns panelRecord with formatted overview fields and scalar outputs", async () => {
    const adapter = createProductPanelReadAdapter(owner, viewer);
    const record = panelReadResultSchemas.panelRecord.parse(await adapter.record("orders-panel"));

    expect(record).toMatchObject({
      primaryKey: "orders-panel",
      className: PRODUCT_PANEL,
      label: "Orders Overview",
      subtitle: "Tracks open orders",
      fields: {
        id: "orders-panel",
        owner: "Alice Chen",
        visibility: "Domain",
        template: "Template",
        editable: "Editable",
        revision: 3,
        objectType: PRODUCT_PANEL,
        domainShared: true,
        hiddenUsedByCount: 2,
        unavailable: false,
        unavailableReason: "",
      },
      outputs: {
        canEdit: true,
        canGrant: true,
        canDelete: true,
        isBuiltin: false,
        isTemplate: true,
        domainShared: true,
        revision: 3,
        hiddenUsedByCount: 2,
        unavailable: false,
        unavailableReason: "",
      },
    });
  });

  it("projects all member kinds including projection metadata and bindings in memberRows", async () => {
    listCurrentProductsMock.mockImplementation(async (_owner, _viewer, kind) => {
      if (kind === "projection") {
        return {
          items: [{ id: "proj-orders-list", name: "Orders Table", description: "Lists orders", componentId: "ObjectList" }],
          nextCursor: null,
          total: 1,
        };
      }
      return {
        items: [{ id: "panel-order-detail", name: "Order Detail", description: "" }],
        nextCursor: null,
        total: 1,
      };
    });

    const adapter = createProductPanelReadAdapter(owner, viewer);
    const rows = panelReadResultSchemas.panelRecordList.parse(await adapter.memberRows("orders-panel"));

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      primaryKey: "proj-orders-list",
      className: PRODUCT_PROJECTION,
      label: "Orders Table",
      subtitle: "Lists orders",
      fields: {
        slot: "list",
        kindLabel: "Projection",
        componentId: "ObjectList",
        inputs: "search: state search",
        outputs: "selected: state selected",
        target: { kind: "reference", className: PRODUCT_PROJECTION, primaryKey: "proj-orders-list", label: "Orders Table" },
      },
    });
    expect(rows[1]).toMatchObject({
      primaryKey: "panel-order-detail",
      className: PRODUCT_PANEL,
      fields: {
        slot: "child",
        kindLabel: "Panel",
        target: { kind: "reference", className: PRODUCT_PANEL, primaryKey: "panel-order-detail", label: "Order Detail" },
      },
    });
    expect(rows[2]).toMatchObject({
      primaryKey: "preview",
      fields: { slot: "preview", kindLabel: "State-chosen", target: "selected: usable" },
    });
    expect(rows[3]).toMatchObject({
      primaryKey: "content",
      fields: { slot: "content", kindLabel: "Current entry", target: "currentEntry" },
    });
  });

  it("returns normalized usedByRows and grantRows", async () => {
    const adapter = createProductPanelReadAdapter(owner, viewer);
    const usedByRows = panelReadResultSchemas.panelRecordList.parse(await adapter.usedByRows("orders-panel"));
    expect(usedByRows).toEqual([
      expect.objectContaining({
        primaryKey: "/applications/app-orders/list",
        className: APPLICATION_PANEL_USE,
        label: "Orders App",
        fields: expect.objectContaining({
          kindLabel: "Application entry",
          usageKind: "entry",
          path: "/applications/app-orders/list",
          canOpenPath: true,
          target: { kind: "reference", className: APPLICATION, primaryKey: "app-orders", label: "Orders App" },
        }),
      }),
      expect.objectContaining({
        primaryKey: "panel-home",
        className: PRODUCT_PANEL,
        label: "Operations Home",
        fields: expect.objectContaining({
          kindLabel: "Panel",
          usageKind: "panel",
          canOpenPath: false,
          target: { kind: "reference", className: PRODUCT_PANEL, primaryKey: "panel-home", label: "Operations Home" },
        }),
      }),
      expect.objectContaining({
        primaryKey: "Order",
        className: OBJECT_TYPE,
        label: "Order",
        fields: expect.objectContaining({
          kindLabel: "Object detail",
          usageKind: "class",
          canOpenPath: false,
          target: { kind: "reference", className: OBJECT_TYPE, primaryKey: "Order", label: "Order" },
        }),
      }),
    ]);

    const grantRows = panelReadResultSchemas.panelRecordList.parse(await adapter.grantRows("orders-panel"));
    expect(grantRows).toHaveLength(3);
    expect(grantRows[0]).toMatchObject({
      label: "Domain members",
      fields: { principalKind: "domain", revocable: false, verb: "use" },
    });
    expect(grantRows[1]).toMatchObject({
      label: "Alice Chen",
      subtitle: "user-1",
      fields: { principalKind: "principal", principalId: "user-1", revocable: true, verb: "edit" },
    });
    expect(grantRows[2]).toMatchObject({
      label: "Operators",
      subtitle: "role-ops",
      fields: { principalKind: "role", principalId: "role-ops", revocable: true, verb: "use" },
    });
  });

  it("lists and reads virtual panel source files for ObjectTree and ObjectTextReader", async () => {
    const adapter = createProductPanelReadAdapter(owner, viewer);
    const files = panelReadResultSchemas.panelRecordList.parse(await adapter.sourceFiles("orders-panel"));
    expect(files.map(file => file.primaryKey)).toEqual([
      "panel.html",
      "panel.mjs",
      "panel.css",
      "recipes.md",
      "messages.json",
      "manifest.json",
      "theme.json",
    ]);

    const html = panelReadResultSchemas.panelRecord.parse(await adapter.sourceFile("orders-panel", "panel.html"));
    expect(html.fields.content).toBe(samplePanel.content.html);

    const manifestFile = panelReadResultSchemas.panelRecord.parse(await adapter.sourceFile("orders-panel", "manifest.json"));
    expect(manifestFile.fields.content).toContain("proj-orders-list");

    await expect(adapter.sourceFile("orders-panel", "missing.txt")).rejects.toMatchObject({
      status: 404,
      code: "PANEL_SOURCE_FILE_NOT_FOUND",
    });
  });

  it("supports optional template flag on productPanels.copy and guards productPanels.delete availability", async () => {
    const { productCatalogServerOperations } = await import("../catalog-operations");
    const copyOp = productCatalogServerOperations.find(op => op.handlerRef === "productPanels.copy");
    const deleteOp = productCatalogServerOperations.find(op => op.handlerRef === "productPanels.delete");
    expect(copyOp).toBeDefined();
    expect(deleteOp).toBeDefined();

    copyCurrentProductMock.mockResolvedValueOnce({ id: "orders-template" });
    const actor = { owner, credentials: viewer };
    const unusedRequest = async () => { throw new Error("unexpected"); };
    const host = { initiator: actor, executor: actor, request: unusedRequest, requestWorkbench: unusedRequest, locale: "en" };

    const copied = await copyOp!.execute(
      host as never,
      { kind: "object", objectType: PRODUCT_PANEL, primaryKey: "orders-panel" } as never,
      { id: "orders-template", name: "Orders Template", template: true },
      "req-copy",
    );
    expect(copied).toMatchObject({ kind: "success", data: { id: "orders-template" } });
    expect(copyCurrentProductMock).toHaveBeenCalledWith(owner, viewer, "panel", "orders-panel", {
      id: "orders-template",
      name: "Orders Template",
      template: true,
    });

    readCataloguePanelMock.mockResolvedValueOnce({ panel: { ...samplePanel, editable: false } });
    expect(await deleteOp!.unavailable?.(host as never, { kind: "object", objectType: PRODUCT_PANEL, primaryKey: "orders-panel" }))
      .toEqual({ reason: en["panels.productCatalog.application.readOnly"] });

    expect(await deleteOp!.unavailable?.(host as never, { kind: "object", objectType: PRODUCT_PANEL, primaryKey: "orders-panel" }))
      .toBeUndefined();
  });
});
