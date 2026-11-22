<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import { productPanelDisplayName } from "@ontomato/contracts/product-panels";
import { usePanelInstance, type PanelHostLabels, type PanelHostPort } from "./panel-host";
import { RefreshCw, X as CloseIcon } from "lucide-vue-next";
import { ElAlert, ElButton } from "element-plus";
import { usePageActions, type PlatformPageAction } from "./page-actions";

/**
 * One panel instance, shown full screen, beside a conversation or inside another application, or as an author's candidate
 * preview: the same component in all of them, because each only needs a source — a use relation with its current record,
 * or a workspace candidate — and a place to show it. The panel's component is mounted here, in the platform's document;
 * the frame below is kept but no panel runs in it (user's ruling, 2026-11-20). What the panel reports —
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
  /** The reader's language and the deployment's default, which a panel's own name is given in. */
  language: { locale: string; fallback: string };
  /**
   * Whether the reader is on this page. A page kept while the reader is on another holds no stream, offers nothing in the
   * header, asks the platform for nothing new and is reconciled when shown again. Absent means shown.
   */
  shown?: boolean;
  /**
   * The state fields the entry this page is opened at gives the panel (a fixed value, or later a frame's shared state):
   * the panel's commands that set one of them do nothing here, so the header does not offer them at this entry.
   */
  wired?: readonly string[];
  /** When this is an application's frame: the entry it shows, its menu and where that entry's page goes. */
  currentEntry?: import("./panel-host").DirectPanelRun["currentEntry"];
  /** Current application frame state when this content panel runs under a frame panel. */
  frameState?: Readonly<Record<string, unknown>>;
  /**
   * Hands why the linked draft could not be used back to the agent, as the sentence for the page's composer. Absent where
   * the page has no composer (an author's preview): the notice then offers only leaving the draft.
   */
  draftToAgent?: (text: string) => void;
  /**
   * Leaves the linked draft once the reader closes its notice: the page that holds this instance opens it as without the
   * draft (its address, state and forms). Absent, the instance's address only drops the draft's link.
   */
  leaveDraft?: () => void;
}>(), { shown: true, wired: () => [], currentEntry: undefined, frameState: undefined, draftToAgent: undefined, leaveDraft: undefined });
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
  label: (source) => {
    if (source.kind === "candidate") return props.label!;
    const name = productPanelDisplayName(source.panel, props.language.locale, props.language.fallback);
    return props.label ? `${props.label} · ${name}` : name;
  },
  address: () => props.address,
  initial: () => props.initial ?? {},
  shown: () => props.shown,
  reopened: () => emit("reopened"),
  withdrawn: () => emit("withdrawn"),
  currentEntry: props.currentEntry,
  frameState: () => props.frameState as Readonly<Record<string, import("@ontomato/contracts/agent-runtime-values").RuntimeJsonValue>> | undefined,
});
const frame = ref<HTMLIFrameElement | null>(null);
/** Where the panel goes in the page: the element its own component is mounted in, placed once. */
/** The reader closes the notice: the page goes on as it does without the draft. */
function leave() {
  view.dismissDraftRefusal();
  if (props.leaveDraft) props.leaveDraft();
  else view.leaveDraft();
}

/** Hands the reason back to the agent — the page's composer opens with it, for the reader to send or change — and closes. */
function toAgent() {
  props.draftToAgent?.(props.labels.draft.toAgentText.replace("{reason}", view.draftRefusal.value));
  leave();
}

function placeCoded(place: unknown) {
  const shown = view.direct.value;
  if (place instanceof HTMLElement && shown && shown.element.parentElement !== place)
    place.replaceChildren(shown.element);
}
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
/**
 * The page's commands, drawn where its title is (big main's ruling, 2026-11-21): the host's refresh — the panel's shown
 * data read again, the reader's unsaved edits kept — when the panel has members that read anything, then the panel's
 * declared commands in their order, the one it marks primary as the main action. A member's operations (a row's delete,
 * a form's save) stay where the panel draws them; a placed panel's commands are its own page's, not this one's.
 */
const commands = computed<PlatformPageAction[]>(() => {
  const shown = view.source.value;
  if (!shown) return [];
  const refresh: PlatformPageAction[] = Object.keys(shown.panel.manifest.members).length
    ? [{ id: "refresh", label: props.labels.refresh, icon: RefreshCw, iconOnly: true, onClick: () => view.refresh(null) }]
    : [];
  // A command setting a field this entry gives the panel would be undone at once: the entry's value stands.
  const setsWired = (id: string) => {
    const action = shown.panel.manifest.commands[id]?.do;
    return Boolean(action && "set" in action && Object.keys(action.set.fields).some((field) => props.wired.includes(field)));
  };
  const shortcuts = view.operations.value
    .filter((operation) => operation.kind === "state" && !operation.memberPath && !setsWired(operation.id))
    .map((operation): PlatformPageAction => ({
      id: operation.id,
      label: operation.label,
      // The one command the panel marks primary is the page's main action; an operation's ID here is its command's key.
      primary: shown.panel.manifest.commands[operation.id]?.primary === true,
      onClick: () => void view.invoke(operation.id),
    }));
  return [...refresh, ...shortcuts];
});
usePageActions(() => (props.shown && view.source.value ? { actions: commands.value } : null));

defineExpose({ ...view, operations, commands });
</script>

<template>
  <section class="panel-host">
    <header v-if="title" class="panel-host-title">{{ title }}</header>
    <p v-if="view.error.value" role="alert" class="panel-host-error">{{ view.error.value }}</p>
    <!-- A draft the panel cannot take never fails it (owner refused, unreadable, no form takes it): its sentence, above it. -->
    <div v-else-if="view.draftRefusal.value && view.admitted.value" class="panel-host-draft">
      <ElAlert type="warning" show-icon :closable="false" :title="view.draftRefusal.value">
        <div v-if="draftToAgent" class="panel-host-draft-actions">
          <ElButton size="small" @click="toAgent">{{ labels.draft.toAgent }}</ElButton>
        </div>
      </ElAlert>
      <!-- The library's own close is no button (no role, no name, not in the tab order): this one is. -->
      <button type="button" class="panel-host-draft-close" :aria-label="labels.draft.close" :title="labels.draft.close" @click="leave">
        <CloseIcon :size="16" aria-hidden="true" />
      </button>
    </div>
    <!-- A linked draft is opened before the page is shown: never a page that is about to turn into the draft's. -->
    <p v-if="!view.error.value && view.draftOpening.value && view.admitted.value" role="status" class="panel-host-draft-opening">
      {{ labels.draft.opening }}
    </p>
    <!-- Drawn while Java's answer is coming, so its members read at once; shown only once that answer names the page. -->
    <div
      v-if="!view.error.value && view.direct.value"
      v-show="view.admitted.value && !view.draftOpening.value"
      class="panel-host-direct"
      :data-panel-instance="view.instance"
    >
      <p v-if="view.notice.value" role="status" class="panel-host-notice">{{ view.notice.value }}</p>
      <div :ref="placeCoded" class="panel-host-coded" />
    </div>
    <iframe
      v-else-if="!view.error.value && view.document.value && view.admitted.value"
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
.panel-host-notice {
  margin: 0 0 var(--spacing-sm, 8px);
  color: var(--el-color-warning);
  font-size: 12px;
}
.panel-host-draft-opening {
  margin: 0;
  padding: var(--spacing-md, 12px);
  color: var(--el-text-color-secondary);
}
.panel-host-draft {
  position: relative;
  flex-shrink: 0;
  margin: var(--spacing-md, 12px) var(--spacing-md, 12px) 0;
}
.panel-host-draft :deep(.el-alert) {
  padding-right: calc(var(--spacing-md, 12px) + 24px);
}
.panel-host-draft :deep(.el-alert__title) {
  overflow-wrap: anywhere;
}
.panel-host-draft-close {
  position: absolute;
  top: var(--spacing-sm, 8px);
  right: var(--spacing-sm, 8px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--el-border-radius-small, 2px);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.panel-host-draft-close:hover {
  color: var(--el-text-color-primary);
}
.panel-host-draft-close:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.panel-host-draft-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm, 8px);
  margin-top: var(--spacing-sm, 8px);
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
