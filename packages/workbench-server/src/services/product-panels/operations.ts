import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { pageDraftSchema } from "@ontomato/contracts/page-draft";
import type { AgentSessionRef } from "@ontomato/contracts/agent-channel";
import { agentQuestionAnswerReceiptSchema, agentUserQuestionReceiptSchema } from "@ontomato/contracts/agent-user-questions";
import { applicationPanelUsesResponseSchema, type ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import {
  PANEL_CONFIRMATION_EXPIRED, isPanelHumanOperationIntent, panelHumanOperationPreparationSchema, panelOperationOutcomeSchema,
  type inspectPanelOperationImpactRequestSchema,
  type CreatePanelHumanOperationIntentRequest, type CreatePanelOperationIntentRequest, type PanelAgentOperationIntent,
  type PanelHumanOperationConfirmation, type PanelHumanOperationDispatchResponse, type PanelHumanOperationIntent,
  type PanelHumanOperationPreparation,
  type PanelOperationIntent, type PanelOperateResponse, type PanelOperationRef, type ReadPanelOperationRequest,
  type PanelUseRef, type PanelOperationOutcome, type StoredPanelOperationIntent,
} from "@ontomato/contracts/panel-agent";
import { panelOperationImpactSchema } from "@ontomato/contracts/panel-operations";
import type { PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import { projectionOperations, projectionPorts } from "@ontomato/contracts/panel-projection";
import type { PageSkillEntrance } from "@ontomato/contracts/page-skills";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { environment } from "../../config/environment";
import { assistantService } from "../assistant/service";
import { config } from "../../config/application";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { HttpError } from "../../utils/errors";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { credentialsForRun, runForOwner } from "../assistant/execution";
import { loadedPageSkillVersion, readAssistantSkillView, type AssistantSkillView } from "../assistant/skills";
import type { AssistantOwner } from "../assistant/store";
import { restoreAgentCaller, readAgentSessionActor } from "../agent-host/caller";
import { readCurrentPanel, readCurrentProjection } from "./current";
import { readComponentCatalogue } from "./skill-package";
import {
  describePanelRead, panelResultProjection, panelServerOperation, snapshotPanelWrite, type PanelBatchCalls, type PanelOperationInvocation,
  type PanelWriteServerOperation, type PanelOperationActor, type PanelOperationHost, type PanelRecordTarget, type PanelImpactInspector,
} from "./server-operations";
import { panelConfirmation } from "./confirmation";
import { publishObjectChanged } from "../agent-host/presentation";
import { panelOperationStore as store } from "./operation-store";

type PanelRun = Awaited<ReturnType<typeof runForOwner>>;
type SingleIntent = Extract<PanelAgentOperationIntent, { call: PanelOperationCall }>;
type AgentRecord = Exclude<StoredPanelOperationIntent, { kind: "current" }> | { kind: "current"; intent: PanelAgentOperationIntent };
type ReadableAgentIntent = Extract<AgentRecord, { intent: unknown }>["intent"];

async function requirePanelUse(credentials: AssistantCredentials, ref: PanelUseRef) {
  const response = await backendGet("panel-use",`${config.dataQuery.baseUrl}/platform/applications/${encodeURIComponent(ref.applicationId)}/panel-uses`,
    {headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  const uses = z.object({success:z.literal(true),data:applicationPanelUsesResponseSchema}).parse(JSON.parse(response.text)).data;
  const use = uses.panelUses.find(use => use.id === ref.useId);
  if (!use) throw new HttpError(403,"Panel use is not available","FORBIDDEN");
  return use;
}

async function admitted(owner: AssistantOwner, credentials: AssistantCredentials, run: PanelRun, ref: PanelUseRef, operationId: string) {
  const use = await requirePanelUse(credentials, ref);
  const view = await readAssistantSkillView(owner.domainId, credentials);
  const entrance: PageSkillEntrance = "permissionCode" in use.access
    ? { permissionCode: use.access.permissionCode, pageKey: use.pageKey }
    : { access: "domain-member", pageKey: use.pageKey };
  const skill = await view.resolveSource(entrance, {
    kind: "application-use", applicationId: ref.applicationId, useId: use.id,
  }, { id: use.panelId });
  if (!skill || !loadedPageSkillVersion(skill, run.resolvedSkills))
    throw new HttpError(403,"This run does not have this panel's skill","FORBIDDEN");
  return { ...writeOperation(await declaredOperation(owner, credentials, use, operationId)), view };
}

async function declaredOperation(owner: AssistantOwner, credentials: AssistantCredentials, use: ApplicationPanelUse, operationId: string) {
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
      if (!isDeepStrictEqual(projection.binding, handler.binding) || operation.kind !== handler.kind)
        throw new HttpError(422,"Operation binding or kind has no server client","OPERATION_UNAVAILABLE");
      if (handler.effect === "read") {
        if (!Object.hasOwn(panel.manifest.slots, handler.target.slot))
          throw new HttpError(422, "The operation's draft slot is unavailable", "OPERATION_UNAVAILABLE");
        return { effect: "read" as const, handler };
      }
      let targetMatches = operation.target?.source === "draft" && operation.target.slot === slot;
      if (handler.kind === "action") {
        const binding = declaration.inputs[handler.targetInput];
        const targetType = binding && panel.manifest.state[binding.state];
        const inputType = ports.inputs[handler.targetInput];
        targetMatches = inputType?.kind === "object" && inputType.objectType === handler.targetType &&
          targetType?.kind === "object" && targetType.objectType === handler.targetType;
      }
      if (!targetMatches)
        throw new HttpError(422,"Operation target type has no server client","OPERATION_UNAVAILABLE");
      return { effect: "write" as const, use, projection, operation: snapshotPanelWrite(handler, operation, slot), handler };
    }
  }
  throw new HttpError(422,"No supported declared operation has that ID","OPERATION_UNAVAILABLE");
}

async function operationForUse(owner: AssistantOwner, credentials: AssistantCredentials, ref: PanelOperationRef) {
  return declaredOperation(owner, credentials, await requirePanelUse(credentials, ref), ref.operationId);
}

function writeOperation(current: Awaited<ReturnType<typeof declaredOperation>>) {
  if (current.effect !== "write") throw new HttpError(422, "This operation must use the read route", "OPERATION_WRITE_REQUIRED");
  return current;
}

export async function readPanelOperationDescriptor(owner: AssistantOwner, credentials: AssistantCredentials, ref: PanelOperationRef) {
  const current = await operationForUse(owner, credentials, ref);
  if (current.effect === "read") return describePanelRead(current.handler);
  const { id: _id, label: _label, kind: _kind, slot: _slot, ...descriptor } = current.operation;
  return descriptor;
}

export async function readPanelOperation(owner: AssistantOwner, credentials: AssistantCredentials, request: ReadPanelOperationRequest) {
  const current = await operationForUse(owner, credentials, request);
  if (current.effect !== "read") throw new HttpError(422, "This operation requires a write intent", "OPERATION_READ_REQUIRED");
  const { handler } = current;
  const call = { target: handler.targetSchema.parse(request.call.target), input: handler.inputSchema.parse(request.call.input) };
  return handler.execute(await humanHost(owner, credentials), call);
}

function requireFrozenOperation(
  intent: Pick<PanelOperationIntent, "panelId" | "projectionId" | "binding" | "operation">,
  current: ReturnType<typeof writeOperation>,
) {
  if (current.use.panelId !== intent.panelId || current.projection.id !== intent.projectionId ||
    !isDeepStrictEqual(current.projection.binding, intent.binding) || !isDeepStrictEqual(current.operation, intent.operation))
    throw new HttpError(409, "Operation definition changed; create a new intent", "INTENT_CHANGED");
}

function validateCall(handler: PanelWriteServerOperation, call: PanelOperationCall) {
  const target = handler.targetSchema.parse(call.target);
  handler.inputSchema.parse(call.input);
  if (handler.kind === "form.save") handler.draftInput(call.input, target);
  if (call.draft && (handler.kind !== "form.save" || !handler.create || target.kind !== "draft"))
    throw new HttpError(400, "A creation draft requires a create target", "INVALID_REQUEST");
  return target;
}
async function verifyCreationDraft(intent: SingleIntent, handler: PanelWriteServerOperation, pageKey: string) {
  const link = intent.call.draft;
  if (!link || handler.kind !== "form.save" || !handler.create || intent.call.target?.kind !== "draft") return;
  const draft = await assistantService.pageDraft(link.sessionId, link.runId, link.path, intent.initiator);
  if (draft.created || draft.target.id !== undefined || draft.pageKey !== pageKey ||
    draft.operation !== handler.draftOperation(intent.call.target) ||
    !isDeepStrictEqual(
      handler.create.draftValues(draft.form, intent.initiator.domainId),
      handler.create.draftValues(handler.draftInput(intent.call.input, intent.call.target), intent.initiator.domainId),
    ))
    throw new HttpError(409, "Draft does not match the current form or has already been created", "PAGE_DRAFT_MISMATCH");
  return link;
}
function operationHost(initiator: PanelOperationActor, skillView: AssistantSkillView, executor = initiator): PanelOperationHost {
  const { credentials } = executor;
  const request = (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const headers = new Headers(buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey, credentials.headers));
    new Headers(init.headers).forEach((value,key) => headers.set(key,value));
    return fetch(url,{...init,redirect:"error",headers});
  };
  return {
    initiator, executor, skillView, locale: credentials.locale,
    request: (path, init) => request(config.dataQuery.baseUrl.replace(/\/$/u,"") + path.slice(DATA_QUERY_GATEWAY.length), init),
    requestWorkbench: (path, init) => request(environment.agentRuntime().callbackUrl.replace(/\/$/u,"") + "/api" + path, init),
  };
}
async function humanHost(owner: AssistantOwner, credentials: AssistantCredentials) {
  return operationHost({ owner, credentials }, await readAssistantSkillView(owner.domainId, credentials));
}
const rootOf = (run: PanelRun) => run.channel!.userRecipient?.session;
function agentRecord(record: StoredPanelOperationIntent): AgentRecord {
  if (record.kind !== "current") return record;
  if (isPanelHumanOperationIntent(record.intent)) throw new HttpError(403, "This intent requires human dispatch", "FORBIDDEN");
  return { kind: "current", intent: record.intent };
}

function sourceMatches(intent: ReadableAgentIntent, session: AgentSessionRef) {
  if (!isDeepStrictEqual(intent.source.session,session)) throw new HttpError(403,"Intent belongs to another questioning session","FORBIDDEN");
}
function matchingInvocation(intent: ReadableAgentIntent, request: CreatePanelOperationIntentRequest, session: AgentSessionRef, executionUserId: string | null) {
  sourceMatches(intent, session);
  if (!isDeepStrictEqual(intent.use,{applicationId:request.applicationId,useId:request.useId}) || intent.operation.id !== request.operationId ||
    !isDeepStrictEqual(invocationOf(intent),invocationOf(request)) || intent.executionUserId !== executionUserId)
    throw new HttpError(409,"Changed call or executor requires a new intent","INTENT_CHANGED");
}
async function presentOutcome(
  intent: Pick<ReadableAgentIntent, "operation" | "outcome">, owner: AssistantOwner, credentials: AssistantCredentials,
  view?: AssistantSkillView,
) {
  const { outcome } = intent;
  if (outcome?.kind !== "success") return outcome;
  const project = panelResultProjection(intent.operation.handlerRef);
  if (!project) return outcome;
  const current = view ?? await readAssistantSkillView(owner.domainId, credentials);
  return { ...outcome, data: project(outcome.data, current) };
}
async function replay(record: StoredPanelOperationIntent, owner: AssistantOwner, credentials: AssistantCredentials): Promise<PanelHumanOperationDispatchResponse> {
  if (record.kind === "confirmation-expired") return {
    kind: "not-dispatched", intentId: record.intentId, code: PANEL_CONFIRMATION_EXPIRED,
    message: "This confirmation expired. Start a new operation.",
  };
  return { kind: "dispatched", intentId: record.intent.intentId, outcome: await presentOutcome(record.intent, owner, credentials) };
}
function invocationOf(input: PanelOperationInvocation): PanelOperationInvocation {
  return "calls" in input ? { calls: input.calls } : { call: input.call };
}

type CheckedInvocation =
  | { call: PanelOperationCall; target: ReturnType<typeof validateCall> }
  | { calls: PanelBatchCalls; owner: Extract<PanelWriteServerOperation, { batch: true }> };

function validateInvocation(handler: PanelWriteServerOperation, input: PanelOperationInvocation): CheckedInvocation {
  if ("calls" in input) {
    if (!handler.batch) throw new HttpError(422, "This operation does not support a batch", "OPERATION_BATCH_UNSUPPORTED");
    for (const call of input.calls) validateCall(handler, call);
    return { calls: input.calls, owner: handler };
  }
  return { call: input.call, target: validateCall(handler, input.call) };
}

function concreteCalls(invocation: CheckedInvocation): readonly PanelOperationCall[] {
  return "calls" in invocation ? invocation.calls : [invocation.call];
}

async function ownerImpact(inspector: PanelImpactInspector, host: PanelOperationHost, invocation: CheckedInvocation) {
  return panelOperationImpactSchema.parse(await inspector.inspect(host, concreteCalls(invocation)));
}

export async function inspectPanelOperationImpact(owner: AssistantOwner, credentials: AssistantCredentials,
  input: z.infer<typeof inspectPanelOperationImpactRequestSchema>,
) {
  const { handler } = writeOperation(await operationForUse(owner, credentials, input));
  if (!handler.inspectImpact)
    throw new HttpError(422, "The owner has no impact description for this operation", "OPERATION_IMPACT_UNAVAILABLE");
  return ownerImpact(handler.inspectImpact, await humanHost(owner, credentials), validateInvocation(handler, input));
}

function humanPreparation(intent: PanelHumanOperationIntent): PanelHumanOperationPreparation {
  return panelHumanOperationPreparationSchema.parse({
    intentId: intent.intentId, operationId: intent.operation.id, label: intent.operation.label, confirmation: intent.confirmation,
  });
}

export async function projectPanelOperationIntent(owner: AssistantOwner, credentials: AssistantCredentials, id: string, use?: PanelUseRef) {
  const record = await store.get(owner, id);
  if (use) {
    if (record.kind !== "current" || !isPanelHumanOperationIntent(record.intent) || !isDeepStrictEqual(record.intent.use, use))
      throw new HttpError(404, "Operation intent not found for this panel use", "NOT_FOUND");
    if (record.intent.dispatched) throw new HttpError(409, "This operation was already dispatched", "INTENT_ALREADY_DISPATCHED");
    return humanPreparation(record.intent);
  }
  const agent = agentRecord(record);
  return agent.kind === "confirmation-expired" ? agent
    : { ...agent.intent, outcome: await presentOutcome(agent.intent, owner, credentials) };
}

async function humanConfirmation(
  handler: PanelWriteServerOperation, owner: AssistantOwner, credentials: AssistantCredentials, invocation: CheckedInvocation,
): Promise<PanelHumanOperationConfirmation> {
  if ("call" in invocation && !handler.inspectImpact) return { kind: "none" };
  const host = await humanHost(owner, credentials);
  const impact = handler.inspectImpact && ownerImpact(handler.inspectImpact, host, invocation);
  if ("call" in invocation) return impact ? { kind: "impact", impact: await impact } : { kind: "none" };
  const [objects, details] = await Promise.all([
    Promise.all(invocation.calls.map(async ({ target }) => ({
      target: { objectType: target.objectType, primaryKey: target.primaryKey },
      label: await invocation.owner.targetLabel(host, target),
    }))),
    impact,
  ]);
  return { kind: "batch", targets: { objects, total: invocation.calls.length }, ...(details && { impact: details }) };
}

export async function prepareHumanPanelOperation(owner: AssistantOwner, credentials: AssistantCredentials,
  input: CreatePanelHumanOperationIntentRequest,
): Promise<PanelHumanOperationPreparation> {
  const current = writeOperation(await operationForUse(owner, credentials, input));
  const prepared = validateInvocation(current.handler, input);
  const confirmation = await humanConfirmation(current.handler, owner, credentials, prepared);
  const intent: PanelHumanOperationIntent = {
    intentId: randomUUID(),
    source: { kind: "human" },
    initiator: owner,
    use: { applicationId: input.applicationId, useId: input.useId },
    panelId: current.use.panelId,
    projectionId: current.projection.id,
    binding: current.projection.binding,
    operation: current.operation,
    ...invocationOf(input),
    confirmation,
    dispatched: false,
    outcome: null,
  };
  await store.insert(owner, intent);
  return humanPreparation(intent);
}

export async function dispatchHumanPanelOperation(owner: AssistantOwner, credentials: AssistantCredentials, id: string): Promise<PanelHumanOperationDispatchResponse> {
  const record = await store.get(owner, id);
  if (record.kind !== "current" || !isPanelHumanOperationIntent(record.intent))
    throw new HttpError(403, "This intent was not prepared for human dispatch", "FORBIDDEN");
  const { intent } = record;
  if (intent.dispatched) return replay(record, owner, credentials);
  const current = writeOperation(await operationForUse(owner, credentials, { ...intent.use, operationId: intent.operation.id }));
  requireFrozenOperation(intent, current);
  const prepared = validateInvocation(current.handler, intent);
  const host = await humanHost(owner, credentials);
  const result = await claimAndExecutePanel(owner, host, intent, current.handler, prepared);
  return result
    ? { kind: "dispatched", intentId: id, outcome: await presentOutcome({ operation: intent.operation, outcome: result.outcome }, owner, credentials, host.skillView) }
    : replay(await store.get(owner, id), owner, credentials);
}

function namedTargets(labels: string[], total: number, locale?: string) {
  const names = new Intl.ListFormat(locale).format(labels.slice(0, 4));
  return `${names} (${new Intl.NumberFormat(locale).format(total)})`.trim();
}

function batchOutcome(value: unknown, calls: PanelBatchCalls): PanelOperationOutcome {
  const outcome = panelOperationOutcomeSchema.parse(value);
  // A definitive atomic receipt applies to the whole batch.
  if (outcome.kind !== "batch") return outcome;
  const { items } = outcome;
  if (items.length !== calls.length || items.some(({ target }, index) => {
    const { objectType, primaryKey } = calls[index]!.target;
    return target.objectType !== objectType || target.primaryKey !== primaryKey;
  })) throw new Error("The batch owner returned results for different targets");

  const successes = items.flatMap(({ outcome }) => outcome.kind === "success" && outcome.affected ? [outcome.affected] : []);
  if (!successes.length) return { kind: "batch", items };
  const objects = new Map(successes.flatMap(({ objects }) => objects.map(target =>
    [JSON.stringify([target.objectType, target.primaryKey]), target] as const)));
  const objectTypes = new Set(successes.flatMap(affected => affected.objectTypes));
  return { kind: "batch", items, affected: { objects: [...objects.values()], objectTypes: [...objectTypes] } };
}
export async function operatePanel(owner: AssistantOwner, credentials: AssistantCredentials, runId: string, input: CreatePanelOperationIntentRequest, initiatorName: string): Promise<PanelOperateResponse> {
  const run = await runForOwner(owner,runId);
  const source = {session:{providerId:run.channel!.agent.providerId,sessionId:run.sessionId},runId};
  const stored = await store.find(owner,input.intentId);
  let record = stored && agentRecord(stored);
  if (record?.kind === "confirmation-expired") return replay(record, owner, credentials);
  if (record && (record.kind === "historical" || record.intent.dispatched)) {
    matchingInvocation(record.intent, input, source.session, run.executionUserId ?? null);
    return replay(record, owner, credentials);
  }
  const current = await admitted(owner,credentials,run,input,input.operationId);
  const executor = await credentialsForRun(owner,runId,credentials,run.sessionId);
  const root = rootOf(run);
  if (!root) throw new HttpError(409,"Execution has no authenticated human session","USER_SESSION_UNAVAILABLE");
  if (run.channel!.authority.executionKind !== "live") throw new HttpError(422,"Management operations do not support test data","BUILD_TEST_UNSUPPORTED");
  const prepared = validateInvocation(current.handler, input);
  if (!record) {
    const settings = await store.settings(owner,root);
    record = agentRecord(await store.insert(owner,{
      intentId:input.intentId,source,rootSession:root,use:{applicationId:input.applicationId,useId:input.useId},
      panelId:current.use.panelId,projectionId:current.projection.id,binding:current.projection.binding,
      operation:current.operation,...invocationOf(input),initiator:owner,executionUserId:executor.executionUserId,
      confirmation:settings.confirmBeforeExecute?"required":"automatic",
      questionId:settings.confirmBeforeExecute && current.operation.kind !== "form.save" ? randomUUID() : null,
      answer:null,dispatched:false,outcome:null,
    }));
  }
  if (record.kind === "confirmation-expired") return replay(record, owner, credentials);
  const { intent } = record;
  // A concurrent submission must resolve to the same immutable invocation before any question or write.
  matchingInvocation(intent, input, source.session, executor.executionUserId);
  if (record.kind === "historical" || intent.dispatched) return replay(record, owner, credentials);
  if (intent.confirmation === "automatic") return dispatchPanel(owner,credentials,runId,intent.intentId);
  const handler = "calls" in prepared ? prepared.owner : current.handler;
  if (handler.kind === "form.save" && "call" in prepared) return {kind:"draft",intentId:intent.intentId,
    draft:pageDraftSchema.parse({
      pageKey: current.use.pageKey, operation: handler.draftOperation(prepared.target),
      target: prepared.target.kind === "object" ? { id: prepared.target.primaryKey } : {},
      form: handler.draftInput(prepared.call.input, prepared.target),
    })};
  const host = operationHost({ owner, credentials }, current.view);
  const impact = handler.inspectImpact && await ownerImpact(handler.inspectImpact, host, prepared);
  const target = impact
    ? namedTargets(impact.objects.map(object => object.label), impact.total, credentials.locale)
    : await confirmationTarget(handler as Extract<PanelWriteServerOperation, { kind: "action" }>, host, prepared);
  const confirmation = await panelConfirmation(credentials, {
    operation: intent.operation.label, target, impactSummary: impact?.summary,
    executionUserId: intent.executionUserId, initiatorName,
  });
  const question = agentUserQuestionReceiptSchema.parse(await new RuntimeClient(owner.domainId,undefined,owner.userId).request("/v1/channel/user-questions","POST",{
    source:intent.source, ...confirmation,
  },intent.questionId!));
  return {kind:"confirmation-required",intentId:intent.intentId,question};
}
async function confirmationTarget(handler: Extract<PanelWriteServerOperation, { kind: "action" }>,
  host: PanelOperationHost, invocation: CheckedInvocation,
) {
  if ("call" in invocation) return handler.targetLabel(host, invocation.target as PanelRecordTarget);
  const labels = await Promise.all(invocation.calls.map(call => handler.targetLabel(host, call.target)));
  return namedTargets(labels, invocation.calls.length, host.locale);
}

export async function dispatchPanel(owner: AssistantOwner, credentials: AssistantCredentials, runId: string, id: string): Promise<PanelOperateResponse> {
  const record = agentRecord(await store.get(owner,id));
  const run = await runForOwner(owner,runId);
  if (record.kind === "confirmation-expired") return replay(record, owner, credentials);
  sourceMatches(record.intent,{providerId:run.channel!.agent.providerId,sessionId:run.sessionId});
  if (record.kind === "historical" || record.intent.dispatched) return replay(record, owner, credentials);
  let intent = record.intent;
  const executor = await credentialsForRun(owner,runId,credentials,intent.source.session.sessionId);
  if (executor.executionUserId !== intent.executionUserId) throw new HttpError(409,"Executor changed; create a new intent","INTENT_CHANGED");
  if (run.channel!.authority.executionKind !== "live") throw new HttpError(422,"Management operations do not support test data","BUILD_TEST_UNSUPPORTED");
  const current = await admitted(owner,credentials,run,intent.use,intent.operation.id);
  requireFrozenOperation(intent, current);
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
  const prepared = validateInvocation(current.handler, intent);
  const draft = "call" in intent ? await verifyCreationDraft(intent, current.handler, current.use.pageKey) : undefined;
  const actor = { owner: { domainId: owner.domainId, userId: executor.executionUserId ?? owner.userId }, credentials: executor.credentials };
  const host = operationHost({ owner, credentials }, current.view, actor);
  const result = await claimAndExecutePanel(owner, host, intent, current.handler, prepared, draft);
  if (!result) return replay(await store.get(owner,id), owner, credentials);
  const { outcome } = result;
  if ((outcome.kind === "success" || outcome.kind === "batch") && outcome.affected) {
    for (const target of outcome.affected.objects)
      publishObjectChanged({
        domainId: intent.initiator.domainId,
        initiator: intent.initiator.userId,
        rootSession: intent.rootSession,
        target,
      });
  }
  return { kind: "dispatched", intentId: id, outcome: await presentOutcome({ operation: intent.operation, outcome }, owner, credentials, current.view) };
}

async function claimAndExecutePanel(owner: AssistantOwner, host: PanelOperationHost, intent: PanelOperationIntent,
  handler: PanelWriteServerOperation, prepared: CheckedInvocation, draft?: Awaited<ReturnType<typeof verifyCreationDraft>>,
) {
  if (!await store.claim(owner, intent)) return;
  const id = intent.intentId;
  let outcome: PanelOperationOutcome;
  try {
    if ("calls" in prepared) {
      outcome = batchOutcome(await prepared.owner.executeBatch(host, prepared.calls, id), prepared.calls);
    } else {
      outcome = await handler.execute(host, prepared.target, prepared.call.input, id);
      if (prepared.target.kind === "draft" && handler.kind === "form.save" && outcome.kind === "success") {
        const created = handler.create!.createdObject(outcome.data);
        if (draft) await assistantService.recordPageDraftCreated(draft.sessionId, draft.runId, draft.path, created.primaryKey, owner);
      }
    }
  } catch (error) {
    // An uncertain owner call never releases the irreversible claim.
    outcome = {kind:"unknown",message:error instanceof Error?error.message:String(error)};
  }
  await store.outcome(owner,id,outcome);
  return { outcome };
}
/** Exact human owner, independent of readable/admin access and of any old run's liveness. */
export async function ownPanelSettings(owner: AssistantOwner, root: AgentSessionRef) {
  const actor = await readAgentSessionActor(root, owner.domainId);
  if (!isDeepStrictEqual((await restoreAgentCaller(actor,owner.domainId,true)).owner,owner)) throw new HttpError(403,"Only the session owner may change confirmation","FORBIDDEN");
}
