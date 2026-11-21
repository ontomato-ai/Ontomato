<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { SegmentedTextReader, type SegmentedTextPage, type SegmentedTextSource } from "@ontomato/foundation-ui/reader";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import type { PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import { usePanelContext } from "../panel/context";
import { useMember, useMemberData, useMemberParam } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";

/**
 * An object's text, read only, through its owner's reads (the platform's one read entry). Two shapes, by the data its
 * projection reads:
 * - sources read page by page: `sources` lists them as chips (an owner's records, one per source), and `page` reads the
 *   chosen source's text one page at a time (an owner's query, its rows the text's segments, `nextCursor` the next
 *   page); "more" reads the next page;
 * - one object's whole text: `record` reads it, and the field `textField` names is shown, its line breaks kept.
 * The source open now is the member's `activeSourceId`, and with an `anchor` the reader open on the page is its
 * `activeAnchor`: bound to the panel's state, they are read as well as written, so the page opens a source by writing
 * it (and the reader's anchor), and several readers sharing them on one page have only one open at a time.
 */
const props = withDefaults(
  defineProps<{
    /** The field of the `record` datum that holds the text (`content` by default). */
    textField?: string;
    /** This reader's key on the page; with a shared `activeAnchor`, only the reader it names is open. */
    anchor?: string;
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
    moreLabel: undefined,
    closeLabel: undefined,
    emptyText: undefined,
  },
);

const emit = defineEmits<{
  /** The reader was closed. */
  close: [anchor?: string];
}>();

const { t } = useI18n();
const panel = usePanelContext();
const member = useMember();
const declared = member.projection.data;
const sourcesData = Object.hasOwn(declared, "sources") ? useMemberData("sources") : null;
const recordData = Object.hasOwn(declared, "record") ? useMemberData("record") : null;

const activeSource = useMemberParam("activeSourceId");
const activeAnchor = useMemberParam("activeAnchor");
const page = shallowRef<SegmentedTextPage | null>(null);
const loading = ref(false);
const failure = shallowRef<Error | null>(null);
const text = (value: unknown) => (typeof value === "string" ? value : null);
const currentAnchor = computed(() => text(activeAnchor.value.value));
const currentSourceId = computed(() => text(activeSource.value.value));
/** The source this reader shows now: the one open, while this reader is the one open on the page (or has no anchor). */
const shownSourceId = computed(() => (props.anchor === undefined || currentAnchor.value === props.anchor ? currentSourceId.value : null));

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
      title: sourceId,
      items: rows.map((row) => ({ id: row.primaryKey, text: row.fields.text ?? "" })),
      nextOffset: nextCursor === undefined ? null : Number(nextCursor),
    };
  });
}

// Whatever opens a source — a chip, the page's own code, an address — the reader reads its first page; closed, nothing.
watch(shownSourceId, (sourceId) => {
  if (sourceId !== null) {
    readPage(sourceId, null);
    return;
  }
  reading++;
  page.value = null;
  loading.value = false;
  failure.value = null;
}, { immediate: true });

function onOpen(sourceId: string) {
  if (props.anchor !== undefined) activeAnchor.set(props.anchor);
  activeSource.set(sourceId);
}
function onMore(sourceId: string, nextOffset: number) {
  readPage(sourceId, String(nextOffset));
}
function onClose() {
  activeSource.set(null);
  if (props.anchor !== undefined) activeAnchor.set(null);
  emit("close", props.anchor);
}

/** The page shown, titled by its source as the sources list it once that is read (an address can open one before). */
const shownPage = computed(() => page.value && {
  ...page.value, title: sources.value.find((source) => source.id === page.value!.sourceId)?.title ?? page.value.sourceId,
});

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
      :page="shownPage"
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
