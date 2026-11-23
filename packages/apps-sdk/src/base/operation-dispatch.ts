import { computed, onScopeDispose, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type { PageActionConfirmedDispatchResult } from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelHumanOperationDispatchResponse } from "@ontomato/contracts/panel-agent";
import type { PanelManifest, PanelObjectIdentity, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor, PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import { slotInputState, type PanelContext, type ProjectionSlot } from "../panel/context";
import {
  classifyDispatchResponseForConfirmation,
  PanelConfirmationDeferred,
  PanelOperationDeferred,
  type PanelAgentActionContext,
  type PanelWriteResult,
} from "../panel/instance";
import {
  createDeferredConfirmation,
  PanelSubmissionStaleError,
  type SubmissionEvaluator,
} from "../panel/operation-binding";
import type { PanelMemberContext } from "../panel/member";
import { readOperationInput } from "../panel/read-operation-input";
import { stateObject, stateObjects, type PanelFieldValue } from "../panel/state";
import {
  isActionValuesEnvelope,
  operationInputFields,
  wrapActionOperationInput,
  type OperationInputField,
} from "./operation-input-schema";

export type OperationOutcome = NonNullable<
  Extract<PanelHumanOperationDispatchResponse, { kind: "dispatched" }>["outcome"]
>;
export type SingleOperationOutcome = Exclude<OperationOutcome, { kind: "batch" }>;

export interface OperationTargetInfo {
  readonly batch: boolean;
  readonly checkedState: string | null;
  readonly checkedObjects: ReturnType<typeof stateObjects>;
  readonly checkedTargets: readonly { kind: "object"; objectType: string; primaryKey: string }[];
  readonly target: PanelOperationCall["target"];
}

export type OperationTranslator = (key: string, params?: Record<string, unknown>) => string;

const EMPTY_TARGET_INFO: OperationTargetInfo = {
  batch: false,
  checkedState: null,
  checkedObjects: [],
  checkedTargets: [],
  target: null,
};

/** Resolves the target object or batch checked list bound to an owner-described member operation. */
export function resolveMemberOperationTarget(
  manifest: PanelManifest | null,
  memberSlot: string | null,
  descriptor: PanelOwnerOperationDescriptor | null,
  stateValues: Readonly<Record<string, PanelFieldValue>>,
): OperationTargetInfo {
  if (!manifest || !memberSlot || !descriptor) return EMPTY_TARGET_INFO;
  const targetState = descriptor.target.source === "input"
    ? slotInputState(manifest, memberSlot, descriptor.target.input)
    : null;
  const batch = targetState !== null && manifest.state[targetState]?.type.kind === "list";
  const checkedState = batch ? targetState : null;
  const checkedObjects = checkedState === null ? [] : stateObjects(stateValues[checkedState]);
  const checkedTargets = checkedObjects.map(({ className, primaryKey }) => ({
    kind: "object" as const,
    objectType: className,
    primaryKey,
  }));
  const selected = targetState === null || batch ? null : stateObject(stateValues[targetState]);
  const target: PanelOperationCall["target"] = selected
    ? { kind: "object", objectType: selected.className, primaryKey: selected.primaryKey }
    : null;
  return { batch, checkedState, checkedObjects, checkedTargets, target };
}

/** Resolves the target object or batch checked list bound to an owner-described projection operation. */
export function resolveOperationTarget(
  panel: PanelContext | null,
  slot: ProjectionSlot | null,
  _member: PanelMemberContext | null,
  descriptor: PanelOwnerOperationDescriptor | null,
  stateValues: Readonly<Record<string, PanelFieldValue>>,
): OperationTargetInfo {
  return resolveMemberOperationTarget(panel?.manifest ?? null, slot?.slot ?? null, descriptor, stateValues);
}

/** Whether an admitted operation can currently be triggered by the reader. */
export function isOperationReady(
  descriptor: PanelOwnerOperationDescriptor | null,
  targetInfo: OperationTargetInfo,
  running: boolean,
): boolean {
  if (!descriptor || running || descriptor.unavailable) return false;
  if (targetInfo.checkedState !== null) return targetInfo.checkedTargets.length > 0;
  return descriptor.target.source !== "input" || targetInfo.target !== null;
}

/** Formats the display label of an operation, appending checked count when bound to a batch list. */
export function formatOperationLabel(
  descriptor: PanelOwnerOperationDescriptor,
  targetInfo: OperationTargetInfo,
  t: OperationTranslator,
): string {
  return targetInfo.batch
    ? t("platform.operationChecked", { label: descriptor.label, count: targetInfo.checkedObjects.length })
    : descriptor.label;
}

export function resolveBoundOperationParams(
  slot: ProjectionSlot | null,
  member: PanelMemberContext | null,
  operationName: string,
): Record<string, RuntimeJsonValue> {
  const binding = slot?.projection.operations?.[operationName];
  if (!binding?.params) return {};
  const inputs = member?.inputs.value ?? {};
  const resolved: Record<string, RuntimeJsonValue> = {};
  for (const [paramKey, spec] of Object.entries(binding.params)) {
    if ("literal" in spec) {
      resolved[paramKey] = spec.literal;
    } else if ("input" in spec && Object.hasOwn(inputs, spec.input)) {
      const val = inputs[spec.input];
      if (val !== undefined && val !== null) resolved[paramKey] = val;
    }
  }
  return resolved;
}

/**
 * Editable parameter fields declared by the owner's `inputSchema.properties`.
 * Absent for file-upload actions, draft/readOperationInputs-bound reads, and keys already bound by `operation.params`.
 */
export function resolveOperationInputFields(
  panel: PanelContext | null,
  slot: ProjectionSlot | null,
  operationName: string,
  descriptor: PanelOwnerOperationDescriptor | null,
): readonly OperationInputField[] {
  if (!panel || !slot || !descriptor || descriptor.upload) return [];
  const hasDeclaredReadInputs = panel.manifest.members[slot.slot]?.readOperationInputs?.[operationName] !== undefined;
  if (descriptor.effect === "read" && (descriptor.target.source === "draft" || hasDeclaredReadInputs)) return [];
  const hasDeclaredDraft = panel.manifest.members[slot.slot]?.operationDrafts?.[operationName] !== undefined;
  if (descriptor.effect === "write" && hasDeclaredDraft) return [];
  const boundParams = new Set(Object.keys(slot.projection.operations?.[operationName]?.params ?? {}));
  return operationInputFields(descriptor.inputSchema, boundParams);
}

/**
 * Filters caller-supplied operation inputs strictly to the interactive fields a human would be prompted to enter.
 * Parameters sourced from form fields, fixed literals, or state/input wirings are excluded.
 */
export function filterAllowedOperationInput(
  input: Readonly<Record<string, RuntimeJsonValue>> | undefined,
  fields: readonly OperationInputField[],
): Record<string, RuntimeJsonValue> {
  if (!input) return {};
  const allowed = new Set(fields.map((field) => field.name));
  const filtered: Record<string, RuntimeJsonValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key) && value !== undefined) filtered[key] = value;
  }
  return filtered;
}

/** Renders one single-item operation outcome in the reader's language using the owner's own message when provided. */
export function formatOperationOutcome(outcome: SingleOperationOutcome, t: OperationTranslator): string {
  return outcome.kind === "success"
    ? outcome.message ?? t("platform.operationDone")
    : outcome.kind === "unknown"
      ? t("platform.operationUnknown", { message: outcome.message })
      : outcome.message;
}

export interface OperationRunner {
  readonly running: ComputedRef<boolean>;
  readonly runningOperation: Ref<string | null>;
  /** True only while the operation is actively executing on the server (never before or during a confirmation prompt). */
  readonly dispatching: ComputedRef<boolean>;
  readonly failure: ShallowRef<Error | null>;
  readonly read: ShallowRef<PanelReadOperationResult | null>;
  readonly receipt: ShallowRef<PanelHumanOperationDispatchResponse | null>;
  readonly named: ShallowRef<PanelWriteResult["named"]>;
  readonly outcome: ComputedRef<OperationOutcome | null>;
  readonly batchItems: ComputedRef<readonly Extract<OperationOutcome, { kind: "batch" }>["items"][number][]>;
  readonly batchDone: ComputedRef<number>;
  readonly inputDialogOpen: Ref<boolean>;
  readonly pendingOperation: Ref<string | null>;
  readonly pendingDescriptor: ShallowRef<PanelOwnerOperationDescriptor | null>;
  readonly pendingInputFields: ComputedRef<readonly OperationInputField[]>;
  said(outcome: SingleOperationOutcome): string;
  nameOf(target: PanelObjectIdentity): string;
  trigger(operationName: string, descriptor: PanelOwnerOperationDescriptor): void;
  confirmInput(providedInput: Record<string, RuntimeJsonValue>): Promise<void>;
  run(
    operationName: string,
    descriptor: PanelOwnerOperationDescriptor,
    providedInput?: Record<string, RuntimeJsonValue>,
    agentContext?: PanelAgentActionContext,
  ): Promise<"executed" | "cancelled" | "skipped">;
  reset(): void;
}

/**
 * Shared execution state and dispatch path for `OperationButton` and `ObjectHeader`'s "More" menu:
 * handles editable parameter dialog opening, read/write dispatch, host confirmation, batch checked-list pruning,
 * platform toast notification on single-item success, and inline error/batch feedback.
 */
export function useOperationRunner(options: {
  panel: () => PanelContext | null;
  slot: () => ProjectionSlot | null;
  member: () => PanelMemberContext | null;
  t: OperationTranslator;
  /** Checks whether the mounted UI entry (button or overflow item) is still visible and enabled. */
  isEntryAvailable?: (operationName: string) => { readonly ok: true } | { readonly ok: false; readonly message: string };
  onDone?: (operationName: string, outcome: OperationOutcome) => void;
}): OperationRunner {
  let runnerDisposed = false;
  onScopeDispose(() => {
    runnerDisposed = true;
  });
  const runningOperation = ref<string | null>(null);
  const running = computed(() => runningOperation.value !== null);
  const dispatchingOperation = ref<string | null>(null);
  const dispatching = computed(() => dispatchingOperation.value !== null);
  const failure = shallowRef<Error | null>(null);
  const read = shallowRef<PanelReadOperationResult | null>(null);
  const receipt = shallowRef<PanelHumanOperationDispatchResponse | null>(null);
  const named = shallowRef<PanelWriteResult["named"]>([]);
  const inputDialogOpen = ref(false);
  const pendingOperation = ref<string | null>(null);
  const pendingDescriptor = shallowRef<PanelOwnerOperationDescriptor | null>(null);

  const pendingInputFields = computed<readonly OperationInputField[]>(() => {
    if (!pendingOperation.value || !pendingDescriptor.value) return [];
    return resolveOperationInputFields(options.panel(), options.slot(), pendingOperation.value, pendingDescriptor.value);
  });

  const outcome = computed<OperationOutcome | null>(() =>
    receipt.value?.kind === "dispatched" ? receipt.value.outcome ?? null : null,
  );
  const batchItems = computed(() => (outcome.value?.kind === "batch" ? outcome.value.items : []));
  const batchDone = computed(() => batchItems.value.filter((item) => item.outcome.kind === "success").length);

  const said = (single: SingleOperationOutcome) => formatOperationOutcome(single, options.t);
  const nameOf = (target: PanelObjectIdentity) =>
    named.value.find(({ target: known }) =>
      known.objectType === target.objectType && known.primaryKey === target.primaryKey)?.label ?? target.primaryKey;

  function reset() {
    inputDialogOpen.value = false;
    pendingOperation.value = null;
    pendingDescriptor.value = null;
    failure.value = null;
    read.value = null;
    receipt.value = null;
  }

  function trigger(operationName: string, descriptor: PanelOwnerOperationDescriptor) {
    if (running.value) return;
    const panel = options.panel();
    const slot = options.slot();
    const fields = resolveOperationInputFields(panel, slot, operationName, descriptor);
    if (fields.length > 0) {
      failure.value = null;
      pendingOperation.value = operationName;
      pendingDescriptor.value = descriptor;
      inputDialogOpen.value = true;
      return;
    }
    void run(operationName, descriptor, {});
  }

  async function confirmInput(providedInput: Record<string, RuntimeJsonValue>) {
    const operationName = pendingOperation.value;
    const descriptor = pendingDescriptor.value;
    if (!operationName || !descriptor) return;
    await run(operationName, descriptor, providedInput);
  }

  async function run(
    operationName: string,
    descriptor: PanelOwnerOperationDescriptor,
    providedInput: Record<string, RuntimeJsonValue> = {},
    agentContext?: PanelAgentActionContext,
  ): Promise<"executed" | "cancelled" | "skipped"> {
    const panel = options.panel();
    const slot = options.slot();
    const member = options.member();
    if (!panel || !slot || running.value) return "skipped";

    const stateValues = panel.instance.state.values.value;
    const targetInfo = resolveOperationTarget(panel, slot, member, descriptor, stateValues);
    const operationId = panel.instance.operationIdOf(slot.slot, operationName);

    runningOperation.value = operationName;
    dispatchingOperation.value = descriptor.effect === "read" ? operationName : null;
    failure.value = null;
    read.value = null;
    receipt.value = null;
    try {
      const boundInput = resolveBoundOperationParams(slot, member, operationName);
      const allowedFields = resolveOperationInputFields(panel, slot, operationName, descriptor);
      const filteredProvided = filterAllowedOperationInput(providedInput, allowedFields);
      const effectiveInput: Record<string, RuntimeJsonValue> = isActionValuesEnvelope(descriptor.inputSchema)
        ? wrapActionOperationInput(descriptor.inputSchema, boundInput, filteredProvided)
        : { ...filteredProvided, ...boundInput };

      if (descriptor.effect === "read") {
        const { target: owned } = descriptor;
        const hasDeclaredReadInputs = panel.manifest.members[slot.slot]?.readOperationInputs?.[operationName] !== undefined;
        const input = owned.source === "draft" || hasDeclaredReadInputs
          ? readOperationInput(
              panel.instance,
              slot.slot,
              operationName,
              owned.source === "draft" ? panel.instance.forms.handle(owned.slot)!.values.value : {},
            )
          : effectiveInput;
        read.value = await panel.instance.readOperation(operationId, { target: targetInfo.target, input });
        return "executed";
      }

      const declaredDraftSlot = panel.manifest.members[slot.slot]?.operationDrafts?.[operationName]?.slot;
      if (declaredDraftSlot) {
        const evaluateOrigin = () => {
          if (runnerDisposed || !options.panel() || options.panel()!.instance.isDisposed()) {
            return { ok: false as const, message: "The triggering action button was closed or unmounted." };
          }
          const currentMember = options.member();
          if (currentMember) {
            const opsState = currentMember.operations.value;
            if (opsState.status !== "ready" || !opsState.value[operationName] || opsState.value[operationName]!.unavailable) {
              return { ok: false as const, message: `Operation '${operationName}' is no longer available.` };
            }
          }
          const entryCheck = options.isEntryAvailable?.(operationName);
          if (entryCheck && !entryCheck.ok) return entryCheck;
          return { ok: true as const };
        };
        if (descriptor.kind === "form.save" && declaredDraftSlot === slot.slot) {
          await panel.instance.forms.submit(
            slot.slot,
            agentContext ? { operationId, descriptor, evaluateOrigin, agentContext } : undefined,
          );
        } else {
          const binding = slot.projection.operations?.[operationName];
          await panel.instance.forms.submit(declaredDraftSlot, {
            operationId,
            descriptor,
            ...(binding ? { binding } : {}),
            ...(member ? { memberInputs: member.inputs.value, readMemberInputs: () => options.member()?.inputs.value } : {}),
            evaluateOrigin,
            ...(agentContext ? { agentContext } : {}),
          });
        }
        return "executed";
      }

      const applyWriteAnswer = (
        answer: { decision: "confirm" | "cancel"; response?: PanelHumanOperationDispatchResponse; named: PanelWriteResult["named"] },
      ) => {
        if (answer.decision === "cancel" || !answer.response) return undefined;
        named.value = answer.named;
        if (
          targetInfo.checkedState !== null
          && answer.response.kind === "dispatched"
          && answer.response.outcome?.kind === "batch"
        ) {
          const changed = new Set(
            answer.response.outcome.items
              .filter(({ outcome: itemOutcome }) => itemOutcome.kind === "success")
              .map(({ target: done }) => JSON.stringify([done.objectType, done.primaryKey])),
          );
          panel.instance.state.set(
            targetInfo.checkedState,
            targetInfo.checkedObjects.filter(({ className, primaryKey }) =>
              !changed.has(JSON.stringify([className, primaryKey]))),
          );
        }
        const answered = answer.response.kind === "dispatched" ? answer.response.outcome : undefined;
        if (answered?.kind === "success") panel.notify({ kind: "success", text: said(answered) });
        else receipt.value = answer.response;
        if (answered) options.onDone?.(operationName, answered);
        return answered;
      };

      const evaluateButtonSubmission: SubmissionEvaluator = (phase) => {
        const currentPanel = options.panel();
        const currentSlot = options.slot();
        const currentMember = options.member();
        if (runnerDisposed || !currentPanel || !currentSlot || currentPanel.instance.isDisposed()) {
          return { ok: false, message: "The action button or panel was closed or unmounted." };
        }
        if (phase === "confirm" && running.value) {
          return { ok: false, message: "Another operation is currently running." };
        }
        let liveDescriptor: PanelOwnerOperationDescriptor = descriptor;
        if (currentMember) {
          const opsState = currentMember.operations.value;
          if (opsState.status !== "ready" || !opsState.value[operationName]) {
            return { ok: false, message: `Operation '${operationName}' is no longer available.` };
          }
          liveDescriptor = opsState.value[operationName]!;
        }
        const entryCheck = options.isEntryAvailable?.(operationName);
        if (entryCheck && !entryCheck.ok) {
          return entryCheck;
        }
        const currentInfo = resolveOperationTarget(
          currentPanel,
          currentSlot,
          currentMember,
          liveDescriptor,
          currentPanel.instance.state.values.value,
        );
        if (!isOperationReady(liveDescriptor, currentInfo, phase === "confirm" ? running.value : false)) {
          return { ok: false, message: "This operation is no longer available." };
        }
        const liveBoundInput = resolveBoundOperationParams(currentSlot, currentMember, operationName);
        const liveAllowedFields = resolveOperationInputFields(currentPanel, currentSlot, operationName, liveDescriptor);
        const liveFilteredProvided = filterAllowedOperationInput(providedInput, liveAllowedFields);
        const liveEffectiveInput: Record<string, RuntimeJsonValue> = isActionValuesEnvelope(liveDescriptor.inputSchema)
          ? wrapActionOperationInput(liveDescriptor.inputSchema, liveBoundInput, liveFilteredProvided)
          : { ...liveFilteredProvided, ...liveBoundInput };
        return {
          ok: true,
          instanceId: currentPanel.instance.instanceId,
          operationId: currentPanel.instance.operationIdOf(currentSlot.slot, operationName),
          target: currentInfo.checkedState !== null ? currentInfo.checkedTargets : currentInfo.target,
          payload: {
            input: liveEffectiveInput,
            ...(currentInfo.checkedState !== null
              ? { calls: currentInfo.checkedTargets.map((object) => ({ target: object, input: liveEffectiveInput })) }
              : {}),
          },
        };
      };
      const onConfirmed = () => {
        dispatchingOperation.value = operationName;
      };
      const [first, ...rest] = targetInfo.checkedTargets.map((object) => ({ target: object, input: effectiveInput }));
      let answer: PanelWriteResult;
      try {
        answer = await panel.instance.writeOperation(
          operationId,
          first ? { calls: [first, ...rest] } : { call: { target: targetInfo.target, input: effectiveInput } },
          {
            onConfirmed,
            ...(agentContext ? { agentContext, evaluateSubmission: evaluateButtonSubmission } : {}),
          },
        );
      } catch (reason) {
        if (reason instanceof PanelOperationDeferred) {
          const deferred = reason;
          const { preparation } = deferred;
          const confirmation = createDeferredConfirmation({
            intentId: preparation.intentId,
            questionId: preparation.questionId!,
            operationId: preparation.operationId,
            label: preparation.label,
            isStillValid: deferred.isStillValid,
            cancel: deferred.cancelNow,
            async dispatchVerified(): Promise<PageActionConfirmedDispatchResult> {
              runningOperation.value = operationName;
              dispatchingOperation.value = operationName;
              failure.value = null;
              receipt.value = null;
              try {
                const confirmed = await deferred.dispatchNow();
                if (confirmed.decision !== "confirm") {
                  return { ok: false, intentId: preparation.intentId, reason: "not_dispatched", message: "Operation was cancelled." };
                }
                applyWriteAnswer({ ...confirmed, named: deferred.named });
                return classifyDispatchResponseForConfirmation(preparation.intentId, confirmed.response);
              } catch (dispatchReason) {
                failure.value = dispatchReason instanceof Error ? dispatchReason : new Error(String(dispatchReason));
                return {
                  ok: false,
                  intentId: preparation.intentId,
                  reason: "failed",
                  message: failure.value.message,
                };
              } finally {
                runningOperation.value = null;
                dispatchingOperation.value = null;
              }
            },
          });
          throw new PanelConfirmationDeferred(confirmation);
        }
        throw reason;
      }
      if (answer.decision === "cancel") return "cancelled";
      applyWriteAnswer(answer);
      return "executed";
    } catch (reason) {
      if (reason instanceof PanelConfirmationDeferred || reason instanceof PanelSubmissionStaleError) throw reason;
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
      return "executed";
    } finally {
      runningOperation.value = null;
      dispatchingOperation.value = null;
    }
  }

  return {
    running,
    runningOperation,
    dispatching,
    failure,
    read,
    receipt,
    named,
    outcome,
    batchItems,
    batchDone,
    inputDialogOpen,
    pendingOperation,
    pendingDescriptor,
    pendingInputFields,
    said,
    nameOf,
    trigger,
    confirmInput,
    run,
    reset,
  };
}
