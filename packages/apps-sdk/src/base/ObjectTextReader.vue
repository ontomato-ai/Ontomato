<script setup lang="ts">
import { computed, defineAsyncComponent, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { SegmentedTextReader, type SegmentedTextPage, type SegmentedTextSource } from "@ontomato/foundation-ui/reader";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { panelRecordFieldText, type PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import { usePanelContext } from "../panel/context";
import { useMember, useMemberData, useMemberParam } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { useDataStateLabels } from "./data-state-labels";

type CodeLanguage = "javascript" | "json" | "markdown" | "html" | "python" | "text";

const CODE_LANGUAGES: Readonly<Record<string, CodeLanguage>> = {
  html: "html",
  htm: "html",
  svg: "html",
  xml: "html",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "javascript",
  mts: "javascript",
  cts: "javascript",
  tsx: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  pyw: "python",
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

function fileExtension(path: string | null): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  const base = trimmed.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot >= base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

const MarkdownView = defineAsyncComponent(() => import("@ontomato/foundation-ui/markdown").then((module) => module.MarkdownView));
const CodeEditor = defineAsyncComponent(() => import("@ontomato/foundation-ui/code").then((module) => module.CodeEditor));

/**
 * An object's text, read only, through its owner's reads (the platform's one read entry). Two shapes, by the data its
 * projection reads:
 * - sources read page by page: `sources` lists them as chips (an owner's records, one per source), and `page` reads the
 *   chosen source's text one page at a time (an owner's query, its rows the text's segments, `nextCursor` the next
 *   page); "more" reads the next page;
 * - one object's whole text: `record` reads it, and the field `textField` names is shown according to `format`
 *   (`"auto"` infers Markdown with optional YAML frontmatter split or a read-only code viewer from `pathField`,
 *   `record.label`, or `record.primaryKey`, falling back to preformatted text when no extension is present).
 * The source open now is the member's `activeSourceId`, and with an `anchor` the reader open on the page is its
 * `activeAnchor`: bound to the panel's state, they are read as well as written, so the page opens a source by writing
 * it (and the reader's anchor), and several readers sharing them on one page have only one open at a time.
 */
const props = withDefaults(
  defineProps<{
    /** The field of the `record` datum that holds the text (`content` by default). */
    textField?: string;
    /** How whole-record text is rendered: `"auto"` infers Markdown or read-only code from the file path, `"plain"` renders preformatted text, `"markdown"` renders Markdown (with YAML frontmatter separated when present), and `"code"` renders a read-only code viewer. */
    format?: "auto" | "plain" | "markdown" | "code";
    /** Optional field of the `record` datum holding the path or filename used to infer language; falls back to `record.label`, then `record.primaryKey`. */
    pathField?: string;
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
    format: "auto",
    pathField: undefined,
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

const { t, locale } = useI18n();
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
      items: rows.map((row) => ({ id: row.primaryKey, text: panelRecordFieldText(row.fields.text, locale.value) })),
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

/** One object's whole record, when the `record` datum is ready. */
const wholeRecord = computed<PlatformObjectRecord | null>(() =>
  recordData?.value.status === "ready" ? (recordData.value.value as unknown as PlatformObjectRecord) : null,
);
/** One object's whole text, as the `record` datum holds it. */
const wholeText = computed(() =>
  wholeRecord.value ? panelRecordFieldText(wholeRecord.value.fields[props.textField], locale.value) : null,
);
/** Path or filename used to infer Markdown/code rendering for whole-record mode. */
const recordPath = computed<string | null>(() => {
  const record = wholeRecord.value;
  if (!record) return null;
  if (props.pathField) {
    const fieldPath = panelRecordFieldText(record.fields[props.pathField], locale.value).trim();
    if (fieldPath) return fieldPath;
  }
  const label = record.label?.trim() || null;
  const primaryKey = record.primaryKey?.trim() || null;
  if (fileExtension(label)) return label;
  if (fileExtension(primaryKey)) return primaryKey;
  return label ?? primaryKey;
});
const extension = computed(() => fileExtension(recordPath.value));
const renderMode = computed<"plain" | "markdown" | "code">(() => {
  if (props.format === "plain" || props.format === "markdown" || props.format === "code") {
    return props.format;
  }
  const ext = extension.value;
  if (!ext) return "plain";
  if (ext === "md" || ext === "markdown") return "markdown";
  return "code";
});
const codeLanguage = computed<CodeLanguage>(() => {
  const ext = extension.value;
  return (ext ? CODE_LANGUAGES[ext] : undefined) ?? "text";
});
const markdownSections = computed(() => {
  const value = wholeText.value;
  if (value === null) return null;
  const match = value.match(FRONTMATTER_PATTERN);
  return match ? { frontmatter: match[1]!, body: match[2]! } : { frontmatter: null, body: value };
});
const labels = useDataStateLabels(props.emptyText ? () => panel.t(props.emptyText!) : undefined);
</script>

<template>
  <div class="sdk-object-text-reader">
    <template v-if="recordData">
      <data-state :result="recordData as DataStateResult" :labels="labels">
        <div v-if="renderMode === 'markdown' && markdownSections" class="sdk-object-text-reader-markdown">
          <pre v-if="markdownSections.frontmatter" class="sdk-object-text-reader-frontmatter">{{ markdownSections.frontmatter }}</pre>
          <MarkdownView :content="markdownSections.body" />
        </div>
        <div v-else-if="renderMode === 'code'" class="sdk-object-text-reader-code">
          <CodeEditor
            :key="`${recordPath ?? ''}:${codeLanguage}`"
            :model-value="wholeText ?? ''"
            :language="codeLanguage"
            readonly
            :min-height="120"
          />
        </div>
        <pre v-else class="sdk-object-text-reader-whole">{{ wholeText }}</pre>
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
.sdk-object-text-reader {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}
.sdk-object-text-reader-whole {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--el-font-family);
  font-size: var(--el-font-size-base);
  line-height: 1.6;
}
.sdk-object-text-reader-markdown {
  min-width: 0;
}
.sdk-object-text-reader-frontmatter {
  margin: 0 0 var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.sdk-object-text-reader-code {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.sdk-object-text-reader-code :deep(.code-editor),
.sdk-object-text-reader-code :deep(.cm-editor) {
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
}
</style>
