<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DisplayLoad, DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import type { PanelCurrentUser } from "@ontomato/contracts/panel-host";
import { productPanelDisplayName } from "@ontomato/contracts/product-panels";
import { panelOverlayContainerKey, platformCurrentUserKey, usePanelInstance, type PanelHostLabels, type PanelHostPort } from "./panel-host";
import { confirmDanger } from "./confirm-danger";
import { createPanelBackController } from "./panel-back";
import { useOptionalLeaveConfirmation } from "./unsaved-changes";

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
  /** State values supplied by the application entry. */
  entryInputs?: Readonly<Record<string, RuntimeJsonValue>>;
  /** Pending live state patch (including non-deepLink declared public state) for a newly mounted panel. */
  liveState?: Readonly<Record<string, RuntimeJsonValue>> | null;
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
   * Whether panel-local back handlers with `pushHistory: true` may push browser history entries. True at full page and
   * candidate preview; false beside a conversation or for a custom application frame panel.
   */
  historyBack?: boolean;
  /** Optional override for confirming unsaved-change leave outside an enclosing platform shell. */
  confirmLeave?: () => Promise<boolean>;
  /** Optional current user display info override outside an enclosing platform shell. */
  currentUser?: PanelCurrentUser | null;
}>(), {
  shown: true,
  wired: () => [],
  currentEntry: undefined,
  frameState: undefined,
  historyBack: true,
  confirmLeave: undefined,
  currentUser: undefined,
  liveState: null,
});
const emit = defineEmits<{
  /** What a message from this instance carries now. */
  context: [context: import("@ontomato/contracts/page-context").PageContext];
  /** The instance's address, with its declared deep-linkable state. */
  "display-address": [input: DisplayPageAddressInput];
  /** The instance's live deep-linkable state values (including declared defaults omitted from the URL). */
  "display-state": [state: import("./panel-host").PanelHostState];
  "display-loaded": [load: DisplayLoad];
  "display-dirty": [dirty: boolean];
  /** Shown again, the page passed its checks: its frame may ask again and its objects are being read again. */
  reopened: [];
  /** Shown again, the page is no longer its application's: its use relation was withdrawn or bound elsewhere. */
  withdrawn: [];
  /** Whether this host has mounted a visible panel surface (direct component, frame document, or error alert). */
  "surface-ready": [ready: boolean];
}>();

const shellLeave = useOptionalLeaveConfirmation();
let localLeaveConfirmed = false;
let localLeavePending: Promise<boolean> | null = null;
let localLeaveToken = 0;

function confirmLeaveUnsaved(): Promise<boolean> {
  if (!view.dirty.value) return Promise.resolve(true);
  if (!props.confirmLeave && shellLeave) return shellLeave.confirm();
  if (localLeaveConfirmed) return Promise.resolve(true);
  if (localLeavePending) return localLeavePending;
  const ask = props.confirmLeave ?? (() => confirmDanger("Leave without saving?", "Unsaved changes"));
  localLeavePending = ask().then(
    (ok) => {
      localLeavePending = null;
      if (ok) {
        localLeaveConfirmed = true;
        const token = ++localLeaveToken;
        void nextTick()
          .then(() => nextTick())
          .then(() => {
            if (localLeaveToken === token) localLeaveConfirmed = false;
          });
      }
      return ok;
    },
    () => {
      localLeavePending = null;
      return false;
    },
  );
  return localLeavePending;
}

const hostElement = ref<HTMLElement | null>(null);
const overlayContainer = inject(panelOverlayContainerKey, null);
const backController = createPanelBackController({
  active: () => props.shown,
  scopeElement: () => hostElement.value,
  allowHistory: () => props.historyBack,
  isDirty: () => view.dirty.value,
  confirmLeaveUnsaved,
});
onBeforeUnmount(() => backController.dispose());

const injectedCurrentUser = inject(platformCurrentUserKey, null);
const hasCurrentUserSource = props.currentUser !== undefined || injectedCurrentUser !== null;
const readCurrentUser = () => {
  const raw = props.currentUser !== undefined ? props.currentUser : injectedCurrentUser?.value ?? null;
  const name = raw?.displayName?.trim();
  return name ? { displayName: name } : null;
};

const view = usePanelInstance(props.port, {
  labels: props.labels,
  label: (source) => {
    if (source.kind !== "registered") return props.label!;
    const name = productPanelDisplayName(source.panel, props.language.locale, props.language.fallback);
    return props.label ? `${props.label} · ${name}` : name;
  },
  address: () => props.address,
  initial: () => props.initial ?? {},
  entryInputs: () => props.entryInputs,
  liveState: () => props.liveState ?? null,
  wired: () => props.wired,
  shown: () => props.shown,
  reopened: () => emit("reopened"),
  withdrawn: () => emit("withdrawn"),
  currentEntry: props.currentEntry,
  frameState: () => props.frameState as Readonly<Record<string, import("@ontomato/contracts/agent-runtime-values").RuntimeJsonValue>> | undefined,
  ...(overlayContainer ? { overlayContainer: () => overlayContainer.value } : {}),
  registerBackHandler: backController.register,
  confirmLeaveUnsaved,
  ...(hasCurrentUserSource ? { currentUser: readCurrentUser } : {}),
});
watch(() => [props.address, props.initial, view.address.value], () => backController.syncHistorySnapshot(), { flush: "post" });
const frame = ref<HTMLIFrameElement | null>(null);
/** Where the panel goes in the page: the element its own component is mounted in, placed once. */
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
// The instance's address exists once its record is read; before that there is none to report.
watch(view.address, (address) => emit("display-address", { kind: "state", address }));
watch(view.state, (state) => emit("display-state", state), { immediate: true });
watch(view.displayLoad, (load) => emit("display-loaded", load));
watch(view.dirty, (dirty) => emit("display-dirty", dirty), { flush: "sync", immediate: true });
const surfaceReady = computed(() => Boolean(view.direct.value || view.document.value || view.error.value));
watch(surfaceReady, (ready) => emit("surface-ready", ready), { immediate: true });

const operations = computed(() =>
  view.operations.value.map((operation) => ({
    ...operation,
    disabled: operation.target?.source === "state" && !view.state.value[operation.target.state],
    invoke: (input?: Readonly<Record<string, unknown>>) => view.invoke(operation.id, input),
  })),
);

defineExpose({ ...view, operations });
</script>

<template>
  <section ref="hostElement" class="panel-host">
    <header v-if="title" class="panel-host-title">{{ title }}</header>
    <p v-if="view.error.value" role="alert" class="panel-host-error">{{ view.error.value }}</p>
    <!-- A host notice stands above the content box so the box height adjusts around it and never scrolls the notice. -->
    <p
      v-if="!view.error.value && view.direct.value && view.notice.value"
      role="status"
      class="panel-host-notice"
    >
      {{ view.notice.value }}
    </p>
    <div
      v-if="!view.error.value && view.direct.value"
      class="panel-host-direct"
      :data-panel-instance="view.instance"
    >
      <div :ref="placeCoded" class="panel-host-coded" />
    </div>
    <iframe
      v-else-if="!view.error.value && view.document.value"
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
  height: 100%;
  min-height: 0;
  min-width: 0;
}
.panel-host-title {
  flex-shrink: 0;
  padding: 4px var(--spacing-md, 12px);
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.panel-host-error {
  flex-shrink: 0;
  margin: 0;
  padding: var(--spacing-md, 12px);
  color: var(--el-color-danger);
}
.panel-host-notice {
  flex-shrink: 0;
  margin: var(--spacing-sm, 8px) var(--spacing-md, 12px) 0;
  color: var(--el-color-warning);
  font-size: 12px;
}
.panel-host-frame {
  border: 0;
  flex: 1;
  min-height: 0;
  width: 100%;
}
.panel-host-direct {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  box-sizing: border-box;
}
/* Transparent to layout so the mounted `#app` element sits directly inside the definite-height content box. */
.panel-host-coded {
  display: contents;
}
</style>

<style>
.panel-host-overlay-root {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
}
[data-panel-overlay-root] .el-dialog:not(.is-fullscreen) {
  max-width: calc(100% - 32px);
}
[data-panel-overlay-root] .el-drawer:is(.ltr, .rtl) {
  max-width: 100%;
}
[data-panel-overlay-root] .el-drawer:is(.ttb, .btt) {
  max-height: 100%;
}
[data-panel-overlay-root] .el-message {
  max-width: calc(100% - 32px);
}
[data-panel-overlay-root] .el-message-box {
  max-width: min(var(--el-messagebox-width, 420px), calc(100% - 32px));
}
/*
 * A bare `#app` mount wrapper (carrying neither class nor style) is transparent to layout so the panel's own root
 * element sits directly inside the definite-height content box. Direct flex items of `.panel-host-direct` default to
 * `flex-shrink: 0` at zero specificity so flow-down panels never collapse and fill panels (`height: 100%` or `flex: 1`)
 * take over cleanly without inheriting a forced flex direction or height from the host.
 */
:where(.panel-host-direct > .panel-host-coded > [data-panel-bare-root]) {
  display: contents;
}
:where(.panel-host-direct > .panel-host-coded > *),
:where(.panel-host-direct > .panel-host-coded > [data-panel-bare-root] > *) {
  flex-shrink: 0;
}
</style>
