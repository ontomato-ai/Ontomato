import type { z } from "zod";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pageDraftSchema } from "@ontomato/contracts/page-draft";
import type { AgentSessionRef } from "@ontomato/contracts/agent-channel";
import { agentQuestionAnswerReceiptSchema, agentUserQuestionReceiptSchema } from "@ontomato/contracts/agent-user-questions";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
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
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { environment } from "../../config/environment";
import { assistantService } from "../assistant/service";
import { config } from "../../config/application";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { HttpError } from "../../utils/errors";
import { buildBackendHeaders } from "../../utils/backend-client";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { credentialsForRun, runForOwner } from "../assistant/execution";
import { readPageSkills } from "../assistant/skills";
import type { AssistantOwner } from "../assistant/store";
import { restoreAgentCaller, readAgentSessionActor } from "../agent-host/caller";
import { readCurrentPanelRecord, readCurrentProjectionRecord } from "./current";
import { declaredDirectOperation, declaredDirectProjectionOperation } from "./direct-operations";
import { readComponentCatalogue } from "./skill-package";
import { requirePanelUse } from "./application-use";
import {
  describePanelRead, panelServerOperation, snapshotPanelWrite, type PanelBatchCalls, type PanelOperationInvocation,
  type PanelWriteServerOperation, type PanelOperationHost, type PanelRecordTarget, type PanelImpactInspector,
} from "./server-operations";
import { panelConfirmation } from "./confirmation";
import { publishObjectChanged } from "../agent-host/presentation";
import { panelOperationStore as store } from "./operation-store";

type PanelRun = Awaited<ReturnType<typeof runForOwner>>;
type SingleIntent = Extract<PanelAgentOperationIntent, { call: PanelOperationCall }>;
type AgentRecord = Exclude<StoredPanelOperationIntent, { kind: "current" }> | { kind: "current"; intent: PanelAgentOperationIntent };
type ReadableAgentIntent = Extract<AgentRecord, { intent: unknown }>["intent"];

async function admitted(owner: AssistantOwner, credentials: AssistantCredentials, run: PanelRun, ref: PanelUseRef, operationId: string) {
  const use = await requirePanelUse(credentials, ref);
  const pages = await readPageSkills(credentials);
  const mapping = pages.pageSkills.find(mapping => "permissionCode" in use.access
    ? "permissionCode" in mapping && mapping.permissionCode === use.access.permissionCode
    : "access" in mapping && mapping.pageKey === use.pageKey);
  if (!mapping || !run.resolvedSkills.some(entry => runtimeSkillKey(entry.skill) === runtimeSkillKey(mapping.skill)))
    throw new HttpError(403,"This run does not have this panel's skill","FORBIDDEN");
  return writeOperation(await declaredOperation(owner, credentials, use, operationId));
}

async function declaredOperation(owner: AssistantOwner, credentials: AssistantCredentials, use: ApplicationPanelUse, operationId: string) {
  const panel = await readCurrentPanelRecord(owner, credentials, use.panelId);
  if (!("sdkVersion" in panel)) return declaredDirectOperation(owner, credentials, use, panel, operationId);
  let catalogue: Awaited<ReturnType<typeof readComponentCatalogue>> | undefined;
  for (const [slot,declaration] of Object.entries(panel.manifest.slots)) {
    const projection = await readCurrentProjectionRecord(owner, credentials, declaration.projectionId);
    if ("data" in projection) {
      const operation = declaredDirectProjectionOperation(use, projection, declaration.inputs, slot, operationId);
      if (operation) return operation;
      continue;
    }
    catalogue ??= await readComponentCatalogue(panel.sdkVersion);
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
      return { effect: "write" as const, use, projection, operation: snapshotPanelWrite(handler, operation, slot), handler, fixedTarget: undefined };
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
  return handler.execute(operationHost(credentials), call);
}

function requireFrozenOperation(
  intent: Pick<PanelOperationIntent, "panelId" | "projectionId" | "binding" | "operation">,
  current: ReturnType<typeof writeOperation>,
) {
  if (current.use.panelId !== intent.panelId || current.projection.id !== intent.projectionId ||
    !isDeepStrictEqual(current.projection.binding, intent.binding) || !isDeepStrictEqual(current.operation, intent.operation))
    throw new HttpError(409, "Operation definition changed; create a new intent", "INTENT_CHANGED");
}

function validateCall(handler: PanelWriteServerOperation, call: PanelOperationCall, fixedTarget?: PanelRecordTarget | null) {
  const target = handler.targetSchema.parse(call.target);
  if (fixedTarget !== undefined && !isDeepStrictEqual(target, fixedTarget))
    throw new HttpError(400, "Operation target does not match this panel member", "TARGET_ID_MISMATCH");
  handler.inputSchema.parse(call.input);
  if (handler.kind === "form.save") handler.draftInput(call.input);
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
    locale: credentials.locale,
    request: (path, init) => request(config.dataQuery.baseUrl.replace(/\/$/u,"") + path.slice(DATA_QUERY_GATEWAY.length), init),
    requestWorkbench: (path, init) => request(environment.agentRuntime().callbackUrl.replace(/\/$/u,"") + "/api" + path, init),
  };
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
function replay(record: StoredPanelOperationIntent): PanelHumanOperationDispatchResponse {
  if (record.kind === "confirmation-expired") return {
    kind: "not-dispatched", intentId: record.intentId, code: PANEL_CONFIRMATION_EXPIRED,
    message: "This confirmation expired. Start a new operation.",
  };
  return { kind: "dispatched", intentId: record.intent.intentId, outcome: record.intent.outcome };
}
function invocationOf(input: PanelOperationInvocation): PanelOperationInvocation {
  return "calls" in input ? { calls: input.calls } : { call: input.call };
}

type CheckedInvocation =
  | { call: PanelOperationCall; target: ReturnType<typeof validateCall> }
  | { calls: PanelBatchCalls; owner: Extract<PanelWriteServerOperation, { batch: true }> };

function validateInvocation(handler: PanelWriteServerOperation, input: PanelOperationInvocation, fixedTarget?: PanelRecordTarget | null): CheckedInvocation {
  if ("calls" in input) {
    if (!handler.batch) throw new HttpError(422, "This operation does not support a batch", "OPERATION_BATCH_UNSUPPORTED");
    for (const call of input.calls) validateCall(handler, call, fixedTarget);
    return { calls: input.calls, owner: handler };
  }
  return { call: input.call, target: validateCall(handler, input.call, fixedTarget) };
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
  const { handler, fixedTarget } = writeOperation(await operationForUse(owner, credentials, input));
  if (!handler.inspectImpact)
    throw new HttpError(422, "The owner has no impact description for this operation", "OPERATION_IMPACT_UNAVAILABLE");
  return ownerImpact(handler.inspectImpact, operationHost(credentials), validateInvocation(handler, input, fixedTarget));
}

function humanPreparation(intent: PanelHumanOperationIntent): PanelHumanOperationPreparation {
  return panelHumanOperationPreparationSchema.parse({
    intentId: intent.intentId, operationId: intent.operation.id, label: intent.operation.label, confirmation: intent.confirmation,
  });
}

export async function projectPanelOperationIntent(owner: AssistantOwner, id: string, use?: PanelUseRef) {
  const record = await store.get(owner, id);
  if (use) {
    if (record.kind !== "current" || !isPanelHumanOperationIntent(record.intent) || !isDeepStrictEqual(record.intent.use, use))
      throw new HttpError(404, "Operation intent not found for this panel use", "NOT_FOUND");
    if (record.intent.dispatched) throw new HttpError(409, "This operation was already dispatched", "INTENT_ALREADY_DISPATCHED");
    return humanPreparation(record.intent);
  }
  const agent = agentRecord(record);
  return agent.kind === "confirmation-expired" ? agent : agent.intent;
}

async function humanConfirmation(
  handler: PanelWriteServerOperation, host: PanelOperationHost, invocation: CheckedInvocation,
): Promise<PanelHumanOperationConfirmation> {
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
  const prepared = validateInvocation(current.handler, input, current.fixedTarget);
  const confirmation = await humanConfirmation(current.handler, operationHost(credentials), prepared);
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
  if (intent.dispatched) return replay(record);
  const current = writeOperation(await operationForUse(owner, credentials, { ...intent.use, operationId: intent.operation.id }));
  requireFrozenOperation(intent, current);
  const prepared = validateInvocation(current.handler, intent, current.fixedTarget);
  const result = await claimAndExecutePanel(owner, credentials, intent, current.handler, prepared);
  return result
    ? { kind: "dispatched", intentId: id, outcome: result.outcome }
    : replay(await store.get(owner, id));
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
  if (record?.kind === "confirmation-expired") return replay(record);
  if (record && (record.kind === "historical" || record.intent.dispatched)) {
    matchingInvocation(record.intent, input, source.session, run.executionUserId ?? null);
    return replay(record);
  }
  const current = await admitted(owner,credentials,run,input,input.operationId);
  const executor = await credentialsForRun(owner,runId,credentials,run.sessionId);
  const root = rootOf(run);
  if (!root) throw new HttpError(409,"Execution has no authenticated human session","USER_SESSION_UNAVAILABLE");
  if (run.channel!.authority.executionKind !== "live") throw new HttpError(422,"Management operations do not support test data","BUILD_TEST_UNSUPPORTED");
  const prepared = validateInvocation(current.handler, input, current.fixedTarget);
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
  if (record.kind === "confirmation-expired") return replay(record);
  const { intent } = record;
  // A concurrent submission must resolve to the same immutable invocation before any question or write.
  matchingInvocation(intent, input, source.session, executor.executionUserId);
  if (record.kind === "historical" || intent.dispatched) return replay(record);
  if (intent.confirmation === "automatic") return dispatchPanel(owner,credentials,runId,intent.intentId);
  const handler = "calls" in prepared ? prepared.owner : current.handler;
  if (handler.kind === "form.save" && "call" in prepared) return {kind:"draft",intentId:intent.intentId,
    draft:pageDraftSchema.parse({
      pageKey: current.use.pageKey, operation: handler.draftOperation(prepared.target),
      target: prepared.target.kind === "object" ? { id: prepared.target.primaryKey } : {},
      form: handler.draftInput(prepared.call.input),
    })};
  const host = operationHost(credentials);
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
  if (record.kind === "confirmation-expired") return replay(record);
  sourceMatches(record.intent,{providerId:run.channel!.agent.providerId,sessionId:run.sessionId});
  if (record.kind === "historical" || record.intent.dispatched) return replay(record);
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
  const prepared = validateInvocation(current.handler, intent, current.fixedTarget);
  const draft = "call" in intent ? await verifyCreationDraft(intent, current.handler, current.use.pageKey) : undefined;
  const result = await claimAndExecutePanel(owner, executor.credentials, intent, current.handler, prepared, draft);
  if (!result) return replay(await store.get(owner,id));
  const { outcome } = result;
  if ((outcome.kind === "success" || outcome.kind === "batch") && outcome.affected) {
    const { affected } = outcome;
    const target = "call" in intent && affected.objects.length === 1 ? affected.objects[0]! : null;
    publishObjectChanged({
      domainId: intent.initiator.domainId,
      initiator: intent.initiator.userId,
      rootSession: intent.rootSession,
      target,
      affected,
    });
  }
  return {kind:"dispatched",intentId:id,outcome};
}

async function claimAndExecutePanel(owner: AssistantOwner, credentials: AssistantCredentials, intent: PanelOperationIntent,
  handler: PanelWriteServerOperation, prepared: CheckedInvocation, draft?: Awaited<ReturnType<typeof verifyCreationDraft>>,
) {
  if (!await store.claim(owner, intent)) return;
  const id = intent.intentId;
  let outcome: PanelOperationOutcome;
  try {
    const host = operationHost(credentials);
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
