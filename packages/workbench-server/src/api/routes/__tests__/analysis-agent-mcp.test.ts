import { expect, it, vi } from "vitest";
import { getAnalysisAgentMcpToolCatalog } from "../analysis-agent-mcp";

vi.mock("../../../services/assistant/store", () => ({ assistantStore: {} }));
vi.mock("../../../services/assistant/mcp", () => ({ analysisTask: vi.fn(), startAnalysis: vi.fn() }));
vi.mock("../../../product/installed", () => ({
  workbenchProduct: () => ({ analysisMcpServerName: "ontomato-analysis-agents" }),
}));

it("retains the four external analysis MCP tools and their argument shapes", async () => {
  const tools = await getAnalysisAgentMcpToolCatalog();
  const inputs = Object.fromEntries(tools.map((tool) => [tool.name, tool.inputSchema]));
  expect(Object.keys(inputs).sort()).toEqual([
    "get_analysis_report_pdf", "get_analysis_task", "list_analysis_agents", "run_analysis",
  ]);
  for (const name of ["get_analysis_task", "get_analysis_report_pdf"])
    expect(inputs[name]).toMatchObject({ required: ["taskId"], properties: { taskId: { type: "string" } } });
  expect(inputs.list_analysis_agents?.properties).toEqual({});
  expect(inputs.run_analysis).toMatchObject({ required: ["agentId", "question"] });
  expect(Object.keys(inputs.run_analysis?.properties ?? {}).sort()).toEqual([
    "agentId", "apiKey", "locale", "question", "threadId",
  ]);
});
