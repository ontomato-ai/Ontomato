import { randomUUID } from "node:crypto";
import type {
  DashboardAgentConfirmOperation, DashboardAgentConfirmRequest, DashboardAgentConfirmResponse,
} from "@ontomato/contracts/dashboard";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { hasActivePresentationForRun, isLivePresentationEligibleRun } from "../agent-host/presentation";
import { runForOwner } from "../assistant/execution";
import type { AssistantOwner } from "../assistant/store";
import { panelConfirmation } from "../product-panels/confirmation";
import { panelOperationStore } from "../product-panels/operation-store";
import { getOwnedDashboard } from "./access";

const OPERATION_LABELS: Record<DashboardAgentConfirmOperation, string> = {
  "board.save": "Save dashboard changes",
  "card.parameters.save": "Save card parameters",
  "card.parameters.discard": "Discard card parameter changes",
};

/**
 * Prepares confirmation for an agent-driven edit action on the live dashboard page.
 * Validates dashboard and run ownership, then asks when the root session prefers
 * confirmation or the action requires it. The prompt omits edited field values.
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
  if (!isLivePresentationEligibleRun({
    host: "workbench",
    owner,
    runId: run.id,
    sessionId: run.sessionId,
    channel: run.channel,
  })) {
    throw new HttpError(403, "Run is not eligible for live dashboard confirmation", "FORBIDDEN");
  }
  if (!hasActivePresentationForRun("workbench", owner, run.id)) {
    throw new HttpError(409, "No active live presentation view is connected for this run", "VIEW_UNAVAILABLE");
  }

  const settings = await panelOperationStore.settings(owner, root);
  const autoMode = input.requireConfirmation ? false : !settings.confirmBeforeExecute;
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
