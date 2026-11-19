<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import { usePanelInstance, type PanelHostLabels, type PanelHostPort } from "./panel-host";
import { usePageActions } from "./page-actions";

/**
 * One panel instance, shown full screen, beside a conversation or inside another application, or as an author's candidate
 * preview: the same component in all of them, because each only needs a source — a use relation with its current record,
 * or a workspace candidate — and a place to show it. The panel's own text
 * runs in a frame of its own with this SDK version's modules; what it reports — what the reader looks at and its
 * deep-linkable state — goes up through `context` and `display-address`, so the enclosing page can reflect the view.
 */
const props = defineProps<{
  /**
   * The platform's panel host for one source: a registered use relation, or an author's workspace candidate. Another
   * source is another instance with its own state.
   */
  port: PanelHostPort;
  /**
   * What a message calls the page, before a registered panel's own name: its application, say. Empty means the panel's
   * name. A candidate has no registered name, so this is its whole name.
   */
  label?: string;
  /** The page's address as the reader sees it; the instance's deep-linkable state is added to it. */
  address: string;
  /** The deep-linkable state the page address currently requests. */
  initial?: Record<string, unknown>;
  /** The title drawn above the frame; absent when the frame is the whole surface. */
  title?: string;
  /** What the host says to the reader, in the platform's language. */
  labels: PanelHostLabels;
}>();
const emit = defineEmits<{
  /** What a message from this instance carries now. */
  context: [context: import("@ontomato/contracts/page-context").PageContext];
  /** The instance's address, with its declared deep-linkable state. */
  "display-address": [input: DisplayPageAddressInput];
  "display-loaded": [load: DisplayLoad];
  "display-dirty": [dirty: boolean];
}>();

const view = usePanelInstance(props.port, {
  labels: props.labels,
  label: (source) => source.kind === "candidate" ? props.label! : props.label ? `${props.label} · ${source.panel.name}` : source.panel.name,
  address: () => props.address,
  initial: () => props.initial ?? {},
});
const frame = ref<HTMLIFrameElement | null>(null);
watch(
  () => frame.value,
  (element) => view.frame(element?.contentWindow ?? null),
  { flush: "post" },
);
watch(view.pageContext, (context) => context && emit("context", context));
// The instance's address exists once its record is read; before that there is none to report, and reporting an empty one
// would replace the page's address — and the draft link in it — before the panel has read it.
watch(view.address, (address) => emit("display-address", { kind: "state", address }));
watch(view.displayLoad, (load) => emit("display-loaded", load));
watch(view.dirty, (dirty) => emit("display-dirty", dirty), { flush: "sync", immediate: true });

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
// A form presents its own Save and Discard; other panel operations can still be shown by the enclosing page.
usePageActions(() => (view.source.value ? { operations: operations.value.filter(operation => operation.kind !== "form.save") } : null));

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
