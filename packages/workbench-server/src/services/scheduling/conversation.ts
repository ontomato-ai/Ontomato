import type { PlatformScheduleExecutionState } from "@ontomato/contracts/platform-schedules";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { runOutcome } from "../../platform/agent-runtime/projection";
import { messageText } from "../../platform/agent-runtime/runtime";
import type { AgentHostService, AgentHostOwner } from "../agent-host/types";
import { emptyExecution } from "./application";

/** The host owns the intent; the runtime owns its outcome. Status reads never start or repair a turn. */
export async function scheduledConversationStatus(host: AgentHostService, owner: AgentHostOwner, sessionId: string, runId: string, appId: string, path: string): Promise<PlatformScheduleExecutionState> {
  await host.ownRun(sessionId, runId, owner);
  const client = new RuntimeClient(owner.domainId);
  const run = await client.status(runId);
  const outcome = runOutcome(run);
  const state = emptyExecution(outcome === "cancelled" ? "failed" : outcome);
  state.handle = { sessionId };
  state.resultLink = { appId, path };
  if (outcome === "completed") {
    const reply = await client.finalReply(runId);
    state.result = reply ? messageText(reply) : "";
    state.resultSummary = state.result.slice(0, 160);
  } else if (outcome === "failed" || outcome === "cancelled") {
    state.error = { code: outcome === "cancelled" ? "cancelled" : "run_failed", message: run.errorMessage ?? `Model stopped: ${run.stopReason}` };
  }
  return state;
}
