import { getQueryTimeoutMs } from "../../config/query-settings";
import { governancePlatformWindowSchema, governanceRuntimeStatusSchema, governanceWindowSchema } from "@ontomato/contracts/knowledge-governance";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { environment } from "../../config/environment";
import { getApiConfig } from "../../config/data-query-api";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { assistantStore, type AssistantOwner } from "./store";

const base = "/ontology/ai/knowledge-governance";
async function request(path: string, domain: string, credentials: AssistantCredentials, body: unknown) {
  const url = getApiConfig().baseUrl!.replace(/\/$/, "") + base + path;
  const options = { headers: { ...buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey),
    "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken, "X-Domain-Id": domain }, retries: 1 };
  const response = await backendPost("governance", url, body, options);
  return response.text ? JSON.parse(response.text) as unknown : null;
}
/** The host resolves persisted ownership before asking the runtime for its lightweight fact. */
export async function governanceRunStatus(sessionId: string, runId: string, domain: string) {
  const session = await assistantStore.domainSession(sessionId, domain);
  const owner = { domainId: domain, userId: session.owner_id };
  const turn = await assistantStore.turn(runId, owner);
  if (turn.session_id !== sessionId) throw new HttpError(404, "Run not found", "NOT_FOUND");
  const run = await new RuntimeClient(domain, undefined, owner.userId).status(turn.id);
  if (run.id !== turn.id || run.sessionId !== session.id) throw new HttpError(404, "Run not found", "NOT_FOUND");
  return governanceRuntimeStatusSchema.parse({ sessionId: session.id, runId: turn.id, status: run.status, stopReason: run.stopReason });
}
export async function openGovernanceWindow(sessionId: string, runId: string, recordId: string | undefined, owner: AssistantOwner, credentials: AssistantCredentials) {
  const session = await assistantStore.session(sessionId, owner), turn = await assistantStore.turn(runId, owner);
  if (turn.session_id !== session.id) throw new HttpError(404, "Run not found", "NOT_FOUND");
  if (!turn.admitted || turn.settled || session.latest_run_id !== turn.id || (await governanceRunStatus(session.id, turn.id, owner.domainId)).status !== "running")
    throw new HttpError(409, "Governance run is closed", "GOVERNANCE_RUN_CLOSED");
  const expiresAt = new Date(new Date(turn.created_at).getTime() + getQueryTimeoutMs()).toISOString();
  const binding = governancePlatformWindowSchema.parse({ recordId: recordId ?? session.id, domainId: session.domain_id, ownerId: session.owner_id,
    runtimeHostId: "workbench", sessionId: turn.session_id, runId: turn.id, expiresAt });
  const window=governanceWindowSchema.parse(await request("/platform-windows", owner.domainId, credentials, binding));
  await assistantStore.recordGovernanceWindow(runId,owner,window.id);
  return window;
}
export async function closeGovernanceWindow(runId: string, owner: AssistantOwner) {
  if (await assistantStore.governanceWindow(runId,owner))
    await request(`/platform-windows/${runId}/close`, owner.domainId, {}, {});
}

/** The ontology capability publishes its own skill namespace. */
export async function publishGovernanceSkill(domain: string) {
  await request("/skill-package", domain, {}, {});
}
