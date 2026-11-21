<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElInput } from "element-plus/es/components/input/index";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { valueAt } from "../panel/form-values";
import { useFormControls } from "./form-controls";

/**
 * A text the owner keeps in several languages, edited as the owner stores it: `{language: text}`. The owner's primary
 * language (the reader's) comes first; every language that must have a text, has one, or holds the owner's message is
 * shown; the rest are added on demand. An optional language cleared or removed is no longer in the value; a required one
 * cleared is the empty text, for the owner to refuse. An optional text with no language holding a text is left out. A language the owner stores but no longer offers is shown by its
 * code, so nothing it holds is hidden.
 */
const props = defineProps<{ field: PanelFormField; path: string; disabled: boolean }>();
const controls = useFormControls();
const { t } = useI18n();

type Control = Extract<PanelFormField["control"], { kind: "localized-text" }>;
const control = computed(() => props.field.control as Control);
const texts = computed<Record<string, string>>(() => {
  const value = valueAt(controls.values.value, props.path);
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
});
/** Languages the reader added in this form and has not filled or removed yet. */
const added = ref<string[]>([]);
const required = computed(() => new Set(control.value.requiredLocales ?? []));
const errorOf = (code: string) => controls.errors.value[`${props.path}/${code}`];
const labelOf = (code: string) => control.value.locales.find((locale) => locale.code === code)?.label ?? code;

const shown = computed(() => {
  const order = [control.value.primaryLocale, ...control.value.locales.map((locale) => locale.code), ...Object.keys(texts.value)];
  return [...new Set(order)].filter((code) =>
    code === control.value.primaryLocale || required.value.has(code) || Object.hasOwn(texts.value, code)
    || added.value.includes(code) || errorOf(code) !== undefined);
});
const addable = computed(() => control.value.locales.filter((locale) => !shown.value.includes(locale.code)));

function write(code: string, text: string) {
  const next = { ...texts.value };
  if (text === "" && !required.value.has(code)) delete next[code];
  else next[code] = text;
  // An optional text with no language holding a text is not given at all, as an optional choice cleared — a language
  // it requires once given included, which is left as the empty text only while another language has one.
  if (!props.field.required && Object.values(next).every((kept) => kept === "")) controls.remove(props.path);
  else controls.set(props.path, next);
}
function add(code: string) {
  added.value = [...added.value, code];
}
function remove(code: string) {
  added.value = added.value.filter((kept) => kept !== code);
  if (Object.hasOwn(texts.value, code)) write(code, "");
}
</script>

<template>
  <div class="sdk-form-locales">
    <div v-for="code in shown" :key="code" class="sdk-form-locale" :data-locale="code">
      <span class="sdk-form-locale-label">{{ labelOf(code) }}<span v-if="required.has(code)" class="sdk-form-locale-required" aria-hidden="true"> *</span></span>
      <div class="sdk-form-locale-value">
        <el-input
          :model-value="texts[code] ?? ''"
          :type="control.multiline ? 'textarea' : 'text'"
          :autosize="control.multiline ? { minRows: 2 } : undefined"
          :maxlength="control.maxLength"
          :disabled="disabled"
          :aria-label="`${field.label} (${labelOf(code)})`"
          @update:model-value="write(code, String($event))"
        ></el-input>
        <p v-if="errorOf(code)" role="alert" class="sdk-form-locale-error">{{ errorOf(code) }}</p>
      </div>
      <el-button
        v-if="!disabled && !required.has(code) && code !== control.primaryLocale"
        text
        class="sdk-form-locale-remove"
        @click="remove(code)"
      >{{ t("platform.formRemove") }}</el-button>
    </div>
    <el-select
      v-if="!disabled && addable.length"
      class="sdk-form-locale-add"
      :model-value="null"
      :placeholder="t('platform.formAdd')"
      :aria-label="`${field.label}: ${t('platform.formAdd')}`"
      @update:model-value="add(String($event))"
    >
      <el-option v-for="locale in addable" :key="locale.code" :value="locale.code" :label="locale.label"></el-option>
    </el-select>
  </div>
</template>

<style scoped>
.sdk-form-locales {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  width: 100%;
}
/* A language's label, its text and its remove share a line while the text keeps at least 12rem; with less room the text
   goes under its label at the field's whole width, so a narrow field never cuts the text down. */
.sdk-form-locale {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--spacing-xs) var(--spacing-sm);
}
.sdk-form-locale-label {
  flex: 0 0 auto;
  min-width: 5rem;
  padding-block-start: var(--spacing-xs);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.sdk-form-locale-required {
  color: var(--el-color-danger-text);
}
.sdk-form-locale-value {
  flex: 1 1 12rem;
  min-width: min(100%, 12rem);
}
.sdk-form-locale-error {
  margin: var(--spacing-xs) 0 0;
  color: var(--el-color-danger-text);
  font-size: var(--text-xs);
}
.sdk-form-locale-add {
  width: 12rem;
  max-width: 100%;
}
</style>
