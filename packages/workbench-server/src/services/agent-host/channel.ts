import {needsRetrievalScope} from "../assistant/skills";
import { recentUserMessages } from "../assistant/user-quotes";
import { OntologyRetrievalClient } from "../assistant/ontology-retrieval";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import path from "node:path";
import { isAppBuilderKind } from "../app-builder/definition";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { agentPrepareRequestSchema, agentProviderExecutionSchema, agentProviderListRequestSchema } from "@ontomato/contracts/agent-channel";
import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import { assistantService } from "../assistant/service";
import { assistantName,assistantDescription } from "../assistant/labels";
import { assistantStore } from "../assistant/store";
import { diagnosisService, createDiagnosis, requireDiagnosisAgent, prepareDiagnosis } from "../ops-diagnosis/service";
import { allowedAgents } from "../assistant/authorization";
import { restoreAgentCaller } from "./caller";
import { answerText } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { presentationCallback, releasePresentationRun, visibilityReader } from "./presentation";

export const agentChannelService = {
  async list(raw: unknown, domain: string, supplied: AssistantCredentials = {}) {
    const body = agentProviderListRequestSchema.parse(raw);
    if (!["workbench","observe"].includes(body.providerId)) throw new HttpError(404,"Agent provider not found","NOT_FOUND");
    const { owner, credentials } = await restoreAgentCaller(body.actor, domain, false, supplied);
    if (body.providerId === "workbench") {
      const agents = [];
      const enabled = (await assistantStore.channelAgents(domain)).filter(agent => agent.enabled);
      for (const agent of await allowedAgents(enabled, "USE", credentials)) {
        agents.push({ ref: { providerId: "workbench", agentId: agent.id }, name: assistantName(agent,body.language), description: assistantDescription(agent,body.language),
          ...(isAppBuilderKind(agent.kind) ? { contextSchema: { type: "object", properties: { workspaceId: { type: "string", format: "uuid" } }, required: ["workspaceId"], additionalProperties: false } } : {}) });
      }
      return { agents };
    }
    const { agents } = await diagnosisService.agents(owner, { ...credentials, locale: body.language });
    return { agents: agents.map(({ id, name, description }) => ({
      ref: { providerId: "observe", agentId: id }, name, description,
    })) };
  },
  async prepare(raw: unknown, domain: string, supplied: AssistantCredentials = {}) {
    const body = agentPrepareRequestSchema.parse(raw), restored = await restoreAgentCaller(body.actor, domain, false, supplied);
    const owner = restored.owner, credentials = { ...restored.credentials,locale: body.language };
    const provider = body.agent.providerId;
    if (provider !== "workbench" && provider !== "observe") throw new HttpError(404, "Agent provider not found", "NOT_FOUND");
    if (body.mode === "steer") {
      const service = body.agent.providerId === "observe" ? diagnosisService : assistantService;
      await service.ownRun(body.sessionId, body.runId, owner);
      if (provider === "observe") {
        await requireDiagnosisAgent(owner, credentials);
      } else {
        const session = await assistantStore.session(body.sessionId, owner);
        await assistantService.admitAgent(session.agent_id, owner, credentials, body.authority);
      }
      if (body.agent.providerId === "workbench" &&
        (body.input.role === "user" || (body.input.kind === "agent-answer" && "kind" in body.input.source && body.input.source.kind === "user"))) {
        const turn=await assistantStore.turn(body.runId,owner);
        const client=new RuntimeClient(owner.domainId,undefined,owner.userId);
        const current=await client.status(body.runId);
        if (turn.retrieval_scope_id && needsRetrievalScope(current.resolvedSkills.map(entry=>entry.skill))) {
          const messages=(await client.session(body.sessionId)).messages;
          await new OntologyRetrievalClient(owner,turn.retrieval_scope_id).updateUserQuotes(recentUserMessages(messages,body.inputId),credentials);
        }
      }
      return { accepted: true };
    }
    let prepared;
    // Legacy "observe" provider compatibility layer for `/api/observe/agent/*` and pre-migration ops_sessions.
    if (provider === "observe") {
      if (body.agent.agentId !== DIAGNOSIS_AGENT_ID) throw new HttpError(404, "Agent not found", "NOT_FOUND");
      await createDiagnosis(body.sessionId, owner, credentials, null, true, body.authority.executionKind === "preview");
      prepared = await prepareDiagnosis(body.sessionId, body.runId, body.input, owner, credentials, visibilityReader(body), body.authority);
    } else {
      prepared = await assistantService.prepare(body,owner,credentials);
    }
    const callback = presentationCallback(provider, body, owner, credentials,
      Math.min(restored.expiresAt, Date.now() + prepared.definition.sandbox.limits.wallTimeMs));
    return callback ? { ...prepared, presentationCallback: callback } : prepared;
  },
  async execution(raw: unknown, domain: string) {
    const body = agentProviderExecutionSchema.parse(raw), { owner, credentials } = await restoreAgentCaller(body.actor, domain, true);
    const service = body.execution.session.providerId === "observe" ? diagnosisService : body.execution.session.providerId === "workbench" ? assistantService : null;
    if (!service) throw new HttpError(404, "Agent provider not found", "NOT_FOUND");
    await service.ownRun(body.execution.session.sessionId, body.execution.runId, owner);
    return { body, service, owner, credentials };
  },
  async settle(raw: unknown, domain: string, _supplied: AssistantCredentials = {}) {
    const { body, owner } = await this.execution(raw, domain);
    const provider = body.execution.session.providerId;
    if (provider === "workbench" || provider === "observe") {
      releasePresentationRun(provider, owner, body.execution.runId);
    }
    if (provider === "workbench") await assistantService.settleTurn(body.execution.runId,owner,body.execution.session.sessionId);
    return { accepted: true };
  },
  async cancel(raw: unknown, domain: string, _supplied: AssistantCredentials = {}) {
    const { body, owner,credentials } = await this.execution(raw, domain);
    const provider = body.execution.session.providerId;
    if (provider === "workbench" || provider === "observe") {
      releasePresentationRun(provider, owner, body.execution.runId);
    }
    if (provider === "workbench") await assistantService.cancelScope(body.execution.runId,owner,credentials);
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
    // A reply holds its credential chain until the checks of the datasets it cited and their candidates have ended.
    const settled = status !== "running" && (body.execution.session.providerId !== "workbench"
      || await assistantService.qualitySettled(body.execution.runId, owner));
    return { settled, status, summary: answerText(snapshot) || snapshot.run.errorMessage || status,
      process: { mode: "inline", runtimeSessionId: snapshot.run.sessionId, runtimeRunId: snapshot.run.id },
      results: [],
      files:snapshot.artifacts.filter(file=>file.runId===snapshot.run.id && file.path.startsWith("outputs/")).map(file=>({id:file.id,name:path.posix.basename(file.path),mediaType:file.mediaType,href:`/platform/agent-channel/tasks/${snapshot.run.id}/files/${file.id}`})) };
  },
};
