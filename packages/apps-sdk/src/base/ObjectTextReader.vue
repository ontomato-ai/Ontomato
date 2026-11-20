<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { SegmentedTextReader, type SegmentedTextPage, type SegmentedTextSource } from "@ontomato/foundation-ui/reader";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import type { PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import { usePanelContext } from "../panel/context";
import { useMember, useMemberData } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";

/**
 * An object's text, read only, through its owner's reads (the platform's one read entry). Two shapes, by the data its
 * projection reads:
 * - sources read page by page: `sources` lists them as chips (an owner's records, one per source), and `page` reads the
 *   chosen source's text one page at a time (an owner's query, its rows the text's segments, `nextCursor` the next
 *   page); "more" reads the next page;
 * - one object's whole text: `record` reads it, and the field `textField` names is shown, its line breaks kept.
 * Several readers on one page can share `activeAnchor` / `activeSourceId`, so only one of them is open at a time.
 */
const props = withDefaults(
  defineProps<{
    /** The field of the `record` datum that holds the text (`content` by default). */
    textField?: string;
    /** This reader's key on the page; with a shared `activeAnchor`, only the reader it names is open. */
    anchor?: string;
    /** The reader open on the page, shared between readers (`v-model:activeAnchor`). */
    activeAnchor?: string | null;
    /** The source open now (`v-model:activeSourceId`). */
    activeSourceId?: string | null;
    /** The panel's message key for the "More" button, in place of the platform's own words. */
    moreLabel?: string;
    /** The panel's message key for the Close button's accessible label. */
    closeLabel?: string;
    /** The panel's message key for what an empty reader says. */
    emptyText?: string;
  }>(),
  {
    textField: "content",
    anchor: undefined,
    activeAnchor: undefined,
    activeSourceId: undefined,
    moreLabel: undefined,
    closeLabel: undefined,
    emptyText: undefined,
  },
);

const emit = defineEmits<{
  /** The reader open on the page changed. */
  "update:activeAnchor": [anchor: string | null];
  /** The source open now changed. */
  "update:activeSourceId": [sourceId: string | null];
  /** The reader was closed. */
  close: [anchor?: string];
}>();

const { t } = useI18n();
const panel = usePanelContext();
const member = useMember();
const declared = member.projection.data;
const sourcesData = Object.hasOwn(declared, "sources") ? useMemberData("sources") : null;
const recordData = Object.hasOwn(declared, "record") ? useMemberData("record") : null;

const localAnchor = ref<string | null>(null);
const localSourceId = ref<string | null>(null);
const page = shallowRef<SegmentedTextPage | null>(null);
const loading = ref(false);
const failure = shallowRef<Error | null>(null);
const currentAnchor = computed(() => (props.activeAnchor !== undefined ? props.activeAnchor : localAnchor.value));
const currentSourceId = computed(() => (props.activeSourceId !== undefined ? props.activeSourceId : localSourceId.value));

/** The chips: the owner's sources, by their ID and label. */
const sources = computed<readonly SegmentedTextSource[]>(() => {
  if (sourcesData?.value.status !== "ready") return [];
  return (sourcesData.value.value as unknown as PlatformObjectRecord[]).map((row) => ({ id: row.primaryKey, title: row.label }));
});
const sourcesFailure = computed(() =>
  sourcesData && sourcesData.value.status !== "ready" && sourcesData.value.status !== "loading" && sourcesData.value.status !== "awaiting"
    ? sourcesData.value.status === "error" ? sourcesData.value.message : t(`platform.data${sourcesData.value.status === "forbidden" ? "Forbidden" : "Empty"}`)
    : null);

let reading = 0;
/** One page of a source's text: the owner's query for that source from `cursor` on. */
function readPage(sourceId: string, cursor: string | null) {
  const asked = ++reading;
  loading.value = true;
  failure.value = null;
  void member.data.read("page", { source: sourceId, ...(cursor === null ? {} : { cursor }) }).then((answer) => {
    if (asked !== reading) return;
    loading.value = false;
    if (answer.status !== "ready") {
      failure.value = new Error(answer.status === "error" ? answer.message : t(`platform.data${answer.status === "forbidden" ? "Forbidden" : "Empty"}`));
      return;
    }
    const { rows, nextCursor } = answer.value as unknown as PanelRecordQuery;
    page.value = {
      sourceId,
      title: sources.value.find((source) => source.id === sourceId)?.title ?? sourceId,
      items: rows.map((row) => ({ id: row.primaryKey, text: row.fields.text ?? "" })),
      nextOffset: nextCursor === undefined ? null : Number(nextCursor),
    };
  });
}

function setActive(anchor: string | null, sourceId: string | null) {
  if (props.activeAnchor === undefined) localAnchor.value = anchor;
  if (props.activeSourceId === undefined) localSourceId.value = sourceId;
  emit("update:activeAnchor", anchor);
  emit("update:activeSourceId", sourceId);
}
function onOpen(sourceId: string) {
  setActive(props.anchor ?? null, sourceId);
  readPage(sourceId, null);
}
function onMore(sourceId: string, nextOffset: number) {
  readPage(sourceId, String(nextOffset));
}
function onClose() {
  reading++;
  page.value = null;
  loading.value = false;
  failure.value = null;
  setActive(null, null);
  emit("close", props.anchor);
}

/** One object's whole text, as the `record` datum holds it. */
const wholeText = computed(() =>
  recordData?.value.status === "ready" ? (recordData.value.value as unknown as PlatformObjectRecord).fields[props.textField] ?? "" : null);
const labels = computed(() => ({ empty: t("platform.dataEmpty"), forbidden: t("platform.dataForbidden"), awaiting: t("platform.dataAwaiting") }));
</script>

<template>
  <div class="sdk-object-text-reader">
    <template v-if="recordData">
      <data-state :result="recordData as DataStateResult" :labels="labels">
        <pre class="sdk-object-text-reader-whole">{{ wholeText }}</pre>
      </data-state>
    </template>
    <SegmentedTextReader
      v-else
      :sources="sources"
      :anchor="anchor"
      :active-anchor="currentAnchor"
      :active-source-id="currentSourceId"
      :page="page"
      :loading="loading"
      :error="failure?.message ?? sourcesFailure"
      :more-label="moreLabel ? panel.t(moreLabel) : t('platform.readerMore')"
      :close-label="closeLabel ? panel.t(closeLabel) : t('platform.readerClose')"
      :empty-text="emptyText ? panel.t(emptyText) : t('platform.readerEmpty')"
      :loading-text="t('platform.readerLoading')"
      @open="onOpen"
      @more="onMore"
      @close="onClose"
    />
  </div>
</template>

<style scoped>
.sdk-object-text-reader-whole {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--el-font-family);
  font-size: var(--el-font-size-base);
  line-height: 1.6;
}
</style>
