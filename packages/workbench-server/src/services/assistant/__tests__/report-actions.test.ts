import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  artifact: vi.fn(), content: vi.fn(), resolve: vi.fn(), exportMarkdown: vi.fn(), pdf: vi.fn(),
  chart: vi.fn(), datasets: vi.fn(), plan: vi.fn(), validate: vi.fn(), create: vi.fn(),
}));
vi.mock("../service", () => ({ assistantService: {
  artifact: mocks.artifact, content: mocks.content, resolve: mocks.resolve,
} }));
vi.mock("../export", () => ({ exportMarkdown: mocks.exportMarkdown }));
vi.mock("../../analysis-agent/delivery/pdf-export", () => ({ exportMarkdownPdf: mocks.pdf }));
vi.mock("../../charts/import", () => ({ prepareChartImport: mocks.chart }));
vi.mock("../../dashboard/create-from-analysis", () => ({ resolveDashboardDatasets: mocks.datasets }));
vi.mock("../../dashboard/metric-client", () => ({ DashboardMetricClient: class {} }));
vi.mock("../../dashboard/reference-planning", () => ({ planReferenceDashboard: mocks.plan }));
vi.mock("../../dashboard/validation", () => ({ validatePersonalDashboardMetrics: mocks.validate }));
vi.mock("../../dashboard/store", () => ({ createDashboard: mocks.create }));

import { createDashboardFromReport, downloadAssistantReport } from "../report-actions";

const owner = { userId: "reader", domainId: "tenant" };
const report = { id: "report", path: "outputs/reports/sales/report.md", runId: "original-run" };
const markdown = (value: string) => mocks.content.mockResolvedValue(Buffer.from(value));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.artifact.mockResolvedValue(report);
  mocks.create.mockImplementation(async input => ({ ...input, id: "saved-board" }));
});

it("exports the opened report snapshot with its original run and reference rendering", async () => {
  markdown("# Sales\n");
  mocks.exportMarkdown.mockResolvedValue("# Sales with rendered evidence");
  mocks.pdf.mockResolvedValue(Buffer.from("%PDF-"));
  await expect(downloadAssistantReport("session", report.id, owner, "zh-CN")).resolves.toEqual({
    bytes: Buffer.from("%PDF-"), fileName: "report.pdf",
  });
  expect(mocks.exportMarkdown).toHaveBeenCalledWith("session", report.runId, "# Sales\n", owner, undefined, undefined, "zh-CN", expect.any(Object));
  expect(mocks.pdf).toHaveBeenCalledWith(expect.objectContaining({ markdown: "# Sales with rendered evidence", offline: true }));
});

it("creates one board from the report's actual links and deduplicates repeated evidence", async () => {
  const dataset = "outputs/sales.dataset.json";
  const chart = "outputs/sales.chart.json";
  markdown(`# Sales\n\n![Sales chart](${chart})\n\n[Source](${dataset}) [Again](../../sales.dataset.json)\n\n` +
    "```md\n[Ignored](outputs/unrelated.dataset.json)\n```\n");
  mocks.resolve.mockImplementation(async (_session, _run, path) =>
    ({ artifact: { id: path === dataset ? "dataset" : "chart", path, runId: report.runId } }));
  mocks.chart.mockResolvedValue({
    file: { name: "sales.chart.json", content: { title: "Sales" } },
    metric: { name: "Sales" }, query: { kind: "metric", metricId: "sales" },
  });
  mocks.datasets.mockResolvedValue({ datasets: [{ datasetKey: "dataset" }] });
  mocks.plan.mockResolvedValue({ groups: [{ title: "Planned data cards", charts: [], metrics: [] }] });

  await expect(createDashboardFromReport("session", report.id, "My sales", owner, {}))
    .resolves.toEqual({ id: "saved-board", name: "My sales" });
  expect(mocks.resolve.mock.calls.map(call => call.slice(0, 3)).sort()).toEqual([
    ["session", report.runId, chart], ["session", report.runId, dataset],
  ]);
  expect(mocks.datasets).toHaveBeenCalledWith("session", ["dataset"], owner);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: "reader", domainId: "tenant",
    groups: expect.arrayContaining([
      expect.objectContaining({ charts: [expect.objectContaining({ query: { kind: "metric", metricId: "sales" } })] }),
      expect.objectContaining({ title: "Planned data cards" }),
    ]),
  }));
});

it("does not save a blank or incomplete board when report evidence is unavailable", async () => {
  markdown("# Sales\n\nNo attached data.");
  await expect(createDashboardFromReport("session", report.id, "Sales", owner, {}))
    .rejects.toMatchObject({ code: "REPORT_NO_DASHBOARD_SOURCES" });
  markdown("[Evidence](outputs/sales.dataset.json)");
  mocks.resolve.mockResolvedValue({ artifact: null });
  await expect(createDashboardFromReport("session", report.id, "Sales", owner, {}))
    .rejects.toMatchObject({ status: 404 });
  expect(mocks.create).not.toHaveBeenCalled();
});
