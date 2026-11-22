<script setup lang="ts">
import { Comment, Fragment, Text, computed, nextTick, ref, useSlots, watch, type VNode } from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelChildObjectIdentity } from "@ontomato/contracts/panel-manifest";
import {
  authoredReadParameterSource,
  directReadDeclaration,
  panelRecordObjectRef,
  type PanelRecordQuery,
  type PanelRecordReferenceFieldValue,
} from "@ontomato/contracts/panel-projection";
import type { PlatformOntologyObjectsResponse } from "@ontomato/contracts/platform-ontology";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { formatListTime } from "@ontomato/workbench-ui/utils/relative-time";
import { slotOutputState, usePanelContext, useProjectionSlot } from "../panel/context";
import { paramValues, readParams } from "../panel/direct";
import { useMember, useMemberData, useMemberParam } from "../panel/member";
import type {
  PlatformFieldReference,
  PlatformGraphStatus,
  PlatformObjectRecord,
} from "../panel/platform-objects";
import { projectionElement } from "../panel/projection-element";
import { listColumnMembersFor, listRowDetailMemberFor } from "../panel/row-member";
import { stateChildObject, stateObject, stateObjects, type PanelFieldValue } from "../panel/state";
import ListRowMember from "./ListRowMember.vue";
import type { ObjectListColumn, ObjectListRef } from "./object-list-types";
import {
  displayFieldText,
  isRecordReference,
  rawRecordField,
  recordFieldArrayItems,
  referenceDisplayLabel,
  scalarFieldText,
  toFieldReference,
} from "./record-field";
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
     * How records are arranged: `"auto"` (default) draws a table when `columns` is given and a compact list otherwise;
     * `"list"` forces the compact list, `"table"` draws the table when `columns` is given, and `"cards"` draws a
     * responsive card grid showing label, subtitle, status, tags and any configured `columns`.
     */
    layout?: "auto" | "list" | "table" | "cards";
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
     * Automatically selects the first listed item only in two cases (and never while a draft is active):
     * (a) on first showing when nothing is selected yet, and
     * (b) after the reader changes search or filter parameters and the previously selected item is no longer listed
     *     (selecting the first new match, or clearing selection to null when no items match).
     * Clearing selection elsewhere (entering or cancelling create, closing detail, manual deselect, or subsequent
     * refreshes while nothing is selected) is never overridden.
     */
    fallbackToFirst?: boolean;
    /** Whether clicking the selected item again clears the selection; off, a click always selects. */
    toggleable?: boolean;
    /** The panel's message key for what an empty list says, in place of the platform's own words. */
    emptyText?: string;
    /** Optional panel message key for a secondary hint shown beneath the empty message (e.g. pointing to header create). */
    emptyHint?: string;
    /** Controls visibility of the top `#create-row` inline form block; omitted, shown whenever `#create-row` has content. */
    creatingRow?: boolean;
  }>(),
  {
    layout: "auto",
    columns: undefined,
    statusField: undefined,
    tagsField: undefined,
    pageSize: 20,
    fallbackToFirst: false,
    toggleable: false,
    emptyText: undefined,
    emptyHint: undefined,
    creatingRow: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when the single viewing selection changes. */
  "update:selected": [value: ObjectListSelection | null];
  /** Emitted when the explicit multi-selection set changes. */
  "update:checked": [value: readonly ObjectListRef[]];
  /**
   * Emitted when the object references of the current result batch change: the current page when the owner's read
   * pages (`cursor` or `page`), or all matching rows when the read does not page; empty when no rows are shown.
   */
  "update:listed": [value: readonly ObjectListRef[]];
  /** Emitted when a reader clicks a reference cell carrying an owner-supplied object reference. */
  navigate: [reference: PlatformFieldReference, columnKey: string];
  /** Emitted when the reader clicks Clear filters from the narrowed empty state. */
  "clear-filters": [];
}>();

const slots = useSlots();

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
const requiredParamNames = new Set(declaration?.parameterMode === "fixed" ? (declaration.requiredParams ?? []) : []);

function isFixedLiteral(name: string): boolean {
  const mapped = datum!.params[name];
  if (mapped && "literal" in mapped) return true;
  const input = placement.inputs?.[name];
  return Boolean(input && "literal" in input);
}

function isWritableParam(name: string): boolean {
  if (isFixedLiteral(name)) return false;
  const key = paramNameOf(name);
  const input = placement.inputs?.[key];
  return !input || "state" in input;
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
interface CursorBatch {
  readonly cursor: string | null;
  readonly rows: readonly PlatformObjectRecord[];
}
const cursorBatches = ref<readonly CursorBatch[]>([]);
const loadingMore = ref(false);
let pendingAppendCursor: string | null = null;
const lastKnownTotal = ref(0);
const lastKnownHasTotal = ref(false);

// Seed runtime pagination parameters before useMemberData starts its immediate watch, avoiding a double initial read.
if (pageMode === "cursor" && sizeParam && !isAuthoredParam("size")) {
  sizeParam.set(effectivePageSize.value);
}
if (pageMode === "page" && pageParam && !isAuthoredParam("page")) {
  pageParam.set({ number: 1, size: effectivePageSize.value });
}

function resetPaging() {
  if (currentPage.value !== 1) currentPage.value = 1;
  cursorBatches.value = [];
  loadingMore.value = false;
  pendingAppendCursor = null;
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
const clearableFilterParams = nonPagingParamNames
  .filter((name) => name !== "search" && !requiredParamNames.has(name) && isWritableParam(name))
  .map((name) => useMemberParam(paramNameOf(name)));

const currentParams = computed(() =>
  paramValues(member.projection, datum, placement, member.inputs.value, panel.instance.ownParams(member.key)),
);
const hostRuntimeParams = computed<Readonly<Record<string, RuntimeJsonValue>>>(() =>
  readParams(member.projection, datum, placement, member.inputs.value, panel.instance.ownParams(member.key)).runtime,
);
const listColumnMembers = computed(() => listColumnMembersFor(panel.manifest, member.key));
const rowDetailMember = computed(() => listRowDetailMemberFor(panel.manifest, member.key));
function listColumnMember(columnKey: string): string | null {
  return listColumnMembers.value.get(columnKey) ?? null;
}
const tableColumnCount = computed(
  () => (rowDetailMember.value ? 1 : 0) + (canCheck ? 1 : 0) + (props.columns?.length ?? 0),
);
const scrollContainerRef = ref<HTMLElement | null>(null);
const expandedKey = ref<string | null>(null);
const detailElements = new Map<string, HTMLElement>();
function setDetailElement(key: string, element: unknown) {
  if (element instanceof HTMLElement) detailElements.set(key, element);
  else detailElements.delete(key);
}
function isRowExpanded(row: PlatformObjectRecord): boolean {
  return expandedKey.value === rowIdentityKey(row);
}
function toggleRowExpanded(row: PlatformObjectRecord) {
  const key = rowIdentityKey(row);
  expandedKey.value = expandedKey.value === key ? null : key;
}
function rowExpandAriaLabel(row: PlatformObjectRecord): string {
  const label = row.label || row.primaryKey;
  return isRowExpanded(row)
    ? t("platform.listCollapseRow", { label })
    : t("platform.listExpandRow", { label });
}

const activeType = computed<string | null>(() => {
  if (datumName !== "objects") return objectType;
  const value = currentParams.value.type;
  return typeof value === "string" && value ? value : null;
});

const filterSignature = computed(() =>
  JSON.stringify(nonPagingParamNames.map((name) => currentParams.value[name] ?? null)),
);
let initialLoadDone = false;
let pendingFilterFallback = false;
let pendingScrollToTop = false;

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

// Synchronously arm filter-change fallback and reset paging whenever search or any filter input changes,
// before useMemberData's pre-flush watch runs.
if (nonPagingParamNames.length > 0) {
  watch(
    filterSignature,
    (next, prev) => {
      if (next === prev) return;
      if (initialLoadDone) pendingFilterFallback = true;
      if (pageMode !== "none") resetPaging();
    },
    { flush: "sync" },
  );
}

if (pageMode === "page") {
  watch(
    () => JSON.stringify(currentParams.value.page ?? null),
    (next, prev) => {
      if (next === prev || !initialLoadDone) return;
      pendingScrollToTop = true;
    },
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
    return { rows: items, total: items.length, hasTotal: canSearch || pageMode !== "none", diagnostics: [], status: "ok" };
  }
  const queryResult = value as unknown as PanelRecordQuery;
  const items = queryResult.rows as unknown as readonly PlatformObjectRecord[];
  const hasTotal = queryResult.total !== undefined
    || ((canSearch || pageMode !== "none") && currentPage.value === 1 && queryResult.nextCursor === undefined);
  return {
    rows: items,
    total: queryResult.total ?? items.length,
    hasTotal,
    nextCursor: queryResult.nextCursor,
    diagnostics: queryResult.diagnostics ?? [],
    status: "ok",
  };
});

// Keep accumulated cursor batches synced synchronously with datumState so `rows`, `listResult` and `listed` stay consistent.
watch(
  datumState,
  (state) => {
    if (state.status === "loading") return;
    if (state.status !== "ready" || parsedData.value.status !== "ok") {
      cursorBatches.value = [];
      loadingMore.value = false;
      pendingAppendCursor = null;
      return;
    }
    lastKnownTotal.value = parsedData.value.total;
    lastKnownHasTotal.value = parsedData.value.hasTotal;
    if (pageMode !== "cursor") return;
    const activeCursor = typeof currentParams.value.cursor === "string" ? currentParams.value.cursor : null;
    const incoming = parsedData.value.rows;
    if (activeCursor === null) {
      cursorBatches.value = [{ cursor: null, rows: incoming }];
    } else if (pendingAppendCursor === activeCursor) {
      const existingIndex = cursorBatches.value.findIndex((batch) => batch.cursor === activeCursor);
      cursorBatches.value = existingIndex >= 0
        ? cursorBatches.value.map((batch, index) => (index === existingIndex ? { cursor: activeCursor, rows: incoming } : batch))
        : [...cursorBatches.value, { cursor: activeCursor, rows: incoming }];
    } else {
      const existingIndex = cursorBatches.value.findIndex((batch) => batch.cursor === activeCursor);
      cursorBatches.value = existingIndex >= 0
        ? cursorBatches.value.map((batch, index) => (index === existingIndex ? { cursor: activeCursor, rows: incoming } : batch))
        : [{ cursor: activeCursor, rows: incoming }];
    }
    loadingMore.value = false;
    pendingAppendCursor = null;
  },
  { immediate: true, flush: "sync" },
);

const rows = computed<readonly PlatformObjectRecord[]>(() => {
  if (pageMode === "cursor" && cursorBatches.value.length > 0) {
    const seen = new Set<string>();
    const merged: PlatformObjectRecord[] = [];
    for (const batch of cursorBatches.value) {
      for (const row of batch.rows) {
        const key = rowIdentityKey(row);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }
    }
    return merged;
  }
  return parsedData.value.rows;
});
const total = computed(() => parsedData.value.total);
const nextCursor = computed(() => parsedData.value.nextCursor);
const queryStatus = computed(() => parsedData.value.status);
const diagnostics = computed(() => parsedData.value.diagnostics);
const queryReason = computed(() => parsedData.value.reason);

function rowSelectionValue(row: PlatformObjectRecord): ObjectListRef {
  return panelRecordObjectRef(row, activeType.value ?? objectType);
}

function rowClassName(row: PlatformObjectRecord): string {
  return rowSelectionValue(row).className;
}

function refKey(refValue: ObjectListRef): string {
  return `${refValue.className}\u0000${refValue.primaryKey}`;
}

function selectionIdentity(value: ObjectListSelection | null): string | null {
  if (!value) return null;
  if ("parent" in value) return `child\u0000${value.parent.objectType}\u0000${value.parent.primaryKey}\u0000${value.primaryKey}`;
  return refKey(value);
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

const effectiveLayout = computed<"list" | "table" | "cards">(() => {
  if (props.layout === "cards") return "cards";
  if (props.layout === "list") return "list";
  return props.columns?.length ? "table" : "list";
});
const isTable = computed(() => effectiveLayout.value === "table");
const isCards = computed(() => effectiveLayout.value === "cards");

/** From this many characters a text column shrinks to the table's room and ends in an ellipsis rather than set its width. */
const LONG_TEXT = 24;
/** A column's text in a row, as the cell shows it. */
function columnText(row: PlatformObjectRecord, column: ObjectListColumn): string {
  return fieldValue(row, column.key);
}
/**
 * How a column is laid out, with no width of its own: one line at its own width by default, so a short value never
 * breaks; a text column whose values run long shrinks to the room left and ends in an ellipsis; a column the panel marks
 * `wrap` runs onto several lines. A table wider than its frame scrolls inside it.
 */
const columnFit = computed(() => new Map((props.columns ?? []).map((column) => [column.key,
  listColumnMembers.value.has(column.key) ? (column.wrap ? "sdk-object-list-col-wrap" : "")
    : column.wrap ? "sdk-object-list-col-wrap"
      : (column.kind === undefined || column.kind === "text" || column.kind === "reference") && rows.value.some((row) => columnText(row, column).length > LONG_TEXT)
        ? "sdk-object-list-col-shrink" : ""])));
/**
 * Format a time column's ISO value in the reader's locale and time zone: relative by default (`formatListTime`), or
 * full local date-time (`datetime`) / local date (`date`). A value that is no time is shown as it is.
 */
function timeText(value: string, timeFormat?: ObjectListColumn["timeFormat"]): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  if (timeFormat === "datetime") {
    return parsed.toLocaleString(locale.value, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  if (timeFormat === "date") {
    return parsed.toLocaleDateString(locale.value, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return formatListTime(value) || value;
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

type PaginationItem = number | "ellipsis";

const showNumericPages = computed(() => pageMode === "page" && parsedData.value.hasTotal);

const paginationItems = computed<readonly PaginationItem[]>(() => {
  const pages = totalPages.value;
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const current = currentPage.value;
  const items: PaginationItem[] = [1];
  const windowStart = Math.max(2, current - 1);
  const windowEnd = Math.min(pages - 1, current + 1);
  if (windowStart > 2) items.push("ellipsis");
  for (let page = windowStart; page <= windowEnd; page += 1) items.push(page);
  if (windowEnd < pages - 1) items.push("ellipsis");
  items.push(pages);
  return items;
});

const footerReady = computed(
  () =>
    (datumState.value.status === "ready" && queryStatus.value === "ok" && rows.value.length > 0)
    || (loadingMore.value && rows.value.length > 0),
);
const footerHasTotal = computed(() => (loadingMore.value ? lastKnownHasTotal.value : parsedData.value.hasTotal));
const footerTotal = computed(() => (loadingMore.value ? lastKnownTotal.value : total.value));
const showFooterTotal = computed(() => footerReady.value && footerHasTotal.value);

const showPageControls = computed(
  () =>
    pageMode === "page"
    && footerReady.value
    && ((footerHasTotal.value && footerTotal.value > effectivePageSize.value) || currentPage.value > 1),
);

const showLoadMore = computed(
  () =>
    pageMode === "cursor"
    && footerReady.value
    && (loadingMore.value || nextCursor.value !== undefined || currentPage.value > 1),
);

const showFooter = computed(() => showFooterTotal.value || showPageControls.value || showLoadMore.value);

const showToolbar = computed(
  () =>
    canSearch
    || Boolean(slots.filters)
    || Boolean(slots["toolbar-actions"])
    || (canCheck && (!isTable.value || checkedRefs.value.length > 0)),
);

function hasRenderableVNodes(vnodes: readonly VNode[]): boolean {
  return vnodes.some((node) => {
    if (node.type === Comment) return false;
    if (node.type === Text) return String(node.children ?? "").trim() !== "";
    if (node.type === Fragment) {
      return Array.isArray(node.children) && hasRenderableVNodes(node.children as VNode[]);
    }
    return true;
  });
}

const showCreateRow = computed(() => {
  if (props.creatingRow === false) return false;
  const createSlot = slots["create-row"];
  if (!createSlot) return false;
  if (props.creatingRow === true) return true;
  return hasRenderableVNodes(createSlot());
});

const queryStatusLabel = computed(() => {
  if (queryStatus.value === "refused") return t("platform.graphStatusRefused");
  if (queryStatus.value === "failed") return t("platform.graphStatusFailed");
  if (queryStatus.value === "unavailable") return t("platform.graphStatusUnavailable");
  return "";
});

/**
 * Whether the reader narrowed the read: their search, or a value the panel's state gives one of its other optional
 * filter parameters (a status filter, a category). An empty answer to a narrowed read says nothing matches and offers
 * Clear filters, rather than saying there is nothing at all.
 */
const narrowed = computed(() => searchText.value !== "" || nonPagingParamNames.some((name) => {
  if (name === "search" || isFixedLiteral(name) || requiredParamNames.has(name)) return false;
  const value = currentParams.value[name];
  return value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
}));

function clearFilters() {
  if (searchParam && isWritableParam("search") && searchParam.value.value !== null) {
    searchParam.set(null);
  }
  for (const param of clearableFilterParams) {
    const value = param.value.value;
    if (value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)) {
      param.set(null);
    }
  }
  resetPaging();
  emit("clear-filters");
}

const resolvedEmptyHint = computed(() => (props.emptyHint ? panel.t(props.emptyHint) : ""));

const listResult = computed<DataStateResult<readonly PlatformObjectRecord[]>>(() => {
  if (loadingMore.value && rows.value.length > 0) {
    return { status: "ready", value: rows.value };
  }
  const state = datumState.value;
  const empty = state.status === "empty" || (state.status === "ready" && rows.value.length === 0);
  if (empty) {
    return narrowed.value
      ? { status: "empty", narrowed: true, clearFilters }
      : { status: "empty", ...(resolvedEmptyHint.value ? { emptyHint: resolvedEmptyHint.value } : {}) };
  }
  if (state.status === "forbidden") {
    const reason = (state as { reason?: string }).reason;
    return reason ? { status: "forbidden", reason } : { status: "forbidden" };
  }
  if (state.status !== "ready") return state as DataStateResult<readonly PlatformObjectRecord[]>;
  return { status: "ready", value: rows.value };
});

const dataStateLabels = useDataStateLabels(
  () => (props.emptyText ? panel.t(props.emptyText) : t("platform.dataEmpty")),
  () => resolvedEmptyHint.value || undefined,
);

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

function applyFallback(listed: readonly PlatformObjectRecord[]) {
  const isInitialLoad = !initialLoadDone;
  initialLoadDone = true;
  const filterChanged = pendingFilterFallback;
  pendingFilterFallback = false;

  if (!props.fallbackToFirst || panel.instance.draft.value !== null) return;

  // (a) First showing with no selection yet: pick the first row when non-empty.
  if (isInitialLoad) {
    if (chosenIdentity.value === null && listed.length > 0) {
      setSelected(rowSelectionValue(listed[0]!));
    }
    return;
  }

  // (b) After search/filters changed and the previously selected item disappeared: pick the first match or clear to null.
  if (filterChanged && chosenIdentity.value !== null) {
    if (listed.some((row) => rowIdentityKey(row) === chosenIdentity.value)) return;
    setSelected(listed.length > 0 ? rowSelectionValue(listed[0]!) : null);
  }
}

let lastListedSignature: string | null = null;
function publishListed(listed: readonly PlatformObjectRecord[]) {
  const refs = listed.map(rowSelectionValue);
  const signature = JSON.stringify(refs);
  if (signature === lastListedSignature) return;
  lastListedSignature = signature;
  if (placement.outputs?.listed) {
    void panel.instance.output(member.key, "listed", refs as unknown as RuntimeJsonValue);
  }
  emit("update:listed", refs);
}

watch(
  datumState,
  (state) => {
    if (state.status === "loading") return;
    if (state.status === "empty") {
      pendingScrollToTop = false;
      publishListed([]);
      applyFallback([]);
      return;
    }
    if (state.status !== "ready" || parsedData.value.status !== "ok") {
      publishListed([]);
      return;
    }
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
    publishListed(listed);
    applyFallback(listed);
    if (pendingScrollToTop) {
      pendingScrollToTop = false;
      void nextTick(() => {
        if (scrollContainerRef.value) scrollContainerRef.value.scrollTop = 0;
      });
    }
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
  if (pageMode === "page" && pageParam) {
    if (parsedData.value.hasTotal && nextPage > totalPages.value) return;
    pendingScrollToTop = true;
    currentPage.value = nextPage;
    pageParam.set({ number: nextPage, size: effectivePageSize.value });
  }
}

function loadMore() {
  if (pageMode !== "cursor" || !cursorParam || nextCursor.value === undefined || loadingMore.value) return;
  const targetCursor = nextCursor.value;
  pendingAppendCursor = targetCursor;
  loadingMore.value = true;
  currentPage.value += 1;
  cursorParam.set(targetCursor);
}

const rowElements = new Map<string, HTMLElement>();
function setRowElement(key: string, element: unknown) {
  if (element instanceof HTMLElement) rowElements.set(key, element);
  else rowElements.delete(key);
}

let lastScrolledIdentity: string | null = null;
watch(
  [chosenIdentity, rows],
  ([identity, listed]) => {
    if (!identity) {
      lastScrolledIdentity = null;
      return;
    }
    if (identity === lastScrolledIdentity) return;
    if (!listed.some((row) => rowIdentityKey(row) === identity)) return;
    lastScrolledIdentity = identity;
    void nextTick(() => {
      const target = rowElements.get(identity);
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "nearest" });
      }
    });
  },
  { immediate: true },
);

watch(expandedKey, (key) => {
  if (!key) return;
  void nextTick(() => {
    const target = detailElements.get(key) ?? rowElements.get(key);
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "nearest" });
    }
  });
});

watch(rows, (listed) => {
  if (expandedKey.value === null) return;
  if (!listed.some((row) => rowIdentityKey(row) === expandedKey.value)) {
    expandedKey.value = null;
  }
});

function choose(row: PlatformObjectRecord) {
  const identity = rowIdentityKey(row);
  const next = props.toggleable && chosenIdentity.value === identity
    ? null
    : rowSelectionValue(row);
  setSelected(next);
}

/**
 * Keyboard activation and row-to-row focus movement for table rows: only handles keys when the row itself holds
 * focus so checkboxes, reference links and other interactive controls inside a cell keep their own keys.
 */
function onRowKeydown(row: PlatformObjectRecord, event: KeyboardEvent) {
  if (event.target !== event.currentTarget) return;
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    choose(row);
    return;
  }
  const current = event.currentTarget as HTMLElement;
  const dataRows = Array.from(current.parentElement?.querySelectorAll<HTMLElement>(":scope > tr[data-row-item='true']") ?? []);
  const index = dataRows.indexOf(current);
  let target: HTMLElement | null = null;
  if (event.key === "ArrowDown") target = dataRows[index + 1] ?? null;
  else if (event.key === "ArrowUp") target = dataRows[index - 1] ?? null;
  else if (event.key === "Home") target = dataRows[0] ?? null;
  else if (event.key === "End") target = dataRows[dataRows.length - 1] ?? null;
  if (target) {
    event.preventDefault();
    target.focus();
  }
}

/** Keyboard activation and neighbour focus movement for cards without colliding with inner checkboxes or reference links. */
function onCardKeydown(row: PlatformObjectRecord, event: KeyboardEvent) {
  if (event.target !== event.currentTarget) return;
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    choose(row);
    return;
  }
  const current = event.currentTarget as HTMLElement;
  let target: Element | null = null;
  if (event.key === "ArrowDown" || event.key === "ArrowRight") target = current.nextElementSibling;
  else if (event.key === "ArrowUp" || event.key === "ArrowLeft") target = current.previousElementSibling;
  else if (event.key === "Home") target = current.parentElement?.firstElementChild ?? null;
  else if (event.key === "End") target = current.parentElement?.lastElementChild ?? null;
  if (target instanceof HTMLElement) {
    event.preventDefault();
    target.focus();
  }
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

function rowHasSecondLine(row: PlatformObjectRecord): boolean {
  return fieldValue(row, summaryKey.value) !== ""
    || Boolean(props.tagsField && recordFieldArrayItems(row, props.tagsField).length > 0);
}

const listHasTwoLines = computed(() =>
  Boolean(props.subtitleField || props.tagsField)
  || rows.value.some(rowHasSecondLine),
);

function fieldValue(row: PlatformObjectRecord, key: string): string {
  return displayFieldText(rawRecordField(row, key), locale.value, t);
}

function referenceField(row: PlatformObjectRecord, key: string): PanelRecordReferenceFieldValue | null {
  const raw = rawRecordField(row, key);
  return isRecordReference(raw) ? raw : null;
}

function cellSegments(row: PlatformObjectRecord, key: string, empty = "—") {
  const text = fieldValue(row, key);
  if (text === "") return [{ text: empty, hit: false }];
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
      <div v-if="$slots.filters" class="sdk-object-list-filters">
        <slot name="filters"></slot>
      </div>
      <label v-if="canCheck && !isTable" class="sdk-object-list-select-all">
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
      <div v-if="canCheck && checkedRefs.length > 0" class="sdk-object-list-batch-actions" role="group">
        <span class="sdk-object-list-selected-count" role="status">
          {{ t("platform.listSelectedCount", { count: checkedRefs.length }) }}
        </span>
        <slot name="batch-actions" :checked="checkedRefs" :clear="clearChecked"></slot>
        <button type="button" class="sdk-object-list-link-btn" @click="clearChecked">
          {{ t("platform.listClearSelection") }}
        </button>
      </div>
      <div v-if="$slots['toolbar-actions']" class="sdk-object-list-toolbar-actions">
        <slot name="toolbar-actions"></slot>
      </div>
    </div>

    <div v-if="showCreateRow" class="sdk-object-list-create-row" data-create-row="true">
      <slot name="create-row"></slot>
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
      <div v-if="isTable" ref="scrollContainerRef" class="sdk-object-list-table-wrap">
        <table class="sdk-object-list-table">
          <thead>
            <tr>
              <th v-if="rowDetailMember" class="sdk-object-list-expand-col"></th>
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
            <template v-for="row in rows" :key="rowIdentityKey(row)">
              <tr
                :ref="(el) => setRowElement(rowIdentityKey(row), el)"
                tabindex="0"
                data-row-item="true"
                :aria-selected="rowIdentityKey(row) === chosenIdentity"
                :class="{ chosen: rowIdentityKey(row) === chosenIdentity }"
                @click="choose(row)"
                @keydown="onRowKeydown(row, $event)"
              >
                <td v-if="rowDetailMember" class="sdk-object-list-expand-col" @click.stop>
                  <button
                    type="button"
                    class="sdk-object-list-expand-btn"
                    :aria-expanded="isRowExpanded(row)"
                    :aria-label="rowExpandAriaLabel(row)"
                    @click="toggleRowExpanded(row)"
                  >
                    <span class="sdk-object-list-expand-icon" :class="{ expanded: isRowExpanded(row) }" aria-hidden="true">▸</span>
                  </button>
                </td>
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
                  :title="listColumnMember(column.key) ? undefined : cellTitle(row, column)"
                >
                  <list-row-member
                    v-if="listColumnMember(column.key)"
                    :member-key="listColumnMember(column.key)!"
                    kind="listColumn"
                    :row="row"
                    :fallback-class-name="activeType ?? objectType"
                    :host-runtime-params="hostRuntimeParams"
                  ></list-row-member>
                  <button
                    v-else-if="referenceField(row, column.key)"
                    type="button"
                    class="sdk-object-ref-link"
                    @click.stop="navigateTo(toFieldReference(referenceField(row, column.key)!), column.key)"
                  >
                    <template v-for="(part, index) in textHighlightSegments(referenceDisplayLabel(referenceField(row, column.key)!), row.highlights?.[column.key])" :key="index">
                      <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                    </template>
                  </button>
                  <span v-else-if="Array.isArray(rawRecordField(row, column.key)) || column.kind === 'tags'" class="sdk-object-list-item-tags">
                    <template v-for="(item, itemIndex) in recordFieldArrayItems(row, column.key)" :key="itemIndex">
                      <button
                        v-if="isRecordReference(item)"
                        type="button"
                        class="sdk-object-ref-link"
                        @click.stop="navigateTo(toFieldReference(item), column.key)"
                      >
                        {{ referenceDisplayLabel(item) }}
                      </button>
                      <span v-else class="sdk-object-list-tag" data-tone="info">{{ scalarFieldText(item, t) }}</span>
                    </template>
                    <template v-if="!recordFieldArrayItems(row, column.key).length">{{ columnEmpty(column) }}</template>
                  </span>
                  <span
                    v-else-if="column.kind === 'tag' && fieldValue(row, column.key) !== ''"
                    class="sdk-object-list-tag"
                    :data-tone="row.tones?.[column.key] ?? 'default'"
                  >
                    <template v-for="(part, index) in cellSegments(row, column.key, columnEmpty(column))" :key="index">
                      <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                  <template v-else-if="column.kind === 'time'">{{ fieldValue(row, column.key) !== '' ? timeText(fieldValue(row, column.key), column.timeFormat) : columnEmpty(column) }}</template>
                  <div v-else class="sdk-object-list-cell">
                    <span class="sdk-object-list-cell-main">
                      <template v-for="(part, index) in cellSegments(row, column.key, columnEmpty(column))" :key="index">
                        <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                      </template>
                    </span>
                    <span v-if="column.subtitleKey && fieldValue(row, column.subtitleKey) !== ''" class="sdk-object-list-cell-sub">
                      <template v-for="(part, index) in cellSegments(row, column.subtitleKey, '')" :key="index">
                        <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                      </template>
                    </span>
                  </div>
                </td>
              </tr>
              <tr
                v-if="rowDetailMember && isRowExpanded(row)"
                :ref="(el) => setDetailElement(rowIdentityKey(row), el)"
                class="sdk-object-list-detail-row"
              >
                <td :colspan="tableColumnCount" class="sdk-object-list-detail-cell">
                  <list-row-member
                    :member-key="rowDetailMember"
                    kind="listRowDetail"
                    :row="row"
                    :fallback-class-name="activeType ?? objectType"
                    :host-runtime-params="hostRuntimeParams"
                  ></list-row-member>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div v-else-if="isCards" ref="scrollContainerRef" role="listbox" class="sdk-object-list-cards">
        <article
          v-for="row in rows"
          :key="rowIdentityKey(row)"
          :ref="(el) => setRowElement(rowIdentityKey(row), el)"
          role="option"
          tabindex="0"
          class="sdk-object-list-card"
          :aria-selected="rowIdentityKey(row) === chosenIdentity"
          :class="{ chosen: rowIdentityKey(row) === chosenIdentity }"
          @click="choose(row)"
          @keydown="onCardKeydown(row, $event)"
        >
          <div class="sdk-object-list-card-head">
            <button
              v-if="rowDetailMember"
              type="button"
              class="sdk-object-list-expand-btn"
              :aria-expanded="isRowExpanded(row)"
              :aria-label="rowExpandAriaLabel(row)"
              @click.stop="toggleRowExpanded(row)"
            >
              <span class="sdk-object-list-expand-icon" :class="{ expanded: isRowExpanded(row) }" aria-hidden="true">▸</span>
            </button>
            <input
              v-if="canCheck"
              type="checkbox"
              class="sdk-object-list-card-check"
              :aria-label="row.label"
              :checked="checkedIdentityKeys.has(rowIdentityKey(row))"
              @click.stop
              @change="toggleChecked(row, ($event.target as HTMLInputElement).checked)"
            />
            <span class="sdk-object-list-card-title">
              <template v-for="(part, index) in textHighlightSegments(row.label, row.highlights?.label)" :key="index">
                <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
              </template>
            </span>
            <span
              v-if="statusField && fieldValue(row, statusField) !== ''"
              class="sdk-object-list-tag"
              :data-tone="row.tones?.[statusField] ?? 'default'"
            >{{ fieldValue(row, statusField) }}</span>
          </div>
          <p
            v-if="fieldValue(row, summaryKey) !== ''"
            class="sdk-object-list-card-sub"
            :class="{ 'sdk-object-list-item-sub-clamped': subtitleLines !== undefined }"
            :style="{ WebkitLineClamp: subtitleLines }"
          >
            <template v-for="(part, index) in textHighlightSegments(fieldValue(row, summaryKey), row.highlights?.[summaryKey])" :key="index">
              <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
            </template>
          </p>
          <dl v-if="columns?.length" class="sdk-object-list-card-fields">
            <template v-for="column in columns" :key="column.key">
              <dt class="sdk-object-list-card-field-label">{{ columnLabel(column) }}</dt>
              <dd class="sdk-object-list-card-field-value" :title="listColumnMember(column.key) ? undefined : cellTitle(row, column)">
                <list-row-member
                  v-if="listColumnMember(column.key)"
                  :member-key="listColumnMember(column.key)!"
                  kind="listColumn"
                  :row="row"
                  :fallback-class-name="activeType ?? objectType"
                  :host-runtime-params="hostRuntimeParams"
                ></list-row-member>
                <button
                  v-else-if="referenceField(row, column.key)"
                  type="button"
                  class="sdk-object-ref-link"
                  @click.stop="navigateTo(toFieldReference(referenceField(row, column.key)!), column.key)"
                >
                  <template v-for="(part, index) in textHighlightSegments(referenceDisplayLabel(referenceField(row, column.key)!), row.highlights?.[column.key])" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </button>
                <span v-else-if="Array.isArray(rawRecordField(row, column.key)) || column.kind === 'tags'" class="sdk-object-list-item-tags">
                  <template v-for="(item, itemIndex) in recordFieldArrayItems(row, column.key)" :key="itemIndex">
                    <button
                      v-if="isRecordReference(item)"
                      type="button"
                      class="sdk-object-ref-link"
                      @click.stop="navigateTo(toFieldReference(item), column.key)"
                    >
                      {{ referenceDisplayLabel(item) }}
                    </button>
                    <span v-else class="sdk-object-list-tag" data-tone="info">{{ scalarFieldText(item, t) }}</span>
                  </template>
                  <template v-if="!recordFieldArrayItems(row, column.key).length">{{ columnEmpty(column) }}</template>
                </span>
                <span
                  v-else-if="column.kind === 'tag' && fieldValue(row, column.key) !== ''"
                  class="sdk-object-list-tag"
                  :data-tone="row.tones?.[column.key] ?? 'default'"
                >
                  <template v-for="(part, index) in cellSegments(row, column.key, columnEmpty(column))" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </span>
                <template v-else-if="column.kind === 'time'">{{ fieldValue(row, column.key) !== '' ? timeText(fieldValue(row, column.key), column.timeFormat) : columnEmpty(column) }}</template>
                <template v-else>
                  <template v-for="(part, index) in cellSegments(row, column.key, columnEmpty(column))" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </template>
              </dd>
            </template>
          </dl>
          <div v-if="tagsField && recordFieldArrayItems(row, tagsField).length" class="sdk-object-list-card-tags">
            <template v-for="(item, itemIndex) in recordFieldArrayItems(row, tagsField)" :key="itemIndex">
              <button
                v-if="isRecordReference(item)"
                type="button"
                class="sdk-object-ref-link"
                @click.stop="navigateTo(toFieldReference(item), tagsField)"
              >
                {{ referenceDisplayLabel(item) }}
              </button>
              <span v-else class="sdk-object-list-tag" data-tone="info">{{ scalarFieldText(item, t) }}</span>
            </template>
          </div>
          <div
            v-if="rowDetailMember && isRowExpanded(row)"
            :ref="(el) => setDetailElement(rowIdentityKey(row), el)"
            class="sdk-object-list-card-detail"
            @click.stop
          >
            <list-row-member
              :member-key="rowDetailMember"
              kind="listRowDetail"
              :row="row"
              :fallback-class-name="activeType ?? objectType"
              :host-runtime-params="hostRuntimeParams"
            ></list-row-member>
          </div>
        </article>
      </div>

      <ul v-else ref="scrollContainerRef" role="listbox" class="sdk-object-list-items" :data-row-density="listHasTwoLines ? 'two-line' : 'single'">
        <li
          v-for="row in rows"
          :key="rowIdentityKey(row)"
          :ref="(el) => setRowElement(rowIdentityKey(row), el)"
          class="sdk-object-list-row"
          :class="{ chosen: rowIdentityKey(row) === chosenIdentity }"
        >
          <div class="sdk-object-list-row-main">
            <button
              v-if="rowDetailMember"
              type="button"
              class="sdk-object-list-expand-btn sdk-object-list-row-expand"
              :aria-expanded="isRowExpanded(row)"
              :aria-label="rowExpandAriaLabel(row)"
              @click.stop="toggleRowExpanded(row)"
            >
              <span class="sdk-object-list-expand-icon" :class="{ expanded: isRowExpanded(row) }" aria-hidden="true">▸</span>
            </button>
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
              :data-row-density="listHasTwoLines ? 'two-line' : 'single'"
              :aria-selected="rowIdentityKey(row) === chosenIdentity"
              :class="{ chosen: rowIdentityKey(row) === chosenIdentity, 'sdk-object-list-item-two-line': listHasTwoLines }"
              @click="choose(row)"
            >
              <span class="sdk-object-list-item-head">
                <span class="sdk-object-list-item-label">
                  <template v-for="(part, index) in textHighlightSegments(row.label, row.highlights?.label)" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </span>
                <span
                  v-if="statusField && fieldValue(row, statusField) !== ''"
                  class="sdk-object-list-tag"
                  :data-tone="row.tones?.[statusField] ?? 'default'"
                >{{ fieldValue(row, statusField) }}</span>
              </span>
              <span
                v-if="fieldValue(row, summaryKey) !== ''"
                class="sdk-object-list-item-sub"
                :class="{ 'sdk-object-list-item-sub-clamped': subtitleLines !== undefined }"
                :style="{ WebkitLineClamp: subtitleLines }"
              >
                <template v-for="(part, index) in textHighlightSegments(fieldValue(row, summaryKey), row.highlights?.[summaryKey])" :key="index">
                  <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span v-if="tagsField && recordFieldArrayItems(row, tagsField).length" class="sdk-object-list-item-tags">
                <template v-for="(item, itemIndex) in recordFieldArrayItems(row, tagsField)" :key="itemIndex">
                  <span
                    v-if="isRecordReference(item)"
                    role="link"
                    tabindex="0"
                    class="sdk-object-ref-link"
                    @click.stop="navigateTo(toFieldReference(item), tagsField)"
                    @keydown.enter.stop.prevent="navigateTo(toFieldReference(item), tagsField)"
                  >
                    {{ referenceDisplayLabel(item) }}
                  </span>
                  <span v-else class="sdk-object-list-tag" data-tone="info">{{ scalarFieldText(item, t) }}</span>
                </template>
              </span>
            </button>
          </div>
          <div
            v-if="rowDetailMember && isRowExpanded(row)"
            :ref="(el) => setDetailElement(rowIdentityKey(row), el)"
            class="sdk-object-list-row-detail"
            @click.stop
          >
            <list-row-member
              :member-key="rowDetailMember"
              kind="listRowDetail"
              :row="row"
              :fallback-class-name="activeType ?? objectType"
              :host-runtime-params="hostRuntimeParams"
            ></list-row-member>
          </div>
        </li>
      </ul>
    </data-state>

    <nav v-if="showFooter" class="sdk-object-list-pagination sdk-object-list-footer">
      <span v-if="showFooterTotal" class="sdk-object-list-count sdk-object-list-page-total" role="status">
        {{ t("platform.listTotal", { count: footerTotal }) }}
      </span>
      <template v-if="showPageControls">
        <button
          type="button"
          class="sdk-object-list-btn sdk-object-list-prev"
          :disabled="currentPage <= 1"
          @click="goPage(currentPage - 1)"
        >
          {{ t("platform.listPrevPage") }}
        </button>
        <template v-if="showNumericPages">
          <template v-for="(item, index) in paginationItems" :key="item === 'ellipsis' ? `ellipsis-${index}` : item">
            <span v-if="item === 'ellipsis'" class="sdk-object-list-page-ellipsis" aria-hidden="true">…</span>
            <button
              v-else
              type="button"
              class="sdk-object-list-btn sdk-object-list-page-num"
              :class="{ active: item === currentPage }"
              :aria-current="item === currentPage ? 'page' : undefined"
              @click="goPage(item)"
            >
              {{ item }}
            </button>
          </template>
        </template>
        <span v-else class="sdk-object-list-page-info">
          {{ footerHasTotal ? t("platform.listPagination", { page: currentPage, pages: totalPages }) : currentPage }}
        </span>
        <button
          type="button"
          class="sdk-object-list-btn sdk-object-list-next"
          :disabled="!footerHasTotal || currentPage >= totalPages"
          @click="goPage(currentPage + 1)"
        >
          {{ t("platform.listNextPage") }}
        </button>
      </template>
      <button
        v-else-if="showLoadMore"
        type="button"
        class="sdk-object-list-btn sdk-object-list-load-more"
        :disabled="loadingMore || nextCursor === undefined"
        :aria-busy="loadingMore ? 'true' : undefined"
        @click="loadMore"
      >
        {{ loadingMore ? t("platform.readerLoading") : t("platform.listLoadMore") }}
      </button>
    </nav>
  </div>
</template>

<style scoped>
/* The platform's design roles only (DESIGN.md): neutral fills for hover and selection, link colour for links, the
   shared spacing, type, radius and control scales. No value is written here. */
.sdk-object-list {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--spacing-sm);
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.sdk-object-list-toolbar {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.sdk-object-list-filters {
  align-items: center;
  display: inline-flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.sdk-object-list-toolbar-actions {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--spacing-xs);
  margin-left: auto;
}
.sdk-object-list-create-row {
  background: var(--ui-fill-quaternary);
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  flex: 0 0 auto;
  padding: var(--spacing-md);
}
.sdk-object-list-create-row :deep(.sdk-owner-form),
.sdk-object-list-create-row :deep(.sdk-owner-form-inner) {
  flex: 0 0 auto;
  height: auto;
}
.sdk-object-list-create-row :deep(.sdk-owner-form-body) {
  flex: 0 0 auto;
  overflow: visible;
}
.sdk-object-list-create-row :deep(.sdk-owner-form-actions) {
  background: transparent;
  position: static;
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
.sdk-object-list-batch-actions {
  align-items: center;
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
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
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
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
  box-sizing: border-box;
  padding: 0 var(--spacing-md);
  text-align: left;
  vertical-align: middle;
  /* A value stays on its line: a short column is as wide as its text, never two characters over two lines. */
  white-space: nowrap;
}
.sdk-object-list-table th:not(.sdk-object-list-col-wrap),
.sdk-object-list-table td:not(.sdk-object-list-col-wrap) :is(.sdk-object-list-cell-main, .sdk-object-list-cell-sub, .sdk-object-ref-link) {
  overflow: hidden;
  text-overflow: ellipsis;
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
  padding-block: var(--spacing-sm);
  white-space: normal;
  min-width: 12em;
}
.sdk-object-list-table th {
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  height: var(--table-head-height, 36px);
  position: sticky;
  top: 0;
  z-index: 1;
}
.sdk-object-list-table td {
  height: var(--table-row-height, 40px);
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
.sdk-object-list-table tbody tr:focus-visible {
  outline: 2px solid var(--brand-link);
  outline-offset: -2px;
}
.sdk-object-list-check-col,
.sdk-object-list-expand-col {
  width: var(--control-height);
}
.sdk-object-list-expand-btn {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  color: var(--el-text-color-secondary);
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 auto;
  height: var(--control-height-sm);
  justify-content: center;
  padding: 0;
  transition: background-color var(--transition-fast), color var(--transition-fast);
  width: var(--control-height-sm);
}
.sdk-object-list-expand-btn:hover {
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
}
.sdk-object-list-expand-btn:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
.sdk-object-list-expand-icon {
  display: inline-block;
  font-size: var(--text-xs);
  line-height: 1;
  transition: transform var(--transition-fast);
}
.sdk-object-list-expand-icon.expanded {
  transform: rotate(90deg);
}
.sdk-object-list-table tbody tr.sdk-object-list-detail-row {
  background: var(--ui-fill-quaternary);
  cursor: default;
}
.sdk-object-list-table tbody tr.sdk-object-list-detail-row:hover {
  background: var(--ui-fill-quaternary);
}
.sdk-object-list-table td.sdk-object-list-detail-cell {
  height: auto;
  padding: var(--spacing-md);
  white-space: normal;
}
.sdk-object-list-card-detail,
.sdk-object-list-row-detail {
  border-top: 1px solid var(--ui-divider);
  padding-top: var(--spacing-sm);
  width: 100%;
}
.sdk-object-list-row-detail {
  padding-inline-start: var(--spacing-lg);
}
.sdk-object-list-cell {
  display: flex;
  flex-direction: column;
  gap: calc(var(--spacing-xs) / 2);
}
.sdk-object-list-select-all {
  align-items: center;
  cursor: pointer;
  display: inline-flex;
  font-size: var(--text-xs);
  gap: var(--spacing-xs);
}
.sdk-object-list-cell-sub,
.sdk-object-list-item-sub {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.sdk-object-list-item-sub {
  line-height: var(--leading-xs);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}
.sdk-object-list-item-sub-clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: var(--leading-xs);
  white-space: normal;
}
.sdk-object-list-items {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: calc(var(--spacing-xs) / 2);
  list-style: none;
  margin: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 0;
}
.sdk-object-list-row {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: var(--spacing-xs);
}
.sdk-object-list-row-main {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: var(--spacing-xs);
  min-width: 0;
  width: 100%;
}
.sdk-object-list-row-expand,
.sdk-object-list-row-check {
  flex: 0 0 auto;
}
.sdk-object-list-item-btn {
  background: none;
  border: 0;
  border-radius: var(--radius-md);
  box-sizing: border-box;
  color: var(--el-text-color-primary);
  cursor: pointer;
  display: flex;
  flex: 1;
  flex-direction: column;
  font-size: var(--text-sm);
  gap: calc(var(--spacing-xs) / 2);
  justify-content: center;
  min-height: var(--list-row-height, 44px);
  min-width: 0;
  padding: var(--spacing-xs) var(--spacing-sm);
  text-align: left;
  transition: background-color var(--transition-fast);
  width: 100%;
}
.sdk-object-list-item-btn.sdk-object-list-item-two-line {
  min-height: var(--list-row-two-line-height, 60px);
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
  min-width: 0;
  width: 100%;
}
.sdk-object-list-item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sdk-object-list-item-head .sdk-object-list-tag {
  flex: 0 0 auto;
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
.sdk-object-list-cards {
  align-content: start;
  display: grid;
  flex: 1 1 auto;
  gap: var(--spacing-md);
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  min-height: 0;
  overflow-y: auto;
}
.sdk-object-list-card {
  background: var(--sdk-bg-color);
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-md);
  color: var(--sdk-text-color-primary);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  transition: background-color var(--transition-fast), border-color var(--transition-fast);
}
.sdk-object-list-card:hover {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-card.chosen {
  background: var(--ui-fill-secondary);
  border-color: var(--sdk-color-primary);
}
.sdk-object-list-card:focus-visible {
  outline: 2px solid var(--brand-link);
  outline-offset: 2px;
}
.sdk-object-list-card-head {
  align-items: center;
  display: flex;
  gap: var(--spacing-sm);
}
.sdk-object-list-card-check {
  flex: 0 0 auto;
}
.sdk-object-list-card-title {
  flex: 1 1 auto;
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  line-height: var(--leading-sm);
  min-width: 0;
  word-break: break-word;
}
.sdk-object-list-card-sub {
  color: var(--sdk-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  margin: 0;
}
.sdk-object-list-card-fields {
  display: grid;
  font-size: var(--text-xs);
  gap: var(--spacing-xs) var(--spacing-md);
  grid-template-columns: auto 1fr;
  margin: 0;
}
.sdk-object-list-card-field-label {
  color: var(--sdk-text-color-secondary);
}
.sdk-object-list-card-field-value {
  color: var(--sdk-text-color-regular);
  margin: 0;
  min-width: 0;
  word-break: break-word;
}
.sdk-object-list-card-tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}
.sdk-object-list-pagination {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  justify-content: flex-end;
  padding-top: var(--spacing-xs);
}
.sdk-object-list-page-total {
  color: var(--sdk-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  margin-right: auto;
}
.sdk-object-list-page-num {
  min-width: var(--control-height-sm);
  padding: 0 var(--spacing-sm);
}
.sdk-object-list-page-num.active {
  background: var(--sdk-color-primary);
  border-color: var(--sdk-color-primary);
  color: var(--sdk-bg-color);
  font-weight: var(--font-semibold);
}
.sdk-object-list-page-num.active:hover:not(:disabled) {
  background: var(--sdk-color-primary);
}
.sdk-object-list-page-ellipsis {
  color: var(--sdk-text-color-secondary);
  font-size: var(--text-sm);
  padding: 0 var(--spacing-xs);
  user-select: none;
}
.sdk-object-list-diagnostics {
  color: var(--el-color-warning-text);
  flex: 0 0 auto;
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
