<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { panelOperationId, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelHumanOperationDispatchResponse } from "@ontomato/contracts/panel-agent";
import type { PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import { slotState, usePanelContext, useProjectionSlot } from "../panel/context";
import type { PanelOperationDescriptor } from "../panel/human-operations";
import { readOperationInput } from "../panel/read-operation-input";
import OperationResult from "./OperationResult.vue";
import { DataState } from "@ontomato/foundation-ui/data-state";
import { useMember, useMemberData } from "../panel/member";
import { stateObject, stateObjects } from "../panel/state";

/**
 * The button of one operation a projection publishes, run as the reader the way an agent's call runs: the platform's
 * coordinator holds the owner's description of it, so what the button does follows the owner, not the button.
 *
 * A read (a trial run) takes the form the owner's operation targets and the inputs the slot's declaration names
 * (`readOperationInputs`), and shows what it read beneath the button; it saves nothing. A write is frozen as one intent
 * — the selected object, or every checked one as one batch — which the host confirms where the owner or the batch asks,
 * and dispatches once; the receipt is shown here, item by item for a batch, and only the objects the owner reports
 * changed are read again. Items a batch did not change stay checked.
 */
const props = withDefaults(
  defineProps<{
    /** The operation of this projection to run; the projection's first, by default. */
    operation?: string;
    /** The button's style: the page's main action, or a danger one. */
    type?: "primary" | "danger" | "default";
    /** The slot input whose panel state names the object to act on; the slot's first input by default. */
    input?: string;
    /** The slot input whose panel state holds the checked objects: the button then runs one batch over all of them. */
    checked?: string;
  }>(),
  { operation: "", type: "default", input: undefined, checked: undefined },
);

const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const running = ref(false);
const failure = shallowRef<Error | null>(null);
const member = useMember();
/** In a directly rendered panel, the owner's description is the member's `operation` datum, read by the instance. */
const operationData = member ? useMemberData("operation") : null;
const frameDescriptor = shallowRef<PanelOperationDescriptor | null>(null);
const descriptor = computed(() => {
  if (!operationData) return frameDescriptor.value;
  return operationData.value.status === "ready" ? operationData.value.value as PanelOperationDescriptor : null;
});
const read = shallowRef<PanelReadOperationResult | null>(null);
const receipt = shallowRef<PanelHumanOperationDispatchResponse | null>(null);

/** The operation this button runs: the one named, or the first the projection publishes. */
const published = computed(() => {
  const registration = panel.instance.projections.value.find((item) => item.slot === slot.slot);
  if (!registration) throw new Error(`The projection in slot '${slot.slot}' is not registered yet`);
  const found = props.operation
    ? registration.ports.operations.find((item) => item.name === props.operation)
    : registration.ports.operations[0];
  if (!found) throw new Error(`The projection in slot '${slot.slot}' publishes no operation '${props.operation}'`);
  return found;
});
const operationId = computed(() => panelOperationId(slot.slot, published.value.name));

const fail = (reason: unknown) => {
  failure.value = reason instanceof Error ? reason : new Error(String(reason));
};
onMounted(() => {
  if (!operationData) panel.instance.describeOperation(operationId.value).then((described) => { frameDescriptor.value = described; }, fail);
});

const values = computed(() => panel.instance.state.values.value);
/** The object it acts on: what the panel has selected in the state this slot's input is filled from. */
const target = computed<PanelOperationCall["target"]>(() => {
  const selected = stateObject(values.value[slotState(panel.manifest, slot.slot, props.input)]);
  return selected && { kind: "object", objectType: selected.className, primaryKey: selected.primaryKey };
});
const checkedState = computed(() => (props.checked ? slotState(panel.manifest, slot.slot, props.checked) : null));
/** The checked objects: the collection the panel's state holds for the slot's `checked` input. */
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
  outcome.kind === "success" ? t("platform.operationDone")
    : outcome.kind === "unknown" ? t("platform.operationUnknown", { message: outcome.message })
      : outcome.message;
const outcome = computed(() => (receipt.value?.kind === "dispatched" ? receipt.value.outcome : null));
/** What a successful single write returned beyond its success, such as an activation's notes. */
const returned = computed<PanelReadOperationResult | null>(() =>
  outcome.value?.kind === "success" && Object.keys(outcome.value.data).length ? { kind: "json", value: outcome.value.data } : null);
const items = computed(() => (outcome.value?.kind === "batch" ? outcome.value.items : []));
const done = computed(() => items.value.filter((item) => item.outcome.kind === "success").length);
</script>

<template>
  <div class="sdk-operation-button">
    <data-state v-if="operationData && operationData.status !== 'ready'" :result="operationData" :labels="labels"></data-state>
    <el-button v-else :type="type" :loading="running" :disabled="!ready" @click="run">{{ published.label }}</el-button>
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
      <operation-result v-else-if="returned" :result="returned"></operation-result>
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
