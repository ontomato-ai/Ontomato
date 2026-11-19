import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { pageDraftSchema } from "@ontomato/contracts/page-draft";
import type { AgentSessionRef } from "@ontomato/contracts/agent-channel";
import { agentQuestionAnswerReceiptSchema, agentUserQuestionReceiptSchema } from "@ontomato/contracts/agent-user-questions";
import { applicationPanelUsesResponseSchema } from "@ontomato/contracts/product-panels";
import type { CreatePanelOperationIntentRequest, PanelOperationIntent, PanelOperateResponse, PanelUseRef, PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { projectionOperations, projectionPorts } from "@ontomato/contracts/panel-projection";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { config } from "../../config/application";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { HttpError } from "../../utils/errors";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { credentialsForRun, runForOwner } from "../assistant/execution";
import { readPageSkills } from "../assistant/skills";
import type { AssistantOwner } from "../assistant/store";
import { restoreAgentCaller, readAgentSessionActor } from "../agent-host/caller";
import { readCurrentPanel, readCurrentProjection } from "./current";
import { readComponentCatalogue } from "./skill-package";
import { panelServerOperation, type PanelServerOperation, type PanelOperationTarget, type PanelOperationHost } from "./server-operations";
import { panelConfirmation } from "./confirmation";
import { publishObjectChanged } from "../agent-host/presentation";
import { panelOperationStore as store } from "./operation-store";

async function admitted(owner: AssistantOwner, credentials: AssistantCredentials, runId: string, ref: PanelUseRef, operationId: string) {
  const run = await runForOwner(owner,runId);
  const response = await backendGet("panel-use",`${config.dataQuery.baseUrl}/platform/applications/${encodeURIComponent(ref.applicationId)}/panel-uses`,
    {headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  const uses = z.object({success:z.literal(true),data:applicationPanelUsesResponseSchema}).parse(JSON.parse(response.text)).data;
  const use = uses.panelUses.find(use => use.id === ref.useId);
  if (!use) throw new HttpError(403,"Panel use is not available","FORBIDDEN");
  const pages = await readPageSkills(credentials);
  const mapping = pages.pageSkills.find(mapping => "permissionCode" in use.access
    ? "permissionCode" in mapping && mapping.permissionCode === use.access.permissionCode
    : "access" in mapping && mapping.pageKey === use.pageKey);
  if (!mapping || !run.resolvedSkills.some(entry => runtimeSkillKey(entry.skill) === runtimeSkillKey(mapping.skill)))
    throw new HttpError(403,"This run does not have this panel's skill","FORBIDDEN");
  const panel = await readCurrentPanel(owner,credentials,use.panelId);
  const catalogue = await readComponentCatalogue();
  for (const [slot,declaration] of Object.entries(panel.manifest.slots)) {
    const projection = await readCurrentProjection(owner,credentials,declaration.projectionId);
    const metadata = catalogue.get(projection.componentId);
    if (!metadata) throw new HttpError(422,"Projection component is unavailable","COMPONENT_UNAVAILABLE");
    const operation = projectionOperations(panel.manifest,{slot,ports:projectionPorts(projection,metadata)}).find(op => op.id === operationId);
    if (operation) {
      const handler = panelServerOperation(operation.handlerRef);
      const targetType = operation.target?.source === "state" ? panel.manifest.state[operation.target.state] : null;
      if (!isDeepStrictEqual(projection.binding, handler.binding) || operation.kind !== handler.kind ||
        targetType?.kind !== "object" || targetType.objectType !== handler.targetType)
        throw new HttpError(422,"Operation binding or target type has no server client","OPERATION_UNAVAILABLE");
      return {run,use,panel,projection,operation,handler};
    }
  }
  throw new HttpError(422,"No supported declared operation has that ID","OPERATION_UNAVAILABLE");
}
function validateCall(handler: PanelServerOperation, call: PanelOperationIntent["call"]) {
  handler.targetSchema.parse(call.target);
  handler.inputSchema.parse(call.input);
}
function operationHost(credentials: AssistantCredentials): PanelOperationHost {
  return { request(path, init) {
    const headers = new Headers(buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey, credentials.headers));
    new Headers(init.headers).forEach((value,key) => headers.set(key,value));
    return fetch(config.dataQuery.baseUrl.replace(/\/$/u,"")+path.slice(DATA_QUERY_GATEWAY.length),{...init,redirect:"error",headers});
  }};
}
const rootOf = (run: Awaited<ReturnType<typeof runForOwner>>) => run.channel!.userRecipient?.session;
function sourceMatches(intent: PanelOperationIntent, session: AgentSessionRef) {
  if (!isDeepStrictEqual(intent.source.session,session)) throw new HttpError(403,"Intent belongs to another questioning session","FORBIDDEN");
}
function result(intent: PanelOperationIntent): PanelOperateResponse {
  return {kind:"dispatched",intentId:intent.intentId,outcome:intent.outcome};
}
export async function operatePanel(owner: AssistantOwner, credentials: AssistantCredentials, runId: string, input: CreatePanelOperationIntentRequest, initiatorName: string): Promise<PanelOperateResponse> {
  const current = await admitted(owner,credentials,runId,input,input.operationId);
  const executor = await credentialsForRun(owner,runId,credentials,current.run.sessionId);
  const source = {session:{providerId:current.run.channel!.agent.providerId,sessionId:current.run.sessionId},runId};
  const root = rootOf(current.run);
  if (!root) throw new HttpError(409,"Execution has no authenticated human session","USER_SESSION_UNAVAILABLE");
  if (current.run.channel!.authority.executionKind !== "live") throw new HttpError(422,"Management operations do not support test data","BUILD_TEST_UNSUPPORTED");
  validateCall(current.handler, input.call);
  const settings = await store.settings(owner,root);
  let intent = await store.find(owner,input.intentId);
  if (intent) {
    sourceMatches(intent,source.session);
    if (!isDeepStrictEqual(intent.use,{applicationId:input.applicationId,useId:input.useId}) || intent.operation.id !== input.operationId ||
      !isDeepStrictEqual(intent.call,input.call) || intent.executionUserId !== executor.executionUserId)
      throw new HttpError(409,"Changed call or executor requires a new intent","INTENT_CHANGED");
  } else {
    intent = await store.insert(owner,{
      intentId:input.intentId,source,rootSession:root,use:{applicationId:input.applicationId,useId:input.useId},
      panelId:current.use.panelId,projectionId:current.projection.id,binding:current.projection.binding,
      operation:current.operation,call:input.call,initiator:owner,executionUserId:executor.executionUserId,
      confirmation:settings.confirmBeforeExecute?"required":"automatic",
      questionId:settings.confirmBeforeExecute && current.operation.kind !== "form.save" ? randomUUID() : null,
      answer:null,dispatched:false,outcome:null,
    });
    // A concurrent submission must resolve to the same immutable invocation before any question or write.
    if (!isDeepStrictEqual(intent.call,input.call) || !isDeepStrictEqual(intent.source.session,source.session) ||
      !isDeepStrictEqual(intent.use,{applicationId:input.applicationId,useId:input.useId}) || intent.operation.id !== input.operationId || intent.executionUserId !== executor.executionUserId)
      throw new HttpError(409,"Changed call or executor requires a new intent","INTENT_CHANGED");
  }
  if (intent.dispatched) return result(intent);
  if (intent.confirmation === "automatic") return dispatchPanel(owner,credentials,runId,intent.intentId);
  if (intent.operation.kind === "form.save") return {kind:"draft",intentId:intent.intentId,
    draft:pageDraftSchema.parse({pageKey:current.use.pageKey,operation:intent.operation.handlerRef,target:{id:input.call.target!.kind === "object" ? input.call.target!.primaryKey : undefined},form:(current.handler as Extract<PanelServerOperation, {kind:"form.save"}>).draftInput(input.call.input)})};
  const target = intent.call.target as PanelOperationTarget;
  const confirmation = await panelConfirmation(credentials, {
    operation: intent.operation.label,
    target: await current.handler.targetLabel(operationHost(credentials),target),
    executionUserId: intent.executionUserId, initiatorName,
  });
  const question = agentUserQuestionReceiptSchema.parse(await new RuntimeClient(owner.domainId,undefined,owner.userId).request("/v1/channel/user-questions","POST",{
    source:intent.source, ...confirmation,
  },intent.questionId!));
  return {kind:"confirmation-required",intentId:intent.intentId,question};
}
export async function dispatchPanel(owner: AssistantOwner, credentials: AssistantCredentials, runId: string, id: string): Promise<PanelOperateResponse> {
  let intent = await store.get(owner,id);
  const run = await runForOwner(owner,runId);
  sourceMatches(intent,{providerId:run.channel!.agent.providerId,sessionId:run.sessionId});
  if (intent.dispatched) return result(intent);
  const executor = await credentialsForRun(owner,runId,credentials,intent.source.session.sessionId);
  if (executor.executionUserId !== intent.executionUserId) throw new HttpError(409,"Executor changed; create a new intent","INTENT_CHANGED");
  if (run.channel!.authority.executionKind !== "live") throw new HttpError(422,"Management operations do not support test data","BUILD_TEST_UNSUPPORTED");
  const current = await admitted(owner,credentials,runId,intent.use,intent.operation.id);
  if (current.use.panelId !== intent.panelId || current.projection.id !== intent.projectionId ||
    !isDeepStrictEqual(current.projection.binding,intent.binding) || !isDeepStrictEqual(current.operation,intent.operation))
    throw new HttpError(409,"Operation definition changed; create a new intent","INTENT_CHANGED");
  const client = new RuntimeClient(owner.domainId,undefined,owner.userId);
  if (intent.confirmation === "required") {
    if (!intent.questionId) return {kind:"not-dispatched",intentId:id,code:"DRAFT_REQUIRES_SAVE",message:"The reader saves this draft in its form."};
    const messages = (await client.session(run.sessionId)).messages;
    const message = messages.find(row => row.message.role === "notification" && row.message.kind === "agent-answer" &&
      row.message.replyTo === intent.questionId && "kind" in row.message.source && row.message.source.kind === "user" && row.message.answerId)?.message;
    if (!message || message.role !== "notification") return {kind:"not-dispatched",intentId:id,code:"CONFIRMATION_REQUIRED",message:"Await the initiating human's selected option."};
    const answer = agentQuestionAnswerReceiptSchema.parse(await client.request(`/v1/channel/user-questions/${intent.questionId}/answers/${message.answerId}`));
    const respondent = await restoreAgentCaller(answer.respondent,owner.domainId,true);
    if (!("kind" in answer.source) || answer.source.kind !== "user" || answer.selectedOption !== 1 ||
      !isDeepStrictEqual(answer.recipientSession,intent.rootSession) || !isDeepStrictEqual(respondent.owner,intent.initiator))
      return {kind:"not-dispatched",intentId:id,code:"NOT_APPROVED",message:"The initiating human did not select execution."};
    const {text:_text,...provenance} = answer;
    intent = {...intent,answer:provenance};
  }
  validateCall(current.handler, intent.call);
  if (!await store.claim(owner,intent)) return result(await store.get(owner,id));
  const target = intent.call.target as PanelOperationTarget;
  let outcome: PanelOperationOutcome;
  try {
    outcome = await current.handler.execute(operationHost(executor.credentials),target,intent.call.input,id);
  } catch (error) {
    // An uncertain owner call never releases the irreversible claim.
    outcome = {kind:"unknown",message:error instanceof Error?error.message:String(error)};
  }
  await store.outcome(owner,id,outcome);
  if (outcome.kind === "success")
    publishObjectChanged({
      domainId: intent.initiator.domainId,
      initiator: intent.initiator.userId,
      rootSession: intent.rootSession,
      target: { objectType: target.objectType, primaryKey: target.primaryKey },
    });
  return {kind:"dispatched",intentId:id,outcome};
}
/** Exact human owner, independent of readable/admin access and of any old run's liveness. */
export async function ownPanelSettings(owner: AssistantOwner, root: AgentSessionRef) {
  const actor = await readAgentSessionActor(root, owner.domainId);
  if (!isDeepStrictEqual((await restoreAgentCaller(actor,owner.domainId,true)).owner,owner)) throw new HttpError(403,"Only the session owner may change confirmation","FORBIDDEN");
}
