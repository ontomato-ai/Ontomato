<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElOption, ElOptionGroup, ElSelect } from "element-plus/es/components/select/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import {
  authoredReadParameterSource,
  directReadDeclaration,
  panelRecordObjectRef,
  type PanelOptionList,
  type PanelRecord,
  type PanelRecordQuery,
} from "@ontomato/contracts/panel-projection";
import { usePanelContext, useProjectionSlot } from "../panel/context";
import { useMember, useMemberData, useMemberParam, useMemberRead } from "../panel/member";
import type { PlatformObjectOption, PlatformObjectRecord } from "../panel/platform-objects";
import { projectionElement } from "../panel/projection-element";
import { stateObject, type PanelFieldValue, type PanelObjectRef } from "../panel/state";
import { readConfigString, readConfigStringMap, resolveLocalizedText } from "./localized-text";
import { resolveGroupForRecord } from "./object-list-local";

interface InlineOption {
  readonly primaryKey: string;
  readonly className: string;
  readonly label: string;
  readonly description?: string;
  readonly groupKey?: string;
  readonly groupLabel?: string;
  readonly unavailableReason?: string;
  readonly isNullChoice?: boolean;
}

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    placeholderKey?: string;
    placeholders?: Readonly<Record<string, string>>;
    clearable?: boolean;
    disabled?: boolean;
    size?: "small" | "default" | "large";
    groupBy?: string;
  }>(),
  {
    placeholder: undefined,
    placeholderKey: undefined,
    placeholders: undefined,
    clearable: true,
    disabled: false,
    size: "small",
    groupBy: undefined,
  },
);

const emit = defineEmits<{
  "update:selected": [value: PanelObjectRef | null];
}>();

const { t, te, locale } = useI18n();
const panel = usePanelContext();
const slot = useProjectionSlot();
const member = useMember();

const hasRows = "rows" in member.projection.data;
const hasOptions = "options" in member.projection.data;
if (!hasRows && !hasOptions) {
  throw new Error(`Projection ${member.projection.id} declares neither 'rows' nor 'options' datum`);
}

const dataMode: "rows" | "options" = hasRows ? "rows" : "options";
const defaultClassName = projectionElement(slot.projection).id;
const selectedParam = useMemberParam("selected");

const localized = (text: string) => (te(text) ? t(text) : text);

const rawConfig = computed<Readonly<Record<string, unknown>> | undefined>(() => {
  const cfg = member.projection.config;
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : undefined;
});

const placeholderText = computed(() =>
  resolveLocalizedText({
    key: props.placeholderKey ?? readConfigString(rawConfig.value, "placeholderKey", "placeholder-key"),
    map: props.placeholders ?? readConfigStringMap(rawConfig.value, "placeholders"),
    fallback: props.placeholder ?? readConfigString(rawConfig.value, "placeholder"),
    locale: locale.value,
    panelText: panel.t,
    t,
    te,
  }),
);

const isClearable = computed(() => props.clearable !== false);

const groupByKey = computed<string | undefined>(() => {
  const configured = props.groupBy ?? readConfigString(rawConfig.value, "groupBy", "group-by");
  const trimmed = configured?.trim();
  return trimmed ? trimmed : undefined;
});

const knownOptions = shallowRef(new Map<string, InlineOption>());

function rememberOptions(list: readonly InlineOption[]) {
  if (!list.length) return;
  const next = new Map(knownOptions.value);
  const byType = new Map<string, { primaryKey: string; label: string }[]>();
  for (const item of list) {
    next.set(item.primaryKey, item);
    if (!item.isNullChoice) {
      let bucket = byType.get(item.className);
      if (!bucket) {
        bucket = [];
        byType.set(item.className, bucket);
      }
      bucket.push({ primaryKey: item.primaryKey, label: item.label });
    }
  }
  knownOptions.value = next;
  for (const [className, named] of byType) panel.instance.nameObjects(className, named);
}

// ---- Rows mode (`panelRecordList` complete list -> local filter; `panelRecordQuery` paged -> owner search) ----
const rowsDatum = member.projection.data.rows;
const rowsDeclaration = rowsDatum ? directReadDeclaration(member.projection, rowsDatum) : undefined;
const rowsSignatureParams = rowsDeclaration?.parameterMode === "fixed" ? rowsDeclaration.params : {};
const isPagedRows = dataMode === "rows" && rowsDeclaration?.result === "panelRecordQuery";
const placement = panel.manifest.members[member.key]!;
const supportsRowsRemoteSearch =
  isPagedRows
  && Boolean(rowsDatum)
  && !authoredReadParameterSource(rowsDatum!.params, "search", placement)
  && (!rowsDeclaration || rowsDeclaration.parameterMode !== "fixed" || "search" in rowsSignatureParams);

const rowsSearchParam = supportsRowsRemoteSearch ? useMemberParam("search") : null;
const rowsData = dataMode === "rows" ? useMemberData("rows") : null;
const localQuery = ref("");
const lastRemoteRowsQuery = ref("");

function toRowOption(row: PlatformObjectRecord): InlineOption {
  const object = panelRecordObjectRef(row, defaultClassName);
  const groupField = groupByKey.value;
  const group = groupField
    ? resolveGroupForRecord(row, groupField, defaultClassName, locale.value, localized, "")
    : null;
  return {
    ...object,
    label: row.label || object.primaryKey,
    description: row.subtitle,
    ...(group && !group.isEmpty ? { groupKey: group.key, groupLabel: group.label } : {}),
  };
}

const allRowOptions = computed<readonly InlineOption[]>(() => {
  if (!rowsData || rowsData.value.status !== "ready") return [];
  const raw = rowsData.value.value;
  const rows: readonly PlatformObjectRecord[] = Array.isArray(raw)
    ? (raw as unknown as readonly PlatformObjectRecord[])
    : Array.isArray((raw as unknown as PanelRecordQuery)?.rows)
      ? ((raw as unknown as PanelRecordQuery).rows as unknown as readonly PlatformObjectRecord[])
      : [];
  return rows.map(toRowOption);
});

if (dataMode === "rows") {
  watch(allRowOptions, rememberOptions, { immediate: true });
}

function searchRows(keyword = "") {
  if (!rowsSearchParam) return;
  const trimmed = keyword.trim();
  lastRemoteRowsQuery.value = trimmed;
  rowsSearchParam.set(trimmed ? trimmed : null);
}

// ---- Options mode (`panelOptionList`): remote or local search ----
const optionsDatum = member.projection.data.options;
const optionsDeclaration = optionsDatum ? directReadDeclaration(member.projection, optionsDatum) : undefined;
const supportsOptionsRemoteSearch = dataMode === "options"
  && (!optionsDeclaration || optionsDeclaration.parameterMode !== "fixed" || "keyword" in optionsDeclaration.params);
const supportsRemoteSearch = supportsOptionsRemoteSearch || supportsRowsRemoteSearch;
const canFilter = dataMode === "options" || !isPagedRows || supportsRowsRemoteSearch;

const readOptions = dataMode === "options" ? useMemberRead("options") : null;

const offeredOptions = shallowRef<readonly InlineOption[]>([]);
const searchingOptions = ref(dataMode === "options");
const optionsUnavailable = shallowRef<{ status: "forbidden" | "error" | "awaiting"; message: string } | null>(null);
const optionDiagnostics = shallowRef<readonly string[]>([]);

function toInlineOption(option: PlatformObjectOption): InlineOption {
  const isNullChoice = option.value === null;
  return {
    primaryKey: option.primaryKey,
    className: defaultClassName,
    label: isNullChoice ? localized(option.label) : option.label,
    description: option.description,
    unavailableReason: option.unavailable ? localized(option.unavailable.reason) : undefined,
    isNullChoice,
  };
}

let searchGeneration = 0;
function searchOptions(keyword = "") {
  if (!readOptions) return;
  const generation = ++searchGeneration;
  searchingOptions.value = true;
  void readOptions({ ...(keyword ? { keyword } : {}), page: { number: 1, size: 50 } }).then((result) => {
    if (generation !== searchGeneration) return;
    searchingOptions.value = false;
    if (result.status === "ready") {
      optionsUnavailable.value = null;
      const list = result.value as unknown as PanelOptionList;
      const mapped = list.options.map(toInlineOption);
      rememberOptions(mapped);
      offeredOptions.value = mapped;
      optionDiagnostics.value = list.diagnostics ?? [];
      return;
    }
    if (result.status === "empty") {
      optionsUnavailable.value = null;
      offeredOptions.value = [];
      optionDiagnostics.value = [];
      return;
    }
    if (result.status === "forbidden") {
      optionsUnavailable.value = { status: "forbidden", message: t("platform.dataForbidden") };
      offeredOptions.value = [];
      return;
    }
    if (result.status === "awaiting") {
      optionsUnavailable.value = { status: "awaiting", message: t("platform.dataAwaiting") };
      offeredOptions.value = [];
      return;
    }
    if (result.status === "error") {
      optionsUnavailable.value = {
        status: "error",
        message: result.unreachable ? t("platform.dataUnreachable") : (result.message || t("platform.dataUnreachable")),
      };
      offeredOptions.value = [];
    }
  });
}

const selectedRef = computed<PanelObjectRef | null>(() =>
  stateObject(selectedParam.value.value as PanelFieldValue),
);
const currentKey = computed<string>(() => selectedRef.value?.primaryKey ?? "");

if (readOptions) onMounted(() => searchOptions());

const selectedDatum = member.projection.data.selected;
if (selectedDatum) {
  const readSelected = useMemberRead("selected");
  const readsRecord = directReadDeclaration(member.projection, selectedDatum)?.result === "panelRecord";
  const unresolvedKey = computed(() => {
    const pageLoaded = rowsData
      ? rowsData.value.status === "ready" || rowsData.value.status === "empty"
      : !searchingOptions.value && !optionsUnavailable.value;
    const key = currentKey.value;
    return pageLoaded && key && !knownOptions.value.has(key) ? key : null;
  });
  watch(unresolvedKey, (key, _, onCleanup) => {
    if (!key) return;
    let current = true;
    onCleanup(() => { current = false; });
    void readSelected(readsRecord ? {} : { values: [key] }).then((result) => {
      if (!current || key !== unresolvedKey.value || result.status !== "ready") return;
      const resolved = readsRecord
        ? [toRowOption(result.value as unknown as PanelRecord)]
        : (result.value as unknown as PanelOptionList).options.map(toInlineOption);
      rememberOptions(resolved.filter((option) => option.primaryKey === key));
    });
  }, { immediate: true });
}

const effectiveHeldOptions = computed<readonly InlineOption[]>(() => {
  const key = currentKey.value;
  if (!key) return [];
  const found = knownOptions.value.get(key);
  return found ? [found] : [];
});

// ---- Unified view state ----
const unavailableNotice = computed<string | undefined>(() => {
  if (dataMode === "rows") {
    const state = rowsData!.value;
    if (state.status === "forbidden") return t("platform.dataForbidden");
    if (state.status === "awaiting") return t("platform.dataAwaiting");
    if (state.status === "error") return state.message || t("platform.dataUnreachable");
    return undefined;
  }
  return optionsUnavailable.value?.message;
});

const dataStatusAttr = computed<string>(() => {
  if (dataMode === "rows") return rowsData!.value.status;
  if (searchingOptions.value) return "loading";
  if (optionsUnavailable.value) return optionsUnavailable.value.status;
  return offeredOptions.value.length || effectiveHeldOptions.value.length ? "ready" : "empty";
});

const isLoading = computed(() =>
  dataMode === "rows" ? rowsData!.value.status === "loading" : searchingOptions.value,
);

const isDisabled = computed(() => props.disabled || unavailableNotice.value !== undefined);

const mergedOptions = computed<readonly InlineOption[]>(() => {
  if (dataMode === "rows" && !isPagedRows && !selectedDatum) return allRowOptions.value;
  const source = dataMode === "rows" ? allRowOptions.value : offeredOptions.value;
  const held = effectiveHeldOptions.value[0];
  return held && !source.some((option) => option.primaryKey === held.primaryKey) ? [held, ...source] : source;
});

const shownOptions = computed<readonly InlineOption[]>(() => {
  if (supportsRemoteSearch || !canFilter) return mergedOptions.value;
  const query = localQuery.value.trim().toLowerCase();
  if (!query) return mergedOptions.value;
  return mergedOptions.value.filter(
    (option) =>
      option.label.toLowerCase().includes(query)
      || option.primaryKey.toLowerCase().includes(query)
      || (option.description?.toLowerCase().includes(query) ?? false)
      || (option.groupLabel?.toLowerCase().includes(query) ?? false),
  );
});

interface InlineOptionGroup {
  readonly key: string;
  readonly label: string;
  readonly options: readonly InlineOption[];
}

const optionGroups = computed<readonly InlineOptionGroup[] | null>(() => {
  if (!groupByKey.value) return null;
  const items = shownOptions.value;
  if (!items.some((option) => Boolean(option.groupLabel))) return null;
  const buckets = new Map<string, { key: string; label: string; options: InlineOption[] }>();
  const ungrouped: InlineOption[] = [];
  for (const option of items) {
    if (!option.groupLabel) {
      ungrouped.push(option);
      continue;
    }
    const bucketKey = option.groupKey ?? option.groupLabel;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = { key: bucketKey, label: option.groupLabel, options: [] };
      buckets.set(bucketKey, bucket);
    }
    bucket.options.push(option);
  }
  const ordered: InlineOptionGroup[] = [...buckets.values()];
  if (ungrouped.length > 0) {
    ordered.push({ key: "", label: "", options: ungrouped });
  }
  return ordered;
});

function searchRemote(keyword = "") {
  if (dataMode === "rows") searchRows(keyword);
  else searchOptions(keyword);
}
function onLocalFilter(query: string) {
  localQuery.value = query;
}

function onVisibleChange(visible: boolean) {
  if (!visible) {
    localQuery.value = "";
    if (supportsRowsRemoteSearch && lastRemoteRowsQuery.value) {
      lastRemoteRowsQuery.value = "";
      rowsSearchParam?.set(null);
    }
  }
}

function writeSelected(next: PanelObjectRef | null) {
  selectedParam.set(next as RuntimeJsonValue);
  emit("update:selected", next);
}

function onSelect(value: string | undefined) {
  localQuery.value = "";
  if (value === undefined || value === "") {
    writeSelected(null);
    return;
  }
  const key = String(value);
  const match =
    mergedOptions.value.find((option) => option.primaryKey === key) ?? knownOptions.value.get(key);
  if (match?.isNullChoice) {
    writeSelected(null);
    return;
  }
  writeSelected({
    className: match?.className || defaultClassName,
    primaryKey: key,
  });
}
</script>

<template>
  <span
    class="sdk-inline-reference-picker"
    :data-state="dataStatusAttr"
    :title="unavailableNotice"
  >
    <el-select
      :model-value="currentKey"
      :size="size"
      :placeholder="placeholderText"
      :clearable="isClearable"
      :disabled="isDisabled"
      :loading="isLoading"
      :filterable="canFilter"
      :remote="supportsRemoteSearch"
      :remote-method="supportsRemoteSearch ? searchRemote : undefined"
      :filter-method="!supportsRemoteSearch && canFilter ? onLocalFilter : undefined"
      :aria-label="placeholderText || undefined"
      fit-input-width
      class="sdk-inline-reference-picker-select"
      @visible-change="onVisibleChange"
      @update:model-value="onSelect"
    >
      <template v-if="optionGroups">
        <template v-for="group in optionGroups" :key="group.key || '__ungrouped'">
          <el-option-group v-if="group.label" :label="group.label">
            <el-option
              v-for="option in group.options"
              :key="option.primaryKey"
              :value="option.primaryKey"
              :label="option.label"
              :disabled="option.unavailableReason !== undefined"
              :title="option.unavailableReason ?? option.description"
              :class="{ 'sdk-reference-option-described': Boolean(option.description) }"
            >
              <slot
                name="option"
                :option="option"
                :selected="currentKey === option.primaryKey"
                :disabled="option.unavailableReason !== undefined"
              >
                <span class="sdk-reference-option-label">{{ option.label }}</span>
                <span v-if="option.description" class="sdk-reference-option-description">{{ option.description }}</span>
              </slot>
            </el-option>
          </el-option-group>
          <template v-else>
            <el-option
              v-for="option in group.options"
              :key="option.primaryKey"
              :value="option.primaryKey"
              :label="option.label"
              :disabled="option.unavailableReason !== undefined"
              :title="option.unavailableReason ?? option.description"
              :class="{ 'sdk-reference-option-described': Boolean(option.description) }"
            >
              <slot
                name="option"
                :option="option"
                :selected="currentKey === option.primaryKey"
                :disabled="option.unavailableReason !== undefined"
              >
                <span class="sdk-reference-option-label">{{ option.label }}</span>
                <span v-if="option.description" class="sdk-reference-option-description">{{ option.description }}</span>
              </slot>
            </el-option>
          </template>
        </template>
      </template>
      <template v-else>
        <el-option
          v-for="option in shownOptions"
          :key="option.primaryKey"
          :value="option.primaryKey"
          :label="option.label"
          :disabled="option.unavailableReason !== undefined"
          :title="option.unavailableReason ?? option.description"
          :class="{ 'sdk-reference-option-described': Boolean(option.description) }"
        >
          <slot
            name="option"
            :option="option"
            :selected="currentKey === option.primaryKey"
            :disabled="option.unavailableReason !== undefined"
          >
            <span class="sdk-reference-option-label">{{ option.label }}</span>
            <span v-if="option.description" class="sdk-reference-option-description">{{ option.description }}</span>
          </slot>
        </el-option>
      </template>
    </el-select>
    <span v-if="optionDiagnostics.length" class="sdk-inline-reference-picker-note" role="status">
      {{ optionDiagnostics.join(" ") }}
    </span>
  </span>
</template>

<style scoped>
.sdk-inline-reference-picker {
  display: inline-flex;
  flex-direction: column;
  max-width: 100%;
  min-width: 0;
  width: 100%;
}
.sdk-inline-reference-picker-select {
  width: 100%;
}
.sdk-inline-reference-picker-note {
  color: var(--el-color-warning-text);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  margin-top: var(--spacing-xs);
}
</style>

<style scoped src="./form-option.css"></style>
