import type { AgentExecutionActorRef } from "@ontomato/contracts/agent-channel";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { HttpError } from "../../utils/errors";
import {buildBackendHeaders} from "../../utils/backend-client";
import { resolveAgentExecution } from "./execution-setting";
import { assistantStore, type AssistantOwner } from "./store";

/** A run freezes the selected user, not that user's key or permission snapshot. */
export async function agentExecutionCredentials(agentId: string, executionUserId: string | null,
  initiator: AssistantOwner, initiatorCredentials: AssistantCredentials): Promise<AssistantCredentials> {
  if (executionUserId === null) return {...initiatorCredentials, executionUserId: null};
  return {...(await resolveAgentExecution({ id: agentId, execution_user_id: executionUserId }, initiator, initiatorCredentials)).credentials, executionUserId};
}

export function executionActor(executionUserId: string | null, domainId: string): AgentExecutionActorRef | null {
  return executionUserId === null ? null : { userId: executionUserId, domainId };
}

/** Callback ownership is checked before reading the fixed, non-secret runtime fact. */
export async function credentialsForRun(owner: AssistantOwner, runId: string, initiatorCredentials: AssistantCredentials, sessionId?: string) {
  const run = await runForOwner(owner,runId);
  if (!run.channel || run.status !== "running") throw new HttpError(409, "Execution is closed", "RUN_CLOSED");
  if(sessionId!==undefined && run.sessionId!==sessionId)throw new HttpError(403,"Callback session does not match the run","PROFILE_CONTEXT_REQUIRED");
  const executionUserId = run.executionUserId ?? null;
  const credentials = await agentExecutionCredentials(run.channel.agent.agentId, executionUserId, owner, initiatorCredentials);
  return { executionUserId, credentials: executionCallerCredentials(credentials,run.id) };
}

export async function credentialsForDefinition(owner: AssistantOwner, agentId: string, credentials: AssistantCredentials) {
  const agent = await assistantStore.agent(agentId, owner);
  if(!agent.enabled)throw new HttpError(409,"Agent disabled","AGENT_DISABLED");
  return agentExecutionCredentials(agentId, agent.execution_user_id, owner, credentials);
}

export function executionCallerCredentials(credentials:AssistantCredentials,callerId:string):AssistantCredentials {
  return {...credentials,headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey,
    {...credentials.headers,"X-Ontomato-Retrieval-Caller-Id":callerId})};
}

export async function runForOwner(owner:AssistantOwner,runId:string) {
  await assistantStore.turn(runId,owner);
  return (await new RuntimeClient(owner.domainId,undefined,owner.userId).run(runId)).run;
}
