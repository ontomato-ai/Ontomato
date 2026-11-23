import { APPLICATION } from "@ontomato/contracts/platform-object-types";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { applicationStandaloneLink, toApplicationPanelRecord } from "../application-catalogue";

beforeAll(() => configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
}));

const java = vi.hoisted(() => ({ form: vi.fn(), saveIdentity: vi.fn(), saveEntries: vi.fn() }));
vi.mock("../application-catalogue", async importOriginal => ({
  ...(await importOriginal<typeof import("../application-catalogue")>()),
  applicationCatalogueClient: () => java,
}));

const { productCatalogServerOperations } = await import("../catalog-operations");

describe("application standalone link owner read and save routing", () => {
  const baseRecord = {
    id: "app-sales",
    names: { en: "Sales" },
    descriptions: { en: "Sales pipeline" },
    icon: "pages",
    source: "domain" as const,
    canMaintain: true,
    canEditEntries: true,
    canGrant: true,
    entryCount: 1,
    entry: { path: "/applications/app-sales", renderer: "panels" },
    panelUses: [],
    groups: [],
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("emits allowStandalone=true and externalLink by default, and omits externalLink when disabled", () => {
    const enabled = toApplicationPanelRecord(baseRecord, "en");
    expect(enabled.fields.allowStandalone).toBe(true);
    expect(enabled.fieldLabels?.allowStandalone).toBe("Allow standalone open");
    expect(enabled.fields.externalLink).toBe("#/applications/app-sales?standalone=1");
    expect(enabled.fieldLabels?.externalLink).toBe("External link");

    const disabled = toApplicationPanelRecord({ ...baseRecord, allowStandalone: false }, "en");
    expect(disabled.fields.allowStandalone).toBe(false);
    expect(disabled.fields.externalLink).toBeUndefined();
    expect(disabled.fieldLabels?.externalLink).toBeUndefined();
  });

  it("derives standalone hash links for native home, product query, hosted app, and skips external jump apps", () => {
    expect(applicationStandaloneLink({
      id: "agents", entry: { path: "/agents", home: "/agents/chat", renderer: "agents" }, allowStandalone: true,
    })).toBe("#/agents/chat?standalone=1");

    expect(applicationStandaloneLink({
      id: "app-report", entry: { path: "/products/app-report?applicationId=app-report" }, allowStandalone: true,
    })).toBe("#/products/app-report?applicationId=app-report&standalone=1");

    expect(applicationStandaloneLink({
      id: "app-hosted", entry: { path: "/apps/app-hosted/" }, allowStandalone: true,
    })).toBe("#/applications/app-hosted?standalone=1");

    expect(applicationStandaloneLink({
      id: "data-governance", entry: { path: "/__external/data-governance", renderer: "data-governance" }, allowStandalone: true,
    })).toBeUndefined();

    expect(applicationStandaloneLink({
      id: "settings", entry: { path: "/settings", renderer: "settings" }, allowStandalone: false,
    })).toBeUndefined();
  });

  it("routes /allowStandalone saves through the identity endpoint instead of entries", async () => {
    const save = productCatalogServerOperations.find(op => op.handlerRef === `${APPLICATION}.save`)!;
    java.form.mockResolvedValue({
      values: { names: { en: "Sales" }, descriptions: {}, icon: "pages", allowStandalone: true },
      fields: [],
    });
    java.saveIdentity.mockResolvedValue(undefined);

    const outcome = await save.execute(
      { executor: { credentials: {} } } as never,
      { kind: "object", objectType: APPLICATION, primaryKey: "app-sales" } as never,
      { values: { allowStandalone: false }, submittedFields: ["/allowStandalone"] },
      "intent-standalone-toggle",
    );

    expect(outcome).toMatchObject({ kind: "success", data: { id: "app-sales" } });
    expect(java.saveIdentity).toHaveBeenCalledWith("app-sales", {
      names: { en: "Sales" },
      descriptions: {},
      icon: "pages",
      allowStandalone: false,
    });
    expect(java.saveEntries).not.toHaveBeenCalled();
  });
});
