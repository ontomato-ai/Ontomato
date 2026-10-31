import { describe, expect, it, vi } from "vitest";
import { exportMarkdown } from "../export";

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
vi.mock("../store", () => ({ assistantStore: {} }));
vi.mock("../evidence", () => ({ readAssistantHistory: vi.fn() }));
vi.mock("../../analysis-agent/delivery/ppt-generator", () => ({ generatePpt: vi.fn() }));
vi.mock("../../analysis-agent/delivery/chart-renderer", () => ({ renderChartHtmlToDataUrl: vi.fn() }));

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
