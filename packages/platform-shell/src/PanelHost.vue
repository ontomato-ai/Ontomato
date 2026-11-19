<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import type { DirectPanelHostSource } from "@ontomato/contracts/panel-host";
import { usePanelInstance, type PanelHostLabels, type PanelHostPort } from "./panel-host";
import { PanelLayout } from "./panel-layout";
import { usePageActions } from "./page-actions";

/**
 * One panel instance, shown full screen, beside a conversation or inside another application, or as an author's candidate
 * preview: the same component in all of them, because each only needs a source — a use relation with its current record,
 * or a workspace candidate — and a place to show it. A panel with no code is drawn here, its layout with each member its
 * instance draws; a panel with code runs in a frame of its own with this SDK version's modules. What either reports —
 * what the reader looks at and its deep-linkable state — goes up through `context` and `display-address`, so the
 * enclosing page can reflect the view.
 */
const props = withDefaults(defineProps<{
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
  /**
   * Whether the reader is on this page. A page kept while the reader is on another holds no stream, offers nothing in the
   * header, asks the platform for nothing new and is reconciled when shown again. Absent means shown.
   */
  shown?: boolean;
}>(), { shown: true });
const emit = defineEmits<{
  /** What a message from this instance carries now. */
  context: [context: import("@ontomato/contracts/page-context").PageContext];
  /** The instance's address, with its declared deep-linkable state. */
  "display-address": [input: DisplayPageAddressInput];
  "display-loaded": [load: DisplayLoad];
  "display-dirty": [dirty: boolean];
  /** Shown again, the page passed its checks: its frame may ask again and its objects are being read again. */
  reopened: [];
  /** Shown again, the page is no longer its application's: its use relation was withdrawn or bound elsewhere. */
  withdrawn: [];
}>();

const view = usePanelInstance(props.port, {
  labels: props.labels,
  label: (source) => source.kind === "candidate" ? props.label! : props.label ? `${props.label} · ${source.panel.name}` : source.panel.name,
  address: () => props.address,
  initial: () => props.initial ?? {},
  shown: () => props.shown,
  reopened: () => emit("reopened"),
  withdrawn: () => emit("withdrawn"),
});
const frame = ref<HTMLIFrameElement | null>(null);
/** The declared members of the panel the platform draws, for the widths its layout places them at. */
const members = computed(() => (view.direct.value ? (view.source.value as DirectPanelHostSource).panel.manifest.members : {}));
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
usePageActions(() => (props.shown && view.source.value ? { operations: operations.value.filter(operation => operation.kind !== "form.save") } : null));

defineExpose({ ...view, operations });
</script>

<template>
  <section class="panel-host">
    <header v-if="title" class="panel-host-title">{{ title }}</header>
    <p v-if="view.error.value" role="alert" class="panel-host-error">{{ view.error.value }}</p>
    <div v-else-if="view.direct.value" class="panel-host-direct">
      <PanelLayout
        :nodes="view.direct.value.layout"
        :members="members"
        :values="view.direct.value.mount.values.value"
        :member="view.direct.value.mount.member"
      />
    </div>
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
.panel-host-direct {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--spacing-md, 12px);
}
</style>

<!-- The direct layout's containers are drawn by a render function, so their rules are not scoped to this component. -->
<style>
.panel-layout {
  container-type: inline-size;
  display: flex;
  min-width: 0;
}
.panel-layout-gap-none { gap: 0; }
.panel-layout-gap-small { gap: var(--spacing-sm, 8px); }
.panel-layout-gap-medium { gap: var(--spacing-md, 12px); }
.panel-layout-gap-large { gap: var(--spacing-lg, 16px); }
.panel-layout-column { flex-direction: column; }
.panel-layout-row { flex-flow: row wrap; }
.panel-layout-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
}
.panel-layout-member { min-width: 0; }
/* In a row, a member with a declared width takes that share of twelve columns; one without takes what is left. */
.panel-layout-row > * { flex: 1 1 0; min-width: 0; }
.panel-layout-row > .panel-layout-member[style] { flex: 0 0 calc(var(--panel-layout-span) / 12 * 100%); }
.panel-layout-grid > * { grid-column: span 12; }
.panel-layout-grid > .panel-layout-member[style] { grid-column: span var(--panel-layout-span); }
@container (max-width: 36rem) {
  .panel-layout-row > *, .panel-layout-row > .panel-layout-member[style] { flex: 0 0 100%; }
  .panel-layout-grid > *, .panel-layout-grid > .panel-layout-member[style] { grid-column: span 12; }
}
</style>
