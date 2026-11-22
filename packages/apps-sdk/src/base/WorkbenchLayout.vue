<script setup lang="ts">
import { computed, nextTick, ref, useSlots, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useContainerWidth } from "./container-width";

/**
 * Three-pane workbench layout for graph and canvas pages: collapsible left browse/palette pane, center canvas, and
 * selection-driven right detail pane with fixed header, optional tabs, scrollable body and optional footer.
 *
 * When the layout's own container width falls below `--workbench-narrow-breakpoint` (880px), the canvas fills the full
 * width and both side panes switch to floating overlays with at most one open at a time (opening detail closes aside,
 * and opening aside closes detail).
 */
const props = withDefaults(
  defineProps<{
    /** Whether the right detail pane is open. Defaults to false so the canvas fills the area when nothing is selected. */
    detailOpen?: boolean;
    /** Whether the left aside pane is open. Defaults to true; readers can collapse or expand it. */
    asideOpen?: boolean;
    /** Identity of the currently selected item in the detail pane; changing it scrolls the detail body back to top. */
    selectionKey?: string | number | null;
    /** Accessible label and heading title for the left aside pane. */
    asideLabel?: string;
    /** Accessible label for the right detail pane. */
    detailLabel?: string;
  }>(),
  {
    detailOpen: false,
    asideOpen: true,
    selectionKey: null,
  },
);

const emit = defineEmits<{
  /** Emitted when the left aside pane is collapsed or expanded by the reader or narrow-mode mutual exclusion. */
  "update:asideOpen": [open: boolean];
  /** Emitted when the right detail pane is closed by the reader or narrow-mode mutual exclusion. */
  closeDetail: [];
}>();

defineSlots<{
  /** Left browse list, filter panel, or draggable palette. */
  aside?(): unknown;
  /** Center graph or canvas surface, including its own toolbar. */
  default(): unknown;
  /** Fixed header at the top of the right detail pane (does not scroll). */
  "detail-header"?(): unknown;
  /** Optional fixed tabs beneath the detail header (does not scroll). */
  "detail-tabs"?(): unknown;
  /** Scrollable body of the right detail pane. */
  detail?(): unknown;
  /** Optional fixed footer pinned at the bottom of the right detail pane (does not scroll). */
  "detail-footer"?(): unknown;
}>();

const DEFAULT_NARROW_BREAKPOINT = 880;
const { t } = useI18n();
const slots = useSlots();
const rootRef = ref<HTMLElement | null>(null);
const detailBodyRef = ref<HTMLElement | null>(null);
const { width, breakpoint } = useContainerWidth(rootRef, "--workbench-narrow-breakpoint", DEFAULT_NARROW_BREAKPOINT);

const hasAsideSlot = computed(() => Boolean(slots.aside));
const narrow = computed(() => width.value > 0 && width.value < breakpoint.value);
const localAsideOpen = ref(props.asideOpen);
const narrowActiveSide = ref<"aside" | "detail" | null>(null);

const resolvedAsideLabel = computed(() => props.asideLabel || t("platform.workbenchAside"));
const resolvedDetailLabel = computed(() => props.detailLabel || t("platform.workbenchDetail"));

function activateNarrowSide(side: "aside" | "detail" | null) {
  narrowActiveSide.value = side;
}

watch(narrow, (isNarrow) => {
  if (!isNarrow) {
    narrowActiveSide.value = null;
    return;
  }
  if (props.detailOpen) {
    activateNarrowSide("detail");
    if (localAsideOpen.value) {
      localAsideOpen.value = false;
      emit("update:asideOpen", false);
    }
  } else if (hasAsideSlot.value && localAsideOpen.value) {
    activateNarrowSide("aside");
  } else {
    activateNarrowSide(null);
  }
});

watch(
  () => props.asideOpen,
  (next) => {
    localAsideOpen.value = next;
    if (!narrow.value) return;
    if (next && hasAsideSlot.value) {
      activateNarrowSide("aside");
      if (props.detailOpen) emit("closeDetail");
    } else if (!next && narrowActiveSide.value === "aside") {
      activateNarrowSide(null);
    }
  },
);

watch(
  () => props.detailOpen,
  (next) => {
    if (!narrow.value) return;
    if (next) {
      activateNarrowSide("detail");
      if (localAsideOpen.value) {
        localAsideOpen.value = false;
        emit("update:asideOpen", false);
      }
    } else if (narrowActiveSide.value === "detail") {
      activateNarrowSide(null);
    }
  },
);

watch(
  () => props.selectionKey,
  (next, prev) => {
    if (next === prev) return;
    if (narrow.value && props.detailOpen && next !== null && next !== undefined) {
      activateNarrowSide("detail");
      if (localAsideOpen.value) {
        localAsideOpen.value = false;
        emit("update:asideOpen", false);
      }
    }
    if (detailBodyRef.value) detailBodyRef.value.scrollTop = 0;
    void nextTick(() => {
      if (detailBodyRef.value) detailBodyRef.value.scrollTop = 0;
    });
  },
);

const effectiveAsideOpen = computed(() => {
  if (!hasAsideSlot.value) return false;
  if (narrow.value) return narrowActiveSide.value === "aside";
  return localAsideOpen.value;
});

const effectiveDetailOpen = computed(() => {
  if (narrow.value) return props.detailOpen && narrowActiveSide.value === "detail";
  return props.detailOpen;
});

function setAsideOpen(open: boolean) {
  localAsideOpen.value = open;
  emit("update:asideOpen", open);
  if (!narrow.value) return;
  if (open) {
    activateNarrowSide("aside");
    if (props.detailOpen) emit("closeDetail");
  } else if (narrowActiveSide.value === "aside") {
    activateNarrowSide(null);
  }
}

function handleCloseDetail() {
  if (narrow.value && narrowActiveSide.value === "detail") activateNarrowSide(null);
  emit("closeDetail");
}
</script>

<template>
  <div
    ref="rootRef"
    class="sdk-workbench"
    :data-narrow="narrow ? 'true' : 'false'"
    :data-aside-open="effectiveAsideOpen ? 'true' : 'false'"
    :data-detail-open="effectiveDetailOpen ? 'true' : 'false'"
  >
    <div class="sdk-workbench-frame">
      <aside
        v-if="hasAsideSlot"
        v-show="effectiveAsideOpen"
        class="sdk-workbench-aside"
        :class="{ 'is-overlay': narrow }"
        :aria-label="resolvedAsideLabel"
      >
        <div class="sdk-workbench-aside-bar">
          <span class="sdk-workbench-pane-label">{{ resolvedAsideLabel }}</span>
          <button
            type="button"
            class="sdk-workbench-icon-btn"
            :aria-label="t('platform.workbenchCollapseAside')"
            :title="t('platform.workbenchCollapseAside')"
            @click="setAsideOpen(false)"
          >
            <span aria-hidden="true">‹</span>
          </button>
        </div>
        <div class="sdk-workbench-aside-body">
          <slot name="aside"></slot>
        </div>
      </aside>

      <main class="sdk-workbench-canvas">
        <button
          v-if="hasAsideSlot && !effectiveAsideOpen"
          type="button"
          class="sdk-workbench-aside-toggle"
          :aria-label="t('platform.workbenchExpandAside')"
          :title="t('platform.workbenchExpandAside')"
          @click="setAsideOpen(true)"
        >
          <span aria-hidden="true">›</span>
        </button>
        <div class="sdk-workbench-canvas-body">
          <slot></slot>
        </div>
      </main>

      <section
        v-if="effectiveDetailOpen"
        class="sdk-workbench-detail"
        :class="{ 'is-overlay': narrow }"
        :aria-label="resolvedDetailLabel"
      >
        <div class="sdk-workbench-detail-header">
          <div class="sdk-workbench-detail-header-slot">
            <slot name="detail-header">
              <span class="sdk-workbench-pane-label">{{ resolvedDetailLabel }}</span>
            </slot>
          </div>
          <button
            type="button"
            class="sdk-workbench-icon-btn sdk-workbench-detail-close"
            :aria-label="t('platform.workbenchCloseDetail')"
            :title="t('platform.workbenchCloseDetail')"
            @click="handleCloseDetail"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div v-if="$slots['detail-tabs']" class="sdk-workbench-detail-tabs">
          <slot name="detail-tabs"></slot>
        </div>
        <div ref="detailBodyRef" class="sdk-workbench-detail-body">
          <slot name="detail"></slot>
        </div>
        <div v-if="$slots['detail-footer']" class="sdk-workbench-detail-footer">
          <slot name="detail-footer"></slot>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sdk-workbench {
  container-type: inline-size;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.sdk-workbench-frame {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
  overflow: hidden;
}
.sdk-workbench-aside {
  display: flex;
  flex: 0 0 var(--workbench-aside-width);
  flex-direction: column;
  width: var(--workbench-aside-width);
  max-width: 100%;
  min-width: 0;
  min-height: 0;
  border-inline-end: 1px solid var(--ui-divider);
  background: var(--el-bg-color);
}
.sdk-workbench-aside.is-overlay {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  z-index: 2;
  box-shadow: var(--elevation-overlay);
}
.sdk-workbench-aside-bar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-block-end: 1px solid var(--ui-divider);
}
.sdk-workbench-pane-label {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  line-height: var(--leading-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sdk-workbench-aside-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacing-md);
}
.sdk-workbench-canvas {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--ui-canvas);
}
.sdk-workbench-canvas-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.sdk-workbench-aside-toggle {
  position: absolute;
  inset-block-start: var(--spacing-sm);
  inset-inline-start: var(--spacing-sm);
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  padding: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
  font-size: var(--text-base);
  line-height: 1;
  cursor: pointer;
  box-shadow: var(--elevation-panel);
  transition: background-color var(--transition-fast), color var(--transition-fast);
}
.sdk-workbench-aside-toggle:hover {
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
}
.sdk-workbench-aside-toggle:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.sdk-workbench-detail {
  display: flex;
  flex: 0 0 var(--workbench-detail-width);
  flex-direction: column;
  width: var(--workbench-detail-width);
  max-width: 100%;
  min-width: 0;
  min-height: 0;
  border-inline-start: 1px solid var(--ui-divider);
  background: var(--el-bg-color);
}
.sdk-workbench-detail.is-overlay {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  z-index: 2;
  box-shadow: var(--elevation-overlay);
}
.sdk-workbench-detail-header {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-sm);
  min-width: 0;
  padding: var(--detail-header-padding);
  border-block-end: 1px solid var(--ui-divider);
  background: var(--el-bg-color);
}
.sdk-workbench-detail-header-slot {
  flex: 1 1 auto;
  min-width: 0;
}
.sdk-workbench-detail-tabs {
  flex: 0 0 auto;
  min-width: 0;
  padding: 0 var(--page-section-padding);
  border-block-end: 1px solid var(--ui-divider);
  background: var(--el-bg-color);
}
.sdk-workbench-detail-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: var(--page-section-padding);
}
.sdk-workbench-detail-footer {
  flex: 0 0 auto;
  min-width: 0;
  padding: var(--detail-footer-padding);
  border-block-start: 1px solid var(--ui-divider);
  background: var(--el-bg-color);
}
.sdk-workbench-icon-btn {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: var(--text-base);
  line-height: 1;
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}
.sdk-workbench-icon-btn:hover {
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
}
.sdk-workbench-icon-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
