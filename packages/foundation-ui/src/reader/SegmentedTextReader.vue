<script setup lang="ts">
import { computed } from "vue";
import type { SegmentedTextPage, SegmentedTextSource } from "./types";

/**
 * Offset-paged plain-text reader with optional source triggers and a closeable reading panel. Multiple instances on
 * one page share `activeAnchor` / `activeSourceId` so only one reading panel is expanded at a time; text segments are
 * rendered strictly as escaped text nodes.
 */
const props = withDefaults(
  defineProps<{
    /** Optional clickable source buttons that open a source at offset 0. */
    sources?: readonly SegmentedTextSource[];
    /** Placement key on the page; when paired with `activeAnchor`, only the matching placement expands. */
    anchor?: string;
    /** Currently expanded anchor across placements on the same page. */
    activeAnchor?: string | null;
    /** Currently opened source ID. */
    activeSourceId?: string | null;
    /** Loaded segment page to display when this placement is expanded. */
    page?: SegmentedTextPage | null;
    /** Whether a segment fetch is in progress. */
    loading?: boolean;
    /** Error text to show when a segment read failed. */
    error?: string | null;
    /** Label for the "More" pagination button (shown only when `page.nextOffset` is non-null). */
    moreLabel?: string;
    /** Accessible label for the Close button. */
    closeLabel?: string;
    /** Fallback text when `page.items` is empty and no `page.emptyHint` is provided. */
    emptyText?: string;
    /** Text shown while loading segments. */
    loadingText?: string;
  }>(),
  {
    sources: undefined,
    anchor: undefined,
    activeAnchor: null,
    activeSourceId: null,
    page: null,
    loading: false,
    error: null,
    moreLabel: "More",
    closeLabel: "Close",
    emptyText: "No content available",
    loadingText: "Loading…",
  },
);

const emit = defineEmits<{
  /** Emitted when a reader clicks a source chip to read from offset 0. */
  open: [sourceId: string, offset: number, anchor?: string];
  /** Emitted when a reader clicks "More" to read from `nextOffset`. */
  more: [sourceId: string, nextOffset: number, anchor?: string];
  /** Emitted when a reader closes the expanded panel. */
  close: [anchor?: string];
  "update:activeAnchor": [anchor: string | null];
  "update:activeSourceId": [sourceId: string | null];
}>();

const isAnchorActive = computed(() =>
  props.anchor !== undefined ? props.activeAnchor === props.anchor : true,
);
const isOpen = computed(() =>
  isAnchorActive.value && Boolean(props.activeSourceId || props.page || props.loading || props.error),
);
const activePage = computed(() =>
  props.page && (!props.activeSourceId || props.page.sourceId === props.activeSourceId) ? props.page : null,
);
const hasMore = computed(
  () => activePage.value?.nextOffset !== null && activePage.value?.nextOffset !== undefined,
);
const heading = computed(() => {
  if (activePage.value?.title) return activePage.value.title;
  if (props.activeSourceId) {
    return props.sources?.find((source) => source.id === props.activeSourceId)?.title ?? props.activeSourceId;
  }
  return "";
});

function openSource(sourceId: string) {
  emit("update:activeAnchor", props.anchor ?? null);
  emit("update:activeSourceId", sourceId);
  emit("open", sourceId, 0, props.anchor);
}

function readMore() {
  if (!activePage.value || !hasMore.value) return;
  emit("more", activePage.value.sourceId, activePage.value.nextOffset!, props.anchor);
}

function closePanel() {
  emit("update:activeAnchor", null);
  emit("update:activeSourceId", null);
  emit("close", props.anchor);
}
</script>

<template>
  <div class="fui-segmented-reader" :data-anchor="anchor">
    <div v-if="sources?.length" class="fui-segmented-reader-sources">
      <button
        v-for="source in sources"
        :key="source.id"
        type="button"
        class="fui-segmented-reader-chip"
        :data-source-id="source.id"
        :class="{ active: isAnchorActive && activeSourceId === source.id }"
        :aria-pressed="isAnchorActive && activeSourceId === source.id"
        @click="openSource(source.id)"
      >
        {{ source.title }}
      </button>
    </div>

    <section v-if="isOpen" class="fui-segmented-reader-panel" aria-live="polite">
      <header class="fui-segmented-reader-head">
        <strong class="fui-segmented-reader-title">{{ heading }}</strong>
        <button
          type="button"
          class="fui-segmented-reader-close"
          :aria-label="closeLabel"
          @click="closePanel"
        >
          ×
        </button>
      </header>
      <p v-if="error" role="alert" class="fui-segmented-reader-error">{{ error }}</p>
      <p v-else-if="loading && !activePage" class="fui-segmented-reader-muted" aria-busy="true">{{ loadingText }}</p>
      <template v-else-if="activePage">
        <p v-if="!activePage.items.length" class="fui-segmented-reader-muted">
          {{ activePage.emptyHint ?? emptyText }}
        </p>
        <blockquote
          v-for="item in activePage.items"
          :key="item.id"
          class="fui-segmented-reader-segment"
        >{{ item.text }}</blockquote>
        <button
          v-if="hasMore"
          type="button"
          class="fui-segmented-reader-chip fui-segmented-reader-more"
          :disabled="loading"
          @click="readMore"
        >
          {{ moreLabel }}
        </button>
      </template>
    </section>
  </div>
</template>

<style scoped>
.fui-segmented-reader {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fui-segmented-reader-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.fui-segmented-reader-chip {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm, 4px);
  color: var(--el-text-color-regular);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-xs, 12px);
  line-height: 20px;
  max-width: 100%;
  overflow: hidden;
  padding: 2px 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fui-segmented-reader-chip:hover,
.fui-segmented-reader-chip.active {
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}
.fui-segmented-reader-chip:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.fui-segmented-reader-panel {
  background: var(--el-fill-color-light);
  border-radius: var(--radius-sm, 4px);
  padding: 10px 12px;
}
.fui-segmented-reader-head {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  margin-bottom: 6px;
}
.fui-segmented-reader-title {
  font-size: var(--text-sm, 13px);
}
.fui-segmented-reader-close {
  background: transparent;
  border: 0;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 2px 4px;
}
.fui-segmented-reader-close:hover {
  color: var(--el-text-color-primary);
}
.fui-segmented-reader-segment {
  border-left: 2px solid var(--el-border-color);
  margin: 8px 0;
  padding-left: 10px;
  white-space: pre-wrap;
}
.fui-segmented-reader-muted {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  margin: 4px 0;
}
.fui-segmented-reader-error {
  color: var(--el-color-danger);
  font-size: var(--text-xs, 12px);
  margin: 4px 0;
}
</style>
