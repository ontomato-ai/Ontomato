<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElRadio, ElRadioButton, ElRadioGroup } from "element-plus/es/components/radio/index";
import type { PanelFormField, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { findPanelFormOption, type PanelFormOption } from "@ontomato/contracts/form-fields";
import FormRetainedChoices from "./FormRetainedChoices.vue";

type MatrixControl = Extract<PanelFormField["control"], { kind: "choice-matrix" }>;

const props = defineProps<{ control: MatrixControl; value: PanelFormValues; disabled: boolean }>();
const emit = defineEmits<{ change: [value: PanelFormValues] }>();
const { t, te } = useI18n();

function label(key: string, fallback: string): string {
  return te(key) ? t(key) : fallback;
}

const isTable = computed(() => props.control.presentation === "table");
const rowHeaderLabel = computed(() => props.control.rowHeader ?? label("platform.formMatrixRowHeader", "Field"));
const choiceHeaderLabel = computed(() => props.control.choiceHeader ?? label("platform.formMatrixChoiceHeader", "Level"));
const availableRows = computed(() => props.control.rows.filter(row => !row.disabled));
const unknownRows = computed(() => {
  const keys = new Set(props.control.rows.map(row => row.key));
  return Object.entries(props.value).filter(([key]) => !keys.has(key));
});
const unknownEntries = computed(() => unknownRows.value.map(([key, tier]) => ({
  label: `${key}: ${typeof tier === "string" ? tier : JSON.stringify(tier)}`,
  note: t("platform.formMatrixRowNoLonger"),
})));

function setAll(option: PanelFormOption) {
  const updates = Object.fromEntries(availableRows.value.map(row => [row.key, option.value]));
  emit("change", { ...props.value, ...updates });
}

function setRow(key: string, index: number) {
  emit("change", { ...props.value, [key]: props.control.options[index]!.value });
}

function selectedTier(key: string) {
  if (!Object.hasOwn(props.value, key)) return;
  const option = findPanelFormOption(props.control.options, props.value[key]);
  return option ? props.control.options.indexOf(option) : undefined;
}

function removeUnknown(index: number) {
  const [key] = unknownRows.value[index]!;
  const next = { ...props.value };
  delete next[key];
  emit("change", next);
}
</script>

<template>
  <div class="sdk-form-matrix">
    <div class="sdk-form-matrix-bulk">
      <span v-for="(option, index) in control.options" :key="index" :title="option.disabledReason ?? undefined">
        <el-button
          size="small"
          :disabled="disabled || option.disabled || !availableRows.length"
          :aria-description="option.disabledReason ?? undefined"
          @click="setAll(option)"
        >{{ t("platform.formMatrixSetAll", { label: option.label }) }}</el-button>
      </span>
    </div>
    <div v-if="isTable" class="sdk-form-matrix-table-wrap">
      <table class="sdk-form-matrix-table">
        <thead>
          <tr>
            <th scope="col">{{ rowHeaderLabel }}</th>
            <th scope="col" class="sdk-form-matrix-choice-col">{{ choiceHeaderLabel }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in control.rows"
            :key="row.key"
            :class="{ 'is-indented': row.indent, 'is-disabled': disabled || row.disabled }"
            :data-row-key="row.key"
          >
            <td class="sdk-form-matrix-row-cell">
              <div class="sdk-form-matrix-row-main">
                <small v-if="row.badge" class="sdk-form-matrix-badge">{{ row.badge }}</small>
                <span class="sdk-form-matrix-row-label">{{ row.label }}</span>
              </div>
              <small v-if="row.description" class="sdk-form-matrix-row-note">{{ row.description }}</small>
              <small v-if="row.disabledReason" class="sdk-form-matrix-row-note">{{ row.disabledReason }}</small>
            </td>
            <td class="sdk-form-matrix-choice-cell">
              <el-radio-group
                size="small"
                :model-value="selectedTier(row.key)"
                :aria-label="row.label"
                :disabled="disabled || row.disabled"
                @update:model-value="setRow(row.key, $event as number)"
              >
                <el-radio-button
                  v-for="(option, index) in control.options"
                  :key="index"
                  :value="index"
                  :disabled="option.disabled"
                  :title="option.disabledReason ?? undefined"
                >
                  {{ option.label }}
                </el-radio-button>
              </el-radio-group>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <template v-else>
      <fieldset
        v-for="row in control.rows"
        :key="row.key"
        :disabled="disabled || row.disabled"
        :class="{ 'is-indented': row.indent }"
      >
        <legend>
          <small v-if="row.badge" class="sdk-form-matrix-badge">{{ row.badge }}</small>
          {{ row.label }}
        </legend>
        <small v-if="row.description">{{ row.description }}</small>
        <small v-if="row.disabledReason">{{ row.disabledReason }}</small>
        <el-radio-group
          :model-value="selectedTier(row.key)"
          :aria-label="row.label"
          :disabled="disabled || row.disabled"
          @update:model-value="setRow(row.key, $event as number)"
        >
          <span v-for="(option, index) in control.options" :key="index" :title="option.disabledReason ?? undefined">
            <el-radio :value="index" :disabled="option.disabled" :aria-description="option.disabledReason ?? undefined">
              {{ option.label }}
            </el-radio>
          </span>
        </el-radio-group>
      </fieldset>
    </template>
    <form-retained-choices :entries="unknownEntries" :disabled="disabled" @remove="removeUnknown"></form-retained-choices>
  </div>
</template>

<style scoped>
.sdk-form-matrix {
  display: grid;
  width: 100%;
  gap: var(--spacing-sm);
}
.sdk-form-matrix-bulk {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}
.sdk-form-matrix-table-wrap {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
}
.sdk-form-matrix-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.sdk-form-matrix-table thead th {
  padding: 8px var(--spacing-md);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  text-align: left;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.sdk-form-matrix-choice-col,
.sdk-form-matrix-choice-cell {
  text-align: right;
  white-space: nowrap;
}
.sdk-form-matrix-table tbody tr {
  border-bottom: 1px solid var(--el-border-color-lighter);
  transition: background-color 0.15s ease;
}
.sdk-form-matrix-table tbody tr:last-child {
  border-bottom: 0;
}
.sdk-form-matrix-table tbody tr:hover:not(.is-disabled) {
  background: var(--el-fill-color-lighter);
}
.sdk-form-matrix-table tbody tr.is-disabled {
  background: var(--ui-fill-quaternary);
  color: var(--el-text-color-secondary);
}
.sdk-form-matrix-row-cell {
  padding: 6px var(--spacing-md);
  vertical-align: middle;
}
.sdk-form-matrix-table tbody tr.is-indented .sdk-form-matrix-row-cell {
  padding-inline-start: calc(var(--spacing-md) + var(--spacing-lg));
}
.sdk-form-matrix-table tbody tr.is-indented .sdk-form-matrix-row-label {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.sdk-form-matrix-choice-cell {
  padding: 6px var(--spacing-md);
  vertical-align: middle;
}
.sdk-form-matrix-row-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs);
}
.sdk-form-matrix-row-note {
  display: block;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.sdk-form-matrix fieldset {
  display: grid;
  gap: var(--spacing-xs);
  min-width: 0;
  margin: 0;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-sm);
}
.sdk-form-matrix fieldset.is-indented {
  margin-inline-start: var(--spacing-lg);
}
.sdk-form-matrix fieldset:disabled {
  background: var(--ui-fill-quaternary);
  color: var(--el-text-color-secondary);
}
.sdk-form-matrix-badge {
  padding-inline: var(--spacing-xs);
  border-radius: var(--radius-xs);
  background: var(--ui-fill-secondary);
  font-size: var(--text-xs);
}
</style>
