import { beforeAll, expect, it, vi } from "vitest";
import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { backendGet } from "../../../utils/backend-client";
import { readProductGrantRecords } from "../../product-governance/grants";
import { createApplicationReadAdapter } from "../application-catalogue";
import { createProductProjectionReadAdapter } from "../catalog-reads";

vi.mock("../component-catalogue", () => ({
  readAuthorComponentCatalogue: async () => new Map([["@ontomato/sdk:Example", {
    label: "Example",
    declaration: {
      componentId: "Example",
      data: {},
      config: [
        { name: "showHeading", type: "boolean", required: false, description: "Show the heading." },
        { name: "pageSize", type: "number", required: false, description: "Rows per page." },
        { name: "layout", type: '"table" | "cards"', required: true, description: "Display style." },
      ],
    },
  }]]),
}));
vi.mock("../../product-governance/grants", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../product-governance/grants")>(),
  readProductGrantRecords: vi.fn(),
}));
vi.mock("../../../utils/backend-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../utils/backend-client")>(),
  backendGet: vi.fn(),
}));

const owner = { domainId: "domain", userId: "reader" };
const viewer = { token: "reader-token", locale: "en" };

beforeAll(() => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], runtimeResources: [] });
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { ...enLocaleMeta, messages: en } },
  });
});

it("refreshes the projection form from the component's typed configuration and preserves existing custom values", async () => {
  const adapter = createProductProjectionReadAdapter(owner, viewer);
  const form = await adapter.createForm({
    values: { componentId: "@ontomato/sdk:Example", config: { custom: { untouched: true } } },
    changedField: "/componentId",
  });

  const checked = panelFormDescriptionSchema.parse(form);
  const field = (path: string) => checked.fields.find(item => item.path === path);
  expect(field("/componentId")).toMatchObject({ refreshOnChange: true });
  expect(field("/config/showHeading")).toMatchObject({ control: { kind: "switch" }, required: false });
  expect(field("/config/pageSize")).toMatchObject({ control: { kind: "number" } });
  expect(field("/config/layout")).toMatchObject({
    control: { kind: "select", options: [{ value: "table" }, { value: "cards" }] }, required: true,
  });
  expect(field("/config/custom")).toMatchObject({ control: { kind: "code" } });
  expect(checked.values.config).toEqual({ custom: { untouched: true } });
});

it("forwards application catalogue sorting and its opaque cursor to Java", async () => {
  vi.mocked(backendGet).mockResolvedValueOnce({
    text: JSON.stringify({ success: true, data: { rows: [] } }),
  } as Awaited<ReturnType<typeof backendGet>>);

  const adapter = createApplicationReadAdapter(owner, viewer);
  await adapter.query({ sort: "name", cursor: "name-en.app-example.QWxwaGE" });
  const request = new URL(vi.mocked(backendGet).mock.lastCall![1], "http://localhost");
  expect(request.pathname).toBe("/platform/applications/catalogue");
  expect(request.searchParams.get("sort")).toBe("name");
  expect(request.searchParams.get("cursor")).toBe("name-en.app-example.QWxwaGE");
});

it("gets application grants only for an application whose owner allows edit, with domain sharing from its use grant", async () => {
  const row = {
    id: "app-grants", names: { en: "Application" }, descriptions: { en: "" }, icon: "layout-grid",
    source: "domain", canMaintain: true, canGrant: false, canEditEntries: true, entryCount: 0,
    entry: { path: "/applications/app-grants" }, panelUses: [], groups: [],
  };
  const response = (canGrant: boolean) => ({
    text: JSON.stringify({ success: true, data: { ...row, canGrant } }),
  } as Awaited<ReturnType<typeof backendGet>>);
  vi.mocked(backendGet).mockResolvedValueOnce(response(false)).mockResolvedValueOnce(response(true));
  const grants = [
    { principalKind: "role", principalId: "reader", verb: "use" },
    { principalKind: "domain", principalId: "*", verb: "use" },
  ] as const;
  vi.mocked(readProductGrantRecords).mockResolvedValueOnce({ grants: [...grants] });

  const adapter = createApplicationReadAdapter(owner, viewer);
  await expect(adapter.grants(row.id)).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  expect(readProductGrantRecords).not.toHaveBeenCalled();
  await expect(adapter.grants(row.id)).resolves.toEqual({ grants, shared: true });
  expect(readProductGrantRecords).toHaveBeenCalledWith(row.id, viewer);
});
