import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelHumanOperationDispatchResponse } from "@ontomato/contracts/panel-agent";
import type { PanelObjectIdentity, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor, PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import { slotInputState, type PanelContext, type ProjectionSlot } from "../panel/context";
import type { PanelWriteResult } from "../panel/instance";
import type { PanelMemberContext } from "../panel/member";
import { readOperationInput } from "../panel/read-operation-input";
import { stateObject, stateObjects, type PanelFieldValue } from "../panel/state";
import { operationInputFields, type OperationInputField } from "./operation-input-schema";

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

/** Resolves the target object or batch checked list bound to an owner-described projection operation. */
export function resolveOperationTarget(
  panel: PanelContext | null,
  slot: ProjectionSlot | null,
  member: PanelMemberContext | null,
  descriptor: PanelOwnerOperationDescriptor | null,
  stateValues: Readonly<Record<string, PanelFieldValue>>,
): OperationTargetInfo {
  if (!panel || !slot || !descriptor) return EMPTY_TARGET_INFO;
  const rowOperation = member?.rowOperation ?? null;
  const targetState = descriptor.target.source === "input"
    ? slotInputState(panel.manifest, slot.slot, descriptor.target.input)
    : null;
  const batch = !rowOperation && targetState !== null && panel.manifest.state[targetState]?.type.kind === "list";
  const checkedState = batch ? targetState : null;
  const checkedObjects = checkedState === null ? [] : stateObjects(stateValues[checkedState]);
  const checkedTargets = checkedObjects.map(({ className, primaryKey }) => ({
    kind: "object" as const,
    objectType: className,
    primaryKey,
  }));
  const selected = rowOperation || targetState === null || batch ? null : stateObject(stateValues[targetState]);
  const target: PanelOperationCall["target"] = selected
    ? { kind: "object", objectType: selected.className, primaryKey: selected.primaryKey }
    : null;
  return { batch, checkedState, checkedObjects, checkedTargets, target };
}

/** Whether an admitted operation can currently be triggered by the reader. */
export function isOperationReady(
  descriptor: PanelOwnerOperationDescriptor | null,
  targetInfo: OperationTargetInfo,
  hasRowOperation: boolean,
  running: boolean,
): boolean {
  if (!descriptor || running || descriptor.unavailable) return false;
  if (hasRowOperation) return true;
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
  const boundParams = new Set(Object.keys(slot.projection.operations?.[operationName]?.params ?? {}));
  return operationInputFields(descriptor.inputSchema, boundParams);
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
  ): Promise<void>;
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
  onDone?: (operationName: string, outcome: OperationOutcome) => void;
}): OperationRunner {
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
  ) {
    const panel = options.panel();
    const slot = options.slot();
    const member = options.member();
    if (!panel || !slot || running.value) return;

    const stateValues = panel.instance.state.values.value;
    const targetInfo = resolveOperationTarget(panel, slot, member, descriptor, stateValues);
    const rowOperation = member?.rowOperation ?? null;
    const operationId = panel.instance.operationIdOf(slot.slot, operationName);

    runningOperation.value = operationName;
    dispatchingOperation.value = descriptor.effect === "read" ? operationName : null;
    failure.value = null;
    read.value = null;
    receipt.value = null;
    try {
      if (descriptor.effect === "read") {
        if (rowOperation) {
          throw new Error(`Row operation '${operationName}' must be a write operation`);
        }
        const { target: owned } = descriptor;
        const hasDeclaredReadInputs = panel.manifest.members[slot.slot]?.readOperationInputs?.[operationName] !== undefined;
        const input = owned.source === "draft" || hasDeclaredReadInputs
          ? readOperationInput(
              panel.instance,
              slot.slot,
              operationName,
              owned.source === "draft" ? panel.instance.forms.handle(owned.slot)!.values.value : {},
            )
          : providedInput;
        read.value = await panel.instance.readOperation(operationId, { target: targetInfo.target, input });
        return;
      }

      const onConfirmed = () => {
        dispatchingOperation.value = operationName;
      };
      const answer = rowOperation
        ? await rowOperation.run(operationName, providedInput, { onConfirmed })
        : await (() => {
            const [first, ...rest] = targetInfo.checkedTargets.map((object) => ({ target: object, input: providedInput }));
            return panel.instance.writeOperation(
              operationId,
              first ? { calls: [first, ...rest] } : { call: { target: targetInfo.target, input: providedInput } },
              { onConfirmed },
            );
          })();
      if (answer.decision === "cancel") return;
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
    } catch (reason) {
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
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
