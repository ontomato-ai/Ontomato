<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import type { PanelObjectIdentity, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelHumanOperationDispatchResponse } from "@ontomato/contracts/panel-agent";
import type { PanelOwnerOperationDescriptor, PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import { slotInputState, usePanelContext, useProjectionSlot } from "../panel/context";
import { readOperationInput } from "../panel/read-operation-input";
import OperationResult from "./OperationResult.vue";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { useMemberOperations } from "../panel/member";
import { stateObject, stateObjects } from "../panel/state";
import type { PanelWriteResult } from "../panel/instance";
import { useDataStateLabels } from "./data-state-labels";

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
  done: [outcome: Outcome];
}>();
const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const running = ref(false);
const failure = shallowRef<Error | null>(null);
/** The member's operations, as their owners admit them now. */
const operations = useMemberOperations();
if (!Object.hasOwn(slot.projection.operations ?? {}, props.operation))
  throw new Error(`The projection in member '${slot.slot}' names no operation '${props.operation}'`);
/** The owner's description of this button's operation; absent while its owner does not admit it (nothing chosen yet). */
const descriptor = computed<PanelOwnerOperationDescriptor | null>(() =>
  operations.value.status === "ready" ? operations.value.value[props.operation] ?? null : null);
/** What the button shows instead while there is nothing to press: the read in progress, or what it was answered. */
const pending = computed<DataStateResult | null>(() => {
  if (operations.value.status !== "ready") return operations.value;
  return descriptor.value ? null : { status: "awaiting" };
});
const read = shallowRef<PanelReadOperationResult | null>(null);
const receipt = shallowRef<PanelHumanOperationDispatchResponse | null>(null);
/** The targets the owner named when it prepared the last write. */
const named = shallowRef<PanelWriteResult["named"]>([]);
const operationId = computed(() => panel.instance.operationIdOf(slot.slot, props.operation));
/**
 * The button shows only once its description is read, so the owner's name, in the reader's language, is there. A batch
 * button also says how many objects it acts on, so it never reads as the single one beside it.
 */
const label = computed(() => (batch.value
  ? t("platform.operationChecked", { label: descriptor.value!.label, count: checkedObjects.value.length })
  : descriptor.value!.label));

const fail = (reason: unknown) => {
  failure.value = reason instanceof Error ? reason : new Error(String(reason));
};

const values = computed(() => panel.instance.state.values.value);
/** The panel state of the input the owner's description names as the target: one object, or a list (a batch). */
const targetState = computed(() => {
  const described = descriptor.value?.target;
  return described?.source === "input" ? slotInputState(panel.manifest, slot.slot, described.input) : null;
});
/** Whether the target is the panel's checked list: the button then runs one batch over every object in it. */
const batch = computed(() => targetState.value !== null && panel.manifest.state[targetState.value]!.type.kind === "list");
/** The one object it acts on, when the target is a single object. */
const target = computed<PanelOperationCall["target"]>(() => {
  const selected = targetState.value === null || batch.value ? null : stateObject(values.value[targetState.value]);
  return selected && { kind: "object", objectType: selected.className, primaryKey: selected.primaryKey };
});
const checkedState = computed(() => (batch.value ? targetState.value : null));
/** The checked objects: the list the target's panel state holds. */
const checkedObjects = computed(() => (checkedState.value === null ? [] : stateObjects(values.value[checkedState.value])));
const checkedTargets = computed(() =>
  checkedObjects.value.map(({ className, primaryKey }) => ({ kind: "object" as const, objectType: className, primaryKey })));
const ready = computed(() => {
  // The owner lists it but would refuse it now: the button is off, and says why beside it.
  if (!descriptor.value || running.value || descriptor.value.unavailable) return false;
  if (checkedState.value !== null) return checkedTargets.value.length > 0;
  return descriptor.value.target.source !== "input" || target.value !== null;
});

async function run() {
  const described = descriptor.value!;
  running.value = true;
  failure.value = null;
  read.value = null;
  receipt.value = null;
  try {
    if (described.effect === "read") {
      const { target: owned } = described;
      const draft = owned.source === "draft" ? panel.instance.forms.handle(owned.slot)!.values.value : {};
      const input = readOperationInput(panel.instance, slot.slot, props.operation, draft);
      read.value = await panel.instance.readOperation(operationId.value, { target: target.value, input });
      return;
    }
    const [first, ...rest] = checkedTargets.value.map((object) => ({ target: object, input: {} }));
    const answer = await panel.instance.writeOperation(
      operationId.value, first ? { calls: [first, ...rest] } : { call: { target: target.value, input: {} } },
    );
    if (answer.decision === "cancel") return;
    named.value = answer.named;
    keepUnchanged(answer.response);
    const answered = answer.response.kind === "dispatched" ? answer.response.outcome : undefined;
    // A single write done is told where it outlasts the button; anything else stays beside it.
    if (answered?.kind === "success") panel.notify({ kind: "success", text: said(answered) });
    else receipt.value = answer.response;
    if (answered) emit("done", answered);
  } catch (reason) {
    fail(reason);
  } finally {
    running.value = false;
  }
}

/** A batch leaves checked only the objects it did not change. */
function keepUnchanged(response: PanelHumanOperationDispatchResponse) {
  if (checkedState.value === null || response.kind !== "dispatched" || response.outcome?.kind !== "batch") return;
  const changed = new Set(response.outcome.items.filter(({ outcome }) => outcome.kind === "success")
    .map(({ target: done }) => JSON.stringify([done.objectType, done.primaryKey])));
  panel.instance.state.set(checkedState.value, checkedObjects.value.filter(({ className, primaryKey }) =>
    !changed.has(JSON.stringify([className, primaryKey]))));
}

const labels = useDataStateLabels();

type Outcome = NonNullable<Extract<PanelHumanOperationDispatchResponse, { kind: "dispatched" }>["outcome"]>;
type Single = Exclude<Outcome, { kind: "batch" }>;
/** One result in words: the owner's own message where it gave one. */
const said = (outcome: Single) =>
  outcome.kind === "success" ? outcome.message ?? t("platform.operationDone")
    : outcome.kind === "unknown" ? t("platform.operationUnknown", { message: outcome.message })
      : outcome.message;
const outcome = computed(() => (receipt.value?.kind === "dispatched" ? receipt.value.outcome : null));
const items = computed(() => (outcome.value?.kind === "batch" ? outcome.value.items : []));
/** A batch item by the name its owner gave it when the batch was confirmed, else by its key. */
const nameOf = (target: PanelObjectIdentity) => named.value.find(({ target: known }) =>
  known.objectType === target.objectType && known.primaryKey === target.primaryKey)?.label ?? target.primaryKey;
const done = computed(() => items.value.filter((item) => item.outcome.kind === "success").length);
</script>

<template>
  <div class="sdk-operation-button">
    <data-state v-if="pending" :result="pending" :labels="labels"></data-state>
    <!-- A removal is drawn quiet, as the platform's header draws one: danger in its colour, not a solid block; off, it
         is plainly off. The owner still decides what it does and confirms it. -->
    <el-button v-else :type="type" :text="type === 'danger'" :loading="running" :disabled="!ready" @click="run">{{ label }}</el-button>
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
