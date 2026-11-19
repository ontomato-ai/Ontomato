import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { pageDraftSchema } from "@ontomato/contracts/page-draft";
import type { AgentSessionRef } from "@ontomato/contracts/agent-channel";
import { agentQuestionAnswerReceiptSchema, agentUserQuestionReceiptSchema } from "@ontomato/contracts/agent-user-questions";
import { applicationPanelUsesResponseSchema } from "@ontomato/contracts/product-panels";
import {
  PANEL_CONFIRMATION_EXPIRED,
  type CreatePanelOperationIntentRequest, type PanelOperationIntent, type PanelOperateResponse,
  type PanelUseRef, type PanelOperationOutcome, type StoredPanelOperationIntent,
} from "@ontomato/contracts/panel-agent";
import type { PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import { projectionOperations, projectionPorts } from "@ontomato/contracts/panel-projection";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { environment } from "../../config/environment";
import { assistantService } from "../assistant/service";
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
import { panelServerOperation, snapshotPanelWrite, type PanelServerOperation, type PanelOperationHost, type PanelRecordTarget } from "./server-operations";
import { panelConfirmation } from "./confirmation";
import { publishObjectChanged } from "../agent-host/presentation";
import { panelOperationStore as store } from "./operation-store";

type PanelRun = Awaited<ReturnType<typeof runForOwner>>;
type SingleIntent = Extract<PanelOperationIntent, { call: PanelOperationCall }>;
type ReadableIntent = Extract<StoredPanelOperationIntent, { intent: unknown }>["intent"];

async function admitted(owner: AssistantOwner, credentials: AssistantCredentials, run: PanelRun, ref: PanelUseRef, operationId: string) {
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
  const catalogue = await readComponentCatalogue(panel.sdkVersion);
  for (const [slot,declaration] of Object.entries(panel.manifest.slots)) {
    const projection = await readCurrentProjection(owner,credentials,declaration.projectionId);
    const metadata = catalogue.get(projection.componentId);
    if (!metadata) throw new HttpError(422,"Projection component is unavailable","COMPONENT_UNAVAILABLE");
    const ports = projectionPorts(projection, metadata);
    const operation = projectionOperations(panel.manifest, { slot, ports }).find(op => op.id === operationId);
    if (operation) {
      const handler = panelServerOperation(operation.handlerRef);
      let targetMatches = operation.target?.source === "draft" && operation.target.slot === slot;
      if (handler.kind === "action") {
        const binding = declaration.inputs[handler.targetInput];
        const targetType = binding && panel.manifest.state[binding.state];
        const inputType = ports.inputs[handler.targetInput];
        targetMatches = inputType?.kind === "object" && inputType.objectType === handler.targetType &&
          targetType?.kind === "object" && targetType.objectType === handler.targetType;
      }
      if (!isDeepStrictEqual(projection.binding, handler.binding) || operation.kind !== handler.kind || !targetMatches)
        throw new HttpError(422,"Operation binding or target type has no server client","OPERATION_UNAVAILABLE");
      return { use, projection, operation: snapshotPanelWrite(handler, operation, slot), handler };
    }
  }
  throw new HttpError(422,"No supported declared operation has that ID","OPERATION_UNAVAILABLE");
}
function validateCall(handler: PanelServerOperation, call: PanelOperationCall) {
  const target = handler.targetSchema.parse(call.target);
  handler.inputSchema.parse(call.input);
  if (handler.kind === "form.save") handler.draftInput(call.input);
  if (call.draft && (handler.kind !== "form.save" || !handler.create || target.kind !== "draft"))
    throw new HttpError(400, "A creation draft requires a create target", "INVALID_REQUEST");
  return target;
}
async function verifyCreationDraft(intent: SingleIntent, handler: PanelServerOperation, pageKey: string) {
  const link = intent.call.draft;
  if (!link || handler.kind !== "form.save" || !handler.create || intent.call.target?.kind !== "draft") return;
  const draft = await assistantService.pageDraft(link.sessionId, link.runId, link.path, intent.initiator);
  if (draft.created || draft.target.id !== undefined || draft.pageKey !== pageKey ||
    draft.operation !== handler.draftOperation(intent.call.target) ||
    !isDeepStrictEqual(
      handler.create.draftValues(draft.form, intent.initiator.domainId),
      handler.create.draftValues(handler.draftInput(intent.call.input), intent.initiator.domainId),
    ))
    throw new HttpError(409, "Draft does not match the current form or has already been created", "PAGE_DRAFT_MISMATCH");
  return link;
}
function operationHost(credentials: AssistantCredentials): PanelOperationHost {
  const request = (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const headers = new Headers(buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey, credentials.headers));
    new Headers(init.headers).forEach((value,key) => headers.set(key,value));
    return fetch(url,{...init,redirect:"error",headers});
  };
  return {
    request: (path, init) => request(config.dataQuery.baseUrl.replace(/\/$/u,"") + path.slice(DATA_QUERY_GATEWAY.length), init),
    requestWorkbench: (path, init) => request(environment.agentRuntime().callbackUrl.replace(/\/$/u,"") + "/api" + path, init),
  };
}
const rootOf = (run: PanelRun) => run.channel!.userRecipient?.session;
function sourceMatches(intent: ReadableIntent, session: AgentSessionRef) {
  if (!isDeepStrictEqual(intent.source.session,session)) throw new HttpError(403,"Intent belongs to another questioning session","FORBIDDEN");
}
function matchingInvocation(intent: ReadableIntent, request: CreatePanelOperationIntentRequest, session: AgentSessionRef, executionUserId: string | null) {
  sourceMatches(intent, session);
  if (!isDeepStrictEqual(intent.use,{applicationId:request.applicationId,useId:request.useId}) || intent.operation.id !== request.operationId ||
    !("call" in intent) || !("call" in request) || !isDeepStrictEqual(intent.call,request.call) || intent.executionUserId !== executionUserId)
    throw new HttpError(409,"Changed call or executor requires a new intent","INTENT_CHANGED");
}
function replay(record: StoredPanelOperationIntent): PanelOperateResponse {
  if (record.kind === "confirmation-expired") return {
    kind: "not-dispatched", intentId: record.intentId, code: PANEL_CONFIRMATION_EXPIRED,
    message: "This confirmation expired. Start a new operation.",
  };
  return { kind: "dispatched", intentId: record.intent.intentId, outcome: record.intent.outcome };
}
function batchUnsupported(): never {
  throw new HttpError(422, "This operation does not support a batch", "OPERATION_BATCH_UNSUPPORTED");
}
export async function operatePanel(owner: AssistantOwner, credentials: AssistantCredentials, runId: string, input: CreatePanelOperationIntentRequest, initiatorName: string): Promise<PanelOperateResponse> {
  const run = await runForOwner(owner,runId);
  const source = {session:{providerId:run.channel!.agent.providerId,sessionId:run.sessionId},runId};
  let record = await store.find(owner,input.intentId);
  if (record?.kind === "confirmation-expired") return replay(record);
  if (record && (record.kind === "historical" || record.intent.dispatched)) {
    matchingInvocation(record.intent, input, source.session, run.executionUserId ?? null);
    return replay(record);
  }
  const current = await admitted(owner,credentials,run,input,input.operationId);
  if (!("call" in input)) batchUnsupported();
  const executor = await credentialsForRun(owner,runId,credentials,run.sessionId);
  const root = rootOf(run);
  if (!root) throw new HttpError(409,"Execution has no authenticated human session","USER_SESSION_UNAVAILABLE");
  if (run.channel!.authority.executionKind !== "live") throw new HttpError(422,"Management operations do not support test data","BUILD_TEST_UNSUPPORTED");
  const target = validateCall(current.handler, input.call);
  if (!record) {
    const settings = await store.settings(owner,root);
    record = await store.insert(owner,{
      intentId:input.intentId,source,rootSession:root,use:{applicationId:input.applicationId,useId:input.useId},
      panelId:current.use.panelId,projectionId:current.projection.id,binding:current.projection.binding,
      operation:current.operation,call:input.call,initiator:owner,executionUserId:executor.executionUserId,
      confirmation:settings.confirmBeforeExecute?"required":"automatic",
      questionId:settings.confirmBeforeExecute && current.operation.kind !== "form.save" ? randomUUID() : null,
      answer:null,dispatched:false,outcome:null,
    });
  }
  if (record.kind === "confirmation-expired") return replay(record);
  const { intent } = record;
  // A concurrent submission must resolve to the same immutable invocation before any question or write.
  matchingInvocation(intent, input, source.session, executor.executionUserId);
  if (record.kind === "historical" || intent.dispatched) return replay(record);
  if (intent.confirmation === "automatic") return dispatchPanel(owner,credentials,runId,intent.intentId);
  if (current.handler.kind === "form.save") return {kind:"draft",intentId:intent.intentId,
    draft:pageDraftSchema.parse({
      pageKey: current.use.pageKey, operation: current.handler.draftOperation(target),
      target: target.kind === "object" ? { id: target.primaryKey } : {},
      form: current.handler.draftInput(input.call.input),
    })};
  const confirmation = await panelConfirmation(credentials, {
    operation: intent.operation.label,
    target: await current.handler.targetLabel(operationHost(credentials), target as PanelRecordTarget),
    executionUserId: intent.executionUserId, initiatorName,
  });
  const question = agentUserQuestionReceiptSchema.parse(await new RuntimeClient(owner.domainId,undefined,owner.userId).request("/v1/channel/user-questions","POST",{
    source:intent.source, ...confirmation,
  },intent.questionId!));
  return {kind:"confirmation-required",intentId:intent.intentId,question};
}
export async function dispatchPanel(owner: AssistantOwner, credentials: AssistantCredentials, runId: string, id: string): Promise<PanelOperateResponse> {
  const record = await store.get(owner,id);
  const run = await runForOwner(owner,runId);
  if (record.kind === "confirmation-expired") return replay(record);
  sourceMatches(record.intent,{providerId:run.channel!.agent.providerId,sessionId:run.sessionId});
  if (record.kind === "historical" || record.intent.dispatched) return replay(record);
  if (!("call" in record.intent)) batchUnsupported();
  let intent = record.intent;
  const executor = await credentialsForRun(owner,runId,credentials,intent.source.session.sessionId);
  if (executor.executionUserId !== intent.executionUserId) throw new HttpError(409,"Executor changed; create a new intent","INTENT_CHANGED");
  if (run.channel!.authority.executionKind !== "live") throw new HttpError(422,"Management operations do not support test data","BUILD_TEST_UNSUPPORTED");
  const current = await admitted(owner,credentials,run,intent.use,intent.operation.id);
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
  const requestedTarget = validateCall(current.handler, intent.call);
  const draft = await verifyCreationDraft(intent, current.handler, current.use.pageKey);
  if (!await store.claim(owner,intent)) return replay(await store.get(owner,id));
  let outcome: PanelOperationOutcome;
  try {
    outcome = await current.handler.execute(operationHost(executor.credentials),requestedTarget,intent.call.input,id);
    if (requestedTarget.kind === "draft" && current.handler.kind === "form.save" && outcome.kind === "success") {
      const created = current.handler.create!.createdObject(outcome.data);
      if (draft) await assistantService.recordPageDraftCreated(draft.sessionId, draft.runId, draft.path, created.primaryKey, intent.initiator);
    }
  } catch (error) {
    // An uncertain owner call never releases the irreversible claim.
    outcome = {kind:"unknown",message:error instanceof Error?error.message:String(error)};
  }
  await store.outcome(owner,id,outcome);
  if (outcome.kind === "success" && outcome.affected) {
    for (const target of outcome.affected.objects)
      publishObjectChanged({
        domainId: intent.initiator.domainId,
        initiator: intent.initiator.userId,
        rootSession: intent.rootSession,
        target,
      });
  }
  return {kind:"dispatched",intentId:id,outcome};
}
/** Exact human owner, independent of readable/admin access and of any old run's liveness. */
export async function ownPanelSettings(owner: AssistantOwner, root: AgentSessionRef) {
  const actor = await readAgentSessionActor(root, owner.domainId);
  if (!isDeepStrictEqual((await restoreAgentCaller(actor,owner.domainId,true)).owner,owner)) throw new HttpError(403,"Only the session owner may change confirmation","FORBIDDEN");
}
