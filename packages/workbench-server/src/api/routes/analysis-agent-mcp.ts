import { assistantStore } from "../../services/assistant/store";
import { createLogger } from "../../logging/logger";
import { Request } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analysisTask, startAnalysis } from "../../services/assistant/mcp";
import { workbenchProduct } from "../../product/installed";
import {
  analysisAgentPublicServiceRoot,
  analysisReportPdfDownloadUrl,
} from "../../services/mcp/catalog";
import {
  catalogRequest,
  createStreamableMcpRouter,
  listMcpServerTools,
  textJson,
  withMcpIdentity,
} from "../utils/mcp-route";
function createAnalysisAgentMcpServer(req: Request) {
  const server = new McpServer({
    name: workbenchProduct().analysisMcpServerName,
    version: "1.0.0",
  });
  server.registerTool(
    "list_analysis_agents",
    {
      title: "List Agents",
      description: "List enabled business agents.",
      inputSchema: {},
    },
    async () =>
      withMcpIdentity(req, async (identity) => {
        const agents = await assistantStore.agents(identity.domainId);
        return textJson({
          agents: agents
            .filter((a) => a.enabled)
            .map((a) => ({
              id: a.id,
              name: a.name,
              description: a.description,
              icon: a.icon,
              enabledSkillIds: a.skills.map((s) => s.name),
              enabledVisualizationSkillIds: [],
            })),
        });
      }),
  );
  server.registerTool(
    "get_analysis_task",
    {
      title: "Get Analysis Task",
      description: "Read a submitted analysis run.",
      inputSchema: { taskId: z.string().min(1) },
    },
    async ({ taskId }) =>
      withMcpIdentity(req, async (identity) =>
        textJson({ success: true, task: await analysisTask(taskId, identity) }),
      ),
  );
  server.registerTool(
    "get_analysis_report_pdf",
    {
      title: "Get Analysis Report PDF",
      description:
        "Return the authenticated PDF download URL for a report file.",
      inputSchema: { taskId: z.string().min(1) },
    },
    async ({ taskId }) =>
      withMcpIdentity(req, async (identity) => {
        const task = await analysisTask(taskId, identity);
        return textJson(
          task.resultReport
            ? {
                success: true,
                downloadUrl: analysisReportPdfDownloadUrl(
                  analysisAgentPublicServiceRoot(req),
                  taskId,
                ),
              }
            : { success: false, error: "No analysis report to export" },
        );
      }),
  );
  server.registerTool(
    "run_analysis",
    {
      title: "Run Analysis",
      description:
        "Start an ordinary assistant run and poll get_analysis_task.",
      inputSchema: {
        agentId: z.string().min(1),
        question: z.string().min(1),
        threadId: z.string().optional(),
        apiKey: z.string().min(1).optional(),
        locale: z.string().optional(),
      },
    },
    async ({ agentId, question, threadId, apiKey, locale }) =>
      withMcpIdentity(
        req,
        async (identity) =>
          textJson({
            success: true,
            message:
              "Analysis task submitted. Use get_analysis_task to poll status and results.",
            task: await startAnalysis(agentId, question, threadId, identity, {
              token: identity.token,
              apiKey: identity.apiKey,
              locale,
            }),
          }),
        { toolApiKey: apiKey },
      ),
  );
  return server;
}
const router = createStreamableMcpRouter(
  createAnalysisAgentMcpServer,
  createLogger("analysis-mcp"),
);
export default router;
export async function getAnalysisAgentMcpToolCatalog() {
  return listMcpServerTools(
    createAnalysisAgentMcpServer(catalogRequest()),
    "analysis-agent-catalog",
  );
}
