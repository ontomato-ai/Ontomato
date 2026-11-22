<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElFormItem } from "element-plus/es/components/form/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { cloneJsonValue, jsonValuesEqual, valueAt } from "../panel/form-values";
import { formControlsKey } from "./form-controls";

/**
 * The shared presentation frame of one form field — whether drawn by `FormFieldControl` or by a `formField` member
 * (`ReferencePicker`, `ObjectGraph`). It owns the field's label, required/changed markers, help/read-only note,
 * validation error placement, non-blocking `warning`, optional "Reset to default" action (when `defaultValue !==
 * undefined`, including `null`), and switches top-level fields between `stacked` and settings `rows` layouts.
 */
const props = withDefaults(defineProps<{
  field: PanelFormField;
  path: string;
  error?: string;
  changed?: boolean;
  disabled?: boolean;
  fieldClass?: string;
  /** Current value when drawn outside `ObjectForm` (such as an isolated field-member harness). */
  value?: RuntimeJsonValue | undefined;
  /** Value writer when drawn outside `ObjectForm`. */
  onSet?: (value: RuntimeJsonValue) => void;
}>(), { error: undefined, changed: false, disabled: false, fieldClass: "", value: undefined, onSet: undefined });

const controls = inject(formControlsKey, null);
const { t } = useI18n();

const isRow = computed(() => controls !== null && controls.layout.value === "rows" && controls.isTopLevel(props.path));
const hasDefaultsColumn = computed(() => controls?.hasDefaults.value ?? false);
const helpText = computed(() => {
  if (props.field.readOnly && props.field.readOnlyReason) {
    return controls?.sharedReadOnlyReasons.value.has(props.field.readOnlyReason) ? null : props.field.readOnlyReason;
  }
  return props.field.help || null;
});
const warningText = computed(() => props.field.warning?.trim() || null);
const hasDefault = computed(() => props.field.defaultValue !== undefined);
const currentValue = computed(() => (controls ? valueAt(controls.values.value, props.path) : props.value));
const atDefault = computed(() =>
  hasDefault.value
  && !(controls?.hasInvalid(props.path) ?? false)
  && jsonValuesEqual(currentValue.value, props.field.defaultValue),
);
const resetDisabled = computed(() => props.disabled || props.field.readOnly || (controls?.busy.value ?? false) || atDefault.value);

function resetToDefault() {
  if (resetDisabled.value || props.field.defaultValue === undefined) return;
  const next = cloneJsonValue(props.field.defaultValue);
  if (controls) {
    if (controls.hasInvalid(props.path)) controls.invalid(props.path, null);
    controls.set(props.path, next);
  } else {
    props.onSet?.(next);
  }
}
</script>

<template>
  <div
    v-if="isRow"
    class="sdk-form-row-item"
    :class="[fieldClass, { 'is-readonly': field.readOnly, 'is-changed': changed, 'has-reset-column': hasDefaultsColumn }]"
    :data-field="path"
    data-form-layout="rows"
  >
    <div class="sdk-form-row-meta">
      <span class="sdk-form-row-label" :class="{ 'is-required': field.required, 'is-changed': changed }">{{ field.label }}</span>
      <p v-if="helpText" class="sdk-form-row-help">{{ helpText }}</p>
    </div>
    <div class="sdk-form-row-control">
      <el-form-item
        class="sdk-form-row-control-item"
        :error="error"
        :required="field.required"
        :aria-label="field.label"
      >
        <slot></slot>
      </el-form-item>
      <p v-if="warningText" class="sdk-form-field-warning" role="status" data-field-warning>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="sdk-form-field-warning-icon" aria-hidden="true">
          <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9A1 1 0 0 1 13.2 13H2.8a1 1 0 0 1-.87-1.5l5.2-9Z"></path>
          <path d="M8 6v3"></path>
          <path d="M8 11.25h.01"></path>
        </svg>
        <span>{{ warningText }}</span>
      </p>
      <slot name="after"></slot>
    </div>
    <div v-if="hasDefaultsColumn" class="sdk-form-row-actions">
      <el-button
        v-if="hasDefault"
        text
        size="small"
        class="sdk-form-field-reset"
        data-field-reset
        :disabled="resetDisabled"
        @click="resetToDefault"
      >
        {{ t("platform.formResetToDefault") }}
      </el-button>
    </div>
  </div>
  <el-form-item
    v-else
    class="sdk-form-field-frame"
    :class="[fieldClass, { 'sdk-form-field-changed': changed, 'is-readonly': field.readOnly, 'has-warning': Boolean(warningText) }]"
    :label="field.label"
    :required="field.required"
    :error="error"
    :data-field="path"
  >
    <slot></slot>
    <p v-if="warningText" class="sdk-form-field-warning" role="status" data-field-warning>
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="sdk-form-field-warning-icon" aria-hidden="true">
        <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9A1 1 0 0 1 13.2 13H2.8a1 1 0 0 1-.87-1.5l5.2-9Z"></path>
        <path d="M8 6v3"></path>
        <path d="M8 11.25h.01"></path>
      </svg>
      <span>{{ warningText }}</span>
    </p>
    <slot name="after"></slot>
    <div v-if="helpText && hasDefault" class="sdk-form-field-footer">
      <p class="sdk-form-field-help">{{ helpText }}</p>
      <el-button
        text
        size="small"
        class="sdk-form-field-reset"
        data-field-reset
        :disabled="resetDisabled"
        @click="resetToDefault"
      >
        {{ t("platform.formResetToDefault") }}
      </el-button>
    </div>
    <p v-else-if="helpText" class="sdk-form-field-help">{{ helpText }}</p>
    <div v-else-if="hasDefault" class="sdk-form-field-footer">
      <el-button
        text
        size="small"
        class="sdk-form-field-reset"
        data-field-reset
        :disabled="resetDisabled"
        @click="resetToDefault"
      >
        {{ t("platform.formResetToDefault") }}
      </el-button>
    </div>
  </el-form-item>
</template>

<style scoped>
/* A value the owner keeps read-only is still the reader's to read: Element Plus's disabled grey is for a control that is
   off, not for a value that is shown. */
.is-readonly :deep(:is(.el-input__inner, .el-textarea__inner, .el-select__selected-item)) {
  color: var(--el-text-color-regular);
  -webkit-text-fill-color: var(--el-text-color-regular);
}
.sdk-form-field-changed > :deep(.el-form-item__label) {
  color: var(--brand-link);
}
.sdk-form-field-frame.has-warning :deep(.el-form-item__error),
.sdk-form-row-control-item :deep(.el-form-item__error) {
  position: static;
  width: 100%;
  padding-top: var(--spacing-xs);
  line-height: 1.4;
}
.sdk-form-field-help {
  width: 100%;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
  margin: var(--spacing-xs) 0 0;
}
.sdk-form-field-footer {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--spacing-sm);
  width: 100%;
  margin-top: var(--spacing-xs);
}
.sdk-form-field-footer .sdk-form-field-help {
  width: auto;
  flex: 1 1 auto;
  margin: 0;
}
.sdk-form-field-reset {
  flex: none;
  padding-inline: var(--spacing-xs);
  white-space: nowrap;
}
.sdk-form-field-warning {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-xs);
  width: 100%;
  margin: var(--spacing-xs) 0 0;
  color: var(--el-color-warning-dark-2);
  font-size: var(--text-xs);
  line-height: 1.5;
}
.sdk-form-field-warning-icon {
  flex: none;
  margin-top: 2px;
}

/* Settings row layout: name and help on the left, control/error/warning in the middle, reset on the right. */
.sdk-form-row-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 360px);
  gap: var(--spacing-md) var(--spacing-lg);
  align-items: start;
  padding-block: var(--spacing-md);
  border-bottom: 1px solid var(--ui-divider);
}
.sdk-form-row-item.has-reset-column {
  grid-template-columns: minmax(0, 1fr) minmax(0, 360px) minmax(96px, auto);
}
.sdk-form-row-meta {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}
.sdk-form-row-label {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  line-height: 1.5;
}
.sdk-form-row-label.is-required::after {
  content: "*";
  color: var(--el-color-danger);
  margin-inline-start: 4px;
}
.sdk-form-row-label.is-changed {
  color: var(--brand-link);
}
.sdk-form-row-help {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
}
.sdk-form-row-control {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sdk-form-row-control-item {
  margin-bottom: 0;
  width: 100%;
}
.sdk-form-row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: var(--control-height, 32px);
}

/* Narrow containers and mobile viewports stack each settings row vertically without clipping or squishing controls. */
@container sdk-owner-form (max-width: 680px) {
  .sdk-form-row-item,
  .sdk-form-row-item.has-reset-column {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--spacing-sm);
  }
  .sdk-form-row-actions {
    justify-content: flex-start;
    min-height: 0;
  }
}
@media (max-width: 768px) {
  .sdk-form-row-item,
  .sdk-form-row-item.has-reset-column {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--spacing-sm);
  }
  .sdk-form-row-actions {
    justify-content: flex-start;
    min-height: 0;
  }
}
</style>
