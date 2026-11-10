<script setup lang="ts">
import { ElFormItem, ElInput, ElOption, ElSelect } from "element-plus";
import type { FormField } from "@ontomato/contracts/form-fields";

type SelectField = Extract<FormField, { type: "select" }>;

/**
 * Draws a form exactly as its owner declared it: a choice is a select, whose unavailable options stay listed with the
 * reason; a text is an input, or a large text box where the owner asks for several lines (a prompt, a list, JSON). The
 * fields come in the owner's order with its labels, help and limits; the page adds no field and no rule.
 */
defineProps<{
  /** The fields in the owner's order, each a select or a text as the owner declares it. */
  fields: readonly FormField[];
  /** What each field holds now, as text by field key; the caller keeps it, following `input` and `choose`. */
  values: Readonly<Record<string, string>>;
  /** The message each field shows, by field key. */
  errors: Readonly<Record<string, string>>;
  /** While the owner answers for a new choice, the fields wait instead of taking input. */
  disabled: boolean;
  /** What a select shows before anything is chosen. */
  choosePlaceholder: string;
  /** Keys of the fields shown with their value but not typed into. */
  readOnly?: readonly string[];
}>();
const emit = defineEmits<{
  /** A text changed: the draft follows it, the owner is not asked again. */
  input: [key: string, value: string];
  /** A choice changed; the caller asks the owner again when the field says the form depends on it. */
  choose: [field: SelectField, value: string];
}>();

function chosen(field: SelectField, value: string | undefined) {
  return field.options.find((option) => option.value === value) ?? null;
}
</script>

<template>
  <div class="form-fields">
    <el-form-item
      v-for="field in fields"
      :key="field.key"
      :label="field.label"
      :error="errors[field.key] ?? ''"
      :data-field="field.key"
    >
      <p v-if="readOnly?.includes(field.key)" class="read-only">{{ values[field.key] || "—" }}</p>
      <template v-else-if="field.type === 'select'">
        <el-select
          :model-value="values[field.key] || undefined"
          :placeholder="choosePlaceholder"
          :disabled="disabled"
          filterable
          class="control"
          popper-class="form-field-options"
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
.form-fields {
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
.read-only {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  line-height: var(--leading-sm);
  overflow-wrap: anywhere;
  user-select: text;
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
:global(.form-field-options .el-select-dropdown__item) {
  height: auto;
  min-height: var(--control-height);
  line-height: var(--leading-sm);
  white-space: normal;
}
</style>
