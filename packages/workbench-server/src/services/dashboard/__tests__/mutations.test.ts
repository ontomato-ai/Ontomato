import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../i18n", () => ({ t: (key: string) => key, tApp: (key: string) => key }));
vi.mock("../../charts/import", () => ({ prepareChartImport: vi.fn() }));
vi.mock("../create-from-analysis", () => ({ resolveDashboardDatasets: vi.fn() }));

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  saveDashboard: vi.fn(),
}));

vi.mock("../store", () => ({
  createDashboard: vi.fn(),
  deleteDashboard: vi.fn(),
  getDashboard: mocks.getDashboard,
  saveDashboard: mocks.saveDashboard,
}));

import { renameDashboardChart, renameDashboardMetric } from "../mutations";

const baseDashboard = () => ({
  id: "d1",
  ownerId: "owner-1",
  name: "Sales",
  createdAt: 0,
  updatedAt: 0,
  groups: [
    {
      id: "g1",
      title: "Overview",
      charts: [
        {
          id: "c1",
          name: "Revenue",
          query: { kind: "metric" as const, metricId: "m1", parameters: {} },
          chartFile: { name: "a.chart.json", content: { dataset: [], series: [], ontomato: {} } },
        },
      ],
      metrics: [
        {
          id: "n1",
          name: "Total",
          query: { kind: "metric" as const, metricId: "m2", parameters: {} },
          valueField: "total",
        },
      ],
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDashboard.mockImplementation(async () => baseDashboard());
  mocks.saveDashboard.mockResolvedValue(undefined);
});

describe("dashboard card rename mutations", () => {
  it("throws 404 NOT_FOUND and does not save when renaming a missing chart card", async () => {
    await expect(
      renameDashboardChart("owner-1", "domain-1", {
        id: "d1",
        chartId: "c-deleted",
        resultSetName: "Renamed",
      }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND", message: "Card not found" });
    expect(mocks.saveDashboard).not.toHaveBeenCalled();
  });

  it("throws 404 NOT_FOUND and does not save when renaming a missing metric card", async () => {
    await expect(
      renameDashboardMetric("owner-1", "domain-1", {
        id: "d1",
        metricId: "n-deleted",
        metricName: "Renamed",
      }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND", message: "Card not found" });
    expect(mocks.saveDashboard).not.toHaveBeenCalled();
  });

  it("renames existing chart and metric cards and saves", async () => {
    await renameDashboardChart("owner-1", "domain-1", {
      id: "d1",
      chartId: "c1",
      resultSetName: "Revenue v2",
    });
    expect(mocks.saveDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.saveDashboard.mock.calls[0]?.[2].groups[0].charts[0].name).toBe("Revenue v2");

    await renameDashboardMetric("owner-1", "domain-1", {
      id: "d1",
      metricId: "n1",
      metricName: "Total v2",
    });
    expect(mocks.saveDashboard).toHaveBeenCalledTimes(2);
    expect(mocks.saveDashboard.mock.calls[1]?.[2].groups[0].metrics[0].name).toBe("Total v2");
  });
});
