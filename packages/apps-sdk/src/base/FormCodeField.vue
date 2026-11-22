<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { valueAt } from "../panel/form-values";
import { useFormControls } from "./form-controls";

/**
 * A code field of an owner form, in the platform's code editor — fetched when a form first draws one, not with every
 * panel. Python, Markdown and the like are the owner's text as it is. JSON whose value schema is not a string is the
 * owner's JSON value: the source shown is that value, an edit that parses writes the parsed value, and one that does not
 * stays here as text, marked on the field, and the form will not save it; nothing is ever stored as a string instead.
 * No value is drawn as no text, as every empty field is, never as the word null, and emptied text is no value.
 */
const props = defineProps<{ field: PanelFormField; path: string; disabled: boolean }>();
const CodeEditor = defineAsyncComponent(() => import("@ontomato/foundation-ui/code").then((module) => module.CodeEditor));
const controls = useFormControls();
const { t } = useI18n();

const language = computed(() => (props.field.control.kind === "code" ? props.field.control.language : "text"));
/** Whether the source edits the owner's JSON value rather than being the value. */
const parses = computed(() => language.value === "json" && props.field.valueSchema.type !== "string");
const value = computed(() => valueAt(controls.values.value, props.path));

const format = (held: RuntimeJsonValue | undefined) =>
  parses.value ? (held === undefined || held === null ? "" : JSON.stringify(held, null, 2)) : typeof held === "string" ? held : "";
const text = ref(format(value.value));
/** Whether the text shown is not a value the form holds. */
let invalid = false;

function shows(held: RuntimeJsonValue | undefined): boolean {
  if (!parses.value) return text.value === held;
  if (text.value.trim() === "") return held === undefined || held === null;
  try {
    return JSON.stringify(JSON.parse(text.value)) === JSON.stringify(held);
  } catch {
    return false;
  }
}

// The form's value changed from elsewhere (a reading, a draft, a discard): show it, unless the reader's text says it.
watch(value, (held) => {
  if (!invalid && !shows(held)) text.value = format(held);
});
// The form let go of the reader's unparsed text (a discard or a new reading): show the value it holds.
watch(() => controls.errors.value[props.path], (message) => {
  if (!invalid || message !== undefined) return;
  invalid = false;
  text.value = format(value.value);
});

function edit(source: string) {
  text.value = source;
  if (!parses.value) return controls.set(props.path, source);
  let parsed: RuntimeJsonValue;
  try {
    parsed = source.trim() === "" ? null : JSON.parse(source) as RuntimeJsonValue;
  } catch (reason) {
    invalid = true;
    controls.invalid(props.path, t("platform.formInvalidJson", { message: (reason as Error).message }));
    return;
  }
  if (invalid) {
    invalid = false;
    controls.invalid(props.path, null);
  }
  controls.set(props.path, parsed);
}
</script>

<template>
  <code-editor
    class="sdk-form-code"
    :model-value="text"
    :language="language"
    :readonly="disabled"
    :min-height="120"
    @update:model-value="edit"
  ></code-editor>
</template>

<style scoped>
.sdk-form-code {
  width: 100%;
}
</style>
