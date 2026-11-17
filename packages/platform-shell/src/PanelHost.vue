<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { usePanelInstance, type PanelHostPort } from "./panel-host";
import { usePageActions } from "./page-actions";

/**
 * One panel instance, shown full screen, beside a conversation or inside another application: the same component in all
 * three, because all three only need the use relation, the current record and a place to show it. The panel's own text
 * runs in a frame of its own with this SDK version's modules; what it reports — what the reader looks at and its
 * deep-linkable state — goes up through `context` and `address`, so the page beside it can write the message it already
 * writes and the address restores the same view.
 */
const props = defineProps<{
  /** The platform's panel host: reading uses and records, the SDK base and the frame registration. */
  port: PanelHostPort;
  /** The application use to open. Another use is another instance with its own state. */
  useId: string;
  /** The name a message gives this page, e.g. the panel's name. */
  label: string;
  /** The title drawn above the frame; absent when the frame is the whole surface. */
  title?: string;
}>();
const emit = defineEmits<{
  /** What a message from this instance carries now. */
  context: [context: import("@ontomato/contracts/page-context").PageContext];
  /** The instance's address, with its declared deep-linkable state. */
  address: [address: string];
}>();

const view = usePanelInstance(props.port, { useId: () => props.useId, label: () => props.label });
const frame = ref<HTMLIFrameElement | null>(null);
watch(
  () => frame.value,
  (element) => view.frame(element?.contentWindow ?? null),
  { flush: "post" },
);
watch(view.pageContext, (context) => context && emit("context", context));
watch(view.address, (address) => emit("address", address), { immediate: true });

// The instance's operations reach the header like any page's: one description, one handler, for a person and an agent.
// A click reaches the frame, which runs it with the person's own credential; the state the operation targets decides
// whether it can run at all.
const operations = computed(() =>
  view.operations.value.map((operation) => ({
    ...operation,
    disabled: operation.target?.source === "state" && !view.state.value[operation.target.state],
    invoke: (input?: Readonly<Record<string, unknown>>) => view.invoke(operation.id, input),
  })),
);
usePageActions(() => (view.panel.value ? { operations: operations.value } : null));

defineExpose({ ...view, operations });
</script>

<template>
  <section class="panel-host">
    <header v-if="title" class="panel-host-title">{{ title }}</header>
    <p v-if="view.error.value" role="alert" class="panel-host-error">{{ view.error.value }}</p>
    <iframe
      v-else-if="view.document.value"
      ref="frame"
      class="panel-host-frame"
      :title="title ?? label"
      sandbox="allow-scripts"
      :srcdoc="view.document.value"
    />
  </section>
</template>

<style scoped>
.panel-host {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.panel-host-title {
  padding: 4px 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.panel-host-error {
  padding: 12px;
  color: var(--el-color-danger);
}
.panel-host-frame {
  border: 0;
  flex: 1;
  min-height: 0;
  width: 100%;
}
</style>
