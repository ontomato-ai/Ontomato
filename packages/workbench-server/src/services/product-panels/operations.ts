import { AGENT_EXECUTION_HEADER } from "@ontomato/contracts/agent-runtime-business-callbacks";
import type { z } from "zod";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AgentSessionRef } from "@ontomato/contracts/agent-channel";
import type { ApplicationPanelUse, ProductPanel } from "@ontomato/contracts/product-panels";
import {
  PANEL_CONFIRMATION_EXPIRED, panelHumanOperationPreparationSchema, panelOperationOutcomeSchema, withoutPanelSecretDelivery,
  type inspectPanelOperationImpactRequestSchema,
  type CreatePanelHumanOperationIntentRequest,
  type PanelHumanOperationConfirmation, type PanelHumanOperationDispatchResponse, type PanelHumanOperationIntent,
  type PanelHumanOperationPreparation,
  type PanelAgentRunRef, type PanelOperationIntent, type PanelOperationRef, type ReadPanelOperationRequest,
  type PanelUseRef, type BatchItemOperationOutcome, type PanelOperationOutcome, type StoredPanelOperationIntent,
} from "@ontomato/contracts/panel-agent";
import { hasPanelSecretInput, normalizePanelSecretPointer, panelSchemaSecretPaths, panelSecretPathsOverlap, panelSecretValuePresent, restorePanelSecrets, splitPanelSecrets } from "@ontomato/contracts/panel-secrets";
import { panelOperationImpactSchema } from "@ontomato/contracts/panel-operations";
import { EXECUTE_OBJECT_ACTION } from "@ontomato/contracts/platform-object-types";
import {
  AGENT_UPLOAD_UNSUPPORTED, panelFileInputSchema, panelUploadAccepted, panelUploadFileSchema, type PanelUploadFile, type PanelUploadReceipt,
} from "@ontomato/contracts/panel-upload";
import type { PanelObjectIdentity, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PageSkillEntrance } from "@ontomato/contracts/page-skills";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { HttpError } from "../../utils/errors";
import { tForLocale } from "../../i18n";
import { requireFormFieldNames } from "../../utils/form-field-names";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { runForOwner } from "../assistant/execution";
import { loadedPageSkillVersion, readAssistantSkillView, resolvePageSkillSource, type AssistantSkillView } from "../assistant/skills";
import type { AssistantOwner } from "../assistant/store";
import { restoreAgentCaller, readAgentSessionActor } from "../agent-host/caller";
import { publishObjectChanged } from "../agent-host/presentation";
import { mergeObjectActionBoundParams } from "../action/object-actions";
import { readCurrentPanelRecord } from "./current";
import {
  declaredDirectOperation, resolveBatchUnavailableReasons, type DeclaredDirectOperationOptions, type PlacedOperationTarget,
} from "./direct-operations";
import { requireRegisteredPanelRoot } from "./member-path";
import { requirePanelUseEntry } from "./application-use";
import {
  panelOperationUpload, panelResultProjection, type PanelBatchCalls, type PanelOperationInvocation, type SinglePanelOperationOutcome,
  type PanelWriteServerOperation, type PanelOperationHost, type PanelOperationTarget, type PanelRecordTarget, type PanelImpactInspector,
} from "./server-operations";
import { panelConfirmation } from "./confirmation";
import { operationHost } from "./operation-host";
import { panelOperationStore as store } from "./operation-store";
import { panelUploadStore as uploads } from "./upload-store";
import { panelSecretStore } from "./secret-store";

type PanelRun = Awaited<ReturnType<typeof runForOwner>>;

export async function requirePanelSkillForRun(owner: AssistantOwner, credentials: AssistantCredentials, run: PanelRun,
  ref: PanelUseRef & Pick<PanelOperationRef, "root">) {
  if (ref.root === "frame")
    throw new HttpError(403, "This run does not have the application frame's skill", "PANEL_FRAME_SKILL_REQUIRED");
  const { use, framePanelId } = await requirePanelUseEntry(credentials, ref, owner);
  const view = await readAssistantSkillView(owner.domainId, credentials, owner.userId);
  const entrance: PageSkillEntrance = "permissionCode" in use.access
    ? { permissionCode: use.access.permissionCode, pageKey: use.pageKey }
    : { access: "domain-member", pageKey: use.pageKey };
  const skill = await resolvePageSkillSource(view, entrance, {
    kind: "application-use", applicationId: ref.applicationId, useId: use.id,
  }, [], { id: use.panelId });
  if (!skill || !loadedPageSkillVersion(skill, run.resolvedSkills))
    throw new HttpError(403,"This run does not have this panel's skill","FORBIDDEN");
  return { use, framePanelId, view };
}

async function requireActivePageRun(owner: AssistantOwner, agentRun: PanelAgentRunRef) {
  const run = await runForOwner(owner, agentRun.runId);
  if (!run.channel || run.status !== "running") throw new HttpError(409, "Execution is closed", "RUN_CLOSED");
  if (run.sessionId !== agentRun.sessionId) throw new HttpError(403, "Run session mismatch", "FORBIDDEN");
  const root = run.channel.userRecipient?.session;
  if (!root) throw new HttpError(409, "Execution has no authenticated human session", "USER_SESSION_UNAVAILABLE");
  return { run, channel: run.channel, root };
}

function requireHumanSecretInput(locale: AssistantCredentials["locale"]): never {
  throw new HttpError(400, tForLocale(locale, "panels.secret.humanInput"), "PANEL_SECRET_HUMAN_INPUT_REQUIRED");
}

async function declaredOperation(
  owner: AssistantOwner, credentials: AssistantCredentials, use: ApplicationPanelUse,
  ref: PanelOperationRef, target?: PanelOperationCall["target"], frame?: ProductPanel,
  options?: DeclaredDirectOperationOptions,
) {
  const panel = frame ?? await readCurrentPanelRecord(owner, credentials, use.panelId);
  const operation = await declaredDirectOperation(owner, credentials, use, panel, ref.operationId, target, ref.memberPath, {
    ...options,
    ...(frame && { isFrameRoot: true }),
  });
  return { ...operation, rootPanelId: frame?.id ?? use.panelId };
}

async function operationForUse(
  owner: AssistantOwner, credentials: AssistantCredentials, ref: PanelOperationRef, target?: PanelOperationCall["target"],
  options?: DeclaredDirectOperationOptions,
) {
  if (ref.root === "frame") {
    const { applicationId, useId } = ref;
    const { panel, entry, framePanelId } = await requireRegisteredPanelRoot(owner, credentials, { kind: ref.root, applicationId, useId });
    return declaredOperation(owner, credentials, entry, ref, target, panel, { framePanelId, ...options });
  }
  const { use, framePanelId } = await requirePanelUseEntry(credentials, ref, owner);
  return declaredOperation(owner, credentials, use, ref, target, undefined, { framePanelId, ...options });
}

function invocationTarget(
  input: PanelOperationInvocation | CreatePanelHumanOperationIntentRequest,
) {
  return "call" in input ? input.call.target : undefined;
}

interface BoundParamTarget {
  readonly boundParams?: Readonly<Record<string, unknown>>;
  readonly handler: { readonly handlerRef: string };
  readonly descriptor: { readonly inputSchema: Record<string, unknown> };
}

function mergeBoundParams(
  supplied: Record<string, unknown>,
  resolved: BoundParamTarget,
  onMismatch: (key: string) => never,
): Record<string, unknown> {
  const { boundParams } = resolved;
  if (!boundParams || !Object.keys(boundParams).length) return supplied;
  if (resolved.handler.handlerRef === EXECUTE_OBJECT_ACTION) {
    return mergeObjectActionBoundParams(supplied, boundParams, resolved.descriptor.inputSchema, onMismatch);
  }
  const merged: Record<string, unknown> = { ...supplied };
  for (const [key, expected] of Object.entries(boundParams)) {
    if (Object.hasOwn(supplied, key) && supplied[key] !== undefined && !isDeepStrictEqual(supplied[key], expected)) {
      onMismatch(key);
    }
    merged[key] = expected;
  }
  return merged;
}

function mergeWriteInput(
  supplied: Record<string, unknown>,
  resolved: Pick<ReturnType<typeof writeOperation>, "boundParams" | "bindingParams" | "handler" | "descriptor">,
  onMismatch: (key: string) => never,
): Record<string, unknown> {
  const merged = mergeBoundParams(supplied, resolved, onMismatch);
  if (resolved.handler.handlerRef !== EXECUTE_OBJECT_ACTION || !resolved.bindingParams) return merged;

  const values = merged.values as Record<string, unknown> | undefined;
  for (const [paramKey, spec] of Object.entries(resolved.bindingParams)) {
    if (!("formFields" in spec)) continue;
    const raw = values?.[paramKey];
    if (typeof raw !== "string") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpError(400, `Operation input '${paramKey}' must be valid JSON`, "ACTION_INPUT_INVALID");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, `Operation input '${paramKey}' must be a JSON object`, "ACTION_INPUT_INVALID");
    }
    for (const fieldKey of Object.keys(parsed)) {
      if (!Object.hasOwn(spec.formFields, fieldKey)) {
        throw new HttpError(400, `Operation input '${paramKey}' contains undeclared field '${fieldKey}'`, "ACTION_INPUT_INVALID");
      }
    }
  }
  return merged;
}

/** Shared server-side materialization for both human and agent write operations. */
function materializeWriteInvocation(
  input: CreatePanelHumanOperationIntentRequest | z.infer<typeof inspectPanelOperationImpactRequestSchema>,
  resolved: Pick<ReturnType<typeof writeOperation>, "boundParams" | "bindingParams" | "handler" | "descriptor">,
): PanelOperationInvocation {
  const rejectParamMismatch = (key: string): never => {
    throw new HttpError(403, `Operation input '${key}' does not match the panel member binding`, "OPERATION_PARAM_MISMATCH");
  };
  if ("calls" in input) {
    const calls = input.calls.map(call => ({
      ...call,
      input: mergeWriteInput(call.input, resolved, rejectParamMismatch),
    }));
    return { calls } as PanelOperationInvocation;
  }
  return {
    call: {
      ...input.call,
      input: mergeWriteInput(input.call.input, resolved, rejectParamMismatch),
    },
  };
}

function writeOperation(current: Awaited<ReturnType<typeof declaredOperation>>) {
  if (current.effect !== "write") throw new HttpError(422, "This operation must use the read route", "OPERATION_WRITE_REQUIRED");
  return current;
}

export async function readPanelOperationDescriptor(owner: AssistantOwner, credentials: AssistantCredentials, ref: PanelOperationRef) {
  const current = await operationForUse(owner, credentials, ref, undefined, { mode: "describe" });
  return current.descriptor;
}

export async function readPanelOperation(owner: AssistantOwner, credentials: AssistantCredentials, request: ReadPanelOperationRequest) {
  let current: Awaited<ReturnType<typeof operationForUse>>;
  if (request.agentRun) {
    const { run } = await requireActivePageRun(owner, request.agentRun);
    const { use, framePanelId } = await requirePanelSkillForRun(owner, credentials, run, request);
    current = await declaredOperation(owner, credentials, use, request, request.call.target, undefined, { mode: "read", framePanelId });
  } else {
    current = await operationForUse(owner, credentials, request, request.call.target, { mode: "read" });
  }
  if (current.effect !== "read") throw new HttpError(422, "This operation requires a write intent", "OPERATION_READ_REQUIRED");
  const { handler, fixedTarget } = current;
  if (request.agentRun) {
    const { draft: _draft, ...nonDraftInput } = request.call.input;
    const input = current.descriptor.target.source === "draft" ? nonDraftInput : request.call.input;
    if (hasPanelSecretInput(input, current.descriptor)) requireHumanSecretInput(credentials.locale);
  }
  const target = handler.targetSchema.parse(request.call.target);
  if (fixedTarget !== undefined && !isDeepStrictEqual(target, fixedTarget))
    throw new HttpError(400, "Operation target does not match this panel member", "TARGET_ID_MISMATCH");
  const mergedInput = mergeBoundParams(request.call.input, current, key => {
    throw new HttpError(403, `Operation input '${key}' does not match the panel member binding`, "OPERATION_PARAM_MISMATCH");
  });
  const call = { target, input: handler.inputSchema.parse(mergedInput) };
  return handler.execute(operationHost({ owner, credentials }), call);
}

function requireFrozenOperation(
  intent: Pick<PanelOperationIntent, "panelId" | "projectionId" | "binding" | "operation"> & PanelOperationInvocation,
  current: ReturnType<typeof writeOperation>,
) {
  if (current.rootPanelId !== intent.panelId || current.projection.id !== intent.projectionId ||
    !isDeepStrictEqual(current.projection.binding, intent.binding) || !isDeepStrictEqual(current.operation, intent.operation))
    throw new HttpError(409, "Operation definition changed; create a new intent", "INTENT_CHANGED");
  const rejectChanged = (): never => {
    throw new HttpError(409, "Operation definition changed; create a new intent", "INTENT_CHANGED");
  };
  if ("calls" in intent) {
    for (const call of intent.calls) mergeWriteInput(call.input, current, rejectChanged);
  } else {
    mergeWriteInput(intent.call.input, current, rejectChanged);
  }
}

function validateCall(handler: PanelWriteServerOperation, call: PanelOperationCall, fixedTarget?: PanelOperationTarget | null) {
  const target = handler.targetSchema.parse(call.target);
  if (fixedTarget !== undefined && !isDeepStrictEqual(target, fixedTarget))
    throw new HttpError(400, "Operation target does not match this panel member", "TARGET_ID_MISMATCH");
  if (handler.kind === "form.save") requireFormFieldNames(call.input.values, "values");
  handler.inputSchema.parse(call.input);
  if (handler.kind === "form.save") {
    if (!target) throw new HttpError(400, "A form save requires a target", "INVALID_REQUEST");
    handler.draftInput(call.input, target);
  }
  return target;
}
async function presentOutcome(
  intent: { operation: { handlerRef?: string }; outcome: PanelOperationOutcome | null }, owner: AssistantOwner, credentials: AssistantCredentials,
  view?: AssistantSkillView,
) {
  const { outcome } = intent;
  if (outcome?.kind !== "success" || intent.operation.handlerRef === undefined) return outcome;
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
  if (record.kind === "current" && record.intent.invalidated) {
    return {
      kind: "not-dispatched",
      intentId: record.intent.intentId,
      code: record.intent.invalidated.code,
      message: record.intent.invalidated.message,
    };
  }
  return { kind: "dispatched", intentId: record.intent.intentId, outcome: await presentOutcome(record.intent, owner, credentials) };
}
function invocationOf(input: PanelOperationInvocation): PanelOperationInvocation {
  return "calls" in input ? { calls: input.calls } : { call: input.call };
}

function mapInvocation(
  invocation: PanelOperationInvocation,
  mapInput: (input: Record<string, unknown>, index: number) => Record<string, unknown>,
): PanelOperationInvocation {
  if ("call" in invocation) return { call: { ...invocation.call, input: mapInput(invocation.call.input, 0) } };
  const [first, ...rest] = invocation.calls;
  return { calls: [
    { ...first, input: mapInput(first.input, 0) },
    ...rest.map((call, index) => ({ ...call, input: mapInput(call.input, index + 1) })),
  ] };
}

function redactInvocation(
  invocation: PanelOperationInvocation,
  { handler, descriptor, acceptsDraftSecretFields }: Pick<ReturnType<typeof writeOperation>, "handler" | "descriptor" | "acceptsDraftSecretFields">,
  fields: readonly string[] = [],
) {
  if (fields.length && !acceptsDraftSecretFields) {
    throw new HttpError(400, "Only a form draft can declare additional secret input fields", "INVALID_REQUEST");
  }
  const declared = [...new Set([...(handler.secretFields ?? []), ...fields].map(normalizePanelSecretPointer))]
    .map(path => handler.kind === "form.save" ? `/values${path}` : path);
  const secrets: ReadonlyMap<string, unknown>[] = [];
  const redacted = mapInvocation(invocation, (input, index) => {
    const paths = [...declared, ...panelSchemaSecretPaths(descriptor.inputSchema, input)];
    const split = splitPanelSecrets(input, paths);
    secrets[index] = split.secrets;
    return split.redacted;
  });
  return { redacted, secrets, paths: [...new Set(secrets.flatMap(values => [...values.keys()]))] };
}

async function persistIntent(
  owner: AssistantOwner, intent: PanelHumanOperationIntent, secrets: ReturnType<typeof redactInvocation>,
) {
  await store.insert(owner, intent);
  if (secrets.paths.length) panelSecretStore.stage(owner, intent.intentId, secrets.secrets);
}

function confirmationInvocation(checked: CheckedInvocation, redacted: PanelOperationInvocation): CheckedInvocation {
  return "call" in checked
    ? { ...checked, call: (redacted as { call: PanelOperationCall }).call }
    : { ...checked, calls: (redacted as { calls: PanelBatchCalls }).calls };
}

type CheckedInvocation =
  | { call: PanelOperationCall; target: ReturnType<typeof validateCall> }
  | { calls: PanelBatchCalls; owner: Extract<PanelWriteServerOperation, { batch: true }> };

function validateInvocation(handler: PanelWriteServerOperation, input: PanelOperationInvocation, fixedTarget?: PlacedOperationTarget): CheckedInvocation {
  if ("calls" in input) {
    if (!handler.batch) throw new HttpError(422, "This operation does not support a batch", "OPERATION_BATCH_UNSUPPORTED");
    if (fixedTarget?.kind === "list") {
      const { objects } = fixedTarget;
      if (objects && objects.length !== input.calls.length)
        throw new HttpError(400, "Operation targets do not match this panel member", "TARGET_ID_MISMATCH");
      input.calls.forEach((call, index) => validateCall(handler, call, objects?.[index]));
    } else {
      for (const call of input.calls) validateCall(handler, call, fixedTarget);
    }
    return { calls: input.calls, owner: handler };
  }
  if (fixedTarget?.kind === "list")
    throw new HttpError(422, "This panel member targets a list and requires a batch", "OPERATION_BATCH_REQUIRED");
  return { call: input.call, target: validateCall(handler, input.call, fixedTarget) };
}

function concreteCalls(invocation: CheckedInvocation): readonly PanelOperationCall[] {
  return "calls" in invocation ? invocation.calls : [invocation.call];
}

async function ownerImpact(inspector: PanelImpactInspector, host: PanelOperationHost, calls: readonly PanelOperationCall[]) {
  const impact = await inspector.inspect(host, calls);
  return impact && panelOperationImpactSchema.parse(impact);
}

/**
 * Hands the owner the file the reader staged for this operation in place of the call's file input. The staged file is
 * the only kind of file input today; nothing else reaches an owner as a file.
 */
async function withStagedFile(owner: AssistantOwner, ref: PanelOperationRef, handler: PanelWriteServerOperation,
  invocation: CheckedInvocation, locale?: string,
): Promise<{ invocation: CheckedInvocation; upload?: { id: string; file: PanelUploadFile } }> {
  const declared = panelOperationUpload(handler);
  if (!declared || !("call" in invocation)) return { invocation };
  const { uploadId } = panelFileInputSchema.parse(invocation.call.input[declared.input]);
  const { bytes, ...file } = await uploads.read(owner, ref, uploadId, locale);
  const call = { ...invocation.call, input: { ...invocation.call.input, [declared.input]: { ...file, bytes } } };
  return { invocation: { ...invocation, call }, upload: { id: uploadId, file } };
}

/**
 * Keeps a file the reader picked for an operation that declares an upload, after checking it against that operation's
 * declaration. A newer file for the same operation replaces the reader's earlier one.
 */
export async function stagePanelUpload(owner: AssistantOwner, credentials: AssistantCredentials, ref: PanelOperationRef,
  picked: { name: string; bytes: Buffer } | undefined,
): Promise<PanelUploadReceipt> {
  const { handler } = writeOperation(await operationForUse(owner, credentials, ref));
  const declared = panelOperationUpload(handler);
  if (!declared) throw new HttpError(422, "This operation does not take a file", "OPERATION_UPLOAD_UNSUPPORTED");
  const { locale } = credentials;
  if (!picked) throw new HttpError(400, tForLocale(locale, "panels.upload.fileRequired"), "UPLOAD_FILE_REQUIRED");
  const accepted = panelUploadAccepted(declared, picked.name);
  const extensions = declared.accept.map(kind => kind.extension);
  if (!accepted) throw new HttpError(400, tForLocale(locale, "panels.upload.typeUnsupported", { extensions: extensions.join(", ") }),
    "UPLOAD_TYPE_UNSUPPORTED", { extensions });
  if (picked.bytes.length > declared.maxBytes)
    throw new HttpError(413, tForLocale(locale, "panels.upload.tooLarge", { megabytes: declared.maxBytes / 1024 / 1024 }),
      "UPLOAD_TOO_LARGE", { maxBytes: declared.maxBytes });
  const file = panelUploadFileSchema.safeParse({ name: picked.name, size: picked.bytes.length, mime: accepted.mime });
  if (!file.success) throw new HttpError(400, tForLocale(locale, "panels.upload.fileInvalid"), "UPLOAD_FILE_INVALID");
  return uploads.stage(owner, ref, { ...file.data, bytes: picked.bytes });
}

function refuseAgentUpload(handler: PanelWriteServerOperation, locale?: string) {
  if (panelOperationUpload(handler))
    throw new HttpError(422, tForLocale(locale, "panels.upload.agentUnsupported"), AGENT_UPLOAD_UNSUPPORTED);
}

export async function inspectPanelOperationImpact(owner: AssistantOwner, credentials: AssistantCredentials,
  input: z.infer<typeof inspectPanelOperationImpactRequestSchema>,
) {
  const current = writeOperation(await operationForUse(owner, credentials, input, invocationTarget(input), { mode: "prepare" }));
  const concrete = materializeWriteInvocation(input, current);
  const { handler, fixedTarget } = current;
  const staged = handler.inspectImpact &&
    await withStagedFile(owner, input, handler, confirmationInvocation(
      validateInvocation(handler, concrete, fixedTarget), redactInvocation(concrete, current).redacted,
    ), credentials.locale);
  const impact = staged && await ownerImpact(handler.inspectImpact!, operationHost({ owner, credentials }), concreteCalls(staged.invocation));
  if (!impact) throw new HttpError(422, "The owner has no impact description for this operation", "OPERATION_IMPACT_UNAVAILABLE");
  return impact;
}

function humanPreparation(intent: PanelHumanOperationIntent): PanelHumanOperationPreparation {
  return panelHumanOperationPreparationSchema.parse({
    intentId: intent.intentId,
    operationId: intent.operation.id,
    label: intent.operation.label,
    confirmation: intent.confirmation,
    ...(intent.redactedSecretFields?.length && { hasSecretInput: true }),
    ...(intent.source.kind === "agent-page"
      ? {
          autoMode: intent.source.autoMode,
          ...(intent.source.questionId ? { questionId: intent.source.questionId } : {}),
        }
      : {}),
  });
}

export async function projectPanelOperationIntent(owner: AssistantOwner, id: string, use: PanelUseRef | undefined, credentials: AssistantCredentials) {
  const record = await store.get(owner, id);
  if (use) {
    if (record.kind !== "current" || !isDeepStrictEqual(record.intent.use, use))
      throw new HttpError(404, "Operation intent not found for this panel use", "NOT_FOUND");
    if (record.intent.dispatched) throw new HttpError(409, "This operation was already dispatched", "INTENT_ALREADY_DISPATCHED");
    return humanPreparation(record.intent);
  }
  if (record.kind === "confirmation-expired") return record;
  return { ...record.intent, outcome: await presentOutcome(record.intent, owner, credentials) };
}

async function humanConfirmation(
  handler: PanelWriteServerOperation, host: PanelOperationHost, invocation: CheckedInvocation, upload?: PanelUploadFile,
): Promise<PanelHumanOperationConfirmation> {
  if ("call" in invocation) {
    // A call whose owner finds nothing to confirm goes ahead; an inspected upload also names the file it hands over.
    const details = handler.inspectImpact && await ownerImpact(handler.inspectImpact, host, [invocation.call]);
    return details ? { kind: "impact", impact: details, ...(upload && { upload }) } : { kind: "none" };
  }
  const { executable } = await partitionBatch(host, invocation);
  const skippedCount = invocation.calls.length - executable.length;
  const [objects, details] = await Promise.all([
    Promise.all(executable.map(async ({ target, input }) => ({
      target: { objectType: target.objectType, primaryKey: target.primaryKey },
      label: await invocation.owner.targetLabel(host, target, input),
    }))),
    executable.length > 0 && handler.inspectImpact && ownerImpact(handler.inspectImpact, host, executable),
  ]);
  return {
    kind: "batch",
    targets: { objects, total: executable.length },
    ...(details && { impact: details }),
    ...(skippedCount > 0 && {
      skippedSummary: tForLocale(host.locale, "panels.confirmation.skipped", {
        count: new Intl.NumberFormat(host.locale).format(skippedCount),
      }),
    }),
  };
}

export async function prepareHumanPanelOperation(owner: AssistantOwner, credentials: AssistantCredentials,
  input: CreatePanelHumanOperationIntentRequest, callerUserName?: string,
): Promise<PanelHumanOperationPreparation> {
  if (input.agentRun) {
    const existing = await store.findByAgentToolCall(owner, input.agentRun.runId, input.agentRun.toolCallId);
    if (existing?.kind === "current") {
      return humanPreparation(existing.intent);
    }
    const { run, channel, root } = await requireActivePageRun(owner, input.agentRun);
    if (channel.authority.executionKind !== "live")
      throw new HttpError(422, "Management operations do not support test data", "BUILD_TEST_UNSUPPORTED");
    const { use, framePanelId } = await requirePanelSkillForRun(owner, credentials, run, input);
    const current = writeOperation(await declaredOperation(owner, credentials, use, input, invocationTarget(input), undefined, {
      mode: "prepare",
      framePanelId,
    }));
    refuseAgentUpload(current.handler, credentials.locale);
    const concrete = materializeWriteInvocation(input, current);
    const secrets = redactInvocation(concrete, current, input.secretFields);
    if (!(current.isFormSave && "call" in concrete) &&
        secrets.secrets.some(values => [...values.values()].some(panelSecretValuePresent))) {
      requireHumanSecretInput(credentials.locale);
    }
    const prepared = confirmationInvocation(validateInvocation(current.handler, concrete, current.fixedTarget), secrets.redacted);
    const host = operationHost({ owner, credentials });
    const confirmation = await humanConfirmation(current.handler, host, prepared);
    const settings = await store.settings(owner, root);
    const autoMode = !settings.confirmBeforeExecute;
    const questionId = autoMode ? null : randomUUID();
    let questionPrompt: Awaited<ReturnType<typeof panelConfirmation>> | null = null;
    if (!autoMode) {
      const impact = confirmation.kind === "impact"
        ? confirmation.impact
        : confirmation.kind === "batch"
          ? confirmation.impact
          : undefined;
      const targets = confirmation.kind === "batch" && (!impact || confirmation.skippedSummary)
        ? confirmation.targets
        : impact;
      const target = targets
        ? namedTargets(targets.objects.map((object) => object.label), targets.total, credentials.locale)
        : await confirmationTarget(current.handler, host, prepared, current.operation.label);
      const impactSummary = [
        impact?.summary ?? confirmationInputSummary(current.handler, prepared),
        confirmation.kind === "batch" ? confirmation.skippedSummary : undefined,
      ].filter(Boolean).join("\n");
      questionPrompt = await panelConfirmation(credentials, {
        operation: current.operation.label,
        target,
        impactSummary,
        executionUserId: null,
        initiatorName: callerUserName ?? owner.userId,
      });
    }
    const intent: PanelHumanOperationIntent = {
      intentId: randomUUID(),
      source: {
        kind: "agent-page",
        sessionId: input.agentRun.sessionId,
        runId: input.agentRun.runId,
        toolCallId: input.agentRun.toolCallId,
        rootSession: root,
        autoMode,
        questionId,
      },
      initiator: owner,
      use: { applicationId: input.applicationId, useId: input.useId },
      ...(input.root && { root: input.root }),
      panelId: current.rootPanelId,
      projectionId: current.projection.id,
      binding: current.projection.binding,
      operation: current.operation,
      ...secrets.redacted,
      ...(secrets.paths.length && { redactedSecretFields: secrets.paths }),
      confirmation,
      dispatched: false,
      outcome: null,
    };
    // Persist the intent BEFORE publishing the conversation question so answering immediately can never race ahead of intent registration.
    await persistIntent(owner, intent, secrets);
    if (questionPrompt && questionId) {
      try {
        await new RuntimeClient(owner.domainId, undefined, owner.userId).request("/v1/channel/user-questions", "POST", {
          source: { session: { providerId: channel.agent.providerId, sessionId: run.sessionId }, runId: input.agentRun.runId },
          ...questionPrompt,
        }, questionId);
      } catch (error) {
        await store.cancelIntent(owner, intent.intentId, {
          code: "CONFIRMATION_PUBLISH_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    return humanPreparation(intent);
  }
  const current = writeOperation(await operationForUse(owner, credentials, input, invocationTarget(input), {
    mode: "prepare",
  }));
  const concrete = materializeWriteInvocation(input, current);
  const secrets = redactInvocation(concrete, current, input.secretFields);
  const prepared = confirmationInvocation(validateInvocation(current.handler, concrete, current.fixedTarget), secrets.redacted);
  const staged = await withStagedFile(owner, input, current.handler, prepared, credentials.locale);
  const confirmation = await humanConfirmation(current.handler, operationHost({ owner, credentials }), staged.invocation, staged.upload?.file);
  const intent: PanelHumanOperationIntent = {
    intentId: randomUUID(),
    source: { kind: "human" },
    initiator: owner,
    use: { applicationId: input.applicationId, useId: input.useId },
    ...(input.root && { root: input.root }),
    panelId: current.rootPanelId,
    projectionId: current.projection.id,
    binding: current.projection.binding,
    operation: current.operation,
    ...secrets.redacted,
    ...(secrets.paths.length && { redactedSecretFields: secrets.paths }),
    confirmation,
    dispatched: false,
    outcome: null,
  };
  await persistIntent(owner, intent, secrets);
  return humanPreparation(intent);
}

const pendingLocalConfirmations = new Map<string, {
  readonly domainId: string;
  readonly userId: string;
  readonly intentId: string;
  readonly createdAt: number;
}>();
const MAX_PENDING_LOCAL_CONFIRMATIONS = 1000;

export function registerPendingLocalConfirmation(owner: AssistantOwner, questionId: string, intentId: string): void {
  pendingLocalConfirmations.set(questionId, {
    domainId: owner.domainId,
    userId: owner.userId,
    intentId,
    createdAt: Date.now(),
  });
  while (pendingLocalConfirmations.size > MAX_PENDING_LOCAL_CONFIRMATIONS) {
    const oldest = pendingLocalConfirmations.keys().next().value;
    if (oldest === undefined) break;
    pendingLocalConfirmations.delete(oldest);
  }
}

export function claimPendingLocalConfirmation(
  owner: AssistantOwner,
  questionId: string,
): { readonly ok: true; readonly intentId: string } | { readonly ok: false; readonly message: string } {
  const entry = pendingLocalConfirmations.get(questionId);
  if (!entry || entry.domainId !== owner.domainId || entry.userId !== owner.userId) {
    return {
      ok: false,
      message: "The local confirmation question was already consumed, cancelled, or expired.",
    };
  }
  pendingLocalConfirmations.delete(questionId);
  return { ok: true, intentId: entry.intentId };
}

export async function cancelHumanPanelOperation(owner: AssistantOwner, id: string, reason: { code: string; message: string }) {
  const cancelled = await store.cancelIntent(owner, id, reason);
  return { intentId: id, cancelled };
}

export async function cancelPendingAgentPageQuestion(owner: AssistantOwner, questionId: string, reason: { code: string; message: string }) {
  const cancelled = await store.cancelPendingAgentPageQuestion(owner, questionId, reason);
  if (cancelled) return { stale: true as const, intentId: cancelled.intentId };
  const local = pendingLocalConfirmations.get(questionId);
  if (local && local.domainId === owner.domainId && local.userId === owner.userId) {
    pendingLocalConfirmations.delete(questionId);
    return { stale: true as const, intentId: local.intentId };
  }
  return { stale: false as const };
}

export async function dispatchHumanPanelOperation(owner: AssistantOwner, credentials: AssistantCredentials, id: string): Promise<PanelHumanOperationDispatchResponse> {
  const record = await store.get(owner, id);
  if (record.kind !== "current")
    throw new HttpError(403, "This intent was not prepared for human dispatch", "FORBIDDEN");
  const { intent } = record;
  if (intent.dispatched || intent.invalidated) return replay(record, owner, credentials);
  const claimedIntent: PanelHumanOperationIntent =
    intent.source.kind === "agent-page" && !intent.source.autoMode
      ? { ...intent, source: { ...intent.source, confirmedBy: owner.userId } }
      : intent;
  const ref = { ...intent.use, root: intent.root, operationId: intent.operation.id, memberPath: intent.operation.memberPath };
  const current = writeOperation(await operationForUse(owner, credentials, ref, invocationTarget(intent), { mode: "dispatch" }));
  let invocation = invocationOf(intent);
  if (intent.redactedSecretFields?.length) {
    const secrets = panelSecretStore.take(owner, id);
    if (!secrets) return {
      kind: "not-dispatched", intentId: id, code: "PANEL_SECRET_EXPIRED",
      message: tForLocale(credentials.locale, "panels.secret.expired"),
    };
    invocation = mapInvocation(invocation, (input, index) => restorePanelSecrets(input, secrets[index]!));
  }
  requireFrozenOperation({ ...intent, ...invocation }, current);
  const prepared = validateInvocation(current.handler, invocation, current.fixedTarget);
  // An expired or missing file refuses before the intent is claimed, so nothing is spent.
  const staged = await withStagedFile(owner, ref, current.handler, prepared, credentials.locale);
  const view = current.handler.projectResult && await readAssistantSkillView(owner.domainId, credentials);
  const host = operationHost({ owner, credentials }, view);
  const result = await claimAndExecutePanel(owner, host, claimedIntent, current.handler, staged.invocation);
  const outcome = result?.persistedOutcome;
  if (outcome?.kind === "success" && intent.source.kind === "agent-page" && intent.source.rootSession && "call" in staged.invocation) {
    const { target: preparedTarget } = staged.invocation;
    const target = preparedTarget?.kind === "object"
      ? { objectType: preparedTarget.objectType, primaryKey: preparedTarget.primaryKey }
      : null;
    publishObjectChanged(intent.initiator, {
      type: "object-changed",
      session: intent.source.rootSession,
      target,
      operation: {
        operationId: intent.operation.id,
        panelId: intent.panelId,
        target,
        ...(outcome.message !== undefined && { message: outcome.message }),
        ...(outcome.created && { created: outcome.created }),
        ...(outcome.secretGenerated && { secretGenerated: true }),
      },
      ...(outcome.affected && { affected: outcome.affected }),
    });
  }
  // A refused call keeps its file for the reader's retry, such as confirming an overwrite.
  if (result?.outcome.kind === "success" && staged.upload) await uploads.remove(owner, staged.upload.id);
  const canReceiveSecrets = credentials.token && credentials.headers?.[AGENT_EXECUTION_HEADER] === undefined;
  return result
    ? { kind: "dispatched", intentId: id, outcome: await presentOutcome({ operation: intent.operation, outcome: canReceiveSecrets ? result.outcome : result.persistedOutcome }, owner, credentials, view) }
    : replay(await store.get(owner, id), owner, credentials);
}

function namedTargets(labels: string[], total: number, locale?: string) {
  if (total === 0) return tForLocale(locale, "panels.confirmation.noExecutableTargets");
  const names = new Intl.ListFormat(locale).format(labels);
  return `${names} (${new Intl.NumberFormat(locale).format(total)})`.trim();
}

function batchOutcome(value: unknown, calls: readonly PanelBatchCalls[number][]): PanelOperationOutcome {
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
  const once = (targets: PanelObjectIdentity[]) => [...new Map(targets.map(target =>
    [JSON.stringify([target.objectType, target.primaryKey]), target] as const)).values()];
  const objects = once(successes.flatMap(({ objects }) => objects));
  const removed = once(successes.flatMap(({ removed }) => removed ?? []));
  const objectTypes = new Set(successes.flatMap(affected => affected.objectTypes));
  return { kind: "batch", items, affected: { objects, objectTypes: [...objectTypes], ...(removed.length && { removed }) } };
}

async function partitionBatch(
  host: PanelOperationHost, { owner, calls }: Extract<CheckedInvocation, { calls: PanelBatchCalls }>,
) {
  const reasons = await resolveBatchUnavailableReasons(host, owner, calls.map(({ target }, index) =>
    ({ target, rowKey: String(index) })));
  const executable = calls.filter((_, index) => !reasons.get(String(index)));
  return { executable, reasons };
}

async function executeAvailableBatch(
  host: PanelOperationHost, invocation: Extract<CheckedInvocation, { calls: PanelBatchCalls }>, id: string,
): Promise<PanelOperationOutcome> {
  const { owner, calls } = invocation;
  const { executable, reasons } = await partitionBatch(host, invocation);
  const executed = executable.length > 0
    ? batchOutcome(await owner.executeBatch(host, executable, id), executable)
    : null;
  if (executable.length === calls.length) return executed!;

  let executedIndex = 0;
  const item = ({ target }: PanelBatchCalls[number], index: number) => {
    const unavailable = reasons.get(String(index));
    const outcome: BatchItemOperationOutcome = unavailable
      ? { kind: "skipped", reason: unavailable.reason }
      : executed!.kind === "batch" ? executed!.items[executedIndex++]!.outcome : executed!;
    return { target: { objectType: target.objectType, primaryKey: target.primaryKey }, outcome };
  };
  const [first, ...rest] = calls;
  const affected = executed?.kind === "batch" || executed?.kind === "success" ? executed.affected : undefined;
  return { kind: "batch", items: [item(first, 0), ...rest.map((call, index) => item(call, index + 1))], ...(affected && { affected }) };
}

function confirmationInputSummary(handler: PanelWriteServerOperation, invocation: CheckedInvocation): string | undefined {
  if (!("call" in invocation)) return undefined;
  const isFormSave = handler.kind === "form.save";
  const isObjectAction = handler.kind === "action" && handler.handlerRef === EXECUTE_OBJECT_ACTION;
  if (!isFormSave && !isObjectAction) return undefined;
  const { values, submittedFields } = invocation.call.input;
  const fields = isFormSave && Array.isArray(submittedFields)
    ? (submittedFields as string[]).map(pointer => pointer.replace(/^\//u, ""))
    : Object.keys((values ?? {}) as Record<string, unknown>);
  return fields.length ? fields.join(", ") : undefined;
}

async function confirmationTarget(handler: PanelWriteServerOperation,
  host: PanelOperationHost, invocation: CheckedInvocation, operationLabel: string,
) {
  if (handler.kind === "form.save") {
    if ("call" in invocation && invocation.target?.kind === "object") {
      return `${invocation.target.objectType} (${invocation.target.primaryKey})`;
    }
    return operationLabel;
  }
  // An action without a target is named by the operation itself.
  return handler.targetLabel && "call" in invocation
    ? handler.targetLabel(host, invocation.target as PanelRecordTarget, invocation.call.input)
    : operationLabel;
}

/** Form owners may acknowledge fields already saved before a refusal. Keep the acknowledgement without its value. */
function redactSavedFormFields(outcome: SinglePanelOperationOutcome, paths: readonly string[]): SinglePanelOperationOutcome {
  if ((outcome.kind !== "refusal" && outcome.kind !== "failure") || !outcome.savedFields) return outcome;
  const savedFields = Object.fromEntries(Object.entries(outcome.savedFields).map(([field, value]) => {
    const pointer = normalizePanelSecretPointer(field);
    const secretPaths = paths.map(path => path.slice("/values".length))
      .filter(path => panelSecretPathsOverlap(path, pointer));
    if (!secretPaths.length) return [field, value];
    return [field, splitPanelSecrets({ value }, secretPaths.map(path =>
      path.startsWith(`${pointer}/`) ? `/value${path.slice(pointer.length)}` : "/value",
    )).redacted.value ?? null];
  }));
  return { ...outcome, savedFields };
}

async function claimAndExecutePanel(owner: AssistantOwner, host: PanelOperationHost, intent: PanelOperationIntent,
  handler: PanelWriteServerOperation, prepared: CheckedInvocation,
) {
  // The name the owner's completion sentence gives, read while the target is still there; a target that cannot be read
  // fails here, before anything is claimed or written.
  const done = handler.kind === "action" && handler.done && "call" in prepared
    ? handler.done(host, await handler.targetLabel(host, prepared.target as PanelRecordTarget, "call" in intent ? intent.call.input : undefined))
    : undefined;
  if (!await store.claim(owner, intent)) return;
  const id = intent.intentId;
  let outcome: PanelOperationOutcome;
  try {
    if ("calls" in prepared) {
      outcome = await executeAvailableBatch(host, prepared, id);
    } else {
      outcome = await executeOwner(handler, host, prepared.target, prepared.call.input, id);
      if (handler.kind === "form.save" && intent.redactedSecretFields?.length) {
        outcome = redactSavedFormFields(outcome, intent.redactedSecretFields.filter(path => path.startsWith("/values/")));
      }
      if (done !== undefined && outcome.kind === "success" && !outcome.secret && outcome.message === undefined) outcome = { ...outcome, message: done };
    }
  } catch (error) {
    // An uncertain owner call never releases the irreversible claim.
    outcome = { kind: "unknown", message: intent.redactedSecretFields?.length
      ? tForLocale(host.locale, "panels.secret.outcomeUnknown")
      : error instanceof Error ? error.message : String(error) };
  }
  const persistedOutcome = withoutPanelSecretDelivery(outcome, tForLocale(host.locale, "panels.secret.generated"));
  await store.outcome(owner, id, persistedOutcome);
  const written = persistedOutcome.kind === "batch"
    ? persistedOutcome.items.flatMap(item => writtenObjects(item.outcome, [item.target]))
    : writtenObjects(persistedOutcome, "calls" in prepared
      ? prepared.calls.map(call => call.target)
      : prepared.target?.kind === "object" ? [prepared.target] : []);
  if (written.length) {
    await store.invalidatePendingObjectWrites(owner, id, written, {
      code: "FORM_CONFIRMATION_STALE",
      message: "This record was already saved in another action or tab.",
    });
  }
  return { outcome, persistedOutcome };
}

function writtenObjects(outcome: BatchItemOperationOutcome, targets: readonly PanelObjectIdentity[]): PanelObjectIdentity[] {
  if (outcome.kind === "unknown" || outcome.kind === "skipped") return [];
  const writtenTargets = outcome.kind === "success" || Object.keys(outcome.savedFields ?? {}).length > 0 ? targets : [];
  return [...writtenTargets, ...(outcome.affected?.objects ?? []), ...(outcome.affected?.removed ?? [])];
}
/** The checked target was parsed by this handler's own target schema, so it is the one its `execute` takes. */
function executeOwner(handler: PanelWriteServerOperation, host: PanelOperationHost, target: PanelOperationTarget | null,
  input: Record<string, unknown>, intentId: string,
): Promise<SinglePanelOperationOutcome> {
  const execute = handler.execute as (host: PanelOperationHost, target: PanelOperationTarget | null, input: Record<string, unknown>, intentId: string) => Promise<SinglePanelOperationOutcome>;
  return execute.call(handler, host, target, input, intentId);
}
/** Exact human owner, independent of readable/admin access and of any old run's liveness. */
export async function ownPanelSettings(owner: AssistantOwner, root: AgentSessionRef) {
  const actor = await readAgentSessionActor(root, owner.domainId);
  if (!isDeepStrictEqual((await restoreAgentCaller(actor,owner.domainId,true)).owner,owner)) throw new HttpError(403,"Only the session owner may change confirmation","FORBIDDEN");
}
