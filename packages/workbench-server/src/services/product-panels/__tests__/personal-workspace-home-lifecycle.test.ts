import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { matchesDirectPanelValue } from "@ontomato/contracts/panel-manifest";
import { RESET_HOME_PANEL, SET_HOME_PANEL } from "@ontomato/contracts/platform-object-types";
import type { ProductPanel } from "@ontomato/contracts/product-panels";
import { components } from "../../../../../apps-sdk/src/catalogue";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { installContentLayout } from "../../../content/layout";
import { workbenchApplications } from "../../applications/builtins";

/*
 * End-to-end backend lifecycle verification for the personal workspace product panel without requiring Docker/Postgres:
 *   1. Fetch built-in `builtin-product-personal-workspace` and verify `{ applicationId: "home", useId: "home" }` resolves to it.
 *   2. Save As a modified user copy (`user-custom-home`) with preserved fixed blocks and layout personal state.
 *   3. Set as Home (`productPanels.setAsHome`) and verify `application-use`, `member-path`, `catalog-reads` (`homePanel`),
 *      and personal `grid-layout` state all resolve seamlessly to `user-custom-home`.
 *   4. Restore Default (`productPanels.resetHome`) and verify `{ applicationId: "home", useId: "home" }` immediately falls back
 *      to `builtin-product-personal-workspace`.
 */

const CUSTOM_HOME_PANEL_ID = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
  homePanelId: null as string | null,
  panels: new Map<string, ProductPanel>(),
  grantedPanelIds: new Set<string>(["builtin-product-personal-workspace", "11111111-1111-4111-8111-111111111111"]),
}));

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://java.test" } } }));

vi.mock("../../product-governance/grants", () => ({
  requireProductGrant: vi.fn(async (id: string) => {
    if (!state.grantedPanelIds.has(id)) {
      const error = new Error("Product use Grant required") as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = "PRODUCT_FORBIDDEN";
      throw error;
    }
  }),
  productGrantAllowed: vi.fn(async (id: string) => state.grantedPanelIds.has(id)),
  grantedProductIds: vi.fn(async () => [...state.grantedPanelIds]),
}));

vi.mock("../../app-builder/sdk", () => ({
  readCurrentAppSdkComponents: async () => ({
    version: "test",
    digest: "0".repeat(64),
    catalogue: {
      version: "test",
      components: components.map((component) => ({
        ...component,
        ports: { props: [], slots: [], events: [] },
      })),
    },
  }),
}));

vi.mock("../../platform-home/store", () => ({
  platformHomeStore: {
    homePanelId: vi.fn(async () => state.homePanelId),
    saveHomePanelId: vi.fn(async (_owner, panelId: string | null) => {
      state.homePanelId = panelId;
    }),
  },
}));

vi.mock("../../../infrastructure/product-current", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../infrastructure/product-current")>();
  return {
    ...actual,
    findCurrentProduct: vi.fn(async (_domainId: string, kind: string, id: string) => {
      const found = kind === "panel" ? state.panels.get(id) : undefined;
      if (!found) return undefined;
      return {
        id: found.id,
        domainId: found.id.startsWith("builtin-product-") ? null : "dom-1",
        ownerId: found.id.startsWith("builtin-product-") ? null : "user-1",
        definition: found as unknown as Record<string, unknown>,
        revision: found.revision,
        createdAt: new Date(found.createdAt),
        updatedAt: new Date(found.updatedAt),
      };
    }),
  };
});

beforeAll(() => {
  configureI18n({
    defaultLocale: "en",
    appTextLocale: "en",
    languageSwitchEnabled: false,
    packs: { en: { messages: en, ...enLocaleMeta } },
  });
  installContentLayout({
    runtimeRoot: process.cwd(),
    publicSkillsRoot: process.cwd(),
    prompts: [],
    runtimeResources: [],
  });
});

const owner = { domainId: "dom-1", userId: "user-1" };
const credentials = { token: "test-token", locale: "en" };

beforeEach(() => {
  state.homePanelId = null;
  state.panels.clear();
  const homeApp = workbenchApplications.find((app) => app.id === "home")!;
  const homeUse = homeApp.declaration.panelUses!.find((u) => u.id === "home")!;
  vi.stubGlobal("fetch", vi.fn(async () =>
    Response.json({
      success: true,
      data: {
        applicationId: "home",
        use: homeUse,
        framePanelId: homeApp.framePanelId,
        menu: { groups: [], panelUses: homeApp.declaration.panelUses },
      },
    }),
  ));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("personal workspace home panel lifecycle", () => {
  it("completes Fetch -> Save As -> Set as Home -> Restore Default cleanly", async () => {
    const { readBuiltinProducts } = await import("../builtin-products");
    const { requirePanelEntry, requirePanelUseEntry } = await import("../application-use");
    const { requireRegisteredPanelRoot } = await import("../member-path");
    const { createProductPanelReadAdapter } = await import("../catalog-reads");
    const { productCatalogServerOperations } = await import("../catalog-operations");

    // 1. Fetch built-in personal workspace panel from shipped resources.
    const packagesRoot = path.resolve(__dirname, "../../../../..");
    const bundle = await mkdtemp(path.join(tmpdir(), "pw-lifecycle-"));
    let builtinPanel: ProductPanel;
    try {
      const pwDir = path.join(packagesRoot, "platform-shell/resources/builtin-panels/personal-workspace");
      const odbDir = path.join(packagesRoot, "ontology-manager/resources/builtin-panels/object-detail-body");
      await symlink(pwDir, path.join(bundle, "personal-workspace"));
      await symlink(odbDir, path.join(bundle, "object-detail-body"));
      await writeFile(path.join(bundle, "index.json"), JSON.stringify(["personal-workspace", "object-detail-body"]));
      const { panels } = await readBuiltinProducts(bundle);
      const rawBuiltin = panels.get("builtin-product-personal-workspace")!;
      expect(rawBuiltin).toBeDefined();
      const now = new Date("2026-11-25T00:00:00Z").toISOString();
      builtinPanel = {
        ...rawBuiltin,
        id: "builtin-product-personal-workspace",
        domainId: null,
        ownerId: null,
        editable: false,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
    } finally {
      await rm(bundle, { recursive: true, force: true });
    }
    state.panels.set(builtinPanel.id, builtinPanel);

    const homeRef = { applicationId: "home", useId: "home" };
    const defaultEntry = await requirePanelEntry(credentials, homeRef, owner);
    expect(defaultEntry.use.panelId).toBe("builtin-product-personal-workspace");
    expect(defaultEntry.framePanelId).toBe("builtin-product-platform-frame");

    const defaultRoot = await requireRegisteredPanelRoot(owner, credentials, homeRef);
    expect(defaultRoot.panel.id).toBe("builtin-product-personal-workspace");

    const catalogReader = createProductPanelReadAdapter(owner, credentials);
    const defaultHomeStatus = await catalogReader.homePanel();
    expect(defaultHomeStatus.outputs).toMatchObject({ isCustomHome: false, panelId: "", unavailable: false });

    // 2. Save As a modified user copy with customized title and layout state preserved.
    const customPanel: ProductPanel = {
      ...builtinPanel,
      id: CUSTOM_HOME_PANEL_ID,
      visibility: "domain",
      domainId: "dom-1",
      ownerId: "user-1",
      editable: true,
      name: "My custom workspace",
      revision: 2,
      content: {
        ...builtinPanel.content,
        html: builtinPanel.content.html.replace("pw-shell", "pw-shell pw-custom"),
      },
    };
    state.panels.set(customPanel.id, customPanel);

    // Verify grid-layout personal state validates cleanly on the cloned custom panel.
    const customLayoutState = {
      groups: [
        {
          id: "workspace",
          items: [
            { id: "dashboards", colSpan: 12, rowSpan: 4 },
            { id: "tasks", colSpan: 6, rowSpan: 3 },
            { id: "apps", colSpan: 6, rowSpan: 3, hidden: true },
            { id: "conversations", colSpan: 4, rowSpan: 3 },
            { id: "objects", colSpan: 4, rowSpan: 3 },
            { id: "recent", colSpan: 4, rowSpan: 3 },
          ],
        },
      ],
    };
    expect(matchesDirectPanelValue(customPanel.manifest.state.layout!.type, customLayoutState)).toBe(true);

    // 3. Set as Home via the registered `productPanels.setAsHome` server operation.
    const setAsHomeOp = productCatalogServerOperations.find((op) => op.handlerRef === SET_HOME_PANEL)!;
    const resetHomeOp = productCatalogServerOperations.find((op) => op.handlerRef === RESET_HOME_PANEL)!;
    expect(setAsHomeOp).toBeDefined();
    expect(resetHomeOp).toBeDefined();

    const opHost = {
      locale: "en",
      initiator: { owner, credentials },
      executor: { owner, credentials },
    } as never;

    const setOutcome = await setAsHomeOp.execute(
      opHost,
      { kind: "object", objectType: "platform:ProductPanel", primaryKey: CUSTOM_HOME_PANEL_ID } as never,
      {},
      "intent-set-home",
    );
    expect(setOutcome.kind).toBe("success");
    expect(state.homePanelId).toBe(CUSTOM_HOME_PANEL_ID);

    const customEntry = await requirePanelEntry(credentials, homeRef, owner);
    expect(customEntry.use.panelId).toBe(CUSTOM_HOME_PANEL_ID);

    const customUseEntry = await requirePanelUseEntry(credentials, homeRef, owner);
    expect(customUseEntry.use.panelId).toBe(CUSTOM_HOME_PANEL_ID);

    const customRoot = await requireRegisteredPanelRoot(owner, credentials, homeRef);
    expect(customRoot.panel.id).toBe(CUSTOM_HOME_PANEL_ID);

    const customHomeStatus = await catalogReader.homePanel();
    expect(customHomeStatus.outputs).toMatchObject({
      isCustomHome: true,
      panelId: CUSTOM_HOME_PANEL_ID,
      unavailable: false,
    });

    // 4. Restore Default via `productPanels.resetHome`.
    const resetOutcome = await resetHomeOp.execute(opHost, null as never, {}, "intent-reset-home");
    expect(resetOutcome.kind).toBe("success");
    expect(state.homePanelId).toBeNull();

    const restoredEntry = await requirePanelEntry(credentials, homeRef, owner);
    expect(restoredEntry.use.panelId).toBe("builtin-product-personal-workspace");

    const restoredRoot = await requireRegisteredPanelRoot(owner, credentials, homeRef);
    expect(restoredRoot.panel.id).toBe("builtin-product-personal-workspace");

    const restoredHomeStatus = await catalogReader.homePanel();
    expect(restoredHomeStatus.outputs).toMatchObject({
      isCustomHome: false,
      panelId: "",
      unavailable: false,
    });
  });
});
