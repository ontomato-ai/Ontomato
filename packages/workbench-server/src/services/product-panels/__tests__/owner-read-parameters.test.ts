import { DASHBOARD_CARD } from "@ontomato/contracts/platform-object-types";
import { productProjectionSchema } from "@ontomato/contracts/product-panels";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { installContentLayout } from "../../../content/layout";

let readPanelData: typeof import("../registered-read-plan").readPanelData;

const mocks = vi.hoisted(() => ({
  resolveMember: vi.fn(),
  resolveRoot: vi.fn(),
  ownedCard: vi.fn(),
  locate: vi.fn(),
  read: vi.fn(),
}));

vi.mock("../member-path", async importOriginal => ({
  ...await importOriginal<typeof import("../member-path")>(),
  requireRegisteredPanelRoot: mocks.resolveRoot,
  resolvePanelMemberPath: mocks.resolveMember,
}));

vi.mock("../java-panel-reads", async importOriginal => ({
  ...await importOriginal<typeof import("../java-panel-reads")>(),
  locateViaJava: mocks.locate,
  readViaJava: mocks.read,
}));

vi.mock("../../dashboard/chart-sources", async importOriginal => ({
  ...await importOriginal<typeof import("../../dashboard/chart-sources")>(),
  createDashboardCardReadSource: () => ({
    ownedCard: mocks.ownedCard,
    ownedChartTemplate: vi.fn(),
    chartTemplate: vi.fn(),
    registeredCard: vi.fn(),
  }),
}));

beforeAll(async () => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], knowledgeRoot: process.cwd(), runtimeResources: [] });
  ({ readPanelData } = await import("../registered-read-plan"));
});

const owner = { domainId: "tenant", userId: "reader" };
const viewer = { token: "reader-token", locale: "en" };

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});
const sampleMetricOutput = {
  columns: [{ key: "body_type", label: "Type", type: "string" }, { key: "cnt", label: "Count", type: "number" }],
  rows: [{ body_type: "Planet", cnt: 3 }],
  truncation: null,
};

function makeCardChartProjection(extra?: {
  inputs?: Record<string, unknown>;
  params?: Record<string, unknown>;
}) {
  return productProjectionSchema.parse({
    id: "builtin-product-pw-card-chart-preview",
    domainId: null,
    ownerId: null,
    editable: false,
    name: "Selected chart preview",
    description: "",
    visibility: "platform",
    revision: 1,
    createdAt: "2026-11-26T00:00:00.000Z",
    updatedAt: "2026-11-26T00:00:00.000Z",
    componentId: "@ontomato/sdk:MetricChart",
    inputs: {
      target: { kind: "object", objectType: DASHBOARD_CARD },
      ...(extra?.inputs ?? {}),
    },
    outputs: {},
    config: {},
    data: {
      template: {
        source: { object: { input: "target" } },
        read: "chartTemplate",
        params: {},
      },
      result: {
        source: { object: { input: "target" } },
        read: "result",
        params: extra?.params ?? {},
      },
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveRoot.mockResolvedValue({});
  mocks.ownedCard.mockResolvedValue({ id: "card-1", valueField: "cnt", query: { metricId: "metric", parameters: {} } });
  mocks.locate.mockResolvedValue({ viewer: owner, entries: [{ kind: "ready", entry: {
    applicationId: "personal-workspace", framePanelId: "home-frame",
    use: { id: "home", names: { en: "Home" }, pageKey: "home", panelId: "home", path: "/home" },
  } }] });
  mocks.read.mockImplementation(async () => ({ viewer: owner, results: [{ status: "ready", payload: sampleMetricOutput }] }));
});

describe("owner-parameter reads with state-bound object targets", () => {
  it("does not forward the object selection target input as an owner metric parameter", async () => {
    const projection = makeCardChartProjection();
    mocks.resolveMember.mockResolvedValue({
      kind: "projection", trail: [],
      member: {
        target: { projectionId: projection.id },
        inputs: { target: { state: "selectedCard" } },
      },
      projection,
    });

    const response = await readPanelData(owner, viewer, {
      source: { kind: "frame", applicationId: "personal-workspace", useId: "home" },
      memberPath: [{ member: "cardChartPreview" }],
      dataName: "result",
      inputs: {
        target: { className: DASHBOARD_CARD, primaryKey: "dash-1:card-1" },
      },
    });

    expect(response).toMatchObject({ status: "ready" });
    expect(mocks.ownedCard).toHaveBeenCalledWith("dash-1:card-1");
    expect(mocks.read.mock.lastCall?.[1][0].call).toEqual({
      type: "platform:MetricView", name: "result", parameters: { primaryKey: "metric", parameters: {} },
    });
  });

  it("still forwards implicit owner metric parameters bound on member inputs while omitting target", async () => {
    const projection = makeCardChartProjection();
    mocks.resolveMember.mockResolvedValue({
      kind: "projection", trail: [],
      member: {
        target: { projectionId: projection.id },
        inputs: {
          target: { state: "selectedCard" },
          region: { state: "selectedRegion" },
        },
      },
      projection,
    });

    const response = await readPanelData(owner, viewer, {
      source: { kind: "frame", applicationId: "personal-workspace", useId: "home" },
      memberPath: [{ member: "cardChartPreview" }],
      dataName: "result",
      inputs: {
        target: { className: DASHBOARD_CARD, primaryKey: "dash-1:card-1" },
        region: "east",
      },
    });

    expect(response).toMatchObject({ status: "ready" });
    expect(mocks.read.mock.lastCall?.[1][0].call).toEqual({
      type: "platform:MetricView", name: "result", parameters: { primaryKey: "metric", parameters: { region: "east" } },
    });
  });

  it("forwards an explicitly mapped target read parameter when declared in data.params", async () => {
    const projection = makeCardChartProjection({
      inputs: { targetMetricParam: { kind: "scalar", type: "string" } },
      params: { target: { input: "targetMetricParam" } },
    });
    mocks.resolveMember.mockResolvedValue({
      kind: "projection", trail: [],
      member: {
        target: { projectionId: projection.id },
        inputs: {
          target: { state: "selectedCard" },
          targetMetricParam: { state: "selectedTargetLabel" },
        },
      },
      projection,
    });

    const response = await readPanelData(owner, viewer, {
      source: { kind: "frame", applicationId: "personal-workspace", useId: "home" },
      memberPath: [{ member: "cardChartPreview" }],
      dataName: "result",
      inputs: {
        target: { className: DASHBOARD_CARD, primaryKey: "dash-1:card-1" },
        targetMetricParam: "Q4",
      },
    });

    expect(response).toMatchObject({ status: "ready" });
    expect(mocks.read.mock.lastCall?.[1][0].call).toEqual({
      type: "platform:MetricView", name: "result", parameters: { primaryKey: "metric", parameters: { target: "Q4" } },
    });
  });
});
