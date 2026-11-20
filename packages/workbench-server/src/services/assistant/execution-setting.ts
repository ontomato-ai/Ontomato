import { z } from "zod";
import { agentExecutionOptionsSchema } from "@ontomato/contracts/assistant-chat";
import { backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { AgentRow, AssistantOwner } from "./store";

async function internalRequest(path: string, body: object, credentials: AssistantCredentials) {
  return backendPost(`agent-execution-${path}`, `${config.dataQuery.baseUrl}/internal/agent-execution/${path}`, body, {
    ...credentials,
    headers: { ...buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey),
      "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken },
    retries: 1,
  });
}
export async function validateExecutionSetting(owner: AssistantOwner, oldExecutionUserId: string | null,
  executionUserId: string | null, credentials: AssistantCredentials) {
  await internalRequest("validate-setting", { domainId: owner.domainId, operatorId: owner.userId,
    oldExecutionUserId, executionUserId }, credentials);
}
export async function prepareExecutionSetting(owner: AssistantOwner, oldExecutionUserId: string | null,
  executionUserId: string, credentials: AssistantCredentials) {
  await internalRequest("prepare-setting", { domainId: owner.domainId, operatorId: owner.userId,
    oldExecutionUserId, executionUserId }, credentials);
}
const resolvedSchema = z.object({ executionUserId: z.string().min(1), apiKey: z.string().min(1).nullable() }).strict();
/** The definition comes from storage; run requests cannot override its execution user. */
export async function resolveAgentExecution(agent: Pick<AgentRow, "id" | "execution_user_id">, initiator: AssistantOwner,
  initiatorCredentials: AssistantCredentials): Promise<{ executionUserId: string; credentials: AssistantCredentials }> {
  const response = await internalRequest("resolve", { domainId: initiator.domainId, agentId: agent.id,
    executionUserId: agent.execution_user_id, initiatorId: initiator.userId }, initiatorCredentials);
  const resolved = resolvedSchema.parse(JSON.parse(response.text));
  return { executionUserId: resolved.executionUserId, credentials: resolved.apiKey === null ? initiatorCredentials :
    { apiKey: resolved.apiKey, locale: initiatorCredentials.locale } };
}

export async function readExecutionOptions(credentials: AssistantCredentials, selected: string | null) {
  const query = new URLSearchParams({ pageSize: "1" });
  if (selected !== null) query.set("selected", selected);
  return queryExecutionOptions(credentials, query);
}

export async function queryExecutionOptions(credentials: AssistantCredentials, query: URLSearchParams) {
  const response = await backendGet("agent-execution-options", `${config.dataQuery.baseUrl}/platform/agent-execution/options?${query}`, {
    headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey, credentials.headers),
    retries: 1,
  });
  return agentExecutionOptionsSchema.parse(JSON.parse(response.text));
}
