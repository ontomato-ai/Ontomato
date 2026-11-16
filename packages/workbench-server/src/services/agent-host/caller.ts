import { z } from "zod";
import { randomUUID } from "node:crypto";
import { agentActorRefSchema, agentCallerIdentitySchema, type AgentActorRef } from "@ontomato/contracts/agent-channel";
import { buildBackendHeaders } from "../../utils/backend-client";
import { getApiConfig } from "../../config/data-query-api";
import { environment } from "../../config/environment";
import { getQueryTimeoutMs } from "../../config/query-settings";
import { HttpError } from "../../utils/errors";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { AgentHostOwner } from "./types";

async function platform(path: string, input: unknown, headers: Record<string,string>) {
  const response = await fetch(getApiConfig().baseUrl!.replace(/\/$/, "") + "/platform/agent-channel/" + path, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(input) });
  const body = await response.json();
  if (!response.ok) { const failure = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(body); throw new HttpError(response.status, failure.error.message, failure.error.code); }
  return body;
}
/** Captures identity and deadline only; the runtime retains the initiating credential in memory. */
export async function openAgentCaller(owner: AgentHostOwner, credentials: AssistantCredentials) {
  const id = randomUUID();
  const actor = agentActorRefSchema.parse(await platform("callers", { id, deadlineAt: new Date(Date.now() + getQueryTimeoutMs()).toISOString() }, buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey)));
  if (actor.domainId !== owner.domainId) throw new HttpError(403, "Caller credential belongs to another domain", "CROSS_DOMAIN");
  return actor;
}
export async function restoreAgentCaller(actor: AgentActorRef, domainId: string, readOnly = false, credentials: AssistantCredentials = {}) {
  if (actor.domainId !== domainId) throw new HttpError(403, "Cross-domain agent calls are forbidden", "CROSS_DOMAIN");
  const restored = agentCallerIdentitySchema.parse(await platform("restore", { actor, readOnly }, { ...buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey), "X-Domain-Id": domainId, "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken }));
  return { owner: { userId: restored.userId, domainId: restored.domainId }, credentials, expiresAt: restored.expiresAt };
}
