<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import {
  directReadDeclaration,
  panelRecordObjectRef,
  type PanelOptionList,
  type PanelRecordQuery,
} from "@ontomato/contracts/panel-projection";
import { usePanelContext, useProjectionSlot } from "../panel/context";
import { useMember, useMemberData, useMemberParam, useMemberRead } from "../panel/member";
import type { PlatformObjectOption, PlatformObjectRecord } from "../panel/platform-objects";
import { projectionElement } from "../panel/projection-element";
import { stateObject, type PanelFieldValue, type PanelObjectRef } from "../panel/state";
import { readConfigString, readConfigStringMap, resolveLocalizedText } from "./localized-text";

interface InlineOption {
  readonly primaryKey: string;
  readonly className: string;
  readonly label: string;
  readonly description?: string;
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
  }>(),
  {
    placeholder: undefined,
    placeholderKey: undefined,
    placeholders: undefined,
    clearable: true,
    disabled: false,
    size: "small",
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
const hasSelected = "selected" in member.projection.data;
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

// ---- Rows mode (`panelRecordList` / `panelRecordQuery`): local filtering, zero requests while typing ----
const rowsData = dataMode === "rows" ? useMemberData("rows") : null;
const localQuery = ref("");

const allRowOptions = computed<readonly InlineOption[]>(() => {
  if (!rowsData || rowsData.value.status !== "ready") return [];
  const raw = rowsData.value.value;
  const rows: readonly PlatformObjectRecord[] = Array.isArray(raw)
    ? (raw as unknown as readonly PlatformObjectRecord[])
    : Array.isArray((raw as unknown as PanelRecordQuery)?.rows)
      ? ((raw as unknown as PanelRecordQuery).rows as unknown as readonly PlatformObjectRecord[])
      : [];
  return rows.map((row) => {
    const ref = panelRecordObjectRef(row, defaultClassName);
    return {
      primaryKey: ref.primaryKey,
      className: ref.className,
      label: row.label || ref.primaryKey,
      description: row.subtitle,
    };
  });
});

if (dataMode === "rows") {
  watch(
    allRowOptions,
    (items) => {
      const byType = new Map<string, { primaryKey: string; label: string }[]>();
      for (const item of items) {
        let bucket = byType.get(item.className);
        if (!bucket) {
          bucket = [];
          byType.set(item.className, bucket);
        }
        bucket.push({ primaryKey: item.primaryKey, label: item.label });
      }
      for (const [className, list] of byType) panel.instance.nameObjects(className, list);
    },
    { immediate: true },
  );
}

// ---- Options mode (`panelOptionList`, optional `selected`): remote or local search + resolved unavailable items ----
const optionsDatum = member.projection.data.options;
const optionsDeclaration = optionsDatum ? directReadDeclaration(member.projection, optionsDatum) : undefined;
const supportsRemoteSearch = dataMode === "options"
  && (!optionsDeclaration || optionsDeclaration.parameterMode !== "fixed" || "keyword" in optionsDeclaration.params);

const readOptions = dataMode === "options" ? useMemberRead("options") : null;
const readSelected = dataMode === "options" && hasSelected ? useMemberRead("selected") : null;

const knownOptions = shallowRef(new Map<string, InlineOption>());
const offeredOptions = shallowRef<readonly InlineOption[]>([]);
const heldOptions = shallowRef<readonly InlineOption[]>([]);
const searchingOptions = ref(false);
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

function rememberOptions(list: readonly InlineOption[]) {
  if (!list.length) return;
  const next = new Map(knownOptions.value);
  const named: { primaryKey: string; label: string }[] = [];
  for (const item of list) {
    next.set(item.primaryKey, item);
    if (!item.isNullChoice) named.push({ primaryKey: item.primaryKey, label: item.label });
  }
  knownOptions.value = next;
  if (named.length) panel.instance.nameObjects(defaultClassName, named);
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

let resolveGeneration = 0;
if (dataMode === "options") {
  if (readSelected) {
    watch(
      currentKey,
      (key) => {
        const generation = ++resolveGeneration;
        if (!key) {
          heldOptions.value = [];
          return;
        }
        void readSelected({ values: [key] }).then((result) => {
          if (generation !== resolveGeneration) return;
          if (result.status === "ready") {
            const list = result.value as unknown as PanelOptionList;
            const mapped = list.options.map(toInlineOption);
            rememberOptions(mapped);
            heldOptions.value = mapped;
            return;
          }
          if (result.status === "empty") {
            heldOptions.value = [];
          }
        });
      },
      { immediate: true },
    );
  }
  onMounted(() => searchOptions(""));
}

const effectiveHeldOptions = computed<readonly InlineOption[]>(() => {
  if (readSelected) return heldOptions.value;
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
  if (dataMode === "rows") return allRowOptions.value;
  const heldKeys = new Set(effectiveHeldOptions.value.map((option) => option.primaryKey));
  return [...effectiveHeldOptions.value, ...offeredOptions.value.filter((option) => !heldKeys.has(option.primaryKey))];
});

const shownOptions = computed<readonly InlineOption[]>(() => {
  if (supportsRemoteSearch) return mergedOptions.value;
  const query = localQuery.value.trim().toLowerCase();
  if (!query) return mergedOptions.value;
  return mergedOptions.value.filter(
    (option) =>
      option.label.toLowerCase().includes(query)
      || option.primaryKey.toLowerCase().includes(query)
      || (option.description?.toLowerCase().includes(query) ?? false),
  );
});

function onLocalFilter(query: string) {
  localQuery.value = query;
}

function onVisibleChange(visible: boolean) {
  if (!visible) localQuery.value = "";
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
      filterable
      :remote="supportsRemoteSearch"
      :remote-method="supportsRemoteSearch ? searchOptions : undefined"
      :filter-method="supportsRemoteSearch ? undefined : onLocalFilter"
      :aria-label="placeholderText || undefined"
      fit-input-width
      class="sdk-inline-reference-picker-select"
      @visible-change="onVisibleChange"
      @update:model-value="onSelect"
    >
      <el-option
        v-for="option in shownOptions"
        :key="option.primaryKey"
        :value="option.primaryKey"
        :label="option.label"
        :disabled="option.unavailableReason !== undefined"
        :title="option.unavailableReason ?? option.description"
        :class="{ 'sdk-reference-option-described': Boolean(option.description) }"
      >
        <span class="sdk-reference-option-label">{{ option.label }}</span>
        <span v-if="option.description" class="sdk-reference-option-description">{{ option.description }}</span>
      </el-option>
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
