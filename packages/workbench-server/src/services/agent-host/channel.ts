import path from "node:path";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { agentPrepareRequestSchema, agentProviderExecutionSchema, agentProviderListRequestSchema, type AgentRunContext } from "@ontomato/contracts/agent-channel";
import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import { assistantService } from "../assistant/service";
import { assistantStore } from "../assistant/store";
import { diagnosisService, createDiagnosis, prepareDiagnosis } from "../ops-diagnosis/service";
import { restoreAgentCaller } from "./caller";
import { workbenchIdentity } from "../../identity/installed";
import { answerText } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";

async function caller(body: { actor: AgentRunContext["actor"] }, domain: string, provider?: string, readOnly = false, credentials: AssistantCredentials = {}) {
  const current = await restoreAgentCaller(body.actor, domain, readOnly, credentials);
  if (provider === "observe" && !readOnly) await workbenchIdentity().assertObserveAccess({ domainId: domain, ...current.credentials });
  return current;
}
export const agentChannelService = {
  async list(raw: unknown, domain: string, supplied: AssistantCredentials = {}) {
    const body = agentProviderListRequestSchema.parse(raw);
    if (!["workbench","observe"].includes(body.providerId)) throw new HttpError(404,"Agent provider not found","NOT_FOUND");
    const { owner, credentials } = await caller(body, domain, undefined, false, supplied);
    const agents = [];
    if (body.providerId === "workbench") {
      for (const agent of await assistantStore.agents(domain)) {
        if (!agent.enabled) continue;
        try { await assistantService.admitAgent(agent.id, owner, credentials); }
        catch (error) { if (error instanceof HttpError && error.status === 403) continue; throw error; }
        agents.push({ ref: { providerId: "workbench", agentId: agent.id }, name: agent.name, description: agent.description,
          ...(agent.kind === "app-builder" ? { contextSchema: { type: "object", properties: { workspaceId: { type: "string", format: "uuid" } }, required: ["workspaceId"], additionalProperties: false } } : {}) });
      }
      return { agents };
    }
    try {
      await workbenchIdentity().assertObserveAccess({ domainId: domain, ...credentials });
      const agent = (await diagnosisService.agents(owner)).agents[0];
      agents.push({ ref: { providerId: "observe", agentId: agent.id }, name: agent.name, description: agent.description });
    } catch (error) { if (!(error instanceof HttpError && error.status === 403)) throw error; }
    return { agents };
  },
  async prepare(raw: unknown, domain: string, supplied: AssistantCredentials = {}) {
    const body = agentPrepareRequestSchema.parse(raw), restored = await caller(body, domain, body.agent.providerId, false, supplied);
    const owner = restored.owner, credentials = { ...restored.credentials,locale: body.language };
    if (!["workbench", "observe"].includes(body.agent.providerId)) throw new HttpError(404, "Agent provider not found", "NOT_FOUND");
    if (body.authority.executionKind === "build-test" && body.requestedBy) throw new HttpError(422,"Agent delegation is not available in a build-test execution","BUILD_TEST_UNSUPPORTED");
    if (body.mode === "steer") {
      const service = body.agent.providerId === "observe" ? diagnosisService : assistantService;
      await service.ownRun(body.sessionId, body.runId, owner);
      return { accepted: true };
    }
    if (body.agent.providerId === "observe") {
      if (body.agent.agentId !== DIAGNOSIS_AGENT_ID || body.authority.executionKind !== "live") throw new HttpError(403, "Diagnosis requires live execution authority", "BUILD_TEST_FORBIDDEN");
      await createDiagnosis(body.sessionId, owner);
      return prepareDiagnosis(body.sessionId, body.runId, body.input, owner, credentials);
    }
    return assistantService.prepare(body,owner,credentials);
  },
  async execution(raw: unknown, domain: string) {
    const body = agentProviderExecutionSchema.parse(raw), { owner, credentials } = await caller(body, domain, body.execution.session.providerId, true);
    const service = body.execution.session.providerId === "observe" ? diagnosisService : body.execution.session.providerId === "workbench" ? assistantService : null;
    if (!service) throw new HttpError(404, "Agent provider not found", "NOT_FOUND");
    await service.ownRun(body.execution.session.sessionId, body.execution.runId, owner);
    return { body, service, owner, credentials };
  },
  async settle(raw: unknown, domain: string, _supplied: AssistantCredentials = {}) {
    const { body } = await this.execution(raw, domain);
    if (body.execution.session.providerId === "workbench") await assistantService.settleTurn(body.execution.runId);
    return { accepted: true };
  },
  async cancel(raw: unknown, domain: string, _supplied: AssistantCredentials = {}) {
    const { body, owner,credentials } = await this.execution(raw, domain);
    if (body.execution.session.providerId === "workbench") await assistantService.cancelScope(body.execution.runId,owner,credentials);
    return { accepted: true };
  },
  async read(raw: unknown, domain: string, _supplied: AssistantCredentials = {}) {
    const { body, service, owner } = await this.execution(raw, domain);
    if(body.fileId) {
      const artifact=await service.artifact(body.execution.session.sessionId,body.fileId,owner);
      if(artifact.runId!==body.execution.runId || !artifact.path.startsWith("outputs/")) throw new HttpError(404,"File was not delivered by this execution","NOT_FOUND");
      return service.content(body.execution.session.sessionId,body.fileId,owner);
    }
    const snapshot = await service.readRun(body.execution.session.sessionId, body.execution.runId, owner);
    const status = snapshot.run.status === "running" ? "running" : snapshot.run.stopReason === "stop" ? "completed" : snapshot.run.stopReason === "aborted" ? "cancelled" : "failed";
    return { settled: status !== "running", status, summary: answerText(snapshot) || snapshot.run.errorMessage || status,
      process: { mode: "inline", runtimeSessionId: snapshot.run.sessionId, runtimeRunId: snapshot.run.id }, results: [],quality: [],
      files:snapshot.artifacts.filter(file=>file.runId===snapshot.run.id && file.path.startsWith("outputs/")).map(file=>({id:file.id,name:path.posix.basename(file.path),mediaType:file.mediaType,href:`/platform/agent-channel/tasks/${snapshot.run.id}/files/${file.id}`})) };
  },
};
