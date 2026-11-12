import { expect, it, vi } from "vitest";
import { getAnalysisAgentMcpToolCatalog } from "../analysis-agent-mcp";

vi.mock("../../../services/assistant/store", () => ({ assistantStore: {} }));
vi.mock("../../../services/assistant/mcp", () => ({ analysisTask: vi.fn(), startAnalysis: vi.fn() }));
vi.mock("../../../product/installed", () => ({
  workbenchProduct: () => ({ analysisMcpServerName: "ontomato-analysis-agents" }),
}));

it("keeps the required arguments of the external analysis MCP tools", async () => {
  const tools = await getAnalysisAgentMcpToolCatalog();
  const inputs = Object.fromEntries(tools.map((tool) => [tool.name, tool.inputSchema]));
  for (const name of ["get_analysis_task", "get_analysis_report_pdf"])
    expect(inputs[name]).toMatchObject({ required: ["taskId"], properties: { taskId: { type: "string" } } });
  expect(inputs.run_analysis).toMatchObject({ required: ["agentId", "question"] });
});
