<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelChildObjectIdentity } from "@ontomato/contracts/panel-manifest";
import {
  authoredReadParameterSource,
  directReadDeclaration,
  type PanelRecordQuery,
} from "@ontomato/contracts/panel-projection";
import type { PlatformOntologyObjectsResponse } from "@ontomato/contracts/platform-ontology";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { formatRelativeTime } from "@ontomato/workbench-ui/utils/relative-time";
import { slotOutputState, usePanelContext, useProjectionSlot } from "../panel/context";
import { paramValues } from "../panel/direct";
import { useMember, useMemberData, useMemberParam } from "../panel/member";
import type {
  PlatformFieldReference,
  PlatformGraphStatus,
  PlatformObjectRecord,
} from "../panel/platform-objects";
import { projectionElement } from "../panel/projection-element";
import { stateChildObject, stateObject, stateObjects, type PanelFieldValue } from "../panel/state";
import type { ObjectListColumn, ObjectListRef } from "./object-list-types";
import { textHighlightSegments } from "./text-highlight";
import { useDataStateLabels } from "./data-state-labels";

type ObjectListSelection = ObjectListRef | PanelChildObjectIdentity;

interface ParsedListData {
  readonly rows: readonly PlatformObjectRecord[];
  readonly total: number;
  readonly hasTotal: boolean;
  readonly nextCursor?: string;
  /** What the owner says of a partial answer, in the reader's language, shown beside the rows. */
  readonly diagnostics: readonly string[];
  readonly status: PlatformGraphStatus;
  readonly reason?: string;
}

/**
 * Platform objects as a selectable list or multi-column table. Reads its member's `rows` (`panelRecordList` /
 * `panelRecordQuery`) or `objects` (`panelOntologyObjects`) datum through `useMemberData` and exchanges search,
 * pagination, single selection and checked items through `useMemberParam`. Search input, pagination controls and
 * multi-row checkboxes are inferred from the owner's read signature and the member's output bindings.
 */
const props = withDefaults(
  defineProps<{
    /**
     * The table's columns, each a field of the owner's records (`key`, its header `labelKey`, and how it is drawn); absent,
     * the list is compact: each item shows its label, then `statusField`, `subtitleField` and `tagsField` as configured.
     */
    columns?: readonly ObjectListColumn[];
    /**
     * The field shown as a status tag at the end of each compact item. Its colour is the owner's tone for that field on the
     * record (`tones`): an owner that gives none has it shown as plain text, and the colour is the owner's to give.
     */
    statusField?: string;
    /** The key in the owner's record `tags` whose values are shown as small tags beneath each compact item. */
    tagsField?: string;
    /**
     * Field key whose value is each item's summary line in compact list mode, beneath its label (such as a description);
     * absent, the owner's own subtitle for the record is shown, if it gives one.
     */
    subtitleField?: string;
    /** Maximum number of visible lines in a compact summary. Omit it to show the whole summary. */
    subtitleLines?: number;
    /** How many items a page holds when the owner's read pages (a query's cursor, or page numbers); 20 by default. */
    pageSize?: number;
    /**
     * Keeps something selected: when nothing is selected (on first showing, too) or the selected item is no longer listed
     * (deleted, or filtered out), the first listed item is selected; an empty list clears the selection. A selection the
     * reader cleared on purpose is left cleared.
     */
    fallbackToFirst?: boolean;
    /** Whether clicking the selected item again clears the selection; off, a click always selects. */
    toggleable?: boolean;
    /** The panel's message key for what an empty list says, in place of the platform's own words. */
    emptyText?: string;
  }>(),
  {
    columns: undefined,
    statusField: undefined,
    tagsField: undefined,
    pageSize: 20,
    fallbackToFirst: false,
    toggleable: false,
    emptyText: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when the single viewing selection changes. */
  "update:selected": [value: ObjectListSelection | null];
  /** Emitted when the explicit multi-selection set changes. */
  "update:checked": [value: readonly ObjectListRef[]];
  /** Emitted when a reader clicks a reference cell carrying an owner-supplied object reference. */
  navigate: [reference: PlatformFieldReference, columnKey: string];
}>();

const { t, locale } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const member = useMember();
const objectType = projectionElement(slot.projection).id;

const datumName: "rows" | "objects" = "objects" in member.projection.data ? "objects" : "rows";
const datum = member.projection.data[datumName];
if (!datum) {
  throw new Error(`Projection ${member.projection.id} declares neither 'rows' nor 'objects' datum`);
}

const placement = panel.manifest.members[member.key]!;
const declaration = directReadDeclaration(member.projection, datum);
const signatureParams = declaration?.parameterMode === "fixed" ? declaration.params : {};

function isFixedLiteral(name: string): boolean {
  const mapped = datum!.params[name];
  if (mapped && "literal" in mapped) return true;
  const input = placement.inputs?.[name];
  return Boolean(input && "literal" in input);
}

function isAuthoredParam(name: string): boolean {
  return Boolean(authoredReadParameterSource(datum!.params, name, placement));
}

function paramNameOf(name: string): string {
  const mapped = datum!.params[name];
  return mapped && "input" in mapped ? mapped.input : name;
}

const canSearch = "search" in signatureParams && !isFixedLiteral("search");
const pageMode: "cursor" | "page" | "none" = "cursor" in signatureParams
  ? "cursor"
  : "page" in signatureParams
    ? "page"
    : "none";
const canCheck = Boolean(slotOutputState(panel.manifest, member.key, "checked"));
const effectivePageSize = computed(() => (props.pageSize > 0 ? props.pageSize : 20));

const searchParam = canSearch ? useMemberParam(paramNameOf("search")) : null;
const cursorParam = pageMode === "cursor" ? useMemberParam(paramNameOf("cursor")) : null;
const sizeParam = pageMode === "cursor" && "size" in signatureParams ? useMemberParam(paramNameOf("size")) : null;
const pageParam = pageMode === "page" ? useMemberParam(paramNameOf("page")) : null;
const selectedParam = useMemberParam("selected");
const checkedParam = useMemberParam("checked");

const currentPage = ref(1);
const cursorHistory = ref<(string | undefined)[]>([undefined]);

// Seed runtime pagination parameters before useMemberData starts its immediate watch, avoiding a double initial read.
if (pageMode === "cursor" && sizeParam && !isAuthoredParam("size")) {
  sizeParam.set(effectivePageSize.value);
}
if (pageMode === "page" && pageParam && !isAuthoredParam("page")) {
  pageParam.set({ number: 1, size: effectivePageSize.value });
}

function resetPaging() {
  if (currentPage.value !== 1) currentPage.value = 1;
  cursorHistory.value = [undefined];
  if (pageMode === "cursor" && cursorParam && !isAuthoredParam("cursor") && cursorParam.value.value !== null) {
    cursorParam.set(null);
  }
  if (pageMode === "page" && pageParam && !isAuthoredParam("page")) {
    const current = pageParam.value.value as { number?: number; size?: number } | null;
    if (!current || current.number !== 1 || current.size !== effectivePageSize.value) {
      pageParam.set({ number: 1, size: effectivePageSize.value });
    }
  }
}

const pagingParams = new Set(["cursor", "size", "page"]);
const nonPagingParamNames = [...new Set([...Object.keys(datum.params), ...Object.keys(signatureParams)])]
  .filter((name) => !pagingParams.has(name));

const currentParams = computed(() =>
  paramValues(member.projection, datum, placement, member.inputs.value, panel.instance.ownParams(member.key)),
);

const activeType = computed<string | null>(() => {
  if (datumName !== "objects") return objectType;
  const value = currentParams.value.type;
  return typeof value === "string" && value ? value : null;
});

// Synchronously clear local search and reset paging when switching dynamic type, so useMemberData issues one read.
if (datumName === "objects") {
  watch(
    activeType,
    (next, prev) => {
      if (next === prev) return;
      if (searchParam && !isAuthoredParam("search") && searchParam.value.value !== null) {
        searchParam.set(null);
      }
      resetPaging();
    },
    { flush: "sync" },
  );
}

// Synchronously reset to page 1 whenever search or any filter input changes, before useMemberData's pre-flush watch runs.
if (pageMode !== "none" && nonPagingParamNames.length > 0) {
  watch(
    () => JSON.stringify(nonPagingParamNames.map((name) => currentParams.value[name] ?? null)),
    () => resetPaging(),
    { flush: "sync" },
  );
}

const datumState = useMemberData(datumName);

const parsedData = computed<ParsedListData>(() => {
  if (datumState.value.status !== "ready") {
    return { rows: [], total: 0, hasTotal: false, diagnostics: [], status: "ok" };
  }
  const value = datumState.value.value;
  if (datumName === "objects") {
    const response = value as unknown as PlatformOntologyObjectsResponse;
    if (response.status !== "ok") {
      return {
        rows: [],
        total: 0,
        hasTotal: false,
        diagnostics: [],
        status: response.status,
        reason: response.reason,
      };
    }
    const items: PlatformObjectRecord[] = response.items.map((item) => {
      const fields: Record<string, string> = item.detail !== undefined ? { detail: item.detail } : {};
      return {
        primaryKey: item.node.primaryKey,
        className: item.node.className,
        label: item.label,
        ...(item.detail !== undefined ? { subtitle: item.detail } : {}),
        fields,
      };
    });
    return { rows: items, total: response.total, hasTotal: true, diagnostics: [], status: "ok" };
  }
  if (Array.isArray(value)) {
    const items = value as unknown as readonly PlatformObjectRecord[];
    return { rows: items, total: items.length, hasTotal: true, diagnostics: [], status: "ok" };
  }
  const queryResult = value as unknown as PanelRecordQuery;
  const items = queryResult.rows as unknown as readonly PlatformObjectRecord[];
  const hasTotal = queryResult.total !== undefined || (currentPage.value === 1 && queryResult.nextCursor === undefined);
  return {
    rows: items,
    total: queryResult.total ?? items.length,
    hasTotal,
    nextCursor: queryResult.nextCursor,
    diagnostics: queryResult.diagnostics ?? [],
    status: "ok",
  };
});

const rows = computed<readonly PlatformObjectRecord[]>(() => parsedData.value.rows);
const total = computed(() => parsedData.value.total);
const nextCursor = computed(() => parsedData.value.nextCursor);
const queryStatus = computed(() => parsedData.value.status);
const diagnostics = computed(() => parsedData.value.diagnostics);
const queryReason = computed(() => parsedData.value.reason);

function rowClassName(row: PlatformObjectRecord): string {
  return row.className ?? activeType.value ?? objectType;
}

function refKey(refValue: ObjectListRef): string {
  return `${refValue.className}\u0000${refValue.primaryKey}`;
}

function selectionIdentity(value: ObjectListSelection | null): string | null {
  if (!value) return null;
  if ("parent" in value) return `child\u0000${value.parent.objectType}\u0000${value.parent.primaryKey}\u0000${value.primaryKey}`;
  return refKey(value);
}

function rowSelectionValue(row: PlatformObjectRecord): ObjectListRef {
  return { className: rowClassName(row), primaryKey: row.primaryKey };
}

function rowIdentityKey(row: PlatformObjectRecord): string {
  return refKey(rowSelectionValue(row));
}

const chosenRef = computed<ObjectListSelection | null>(() => {
  const raw = selectedParam.value.value as PanelFieldValue;
  return stateChildObject(raw) ?? stateObject(raw);
});
const chosenIdentity = computed<string | null>(() => selectionIdentity(chosenRef.value));

const checkedRefs = computed<readonly ObjectListRef[]>(() =>
  stateObjects(checkedParam.value.value as PanelFieldValue),
);
const checkedIdentityKeys = computed(() => new Set(checkedRefs.value.map(refKey)));
const allVisibleChecked = computed(
  () => rows.value.length > 0 && rows.value.every((row) => checkedIdentityKeys.value.has(rowIdentityKey(row))),
);
const someVisibleChecked = computed(
  () => !allVisibleChecked.value && rows.value.some((row) => checkedIdentityKeys.value.has(rowIdentityKey(row))),
);

const searchText = computed<string>(() => {
  const raw = searchParam?.value.value;
  return typeof raw === "string" ? raw : "";
});

const isTable = computed(() => Boolean(props.columns?.length));

/** From this many characters a text column shrinks to the table's room and ends in an ellipsis rather than set its width. */
const LONG_TEXT = 24;
/** A column's text in a row, as the cell shows it. */
function columnText(row: PlatformObjectRecord, column: ObjectListColumn): string {
  return row.references?.[column.key]?.label ?? fieldValue(row, column.key);
}
/**
 * How a column is laid out, with no width of its own: one line at its own width by default, so a short value never
 * breaks; a text column whose values run long shrinks to the room left and ends in an ellipsis; a column the panel marks
 * `wrap` runs onto several lines. A table wider than its frame scrolls inside it.
 */
const columnFit = computed(() => new Map((props.columns ?? []).map((column) => [column.key,
  column.wrap ? "sdk-object-list-col-wrap"
    : (column.kind === undefined || column.kind === "text" || column.kind === "reference") && rows.value.some((row) => columnText(row, column).length > LONG_TEXT)
      ? "sdk-object-list-col-shrink" : ""])));
/**
 * A time column's owner value (an ISO time) as the platform shows a time, in the reader's language and time zone: a
 * recent one as how long ago, an older one by its date. A value that is no time is shown as it is.
 */
function timeText(value: string): string {
  return formatRelativeTime(value, { showYear: true }) || value;
}
/** The text a cell's title gives in full: a long text column's whole text, or a time column's whole local time. */
function cellTitle(row: PlatformObjectRecord, column: ObjectListColumn): string | undefined {
  if (column.kind === "time") {
    const value = fieldValue(row, column.key);
    return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString(locale.value) : undefined;
  }
  return columnFit.value.get(column.key) === "sdk-object-list-col-shrink" ? columnText(row, column) : undefined;
}
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / effectivePageSize.value)));

const showCount = computed(
  () =>
    (canSearch || pageMode !== "none")
    && datumState.value.status === "ready"
    && queryStatus.value === "ok"
    && parsedData.value.hasTotal,
);

const showToolbar = computed(() => canSearch || showCount.value);

const showPagination = computed(
  () =>
    pageMode !== "none"
    && datumState.value.status === "ready"
    && queryStatus.value === "ok"
    && ((parsedData.value.hasTotal && total.value > effectivePageSize.value)
      || currentPage.value > 1
      || nextCursor.value !== undefined),
);

const queryStatusLabel = computed(() => {
  if (queryStatus.value === "refused") return t("platform.graphStatusRefused");
  if (queryStatus.value === "failed") return t("platform.graphStatusFailed");
  if (queryStatus.value === "unavailable") return t("platform.graphStatusUnavailable");
  return "";
});

const listResult = computed<DataStateResult<readonly PlatformObjectRecord[]>>(() => {
  const state = datumState.value;
  if (state.status !== "ready") return state as DataStateResult<readonly PlatformObjectRecord[]>;
  if (rows.value.length === 0) return { status: "empty" };
  return { status: "ready", value: rows.value };
});

const dataStateLabels = useDataStateLabels(() => (props.emptyText ? panel.t(props.emptyText) : t("platform.dataEmpty")));

const ownerFieldLabels = computed<Readonly<Record<string, string>>>(() => rows.value[0]?.fieldLabels ?? {});

function columnLabel(column: ObjectListColumn): string {
  if (column.labelKey) return panel.t(column.labelKey);
  return ownerFieldLabels.value[column.key] ?? column.key;
}

function columnEmpty(column: ObjectListColumn): string {
  return column.emptyKey ? panel.t(column.emptyKey) : "—";
}

function setSelected(next: ObjectListSelection | null) {
  if (placement.outputs?.selected) {
    void panel.instance.output(member.key, "selected", next as RuntimeJsonValue);
  } else {
    selectedParam.set(next as RuntimeJsonValue);
  }
  emit("update:selected", next);
}

function setChecked(next: readonly ObjectListRef[]) {
  if (placement.outputs?.checked) {
    void panel.instance.output(member.key, "checked", next as unknown as RuntimeJsonValue);
  } else {
    checkedParam.set(next as unknown as RuntimeJsonValue);
  }
  emit("update:checked", next);
}

// Once selection is explicitly cleared to null (e.g. entering create mode), do not auto-reselect the first row.
let selectionCleared = false;
watch(
  chosenIdentity,
  (next, prev) => {
    if (next !== null) selectionCleared = false;
    else if (prev !== null) selectionCleared = true;
  },
  { flush: "sync" },
);

function applyFallback(listed: readonly PlatformObjectRecord[]) {
  if (!props.fallbackToFirst || selectionCleared) return;
  if (chosenIdentity.value && listed.some((row) => rowIdentityKey(row) === chosenIdentity.value)) return;
  if (listed.length > 0) {
    setSelected(rowSelectionValue(listed[0]!));
  } else if (chosenIdentity.value !== null) {
    setSelected(null);
    selectionCleared = false;
  }
}

watch(
  datumState,
  (state) => {
    if (state.status === "empty") {
      applyFallback([]);
      return;
    }
    if (state.status !== "ready" || parsedData.value.status !== "ok") return;
    const listed = rows.value;
    const byType = new Map<string, { primaryKey: string; label: string }[]>();
    for (const item of listed) {
      const itemType = rowClassName(item);
      let bucket = byType.get(itemType);
      if (!bucket) {
        bucket = [];
        byType.set(itemType, bucket);
      }
      bucket.push(item);
    }
    for (const [itemType, items] of byType) panel.instance.nameObjects(itemType, items);
    applyFallback(listed);
  },
  { immediate: true },
);

function onSearchInput(event: Event) {
  if (!searchParam) return;
  const next = (event.target as HTMLInputElement).value;
  searchParam.set(next === "" ? null : next);
}

function goPage(nextPage: number) {
  if (nextPage < 1 || nextPage === currentPage.value) return;
  if (pageMode === "cursor" && cursorParam) {
    if (nextPage > currentPage.value) {
      if (nextCursor.value === undefined) return;
      cursorHistory.value[nextPage - 1] = nextCursor.value;
      currentPage.value = nextPage;
      cursorParam.set(nextCursor.value);
    } else {
      currentPage.value = nextPage;
      cursorParam.set(cursorHistory.value[nextPage - 1] ?? null);
    }
    return;
  }
  if (pageMode === "page" && pageParam) {
    if (parsedData.value.hasTotal && nextPage > totalPages.value) return;
    currentPage.value = nextPage;
    pageParam.set({ number: nextPage, size: effectivePageSize.value });
  }
}

function choose(row: PlatformObjectRecord) {
  const identity = rowIdentityKey(row);
  const next = props.toggleable && chosenIdentity.value === identity
    ? null
    : rowSelectionValue(row);
  setSelected(next);
}

function toggleChecked(row: PlatformObjectRecord, checked: boolean) {
  const identity = rowIdentityKey(row);
  if (checked) {
    if (checkedIdentityKeys.value.has(identity)) return;
    setChecked([...checkedRefs.value, rowSelectionValue(row)]);
  } else {
    setChecked(checkedRefs.value.filter((item) => refKey(item) !== identity));
  }
}

function toggleAllVisible(checked: boolean) {
  const visibleKeys = new Set(rows.value.map(rowIdentityKey));
  if (checked) {
    const added = rows.value
      .filter((row) => !checkedIdentityKeys.value.has(rowIdentityKey(row)))
      .map(rowSelectionValue);
    setChecked([...checkedRefs.value, ...added]);
  } else {
    setChecked(checkedRefs.value.filter((item) => !visibleKeys.has(refKey(item))));
  }
}

function clearChecked() {
  setChecked([]);
}

function navigateTo(reference: PlatformFieldReference, columnKey: string) {
  const output = placement.outputs?.[columnKey] ? columnKey : "navigate";
  void panel.instance.output(member.key, output, { className: reference.className, primaryKey: reference.primaryKey });
  emit("navigate", reference, columnKey);
}

/** The field each compact item's summary line shows: the one configured, else the owner's own subtitle. */
const summaryKey = computed(() => props.subtitleField ?? "subtitle");

function fieldValue(row: PlatformObjectRecord, key: string): string {
  if (key === "label") return row.label;
  if (key === "subtitle") return row.subtitle ?? "";
  return row.fields[key] ?? "";
}

function cellSegments(row: PlatformObjectRecord, key: string, empty = "—") {
  const text = fieldValue(row, key);
  if (!text) return [{ text: empty, hit: false }];
  return textHighlightSegments(text, row.highlights?.[key]);
}

function selectAllCheckboxRef(element: unknown) {
  if (element instanceof HTMLInputElement) element.indeterminate = someVisibleChecked.value;
}

watch(someVisibleChecked, () => {
  // Keeps indeterminate synced through the function ref above on reactive updates.
});
</script>

<template>
  <div class="sdk-object-list">
    <div v-if="showToolbar" class="sdk-object-list-toolbar">
      <input
        v-if="canSearch"
        type="search"
        class="sdk-object-list-search"
        :value="searchText"
        :placeholder="t('platform.listSearchPlaceholder')"
        :aria-label="t('platform.listSearchPlaceholder')"
        @input="onSearchInput"
      />
      <span v-if="showCount" class="sdk-object-list-count" role="status">
        {{ t("platform.listTotal", { count: total }) }}
      </span>
      <slot name="toolbar-actions"></slot>
    </div>

    <div v-if="canCheck && (!isTable || checkedRefs.length > 0)" class="sdk-object-list-selection-bar">
      <label v-if="!isTable" class="sdk-object-list-select-all">
        <input
          :ref="selectAllCheckboxRef"
          type="checkbox"
          :checked="allVisibleChecked"
          :indeterminate.prop="someVisibleChecked"
          :disabled="!rows.length"
          @change="toggleAllVisible(($event.target as HTMLInputElement).checked)"
        />
        <span>{{ t("platform.listSelectAll") }}</span>
      </label>
      <span v-if="checkedRefs.length" class="sdk-object-list-selected-count" role="status">
        {{ t("platform.listSelectedCount", { count: checkedRefs.length }) }}
      </span>
      <div v-if="checkedRefs.length" class="sdk-object-list-batch-actions" role="group">
        <slot name="batch-actions" :checked="checkedRefs" :clear="clearChecked"></slot>
        <button type="button" class="sdk-object-list-link-btn" @click="clearChecked">
          {{ t("platform.listClearSelection") }}
        </button>
      </div>
    </div>

    <ul v-if="diagnostics.length" class="sdk-object-list-diagnostics" role="status">
      <li v-for="note in diagnostics" :key="note">{{ note }}</li>
    </ul>
    <p
      v-if="datumState.status === 'ready' && queryStatus !== 'ok'"
      class="sdk-object-list-status"
      :data-status="queryStatus"
      :role="queryStatus === 'failed' ? 'alert' : 'status'"
    >
      <span class="sdk-object-list-status-label">{{ queryStatusLabel }}</span>
      <span v-if="queryReason" class="sdk-object-list-status-reason">{{ queryReason }}</span>
    </p>
    <data-state v-else :result="listResult" :labels="dataStateLabels">
      <div v-if="isTable" class="sdk-object-list-table-wrap">
        <table class="sdk-object-list-table">
          <thead>
            <tr>
              <th v-if="canCheck" class="sdk-object-list-check-col">
                <input
                  :ref="selectAllCheckboxRef"
                  type="checkbox"
                  :aria-label="t('platform.listSelectAll')"
                  :checked="allVisibleChecked"
                  :indeterminate.prop="someVisibleChecked"
                  :disabled="!rows.length"
                  @change="toggleAllVisible(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th v-for="column in columns" :key="column.key" :class="columnFit.get(column.key)">{{ columnLabel(column) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="rowIdentityKey(row)"
              :aria-selected="rowIdentityKey(row) === chosenIdentity"
              :class="{ chosen: rowIdentityKey(row) === chosenIdentity }"
              @click="choose(row)"
            >
              <td v-if="canCheck" class="sdk-object-list-check-col" @click.stop>
                <input
                  type="checkbox"
                  :aria-label="row.label"
                  :checked="checkedIdentityKeys.has(rowIdentityKey(row))"
                  @change="toggleChecked(row, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td
                v-for="column in columns"
                :key="column.key"
                :class="columnFit.get(column.key)"
                :title="cellTitle(row, column)"
              >
                <button
                  v-if="(column.kind === 'reference' || row.references?.[column.key]) && row.references?.[column.key]"
                  type="button"
                  class="sdk-object-ref-link"
                  @click.stop="navigateTo(row.references[column.key]!, column.key)"
                >
                  <template v-for="(part, index) in textHighlightSegments(row.references[column.key]!.label, row.highlights?.[column.key])" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </button>
                <span
                  v-else-if="column.kind === 'tag' && fieldValue(row, column.key)"
                  class="sdk-object-list-tag"
                  :data-tone="row.tones?.[column.key] ?? 'default'"
                >
                  <template v-for="(part, index) in cellSegments(row, column.key, columnEmpty(column))" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </span>
                <template v-else-if="column.kind === 'time'">{{ fieldValue(row, column.key) ? timeText(fieldValue(row, column.key)) : columnEmpty(column) }}</template>
                <span v-else-if="column.kind === 'tags'" class="sdk-object-list-item-tags">
                  <span
                    v-for="tag in row.tags?.[column.key] ?? []"
                    :key="tag"
                    class="sdk-object-list-tag"
                    data-tone="info"
                  >{{ tag }}</span>
                  <template v-if="!(row.tags?.[column.key]?.length)">{{ columnEmpty(column) }}</template>
                </span>
                <div v-else class="sdk-object-list-cell">
                  <span class="sdk-object-list-cell-main">
                    <template v-for="(part, index) in cellSegments(row, column.key, columnEmpty(column))" :key="index">
                      <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                  <span v-if="column.subtitleKey && fieldValue(row, column.subtitleKey)" class="sdk-object-list-cell-sub">
                    <template v-for="(part, index) in cellSegments(row, column.subtitleKey, '')" :key="index">
                      <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ul v-else role="listbox" class="sdk-object-list-items">
        <li
          v-for="row in rows"
          :key="rowIdentityKey(row)"
          class="sdk-object-list-row"
          :class="{ chosen: rowIdentityKey(row) === chosenIdentity }"
        >
          <input
            v-if="canCheck"
            type="checkbox"
            class="sdk-object-list-row-check"
            :aria-label="row.label"
            :checked="checkedIdentityKeys.has(rowIdentityKey(row))"
            @change="toggleChecked(row, ($event.target as HTMLInputElement).checked)"
          />
          <button
            type="button"
            role="option"
            class="sdk-object-list-item-btn"
            :aria-selected="rowIdentityKey(row) === chosenIdentity"
            :class="{ chosen: rowIdentityKey(row) === chosenIdentity }"
            @click="choose(row)"
          >
            <span class="sdk-object-list-item-head">
              <span class="sdk-object-list-item-label">
                <template v-for="(part, index) in textHighlightSegments(row.label, row.highlights?.label)" :key="index">
                  <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span
                v-if="statusField && row.fields[statusField]"
                class="sdk-object-list-tag"
                :data-tone="row.tones?.[statusField] ?? 'default'"
              >{{ row.fields[statusField] }}</span>
            </span>
            <span
              v-if="fieldValue(row, summaryKey)"
              class="sdk-object-list-item-sub"
              :class="{ 'sdk-object-list-item-sub-clamped': subtitleLines !== undefined }"
              :style="{ WebkitLineClamp: subtitleLines }"
            >
              <template v-for="(part, index) in textHighlightSegments(fieldValue(row, summaryKey), row.highlights?.[summaryKey])" :key="index">
                <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
              </template>
            </span>
            <span v-if="tagsField && row.tags?.[tagsField]?.length" class="sdk-object-list-item-tags">
              <span
                v-for="tag in row.tags[tagsField]"
                :key="tag"
                class="sdk-object-list-tag"
                data-tone="info"
              >{{ tag }}</span>
            </span>
          </button>
        </li>
      </ul>
    </data-state>

    <nav v-if="showPagination" class="sdk-object-list-pagination">
      <button
        type="button"
        class="sdk-object-list-btn sdk-object-list-prev"
        :disabled="currentPage <= 1"
        @click="goPage(currentPage - 1)"
      >
        {{ t("platform.listPrevPage") }}
      </button>
      <span class="sdk-object-list-page-info">
        {{ parsedData.hasTotal ? t("platform.listPagination", { page: currentPage, pages: totalPages }) : currentPage }}
      </span>
      <button
        type="button"
        class="sdk-object-list-btn sdk-object-list-next"
        :disabled="nextCursor === undefined && (!parsedData.hasTotal || currentPage >= totalPages)"
        @click="goPage(currentPage + 1)"
      >
        {{ t("platform.listNextPage") }}
      </button>
    </nav>
  </div>
</template>

<style scoped>
/* The platform's design roles only (DESIGN.md): neutral fills for hover and selection, link colour for links, the
   shared spacing, type, radius and control scales. No value is written here. */
.sdk-object-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}
.sdk-object-list-toolbar {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.sdk-object-list-search {
  background: var(--el-bg-color);
  border: 0;
  border-radius: var(--radius-sm);
  box-shadow: 0 0 0 1px var(--ui-divider) inset;
  box-sizing: border-box;
  color: var(--el-text-color-primary);
  flex: 1 1 160px;
  font-size: var(--text-sm);
  height: var(--control-height);
  min-width: 120px;
  padding: 0 var(--spacing-md);
  transition: box-shadow var(--transition-fast);
}
.sdk-object-list-search::placeholder {
  color: var(--el-text-color-placeholder);
}
.sdk-object-list-search:hover {
  box-shadow: 0 0 0 1px var(--ui-border) inset;
}
.sdk-object-list-search:focus-visible {
  box-shadow: 0 0 0 1px var(--brand-link) inset, var(--focus-ring);
  outline: none;
}
/* Paging is a secondary command: neutral outline, quiet fill on hover and press. */
.sdk-object-list-btn {
  background: transparent;
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-md);
  color: var(--el-text-color-primary);
  cursor: pointer;
  font-size: var(--text-sm);
  height: var(--control-height-sm);
  padding: 0 var(--spacing-md);
  transition: background-color var(--transition-fast);
}
.sdk-object-list-btn:hover:not(:disabled) {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-btn:active:not(:disabled) {
  background: var(--ui-fill-quaternary);
}
.sdk-object-list-btn:disabled {
  color: var(--el-disabled-text-color);
  cursor: not-allowed;
}
.sdk-object-list-count,
.sdk-object-list-selected-count,
.sdk-object-list-page-info {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.sdk-object-list-selection-bar {
  align-items: center;
  border-bottom: 1px solid var(--ui-divider);
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) 0 var(--spacing-sm);
}
.sdk-object-list-select-all {
  align-items: center;
  cursor: pointer;
  display: inline-flex;
  font-size: var(--text-xs);
  gap: var(--spacing-xs);
}
.sdk-object-list-batch-actions {
  align-items: center;
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  margin-left: auto;
}
.sdk-object-list-link-btn,
.sdk-object-ref-link {
  background: none;
  border: 0;
  color: var(--brand-link);
  cursor: pointer;
  font-size: inherit;
  padding: 0;
  text-align: left;
}
.sdk-object-list-link-btn:hover,
.sdk-object-ref-link:hover {
  text-decoration: underline;
}
.sdk-object-list-table-wrap {
  overflow-x: auto;
}
.sdk-object-list-table {
  border-collapse: collapse;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  width: 100%;
}
.sdk-object-list-table th,
.sdk-object-list-table td {
  border-bottom: 1px solid var(--ui-divider);
  padding: var(--spacing-sm) var(--spacing-md);
  text-align: left;
  vertical-align: middle;
  /* A value stays on its line: a short column is as wide as its text, never two characters over two lines. */
  white-space: nowrap;
}
/* A long text column takes the room the others leave, down to a readable minimum, and ends in an ellipsis. */
.sdk-object-list-table .sdk-object-list-col-shrink {
  width: 100%;
  max-width: 0;
  min-width: 12em;
}
.sdk-object-list-col-shrink :is(.sdk-object-list-cell-main, .sdk-object-list-cell-sub, .sdk-object-ref-link) {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sdk-object-list-table .sdk-object-list-col-wrap {
  white-space: normal;
  min-width: 12em;
}
.sdk-object-list-table th {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  height: var(--table-head-height);
}
.sdk-object-list-table td {
  height: var(--table-row-height);
}
.sdk-object-list-table tbody tr {
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.sdk-object-list-table tbody tr:hover {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-table tbody tr.chosen {
  background: var(--ui-fill-secondary);
}
.sdk-object-list-check-col {
  width: var(--control-height);
}
.sdk-object-list-cell {
  display: flex;
  flex-direction: column;
  gap: calc(var(--spacing-xs) / 2);
}
.sdk-object-list-cell-sub,
.sdk-object-list-item-sub {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.sdk-object-list-item-sub-clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: var(--leading-xs);
}
.sdk-object-list-items {
  display: flex;
  flex-direction: column;
  gap: calc(var(--spacing-xs) / 2);
  list-style: none;
  margin: 0;
  padding: 0;
}
.sdk-object-list-row {
  align-items: flex-start;
  display: flex;
  gap: var(--spacing-xs);
}
.sdk-object-list-row-check {
  margin-top: var(--spacing-sm);
}
.sdk-object-list-item-btn {
  background: none;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--el-text-color-primary);
  cursor: pointer;
  display: flex;
  flex: 1;
  flex-direction: column;
  font-size: var(--text-sm);
  gap: var(--spacing-xs);
  padding: var(--spacing-xs) var(--spacing-sm);
  text-align: left;
  transition: background-color var(--transition-fast);
  width: 100%;
}
.sdk-object-list-item-btn:hover {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-item-btn.chosen {
  background: var(--ui-fill-secondary);
  font-weight: var(--font-medium);
}
.sdk-object-list-item-head {
  align-items: center;
  display: flex;
  gap: var(--spacing-sm);
  justify-content: space-between;
  width: 100%;
}
.sdk-object-list-item-tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}
/* Tags are light fills: neutral, or a status's soft fill with its readable text colour. */
.sdk-object-list-tag {
  background: var(--ui-fill-tertiary);
  border-radius: var(--radius-xs);
  color: var(--el-text-color-regular);
  display: inline-block;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  padding: 0 var(--spacing-xs);
  white-space: nowrap;
}
.sdk-object-list-tag[data-tone="info"] {
  background: var(--el-color-info-light-9);
  color: var(--el-color-info-text);
}
.sdk-object-list-tag[data-tone="success"] {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-text);
}
.sdk-object-list-tag[data-tone="warning"] {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-text);
}
.sdk-object-list-tag[data-tone="danger"] {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-text);
}
.sdk-object-list-pagination {
  align-items: center;
  display: flex;
  gap: var(--spacing-sm);
  justify-content: flex-end;
  padding-top: var(--spacing-xs);
}
.sdk-object-list-diagnostics {
  color: var(--el-color-warning-text);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  list-style: none;
  margin: 0;
  padding: 0 var(--spacing-xs);
}
.sdk-object-list-status {
  align-items: center;
  color: var(--el-text-color-secondary);
  display: flex;
  flex-wrap: wrap;
  font-size: var(--text-xs);
  gap: var(--spacing-xs);
  margin: 0;
  padding: var(--spacing-md) var(--spacing-xs);
}
.sdk-object-list-status[data-status="refused"] {
  color: var(--el-color-warning-text);
}
.sdk-object-list-status[data-status="failed"] {
  color: var(--el-color-danger-text);
}
.sdk-object-list-status-reason {
  color: var(--el-text-color-secondary);
}
mark {
  background: var(--el-color-warning-light-7);
  border-radius: var(--radius-xs);
  color: inherit;
  padding: 0 calc(var(--spacing-xs) / 4);
}
</style>
