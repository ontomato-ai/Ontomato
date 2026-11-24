<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { randomId } from "@ontomato/contracts/random-id";
import type { PanelOwnerOperationDescriptor, PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { usePanelContext, useProjectionSlot } from "../panel/context";
import { classifyDispatchResponseForAction } from "../panel/instance";
import { useMember, useMemberOperations } from "../panel/member";
import { missingOperationDescriptorResult } from "../panel/member-operations";
import { matchesExpectedCheckedKeys, matchesExpectedTarget } from "../panel/operation-binding";
import { useDataStateLabels } from "./data-state-labels";
import { readConfigString } from "./localized-text";
import {
  filterAllowedOperationInput,
  formatOperationLabel,
  isOperationReady,
  listBatchReceiptKey,
  resolveOperationInputFields,
  resolveOperationTarget,
  useOperationRunner,
  type OperationOutcome,
} from "./operation-dispatch";
import OperationBatchReceipt from "./OperationBatchReceipt.vue";
import OperationInputDialog from "./OperationInputDialog.vue";
import OperationResult from "./OperationResult.vue";

/**
 * The button of one operation a projection names, run as the reader the way an agent's call runs: the platform's
 * coordinator holds the owner's description of it, so what the button does follows the owner, not the button.
 *
 * A read (a trial run) takes the form the owner's operation targets and the inputs the slot's declaration names
 * (`readOperationInputs`), and shows what it read beneath the button; it saves nothing. A write is frozen as one intent
 * — the selected object, or every checked one as one batch — which the host confirms where the owner or the batch asks,
 * and dispatches once, and only the objects the owner reports changed are read again (what it removed is let go of: a
 * selection holding it is cleared). A single write done is said in the platform's message, in the owner's words naming
 * what it acted on, since the button often goes with what it deleted; a batch is reported here item by item, and items
 * it did not change stay checked; a refusal or failure stays beside the button. The page hears every outcome (`done`).
 * What a write returned is the owner's record of it, not something to show the reader.
 *
 * The operation is one its projection names (`operation`, the projection's local name for it); the button is named by
 * its owner's description, in the reader's language, and shows that a choice is needed while the owner admits it for
 * nothing chosen.
 */
const props = withDefaults(
  defineProps<{
    /**
     * The operation it runs: the projection's local name for it under `operations`. The button shows the owner's label once the
     * owner admits it, and until then that a choice is needed (an action on an object is admitted once it is chosen); its target is the input
     * the operation names, and a target bound to the panel's checked list makes it one batch over every checked item.
     */
    operation: string;
    /**
     * How the button looks: `primary` for the page's main action, `danger` for one that removes (drawn as a quiet text
     * button in the danger colour unless `plain` is set); it changes nothing else.
     */
    type?: "primary" | "danger" | "default";
    /** Draws a soft tinted bordered button (for example the detail titlebar's danger delete button). */
    plain?: boolean;
    /** Draws a quiet borderless text button (for example inline batch actions beside a danger text button). */
    text?: boolean;
    /**
     * Appends the checked item count to batch operation labels (default `true`). Set `false` inside a container that
     * already displays the selected count beside the batch actions.
     */
    showBatchCount?: boolean;
    /** Optional leading icon on the button (`trash` for destructive removal, `check` for approval). */
    icon?: "trash" | "check";
    /** Optional custom surface label for the button; defaults to the owner's formal operation label (confirmation dialogs and agent catalogs always keep the owner's formal label). */
    label?: string;
    /** Optional panel message key resolved via `panel.t` for localized surface labels. */
    labelKey?: string;
    /** Button size: `default` or compact `small` (for example in inline batch-action toolbars). */
    size?: "small" | "default";
    /** Optional external disabled override (for example while a bound state input is empty). */
    disabled?: boolean;
    /** When true, hides the button unless the owner's operation read is ready and admits this operation as available (fail-closed on loading, error, forbidden, empty, unadmitted, or unavailable). */
    hideWhenUnavailable?: boolean;
  }>(),
  { type: "default", plain: false, text: false, showBatchCount: true, icon: undefined, label: undefined, labelKey: undefined, size: "default", disabled: false, hideWhenUnavailable: false },
);

const emit = defineEmits<{
  /** A write was dispatched and its owner answered: the outcome, for the page to act on. */
  done: [outcome: OperationOutcome];
  /** A read-only operation answered: the result, for the page to react to. */
  read: [result: PanelReadOperationResult];
}>();

const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const member = useMember();
const labels = useDataStateLabels();
const publishBatchReceipt = inject(listBatchReceiptKey, null);

/** The member's operations, as their owners admit them now. */
const operations = useMemberOperations();
if (!Object.hasOwn(slot.projection.operations ?? {}, props.operation))
  throw new Error(`The projection in member '${slot.slot}' names no operation '${props.operation}'`);

/** The owner's description of this button's operation; absent while its owner does not admit it (nothing chosen yet). */
const descriptor = computed<PanelOwnerOperationDescriptor | null>(() =>
  operations.value.status === "ready" ? operations.value.value[props.operation] ?? null : null,
);

/** What the button shows instead while there is nothing to press: the read in progress, or what it was answered. */
const pending = computed<DataStateResult | null>(() => {
  if (operations.value.status !== "ready") return operations.value;
  return descriptor.value ? null : { status: "awaiting" };
});

const {
  running,
  dispatching,
  failure,
  read,
  receipt,
  outcome,
  named,
  inputDialogOpen,
  said,
  trigger,
  confirmInput,
  run,
  reset,
} = useOperationRunner({
  panel: () => panel,
  slot: () => slot,
  member: () => member,
  t,
  isEntryAvailable: () => {
    if (hiddenByAvailability.value) {
      return {
        ok: false,
        message: descriptor.value?.unavailable?.reason ?? `Operation '${props.operation}' is currently hidden or unavailable.`,
      };
    }
    if (props.disabled) {
      return { ok: false, message: `Operation '${props.operation}' is currently disabled.` };
    }
    return { ok: true };
  },
  onDone: (_name, answered) => {
    if (answered.kind === "batch") publishBatchReceipt?.({ items: answered.items, named: named.value });
    emit("done", answered);
  },
  onRead: (_name, answered) => {
    emit("read", answered);
  },
});

const values = computed(() => panel.instance.state.values.value);
const targetInfo = computed(() =>
  resolveOperationTarget(panel, slot, member, descriptor.value, values.value),
);

const rawConfig = computed<Readonly<Record<string, unknown>> | undefined>(() => {
  const cfg = member.projection.config;
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : undefined;
});

/**
 * The button shows only once its description is read. When the panel specifies a custom `label` (prop or projection
 * `config.label`), that concise wording is shown on the button surface while confirmation dialogs and agent catalogs
 * continue to use the owner's formal operation name.
 */
const label = computed(() => {
  const key = (props.labelKey ?? readConfigString(rawConfig.value, "labelKey"))?.trim();
  if (key) {
    const translated = panel.t(key);
    if (translated && translated !== key) return translated;
  }
  const custom = (props.label ?? readConfigString(rawConfig.value, "label"))?.trim();
  if (custom) return custom;
  return props.showBatchCount ? formatOperationLabel(descriptor.value!, targetInfo.value, t) : descriptor.value!.label;
});

const targetKey = computed(() => (
  targetInfo.value.target?.kind === "object"
    ? `${targetInfo.value.target.objectType}:${targetInfo.value.target.primaryKey}`
    : null
));

const inputFields = computed(() =>
  resolveOperationInputFields(panel, slot, props.operation, descriptor.value),
);

const draftSlot = computed(() => {
  if (descriptor.value?.target.source === "draft") return descriptor.value.target.slot;
  return (
    panel.manifest.members[slot.slot]?.operationDrafts?.[props.operation]?.slot
    ?? panel.manifest.members[slot.slot]?.readOperationInputs?.[props.operation]?.draft?.slot
    ?? null
  );
});

const draftFormKey = computed(() => {
  if (!draftSlot.value) return null;
  const snap = panel.instance.forms.snapshot(draftSlot.value);
  return snap ? `${snap.formInstanceId ?? ""}:${JSON.stringify(snap.target ?? null)}` : null;
});

watch([targetKey, draftFormKey], () => {
  reset();
});

const hiddenByAvailability = computed(() => {
  if (!props.hideWhenUnavailable) return false;
  // Fail closed: only render when operations are ready and the owner admits this operation without unavailability.
  return operations.value.status !== "ready" || !descriptor.value || Boolean(descriptor.value.unavailable);
});

const ready = computed(() =>
  !props.disabled && isOperationReady(descriptor.value, targetInfo.value, running.value, panel.instance.forms),
);

function onTriggerClick() {
  if (!descriptor.value || !ready.value) return;
  if (targetInfo.value.batch) publishBatchReceipt?.(null);
  trigger(props.operation, descriptor.value);
}

const entryInstanceId = ref(randomId());
const entryBindingSignature = computed(() => {
  const draftFormId = draftSlot.value
    ? (panel.instance.forms.snapshot(draftSlot.value)?.formInstanceId ?? null)
    : null;
  return JSON.stringify({
    target: targetInfo.value.target,
    checked: targetInfo.value.checkedTargets,
    inputs: member.inputs.value,
    draftFormId,
  });
});
watch(entryBindingSignature, (next, prev) => {
  if (next !== prev) entryInstanceId.value = randomId();
});

const unregisterAction = panel.instance.registerActionHandler(
  panel.instance.operationIdOf(slot.slot, props.operation),
  async ({ input, expectedTarget, expectedCheckedKeys, agentContext }) => {
    if (!descriptor.value) {
      return missingOperationDescriptorResult(operations.value, props.operation);
    }
    if (expectedCheckedKeys !== undefined && targetInfo.value.checkedState !== null) {
      if (!matchesExpectedCheckedKeys(targetInfo.value.checkedTargets, expectedCheckedKeys)) {
        return {
          ok: false,
          reason: "stale",
          message: "The checked batch selection changed since your last observation.",
        };
      }
    }
    if (expectedTarget !== undefined) {
      const currentTarget = draftSlot.value
        ? (panel.instance.forms.snapshot(draftSlot.value)?.target ?? null)
        : targetInfo.value.target;
      if (!matchesExpectedTarget(currentTarget, expectedTarget)) {
        return {
          ok: false,
          reason: "stale",
          message: "The target object or draft changed since your last observation.",
        };
      }
    }
    if (hiddenByAvailability.value) {
      return {
        ok: false,
        reason: "action_unavailable",
        message: descriptor.value.unavailable?.reason ?? `Operation '${props.operation}' is currently hidden or unavailable.`,
      };
    }
    if (!ready.value) {
      return {
        ok: false,
        reason: "action_unavailable",
        message: descriptor.value.unavailable?.reason ?? `Operation '${props.operation}' is currently disabled.`,
      };
    }
    const filteredInput = filterAllowedOperationInput(input, inputFields.value);
    const missing = inputFields.value
      .filter((field) => field.required && !(field.name in filteredInput))
      .map((field) => field.name);
    if (missing.length > 0) {
      return {
        ok: false,
        reason: "input_required",
        message: `Operation '${props.operation}' requires input fields: ${missing.join(", ")}.`,
      };
    }
    if (targetInfo.value.batch) publishBatchReceipt?.(null);
    const status = await run(props.operation, descriptor.value, filteredInput, agentContext);
    const dispatchedResponse = receipt.value ?? agentContext?.completed?.response;
    if (dispatchedResponse) {
      return classifyDispatchResponseForAction(dispatchedResponse);
    }
    if (failure.value) {
      return { ok: false, reason: "failed", message: failure.value.message };
    }
    if (status === "cancelled") {
      return { ok: false, reason: "cancelled", message: `Operation '${props.operation}' was cancelled.` };
    }
    if (status === "skipped") {
      return { ok: false, reason: "action_unavailable", message: `Operation '${props.operation}' is currently busy.` };
    }
    if (read.value) {
      return { ok: true, outcome: read.value };
    }
    return { ok: true, outcome: outcome.value ?? undefined };
  },
  { entryInstanceId: () => entryInstanceId.value },
);
onBeforeUnmount(unregisterAction);
</script>

<template>
  <div v-if="!hiddenByAvailability" class="sdk-operation-button">
    <data-state v-if="pending" :result="pending" :labels="labels"></data-state>
    <!-- A removal is drawn quiet unless `plain` requests a tinted bordered button; the owner still decides and confirms it. -->
    <el-button
      v-else
      :type="type"
      :size="size"
      :plain="plain"
      :text="text || (type === 'danger' && !plain)"
      :loading="dispatching"
      :disabled="!ready"
      @click="onTriggerClick"
    >
      <svg
        v-if="icon === 'trash' && !dispatching"
        class="sdk-operation-icon"
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 6h18" />
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        <line x1="10" x2="10" y1="11" y2="17" />
        <line x1="14" x2="14" y1="11" y2="17" />
      </svg>
      <svg
        v-else-if="icon === 'check' && !dispatching"
        class="sdk-operation-icon"
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span>{{ label }}</span>
    </el-button>
    <operation-input-dialog
      v-if="inputFields.length > 0"
      v-model="inputDialogOpen"
      :title="descriptor?.label"
      :fields="inputFields"
      :busy="running"
      @confirm="confirmInput"
    ></operation-input-dialog>
    <p v-if="!pending && descriptor?.unavailable" class="sdk-operation-unavailable">{{ descriptor.unavailable.reason }}</p>
    <p v-if="failure" role="alert">{{ failure.message }}</p>
    <operation-result v-if="read" :result="read"></operation-result>
    <template v-if="receipt">
      <p v-if="receipt.kind === 'not-dispatched'" role="alert">{{ receipt.message }}</p>
      <p v-else-if="outcome === null" role="alert">{{ t("platform.operationUnknown", { message: "" }) }}</p>
      <template v-else-if="outcome.kind === 'batch'">
        <OperationBatchReceipt v-if="!publishBatchReceipt" class="sdk-operation-batch" :items="outcome.items" :named="named" />
      </template>
      <p v-else role="alert" :data-outcome="outcome.kind">{{ said(outcome) }}</p>
    </template>
  </div>
</template>

<style scoped>
.sdk-operation-icon {
  margin-inline-end: 6px;
  flex-shrink: 0;
}
.sdk-operation-unavailable {
  margin: var(--spacing-xs) 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
</style>
