<script setup lang="ts">
import type {
  PlatformScheduleContent,
  PlatformScheduleForm,
  PlatformScheduleFormField,
} from "@ontomato/contracts/platform-schedules";
import { useScheduleText } from "../text";

/**
 * An application's form, drawn exactly as the application declared it: a choice is a select, whose unavailable options
 * stay listed with the reason; a text is an input, or a large text box where the application asks for several lines
 * (a prompt, one item per line). The fields come in the application's order with its labels, defaults, help and
 * limits; the page adds no field and no rule of its own.
 */
defineProps<{
  form: PlatformScheduleForm;
  values: PlatformScheduleContent;
  /** The message each field shows, by field key. */
  errors: Readonly<Record<string, string>>;
  /** While the application answers for a new selection, the old fields wait instead of taking input. */
  disabled: boolean;
}>();
const emit = defineEmits<{
  /** A text changed: the draft follows it, the application is not asked again. */
  input: [key: string, value: string];
  /** A choice changed; the form asks the application again when the field says the form depends on it. */
  choose: [field: Extract<PlatformScheduleFormField, { type: "select" }>, value: string];
}>();
const { t } = useScheduleText();

function chosen(field: Extract<PlatformScheduleFormField, { type: "select" }>, value: string | undefined) {
  return field.options.find((option) => option.value === value) ?? null;
}
</script>

<template>
  <div class="fields">
    <p v-if="form.fields.length === 0" class="empty">{{ t("form.noFields") }}</p>
    <el-form-item
      v-for="field in form.fields"
      :key="field.key"
      :label="field.label"
      :error="errors[field.key] ?? ''"
      :data-field="field.key"
    >
      <template v-if="field.type === 'select'">
        <el-select
          :model-value="values[field.key] || undefined"
          :placeholder="t('form.choose')"
          :disabled="disabled"
          filterable
          class="control"
          popper-class="schedule-field-options"
          :aria-label="field.label"
          @update:model-value="emit('choose', field, String($event ?? ''))"
        >
          <el-option
            v-for="option in field.options"
            :key="option.value"
            :value="option.value"
            :label="option.label"
            :disabled="option.disabled"
          >
            <span class="option">
              <span class="option-label">{{ option.label }}</span>
              <span v-if="option.disabled" class="option-line">{{ option.disabledReason }}</span>
              <span v-else-if="option.description" class="option-line">{{ option.description }}</span>
            </span>
          </el-option>
        </el-select>
        <p v-if="chosen(field, values[field.key])?.description || field.help" class="help">
          <span v-if="chosen(field, values[field.key])?.description">{{ chosen(field, values[field.key])?.description }}</span>
          <span v-if="field.help">{{ field.help }}</span>
        </p>
      </template>
      <template v-else>
        <el-input
          :model-value="values[field.key] ?? ''"
          :type="field.multiline ? 'textarea' : 'text'"
          :autosize="field.multiline ? { minRows: 4, maxRows: 12 } : undefined"
          :maxlength="field.maxLength"
          :show-word-limit="field.multiline"
          :placeholder="field.placeholder ?? ''"
          :disabled="disabled"
          class="control"
          :aria-label="field.label"
          @update:model-value="emit('input', field.key, String($event))"
        />
        <p v-if="field.help" class="help">{{ field.help }}</p>
      </template>
    </el-form-item>
  </div>
</template>

<style scoped>
.fields {
  display: flex;
  flex-direction: column;
}
.control {
  width: 100%;
}
.help {
  width: 100%;
  margin: var(--spacing-xs) 0 0;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
.help span + span::before {
  content: " · ";
}
.empty {
  margin: 0 0 var(--spacing-lg);
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
}
/* An option with a second line (what it is, or why it is unavailable) grows to hold it. */
.option {
  display: flex;
  flex-direction: column;
  padding: var(--spacing-xs) 0;
  line-height: var(--leading-sm);
}
.option-line {
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
  white-space: normal;
}
:global(.schedule-field-options .el-select-dropdown__item) {
  height: auto;
  min-height: var(--control-height);
  line-height: var(--leading-sm);
  white-space: normal;
}
</style>
