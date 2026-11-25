<script setup lang="ts">
import { computed, ref, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElCheckbox, ElCheckboxGroup } from "element-plus/es/components/checkbox/index";
import { ElInput } from "element-plus/es/components/input/index";
import { ElRadio, ElRadioGroup } from "element-plus/es/components/radio/index";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import { ElTag } from "element-plus/es/components/tag/index";
import { ElTooltip } from "element-plus/es/components/tooltip/index";
import { curatedIcon } from "@ontomato/platform-shell/icons";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { findPanelFormOption, type PanelFormOption } from "@ontomato/contracts/form-fields";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { jsonValuesEqual } from "../panel/form-values";
import FormRetainedChoices from "./FormRetainedChoices.vue";
import FormSelectChecklist from "./FormSelectChecklist.vue";

type SelectControl = Extract<PanelFormField["control"], { kind: "select" }>;
type Preset = NonNullable<SelectControl["presets"]>[number];
type DropdownValue = string | number;

// Keep `value` untyped at runtime so Vue does not coerce an empty string "" into `true` via Boolean prop casting.
const props = defineProps({
  control: { type: Object as PropType<SelectControl>, required: true },
  value: { type: null as unknown as PropType<RuntimeJsonValue | undefined>, default: undefined },
  label: { type: String, required: true },
  required: { type: Boolean, required: true },
  disabled: { type: Boolean, required: true },
});
const emit = defineEmits<{ change: [value: RuntimeJsonValue]; clear: [] }>();
const { t } = useI18n();
const helpIcon = curatedIcon("circle-help");

const isList = computed(() => props.control.presentation === "checklist" || props.control.presentation === "tree");
const isCheckbox = computed(() => props.control.presentation === "checkbox");
const hasDescribedOptions = computed(() => props.control.options.some(optionNote));
const dropdownFilterable = computed(() => Boolean(props.control.filterable || props.control.allowCreate));
const dropdownClearable = computed(() => props.control.clearable ?? (!props.required && !props.control.multiple));
const dropdownCollapseTags = computed(() => Boolean(props.control.multiple && props.control.collapseTags));

const selected = computed<RuntimeJsonValue[]>(() => {
  if (props.control.multiple) return Array.isArray(props.value) ? props.value : [];
  if (props.value == null) return [];
  if (props.value === "" && !findPanelFormOption(props.control.options, "")) return [];
  return [props.value];
});
const isSelected = (option: PanelFormOption) => selected.value.some(held => jsonValuesEqual(held, option.value));
const optionNote = ({ description, disabledReason }: PanelFormOption) => [description, disabledReason].filter(Boolean).join(" · ");

// A declared option has a primitive widget key even when its actual value is an object.
function optionKey(option: PanelFormOption, index: number): DropdownValue {
  return props.control.allowCreate && typeof option.value === "string" ? option.value : index;
}

const RETIRED = -1;
const selectedOptions = computed(() => selected.value.map((value, index) => ({
  value, index, option: findPanelFormOption(props.control.options, value),
})));
const dropdownValues = computed(() => selectedOptions.value.flatMap(({ option, value }) => {
  if (option) return option.disabled ? [] : [optionKey(option, props.control.options.indexOf(option))];
  return props.control.allowCreate && typeof value === "string" ? [value] : [];
}));
const retained = computed(() => selectedOptions.value.filter(({ option, value }) =>
  option ? option.disabled && !isList.value
    : isList.value || isCheckbox.value || !props.control.allowCreate || typeof value !== "string"));
const singleDropdownValue = computed<DropdownValue | undefined>(() => {
  if (dropdownValues.value[0] !== undefined) return dropdownValues.value[0];
  const held = retained.value[0];
  if (!held) return undefined;
  return held.option ? optionKey(held.option, props.control.options.indexOf(held.option)) : RETIRED;
});
const hasRetiredSingleOption = computed(() => !props.control.multiple && Boolean(retained.value[0] && !retained.value[0].option));
const retainedEntries = computed(() => retained.value.map(({ option, value }) => ({
  label: option?.label ?? (typeof value === "string" ? value : JSON.stringify(value)),
  note: option?.disabledReason ?? t("platform.formOptionNoLonger"),
})));

function removeRetained(index: number) {
  if (props.control.multiple) {
    emit("change", selected.value.filter((_, at) => at !== retained.value[index]!.index));
  } else emit("clear");
}

function fromDropdown(key: DropdownValue) {
  return typeof key === "number" ? props.control.options[key]!.value : key;
}

function canChoose(value: RuntimeJsonValue) {
  const option = findPanelFormOption(props.control.options, value);
  return option ? !option.disabled : props.control.allowCreate;
}

const customChoice = ref("");
const canCreateChoice = computed(() => customChoice.value !== ""
  && !findPanelFormOption(props.control.options, customChoice.value)
  && !selected.value.includes(customChoice.value));

function createChoice() {
  if (props.disabled || !canCreateChoice.value) return;
  emit("change", [...selected.value, customChoice.value]);
  customChoice.value = "";
}

function chooseDropdown(keys: DropdownValue | DropdownValue[] | undefined) {
  if (props.control.multiple) {
    const picked = Array.isArray(keys) ? keys.map(fromDropdown).filter(canChoose) : [];
    emit("change", [...retained.value.map(({ value }) => value), ...picked]);
  } else if (keys === undefined || keys === "") {
    emit("clear");
  } else if (typeof keys !== "object" && keys !== RETIRED) {
    const value = fromDropdown(keys);
    if (canChoose(value)) emit("change", value);
  }
}

function chooseCheckboxes(keys: Array<string | number | boolean>) {
  const picked = keys
    .filter((key): key is DropdownValue => typeof key === "string" || typeof key === "number")
    .map(fromDropdown)
    .filter(canChoose);
  emit("change", [...retained.value.map(({ value }) => value), ...picked]);
}

function replaceOptions(options: readonly PanelFormOption[], additions: readonly RuntimeJsonValue[]) {
  const kept = selected.value.filter(value => !options.some(option => jsonValuesEqual(option.value, value)));
  emit("change", [...kept, ...additions]);
}

function toggleOptions(options: readonly PanelFormOption[], checked: boolean) {
  if (checked) {
    const selectable = options.filter(option => !option.disabled && !isSelected(option));
    if (selectable.length) emit("change", [...selected.value, ...selectable.map(option => option.value)]);
  } else replaceOptions(options, []);
}

const available = computed(() => props.control.options.filter(option => !option.disabled));
function choosePreset(preset: Preset) {
  replaceOptions(available.value, available.value.filter(option =>
    preset.values.some(value => jsonValuesEqual(option.value, value))).map(option => option.value));
}

const tagEntry = computed(() => {
  const first = selectedOptions.value[0];
  if (!first) return null;
  const option = first.option;
  const label = option?.label ?? (typeof first.value === "string" || typeof first.value === "number" ? String(first.value) : JSON.stringify(first.value));
  const tone = option?.tone;
  const type = tone === "info" || tone === "success" || tone === "warning" || tone === "danger" ? tone : "info";
  const detail = option ? optionNote(option) : "";
  return { label, type, detail, hasTone: tone !== undefined && tone !== "default" };
});
</script>

<template>
  <div class="sdk-form-select-choices">
    <div v-if="control.presets?.length" class="sdk-form-select-presets">
      <el-button
        v-for="(preset, index) in control.presets"
        :key="index"
        size="small"
        :disabled="disabled"
        @click="choosePreset(preset)"
      >{{ preset.label }}</el-button>
    </div>
    <form-select-checklist
      v-if="isList"
      :options="control.options"
      :grouped="control.presentation === 'tree'"
      :is-selected="isSelected"
      :disabled="disabled"
      @toggle="toggleOptions"
    ></form-select-checklist>
    <el-checkbox-group
      v-else-if="isCheckbox"
      :model-value="dropdownValues"
      :aria-label="label"
      :disabled="disabled"
      class="sdk-form-select-checkbox-group"
      @update:model-value="chooseCheckboxes"
    >
      <div
        v-for="(option, index) in control.options"
        :key="index"
        class="sdk-form-select-checkbox-item"
        :title="option.disabledReason ?? undefined"
      >
        <el-checkbox
          :value="optionKey(option, index)"
          :disabled="option.disabled"
        >
          {{ option.label }}
        </el-checkbox>
        <el-tooltip
          v-if="option.description"
          :content="option.description"
          placement="top"
        >
          <span class="sdk-form-select-checkbox-help" tabindex="0" :aria-label="option.description">
            <component :is="helpIcon" :size="14" aria-hidden="true" />
          </span>
        </el-tooltip>
      </div>
    </el-checkbox-group>
    <el-radio-group
      v-else-if="control.presentation === 'radio'"
      :model-value="dropdownValues[0]"
      :aria-label="label"
      :disabled="disabled"
      @update:model-value="chooseDropdown($event as DropdownValue)"
    >
      <el-radio
        v-for="(option, index) in control.options"
        :key="index"
        :value="optionKey(option, index)"
        :disabled="option.disabled"
        :title="optionNote(option)"
      >{{ option.label }}</el-radio>
    </el-radio-group>
    <div
      v-else-if="control.presentation === 'tag'"
      class="sdk-form-select-tag"
      :aria-label="label"
    >
      <template v-if="tagEntry">
        <el-tag v-if="tagEntry.hasTone" :type="tagEntry.type" size="small" effect="light">{{ tagEntry.label }}</el-tag>
        <span v-else class="sdk-form-select-tag-plain">{{ tagEntry.label }}</span>
        <span v-if="tagEntry.detail" class="sdk-form-select-tag-detail">{{ tagEntry.detail }}</span>
      </template>
      <span v-else class="sdk-form-select-tag-empty">{{ control.placeholder || "—" }}</span>
    </div>
    <el-select
      v-else
      :model-value="control.multiple ? dropdownValues : singleDropdownValue"
      :multiple="control.multiple"
      :filterable="dropdownFilterable"
      :allow-create="control.allowCreate"
      :clearable="dropdownClearable"
      :collapse-tags="dropdownCollapseTags"
      :collapse-tags-tooltip="dropdownCollapseTags"
      :value-on-clear="() => undefined"
      :default-first-option="control.allowCreate"
      :fit-input-width="hasDescribedOptions || control.multiple"
      :placeholder="control.placeholder ?? undefined"
      :aria-label="label"
      :disabled="disabled"
      class="sdk-form-select-choices"
      :class="{ 'is-multiple-wrap': control.multiple && !dropdownCollapseTags }"
      popper-class="sdk-form-select-popper"
      @update:model-value="chooseDropdown"
    >
      <el-option
        v-for="(option, index) in control.options"
        :key="index"
        :value="optionKey(option, index)"
        :label="option.label"
        :disabled="option.disabled"
        :title="optionNote(option) || undefined"
        :class="optionNote(option) ? 'sdk-reference-option-described' : 'sdk-form-select-option-wrap'"
      >
        <span :class="optionNote(option) ? 'sdk-reference-option-label' : 'sdk-form-select-option-label'">{{ option.label }}</span>
        <span v-if="optionNote(option)" class="sdk-reference-option-description">{{ optionNote(option) }}</span>
      </el-option>
      <el-option
        v-if="hasRetiredSingleOption"
        :value="RETIRED"
        :label="t('platform.formOptionNoLonger')"
        disabled
      ></el-option>
    </el-select>
    <el-input
      v-if="isList && control.allowCreate"
      v-model="customChoice"
      :placeholder="t('platform.formCreateOption')"
      :aria-label="t('platform.formCreateOption')"
      :disabled="disabled"
      @keydown.enter.prevent="createChoice"
    >
      <template #append>
        <el-button :disabled="disabled || !canCreateChoice" @click="createChoice">{{ t("platform.formAdd") }}</el-button>
      </template>
    </el-input>
    <form-retained-choices :entries="retainedEntries" :disabled="disabled" @remove="removeRetained"></form-retained-choices>
  </div>
</template>

<style scoped>
.sdk-form-select-choices {
  width: 100%;
}
.sdk-form-select-choices.is-multiple-wrap :deep(.el-select__selected-item .el-tag) {
  height: auto;
  min-height: 22px;
  max-width: 100%;
  padding-block: 2px;
  line-height: 1.35;
  white-space: normal;
  overflow-wrap: anywhere;
}
.sdk-form-select-choices.is-multiple-wrap :deep(.el-select__selected-item .el-tag__content) {
  white-space: normal;
  overflow-wrap: anywhere;
}
.sdk-form-select-presets {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  margin-bottom: var(--spacing-sm);
}
.sdk-form-select-presets > button {
  margin: 0;
}
.sdk-form-select-checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs) var(--spacing-lg);
  align-items: center;
}
.sdk-form-select-checkbox-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.sdk-form-select-checkbox-help {
  display: inline-flex;
  align-items: center;
  color: var(--el-text-color-secondary);
  cursor: help;
}
.sdk-form-select-list + .el-input {
  margin-top: var(--spacing-sm);
}
.sdk-form-select-tag {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs);
  min-height: var(--control-height);
}
.sdk-form-select-tag-plain {
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
}
.sdk-form-select-tag-detail,
.sdk-form-select-tag-empty {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
</style>
