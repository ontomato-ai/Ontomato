import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { configureI18n, tOptionalForLocale } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

const mocks = vi.hoisted(() => ({
  readCurrentAppSdkComponents: vi.fn(),
  listComponentPackages: vi.fn(),
  listVisibleDomainComponents: vi.fn(),
}));

vi.mock("../../app-builder/sdk", () => ({
  readCurrentAppSdkComponents: mocks.readCurrentAppSdkComponents,
}));

vi.mock("../../component-packages/store", () => ({
  listComponentPackages: mocks.listComponentPackages,
  readComponentPackage: vi.fn(),
}));

vi.mock("../../domain-components/store", () => ({
  listVisibleDomainComponents: mocks.listVisibleDomainComponents,
  domainComponentForProjection: vi.fn(),
  domainComponentRecord: vi.fn(),
}));

import { listSdkComponents, readSdkComponent } from "../component-catalogue";

const emptyPorts = { props: [], events: [], slots: [] };
const owner = { domainId: "domain-1", userId: "user-1" };

const officialObjectList = {
  componentId: "ObjectList",
  module: "@ontomato/sdk/base",
  exportName: "ObjectList",
  role: "control" as const,
  meaning: "Lists records in a table or card grid with search and paging.",
  effects: "Reads records through the bound list query as the signed-in user.",
  ports: emptyPorts,
};

const officialSectionGroup = {
  componentId: "SectionGroup",
  module: "@ontomato/sdk/base",
  exportName: "SectionGroup",
  role: "presentation" as const,
  meaning: "Groups page content under a heading and hairline.",
  ports: emptyPorts,
};

const thirdPartyComponent = {
  componentId: "@vendor/pkg:ObjectList",
  role: "control" as const,
  meaning: "Vendor custom list component.",
  effects: "Vendor custom read effect.",
  ports: emptyPorts,
};

const thirdPartyBareNameComponent = {
  componentId: "ObjectList",
  role: "control" as const,
  meaning: "Third-party component with bare name ObjectList.",
  effects: "Third-party bare effect.",
  ports: emptyPorts,
};

const domainComponent = {
  name: "ObjectList",
  declaration: {
    componentId: "domain-component:custom-list",
    role: "presentation" as const,
    meaning: "Domain registered list component.",
    effects: "Domain custom effect.",
    ports: emptyPorts,
  },
};

beforeAll(() => {
  configureI18n({
    defaultLocale: "zh-CN",
    appTextLocale: "zh-CN",
    languageSwitchEnabled: true,
    packs: {
      "zh-CN": {
        ...enLocaleMeta,
        messages: {
          ...en,
          "panels.sdkComponent.package": "SDK 包",
          "panels.sdkComponent.domain": "在本域登记",
          "panels.sdkComponent.meaning": "用途",
          "panels.sdkComponent.catalog.ObjectList.meaning": "以列表、表格或卡片方式展示对象记录，支持搜索、筛选与分页。",
          "panels.sdkComponent.catalog.ObjectList.effects": "以当前用户身份读取所绑定对象列表。",
          "panels.sdkComponent.catalog.SectionGroup.meaning": "按分组标题与分隔线组织页面内容。",
        },
      },
      en: {
        ...enLocaleMeta,
        messages: en,
      },
      fr: {
        ...enLocaleMeta,
        messages: {
          ...en,
        },
      },
    },
  });
});

beforeEach(() => {
  mocks.readCurrentAppSdkComponents.mockResolvedValue({
    version: "1.1.2",
    digest: "a".repeat(64),
    catalogue: {
      version: "1.1.2",
      components: [officialObjectList, officialSectionGroup],
    },
  });
  mocks.listComponentPackages.mockResolvedValue([
    {
      name: "@vendor/pkg",
      components: [thirdPartyComponent, thirdPartyBareNameComponent],
    },
  ]);
  mocks.listVisibleDomainComponents.mockResolvedValue([domainComponent]);
});

describe("tOptionalForLocale", () => {
  it("reads strictly from the requested locale without falling back to defaultLocale", () => {
    expect(tOptionalForLocale("zh-CN", "panels.sdkComponent.catalog.ObjectList.meaning"))
      .toBe("以列表、表格或卡片方式展示对象记录，支持搜索、筛选与分页。");
    // defaultLocale is zh-CN, which has the key, but en does not — must return undefined instead of falling back.
    expect(tOptionalForLocale("en", "panels.sdkComponent.catalog.ObjectList.meaning")).toBeUndefined();
    expect(tOptionalForLocale("fr", "panels.sdkComponent.catalog.ObjectList.meaning")).toBeUndefined();
    expect(tOptionalForLocale("zh-CN", "panels.sdkComponent.catalog.NonExistent.meaning")).toBeUndefined();
  });
});

describe("component-catalogue localization", () => {
  it("localizes official SDK component meaning and effects when the locale pack has entries", async () => {
    const listed = await listSdkComponents(owner, "zh-CN");
    const listEntry = listed.find(item => item.primaryKey === "@ontomato/sdk:ObjectList");
    const sectionEntry = listed.find(item => item.primaryKey === "@ontomato/sdk:SectionGroup");

    expect(listEntry?.fields.meaning).toBe("以列表、表格或卡片方式展示对象记录，支持搜索、筛选与分页。");
    expect(sectionEntry?.fields.meaning).toBe("按分组标题与分隔线组织页面内容。");

    const detail = await readSdkComponent(owner, "@ontomato/sdk:ObjectList", "zh-CN");
    expect(detail.meaning).toBe("以列表、表格或卡片方式展示对象记录，支持搜索、筛选与分页。");
    expect(detail.effects).toBe("以当前用户身份读取所绑定对象列表。");
    // Original cached object must not be mutated.
    expect(officialObjectList.meaning).toBe("Lists records in a table or card grid with search and paging.");
    expect(officialObjectList.effects).toBe("Reads records through the bound list query as the signed-in user.");

    // Components without declared effects remain without effects.
    const sectionDetail = await readSdkComponent(owner, "@ontomato/sdk:SectionGroup", "zh-CN");
    expect(sectionDetail.meaning).toBe("按分组标题与分隔线组织页面内容。");
    expect(sectionDetail.effects).toBeUndefined();
  });

  it("matches both localized and original English text when searching", async () => {
    // Search by localized Chinese meaning
    const byZhMeaning = await listSdkComponents(owner, "zh-CN", "卡片方式");
    expect(byZhMeaning.map(item => item.primaryKey)).toEqual(["@ontomato/sdk:ObjectList"]);

    // Search by localized Chinese effects
    const byZhEffects = await listSdkComponents(owner, "zh-CN", "绑定对象列表");
    expect(byZhEffects.map(item => item.primaryKey)).toEqual(["@ontomato/sdk:ObjectList"]);

    // Search by original English meaning while viewing in Chinese
    const byEnMeaning = await listSdkComponents(owner, "zh-CN", "card grid");
    expect(byEnMeaning.map(item => item.primaryKey)).toEqual(["@ontomato/sdk:ObjectList"]);

    // Search by original English effects while viewing in Chinese
    const byEnEffects = await listSdkComponents(owner, "zh-CN", "bound list query");
    expect(byEnEffects.map(item => item.primaryKey)).toEqual(["@ontomato/sdk:ObjectList"]);
  });

  it("falls back to original English text for en or locales without catalog entries", async () => {
    for (const locale of ["en", "fr"]) {
      const listed = await listSdkComponents(owner, locale);
      const listEntry = listed.find(item => item.primaryKey === "@ontomato/sdk:ObjectList");
      expect(listEntry?.fields.meaning).toBe(officialObjectList.meaning);

      const detail = await readSdkComponent(owner, "@ontomato/sdk:ObjectList", locale);
      expect(detail.meaning).toBe(officialObjectList.meaning);
      expect(detail.effects).toBe(officialObjectList.effects);
    }
  });

  it("does not apply official SDK translations to third-party or domain-registered components", async () => {
    const listed = await listSdkComponents(owner, "zh-CN");

    expect(listed.find(item => item.primaryKey === "@vendor/pkg:ObjectList")?.fields.meaning)
      .toBe(thirdPartyComponent.meaning);
    expect(listed.find(item => item.primaryKey === "ObjectList")?.fields.meaning)
      .toBe(thirdPartyBareNameComponent.meaning);
    expect(listed.find(item => item.primaryKey === "domain-component:custom-list")?.fields.meaning)
      .toBe(domainComponent.declaration.meaning);

    const vendorDetail = await readSdkComponent(owner, "@vendor/pkg:ObjectList", "zh-CN");
    expect(vendorDetail.meaning).toBe(thirdPartyComponent.meaning);
    expect(vendorDetail.effects).toBe(thirdPartyComponent.effects);

    const bareVendorDetail = await readSdkComponent(owner, "ObjectList", "zh-CN");
    expect(bareVendorDetail.meaning).toBe(thirdPartyBareNameComponent.meaning);
    expect(bareVendorDetail.effects).toBe(thirdPartyBareNameComponent.effects);

    const domainDetail = await readSdkComponent(owner, "domain-component:custom-list", "zh-CN");
    expect(domainDetail.meaning).toBe(domainComponent.declaration.meaning);
    expect(domainDetail.effects).toBe(domainComponent.declaration.effects);
  });
});
