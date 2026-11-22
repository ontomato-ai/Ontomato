<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { usePanelContext, useProjectionSlot } from "../panel/context";
import { useMember, useMemberOperations } from "../panel/member";
import { useDataStateLabels } from "./data-state-labels";
import {
  formatOperationLabel,
  isOperationReady,
  resolveOperationInputFields,
  resolveOperationTarget,
  useOperationRunner,
  type OperationOutcome,
} from "./operation-dispatch";
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
     * button in the danger colour); it changes nothing else.
     */
    type?: "primary" | "danger" | "default";
  }>(),
  { type: "default" },
);

const emit = defineEmits<{
  /** A write was dispatched and its owner answered: the outcome, for the page to act on. */
  done: [outcome: OperationOutcome];
}>();

const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const member = useMember();
const rowOperation = member.rowOperation ?? null;
const labels = useDataStateLabels();

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
  failure,
  read,
  receipt,
  outcome,
  batchItems: items,
  batchDone: done,
  inputDialogOpen,
  said,
  nameOf,
  trigger,
  confirmInput,
  reset,
} = useOperationRunner({
  panel: () => panel,
  slot: () => slot,
  member: () => member,
  t,
  onDone: (_name, answered) => emit("done", answered),
});

const values = computed(() => panel.instance.state.values.value);
const targetInfo = computed(() =>
  resolveOperationTarget(panel, slot, member, descriptor.value, values.value),
);

/**
 * The button shows only once its description is read, so the owner's name, in the reader's language, is there. A batch
 * button also says how many objects it acts on, so it never reads as the single one beside it.
 */
const label = computed(() => formatOperationLabel(descriptor.value!, targetInfo.value, t));

const targetKey = computed(() => (
  rowOperation
    ? JSON.stringify(member.inputs.value)
    : targetInfo.value.target?.kind === "object"
      ? `${targetInfo.value.target.objectType}:${targetInfo.value.target.primaryKey}`
      : null
));

const inputFields = computed(() =>
  resolveOperationInputFields(panel, slot, props.operation, descriptor.value),
);

watch(targetKey, () => {
  reset();
});

const ready = computed(() =>
  isOperationReady(descriptor.value, targetInfo.value, Boolean(rowOperation), running.value),
);

function onTriggerClick() {
  if (!descriptor.value || !ready.value) return;
  trigger(props.operation, descriptor.value);
}
</script>

<template>
  <div class="sdk-operation-button">
    <data-state v-if="pending" :result="pending" :labels="labels"></data-state>
    <!-- A removal is drawn quiet, as the platform's header draws one: danger in its colour, not a solid block; off, it
         is plainly off. The owner still decides what it does and confirms it. -->
    <el-button v-else :type="type" :text="type === 'danger'" :loading="running" :disabled="!ready" @click="onTriggerClick">{{ label }}</el-button>
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
      <div v-else-if="outcome.kind === 'batch'" class="sdk-operation-batch" role="status">
        <p>{{ t("platform.operationBatchDone", { done, total: items.length }) }}</p>
        <ul>
          <li
            v-for="item in items"
            :key="item.target.objectType + ':' + item.target.primaryKey"
            :data-outcome="item.outcome.kind"
          >{{ nameOf(item.target) }}: {{ said(item.outcome) }}</li>
        </ul>
      </div>
      <p v-else role="alert" :data-outcome="outcome.kind">{{ said(outcome) }}</p>
    </template>
  </div>
</template>

<style scoped>
.sdk-operation-unavailable {
  margin: var(--spacing-xs) 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.sdk-operation-batch ul {
  margin: var(--spacing-xs) 0 0;
  padding-inline-start: var(--spacing-lg);
}
.sdk-operation-batch li[data-outcome="success"] {
  color: var(--el-text-color-secondary);
}
.sdk-operation-batch li:not([data-outcome="success"]) {
  color: var(--el-color-danger-text);
}
</style>
