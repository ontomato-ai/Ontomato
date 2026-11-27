<script setup lang="ts">
import { computed, inject, nextTick, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElCheckbox } from "element-plus/es/components/checkbox/index";
import { ElDialog } from "element-plus/es/components/dialog/index";
import { ElInput } from "element-plus/es/components/input/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormOption } from "@ontomato/contracts/form-fields";
import { directReadDeclaration, type PanelOptionList } from "@ontomato/contracts/panel-projection";
import { appIcon } from "@ontomato/platform-shell/icons";
import { panelContextKey } from "../panel/context";
import { panelMemberKey, useMemberParam, useMemberRead } from "../panel/member";
import type { PlatformObjectOption, PlatformObjectRecord } from "../panel/platform-objects";
import { memberReadKey } from "../panel/direct";
import { parseCollectionRecords } from "./collection-data";
import { readConfigString, resolveLocalizedText } from "./localized-text";

/**
 * Centered multi-select dialog for "pick items to add" flows across the platform (role members/policies, policy
 * objects/classes, agent skills/tools/policies). Panels place it as a projection member bound to an owner's
 * `options` (`panelOptionList`) or `rows` (`panelRecordList` / `panelRecordQuery`) read, or supply `PanelFormOption[]`
 * directly via `:options`.
 *
 * - **Automatic search without configuration**: when the owner returns a complete list, search filters in memory with
 *   no extra request; when the owner signals truncation (`total > loaded`, `hasMore`, or `nextCursor`), the search term
 *   is sent back to the owner (`keyword` on `options`, or `keyword`/`search` on `rows`) and a truncation notice prompts
 *   the reader to search to narrow results.
 * - **Selection & unavailable rows**: items already in `selected` are pre-checked on open; unavailable items remain
 *   listed with disabled checkboxes and their `disabledReason` shown inline in the row's secondary description (never a
 *   hover tooltip). Confirm stays disabled until the selection differs from when the dialog opened, then writes
 *   `selected`, closes `open`, and emits `@confirm` with the chosen primary-key array.
 * - **Agent parity (standard 2.4.2)**: `open` and `selected` bind to public panel state through the same `state` port
 *   wiring used by `ObjectList`, so agents can inspect and update them. When confirming triggers an owner write, the
 *   panel invokes a registered panel operation whose parameter comes from `selected` (`PickerDialog` never calls owners
 *   directly) so human confirm and agent `page_action` run the same operation. When confirming fills a form field,
 *   agents edit the form directly without going through the dialog.
 */
const props = withDefaults(
  defineProps<{
    /** Fallback dialog title when `titleKey` resolves no text. */
    title?: string;
    /** Panel message key (resolved via `panel.t`) or platform i18n key for the dialog title. */
    titleKey?: string;
    /** Fallback confirm button label template (supports `{count}`) when `confirmLabelKey` resolves no text. */
    confirmLabel?: string;
    /** Panel message key (resolved via `panel.t`) or platform i18n key for the confirm button label (supports `{count}`). */
    confirmLabelKey?: string;
    /** Fallback placeholder for the search input when `searchPlaceholderKey` resolves no text. */
    searchPlaceholder?: string;
    /** Panel message key (resolved via `panel.t`) or platform i18n key for the search input placeholder. */
    searchPlaceholderKey?: string;
    /** Panel message key or fallback text shown when no candidates are available. */
    emptyText?: string;
    /** Dialog width (CSS length, defaults to `"520px"`). */
    width?: string;
    /** Explicit candidate options (`PanelFormOption[]`) used when no `options` or `rows` datum is bound. */
    options?: readonly PanelFormOption[];
    /** Controlled open state; in a panel projection, bound to public panel state via `state.open`. */
    open?: boolean;
    /** Controlled selected primary keys; in a panel projection, bound to public panel state via `state.selected`. */
    selected?: readonly string[];
  }>(),
  {
    title: undefined,
    titleKey: undefined,
    confirmLabel: undefined,
    confirmLabelKey: undefined,
    searchPlaceholder: undefined,
    searchPlaceholderKey: undefined,
    emptyText: undefined,
    width: "520px",
    options: undefined,
    open: undefined,
    selected: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when the dialog opens or closes. */
  "update:open": [open: boolean];
  /** Emitted on confirm with the selected primary keys. */
  "update:selected": [keys: string[]];
  /** Emitted when the reader confirms a changed selection, carrying the selected primary-key array. */
  confirm: [keys: string[]];
  /** Emitted when the dialog is dismissed without confirming. */
  cancel: [];
}>();

defineSlots<{
  /** Optional placement-specific controls (e.g. a shared grant level) whose values live in the panel's own state. */
  extra?(props: { selected: readonly string[]; count: number; changed: boolean }): unknown;
}>();

const { t: tLocal } = useI18n({
  useScope: "local",
  messages: {
    en: {
      pickerTitle: "Select items",
      pickerSelectedCount: "{count} selected",
      pickerConfirmCount: "Confirm ({count})",
      pickerTruncated: "Showing the first {loaded} items. Search to narrow results.",
      pickerTruncatedWithTotal: "Showing {loaded} of {total} items. Search to narrow results.",
    },
    "zh-CN": {
      pickerTitle: "选择项目",
      pickerSelectedCount: "已选 {count} 项",
      pickerConfirmCount: "确认 ({count})",
      pickerTruncated: "仅显示前 {loaded} 项，请搜索缩小范围",
      pickerTruncatedWithTotal: "已显示 {loaded} / {total} 项，请搜索缩小范围",
    },
    "zh-TW": {
      pickerTitle: "選擇項目",
      pickerSelectedCount: "已選 {count} 項",
      pickerConfirmCount: "確認 ({count})",
      pickerTruncated: "僅顯示前 {loaded} 項，請搜尋縮小範圍",
      pickerTruncatedWithTotal: "已顯示 {loaded} / {total} 項，請搜尋縮小範圍",
    },
    ja: {
      pickerTitle: "項目を選択",
      pickerSelectedCount: "{count} 件選択中",
      pickerConfirmCount: "確定 ({count})",
      pickerTruncated: "先頭 {loaded} 件を表示しています。検索して絞り込んでください",
      pickerTruncatedWithTotal: "{total} 件中 {loaded} 件を表示しています。検索して絞り込んでください",
    },
    ar: {
      pickerTitle: "تحديد العناصر",
      pickerSelectedCount: "تم تحديد {count}",
      pickerConfirmCount: "تأكيد ({count})",
      pickerTruncated: "يتم عرض أول {loaded} عنصر. ابحث لتضييق النتائج.",
      pickerTruncatedWithTotal: "يتم عرض {loaded} من {total} عنصر. ابحث لتضييق النتائج.",
    },
    fr: {
      pickerTitle: "Sélectionner des éléments",
      pickerSelectedCount: "{count} sélectionné(s)",
      pickerConfirmCount: "Confirmer ({count})",
      pickerTruncated: "Affichage des {loaded} premiers éléments. Recherchez pour affiner les résultats.",
      pickerTruncatedWithTotal: "Affichage de {loaded} sur {total} éléments. Recherchez pour affiner les résultats.",
    },
    de: {
      pickerTitle: "Elemente auswählen",
      pickerSelectedCount: "{count} ausgewählt",
      pickerConfirmCount: "Bestätigen ({count})",
      pickerTruncated: "Die ersten {loaded} Einträge werden angezeigt. Suchen Sie, um die Ergebnisse einzugrenzen.",
      pickerTruncatedWithTotal: "{loaded} von {total} Einträgen werden angezeigt. Suchen Sie, um die Ergebnisse einzugrenzen.",
    },
    it: {
      pickerTitle: "Seleziona elementi",
      pickerSelectedCount: "{count} selezionati",
      pickerConfirmCount: "Conferma ({count})",
      pickerTruncated: "Visualizzazione dei primi {loaded} elementi. Cerca per restringere i risultati.",
      pickerTruncatedWithTotal: "Visualizzazione di {loaded} di {total} elementi. Cerca per restringere i risultati.",
    },
  },
});

const { t: tGlobal, te: teGlobal, locale } = useI18n({ useScope: "global" });
const searchIcon = appIcon("search");

const panel = inject(panelContextKey, null);
const memberGetter = inject(panelMemberKey, null);
const member = memberGetter ? memberGetter() : null;
const placement = member && panel ? panel.manifest.members[member.key] : undefined;

const openParam = member ? useMemberParam("open") : null;
const selectedParam = member ? useMemberParam("selected") : null;

const rawConfig = computed<Readonly<Record<string, unknown>> | undefined>(() => {
  const cfg = member?.projection.config;
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : undefined;
});

const localized = (text: string) => (teGlobal(text) ? tGlobal(text) : text);

function globalLabel(key: string, fallback: string): string {
  return teGlobal(key) ? tGlobal(key) : fallback;
}

function optionKey(option: PanelFormOption): string {
  if (typeof option.value === "string") return option.value;
  if (typeof option.value === "number") return String(option.value);
  return JSON.stringify(option.value);
}

function optionNote(option: PanelFormOption): string {
  return [option.description, option.disabledReason].filter(Boolean).join(" · ");
}

function normalizeSelection(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const key = typeof item === "string" ? item : typeof item === "number" ? String(item) : null;
    if (key !== null && key.length > 0 && !seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}

function sameSelection(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((key) => set.has(key));
}

// ---- Public state ports (`open` and `selected`) ----
const isOpen = computed<boolean>(() => {
  if (props.open !== undefined) return Boolean(props.open);
  if (openParam) return Boolean(openParam.value.value);
  return false;
});

const boundSelected = computed<string[]>(() => {
  if (props.selected !== undefined) return normalizeSelection(props.selected);
  if (selectedParam) return normalizeSelection(selectedParam.value.value);
  return [];
});

function writeOpen(next: boolean) {
  if (member && placement?.outputs?.open && panel) {
    void panel.instance.output(member.key, "open", next);
  } else if (openParam && (!placement?.inputs?.open || "state" in placement.inputs.open)) {
    openParam.set(next);
  }
  emit("update:open", next);
}

function writeSelected(next: string[]) {
  if (member && placement?.outputs?.selected && panel) {
    void panel.instance.output(member.key, "selected", next as unknown as RuntimeJsonValue);
  } else if (selectedParam && (!placement?.inputs?.selected || "state" in placement.inputs.selected)) {
    selectedParam.set(next as unknown as RuntimeJsonValue);
  }
  emit("update:selected", next);
}

// ---- Localized UI texts ----
const resolvedTitle = computed<string>(() => {
  const text = resolveLocalizedText({
    key: props.titleKey ?? readConfigString(rawConfig.value, "titleKey"),
    fallback: props.title ?? readConfigString(rawConfig.value, "title"),
    locale: locale.value,
    panelText: panel?.t,
    t: tGlobal,
    te: teGlobal,
  });
  return text || tLocal("pickerTitle");
});

const resolvedSearchPlaceholder = computed<string>(() => {
  const text = resolveLocalizedText({
    key: props.searchPlaceholderKey ?? readConfigString(rawConfig.value, "searchPlaceholderKey"),
    fallback: props.searchPlaceholder ?? readConfigString(rawConfig.value, "searchPlaceholder"),
    locale: locale.value,
    panelText: panel?.t,
    t: tGlobal,
    te: teGlobal,
  });
  return text || globalLabel("platform.listSearchPlaceholder", "Search");
});

const resolvedEmptyText = computed<string>(() => {
  const configured = props.emptyText ?? readConfigString(rawConfig.value, "emptyText");
  if (configured) {
    const resolved = resolveLocalizedText({
      key: configured,
      fallback: configured,
      locale: locale.value,
      panelText: panel?.t,
      t: tGlobal,
      te: teGlobal,
    });
    if (resolved) return resolved;
  }
  return globalLabel("platform.dataEmpty", "No data");
});

const cancelText = computed(() => globalLabel("platform.cancel", "Cancel"));
const retryText = computed(() => globalLabel("common.retry", "Retry"));
const noMatchText = computed(() => globalLabel("platform.dataNoMatch", "Nothing matches your search or filters"));

// ---- Candidate reading (`data.options`, `data.rows`, or explicit `:options`) ----
const hasOptionsDatum = Boolean(member && "options" in member.projection.data);
const hasRowsDatum = Boolean(member && "rows" in member.projection.data);
const dataMode: "options" | "rows" | "static" = hasOptionsDatum ? "options" : hasRowsDatum ? "rows" : "static";

const optionsDatum = hasOptionsDatum ? member!.projection.data.options : undefined;
const optionsDeclaration = optionsDatum ? directReadDeclaration(member!.projection, optionsDatum) : undefined;
const fixedOptionsParams = optionsDeclaration?.parameterMode === "fixed" ? optionsDeclaration.params : undefined;
const requiresOptionsKeyword = optionsDeclaration?.parameterMode === "fixed"
  && optionsDeclaration.requiredParams?.includes("keyword") === true;
const optionsSupportsKeyword = !fixedOptionsParams || "keyword" in fixedOptionsParams;
const optionsSupportsPage = !fixedOptionsParams || "page" in fixedOptionsParams;

const rowsDatum = hasRowsDatum ? member!.projection.data.rows : undefined;
const rowsDeclaration = rowsDatum ? directReadDeclaration(member!.projection, rowsDatum) : undefined;
const fixedRowsParams = rowsDeclaration?.parameterMode === "fixed" ? rowsDeclaration.params : undefined;
const requiresRowsKeyword = rowsDeclaration?.parameterMode === "fixed"
  && (rowsDeclaration.requiredParams?.includes("keyword") === true
    || rowsDeclaration.requiredParams?.includes("search") === true);
const rowsSearchParamName: "keyword" | "search" | null = !fixedRowsParams
  ? "keyword"
  : "keyword" in fixedRowsParams
    ? "keyword"
    : "search" in fixedRowsParams
      ? "search"
      : null;

const readOptions = dataMode === "options" ? useMemberRead("options") : null;
const readRows = dataMode === "rows" ? useMemberRead("rows") : null;

const PAGE_SIZE = 50;

const loadedOptions = shallowRef<readonly PanelFormOption[]>([]);
const loading = ref(false);
const unavailable = shallowRef<{ status: "forbidden" | "error" | "awaiting"; message: string } | null>(null);
const diagnostics = shallowRef<readonly string[]>([]);
const unfilteredTruncated = ref(false);
const currentTruncated = ref(false);
const currentLoadedCount = ref(0);
const currentTotalCount = ref<number | null>(null);

const requiresKeyword = dataMode === "options"
  ? requiresOptionsKeyword
  : dataMode === "rows"
    ? requiresRowsKeyword
    : false;
const remoteSearchParamName = dataMode === "options"
  ? (optionsSupportsKeyword ? "keyword" : null)
  : dataMode === "rows"
    ? rowsSearchParamName
    : null;
const usesOwnerSearch = computed(() =>
  dataMode !== "static"
  && remoteSearchParamName !== null
  && (unfilteredTruncated.value || requiresKeyword),
);

const readParamKey = computed(() => {
  if (!member || !placement || !panel || dataMode === "static") return "";
  const datum = dataMode === "options" ? optionsDatum : rowsDatum;
  if (!datum) return "";
  return memberReadKey(
    member.projection,
    datum,
    placement,
    member.inputs.value,
    panel.instance.ownParams(member.key),
  );
});

function mapPlatformOption(option: PlatformObjectOption): PanelFormOption | null {
  if (option.value === null) return null;
  const disabled = option.unavailable !== undefined;
  return {
    value: option.primaryKey,
    label: option.label || option.primaryKey,
    description: option.description ?? null,
    disabled,
    disabledReason: disabled ? localized(option.unavailable!.reason) : null,
  };
}

function mapPlatformRecord(row: PlatformObjectRecord): PanelFormOption {
  return {
    value: row.primaryKey,
    label: row.label || row.primaryKey,
    description: row.subtitle ?? null,
    disabled: false,
    disabledReason: null,
  };
}

function buildReadParams(keyword: string): Record<string, RuntimeJsonValue> {
  const params: Record<string, RuntimeJsonValue> = {};
  if (dataMode === "options") {
    if (keyword && optionsSupportsKeyword) params.keyword = keyword;
    if (optionsSupportsPage) params.page = { number: 1, size: PAGE_SIZE };
    return params;
  }
  if (keyword && rowsSearchParamName) params[rowsSearchParamName] = keyword;
  if (!fixedRowsParams || "page" in fixedRowsParams) params.page = { number: 1, size: PAGE_SIZE };
  else if ("size" in fixedRowsParams) params.size = PAGE_SIZE;
  return params;
}

let readGeneration = 0;

function loadCandidates(keyword = "") {
  if (dataMode === "static") return;
  const generation = ++readGeneration;
  const trimmed = keyword.trim();
  if (requiresKeyword && !trimmed) {
    loading.value = false;
    unavailable.value = null;
    loadedOptions.value = [];
    diagnostics.value = [];
    currentTruncated.value = false;
    currentLoadedCount.value = 0;
    currentTotalCount.value = null;
    return;
  }
  loading.value = true;
  unavailable.value = null;
  const params = buildReadParams(trimmed);
  const request = dataMode === "options" ? readOptions!(params) : readRows!(params);
  void request.then((result) => {
    if (generation !== readGeneration) return;
    loading.value = false;
    if (result.status === "ready") {
      unavailable.value = null;
      if (dataMode === "options") {
        const list = result.value as unknown as PanelOptionList;
        const mapped = list.options.flatMap((item) => {
          const converted = mapPlatformOption(item);
          return converted ? [converted] : [];
        });
        const total = typeof list.total === "number" && Number.isFinite(list.total) ? list.total : null;
        const truncated = total !== null && list.options.length < total;
        loadedOptions.value = mapped;
        diagnostics.value = list.diagnostics ?? [];
        currentLoadedCount.value = mapped.length;
        currentTotalCount.value = total;
        currentTruncated.value = truncated;
        if (!trimmed) unfilteredTruncated.value = truncated;
        return;
      }
      const parsed = parseCollectionRecords(result.value);
      const mapped = parsed.rows.map(mapPlatformRecord);
      loadedOptions.value = mapped;
      diagnostics.value = parsed.coverage.diagnostics;
      currentLoadedCount.value = parsed.coverage.loaded;
      currentTotalCount.value = parsed.coverage.total;
      currentTruncated.value = parsed.coverage.truncated;
      if (!trimmed) unfilteredTruncated.value = parsed.coverage.truncated;
      return;
    }
    if (result.status === "empty") {
      unavailable.value = null;
      loadedOptions.value = [];
      diagnostics.value = [];
      currentLoadedCount.value = 0;
      currentTotalCount.value = 0;
      currentTruncated.value = false;
      if (!trimmed) unfilteredTruncated.value = false;
      return;
    }
    if (result.status === "forbidden") {
      unavailable.value = { status: "forbidden", message: globalLabel("platform.dataForbidden", "No permission") };
      loadedOptions.value = [];
      return;
    }
    if (result.status === "awaiting") {
      unavailable.value = { status: "awaiting", message: globalLabel("platform.dataAwaiting", "Waiting for inputs") };
      loadedOptions.value = [];
      return;
    }
    if (result.status === "error") {
      unavailable.value = {
        status: "error",
        message: result.unreachable
          ? globalLabel("platform.dataUnreachable", "Unable to load data")
          : (result.message || globalLabel("platform.dataUnreachable", "Unable to load data")),
      };
      loadedOptions.value = [];
    }
  });
}

// ---- Selection draft and search ----
const searchQuery = ref("");
const initialSelection = ref<string[]>([]);
const draftSelection = ref<string[]>([]);
let closingFromConfirm = false;

const selectedSet = computed(() => new Set(draftSelection.value));
const selectedCount = computed(() => draftSelection.value.length);
const hasSelectionChanged = computed(() => !sameSelection(initialSelection.value, draftSelection.value));
const canConfirm = computed(() => hasSelectionChanged.value);

const selectedCountText = computed(() => tLocal("pickerSelectedCount", { count: selectedCount.value }));

const confirmText = computed<string>(() => {
  const count = selectedCount.value;
  const key = props.confirmLabelKey ?? readConfigString(rawConfig.value, "confirmLabelKey");
  if (key && key.trim()) {
    if (panel) {
      const fromPanel = panel.t(key, { count });
      if (fromPanel !== key) return fromPanel;
    }
    if (teGlobal(key)) return tGlobal(key, { count });
  }
  const fallback = props.confirmLabel ?? readConfigString(rawConfig.value, "confirmLabel");
  if (fallback && fallback.trim()) {
    return fallback.replace(/\{count\}/g, String(count));
  }
  return tLocal("pickerConfirmCount", { count });
});

const truncationNotice = computed<string | null>(() => {
  if (!currentTruncated.value) return null;
  if (currentTotalCount.value !== null) {
    return tLocal("pickerTruncatedWithTotal", {
      loaded: currentLoadedCount.value,
      total: currentTotalCount.value,
    });
  }
  return tLocal("pickerTruncated", { loaded: currentLoadedCount.value });
});

const sourceOptions = computed<readonly PanelFormOption[]>(() =>
  dataMode === "static" ? (props.options ?? []) : loadedOptions.value,
);

const visibleOptions = computed<readonly PanelFormOption[]>(() => {
  const list = sourceOptions.value;
  if (usesOwnerSearch.value) return list;
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return list;
  return list.filter((option) =>
    option.label.toLowerCase().includes(query)
    || optionKey(option).toLowerCase().includes(query)
    || (option.description?.toLowerCase().includes(query) ?? false)
    || (option.disabledReason?.toLowerCase().includes(query) ?? false),
  );
});

watch(
  isOpen,
  (open) => {
    if (!open) {
      readGeneration += 1;
      return;
    }
    const snapshot = [...boundSelected.value];
    initialSelection.value = snapshot;
    draftSelection.value = [...snapshot];
    searchQuery.value = "";
    unfilteredTruncated.value = false;
    currentTruncated.value = false;
    if (dataMode !== "static") loadCandidates("");
  },
  { immediate: true },
);

watch(readParamKey, () => {
  if (!isOpen.value || dataMode === "static") return;
  loadCandidates(usesOwnerSearch.value ? searchQuery.value : "");
});

watch(
  boundSelected,
  (next) => {
    if (!isOpen.value) return;
    if (!sameSelection(next, draftSelection.value)) {
      draftSelection.value = [...next];
    }
  },
);

function onSearchInput(value: string) {
  searchQuery.value = value;
  if (usesOwnerSearch.value) {
    loadCandidates(value);
  }
}

function isOptionSelected(option: PanelFormOption): boolean {
  return selectedSet.value.has(optionKey(option));
}

function toggleOption(option: PanelFormOption) {
  if (option.disabled) return;
  const key = optionKey(option);
  if (selectedSet.value.has(key)) {
    draftSelection.value = draftSelection.value.filter((item) => item !== key);
  } else {
    draftSelection.value = [...draftSelection.value, key];
  }
}

function cancel() {
  if (!isOpen.value) return;
  writeOpen(false);
  emit("cancel");
}

function onDialogModelUpdate(next: boolean) {
  if (next) {
    writeOpen(true);
    return;
  }
  if (closingFromConfirm) {
    closingFromConfirm = false;
    return;
  }
  cancel();
}

function confirm() {
  if (!canConfirm.value) return;
  const next = [...draftSelection.value];
  closingFromConfirm = true;
  writeSelected(next);
  writeOpen(false);
  emit("confirm", next);
  void nextTick(() => {
    closingFromConfirm = false;
  });
}

function retry() {
  loadCandidates(searchQuery.value);
}

// ---- Keyboard navigation ----
const rowRefs = ref<HTMLElement[]>([]);

function setRowRef(element: unknown, index: number) {
  if (element instanceof HTMLElement) {
    rowRefs.value[index] = element;
  }
}

watch(visibleOptions, (next) => {
  rowRefs.value.length = next.length;
});

function focusRow(index: number) {
  const clamped = Math.max(0, Math.min(index, visibleOptions.value.length - 1));
  rowRefs.value[clamped]?.focus();
}

function onSearchKeydown(event: Event | KeyboardEvent) {
  if ("key" in event && event.key === "ArrowDown" && visibleOptions.value.length > 0) {
    event.preventDefault();
    focusRow(0);
  }
}

function onRowKeydown(event: KeyboardEvent, option: PanelFormOption, index: number) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusRow(index + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    focusRow(index - 1);
  } else if (event.key === "Home") {
    event.preventDefault();
    focusRow(0);
  } else if (event.key === "End") {
    event.preventDefault();
    focusRow(visibleOptions.value.length - 1);
  } else if ((event.key === " " || event.key === "Enter") && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    toggleOption(option);
  }
}

function onDialogKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canConfirm.value) {
    event.preventDefault();
    confirm();
  }
}

function refresh() {
  if (isOpen.value && dataMode !== "static") {
    loadCandidates(searchQuery.value);
  }
}

defineExpose({ refresh });
</script>

<template>
  <el-dialog
    :model-value="isOpen"
    :title="resolvedTitle"
    :width="width"
    align-center
    :append-to="panel?.overlayRoot ?? 'body'"
    :append-to-body="!panel?.overlayRoot"
    :close-on-press-escape="panel?.overlayShown?.value ?? true"
    destroy-on-close
    class="sdk-picker-dialog"
    @update:model-value="onDialogModelUpdate"
  >
    <div class="sdk-picker-dialog-body" @keydown="onDialogKeydown">
      <el-input
        :model-value="searchQuery"
        :placeholder="resolvedSearchPlaceholder"
        :aria-label="resolvedSearchPlaceholder"
        :prefix-icon="searchIcon"
        clearable
        class="sdk-picker-dialog-search"
        data-picker-search
        @update:model-value="onSearchInput"
        @keydown="onSearchKeydown"
      />

      <p v-if="truncationNotice" class="sdk-picker-dialog-notice" role="status" data-picker-truncated>
        {{ truncationNotice }}
      </p>

      <ul v-if="diagnostics.length" class="sdk-picker-dialog-diagnostics" role="status">
        <li v-for="note in diagnostics" :key="note">{{ note }}</li>
      </ul>

      <div v-if="unavailable" class="sdk-picker-dialog-state" :data-picker-state="unavailable.status" role="alert">
        <p class="sdk-picker-dialog-state-text">{{ unavailable.message }}</p>
        <el-button v-if="unavailable.status === 'error'" text size="small" @click="retry">{{ retryText }}</el-button>
      </div>

      <div v-else-if="loading && visibleOptions.length === 0" class="sdk-picker-dialog-state" data-picker-state="loading" role="status">
        <span class="sdk-picker-dialog-state-text">{{ globalLabel("platform.readerLoading", "Loading…") }}</span>
      </div>

      <div v-else-if="visibleOptions.length === 0" class="sdk-picker-dialog-state" data-picker-state="empty">
        <span class="sdk-picker-dialog-state-text">{{ searchQuery.trim() ? noMatchText : resolvedEmptyText }}</span>
      </div>

      <div
        v-else
        class="sdk-picker-dialog-list"
        role="listbox"
        aria-multiselectable="true"
        :aria-busy="loading"
        data-picker-list
      >
        <div
          v-for="(option, index) in visibleOptions"
          :key="optionKey(option)"
          :ref="(el) => setRowRef(el, index)"
          role="option"
          :tabindex="0"
          :aria-selected="isOptionSelected(option)"
          :aria-disabled="option.disabled || undefined"
          :data-picker-option="optionKey(option)"
          class="sdk-picker-dialog-option"
          :class="{
            'is-selected': isOptionSelected(option),
            'is-disabled': option.disabled,
          }"
          @click="toggleOption(option)"
          @keydown="onRowKeydown($event, option, index)"
        >
          <el-checkbox
            :model-value="isOptionSelected(option)"
            :disabled="option.disabled"
            :tabindex="-1"
            aria-hidden="true"
            class="sdk-picker-dialog-checkbox"
            @click.stop
            @update:model-value="toggleOption(option)"
          />
          <div class="sdk-picker-dialog-option-text">
            <span class="sdk-picker-dialog-option-label">{{ option.label }}</span>
            <span v-if="optionNote(option)" class="sdk-picker-dialog-option-description">
              {{ optionNote(option) }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="$slots.extra" class="sdk-picker-dialog-extra" data-picker-extra>
        <slot name="extra" :selected="draftSelection" :count="selectedCount" :changed="hasSelectionChanged"></slot>
      </div>
    </div>

    <template #footer>
      <div class="sdk-picker-dialog-footer">
        <span class="sdk-picker-dialog-count" data-picker-selected-count>{{ selectedCountText }}</span>
        <div class="sdk-picker-dialog-actions">
          <el-button data-picker-cancel @click="cancel">{{ cancelText }}</el-button>
          <el-button
            type="primary"
            :disabled="!canConfirm"
            data-picker-confirm
            @click="confirm"
          >{{ confirmText }}</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.sdk-picker-dialog-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}
.sdk-picker-dialog-search {
  width: 100%;
}
.sdk-picker-dialog-notice {
  margin: 0;
  color: var(--el-color-warning-text);
  font-size: var(--text-xs);
  line-height: 1.4;
}
.sdk-picker-dialog-diagnostics {
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--el-color-warning-text);
  font-size: var(--text-xs);
  line-height: 1.4;
}
.sdk-picker-dialog-list {
  display: flex;
  flex-direction: column;
  max-height: 360px;
  overflow-y: auto;
  border: 1px solid var(--sdk-border-color, var(--el-border-color-lighter));
  border-radius: var(--el-border-radius-base);
}
.sdk-picker-dialog-option {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-sm);
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.sdk-picker-dialog-option + .sdk-picker-dialog-option {
  border-top: 1px solid var(--sdk-border-color, var(--el-border-color-extra-light));
}
.sdk-picker-dialog-option:hover:not(.is-disabled),
.sdk-picker-dialog-option:focus-visible {
  background: var(--el-fill-color-light);
  outline: none;
}
.sdk-picker-dialog-option:focus-visible {
  box-shadow: inset 0 0 0 2px var(--el-color-primary);
}
.sdk-picker-dialog-option.is-disabled {
  cursor: not-allowed;
  opacity: 0.65;
}
.sdk-picker-dialog-checkbox {
  flex: 0 0 auto;
  height: auto;
  margin-top: 2px;
}
.sdk-picker-dialog-option-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.sdk-picker-dialog-option-label {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.sdk-picker-dialog-option-description {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.sdk-picker-dialog-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
  min-height: 120px;
  padding: var(--spacing-md);
  border: 1px solid var(--sdk-border-color, var(--el-border-color-lighter));
  border-radius: var(--el-border-radius-base);
  text-align: center;
}
.sdk-picker-dialog-state-text {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.sdk-picker-dialog-extra {
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--sdk-border-color, var(--el-border-color-lighter));
}
.sdk-picker-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  width: 100%;
}
.sdk-picker-dialog-count {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.sdk-picker-dialog-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}
</style>
