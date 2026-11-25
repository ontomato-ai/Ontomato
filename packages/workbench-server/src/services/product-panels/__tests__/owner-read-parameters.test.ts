import { DASHBOARD_CARD } from "@ontomato/contracts/platform-object-types";
import { productProjectionSchema } from "@ontomato/contracts/product-panels";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { readProductPanelData } from "../data-reads";

const mocks = vi.hoisted(() => ({
  resolveMember: vi.fn(),
  resolveRoot: vi.fn(),
  ownedResult: vi.fn(),
}));

vi.mock("../member-path", () => ({
  requireRegisteredPanelRoot: mocks.resolveRoot,
  resolvePanelMemberPath: mocks.resolveMember,
}));

vi.mock("../../dashboard/chart-sources", () => ({
  createDashboardCardReadAdapter: () => ({
    ownedResult: mocks.ownedResult,
    ownedChartTemplate: vi.fn(),
    result: vi.fn(),
    chartTemplate: vi.fn(),
  }),
}));

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
  mocks.ownedResult.mockResolvedValue(sampleMetricOutput);
});

describe("owner-parameter reads with state-bound object targets", () => {
  it("does not forward the object selection target input as an owner metric parameter", async () => {
    const projection = makeCardChartProjection();
    mocks.resolveMember.mockResolvedValue({
      kind: "projection",
      member: {
        target: { projectionId: projection.id },
        inputs: { target: { state: "selectedCard" } },
      },
      projection,
    });

    const response = await readProductPanelData(owner, viewer, {
      source: { kind: "frame", applicationId: "personal-workspace", useId: "home" },
      memberPath: [{ member: "cardChartPreview" }],
      dataName: "result",
      inputs: {
        target: { className: DASHBOARD_CARD, primaryKey: "dash-1:card-1" },
      },
    });

    expect(response.status).toBe("ready");
    expect(mocks.ownedResult).toHaveBeenCalledTimes(1);
    expect(mocks.ownedResult).toHaveBeenCalledWith("dash-1:card-1", {});
  });

  it("still forwards implicit owner metric parameters bound on member inputs while omitting target", async () => {
    const projection = makeCardChartProjection();
    mocks.resolveMember.mockResolvedValue({
      kind: "projection",
      member: {
        target: { projectionId: projection.id },
        inputs: {
          target: { state: "selectedCard" },
          region: { state: "selectedRegion" },
        },
      },
      projection,
    });

    const response = await readProductPanelData(owner, viewer, {
      source: { kind: "frame", applicationId: "personal-workspace", useId: "home" },
      memberPath: [{ member: "cardChartPreview" }],
      dataName: "result",
      inputs: {
        target: { className: DASHBOARD_CARD, primaryKey: "dash-1:card-1" },
        region: "east",
      },
    });

    expect(response.status).toBe("ready");
    expect(mocks.ownedResult).toHaveBeenCalledTimes(1);
    expect(mocks.ownedResult).toHaveBeenCalledWith("dash-1:card-1", { region: "east" });
  });

  it("forwards an explicitly mapped target read parameter when declared in data.params", async () => {
    const projection = makeCardChartProjection({
      inputs: { targetMetricParam: { kind: "scalar", type: "string" } },
      params: { target: { input: "targetMetricParam" } },
    });
    mocks.resolveMember.mockResolvedValue({
      kind: "projection",
      member: {
        target: { projectionId: projection.id },
        inputs: {
          target: { state: "selectedCard" },
          targetMetricParam: { state: "selectedTargetLabel" },
        },
      },
      projection,
    });

    const response = await readProductPanelData(owner, viewer, {
      source: { kind: "frame", applicationId: "personal-workspace", useId: "home" },
      memberPath: [{ member: "cardChartPreview" }],
      dataName: "result",
      inputs: {
        target: { className: DASHBOARD_CARD, primaryKey: "dash-1:card-1" },
        targetMetricParam: "Q4",
      },
    });

    expect(response.status).toBe("ready");
    expect(mocks.ownedResult).toHaveBeenCalledTimes(1);
    expect(mocks.ownedResult).toHaveBeenCalledWith("dash-1:card-1", { target: "Q4" });
  });
});
