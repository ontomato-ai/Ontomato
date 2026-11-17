import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportMarkdown } from "../export";
import { renderChartHtmlToDataUrl, renderChartOptionToDataUrl } from "../../analysis-agent/delivery/chart-renderer";

const owner = { userId: "user-a", domainId: "domain-a" };
// The current run and the historical run hold different bytes at the same path: a resolver that
// read the current run instead of the reported one would render the newer image.
const files: Record<string, string> = {
  "historical-run:outputs/trend.png": "image as exported",
  "current-run:outputs/trend.png": "image as edited later",
};
const resolved: Array<{ runId: string; path: string }> = [];
vi.mock("../service", () => ({
  assistantService: {
    resolve: async (_sessionId: string, runId: string, path: string) => {
      resolved.push({ runId, path });
      return { artifact: { id: `${runId}:${path}`, path } };
    },
    content: async (_sessionId: string, id: string) => Buffer.from(files[id]),
  },
}));
vi.mock("../../analysis-agent/delivery/chart-renderer", () => ({
  renderChartHtmlToDataUrl: vi.fn(),
  renderChartOptionToDataUrl: vi.fn(),
}));

const chartFile = (source: Array<Record<string, unknown>>) => JSON.stringify({
  dataset: [{ id: "metric", dimensions: ["name", "value"], source }],
  series: [{ id: "main", type: "pie", datasetId: "metric", encode: { itemName: "name", value: "value" } }],
  ontomato: { display: { formats: { value: { kind: "percent", scale: 100, decimals: 1 } } } },
});

beforeEach(() => {
  resolved.length = 0;
  vi.clearAllMocks();
  vi.mocked(renderChartHtmlToDataUrl).mockResolvedValue("data:image/png;base64,legacy");
  vi.mocked(renderChartOptionToDataUrl).mockResolvedValue("data:image/svg+xml;base64,chart");
});

describe("assistant report export references", () => {
  it("renders every reference from the run the caller reported, not the session's latest run", async () => {
    const markdown = await exportMarkdown(
      "session",
      "historical-run",
      "[Report](outputs/trend.png)",
      owner,
    );
    expect(markdown).toBe(
      `![Report](data:image/png;base64,${Buffer.from(files["historical-run:outputs/trend.png"]).toString("base64")})`,
    );
    expect(resolved).toEqual([{ runId: "historical-run", path: "outputs/trend.png" }]);
  });

  it("resolves a linked report and its nested image at the same run", async () => {
    files["historical-run:outputs/reports/revenue/report.md"] =
      "# Revenue\n![Trend](outputs/nested.png)";
    files["historical-run:outputs/nested.png"] = "nested bytes";
    const markdown = await exportMarkdown(
      "session",
      "historical-run",
      "[Report](outputs/reports/revenue/report.md)",
      owner,
    );
    expect(markdown).toBe(
      `# Revenue\n![Trend](data:image/png;base64,${Buffer.from("nested bytes").toString("base64")})`,
    );
  });
});

describe("assistant chart file export", () => {
  it("fills and formats a chart file for the caller's language", async () => {
    files["run:outputs/rate.chart.json"] = chartFile([{ name: "A", value: 0.25 }]);
    const markdown = await exportMarkdown(
      "session",
      "run",
      "![Rate](outputs/rate.chart.json)",
      owner,
      undefined,
      undefined,
      "de-DE",
    );
    expect(markdown).toBe("![Rate](data:image/svg+xml;base64,chart)");
    const option = vi.mocked(renderChartOptionToDataUrl).mock.calls[0][0];
    expect(option.series[0].label.formatter({ name: "A", value: 0.25 })).toContain("25,0%");
  });

  it("writes the boundary reason instead of a blank chart", async () => {
    files["run:outputs/broken.chart.json"] = chartFile([{ name: "A" }]);
    const markdown = await exportMarkdown(
      "session",
      "run",
      "![Broken](outputs/broken.chart.json)",
      owner,
    );
    expect(markdown).toContain("unavailable");
    expect(markdown).toContain("value");
    expect(renderChartOptionToDataUrl).not.toHaveBeenCalled();
  });

  it("still renders a stored plain option as it was saved", async () => {
    files["run:outputs/legacy.chart.json"] = JSON.stringify({
      xAxis: { type: "category", data: ["A"] },
      yAxis: { type: "value" },
      series: [{ type: "bar", data: [1] }],
    });
    const markdown = await exportMarkdown(
      "session",
      "run",
      "![Legacy](outputs/legacy.chart.json)",
      owner,
    );
    expect(markdown).toBe("![Legacy](data:image/png;base64,legacy)");
    expect(renderChartHtmlToDataUrl).toHaveBeenCalled();
  });
});
