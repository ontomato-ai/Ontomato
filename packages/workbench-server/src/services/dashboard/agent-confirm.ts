import { randomUUID } from "node:crypto";
import { z } from "zod";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { runForOwner } from "../assistant/execution";
import type { AssistantOwner } from "../assistant/store";
import { panelConfirmation } from "../product-panels/confirmation";
import { panelOperationStore } from "../product-panels/operation-store";
import { getOwnedDashboard } from "./access";

const text = z.string().trim().min(1);

export const dashboardAgentConfirmOperationSchema = z.enum(["board.save", "card.parameters.save"]);
export type DashboardAgentConfirmOperation = z.infer<typeof dashboardAgentConfirmOperationSchema>;

export const dashboardAgentConfirmRequestSchema = z.object({
  dashboardId: text,
  operation: dashboardAgentConfirmOperationSchema,
  targetLabel: text.max(200),
  impactSummary: text.max(1000).optional(),
  agentRun: z.object({
    sessionId: text,
    runId: text,
    toolCallId: text,
  }).strict(),
}).strict();
export type DashboardAgentConfirmRequest = z.infer<typeof dashboardAgentConfirmRequestSchema>;

export interface DashboardAgentConfirmResponse {
  intentId: string;
  autoMode: boolean;
  questionId: string | null;
  label: string;
}

const OPERATION_LABELS: Record<DashboardAgentConfirmOperation, string> = {
  "board.save": "Save dashboard changes",
  "card.parameters.save": "Save card parameters",
};

/**
 * Prepares confirmation for an agent-driven save on the live dashboard page.
 * Validates ownership of both the dashboard and the active live run, reads the root
 * session's `confirmBeforeExecute` preference, and in default mode publishes a standard
 * conversation confirmation prompt without exposing edited field values.
 */
export async function prepareDashboardAgentConfirm(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  input: DashboardAgentConfirmRequest,
  callerUserName?: string,
): Promise<DashboardAgentConfirmResponse> {
  const detail = await getOwnedDashboard(owner.userId, owner.domainId, input.dashboardId);
  const run = await runForOwner(owner, input.agentRun.runId);
  if (!run.channel || run.status !== "running") {
    throw new HttpError(409, "Execution is closed", "RUN_CLOSED");
  }
  if (run.sessionId !== input.agentRun.sessionId) {
    throw new HttpError(403, "Run session mismatch", "FORBIDDEN");
  }
  const root = run.channel.userRecipient?.session;
  if (!root) {
    throw new HttpError(409, "Execution has no authenticated human session", "USER_SESSION_UNAVAILABLE");
  }
  if (run.channel.authority.executionKind !== "live") {
    throw new HttpError(422, "Dashboard operations do not support test data", "BUILD_TEST_UNSUPPORTED");
  }

  const settings = await panelOperationStore.settings(owner, root);
  const autoMode = !settings.confirmBeforeExecute;
  const intentId = randomUUID();
  const questionId = autoMode ? null : randomUUID();
  const label = OPERATION_LABELS[input.operation];

  if (!autoMode && questionId) {
    const prompt = await panelConfirmation(credentials, {
      operation: label,
      target: input.targetLabel || detail.name,
      impactSummary: input.impactSummary,
      executionUserId: null,
      initiatorName: callerUserName ?? owner.userId,
    });
    await new RuntimeClient(owner.domainId, undefined, owner.userId).request(
      "/v1/channel/user-questions",
      "POST",
      {
        source: {
          session: { providerId: run.channel.agent.providerId, sessionId: run.sessionId },
          runId: input.agentRun.runId,
        },
        ...prompt,
      },
      questionId,
    );
  }

  return { intentId, autoMode, questionId, label };
}
