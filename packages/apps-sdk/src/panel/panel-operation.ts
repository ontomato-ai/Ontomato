import {
  computed,
  getCurrentInstance,
  inject,
  onBeforeUnmount,
  ref,
  shallowRef,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
} from "vue";
import type { PageActionConfirmedDispatchResult } from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelObjectIdentity, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor, PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import type { ProjectionOperationBinding } from "@ontomato/contracts/panel-projection";
import {
  filterAllowedOperationInput,
  isOperationReady,
  resolveMemberOperationTarget,
} from "../base/operation-dispatch";
import {
  isActionValuesEnvelope,
  operationInputFields,
  wrapActionOperationInput,
  type OperationInputField,
} from "../base/operation-input-schema";
import { usePanelContext } from "./context";
import { directMountKey } from "./direct-projection";
import {
  classifyDispatchResponseForAction,
  classifyDispatchResponseForConfirmation,
  PanelConfirmationDeferred,
  PanelOperationDeferred,
  type PanelMountedActionHandler,
  type PanelMountedActionResult,
  type PanelWriteResult,
} from "./instance";
import type { PanelMemberContext } from "./member";
import { missingOperationDescriptorResult, type MemberOperationsState } from "./member-operations";
import {
  createDeferredConfirmation,
  matchesExpectedCheckedKeys,
  matchesExpectedTarget,
  PanelSubmissionStaleError,
  type SubmissionEvaluator,
} from "./operation-binding";
import { slotInputValues, type PanelProjectionRegistration } from "./ports";
import { readOperationInput } from "./read-operation-input";
import type { PanelOperationBinding } from "./types";

/*
 * One operation the panel's own code runs (the line's main control, 2026-11-21): an operation a member's projection
 * names under `operations.<name>`, found by the member and that name. It is the operation the page's header and an
 * agent run, as its owner admits it now: an action on an object is admitted once the object is chosen, and a read
 * (an export the reader saves) is read, a write frozen as one intent the host confirms where the owner asks.
 *
 * When a panel draws its own button, switch, or menu item rather than `<OperationButton>`, it registers that mounted
 * UI entry via `usePanelOperationAction(member, name, options)` (product-layer standard detail 3.8). The entry lives
 * strictly for the lifetime of the calling component's mount, shares one execution and settlement path between human
 * clicks and agent `page_action` calls, filters interactive inputs through the same schema, and enforces the universal
 * 4-tuple staleness check before auto-dispatch and conversation confirmation.
 */

/** One member's operation, as the page's code holds it. */
export interface PanelOperationHandle {
  /** The owner's description while it admits the operation now — its label, kind and target — else null. */
  readonly operation: ComputedRef<PanelOperationBinding | null>;
  /** Runs it with the page's own input; a read answers what it read (or the file the reader saved). */
  run(input?: Readonly<Record<string, unknown>>): Promise<unknown>;
}

/** Availability check answer for a custom mounted panel action entry. */
export interface PanelOperationActionAvailability {
  readonly ok: boolean;
  readonly message?: string;
}

/** Context passed to `onSettled` after a custom panel action executes (human, full-auto, or confirmed). */
export interface PanelOperationActionContext {
  readonly operationId: string;
  readonly input: Readonly<Record<string, RuntimeJsonValue>>;
  readonly target: PanelOperationCall["target"] | readonly PanelObjectIdentity[];
  readonly named: PanelWriteResult["named"];
}

/** Options for registering a mounted custom UI entry (button, switch, menu item) for a declared panel operation. */
export interface UsePanelOperationActionOptions {
  /**
   * Whether the custom UI entry is currently visible and available for the user.
   * Return `false` or `{ ok: false, message }` to refuse agent invocation and invalidate pending confirmations.
   */
  available?: MaybeRefOrGetter<boolean | PanelOperationActionAvailability>;
  /**
   * Whether the custom UI entry is currently disabled. A non-empty string disables the entry with that reason.
   */
  disabled?: MaybeRefOrGetter<boolean | string>;
  /**
   * Additional external busy guard (combined with this handle's own `running` state).
   */
  busy?: MaybeRefOrGetter<boolean>;
  /**
   * Optional synchronous input normalizer shared by human clicks and agent calls.
   * For agent calls, `provided` has already been filtered to unbound interactive schema fields.
   * Bound projection parameters always take precedence over the returned values.
   */
  prepareInput?: (
    provided: Readonly<Record<string, RuntimeJsonValue>>,
  ) => Readonly<Record<string, RuntimeJsonValue>>;
  /**
   * Panel-owned settlement callback (notifications, navigation, state updates, etc.) run on the exact same path
   * for human clicks, full-auto agent calls, and user-approved conversation confirmations.
   */
  onSettled?: (
    receipt: PanelWriteResult | PanelReadOperationResult,
    context: PanelOperationActionContext,
  ) => void | Promise<void>;
  /**
   * Optional error callback invoked when execution fails before dispatch (e.g. prepare failure).
   * Not invoked for deferred confirmation or stale-submission errors.
   */
  onError?: (
    error: Error,
    context: { readonly operationId: string; readonly input: Readonly<Record<string, RuntimeJsonValue>> },
  ) => void;
}

/** Mounted custom UI entry handle returned by `usePanelOperationAction`. */
export interface PanelOperationActionHandle {
  /** The owner's description while it admits the operation now — else null. */
  readonly operation: ComputedRef<PanelOperationBinding | null>;
  /** Live member operations read state (`loading`, `ready`, `forbidden`, `error`, `empty`). */
  readonly state: ComputedRef<MemberOperationsState>;
  /** True while this action is preparing, awaiting confirmation, or dispatching. */
  readonly running: ComputedRef<boolean>;
  /** True only while the action is actively dispatching on the server. */
  readonly dispatching: ComputedRef<boolean>;
  /** Runs the operation from the panel's own UI control (button/switch/menu) through the shared path. */
  run(input?: Readonly<Record<string, RuntimeJsonValue>>): Promise<PanelWriteResult | PanelReadOperationResult | undefined>;
}

/**
 * ```js
 * const approve = usePanelOperation("detail", "approve");
 * // <el-button :disabled="!approve.operation.value" @click="approve.run()">{{ approve.operation.value?.label }}</el-button>
 * ```
 */
export function usePanelOperation(member: string, name: string): PanelOperationHandle {
  if (!getCurrentInstance())
    throw new Error("Call usePanelOperation in a component's setup, before any await: it finds the panel through the component that calls it");
  const { instance, manifest } = usePanelContext();
  if (!Object.hasOwn(manifest.members, member)) throw new Error(`The panel declares no member '${member}'`);
  const id = instance.operationIdOf(member, name);
  return {
    operation: computed(() => instance.operations.value.find((operation) => operation.id === id) ?? null),
    run: (input) => instance.invoke(id, input),
  };
}

/**
 * Registers a mounted custom panel UI entry (custom button, switch, or dropdown menu item) for a declared
 * member operation so human clicks and agent `page_action` calls share the exact same availability guards,
 * input filtering, preparation, 4-tuple confirmation verification, dispatch, and panel-owned settlement.
 *
 * Automatically unregisters when the calling component unmounts.
 */
export function usePanelOperationAction(
  member: string,
  name: string,
  options: UsePanelOperationActionOptions = {},
): PanelOperationActionHandle {
  if (!getCurrentInstance())
    throw new Error("Call usePanelOperationAction in a component's setup, before any await: it binds the action entry to that component's mount");
  const { instance, manifest } = usePanelContext();
  if (!Object.hasOwn(manifest.members, member)) throw new Error(`The panel declares no member '${member}'`);
  const directMount = inject(directMountKey, null);
  const id = instance.operationIdOf(member, name);

  let unmounted = false;
  const runningRef = ref(false);
  const dispatchingRef = ref(false);
  const memberContext = shallowRef<PanelMemberContext | null>(null);
  const memberLoadError = shallowRef<string | null>(null);

  if (directMount) {
    let loadSeq = 0;
    watch(
      () => directMount.instance.projectionVersion(member),
      () => {
        const currentSeq = ++loadSeq;
        memberContext.value = null;
        memberLoadError.value = null;
        void directMount.instance.memberContext(member).then(
          (context) => {
            if (currentSeq === loadSeq && !unmounted) memberContext.value = context;
          },
          (reason: unknown) => {
            if (currentSeq === loadSeq && !unmounted) {
              memberLoadError.value = reason instanceof Error ? reason.message : String(reason);
            }
          },
        );
      },
      { immediate: true },
    );
  }

  function currentRegistration(): PanelProjectionRegistration | undefined {
    const list = (instance.projections as unknown as { readonly value: readonly PanelProjectionRegistration[] }).value;
    return list.find((entry) => entry.slot === member);
  }

  const operationsState = computed<MemberOperationsState>(() => {
    if (directMount) {
      if (memberLoadError.value !== null) return { status: "error", message: memberLoadError.value };
      if (memberContext.value) return memberContext.value.operations.value;
      return { status: "loading" };
    }
    const registration = currentRegistration();
    if (!registration) return { status: "loading" };
    return { status: "ready", value: { ...registration.operations } };
  });

  const descriptor = computed<PanelOwnerOperationDescriptor | null>(() =>
    operationsState.value.status === "ready" ? operationsState.value.value[name] ?? null : null,
  );
  const operation = computed<PanelOperationBinding | null>(() =>
    instance.operations.value.find((entry) => entry.id === id) ?? null,
  );

  function currentOperationBinding(): ProjectionOperationBinding | undefined {
    if (memberContext.value) return memberContext.value.projection.operations?.[name];
    return currentRegistration()?.operationBindings?.[name];
  }

  function currentMemberInputs(): Readonly<Record<string, RuntimeJsonValue>> {
    if (memberContext.value) return memberContext.value.inputs.value;
    return slotInputValues(manifest, member, instance.state.values.value) as Record<string, RuntimeJsonValue>;
  }

  function resolveBoundParams(): Record<string, RuntimeJsonValue> {
    const binding = currentOperationBinding();
    if (!binding?.params) return {};
    const inputs = currentMemberInputs();
    const resolved: Record<string, RuntimeJsonValue> = {};
    for (const [paramKey, spec] of Object.entries(binding.params)) {
      if ("literal" in spec) {
        resolved[paramKey] = spec.literal;
      } else if ("input" in spec && Object.hasOwn(inputs, spec.input)) {
        const value = inputs[spec.input];
        if (value !== undefined && value !== null) resolved[paramKey] = value;
      }
    }
    return resolved;
  }

  function resolveInputFields(desc: PanelOwnerOperationDescriptor): readonly OperationInputField[] {
    if (desc.upload) return [];
    const hasDeclaredReadInputs = manifest.members[member]?.readOperationInputs?.[name] !== undefined;
    if (desc.effect === "read" && (desc.target.source === "draft" || hasDeclaredReadInputs)) return [];
    const hasDeclaredDraft = manifest.members[member]?.operationDrafts?.[name] !== undefined;
    if (desc.effect === "write" && hasDeclaredDraft) return [];
    const boundKeys = new Set(Object.keys(currentOperationBinding()?.params ?? {}));
    return operationInputFields(desc.inputSchema, boundKeys);
  }

  function buildInput(
    desc: PanelOwnerOperationDescriptor,
    providedInput: Readonly<Record<string, RuntimeJsonValue>> | undefined,
    filterForAgent: boolean,
  ): {
    readonly allowedFields: readonly OperationInputField[];
    readonly prepared: Readonly<Record<string, RuntimeJsonValue>>;
    readonly effectiveInput: Record<string, RuntimeJsonValue>;
  } {
    const boundInput = resolveBoundParams();
    const allowedFields = resolveInputFields(desc);
    const baseProvided = filterForAgent
      ? filterAllowedOperationInput(providedInput, allowedFields)
      : { ...(providedInput ?? {}) };
    const prepared = options.prepareInput ? options.prepareInput(baseProvided) : baseProvided;
    const effectiveInput: Record<string, RuntimeJsonValue> = isActionValuesEnvelope(desc.inputSchema)
      ? wrapActionOperationInput(desc.inputSchema, boundInput, prepared)
      : { ...prepared, ...boundInput };
    return { allowedFields, prepared, effectiveInput };
  }

  function checkEntryGuards(checkBusy: boolean):
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: "stale" | "action_unavailable"; readonly message: string } {
    if (unmounted || instance.isDisposed()) {
      return { ok: false, reason: "stale", message: "The component hosting this action was unmounted." };
    }
    if (options.available !== undefined) {
      const avail = toValue(options.available);
      if (avail === false) {
        return { ok: false, reason: "action_unavailable", message: `Operation '${name}' is not currently available.` };
      }
      if (typeof avail === "object" && avail !== null && !avail.ok) {
        return {
          ok: false,
          reason: "action_unavailable",
          message: avail.message ?? `Operation '${name}' is not currently available.`,
        };
      }
    }
    if (options.disabled !== undefined) {
      const dis = toValue(options.disabled);
      if (dis === true) {
        return { ok: false, reason: "action_unavailable", message: `Operation '${name}' is currently disabled.` };
      }
      if (typeof dis === "string" && dis.length > 0) {
        return { ok: false, reason: "action_unavailable", message: dis };
      }
    }
    if (checkBusy && (runningRef.value || Boolean(toValue(options.busy)))) {
      return { ok: false, reason: "action_unavailable", message: `Operation '${name}' is currently busy.` };
    }
    return { ok: true };
  }

  function pruneBatchChecked(
    targetInfo: ReturnType<typeof resolveMemberOperationTarget>,
    answer: PanelWriteResult,
  ): void {
    if (
      targetInfo.checkedState !== null
      && answer.decision === "confirm"
      && answer.response.kind === "dispatched"
      && answer.response.outcome?.kind === "batch"
    ) {
      const changed = new Set(
        answer.response.outcome.items
          .filter(({ outcome: itemOutcome }) => itemOutcome.kind === "success")
          .map(({ target: done }) => JSON.stringify([done.objectType, done.primaryKey])),
      );
      instance.state.set(
        targetInfo.checkedState,
        targetInfo.checkedObjects.filter(({ className, primaryKey }) =>
          !changed.has(JSON.stringify([className, primaryKey]))),
      );
    }
  }

  async function runFromHuman(
    providedInput?: Readonly<Record<string, RuntimeJsonValue>>,
  ): Promise<PanelWriteResult | PanelReadOperationResult | undefined> {
    if (unmounted || instance.isDisposed() || runningRef.value || Boolean(toValue(options.busy))) {
      return undefined;
    }
    const desc = descriptor.value;
    if (!desc) {
      const err = new Error(`The panel offers no operation '${id}'`);
      if (options.onError) {
        options.onError(err, { operationId: id, input: providedInput ?? {} });
        return undefined;
      }
      throw err;
    }
    const targetInfo = resolveMemberOperationTarget(manifest, member, desc, instance.state.values.value);
    const { effectiveInput } = buildInput(desc, providedInput, false);
    const settledTarget = targetInfo.checkedState !== null ? targetInfo.checkedTargets : targetInfo.target;

    runningRef.value = true;
    dispatchingRef.value = desc.effect === "read";
    try {
      if (desc.effect === "read") {
        const hasDeclaredReadInputs = manifest.members[member]?.readOperationInputs?.[name] !== undefined;
        const input = desc.target.source === "draft" || hasDeclaredReadInputs
          ? readOperationInput(
              instance,
              member,
              name,
              desc.target.source === "draft" ? instance.forms.handle(desc.target.slot)!.values.value : {},
            )
          : effectiveInput;
        const readResult = await instance.readOperation(id, { target: targetInfo.target, input });
        await options.onSettled?.(readResult, {
          operationId: id,
          input: input as Readonly<Record<string, RuntimeJsonValue>>,
          target: settledTarget,
          named: [],
        });
        return readResult;
      }

      const declaredDraftSlot = manifest.members[member]?.operationDrafts?.[name]?.slot;
      if (declaredDraftSlot) {
        if (desc.kind === "form.save" && declaredDraftSlot === member) {
          await instance.forms.submit(member);
        } else {
          const binding = currentOperationBinding();
          await instance.forms.submit(declaredDraftSlot, {
            operationId: id,
            descriptor: desc,
            ...(binding ? { binding } : {}),
            memberInputs: currentMemberInputs(),
            readMemberInputs: currentMemberInputs,
          });
        }
        return undefined;
      }

      const [first, ...rest] = targetInfo.checkedTargets.map((object) => ({ target: object, input: effectiveInput }));
      const answer = await instance.writeOperation(
        id,
        first ? { calls: [first, ...rest] } : { call: { target: targetInfo.target, input: effectiveInput } },
        {
          onConfirmed: () => {
            dispatchingRef.value = true;
          },
        },
      );
      if (answer.decision === "confirm") {
        pruneBatchChecked(targetInfo, answer);
        await options.onSettled?.(answer, {
          operationId: id,
          input: effectiveInput,
          target: settledTarget,
          named: answer.named,
        });
      }
      return answer;
    } catch (reason) {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      if (options.onError) {
        options.onError(err, { operationId: id, input: effectiveInput });
        return undefined;
      }
      throw err;
    } finally {
      runningRef.value = false;
      dispatchingRef.value = false;
    }
  }

  const handleAgentAction: PanelMountedActionHandler = async ({
    input,
    expectedTarget,
    expectedCheckedKeys,
    agentContext,
  }): Promise<PanelMountedActionResult> => {
    if (unmounted || instance.isDisposed()) {
      return { ok: false, reason: "stale", message: "The component hosting this action was unmounted." };
    }
    const desc = descriptor.value;
    if (!desc) {
      return missingOperationDescriptorResult(operationsState.value, name);
    }
    const targetInfo = resolveMemberOperationTarget(manifest, member, desc, instance.state.values.value);
    if (expectedCheckedKeys !== undefined && targetInfo.checkedState !== null) {
      if (!matchesExpectedCheckedKeys(targetInfo.checkedTargets, expectedCheckedKeys)) {
        return {
          ok: false,
          reason: "stale",
          message: "The checked batch selection changed since your last observation.",
        };
      }
    }
    const declaredDraftSlot = manifest.members[member]?.operationDrafts?.[name]?.slot;
    if (expectedTarget !== undefined) {
      const currentTarget = declaredDraftSlot
        ? (instance.forms.snapshot(declaredDraftSlot)?.target ?? null)
        : targetInfo.target;
      if (!matchesExpectedTarget(currentTarget, expectedTarget)) {
        return {
          ok: false,
          reason: "stale",
          message: "The target object or draft changed since your last observation.",
        };
      }
    }
    const guard = checkEntryGuards(true);
    if (!guard.ok) return guard;
    if (!isOperationReady(desc, targetInfo, false)) {
      return {
        ok: false,
        reason: "action_unavailable",
        message: desc.unavailable?.reason ?? `Operation '${name}' is currently unavailable.`,
      };
    }

    const { allowedFields, prepared, effectiveInput } = buildInput(desc, input, true);
    const missing = allowedFields
      .filter((field) => field.required && !(field.name in prepared))
      .map((field) => field.name);
    if (missing.length > 0) {
      return {
        ok: false,
        reason: "input_required",
        message: `Operation '${name}' requires input fields: ${missing.join(", ")}.`,
      };
    }

    const settledTarget = targetInfo.checkedState !== null ? targetInfo.checkedTargets : targetInfo.target;
    const evaluateSubmission: SubmissionEvaluator = (phase) => {
      if (unmounted || instance.isDisposed()) {
        return { ok: false, message: "The component hosting this action was unmounted." };
      }
      if (phase === "confirm" && (runningRef.value || Boolean(toValue(options.busy)))) {
        return { ok: false, message: `Operation '${name}' is currently busy.` };
      }
      const liveGuard = checkEntryGuards(false);
      if (!liveGuard.ok) return { ok: false, message: liveGuard.message };
      const liveOps = operationsState.value;
      if (liveOps.status !== "ready" || !liveOps.value[name]) {
        return { ok: false, message: `Operation '${name}' is no longer available.` };
      }
      const liveDescriptor = liveOps.value[name]!;
      const liveTargetInfo = resolveMemberOperationTarget(manifest, member, liveDescriptor, instance.state.values.value);
      if (!isOperationReady(liveDescriptor, liveTargetInfo, phase === "confirm" ? runningRef.value : false)) {
        return { ok: false, message: liveDescriptor.unavailable?.reason ?? `Operation '${name}' is no longer available.` };
      }
      const liveBuilt = buildInput(liveDescriptor, input, true);
      return {
        ok: true,
        instanceId: instance.instanceId,
        operationId: id,
        target: liveTargetInfo.checkedState !== null ? liveTargetInfo.checkedTargets : liveTargetInfo.target,
        payload: {
          input: liveBuilt.effectiveInput,
          ...(liveTargetInfo.checkedState !== null
            ? { calls: liveTargetInfo.checkedTargets.map((object) => ({ target: object, input: liveBuilt.effectiveInput })) }
            : {}),
        },
      };
    };

    runningRef.value = true;
    dispatchingRef.value = desc.effect === "read";
    try {
      if (desc.effect === "read") {
        const hasDeclaredReadInputs = manifest.members[member]?.readOperationInputs?.[name] !== undefined;
        const readInput = desc.target.source === "draft" || hasDeclaredReadInputs
          ? readOperationInput(
              instance,
              member,
              name,
              desc.target.source === "draft" ? instance.forms.handle(desc.target.slot)!.values.value : {},
            )
          : effectiveInput;
        const readResult = await instance.readOperation(id, { target: targetInfo.target, input: readInput });
        await options.onSettled?.(readResult, {
          operationId: id,
          input: readInput as Readonly<Record<string, RuntimeJsonValue>>,
          target: settledTarget,
          named: [],
        });
        return { ok: true, outcome: readResult };
      }

      if (declaredDraftSlot) {
        const evaluateOrigin = () => {
          const originGuard = checkEntryGuards(false);
          if (!originGuard.ok) return { ok: false as const, message: originGuard.message };
          const liveOps = operationsState.value;
          if (liveOps.status !== "ready" || !liveOps.value[name] || liveOps.value[name]!.unavailable) {
            return { ok: false as const, message: `Operation '${name}' is no longer available.` };
          }
          return { ok: true as const };
        };
        if (desc.kind === "form.save" && declaredDraftSlot === member) {
          await instance.forms.submit(
            member,
            agentContext ? { operationId: id, descriptor: desc, evaluateOrigin, agentContext } : undefined,
          );
        } else {
          const binding = currentOperationBinding();
          await instance.forms.submit(declaredDraftSlot, {
            operationId: id,
            descriptor: desc,
            ...(binding ? { binding } : {}),
            memberInputs: currentMemberInputs(),
            readMemberInputs: currentMemberInputs,
            evaluateOrigin,
            ...(agentContext ? { agentContext } : {}),
          });
        }
        if (agentContext?.completed) {
          return classifyDispatchResponseForAction(agentContext.completed.response);
        }
        return { ok: true };
      }

      const [first, ...rest] = targetInfo.checkedTargets.map((object) => ({ target: object, input: effectiveInput }));
      let answer: PanelWriteResult;
      try {
        answer = await instance.writeOperation(
          id,
          first ? { calls: [first, ...rest] } : { call: { target: targetInfo.target, input: effectiveInput } },
          {
            onConfirmed: () => {
              dispatchingRef.value = true;
            },
            ...(agentContext ? { agentContext, evaluateSubmission } : {}),
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
              runningRef.value = true;
              dispatchingRef.value = true;
              try {
                const confirmed = await deferred.dispatchNow();
                if (confirmed.decision !== "confirm") {
                  return {
                    ok: false,
                    intentId: preparation.intentId,
                    reason: "not_dispatched",
                    message: "Operation was cancelled.",
                  };
                }
                const settledAnswer: PanelWriteResult = { ...confirmed, named: deferred.named };
                pruneBatchChecked(targetInfo, settledAnswer);
                await options.onSettled?.(settledAnswer, {
                  operationId: id,
                  input: effectiveInput,
                  target: settledTarget,
                  named: deferred.named,
                });
                return classifyDispatchResponseForConfirmation(preparation.intentId, confirmed.response);
              } catch (dispatchReason) {
                const err = dispatchReason instanceof Error ? dispatchReason : new Error(String(dispatchReason));
                options.onError?.(err, { operationId: id, input: effectiveInput });
                return {
                  ok: false,
                  intentId: preparation.intentId,
                  reason: "failed",
                  message: err.message,
                };
              } finally {
                runningRef.value = false;
                dispatchingRef.value = false;
              }
            },
          });
          throw new PanelConfirmationDeferred(confirmation);
        }
        throw reason;
      }
      if (answer.decision === "cancel") {
        return { ok: false, reason: "cancelled", message: `Operation '${name}' was cancelled.` };
      }
      pruneBatchChecked(targetInfo, answer);
      await options.onSettled?.(answer, {
        operationId: id,
        input: effectiveInput,
        target: settledTarget,
        named: answer.named,
      });
      return classifyDispatchResponseForAction(answer.response);
    } catch (reason) {
      if (reason instanceof PanelConfirmationDeferred || reason instanceof PanelSubmissionStaleError) throw reason;
      if (agentContext?.completed) {
        return classifyDispatchResponseForAction(agentContext.completed.response);
      }
      const err = reason instanceof Error ? reason : new Error(String(reason));
      options.onError?.(err, { operationId: id, input: effectiveInput });
      return { ok: false, reason: "failed", message: err.message };
    } finally {
      runningRef.value = false;
      dispatchingRef.value = false;
    }
  };

  const unregister = instance.registerActionHandler(id, handleAgentAction);
  onBeforeUnmount(() => {
    unmounted = true;
    unregister();
  });

  return {
    operation,
    state: operationsState,
    running: computed(() => runningRef.value),
    dispatching: computed(() => dispatchingRef.value),
    run: runFromHuman,
  };
}
