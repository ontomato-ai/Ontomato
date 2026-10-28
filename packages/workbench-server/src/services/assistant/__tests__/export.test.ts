import { describe, expect, it, vi } from "vitest";
import { exportMarkdown } from "../export";

const owner = { userId: "user-a", domainId: "domain-a" };
const files: Record<string, string> = {
  "outputs/reports/revenue/report.md": "# Revenue\n![Trend](outputs/trend.png)",
  "outputs/trend.png": "original image bytes",
};
vi.mock("../service", () => ({
  assistantService: {
    resolve: async (sessionId: string, runId: string, path: string, access: unknown) => {
      expect({ sessionId, runId, access }).toEqual({ sessionId: "session", runId: "historical-run", access: owner });
      return { artifact: { id: path, path } };
    },
    content: async (_sessionId: string, id: string) => Buffer.from(files[id]),
  },
}));
vi.mock("../store", () => ({ assistantStore: {} }));
vi.mock("../evidence", () => ({ readAssistantHistory: vi.fn() }));
vi.mock("../../analysis-agent/delivery/ppt-generator", () => ({ generatePpt: vi.fn() }));
vi.mock("../../analysis-agent/delivery/chart-renderer", () => ({ renderChartHtmlToDataUrl: vi.fn() }));

describe("assistant report export references", () => {
  it("resolves a linked report and its nested image at the same historical run", async () => {
    expect(await exportMarkdown("session", "historical-run", "[Report](outputs/reports/revenue/report.md)", owner))
      .toBe(`# Revenue\n![Trend](data:image/png;base64,${Buffer.from(files["outputs/trend.png"]).toString("base64")})`);
  });
});
