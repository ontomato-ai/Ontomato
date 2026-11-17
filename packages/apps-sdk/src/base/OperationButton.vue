<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import type { PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import { slotState, usePanelContext, useProjectionSlot } from "../panel/context";
import { selectedKey } from "../panel/platform-objects";

/**
 * The button of one operation a projection publishes: it shows the operation's own label and runs that operation on the
 * object the panel has selected, through the handler reference the projection's record and this version's catalogue
 * name. It holds no business of its own — a panel that runs a task now and a panel that runs anything else use it alike,
 * and the type comes from the projection's binding.
 */
const props = withDefaults(
  defineProps<{
    /** The operation of this projection to run; the projection's first, by default. */
    operation?: string;
    /** The button's style: the page's main action, or a danger one. */
    type?: "primary" | "danger" | "default";
    /** The slot input whose panel state names the object to act on; the slot's first input by default. */
    input?: string;
  }>(),
  { operation: "", type: "default", input: undefined },
);

const slot = useProjectionSlot();
const panel = usePanelContext();
const running = ref(false);
const failure = shallowRef<Error | null>(null);

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

/** The object it acts on: what the panel has selected in the state this slot's input is filled from. */
const call = computed<PanelOperationCall>(() => {
  const primaryKey = selectedKey(panel.instance.state.values.value[slotState(slot.slot, props.input)]);
  return {
    target: primaryKey ? { kind: "object", objectType: slot.projection.binding.id, primaryKey } : null,
    input: {},
  };
});

async function run() {
  running.value = true;
  failure.value = null;
  try {
    await panel.invoke(published.value.handlerRef, call.value);
  } catch (reason) {
    failure.value = reason instanceof Error ? reason : new Error(String(reason));
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <div class="sdk-operation-button">
    <el-button :type="type" :loading="running" :disabled="!call.target" @click="run">{{ published.label }}</el-button>
    <p v-if="failure" role="alert">{{ failure.message }}</p>
  </div>
</template>
