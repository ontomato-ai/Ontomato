import { PREVIEW_WRITE_FORBIDDEN, PREVIEW_WRITE_MESSAGE } from "@ontomato/contracts/execution-context";
import { agentSessionRunIdentitiesSchema, type AgentRunIntent } from "@ontomato/contracts/agent-channel";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { AgentHostOwner } from "./types";

/**
 * A preview stops only a preview's run. Stopping a live run changes a formal run, so it is refused by the run's own
 * identity, as the runtime holds it, whoever owns the conversation.
 */
export async function requirePreviewMayStop(owner: AgentHostOwner, sessionId: string, runId: string, credentials: AssistantCredentials) {
  if (credentials.executionKind !== "preview") return;
  const intent = await new RuntimeClient(owner.domainId, undefined, owner.userId)
    .request(`/v1/channel/sessions/${sessionId}/intents/${runId}`) as AgentRunIntent;
  if (intent.channel.authority.executionKind !== "preview") throw new HttpError(422, PREVIEW_WRITE_MESSAGE, PREVIEW_WRITE_FORBIDDEN);
}

/** The identity of each run a conversation holds or has queued, as the runtime holds them. */
export async function sessionRunIdentities(owner: AgentHostOwner, sessionId: string) {
  const { runs } = agentSessionRunIdentitiesSchema.parse(await new RuntimeClient(owner.domainId, undefined, owner.userId)
    .request(`/v1/channel/sessions/${sessionId}/run-identities`));
  return new Map(runs.map(({ runId, executionKind }) => [runId, executionKind]));
}

/** A preview deletes only a conversation that holds no live run: deleting it closes and removes formal runs. */
export async function requirePreviewMayRemove(owner: AgentHostOwner, sessionId: string, credentials: AssistantCredentials) {
  if (credentials.executionKind !== "preview") return;
  if ([...(await sessionRunIdentities(owner, sessionId)).values()].some(kind => kind !== "preview"))
    throw new HttpError(422, PREVIEW_WRITE_MESSAGE, PREVIEW_WRITE_FORBIDDEN);
}
