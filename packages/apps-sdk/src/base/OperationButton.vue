<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { panelOperationId, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelHumanOperationDispatchResponse } from "@ontomato/contracts/panel-agent";
import type { PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import { slotInputState, usePanelContext, useProjectionSlot } from "../panel/context";
import type { PanelOperationDescriptor } from "../panel/human-operations";
import { readOperationInput } from "../panel/read-operation-input";
import OperationResult from "./OperationResult.vue";
import { DataState } from "@ontomato/foundation-ui/data-state";
import { useMemberData } from "../panel/member";
import { stateObject, stateObjects } from "../panel/state";

/**
 * The button of one operation a projection publishes, run as the reader the way an agent's call runs: the platform's
 * coordinator holds the owner's description of it, so what the button does follows the owner, not the button.
 *
 * A read (a trial run) takes the form the owner's operation targets and the inputs the slot's declaration names
 * (`readOperationInputs`), and shows what it read beneath the button; it saves nothing. A write is frozen as one intent
 * — the selected object, or every checked one as one batch — which the host confirms where the owner or the batch asks,
 * and dispatches once; the receipt is shown here in the owner's words, item by item for a batch, and only the objects the
 * owner reports changed are read again. Items a batch did not change stay checked. What a write returned is the owner's
 * record of it, not something to show the reader: the button says what the owner said of it, or that it was done.
 *
 * A declared (direct) projection's button is named by the owner's description, in the reader's language; a code
 * projection's by the operation its component publishes.
 */
withDefaults(
  defineProps<{
    /** The button's style: the page's main action, or a danger one. Display only. */
    type?: "primary" | "danger" | "default";
  }>(),
  { type: "default" },
);

const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const running = ref(false);
const failure = shallowRef<Error | null>(null);
/** The owner's description is the member's `operation` datum, read by the instance. */
const operationData = useMemberData("operation");
const descriptor = computed(() =>
  operationData.value.status === "ready" ? operationData.value.value as PanelOperationDescriptor : null);
const read = shallowRef<PanelReadOperationResult | null>(null);
const receipt = shallowRef<PanelHumanOperationDispatchResponse | null>(null);

/** The one operation this button's projection publishes: the operation its `operation` datum describes. */
const published = computed(() => {
  const registration = panel.instance.projections.value.find((item) => item.slot === slot.slot);
  if (!registration) throw new Error(`The projection in slot '${slot.slot}' is not registered yet`);
  const [found] = registration.ports.operations;
  if (!found) throw new Error(`The projection in slot '${slot.slot}' publishes no operation`);
  return found;
});
const operationId = computed(() => panelOperationId(slot.slot, published.value.name));
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
  if (!descriptor.value || running.value) return false;
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
      const input = readOperationInput(panel.instance, slot.slot, published.value.name, draft);
      read.value = await panel.instance.readOperation(operationId.value, { target: target.value, input });
      return;
    }
    const [first, ...rest] = checkedTargets.value.map((object) => ({ target: object, input: {} }));
    const answer = await panel.instance.writeOperation(
      operationId.value, first ? { calls: [first, ...rest] } : { call: { target: target.value, input: {} } },
    );
    if (answer.decision === "cancel") return;
    receipt.value = answer.response;
    keepUnchanged(answer.response);
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

const labels = computed(() => ({ empty: t("platform.dataEmpty"), forbidden: t("platform.dataForbidden"), awaiting: t("platform.dataAwaiting") }));

type Outcome = NonNullable<Extract<PanelHumanOperationDispatchResponse, { kind: "dispatched" }>["outcome"]>;
type Single = Exclude<Outcome, { kind: "batch" }>;
/** One result in words: the owner's own message where it gave one. */
const said = (outcome: Single) =>
  outcome.kind === "success" ? outcome.message ?? t("platform.operationDone")
    : outcome.kind === "unknown" ? t("platform.operationUnknown", { message: outcome.message })
      : outcome.message;
const outcome = computed(() => (receipt.value?.kind === "dispatched" ? receipt.value.outcome : null));
const items = computed(() => (outcome.value?.kind === "batch" ? outcome.value.items : []));
const done = computed(() => items.value.filter((item) => item.outcome.kind === "success").length);
</script>

<template>
  <div class="sdk-operation-button">
    <data-state v-if="operationData && operationData.status !== 'ready'" :result="operationData" :labels="labels"></data-state>
    <el-button v-else :type="type" :loading="running" :disabled="!ready" @click="run">{{ label }}</el-button>
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
          >{{ item.target.primaryKey }}: {{ said(item.outcome) }}</li>
        </ul>
      </div>
      <p v-else :role="outcome.kind === 'success' ? 'status' : 'alert'" :data-outcome="outcome.kind">{{ said(outcome) }}</p>
    </template>
  </div>
</template>

<style scoped>
.sdk-operation-batch ul {
  margin: 4px 0 0;
  padding-inline-start: 18px;
}
.sdk-operation-batch li[data-outcome="success"] {
  color: var(--el-text-color-secondary);
}
.sdk-operation-batch li:not([data-outcome="success"]) {
  color: var(--el-color-danger);
}
</style>
