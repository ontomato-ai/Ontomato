<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useContainerWidth } from "./container-width";

/**
 * List-detail layout for one page: side-by-side (`split`) on wide containers and full-width alternating (`switch`)
 * either when requested or automatically when the layout's own container width is at or below
 * `--pane-narrow-breakpoint` (680px). Fills the container's definite height with independent scrolling per pane, keeps
 * the list DOM alive across switches so scroll position and filters stay intact, resets the detail body scroll to top
 * when `selectionKey` changes, and lays out fixed detail header, tabs, scrollable body and footer regions.
 *
 * Omitting `selected` preserves the legacy always-visible two-pane behavior for existing callers.
 */
const props = withDefaults(
  defineProps<{
    /** Preferred arrangement on wide containers: `"split"` shows list and detail side by side; `"switch"` alternates full-width list and detail. */
    mode?: "split" | "switch";
    /** Whether an item is selected. Omit to keep legacy always-visible two-pane behavior. */
    selected?: boolean;
    /** Whether the detail pane is showing a create form, treated as open detail even when no item is selected. */
    creating?: boolean;
    /** Identity of the currently shown item; changing it scrolls the detail body back to top while keeping the list's scroll position. */
    selectionKey?: string | number | null;
    /** Label for the back-to-list button shown in switch or narrow mode; defaults to `platform.backToList`. */
    backLabel?: string;
    /** Placeholder text shown in split mode when nothing is selected and no `#empty` slot is supplied; defaults to `platform.selectItemToView`. */
    emptyLabel?: string;
  }>(),
  {
    mode: "split",
    selected: undefined,
    creating: false,
    selectionKey: null,
  },
);

const emit = defineEmits<{
  /** Emitted when the reader activates the back-to-list control in switch or narrow mode. */
  back: [];
  /** Emitted when detail open or overlay state changes in switch or narrow mode so a host can sync browser history. */
  detailOpenChange: [payload: { open: boolean; overlay: boolean }];
}>();

defineSlots<{
  /** The list or tree pane; kept alive in switch mode so scroll position, filters and pagination survive returning from detail. */
  aside(): unknown;
  /** Fixed header above the detail body (does not scroll). */
  header?(): unknown;
  /** Optional fixed tabs row beneath the detail header (does not scroll). */
  tabs?(): unknown;
  /** Scrollable detail body. */
  default(): unknown;
  /** Optional fixed footer pinned below the detail body (does not scroll). */
  footer?(): unknown;
  /** Placeholder shown on the right in split mode when nothing is selected and not creating. */
  empty?(): unknown;
}>();

const DEFAULT_NARROW_BREAKPOINT = 680;
const { t } = useI18n();
const rootRef = ref<HTMLElement | null>(null);
const asideRef = ref<HTMLElement | null>(null);
const detailBodyRef = ref<HTMLElement | null>(null);
const { width, breakpoint } = useContainerWidth(rootRef, "--pane-narrow-breakpoint", DEFAULT_NARROW_BREAKPOINT);

const controlled = computed(() => props.selected !== undefined);
const hasDetail = computed(() => Boolean(props.selected) || props.creating);
const narrow = computed(() => width.value > 0 && width.value <= breakpoint.value);
const effectiveMode = computed<"split" | "switch">(() => (props.mode === "switch" || narrow.value ? "switch" : "split"));
const legacyStacked = computed(() => !controlled.value && narrow.value);

const showAside = computed(() => (!controlled.value ? true : effectiveMode.value === "split" || !hasDetail.value));
const showMain = computed(() => (!controlled.value ? true : effectiveMode.value === "split" || hasDetail.value));
const showEmpty = computed(() => controlled.value && effectiveMode.value === "split" && !hasDetail.value);
const showBackBar = computed(() => controlled.value && effectiveMode.value === "switch" && hasDetail.value);

const resolvedBackLabel = computed(() => props.backLabel || t("platform.backToList"));
const resolvedEmptyLabel = computed(() => props.emptyLabel || t("platform.selectItemToView"));

watch(
  () => props.selectionKey,
  (next, prev) => {
    if (next === prev) return;
    if (detailBodyRef.value) detailBodyRef.value.scrollTop = 0;
    void nextTick(() => {
      if (detailBodyRef.value) detailBodyRef.value.scrollTop = 0;
    });
  },
);

watch(
  () => ({
    open: controlled.value && hasDetail.value,
    overlay: controlled.value && effectiveMode.value === "switch",
  }),
  (next, prev) => {
    if (next.open === prev.open && next.overlay === prev.overlay) return;
    if (next.overlay || prev.overlay) emit("detailOpenChange", next);
  },
);
</script>

<template>
  <div
    ref="rootRef"
    class="sdk-two-pane"
    :data-mode="mode"
    :data-effective-mode="controlled ? effectiveMode : 'split'"
    :data-narrow="narrow ? 'true' : 'false'"
  >
    <div
      class="sdk-two-pane-block"
      :data-effective-mode="controlled ? effectiveMode : 'split'"
      :data-legacy-stacked="legacyStacked ? 'true' : 'false'"
    >
      <aside v-show="showAside" ref="asideRef" class="sdk-two-pane-aside">
        <slot name="aside"></slot>
      </aside>
      <section v-show="showMain" class="sdk-two-pane-main">
        <div v-if="showEmpty" class="sdk-two-pane-empty">
          <slot name="empty">
            <p class="sdk-two-pane-empty-text">{{ resolvedEmptyLabel }}</p>
          </slot>
        </div>
        <template v-else>
          <div v-if="showBackBar" class="sdk-two-pane-back-bar">
            <button type="button" class="sdk-two-pane-back-btn" @click="emit('back')">
              <span class="sdk-two-pane-back-icon" aria-hidden="true">←</span>
              <span>{{ resolvedBackLabel }}</span>
            </button>
          </div>
          <div v-if="$slots.header" class="sdk-two-pane-detail-header">
            <slot name="header"></slot>
          </div>
          <div v-if="$slots.tabs" class="sdk-two-pane-detail-tabs">
            <slot name="tabs"></slot>
          </div>
          <div ref="detailBodyRef" class="sdk-two-pane-detail-body">
            <slot></slot>
          </div>
          <div v-if="$slots.footer" class="sdk-two-pane-detail-footer">
            <slot name="footer"></slot>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sdk-two-pane {
  container-type: inline-size;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.sdk-two-pane-block {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: var(--pane-list-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
  overflow: hidden;
}
.sdk-two-pane-block[data-effective-mode="switch"] {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}
.sdk-two-pane-block[data-legacy-stacked="true"] {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto;
  overflow: visible;
}
.sdk-two-pane-aside {
  display: flex;
  flex-direction: column;
  border-inline-end: 1px solid var(--ui-divider);
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacing-md);
}
.sdk-two-pane-block[data-effective-mode="switch"] > .sdk-two-pane-aside {
  border-inline-end: 0;
}
.sdk-two-pane-block[data-legacy-stacked="true"] > .sdk-two-pane-aside {
  border-inline-end: 0;
  border-block-end: 1px solid var(--ui-divider);
  overflow-y: visible;
}
.sdk-two-pane-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.sdk-two-pane-block[data-legacy-stacked="true"] > .sdk-two-pane-main {
  overflow: visible;
}
.sdk-two-pane-back-bar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  padding: var(--spacing-sm) var(--page-section-padding);
  border-block-end: 1px solid var(--ui-divider);
  background: var(--el-bg-color);
}
.sdk-two-pane-back-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  min-height: var(--control-height-sm);
  padding: 0 var(--spacing-sm);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}
.sdk-two-pane-back-btn:hover {
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
}
.sdk-two-pane-back-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.sdk-two-pane-detail-header {
  flex: 0 0 auto;
  min-width: 0;
  padding: var(--detail-header-padding);
  border-block-end: 1px solid var(--ui-divider);
  background: var(--el-bg-color);
}
.sdk-two-pane-detail-tabs {
  flex: 0 0 auto;
  min-width: 0;
  padding: 0 var(--page-section-padding);
  border-block-end: 1px solid var(--ui-divider);
  background: var(--el-bg-color);
}
.sdk-two-pane-detail-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: var(--page-section-padding);
}
.sdk-two-pane-block[data-legacy-stacked="true"] .sdk-two-pane-detail-body {
  overflow-y: visible;
}
.sdk-two-pane-detail-footer {
  flex: 0 0 auto;
  min-width: 0;
  padding: var(--detail-footer-padding);
  border-block-start: 1px solid var(--ui-divider);
  background: var(--el-bg-color);
}
.sdk-two-pane-empty {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  padding: var(--page-section-padding);
}
.sdk-two-pane-empty-text {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  text-align: center;
}
</style>
