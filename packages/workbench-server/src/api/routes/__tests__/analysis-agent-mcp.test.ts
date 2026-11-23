import express from "express";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import router, { getAnalysisAgentMcpToolCatalog } from "../analysis-agent-mcp";
import { analysisTask, startAnalysis } from "../../../services/assistant/mcp";
import { workbenchIdentity } from "../../../identity/installed";
import { HttpError } from "../../../utils/errors";

vi.mock("../../../services/assistant/store", () => ({ assistantStore: {} }));
vi.mock("../../../services/assistant/mcp", () => ({ analysisTask: vi.fn(), startAnalysis: vi.fn() }));
vi.mock("../../../identity/installed", () => ({ workbenchIdentity: vi.fn() }));
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

it("returns starting truthfully on get_analysis_task after queued run_analysis and rejects cross-owner access", async () => {
  const taskId = "22222222-2222-4222-8222-222222222222";
  const threadId = "11111111-1111-4111-8111-111111111111";
  let caller = { userId: "owner-1", domainId: "domain-a", token: "tok-1" };
  vi.mocked(workbenchIdentity).mockReturnValue({
    resolveMcpCaller: vi.fn(async () => caller),
  } as unknown as ReturnType<typeof workbenchIdentity>);
  vi.mocked(startAnalysis).mockResolvedValue({
    id: taskId,
    agentId: "analyst",
    userId: "owner-1",
    threadId,
    question: "Analyze Q1",
    status: "starting",
  });
  vi.mocked(analysisTask).mockImplementation(async (id, identity) => {
    if (id === taskId && identity.userId === "owner-1" && identity.domainId === "domain-a") {
      return {
        id: taskId,
        agentId: "analyst",
        userId: "owner-1",
        name: "Analysis",
        status: "starting",
        threadId,
        question: "Analyze Q1",
        resultSummary: "",
        resultReport: undefined,
        reportDeliverableEnabled: false,
        finalAnswer: "",
        triggerSource: "manual",
        lastRunAt: 1,
        createdAt: 1,
        updatedAt: 1,
      };
    }
    throw new HttpError(404, "Conversation not found", "NOT_FOUND");
  });

  const app = express();
  app.use(express.json());
  app.use("/mcp", router);
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    const callTool = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      });
      const raw = await response.text();
      const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
      const payload = JSON.parse(dataLine ? dataLine.slice(6) : raw);
      return JSON.parse(payload.result.content[0].text);
    };

    const submitted = await callTool("run_analysis", { agentId: "analyst", question: "Analyze Q1", threadId });
    expect(submitted).toMatchObject({ success: true, task: { id: taskId, status: "starting" } });

    const queried = await callTool("get_analysis_task", { taskId });
    expect(queried).toMatchObject({ success: true, task: { id: taskId, status: "starting", question: "Analyze Q1" } });

    caller = { userId: "other-user", domainId: "domain-a", token: "tok-2" };
    const denied = await callTool("get_analysis_task", { taskId });
    expect(denied).toMatchObject({ success: false, error: "Conversation not found" });
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
