<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElInput } from "element-plus/es/components/input/index";
import { ElRadio, ElRadioGroup } from "element-plus/es/components/radio/index";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { findPanelFormOption, type PanelFormOption } from "@ontomato/contracts/form-fields";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { jsonValuesEqual } from "../panel/form-values";
import FormRetainedChoices from "./FormRetainedChoices.vue";
import FormSelectChecklist from "./FormSelectChecklist.vue";

type SelectControl = Extract<PanelFormField["control"], { kind: "select" }>;
type Preset = NonNullable<SelectControl["presets"]>[number];
type DropdownValue = string | number;

const props = defineProps<{
  control: SelectControl;
  value: RuntimeJsonValue | undefined;
  label: string;
  required: boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ change: [value: RuntimeJsonValue]; clear: [] }>();
const { t } = useI18n();

const isList = computed(() => props.control.presentation === "checklist" || props.control.presentation === "tree");
const selected = computed<RuntimeJsonValue[]>(() => {
  if (props.control.multiple) return Array.isArray(props.value) ? props.value : [];
  return props.value == null ? [] : [props.value];
});
const isSelected = (option: PanelFormOption) => selected.value.some(held => jsonValuesEqual(held, option.value));
const optionNote = ({ description, disabledReason }: PanelFormOption) => [description, disabledReason].filter(Boolean).join(" · ");

// A declared option has a primitive widget key even when its actual value is an object.
function optionKey(option: PanelFormOption, index: number): DropdownValue {
  return props.control.allowCreate && typeof option.value === "string" ? option.value : index;
}

const selectedOptions = computed(() => selected.value.map((value, index) => ({
  value, index, option: findPanelFormOption(props.control.options, value),
})));
const dropdownValues = computed(() => selectedOptions.value.flatMap(({ option, value }) => {
  if (option) return option.disabled ? [] : [optionKey(option, props.control.options.indexOf(option))];
  return props.control.allowCreate && typeof value === "string" ? [value] : [];
}));
const retained = computed(() => selectedOptions.value.filter(({ option, value }) =>
  option ? option.disabled && !isList.value
    : isList.value || !props.control.allowCreate || typeof value !== "string"));
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
  if (Array.isArray(keys)) {
    const next = keys.map(fromDropdown);
    if (next.every(canChoose)) emit("change", [...retained.value.map(({ value }) => value), ...next]);
  } else if (keys === undefined) {
    emit("clear");
  } else {
    const next = fromDropdown(keys);
    if (canChoose(next)) emit("change", next);
  }
}

function replaceOptions(scope: readonly PanelFormOption[], replacements: readonly RuntimeJsonValue[]) {
  const kept = selected.value.filter(value => !findPanelFormOption(scope, value));
  emit("change", [...kept, ...replacements]);
}

function toggleOptions(options: PanelFormOption[], checked: boolean) {
  if (checked) {
    const added = options.filter(option => !option.disabled && !isSelected(option));
    emit("change", [...selected.value, ...added.map(option => option.value)]);
  } else replaceOptions(options, []);
}

const available = computed(() => props.control.options.filter(option => !option.disabled));
function choosePreset(preset: Preset) {
  replaceOptions(available.value, available.value.filter(option =>
    preset.values.some(value => jsonValuesEqual(option.value, value))).map(option => option.value));
}
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
    <el-select
      v-else
      :model-value="control.multiple ? dropdownValues : dropdownValues[0]"
      :multiple="control.multiple"
      :filterable="control.allowCreate"
      :allow-create="control.allowCreate"
      :clearable="!required && !control.multiple"
      :value-on-clear="() => undefined"
      :default-first-option="control.allowCreate"
      :fit-input-width="control.options.some(optionNote)"
      :placeholder="control.placeholder ?? undefined"
      :aria-label="label"
      :disabled="disabled"
      class="sdk-form-select-choices"
      @update:model-value="chooseDropdown"
    >
      <el-option
        v-for="(option, index) in control.options"
        :key="index"
        :value="optionKey(option, index)"
        :label="option.label"
        :disabled="option.disabled"
        :title="optionNote(option) || undefined"
        :class="{ 'sdk-reference-option-described': optionNote(option) }"
      >
        <span class="sdk-reference-option-label">{{ option.label }}</span>
        <span v-if="optionNote(option)" class="sdk-reference-option-description">{{ optionNote(option) }}</span>
      </el-option>
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
.sdk-form-select-presets {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  margin-bottom: var(--spacing-sm);
}
.sdk-form-select-presets > button {
  margin: 0;
}
.sdk-form-select-list + .el-input {
  margin-top: var(--spacing-sm);
}
</style>
<style scoped src="./form-option.css"></style>
