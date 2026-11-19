<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import {
  slotInputState,
  slotOutputState,
  usePanelContext,
  useProjectionObjects,
  useProjectionSlot,
} from "../panel/context";
import { useMember, useMemberData } from "../panel/member";
import {
  adapterPart,
  type PlatformFieldReference,
  type PlatformGraphStatus,
  type PlatformObjectFacet,
  type PlatformObjectQuery,
  type PlatformObjectQueryResult,
  type PlatformObjectRecord,
  type PlatformObjectRef,
} from "../panel/platform-objects";
import type { ObjectListColumn, ObjectListFilter, ObjectListRef } from "./object-list-types";
import { textHighlightSegments } from "./text-highlight";
import { stateObject } from "../panel/state";

/**
 * Platform objects of the bound type as an interactive list or multi-column table. In a directly rendered panel the
 * instance supplies its `rows` datum through the host read port; in a panel frame the resource adapter owns all query
 * semantics (search, filtering, facet counts, highlight ranges and pagination). This component provides UI interaction
 * and keeps the viewing selection (`selected`) separate from explicit multi-selection (`checked`).
 */
const props = withDefaults(
  defineProps<{
    /** Dynamic object type ID (e.g. `"platform:Action"`) queried through the bound adapter's `query` port. */
    type?: string | null;
    /** Slot input whose panel state holds the single selected object when `outputs.selected` is not declared. */
    input?: string;
    /** Slot input whose panel state holds the parent object when listing child objects of a selected parent. */
    parentInput?: string;
    /** Panel state fields cleared in the same atomic `setState` update whenever this list changes its selection. */
    clears?: readonly string[];
    /** Multi-column table definition; when absent, renders a compact selectable list. */
    columns?: readonly ObjectListColumn[];
    /** Field key rendered as a status tag on each item in compact list mode. */
    statusField?: string;
    /** Key in `record.tags` rendered as tags on each item in compact list mode. */
    tagsField?: string;
    /** Show a text search input backed by the adapter's `query` port. */
    searchable?: boolean;
    /** Optional placeholder text for the search input. */
    searchPlaceholder?: string;
    /** `"live"` queries on each input/filter change; `"submit"` queries when the reader clicks Query or presses Enter. */
    searchMode?: "live" | "submit";
    /** Declared filter controls; merged with dynamic `facets` returned by `adapter.query`. */
    filters?: readonly ObjectListFilter[];
    /** Show a Refresh button that re-runs the current query. */
    refreshable?: boolean;
    /** Show the total matching count reported by the adapter (`result.total`). */
    showCount?: boolean;
    /** Explicitly enable multi-row checkboxes (separate from single-row selection). */
    selectable?: boolean;
    /** Controlled checked object references when `outputs.checked` is not bound to panel state. */
    checked?: readonly ObjectListRef[];
    /** Move single selection to the first visible item when the current selection is filtered out. */
    fallbackToFirst?: boolean;
    /** Whether clicking an already-selected item clears the single selection. */
    toggleable?: boolean;
    /** Page size for offset/limit or cursor pagination through `adapter.query`. */
    pageSize?: number;
    /** Optional per-row action button label in table mode that selects the row without toggling off. */
    rowActionLabel?: string;
    /** Optional empty-state description. */
    emptyText?: string;
    /** Optional prompt shown in dynamic-type mode before a type is selected. */
    emptyTypeText?: string;
  }>(),
  {
    type: undefined,
    input: undefined,
    parentInput: undefined,
    clears: undefined,
    columns: undefined,
    statusField: undefined,
    tagsField: undefined,
    searchable: false,
    searchPlaceholder: undefined,
    searchMode: "live",
    filters: undefined,
    refreshable: false,
    showCount: false,
    selectable: false,
    checked: undefined,
    fallbackToFirst: false,
    toggleable: true,
    pageSize: undefined,
    rowActionLabel: undefined,
    emptyText: undefined,
    emptyTypeText: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when the single viewing selection changes. */
  "update:selected": [value: ObjectListRef | null];
  /** Emitted when the explicit multi-selection set changes. */
  "update:checked": [value: readonly ObjectListRef[]];
  /** Emitted when a reader clicks a reference cell carrying an owner-supplied object reference. */
  navigate: [reference: PlatformFieldReference, columnKey: string];
  /** Emitted after each query with the executed query parameters and owner result. */
  query: [query: PlatformObjectQuery, result: PlatformObjectQueryResult];
}>();

const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const objectType = slot.projection.binding.id;
const member = useMember();
/** In a directly rendered panel, the list's items are the member's `rows` datum, read by the instance. */
const rowsData = member ? useMemberData("rows") : null;
const objects = rowsData ? null : useProjectionObjects();

const frameRows = shallowRef<readonly PlatformObjectRecord[]>([]);
const frameTotal = ref(0);
const dynamicFacets = shallowRef<readonly PlatformObjectFacet[]>([]);
const nextCursor = ref<string | undefined>(undefined);
const frameLoading = ref(true);
const frameFailure = shallowRef<Error | null>(null);
const queryStatus = ref<PlatformGraphStatus>("ok");
const queryReason = ref<string | undefined>(undefined);

const rows = computed<readonly PlatformObjectRecord[]>(() => {
  if (!rowsData) return frameRows.value;
  return rowsData.value.status === "ready" ? (rowsData.value.value as unknown as readonly PlatformObjectRecord[]) : [];
});
const total = computed(() => (rowsData ? rows.value.length : frameTotal.value));

const currentPage = ref(1);
const cursorHistory = ref<(string | undefined)[]>([undefined]);

const initialFilters = (): Record<string, string> =>
  Object.fromEntries(
    (props.filters ?? [])
      .filter((filter) => filter.defaultValue !== undefined)
      .map((filter) => [filter.key, filter.defaultValue!]),
  );

const draftSearch = ref("");
const draftFilters = ref<Record<string, string>>(initialFilters());
const appliedSearch = ref("");
const appliedFilters = ref<Record<string, string>>(initialFilters());

const typeInputState = computed(() => slotInputState(panel.manifest, slot.slot, "type"));
const dynamicTypeMode = computed(() => props.type !== undefined || typeInputState.value !== null);
const activeType = computed<string | null>(() => {
  if (props.type !== undefined) return props.type || null;
  if (typeInputState.value) {
    const value = panel.instance.state.values.value[typeInputState.value];
    return typeof value === "string" && value ? value : null;
  }
  return objectType;
});
const hasActiveType = computed(() => !dynamicTypeMode.value || activeType.value !== null);

const selectedState = computed(() => {
  const output = slotOutputState(panel.manifest, slot.slot, "selected");
  if (output) return output;
  if (props.input) return slotInputState(panel.manifest, slot.slot, props.input);
  if (dynamicTypeMode.value || props.parentInput) return slotInputState(panel.manifest, slot.slot, "selected");
  return slotInputState(panel.manifest, slot.slot);
});
const parentState = computed(
  () => (props.parentInput ? slotInputState(panel.manifest, slot.slot, props.parentInput) : null),
);
const parentRef = computed<PlatformObjectRef | null>(() => {
  if (!parentState.value) return null;
  const value = stateObject(panel.instance.state.values.value[parentState.value]);
  return value && { className: value.className, primaryKey: value.primaryKey };
});
const parentIdentity = computed(() => (parentRef.value ? `${parentRef.value.className}\u0000${parentRef.value.primaryKey}` : ""));
const checkedState = computed(() => slotOutputState(panel.manifest, slot.slot, "checked"));
const localSelected = shallowRef<ObjectListRef | null>(null);
const localChecked = shallowRef<readonly ObjectListRef[]>([]);

function rowClassName(row: PlatformObjectRecord): string {
  return row.className ?? activeType.value ?? objectType;
}

function refKey(refValue: ObjectListRef): string {
  return `${refValue.className}\u0000${refValue.primaryKey}`;
}

function rowIdentityKey(row: PlatformObjectRecord): string {
  return `${rowClassName(row)}\u0000${row.primaryKey}`;
}

const chosenRef = computed<ObjectListRef | null>(() => {
  if (selectedState.value) {
    const value = stateObject(panel.instance.state.values.value[selectedState.value]);
    return value && { className: value.className, primaryKey: value.primaryKey };
  }
  return localSelected.value;
});
const chosenIdentity = computed<string | null>(() => (chosenRef.value ? refKey(chosenRef.value) : null));

function isRefList(value: unknown): value is readonly ObjectListRef[] {
  return Array.isArray(value);
}

const checkedRefs = computed<readonly ObjectListRef[]>(() => {
  if (checkedState.value) {
    const value = panel.instance.state.values.value[checkedState.value];
    return isRefList(value) ? value : [];
  }
  return props.checked ?? localChecked.value;
});

const checkedIdentityKeys = computed(() => new Set(checkedRefs.value.map(refKey)));
const allVisibleChecked = computed(
  () => rows.value.length > 0 && rows.value.every((row) => checkedIdentityKeys.value.has(rowIdentityKey(row))),
);
const someVisibleChecked = computed(
  () => !allVisibleChecked.value && rows.value.some((row) => checkedIdentityKeys.value.has(rowIdentityKey(row))),
);

const requiresQuery = computed(
  () => dynamicTypeMode.value || Boolean(props.parentInput) || props.searchable || Boolean(props.filters?.length) || (props.pageSize !== undefined && props.pageSize > 0),
);
const isTable = computed(() => Boolean(props.columns?.length));
const totalPages = computed(() => (props.pageSize && props.pageSize > 0 ? Math.max(1, Math.ceil(total.value / props.pageSize)) : 1));
const showPagination = computed(
  () =>
    hasActiveType.value
    && queryStatus.value === "ok"
    && props.pageSize !== undefined
    && props.pageSize > 0
    && (total.value > props.pageSize || currentPage.value > 1 || nextCursor.value !== undefined),
);
const queryStatusLabel = computed(() => {
  if (queryStatus.value === "refused") return t("platform.graphStatusRefused");
  if (queryStatus.value === "failed") return t("platform.graphStatusFailed");
  if (queryStatus.value === "unavailable") return t("platform.graphStatusUnavailable");
  return "";
});

function panelText(text: string): string {
  return panel.t(text);
}

const resolvedFilters = computed<readonly ObjectListFilter[]>(() => {
  const facetsByKey = new Map(dynamicFacets.value.map((facet) => [facet.key, facet]));
  const declared = (props.filters ?? []).map((filter) => {
    const facet = facetsByKey.get(filter.key);
    const label = filter.label ? panelText(filter.label) : (facet?.label ?? filter.key);
    if (!facet) {
      return {
        ...filter,
        label,
        options: (filter.options ?? []).map((option) => ({
          ...option,
          label: option.label ? panelText(option.label) : option.value,
        })),
      };
    }
    facetsByKey.delete(filter.key);
    const declaredLabels = new Map(
      (filter.options ?? [])
        .filter((option) => Boolean(option.label))
        .map((option) => [option.value, panelText(option.label!)]),
    );
    const mergedOptions = facet.options.map((option) => ({
      value: option.value,
      label: declaredLabels.get(option.value) || option.label || option.value,
      count: option.count,
    }));
    return {
      ...filter,
      label,
      options: mergedOptions,
    };
  });
  const extra: ObjectListFilter[] = [...facetsByKey.values()].map((facet) => ({
    key: facet.key,
    label: facet.label,
    kind: facet.options.some((option) => option.count !== undefined) ? "tabs" : "select",
    options: facet.options.map((option) => ({
      ...option,
      label: option.label || option.value,
    })),
  }));
  return [...declared, ...extra];
});

const showToolbar = computed(
  () => props.searchable || resolvedFilters.value.length > 0 || props.refreshable || props.showCount,
);

function setSelected(next: ObjectListRef | null) {
  if (selectedState.value) {
    const changed = (next ? refKey(next) : null) !== chosenIdentity.value;
    if (changed && props.clears?.length) {
      const patch: Record<string, PanelStateValue> = { [selectedState.value]: next };
      for (const field of props.clears) patch[field] = null;
      panel.instance.state.setState(patch);
    } else {
      panel.instance.state.set(selectedState.value, next);
    }
  } else {
    localSelected.value = next;
  }
  emit("update:selected", next);
}

function setChecked(next: readonly ObjectListRef[]) {
  if (checkedState.value) {
    panel.instance.state.set(checkedState.value, next as unknown as PanelStateValue);
  } else if (props.checked === undefined) {
    localChecked.value = next;
  }
  emit("update:checked", next);
}

function buildQuery(): PlatformObjectQuery {
  const search = appliedSearch.value.trim();
  const activeFilters = Object.fromEntries(
    Object.entries(appliedFilters.value).filter(([, value]) => value !== ""),
  );
  const page = props.pageSize && props.pageSize > 0
    ? {
        limit: props.pageSize,
        ...(cursorHistory.value[currentPage.value - 1] !== undefined
          ? { cursor: cursorHistory.value[currentPage.value - 1] }
          : { offset: (currentPage.value - 1) * props.pageSize }),
      }
    : undefined;
  return {
    ...(parentRef.value ? { parent: parentRef.value } : {}),
    ...(dynamicTypeMode.value && activeType.value ? { objectType: activeType.value } : {}),
    ...(search ? { search } : {}),
    ...(Object.keys(activeFilters).length ? { filters: activeFilters } : {}),
    ...(page ? { page } : {}),
  };
}

let requestSeq = 0;

function applyFallback(items: readonly PlatformObjectRecord[], defaultPrimaryKey?: string) {
  if (!props.fallbackToFirst) return;
  const stillVisible = chosenIdentity.value !== null && items.some((item) => rowIdentityKey(item) === chosenIdentity.value);
  if (stillVisible) return;
  const preferred = defaultPrimaryKey ? items.find((item) => item.primaryKey === defaultPrimaryKey) : undefined;
  const fallback = preferred ?? items[0];
  const next = fallback ? { className: rowClassName(fallback), primaryKey: fallback.primaryKey } : null;
  if ((next ? refKey(next) : null) !== chosenIdentity.value) setSelected(next);
}

function load() {
  if (!objects) return;
  const seq = ++requestSeq;
  frameFailure.value = null;
  queryStatus.value = "ok";
  queryReason.value = undefined;
  if ((dynamicTypeMode.value && !activeType.value) || (props.parentInput && !parentRef.value)) {
    frameRows.value = [];
    frameTotal.value = 0;
    nextCursor.value = undefined;
    frameLoading.value = false;
    return;
  }
  if (requiresQuery.value) {
    try {
      adapterPart(objectType, "query");
    } catch (reason: unknown) {
      frameFailure.value = reason instanceof Error ? reason : new Error(String(reason));
      frameLoading.value = false;
      return;
    }
  }
  const activeQuery = buildQuery();
  void objects.query(activeQuery).then(
    (result) => {
      if (seq !== requestSeq) return;
      const status = result.status ?? "ok";
      queryStatus.value = status;
      queryReason.value = result.reason;
      frameRows.value = status === "ok" ? result.items : [];
      frameTotal.value = status === "ok" ? result.total : 0;
      if (result.facets) dynamicFacets.value = result.facets;
      nextCursor.value = status === "ok" ? result.nextCursor : undefined;
      frameLoading.value = false;
      emit("query", activeQuery, result);
      if (status === "ok") applyFallback(result.items, result.defaultPrimaryKey);
    },
    (reason: unknown) => {
      if (seq !== requestSeq) return;
      frameFailure.value = reason instanceof Error ? reason : new Error(String(reason));
      frameLoading.value = false;
    },
  );
}

const isCountReady = computed(() =>
  rowsData
    ? rowsData.value.status === "ready" || rowsData.value.status === "empty"
    : hasActiveType.value && queryStatus.value === "ok" && !frameLoading.value && !frameFailure.value,
);

const listResult = computed<DataStateResult<readonly PlatformObjectRecord[]>>(() => {
  if (rowsData) {
    if (rowsData.value.status === "ready") {
      return rows.value.length ? { status: "ready", value: rows.value } : { status: "empty" };
    }
    return rowsData.value as DataStateResult<readonly PlatformObjectRecord[]>;
  }
  if (frameFailure.value) return { status: "error", message: frameFailure.value.message };
  if (frameLoading.value) return { status: "loading" };
  if (props.parentInput && !parentRef.value) return { status: "awaiting" };
  return rows.value.length ? { status: "ready", value: rows.value } : { status: "empty" };
});

const dataStateLabels = computed(() => ({
  empty: props.emptyText ? panel.t(props.emptyText) : t("platform.dataEmpty"),
  forbidden: t("platform.dataForbidden"),
  awaiting: t("platform.dataAwaiting"),
}));

if (rowsData) {
  watch(rowsData, (state) => {
    if (state.status === "empty") {
      applyFallback([]);
      return;
    }
    if (state.status !== "ready") return;
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
  }, { immediate: true });
} else {
  onMounted(load);
  watch(parentIdentity, () => {
    if (!props.parentInput) return;
    resetPaging();
    load();
  });
  watch(activeType, (next, prev) => {
    if (next === prev) return;
    draftSearch.value = "";
    appliedSearch.value = "";
    draftFilters.value = initialFilters();
    appliedFilters.value = initialFilters();
    dynamicFacets.value = [];
    resetPaging();
    frameRows.value = [];
    frameTotal.value = 0;
    nextCursor.value = undefined;
    frameLoading.value = Boolean(next);
    load();
  });
  onBeforeUnmount(
    panel.instance.onObjectChanged((object) => {
      if (!object || object.objectType === objectType || (activeType.value && object.objectType === activeType.value)) {
        load();
      }
    }),
  );
}

function resetPaging() {
  currentPage.value = 1;
  cursorHistory.value = [undefined];
}

function submitQuery() {
  appliedSearch.value = draftSearch.value;
  appliedFilters.value = { ...draftFilters.value };
  resetPaging();
  load();
}

function onSearchInput(event: Event) {
  draftSearch.value = (event.target as HTMLInputElement).value;
  if (props.searchMode === "live") submitQuery();
}

function onFilterChange(key: string, value: string, immediate = false) {
  draftFilters.value = { ...draftFilters.value, [key]: value };
  if (props.searchMode === "live" || immediate) submitQuery();
}

function goPage(nextPage: number) {
  if (nextPage < 1 || nextPage === currentPage.value) return;
  if (nextPage > currentPage.value && nextCursor.value !== undefined) {
    cursorHistory.value[nextPage - 1] = nextCursor.value;
  }
  if (nextCursor.value === undefined && nextPage > totalPages.value) return;
  currentPage.value = nextPage;
  load();
}

function choose(row: PlatformObjectRecord) {
  const identity = rowIdentityKey(row);
  const next = props.toggleable && chosenIdentity.value === identity
    ? null
    : { className: rowClassName(row), primaryKey: row.primaryKey };
  setSelected(next);
}

function selectWithoutToggle(row: PlatformObjectRecord) {
  setSelected({ className: rowClassName(row), primaryKey: row.primaryKey });
}

function toggleChecked(row: PlatformObjectRecord, checked: boolean) {
  const identity = rowIdentityKey(row);
  if (checked) {
    if (checkedIdentityKeys.value.has(identity)) return;
    setChecked([...checkedRefs.value, { className: rowClassName(row), primaryKey: row.primaryKey }]);
  } else {
    setChecked(checkedRefs.value.filter((item) => refKey(item) !== identity));
  }
}

function toggleAllVisible(checked: boolean) {
  const visibleKeys = new Set(rows.value.map(rowIdentityKey));
  if (checked) {
    const added = rows.value
      .filter((row) => !checkedIdentityKeys.value.has(rowIdentityKey(row)))
      .map((row) => ({ className: rowClassName(row), primaryKey: row.primaryKey }));
    setChecked([...checkedRefs.value, ...added]);
  } else {
    setChecked(checkedRefs.value.filter((item) => !visibleKeys.has(refKey(item))));
  }
}

function clearChecked() {
  setChecked([]);
}

function navigateTo(reference: PlatformFieldReference, columnKey: string) {
  const targetState =
    slotOutputState(panel.manifest, slot.slot, columnKey)
    ?? slotOutputState(panel.manifest, slot.slot, "navigate");
  if (targetState) {
    panel.instance.state.set(targetState, { className: reference.className, primaryKey: reference.primaryKey });
  }
  emit("navigate", reference, columnKey);
}

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
        v-if="searchable"
        type="search"
        class="sdk-object-list-search"
        :value="draftSearch"
        :placeholder="searchPlaceholder ?? t('platform.listSearchPlaceholder')"
        :aria-label="searchPlaceholder ?? t('platform.listSearchPlaceholder')"
        @input="onSearchInput"
        @keydown.enter.prevent="submitQuery"
      />
      <template v-for="filter in resolvedFilters" :key="filter.key">
        <div
          v-if="filter.kind === 'tabs'"
          role="tablist"
          class="sdk-object-list-tabs"
          :aria-label="filter.label"
        >
          <button
            v-for="option in filter.options ?? []"
            :key="option.value"
            type="button"
            role="tab"
            class="sdk-object-list-tab"
            :aria-selected="(draftFilters[filter.key] ?? '') === option.value"
            :class="{ active: (draftFilters[filter.key] ?? '') === option.value }"
            @click="onFilterChange(filter.key, option.value, true)"
          >
            <span>{{ option.label }}</span>{{ " " }}<span v-if="option.count !== undefined" class="sdk-object-list-tab-count">{{ option.count }}</span>
          </button>
        </div>
        <select
          v-else
          class="sdk-object-list-select"
          :value="draftFilters[filter.key] ?? ''"
          :aria-label="filter.label"
          @change="onFilterChange(filter.key, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ filter.label }}</option>
          <option v-for="option in filter.options ?? []" :key="option.value" :value="option.value">
            {{ option.count !== undefined ? `${option.label} (${option.count})` : option.label }}
          </option>
        </select>
      </template>
      <button
        v-if="searchMode === 'submit' && (searchable || resolvedFilters.length > 0)"
        type="button"
        class="sdk-object-list-btn sdk-object-list-query"
        @click="submitQuery"
      >
        {{ t("platform.listQuery") }}
      </button>
      <button
        v-if="refreshable"
        type="button"
        class="sdk-object-list-btn sdk-object-list-refresh"
        @click="load"
      >
        {{ t("platform.listRefresh") }}
      </button>
      <span v-if="showCount && isCountReady" class="sdk-object-list-count" role="status">
        {{ t("platform.listTotal", { count: total }) }}
      </span>
      <slot name="toolbar-actions"></slot>
    </div>

    <div v-if="selectable && (!isTable || checkedRefs.length > 0)" class="sdk-object-list-selection-bar">
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

    <p v-if="!rowsData && !frameFailure && dynamicTypeMode && !activeType" class="sdk-object-list-status" data-status="no-type">
      {{ emptyTypeText ? panel.t(emptyTypeText) : t("platform.listSelectTypePrompt") }}
    </p>
    <p
      v-else-if="!rowsData && !frameFailure && !frameLoading && queryStatus !== 'ok'"
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
            <th v-if="selectable" class="sdk-object-list-check-col">
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
            <th v-for="column in columns" :key="column.key">{{ column.label }}</th>
            <th v-if="rowActionLabel" class="sdk-object-list-action-col"></th>
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
            <td v-if="selectable" class="sdk-object-list-check-col" @click.stop>
              <input
                type="checkbox"
                :aria-label="row.label"
                :checked="checkedIdentityKeys.has(rowIdentityKey(row))"
                @change="toggleChecked(row, ($event.target as HTMLInputElement).checked)"
              />
            </td>
            <td v-for="column in columns" :key="column.key">
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
                <template v-for="(part, index) in cellSegments(row, column.key, column.empty)" :key="index">
                  <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span v-else-if="column.kind === 'tags'" class="sdk-object-list-item-tags">
                <span
                  v-for="tag in row.tags?.[column.key] ?? []"
                  :key="tag"
                  class="sdk-object-list-tag"
                  data-tone="info"
                >{{ tag }}</span>
                <template v-if="!(row.tags?.[column.key]?.length)">{{ column.empty ?? "—" }}</template>
              </span>
              <div v-else class="sdk-object-list-cell">
                <span class="sdk-object-list-cell-main">
                  <template v-for="(part, index) in cellSegments(row, column.key, column.empty)" :key="index">
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
            <td v-if="rowActionLabel" class="sdk-object-list-action-col" @click.stop>
              <button
                type="button"
                class="sdk-object-list-link-btn sdk-object-list-row-action"
                @click="selectWithoutToggle(row)"
              >
                {{ rowActionLabel }}
              </button>
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
          v-if="selectable"
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
          <span v-if="row.subtitle" class="sdk-object-list-item-sub">
            <template v-for="(part, index) in textHighlightSegments(row.subtitle, row.highlights?.subtitle)" :key="index">
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

    <nav v-if="showPagination && !rowsData && !frameLoading && !frameFailure" class="sdk-object-list-pagination">
      <button
        type="button"
        class="sdk-object-list-btn sdk-object-list-prev"
        :disabled="currentPage <= 1"
        @click="goPage(currentPage - 1)"
      >
        {{ t("platform.listPrevPage") }}
      </button>
      <span class="sdk-object-list-page-info">
        {{ t("platform.listPagination", { page: currentPage, pages: totalPages }) }}
      </span>
      <button
        type="button"
        class="sdk-object-list-btn sdk-object-list-next"
        :disabled="nextCursor === undefined && currentPage >= totalPages"
        @click="goPage(currentPage + 1)"
      >
        {{ t("platform.listNextPage") }}
      </button>
    </nav>
  </div>
</template>

<style scoped>
.sdk-object-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sdk-object-list-toolbar {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.sdk-object-list-search,
.sdk-object-list-select {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  color: var(--el-text-color-primary);
  font-size: var(--el-font-size-base, 13px);
  min-height: 30px;
  padding: 4px 8px;
}
.sdk-object-list-search {
  flex: 1 1 160px;
  min-width: 120px;
}
.sdk-object-list-tabs {
  background: var(--el-fill-color-light);
  border-radius: 6px;
  display: inline-flex;
  gap: 2px;
  padding: 2px;
}
.sdk-object-list-tab {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  display: inline-flex;
  font-size: var(--el-font-size-small, 12px);
  gap: 4px;
  padding: 4px 8px;
}
.sdk-object-list-tab.active {
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-weight: 500;
}
.sdk-object-list-tab-count {
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
.sdk-object-list-btn {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  color: var(--el-text-color-primary);
  cursor: pointer;
  font-size: var(--el-font-size-small, 12px);
  min-height: 30px;
  padding: 4px 10px;
}
.sdk-object-list-btn:hover:not(:disabled) {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
.sdk-object-list-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.sdk-object-list-count,
.sdk-object-list-selected-count,
.sdk-object-list-page-info {
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-small, 12px);
  font-variant-numeric: tabular-nums;
}
.sdk-object-list-selection-bar {
  align-items: center;
  border-bottom: 1px solid var(--el-border-color-lighter);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 2px 6px;
}
.sdk-object-list-select-all {
  align-items: center;
  cursor: pointer;
  display: inline-flex;
  font-size: var(--el-font-size-small, 12px);
  gap: 6px;
}
.sdk-object-list-batch-actions {
  align-items: center;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}
.sdk-object-list-link-btn,
.sdk-object-ref-link {
  background: none;
  border: 0;
  color: var(--el-color-primary);
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
  font-size: var(--el-font-size-base, 13px);
  width: 100%;
}
.sdk-object-list-table th,
.sdk-object-list-table td {
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding: 8px 10px;
  text-align: left;
  vertical-align: middle;
}
.sdk-object-list-table th {
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-small, 12px);
  font-weight: 500;
}
.sdk-object-list-table tbody tr {
  cursor: pointer;
}
.sdk-object-list-table tbody tr:hover {
  background: var(--el-fill-color-light);
}
.sdk-object-list-table tbody tr.chosen {
  background: var(--el-color-primary-light-9);
}
.sdk-object-list-check-col {
  width: 32px;
}
.sdk-object-list-action-col {
  text-align: right;
  white-space: nowrap;
}
.sdk-object-list-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sdk-object-list-cell-sub,
.sdk-object-list-item-sub {
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-small, 12px);
}
.sdk-object-list-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.sdk-object-list-row {
  align-items: flex-start;
  display: flex;
  gap: 6px;
}
.sdk-object-list-row-check {
  margin-top: 9px;
}
.sdk-object-list-item-btn {
  background: none;
  border: 0;
  border-radius: 4px;
  color: var(--el-text-color-primary);
  cursor: pointer;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  text-align: left;
  width: 100%;
}
.sdk-object-list-item-btn:hover {
  background: var(--el-fill-color-light);
}
.sdk-object-list-item-btn.chosen {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.sdk-object-list-item-head {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  width: 100%;
}
.sdk-object-list-item-tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
.sdk-object-list-tag {
  background: var(--el-fill-color-light);
  border-radius: 4px;
  color: var(--el-text-color-regular);
  display: inline-block;
  font-size: 11px;
  line-height: 1.4;
  padding: 1px 6px;
  white-space: nowrap;
}
.sdk-object-list-tag[data-tone="info"] {
  background: var(--el-color-info-light-9);
  color: var(--el-color-info);
}
.sdk-object-list-tag[data-tone="success"] {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.sdk-object-list-tag[data-tone="warning"] {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}
.sdk-object-list-tag[data-tone="danger"] {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.sdk-object-list-pagination {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 4px;
}
.sdk-object-list-status {
  align-items: center;
  color: var(--el-text-color-secondary);
  display: flex;
  flex-wrap: wrap;
  font-size: var(--el-font-size-small, 12px);
  gap: 6px;
  margin: 0;
  padding: 12px 4px;
}
.sdk-object-list-status[data-status="refused"] {
  color: var(--el-color-warning);
}
.sdk-object-list-status[data-status="failed"] {
  color: var(--el-color-danger);
}
.sdk-object-list-status-reason {
  color: var(--el-text-color-secondary);
}
mark {
  background: var(--el-color-warning-light-7, #f8e3c5);
  border-radius: 2px;
  color: inherit;
  padding: 0 1px;
}
</style>
