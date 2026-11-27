import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backendGet: vi.fn(),
  requirePanelEntry: vi.fn(),
  generatePanelPageDescription: vi.fn(),
  readCurrentPanelRecord: vi.fn(),
  homePanelId: vi.fn(),
}));

vi.mock("../../../utils/backend-client", () => ({
  backendGet: mocks.backendGet,
  buildBackendHeaders: vi.fn(() => ({})),
}));
vi.mock("../application-use", () => ({ requirePanelEntry: mocks.requirePanelEntry }));
vi.mock("../skill-package", () => ({ generatePanelPageDescription: mocks.generatePanelPageDescription }));
vi.mock("../current", () => ({ readCurrentPanelRecord: mocks.readCurrentPanelRecord }));
vi.mock("../../platform-home/store", () => ({ platformHomeStore: { homePanelId: mocks.homePanelId } }));

import { HttpError } from "../../../utils/errors";
import { readPageCatalog, readPageDescription, searchPages } from "../page-discovery";

const owner = { domainId: "domain", userId: "user" };
const credentials = { token: "token", locale: "en" };
const body = (data: unknown) => ({ text: JSON.stringify({ success: true, data }) });
const use = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  pageKey: `${id}-page`,
  panelId: `${id}-panel`,
  path: `/applications/app/${id}`,
  ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.homePanelId.mockResolvedValue(null);
});

describe("readPageCatalog", () => {
  it("lists only the applications returned by the admitted navigation projection", async () => {
    mocks.backendGet.mockResolvedValueOnce(body([
      { id: "ontology", names: { en: "Ontology" }, descriptions: { en: "Model" } },
      { id: "settings", names: { en: "Settings" } },
    ]));

    const result = await readPageCatalog(owner, credentials, {});

    expect(result).toEqual({ applications: [
      { applicationId: "ontology", name: "Ontology", description: "Model" },
      { applicationId: "settings", name: "Settings" },
    ] });
    expect(mocks.backendGet).toHaveBeenCalledTimes(1);
    expect(String(mocks.backendGet.mock.calls[0][1])).toContain("/platform/applications?purpose=navigation");
  });

  it("returns admitted groups and entries without inventing entries outside the Java detail projection", async () => {
    mocks.backendGet
      .mockResolvedValueOnce(body([{ id: "app", names: { en: "Application" } }]))
      .mockResolvedValueOnce(body({
        id: "app",
        names: { en: "Application" },
        groups: [
          { key: "main", names: { en: "Main" }, sort: 1 },
          { key: "empty", names: { en: "Empty" }, sort: 2 },
        ],
        panelUses: [
          use("grouped", { names: { en: "Grouped" }, groupKey: "main" }),
          use("loose", { names: { en: "Loose" } }),
          { id: "native", pageKey: "native", kind: "native", path: "/app/native", names: { en: "Native" }, groupKey: "main" },
        ],
      }));

    const result = await readPageCatalog(owner, credentials, { applicationId: "app" });

    expect(result.groups).toHaveLength(1);
    expect(result.groups?.[0]).toMatchObject({ key: "main" });
    expect(result.groups?.[0].entries.map(entry => entry.entryKey)).toEqual(["grouped", "native"]);
    expect(result.entries?.map(entry => entry.entryKey)).toEqual(["loose"]);
    expect(result.groups?.[0].entries[1]).toMatchObject({ panelId: null, kind: "native" });
  });

  it("refuses a catalog detail request for an application absent from admitted navigation before reading its detail", async () => {
    mocks.backendGet.mockResolvedValueOnce(body([{ id: "visible" }]));

    await expect(readPageCatalog(owner, credentials, { applicationId: "hidden" }))
      .rejects.toMatchObject({ status: 403 });
    expect(mocks.backendGet).toHaveBeenCalledTimes(1);
  });
});

describe("searchPages", () => {
  const detail = {
    id: "app",
    names: { en: "Application" },
    groups: [{ key: "main", names: { en: "Main" } }],
    panelUses: [use("target", { names: { en: "Target page" }, groupKey: "main" })],
  };
  async function admitOneApplication() {
    mocks.backendGet
      .mockResolvedValueOnce(body([{ id: "app", names: { en: "Application" } }]))
      .mockResolvedValueOnce(body(detail));
  }

  it("matches an admitted entry by its own text even when its panel is not usable", async () => {
    await admitOneApplication();
    mocks.readCurrentPanelRecord.mockRejectedValue(new HttpError(403, "No panel use", "OBJECT_FORBIDDEN"));

    const result = await searchPages(owner, credentials, { query: "target" });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      entry: { applicationId: "app", entryKey: "target", useId: "target", path: "/applications/app/target" },
      breadcrumb: ["Application", "Main", "Target page"],
    });
  });

  it("keeps the entry searchable when its panel definition is unavailable", async () => {
    await admitOneApplication();
    mocks.readCurrentPanelRecord.mockRejectedValue(new HttpError(502, "Broken panel", "SKILL_SOURCE_UNAVAILABLE"));

    const result = await searchPages(owner, credentials, { query: "target" });

    expect(result.results).toHaveLength(1);
    await admitOneApplication();
    expect((await searchPages(owner, credentials, { query: "broken panel text" })).results).toEqual([]);
  });

  it("does not match panel metadata that the initiating user cannot use", async () => {
    await admitOneApplication();
    mocks.readCurrentPanelRecord.mockRejectedValue(new HttpError(403, "No panel use", "OBJECT_FORBIDDEN"));

    const result = await searchPages(owner, credentials, { query: "secret panel" });

    expect(result.results).toEqual([]);
  });

  it("matches panel names and descriptions when panel use is allowed", async () => {
    await admitOneApplication();
    mocks.readCurrentPanelRecord.mockResolvedValue({ name: "Revenue cockpit", description: "Secret panel" });

    const result = await searchPages(owner, credentials, { query: "cockpit" });

    expect(result.results.map(({ entry }) => entry.entryKey)).toEqual(["target"]);
  });
});

describe("readPageDescription", () => {
  it("checks the exact admitted entrance then generates markdown without storing it", async () => {
    mocks.requirePanelEntry.mockResolvedValue({
      use: use("entry-1", { inputs: { tab: { literal: "active" } }, path: "/applications/app/entry-1" }),
      menu: { names: { en: "Application" } },
    });
    mocks.generatePanelPageDescription.mockResolvedValue("# Page\n\nGenerated");

    const result = await readPageDescription(owner, credentials, {
      applicationId: "app", entryKey: "entry-1", pageKey: "entry-1-page",
    });

    expect(result).toEqual({ markdown: "# Page\n\nGenerated" });
    expect(mocks.requirePanelEntry).toHaveBeenCalledWith(credentials, { applicationId: "app", useId: "entry-1" }, owner);
    expect(mocks.generatePanelPageDescription).toHaveBeenCalledWith(owner, credentials, "entry-1-panel", {
      applicationId: "app",
      useId: "entry-1",
      path: "/applications/app/entry-1",
      applicationNames: { en: "Application" },
    }, ["tab"]);
  });

  it("refuses a description when the admitted entry moved to another page key", async () => {
    mocks.requirePanelEntry.mockResolvedValue({ use: use("entry-1", { pageKey: "other-page" }), menu: {} });

    await expect(readPageDescription(owner, credentials, {
      applicationId: "app", entryKey: "entry-1", pageKey: "entry-1-page",
    })).rejects.toMatchObject({ status: 422, code: "PAGE_DESCRIPTION_UNAVAILABLE" });
    expect(mocks.generatePanelPageDescription).not.toHaveBeenCalled();
  });
});
