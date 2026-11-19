<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { PanelChildObjectIdentity, PanelObjectIdentity, PanelStateValue } from "@ontomato/contracts/panel-manifest";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import {
  slotInputState,
  slotOutputState,
  usePanelContext,
  useProjectionObjects,
  useProjectionSlot,
} from "../panel/context";
import {
  adapterPart,
  type PlatformFieldReference,
  type PlatformGraphStatus,
  type PlatformObjectFacet,
  type PlatformObjectQuery,
  type PlatformObjectQueryResult,
  type PlatformObjectRecord,
} from "../panel/platform-objects";
import { isPanelChildObjectValue, isPanelObjectValue } from "../panel/state";
import type { ObjectListColumn, ObjectListFilter, ObjectListRef } from "./object-list-types";
import { textHighlightSegments } from "./text-highlight";

type ObjectListSelection = ObjectListRef | PanelChildObjectIdentity;

/**
 * Platform objects of the bound type as an interactive list or multi-column table. The resource adapter owns all query
 * semantics (search, filtering, facet counts, highlight ranges and pagination); this component only provides UI
 * interaction and keeps the viewing selection (`selected`) separate from explicit multi-selection (`checked`).
 */
const props = withDefaults(
  defineProps<{
    /** Dynamic object type ID (e.g. `"platform:Action"`) queried through the bound adapter's `query` port. */
    type?: string | null;
    /** Slot input whose panel state holds the single selected object when `outputs.selected` is not declared. */
    input?: string;
    /** Slot input whose panel state holds the parent object when listing a declared child collection. */
    parentInput?: string;
    /** Declared child collection name owned by the parent type (e.g. `"issues"`). */
    collection?: string;
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
    /** Slot input/output port name for the search keyword bound to a scalar panel state (defaults to `"search"`). */
    searchPort?: string;
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
    collection: undefined,
    clears: undefined,
    columns: undefined,
    statusField: undefined,
    tagsField: undefined,
    searchable: false,
    searchPort: "search",
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
  "update:selected": [value: ObjectListSelection | null];
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
const objects = useProjectionObjects();
const objectType = slot.projection.binding.id;

const rows = shallowRef<readonly PlatformObjectRecord[]>([]);
const total = ref(0);
const resultFieldLabels = shallowRef<Readonly<Record<string, string>>>({});
const dynamicFacets = shallowRef<readonly PlatformObjectFacet[]>([]);
const nextCursor = ref<string | undefined>(undefined);
const loading = ref(true);
const failure = shallowRef<Error | null>(null);
const queryStatus = ref<PlatformGraphStatus>("ok");
const queryReason = ref<string | undefined>(undefined);

const currentPage = ref(1);
const cursorHistory = ref<(string | undefined)[]>([undefined]);

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

const searchPortName = computed(() => props.searchPort || "search");
const searchReadState = computed(
  () => slotInputState(panel.manifest, slot.slot, searchPortName.value)
    ?? slotOutputState(panel.manifest, slot.slot, searchPortName.value),
);
const searchWriteState = computed(() => slotOutputState(panel.manifest, slot.slot, searchPortName.value));

interface FilterStateBinding {
  readonly key: string;
  readonly port: string;
  readonly defaultValue: string;
  readonly readState: string | null;
  readonly writeState: string | null;
}

const filterStateBindings = computed<readonly FilterStateBinding[]>(() => {
  const seenKeys = new Set<string>();
  const seenPorts = new Set<string>();
  const list: FilterStateBinding[] = [];
  const add = (key: string, port: string, defaultValue: string) => {
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    seenPorts.add(port);
    const readState = slotInputState(panel.manifest, slot.slot, port)
      ?? slotOutputState(panel.manifest, slot.slot, port);
    const writeState = slotOutputState(panel.manifest, slot.slot, port);
    list.push({ key, port, defaultValue, readState, writeState });
  };
  for (const filter of props.filters ?? []) {
    add(filter.key, filter.port ?? filter.key, filter.defaultValue ?? "");
  }
  for (const facet of dynamicFacets.value) {
    add(facet.key, facet.key, "");
  }
  const declaration = panel.manifest.slots[slot.slot];
  if (declaration) {
    const reserved = new Set<string>([
      "selected",
      "checked",
      "navigate",
      "type",
      searchPortName.value,
      ...(props.input ? [props.input] : []),
      ...(props.parentInput ? [props.parentInput] : []),
    ]);
    const portEntries = [
      ...Object.entries(declaration.inputs),
      ...Object.entries(declaration.outputs ?? {}),
    ];
    for (const [port, stateRef] of portEntries) {
      if (reserved.has(port) || seenPorts.has(port)) continue;
      if (panel.manifest.state[stateRef.state]?.kind !== "scalar") continue;
      add(port, port, "");
    }
  }
  return list;
});

const hasQueryStateBinding = computed(
  () => searchReadState.value !== null || filterStateBindings.value.some((binding) => binding.readState !== null),
);

function scalarStateToText(stateName: string | null, fallback = ""): string {
  if (!stateName) return fallback;
  const value = panel.instance.state.values.value[stateName];
  if (value === null || value === undefined || typeof value === "object") return fallback;
  return String(value);
}

function textToScalarState(stateName: string, text: string): PanelStateValue {
  const field = panel.manifest.state[stateName];
  if (!field || field.kind !== "scalar") {
    throw new TypeError(`ObjectList query state '${stateName}' must be a scalar panel state`);
  }
  if (text === "") return null;
  if (field.type === "number") return Number(text);
  if (field.type === "boolean") return text === "true";
  return text;
}

const initialSearch = (): string => scalarStateToText(searchReadState.value, "");

const initialFilters = (): Record<string, string> => {
  const next: Record<string, string> = {};
  for (const binding of filterStateBindings.value) {
    const value = scalarStateToText(binding.readState, binding.defaultValue);
    if (value !== "") next[binding.key] = value;
  }
  return next;
};

const draftSearch = ref(initialSearch());
const draftFilters = ref<Record<string, string>>(initialFilters());
const appliedSearch = ref(draftSearch.value);
const appliedFilters = ref<Record<string, string>>({ ...draftFilters.value });

const selectedState = computed(() => {
  const output = slotOutputState(panel.manifest, slot.slot, "selected");
  if (output) return output;
  if (props.input) return slotInputState(panel.manifest, slot.slot, props.input);
  if (dynamicTypeMode.value || props.parentInput || props.collection || hasQueryStateBinding.value) {
    return slotInputState(panel.manifest, slot.slot, "selected");
  }
  const fallback = slotInputState(panel.manifest, slot.slot);
  if (fallback && panel.manifest.state[fallback]?.kind === "scalar") return null;
  return fallback;
});
const selectedField = computed(() => (selectedState.value ? panel.manifest.state[selectedState.value] : undefined));
const childCollection = computed<string | null>(() => {
  if (props.collection) return props.collection;
  return selectedField.value?.kind === "child-object" ? selectedField.value.collection : null;
});
const childMode = computed(() => Boolean(props.parentInput || childCollection.value));
const parentState = computed(
  () => (props.parentInput ? slotInputState(panel.manifest, slot.slot, props.parentInput) : null),
);
const parentRef = computed<PanelObjectIdentity | null>(() => {
  if (!parentState.value) return null;
  const value = panel.instance.state.values.value[parentState.value];
  return isPanelObjectValue(value) ? { objectType: value.className, primaryKey: value.primaryKey } : null;
});
const parentIdentity = computed(() => (parentRef.value ? `${parentRef.value.objectType}\u0000${parentRef.value.primaryKey}` : ""));
const checkedState = computed(() => slotOutputState(panel.manifest, slot.slot, "checked"));
const localSelected = shallowRef<ObjectListSelection | null>(null);
const localChecked = shallowRef<readonly ObjectListRef[]>([]);

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

function rowSelectionValue(row: PlatformObjectRecord): ObjectListSelection {
  if (childMode.value && parentRef.value) {
    return { parent: parentRef.value, primaryKey: row.primaryKey };
  }
  return { className: rowClassName(row), primaryKey: row.primaryKey };
}

function rowIdentityKey(row: PlatformObjectRecord): string {
  return selectionIdentity(rowSelectionValue(row))!;
}

const chosenRef = computed<ObjectListSelection | null>(() => {
  if (selectedState.value) {
    const value = panel.instance.state.values.value[selectedState.value];
    if (isPanelChildObjectValue(value)) return value;
    if (isPanelObjectValue(value)) return value;
    return null;
  }
  return localSelected.value;
});
const chosenIdentity = computed<string | null>(() => selectionIdentity(chosenRef.value));

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
  () =>
    dynamicTypeMode.value
    || childMode.value
    || hasQueryStateBinding.value
    || props.searchable
    || Boolean(props.filters?.length)
    || (props.pageSize !== undefined && props.pageSize > 0),
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

const ownerFieldLabels = computed<Readonly<Record<string, string>>>(() => ({
  ...(rows.value[0]?.fieldLabels ?? {}),
  ...resultFieldLabels.value,
}));

function columnLabel(column: ObjectListColumn): string {
  if (column.labelKey) return panelText(column.labelKey);
  return ownerFieldLabels.value[column.key] ?? column.key;
}

function columnEmpty(column: ObjectListColumn): string {
  return column.emptyKey ? panelText(column.emptyKey) : "—";
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

function setSelected(next: ObjectListSelection | null) {
  if (selectedState.value) {
    const changed = selectionIdentity(next) !== chosenIdentity.value;
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
    ...(childMode.value && parentRef.value ? { parent: parentRef.value } : {}),
    ...(childMode.value && childCollection.value ? { collection: childCollection.value } : {}),
    ...(dynamicTypeMode.value && activeType.value ? { objectType: activeType.value } : {}),
    ...(search ? { search } : {}),
    ...(Object.keys(activeFilters).length ? { filters: activeFilters } : {}),
    ...(page ? { page } : {}),
  };
}

let requestSeq = 0;

function load() {
  const seq = ++requestSeq;
  failure.value = null;
  queryStatus.value = "ok";
  queryReason.value = undefined;
  if ((dynamicTypeMode.value && !activeType.value) || (childMode.value && !parentRef.value)) {
    rows.value = [];
    total.value = 0;
    nextCursor.value = undefined;
    loading.value = false;
    return;
  }
  if (requiresQuery.value) {
    try {
      adapterPart(objectType, "query");
    } catch (reason: unknown) {
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
      loading.value = false;
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
      rows.value = status === "ok" ? result.items : [];
      total.value = status === "ok" ? result.total : 0;
      resultFieldLabels.value = status === "ok" ? (result.fieldLabels ?? {}) : {};
      if (result.facets) dynamicFacets.value = result.facets;
      nextCursor.value = status === "ok" ? result.nextCursor : undefined;
      loading.value = false;
      emit("query", activeQuery, result);

      if (props.fallbackToFirst && status === "ok") {
        const stillVisible = chosenIdentity.value !== null && result.items.some((item) => rowIdentityKey(item) === chosenIdentity.value);
        if (!stillVisible) {
          const preferred = result.defaultPrimaryKey
            ? result.items.find((item) => item.primaryKey === result.defaultPrimaryKey)
            : undefined;
          const fallback = preferred ?? result.items[0];
          const next = fallback ? rowSelectionValue(fallback) : null;
          if (selectionIdentity(next) !== chosenIdentity.value) setSelected(next);
        }
      }
    },
    (reason: unknown) => {
      if (seq !== requestSeq) return;
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
      loading.value = false;
    },
  );
}

function syncQueryToState() {
  const patch: Record<string, PanelStateValue> = {};
  if (searchWriteState.value) {
    const next = textToScalarState(searchWriteState.value, appliedSearch.value.trim());
    if (panel.instance.state.values.value[searchWriteState.value] !== next) {
      patch[searchWriteState.value] = next;
    }
  }
  for (const binding of filterStateBindings.value) {
    if (!binding.writeState) continue;
    const next = textToScalarState(binding.writeState, appliedFilters.value[binding.key] ?? "");
    if (panel.instance.state.values.value[binding.writeState] !== next) {
      patch[binding.writeState] = next;
    }
  }
  if (Object.keys(patch).length > 0) {
    panel.instance.state.setState(patch);
  }
}

const boundQuerySnapshot = computed(() => {
  const search = searchReadState.value ? scalarStateToText(searchReadState.value, "") : null;
  const filters: Record<string, string> = {};
  for (const binding of filterStateBindings.value) {
    if (!binding.readState) continue;
    filters[binding.key] = scalarStateToText(binding.readState, binding.defaultValue);
  }
  return { search, filters };
});

watch(
  boundQuerySnapshot,
  (snapshot) => {
    let changed = false;
    if (snapshot.search !== null && snapshot.search !== appliedSearch.value.trim()) {
      draftSearch.value = snapshot.search;
      appliedSearch.value = snapshot.search;
      changed = true;
    }
    const nextDraftFilters = { ...draftFilters.value };
    const nextAppliedFilters = { ...appliedFilters.value };
    for (const [key, value] of Object.entries(snapshot.filters)) {
      if ((appliedFilters.value[key] ?? "") !== value) {
        nextDraftFilters[key] = value;
        nextAppliedFilters[key] = value;
        changed = true;
      }
    }
    if (changed) {
      draftFilters.value = nextDraftFilters;
      appliedFilters.value = nextAppliedFilters;
      resetPaging();
      load();
    }
  },
  { deep: true },
);

onMounted(load);
watch(parentIdentity, () => {
  if (!childMode.value) return;
  resetPaging();
  load();
});
watch(activeType, (next, prev) => {
  if (next === prev) return;
  draftSearch.value = "";
  appliedSearch.value = "";
  const defaults = Object.fromEntries(
    (props.filters ?? [])
      .filter((filter) => filter.defaultValue !== undefined)
      .map((filter) => [filter.key, filter.defaultValue!]),
  );
  draftFilters.value = defaults;
  appliedFilters.value = { ...defaults };
  syncQueryToState();
  dynamicFacets.value = [];
  resultFieldLabels.value = {};
  resetPaging();
  rows.value = [];
  total.value = 0;
  nextCursor.value = undefined;
  loading.value = Boolean(next);
  load();
});
onBeforeUnmount(
  panel.instance.onObjectChanged((object) => {
    if (!object || object.objectType === objectType || (activeType.value && object.objectType === activeType.value)) {
      load();
    }
  }),
);

function resetPaging() {
  currentPage.value = 1;
  cursorHistory.value = [undefined];
}

function submitQuery() {
  appliedSearch.value = draftSearch.value;
  appliedFilters.value = { ...draftFilters.value };
  syncQueryToState();
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
    : rowSelectionValue(row);
  setSelected(next);
}

function selectWithoutToggle(row: PlatformObjectRecord) {
  setSelected(rowSelectionValue(row));
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
        :placeholder="searchPlaceholder ? panelText(searchPlaceholder) : t('platform.listSearchPlaceholder')"
        :aria-label="searchPlaceholder ? panelText(searchPlaceholder) : t('platform.listSearchPlaceholder')"
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
      <span v-if="showCount && hasActiveType && queryStatus === 'ok' && !loading && !failure" class="sdk-object-list-count" role="status">
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

    <p v-if="failure" role="alert" class="sdk-object-list-error">{{ failure.message }}</p>
    <p v-else-if="dynamicTypeMode && !activeType" class="sdk-object-list-status" data-status="no-type">
      {{ emptyTypeText ? panel.t(emptyTypeText) : t("platform.listSelectTypePrompt") }}
    </p>
    <el-skeleton v-else-if="loading" :rows="3" animated></el-skeleton>
    <p
      v-else-if="queryStatus !== 'ok'"
      class="sdk-object-list-status"
      :data-status="queryStatus"
      :role="queryStatus === 'failed' ? 'alert' : 'status'"
    >
      <span class="sdk-object-list-status-label">{{ queryStatusLabel }}</span>
      <span v-if="queryReason" class="sdk-object-list-status-reason">{{ queryReason }}</span>
    </p>
    <el-empty v-else-if="!rows.length" :description="emptyText ? panel.t(emptyText) : undefined" :image-size="48"></el-empty>

    <div v-else-if="isTable" class="sdk-object-list-table-wrap">
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
            <th v-for="column in columns" :key="column.key">{{ columnLabel(column) }}</th>
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
                <template v-for="(part, index) in cellSegments(row, column.key, columnEmpty(column))" :key="index">
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
            <td v-if="rowActionLabel" class="sdk-object-list-action-col" @click.stop>
              <button
                type="button"
                class="sdk-object-list-link-btn sdk-object-list-row-action"
                @click="selectWithoutToggle(row)"
              >
                {{ panelText(rowActionLabel) }}
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

    <nav v-if="showPagination && !loading && !failure" class="sdk-object-list-pagination">
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
.sdk-object-list-error {
  color: var(--el-color-danger);
  margin: 0;
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
