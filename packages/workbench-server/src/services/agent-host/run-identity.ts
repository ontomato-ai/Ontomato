import { agentSessionRunIdentitiesSchema } from "@ontomato/contracts/agent-channel";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import type { AgentHostOwner } from "./types";

/** The identity of each run a conversation holds or has queued, as the runtime holds them. */
export async function sessionRunIdentities(owner: AgentHostOwner, sessionId: string) {
  const { runs } = agentSessionRunIdentitiesSchema.parse(await new RuntimeClient(owner.domainId, undefined, owner.userId)
    .request(`/v1/channel/sessions/${sessionId}/run-identities`));
  return new Map(runs.map(({ runId, executionKind }) => [runId, executionKind]));
}
