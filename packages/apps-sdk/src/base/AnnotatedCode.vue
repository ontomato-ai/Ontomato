<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AnnotatedCode,
  AnnotatedCodeLineRange,
  AnnotatedCodeSegment,
  AnnotatedCodeSummarySection,
  AnnotatedCodeTone,
} from "@ontomato/contracts/annotated-code";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { usePanelContext } from "../panel/context";
import { useMember, useMemberData, useMemberOutput, useMemberParam } from "../panel/member";
import { useDataStateLabels } from "./data-state-labels";

interface CodeLine {
  readonly number: number;
  readonly text: string;
}

interface FlattenedSegment {
  readonly segment: AnnotatedCodeSegment;
  readonly depth: number;
}

interface LegendItem {
  readonly kind: string;
  readonly label: string;
  readonly tone: AnnotatedCodeTone;
}

/**
 * Displays line-numbered source code alongside hierarchical line-range annotation segments, with bidirectional
 * highlighting and scrolling, a deduplicated kind legend, expandable structured detail rows with clickable reference
 * tokens (`refKey`), an optional outdated-code notice when `currentCode` differs from the annotated `code`, and
 * optional summary blocks. Pure presentation: all labels, segments, reference keys, and summaries come from the bound
 * owner's `annotatedCode` datum.
 */
const props = withDefaults(
  defineProps<{
    /** Optional panel message key or fallback text shown when both code and segments are empty. */
    emptyText?: string;
    /** Optional panel message key or fallback label for the stale-code warning badge. */
    staleLabel?: string;
    /** Optional panel message key or fallback hint shown when `currentCode` differs from the annotated `code`. */
    staleHint?: string;
    /** Optional panel message key or fallback heading shown above the annotated code view; pass `""` to omit. */
    segmentsTitle?: string;
    /** Optional panel message key or fallback heading shown above the summary blocks; pass `""` to omit. */
    summaryTitle?: string;
    /** Optional panel message key or fallback text shown when `summary` is absent or empty; omitted hides the empty summary area. */
    emptySummaryText?: string;
    /** Optional panel message key or fallback tooltip/title for clickable reference buttons inside segment details. */
    refActionLabel?: string;
    /** Optional panel message key or fallback label preceding the segment-kind legend. */
    legendLabel?: string;
  }>(),
  {
    emptyText: undefined,
    staleLabel: undefined,
    staleHint: undefined,
    segmentsTitle: undefined,
    summaryTitle: undefined,
    emptySummaryText: undefined,
    refActionLabel: undefined,
    legendLabel: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when the reader clicks a clickable reference token (`refKey`) inside a segment's details. */
  "select-ref": [refKey: string];
  /** Emitted when the active highlighted segment changes (`null` when cleared). */
  "select-segment": [segmentId: string | null];
}>();

const TONE_PALETTE: readonly AnnotatedCodeTone[] = [
  "info",
  "success",
  "accent",
  "warning",
  "danger",
  "neutral",
];

const { t, te } = useI18n();
const panel = usePanelContext();
const member = useMember();
const contentData = useMemberData("content");

const currentCodeParam = useMemberParam("currentCode");
const activeSegmentParam = useMemberParam("activeSegmentId");

function resolveCopy(keyOrText: string | undefined, fallbackPlatformKey?: string): string {
  if (keyOrText !== undefined) {
    const trimmed = keyOrText.trim();
    if (!trimmed) return "";
    const fromPanel = panel.t(trimmed);
    if (fromPanel !== trimmed) return fromPanel;
    if (te(trimmed)) return t(trimmed);
    return trimmed;
  }
  return fallbackPlatformKey ? t(fallbackPlatformKey) : "";
}

const resolvedEmptyText = computed(() => resolveCopy(props.emptyText, "platform.annotatedCodeEmpty"));
const resolvedStaleLabel = computed(() => resolveCopy(props.staleLabel, "platform.annotatedCodeStaleLabel"));
const resolvedStaleHint = computed(() => resolveCopy(props.staleHint, "platform.annotatedCodeStaleHint"));
const resolvedSegmentsTitle = computed(() => resolveCopy(props.segmentsTitle, "platform.annotatedCodeSegments"));
const resolvedSummaryTitle = computed(() => resolveCopy(props.summaryTitle, "platform.annotatedCodeSummary"));
const resolvedEmptySummaryText = computed(() => resolveCopy(props.emptySummaryText));
const resolvedRefActionLabel = computed(() => resolveCopy(props.refActionLabel, "platform.annotatedCodeRefLocate"));
const resolvedLegendLabel = computed(() => resolveCopy(props.legendLabel, "platform.annotatedCodeKinds"));

const dataStateLabels = useDataStateLabels(() => resolvedEmptyText.value);

const annotated = computed<AnnotatedCode | null>(() =>
  contentData.value.status === "ready" ? (contentData.value.value as unknown as AnnotatedCode | null) : null,
);

const hasContent = computed(() => {
  const value = annotated.value;
  if (!value) return false;
  const hasCode = typeof value.code === "string" && value.code.length > 0;
  const hasSegments = Array.isArray(value.segments) && value.segments.length > 0;
  return hasCode || hasSegments;
});

const displayState = computed<DataStateResult<AnnotatedCode>>(() => {
  const current = contentData.value;
  if (current.status === "ready" && !hasContent.value) {
    return { status: "empty" };
  }
  return current as DataStateResult<AnnotatedCode>;
});

const resolvedCurrentCode = computed<string | null>(() => {
  const fromInput = member.inputs.value.currentCode;
  if (typeof fromInput === "string") return fromInput;
  const fromParam = currentCodeParam.value.value;
  if (typeof fromParam === "string") return fromParam;
  return null;
});

const isStale = computed(() => {
  const currentCode = resolvedCurrentCode.value;
  const savedCode = annotated.value?.code;
  return typeof currentCode === "string" && typeof savedCode === "string" && currentCode !== savedCode;
});

const codeLines = computed<readonly CodeLine[]>(() => {
  const raw = annotated.value?.code;
  if (typeof raw !== "string" || raw.length === 0) return [];
  return raw.split(/\r?\n/u).map((text, index) => ({ number: index + 1, text }));
});

function flattenSegments(
  list: readonly AnnotatedCodeSegment[] | undefined,
  depth = 0,
  out: FlattenedSegment[] = [],
): FlattenedSegment[] {
  for (const segment of list ?? []) {
    out.push({ segment, depth });
    if (segment.children?.length) {
      flattenSegments(segment.children, depth + 1, out);
    }
  }
  return out;
}

const flatSegments = computed<readonly FlattenedSegment[]>(() => flattenSegments(annotated.value?.segments));

function toneForSegment(segment: AnnotatedCodeSegment): AnnotatedCodeTone {
  if (segment.tone) return segment.tone;
  let hash = 2166136261;
  for (let index = 0; index < segment.kind.length; index++) {
    hash ^= segment.kind.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return TONE_PALETTE[(hash >>> 0) % TONE_PALETTE.length]!;
}

const legendItems = computed<readonly LegendItem[]>(() => {
  const seen = new Set<string>();
  const items: LegendItem[] = [];
  for (const { segment } of flatSegments.value) {
    if (seen.has(segment.kind)) continue;
    seen.add(segment.kind);
    items.push({
      kind: segment.kind,
      label: segment.kindLabel,
      tone: toneForSegment(segment),
    });
  }
  return items;
});

const summarySections = computed<readonly AnnotatedCodeSummarySection[]>(() => annotated.value?.summary ?? []);
const showSummaryArea = computed(() => summarySections.value.length > 0 || resolvedEmptySummaryText.value.length > 0);

const localActiveSegmentId = ref<string | null>(null);
const activeSegmentId = computed<string | null>(() => {
  const fromParam = activeSegmentParam.value.value;
  if (typeof fromParam === "string" && fromParam.length > 0) return fromParam;
  const fromInput = member.inputs.value.activeSegmentId;
  if (typeof fromInput === "string" && fromInput.length > 0) return fromInput;
  return localActiveSegmentId.value;
});

const activeSegment = computed<AnnotatedCodeSegment | null>(() => {
  const id = activeSegmentId.value;
  if (!id) return null;
  return flatSegments.value.find((entry) => entry.segment.id === id)?.segment ?? null;
});

const activeRange = computed<AnnotatedCodeLineRange | null>(() => activeSegment.value?.lineRange ?? null);

const expandedIds = ref<ReadonlySet<string>>(new Set());
const selectedRef = ref<string | null>(null);
const codeBox = ref<HTMLElement | null>(null);
const segmentsBox = ref<HTMLElement | null>(null);

function setActiveSegment(id: string | null) {
  localActiveSegmentId.value = id;
  try {
    activeSegmentParam.set(id);
  } catch {
    // Fixed literal input cannot be overwritten; retain local highlight state.
  }
  emit("select-segment", id);
}

watch(annotated, (next, prev) => {
  if (next === prev) return;
  expandedIds.value = new Set();
  selectedRef.value = null;
  const currentId = activeSegmentId.value;
  if (currentId && next && !flatSegments.value.some((entry) => entry.segment.id === currentId)) {
    setActiveSegment(null);
  }
});

useMemberOutput("status", () => contentData.value.status);
useMemberOutput("activeSegmentId", () => activeSegmentId.value);
useMemberOutput("selectedRef", () => selectedRef.value);

function isLineHit(lineNumber: number): boolean {
  const range = activeRange.value;
  return range !== null && lineNumber >= range.start && lineNumber <= range.end;
}

function isSegmentOpen(segmentId: string): boolean {
  return expandedIds.value.has(segmentId);
}

function toggleSegment(segmentId: string) {
  const next = new Set(expandedIds.value);
  if (next.has(segmentId)) next.delete(segmentId);
  else next.add(segmentId);
  expandedIds.value = next;
}

function formatLineRange(range: AnnotatedCodeLineRange): string {
  return range.start === range.end
    ? t("platform.annotatedCodeLineSingle", { line: range.start })
    : t("platform.annotatedCodeLineRange", { start: range.start, end: range.end });
}

function escapeAttrValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function scrollContainerToElement(container: HTMLElement | null, target: Element | null) {
  if (!container || !target) return;
  const boxRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  if (boxRect.height > 0) {
    container.scrollTop += targetRect.top - boxRect.top - container.clientHeight / 3;
  } else if (typeof (target as HTMLElement).scrollIntoView === "function") {
    (target as HTMLElement).scrollIntoView({ block: "nearest" });
  }
}

function pickLine(lineNumber: number) {
  let best: FlattenedSegment | null = null;
  for (const entry of flatSegments.value) {
    const { start, end } = entry.segment.lineRange;
    if (lineNumber < start || lineNumber > end) continue;
    if (!best) {
      best = entry;
      continue;
    }
    const span = end - start;
    const bestSpan = best.segment.lineRange.end - best.segment.lineRange.start;
    if (span < bestSpan || (span === bestSpan && entry.depth > best.depth)) {
      best = entry;
    }
  }
  const nextId = best?.segment.id ?? null;
  setActiveSegment(nextId);
  if (nextId) {
    void nextTick(() => {
      const target = segmentsBox.value?.querySelector(`[data-segment-id="${escapeAttrValue(nextId)}"]`) ?? null;
      scrollContainerToElement(segmentsBox.value, target);
    });
  }
}

function pickSegment(segment: AnnotatedCodeSegment) {
  setActiveSegment(segment.id);
  void nextTick(() => {
    const target = codeBox.value?.querySelector(`[data-line="${segment.lineRange.start}"]`) ?? null;
    scrollContainerToElement(codeBox.value, target);
  });
}

function selectRef(refKey: string) {
  selectedRef.value = refKey;
  emit("select-ref", refKey);
}
</script>

<template>
  <section class="sdk-annotated-code" :data-status="displayState.status">
    <header v-if="resolvedSegmentsTitle || isStale" class="sdk-annotated-code-header">
      <div class="sdk-annotated-code-header-row">
        <span v-if="resolvedSegmentsTitle" class="sdk-annotated-code-heading">{{ resolvedSegmentsTitle }}</span>
        <span v-if="isStale" class="sdk-annotated-code-stale-badge" role="status">{{ resolvedStaleLabel }}</span>
      </div>
      <p v-if="isStale && resolvedStaleHint" class="sdk-annotated-code-stale-hint">{{ resolvedStaleHint }}</p>
    </header>

    <data-state :result="displayState" :labels="dataStateLabels">
      <div class="sdk-annotated-code-content">
        <div
          class="sdk-annotated-code-body"
          :class="{ 'is-single-pane': codeLines.length === 0 || flatSegments.length === 0 }"
        >
          <div v-if="codeLines.length > 0" ref="codeBox" class="sdk-annotated-code-lines">
            <div
              v-for="line in codeLines"
              :key="line.number"
              class="sdk-annotated-code-line"
              :data-line="line.number"
              :data-hit="isLineHit(line.number)"
              @click="pickLine(line.number)"
            >
              <span class="sdk-annotated-code-line-no" aria-hidden="true">{{ line.number }}</span>
              <span class="sdk-annotated-code-line-text">{{ line.text }}</span>
            </div>
          </div>

          <div v-if="flatSegments.length > 0" class="sdk-annotated-code-seg-pane">
            <div v-if="legendItems.length > 0" class="sdk-annotated-code-legend">
              <span v-if="resolvedLegendLabel" class="sdk-annotated-code-legend-title">{{ resolvedLegendLabel }}</span>
              <span
                v-for="item in legendItems"
                :key="item.kind"
                class="sdk-annotated-code-legend-item"
                :data-kind="item.kind"
                :data-tone="item.tone"
              >
                <span class="sdk-annotated-code-legend-dot" aria-hidden="true"></span>
                <span>{{ item.label }}</span>
              </span>
            </div>

            <div ref="segmentsBox" class="sdk-annotated-code-segments">
              <div
                v-for="entry in flatSegments"
                :key="entry.segment.id"
                class="sdk-annotated-code-seg"
                role="button"
                tabindex="0"
                :data-segment-id="entry.segment.id"
                :data-kind="entry.segment.kind"
                :data-depth="entry.depth"
                :data-tone="toneForSegment(entry.segment)"
                :data-open="isSegmentOpen(entry.segment.id)"
                :aria-current="activeSegmentId === entry.segment.id ? 'true' : undefined"
                :style="{ '--ac-depth': Math.min(entry.depth, 5) }"
                @click="pickSegment(entry.segment)"
                @keydown.enter.prevent="pickSegment(entry.segment)"
                @keydown.space.prevent="pickSegment(entry.segment)"
              >
                <div class="sdk-annotated-code-seg-head">
                  <span class="sdk-annotated-code-seg-kind">{{ entry.segment.kindLabel }}</span>
                  <span class="sdk-annotated-code-seg-title">{{ entry.segment.title }}</span>
                  <span class="sdk-annotated-code-seg-range">{{ formatLineRange(entry.segment.lineRange) }}</span>
                  <button
                    v-if="entry.segment.details && entry.segment.details.length > 0"
                    type="button"
                    class="sdk-annotated-code-seg-toggle"
                    :aria-expanded="isSegmentOpen(entry.segment.id)"
                    @click.stop="toggleSegment(entry.segment.id)"
                    @keydown.enter.stop
                    @keydown.space.stop
                  >
                    {{ isSegmentOpen(entry.segment.id) ? t("platform.annotatedCodeCollapse") : t("platform.annotatedCodeExpand") }}
                  </button>
                </div>

                <p v-if="entry.segment.note" class="sdk-annotated-code-seg-note">{{ entry.segment.note }}</p>

                <dl
                  v-if="entry.segment.details && entry.segment.details.length > 0 && isSegmentOpen(entry.segment.id)"
                  class="sdk-annotated-code-seg-details"
                  @click.stop
                >
                  <template v-for="(detail, detailIndex) in entry.segment.details" :key="`${entry.segment.id}-detail-${detailIndex}`">
                    <dt>{{ detail.label }}</dt>
                    <dd class="sdk-annotated-code-mono">
                      <template v-for="(part, partIndex) in detail.parts" :key="`${entry.segment.id}-part-${detailIndex}-${partIndex}`">
                        <button
                          v-if="part.refKey"
                          type="button"
                          class="sdk-annotated-code-ref"
                          :data-ref-key="part.refKey"
                          :title="resolvedRefActionLabel"
                          @click.stop="selectRef(part.refKey)"
                          @keydown.enter.stop
                          @keydown.space.stop
                        >
                          {{ part.text }}
                        </button>
                        <span v-else>{{ part.text }}</span>
                      </template>
                    </dd>
                  </template>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div v-if="showSummaryArea" class="sdk-annotated-code-summary">
          <h3 v-if="resolvedSummaryTitle" class="sdk-annotated-code-summary-heading">{{ resolvedSummaryTitle }}</h3>
          <p v-if="summarySections.length === 0" class="sdk-annotated-code-summary-empty">{{ resolvedEmptySummaryText }}</p>
          <div v-else class="sdk-annotated-code-summary-blocks">
            <div
              v-for="(section, index) in summarySections"
              :key="`summary-${index}`"
              class="sdk-annotated-code-summary-block"
              :data-tone="section.tone ?? 'default'"
            >
              <div class="sdk-annotated-code-summary-title">{{ section.title }}</div>
              <ul v-if="section.kind === 'list' && section.items && section.items.length > 0" class="sdk-annotated-code-summary-list">
                <li v-for="(item, itemIndex) in section.items" :key="`summary-${index}-item-${itemIndex}`">{{ item }}</li>
              </ul>
              <p v-else-if="section.text" class="sdk-annotated-code-summary-text">{{ section.text }}</p>
            </div>
          </div>
        </div>
      </div>
    </data-state>
  </section>
</template>

<style scoped>
.sdk-annotated-code {
  container: sdk-annotated-code / inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.sdk-annotated-code-header {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}

.sdk-annotated-code-header-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs);
}

.sdk-annotated-code-heading {
  color: var(--sdk-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  line-height: var(--leading-xs);
}

.sdk-annotated-code-stale-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--spacing-xs);
  border: 1px solid var(--sdk-color-warning-light-7, var(--ui-border));
  border-radius: var(--radius-xs);
  background: var(--sdk-color-warning-light-9, var(--ui-fill-tertiary));
  color: var(--sdk-color-warning-text, var(--sdk-color-warning));
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  line-height: var(--leading-xs);
}

.sdk-annotated-code-stale-hint {
  margin: 0;
  color: var(--sdk-color-warning-text, var(--sdk-text-color-secondary));
  font-size: var(--text-xs);
  line-height: var(--leading-sm);
}

.sdk-annotated-code-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  min-width: 0;
}

.sdk-annotated-code-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--spacing-sm);
  min-width: 0;
}

.sdk-annotated-code-body.is-single-pane {
  grid-template-columns: minmax(0, 1fr);
}

@container sdk-annotated-code (max-width: 680px) {
  .sdk-annotated-code-body {
    grid-template-columns: minmax(0, 1fr);
  }
}

.sdk-annotated-code-lines {
  max-height: 30rem;
  overflow: auto;
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-xs);
  background: var(--sdk-fill-color-blank, var(--sdk-bg-color));
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  min-width: 0;
}

.sdk-annotated-code-line {
  display: flex;
  gap: var(--spacing-sm);
  padding: 0 var(--spacing-xs);
  line-height: var(--leading-sm);
  cursor: pointer;
  white-space: pre;
}

.sdk-annotated-code-line:hover {
  background: var(--ui-fill-tertiary);
}

.sdk-annotated-code-line[data-hit="true"] {
  background: var(--sdk-color-primary-light-9, var(--ui-fill-secondary));
}

.sdk-annotated-code-line-no {
  flex: none;
  width: 2.5rem;
  color: var(--sdk-text-color-placeholder);
  text-align: right;
  font-variant-numeric: tabular-nums;
  user-select: none;
}

.sdk-annotated-code-line-text {
  flex: 1 1 auto;
  color: var(--sdk-text-color-regular);
}

.sdk-annotated-code-seg-pane {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}

.sdk-annotated-code-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs) var(--spacing-sm);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}

.sdk-annotated-code-legend-title {
  color: var(--sdk-text-color-secondary);
}

.sdk-annotated-code-legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  color: var(--sdk-text-color-secondary);
}

.sdk-annotated-code-legend-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: var(--radius-full);
  background: var(--ac-tone-color, var(--sdk-color-primary));
  flex: none;
}

.sdk-annotated-code-segments {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  max-height: 30rem;
  overflow: auto;
  min-width: 0;
}

.sdk-annotated-code-seg {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  margin-inline-start: calc(var(--ac-depth, 0) * var(--spacing-md));
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--ui-divider);
  border-inline-start: 3px solid var(--ac-tone-color, var(--sdk-color-primary));
  border-radius: var(--radius-xs);
  background: var(--sdk-bg-color);
  text-align: left;
  cursor: pointer;
  font-size: var(--text-xs);
  line-height: var(--leading-sm);
  transition: background-color var(--transition-fast, 120ms ease), border-color var(--transition-fast, 120ms ease);
}

.sdk-annotated-code-seg:hover {
  background: var(--ui-fill-tertiary);
}

.sdk-annotated-code-seg:focus-visible {
  outline: 2px solid var(--sdk-color-primary);
  outline-offset: -2px;
}

.sdk-annotated-code-seg[aria-current="true"] {
  border-color: var(--sdk-color-primary);
  border-inline-start-color: var(--ac-tone-color, var(--sdk-color-primary));
  background: var(--sdk-color-primary-light-9, var(--ui-fill-secondary));
}

.sdk-annotated-code-legend-item[data-tone="info"],
.sdk-annotated-code-seg[data-tone="info"] {
  --ac-tone-color: var(--sdk-color-primary);
  --ac-tone-text: var(--sdk-color-primary-text, var(--brand-link, var(--sdk-color-primary)));
}

.sdk-annotated-code-legend-item[data-tone="success"],
.sdk-annotated-code-seg[data-tone="success"] {
  --ac-tone-color: var(--sdk-color-success);
  --ac-tone-text: var(--sdk-color-success-text, var(--sdk-color-success));
}

.sdk-annotated-code-legend-item[data-tone="warning"],
.sdk-annotated-code-seg[data-tone="warning"] {
  --ac-tone-color: var(--sdk-color-warning);
  --ac-tone-text: var(--sdk-color-warning-text, var(--sdk-color-warning));
}

.sdk-annotated-code-legend-item[data-tone="danger"],
.sdk-annotated-code-seg[data-tone="danger"] {
  --ac-tone-color: var(--sdk-color-danger);
  --ac-tone-text: var(--sdk-color-danger-text, var(--sdk-color-danger));
}

.sdk-annotated-code-legend-item[data-tone="neutral"],
.sdk-annotated-code-seg[data-tone="neutral"] {
  --ac-tone-color: var(--sdk-color-info, var(--sdk-text-color-secondary));
  --ac-tone-text: var(--sdk-text-color-secondary);
}

.sdk-annotated-code-legend-item[data-tone="accent"],
.sdk-annotated-code-seg[data-tone="accent"] {
  --ac-tone-color: var(--brand-accent, var(--sdk-color-primary));
  --ac-tone-text: var(--brand-accent-ink, var(--brand-accent, var(--sdk-color-primary)));
}

.sdk-annotated-code-seg-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--spacing-xs);
  min-width: 0;
}

.sdk-annotated-code-seg-kind {
  color: var(--ac-tone-text, var(--brand-link));
  font-weight: var(--font-medium);
}

.sdk-annotated-code-seg-title {
  color: var(--sdk-text-color-primary);
  font-weight: var(--font-medium);
  overflow-wrap: anywhere;
}

.sdk-annotated-code-seg-range {
  color: var(--sdk-text-color-secondary);
  font-variant-numeric: tabular-nums;
}

.sdk-annotated-code-seg-toggle {
  margin-inline-start: auto;
  padding: 0 var(--spacing-xs);
  border: none;
  background: none;
  color: var(--brand-link, var(--sdk-color-primary));
  cursor: pointer;
  font: inherit;
  font-size: var(--text-xs);
}

.sdk-annotated-code-seg-toggle:hover,
.sdk-annotated-code-seg-toggle:focus-visible {
  text-decoration: underline;
}

.sdk-annotated-code-seg-note {
  margin: 0;
  color: var(--sdk-text-color-secondary);
  overflow-wrap: anywhere;
}

.sdk-annotated-code-seg-details {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--spacing-xs) var(--spacing-sm);
  margin: 0;
  padding-top: var(--spacing-xs);
  border-top: 1px solid var(--ui-divider);
}

.sdk-annotated-code-seg-details dt {
  color: var(--sdk-text-color-secondary);
}

.sdk-annotated-code-seg-details dd {
  margin: 0;
  color: var(--sdk-text-color-regular);
  overflow-wrap: anywhere;
}

.sdk-annotated-code-mono {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.sdk-annotated-code-ref {
  padding: 0 2px;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: var(--brand-link, var(--sdk-color-primary));
  cursor: pointer;
  font: inherit;
}

.sdk-annotated-code-ref:hover,
.sdk-annotated-code-ref:focus-visible {
  background: var(--sdk-color-primary-light-9, var(--ui-fill-secondary));
  text-decoration: underline;
}

.sdk-annotated-code-summary {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  min-width: 0;
}

.sdk-annotated-code-summary-heading {
  margin: 0;
  color: var(--sdk-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  line-height: var(--leading-sm);
}

.sdk-annotated-code-summary-empty {
  margin: 0;
  color: var(--sdk-text-color-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}

.sdk-annotated-code-summary-blocks {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  min-width: 0;
}

.sdk-annotated-code-summary-block {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}

.sdk-annotated-code-summary-block[data-tone="warning"] {
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--sdk-color-warning-light-7, var(--ui-border));
  border-inline-start: 3px solid var(--sdk-color-warning);
  border-radius: var(--radius-xs);
  background: var(--sdk-color-warning-light-9, var(--ui-fill-tertiary));
}

.sdk-annotated-code-summary-title {
  color: var(--sdk-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  line-height: var(--leading-xs);
}

.sdk-annotated-code-summary-block[data-tone="warning"] .sdk-annotated-code-summary-title {
  color: var(--sdk-color-warning-text, var(--sdk-color-warning));
}

.sdk-annotated-code-summary-list {
  margin: 0;
  padding-inline-start: var(--spacing-lg);
  color: var(--sdk-text-color-regular);
  font-size: var(--text-sm);
  line-height: var(--leading-base);
}

.sdk-annotated-code-summary-text {
  margin: 0;
  color: var(--sdk-text-color-regular);
  font-size: var(--text-sm);
  line-height: var(--leading-base);
  overflow-wrap: anywhere;
}
</style>
