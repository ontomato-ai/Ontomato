import { Request } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { workbenchIdentity } from "../../identity/installed";
import { workbenchProduct } from "../../product/installed";
import { createLogger } from "../../logging/logger";
import { tApp } from "../../i18n";
import { randomUUID } from "node:crypto";
import { createDiagnosis, diagnosisService } from "../../services/ops-diagnosis/service";
import type { AgentHostOwner } from "../../services/agent-host/types";
import { messageText } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import {
  catalogRequest,
  createStreamableMcpRouter,
  listMcpServerTools,
  textJson,
  withMcpIdentity,
} from "../utils/mcp-route";

export const OPS_AGENT_MCP_TIMEOUT_MS = 50_000;
const logger = createLogger("api:ops-agent-mcp");

async function waitForTurnResult(sessionId: string, owner: AgentHostOwner, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const history = await diagnosisService.snapshot(sessionId, owner), run = history.latestRun;
    if (!run) return { status: "completed" as const, sessionId, answer: "" };
    if (run.run.status === "stopped") {
      if (run.run.stopReason === "error" || run.run.stopReason === "aborted") return { status: "failed" as const, sessionId, error: run.run.errorMessage || "Diagnosis stopped" };
      const last = [...run.messages].reverse().find((m) => m.message.role === "assistant");
      return { status: "completed" as const, sessionId, answer: last ? messageText(last.message) : "" };
    }
    if (Date.now() >= deadline) return { status: "running" as const, sessionId };
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))));
  }
}

export function createOpsAgentMcpServer(
  req: Request,
  timeoutMs: number = OPS_AGENT_MCP_TIMEOUT_MS
) {
  const product = workbenchProduct();
  const server = new McpServer({ name: product.opsMcpServerName, version: "1.0.0" });

  server.registerTool(
    "send",
    {
      title: tApp("diag.observe.agent.mcp.send.title"),
      description: tApp("diag.observe.agent.mcp.send.description"),
      inputSchema: {
        message: z.string().optional().describe(tApp("diag.observe.agent.mcp.send.message")),
        sessionId: z.string().optional().describe(tApp("diag.observe.agent.mcp.send.sessionId")),
      },
    },
    async ({ message, sessionId }) =>
      withMcpIdentity(
        req,
        async (identity) => {
          const trimmedSessionId = sessionId?.trim();
          const trimmedMessage = message?.trim();

          try {
            let targetSessionId = trimmedSessionId;
            if (trimmedMessage) {
              if (!targetSessionId) targetSessionId = (await createDiagnosis(randomUUID(), identity)).session.id;
              await diagnosisService.start(targetSessionId, randomUUID(), trimmedMessage, identity, identity);
            }
            if (!targetSessionId) return textJson({ success: false, code: "INVALID_CHAT_INPUT", error: tApp("diag.observe.agent.mcp.error.messageRequired") });
            return textJson(await waitForTurnResult(targetSessionId, identity, timeoutMs));
          } catch (error) {
            const code = error instanceof HttpError ? error.status === 404 ? "SESSION_NOT_FOUND" : error.code === "SESSION_BUSY" ? "RESPONSE_BUSY" : error.code ?? "DEPENDENCY_UNAVAILABLE" : "DEPENDENCY_UNAVAILABLE";
            return textJson({ success: false, code, error: error instanceof HttpError ? error.message : "Diagnosis service is unavailable" });
          }
        },
        {
          authorize: (caller) => workbenchIdentity().assertObserveAccess(caller),
        }
      )
  );

  return server;
}

export async function getOpsAgentMcpToolCatalog() {
  return listMcpServerTools(createOpsAgentMcpServer(catalogRequest()), "ops-agent-catalog");
}

export function createOpsAgentMcpRouter(options?: { timeoutMs?: number }) {
  return createStreamableMcpRouter(
    (req) => createOpsAgentMcpServer(req, options?.timeoutMs),
    logger
  );
}

export default createOpsAgentMcpRouter();
