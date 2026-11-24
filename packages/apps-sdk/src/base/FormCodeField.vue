<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { valueAt } from "../panel/form-values";
import { useFormControls } from "./form-controls";

/**
 * A code field of an owner form, in the platform's code editor — fetched when a form first draws one, not with every
 * panel. Python, Markdown and the like are the owner's text as it is. JSON whose value schema is not a string is the
 * owner's JSON value: the source shown is that value, an edit that parses writes the parsed value, and one that does not
 * stays in the form draft as text, marked on the field, and the form will not save it as an owner value.
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
const invalidText = computed(() => controls.invalidText(props.path));
const text = ref(invalidText.value ?? format(value.value));

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
  if (invalidText.value === undefined && !shows(held)) text.value = format(held);
});
// The form let go of the reader's unparsed text (a discard or a new reading): show the value it holds.
watch(invalidText, (source) => {
  if (source !== undefined) text.value = source;
  else if (!shows(value.value)) text.value = format(value.value);
});

function edit(source: string) {
  text.value = source;
  if (!parses.value) return controls.set(props.path, source);
  let parsed: RuntimeJsonValue;
  try {
    parsed = source.trim() === "" ? null : JSON.parse(source) as RuntimeJsonValue;
  } catch (reason) {
    controls.invalid(props.path, { source, message: t("platform.formInvalidJson", { message: (reason as Error).message }) });
    return;
  }
  if (invalidText.value !== undefined) controls.invalid(props.path, null);
  controls.set(props.path, parsed);
}

// Switching away from a variant or removing an object unmounts this editor; drop its local unparseable state so an
// inactive field never keeps blocking saves or leaves a stale error if the reader switches back later.
onBeforeUnmount(() => {
  if (invalidText.value !== undefined) controls.invalid(props.path, null);
});
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
