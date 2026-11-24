<script setup lang="ts">
import { computed, onBeforeUnmount, watchEffect } from "vue";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import FormAdvancedSection from "./FormAdvancedSection.vue";
import FormFieldPlace from "./FormFieldPlace.vue";
import { useFormFieldsContext, type FormFieldPlacement } from "./object-form-types";

/**
 * Renders a chosen slice of an enclosing `ObjectForm`'s fields inside any panel-authored card, tab pane, or wizard step
 * while sharing the form's single form state, validation, dirty state, `usePanelFormDraft`, `usePanelBack`, and live
 * assistant form filling. Select fields by explicit JSON Pointer paths (`fields`), a `parent` object field, an owner
 * `section` key, a declared `group` key, or `rest` (remaining non-hidden top-level fields).
 */
const props = withDefaults(
  defineProps<{
    /** Absolute JSON Pointers to active fields, including object sub-fields (for example `["/name", "/settings/mode"]`). */
    fields?: readonly string[];
    /** Absolute JSON Pointer to an active object field whose visible children should render in this container. */
    parent?: string;
    /** Owner `description.sections` key whose fields should render in this container. */
    section?: string;
    /** Declared `ObjectForm` `config.groups` key whose fields should render in this container. */
    group?: string;
    /** Render all remaining non-hidden owner fields not claimed by other `<object-form-fields>` slices in this form. */
    rest?: boolean;
    /** Field paths to omit from this slice, as absolute JSON Pointers or paths relative to the containing object. */
    exclude?: readonly string[];
    /** Render fields marked `advanced: true` directly inline instead of collapsing them into an Advanced disclosure. */
    inlineAdvanced?: boolean;
  }>(),
  {
    fields: undefined,
    parent: undefined,
    section: undefined,
    group: undefined,
    rest: false,
    exclude: undefined,
    inlineAdvanced: false,
  },
);

const context = useFormFieldsContext();
const claimToken = Symbol("object-form-fields");

const excluded = computed(() => new Set(props.exclude ?? []));

const topLevelPlacement = (field: PanelFormField): FormFieldPlacement => ({
  field,
  path: field.path,
  disabled: field.readOnly,
});

const selected = computed(() => {
  const all = context.drawn.value;
  let matched: readonly FormFieldPlacement[];
  if (props.parent !== undefined) {
    matched = context.childFields(props.parent);
  } else if (props.rest) {
    const claimed = context.claimedPaths.value;
    matched = all.filter((field) => !claimed.has(field.path)).map(topLevelPlacement);
  } else if (props.fields?.length) {
    matched = props.fields.flatMap((path) => {
      const entry = context.resolveField(path);
      return entry ? [entry] : [];
    });
  } else if (props.group) {
    matched = context.groups.value.find((group) => group.key === props.group)?.fields.map(topLevelPlacement) ?? [];
  } else if (props.section) {
    matched = all.filter((field) => field.section === props.section).map(topLevelPlacement);
  } else {
    matched = all.map(topLevelPlacement);
  }
  return matched.filter(({ field, path }) => !excluded.value.has(path) && !excluded.value.has(field.path));
});

watchEffect(() => {
  if (props.rest) {
    context.unregisterClaim(claimToken);
    return;
  }
  const selectedPaths = new Set(selected.value.map(({ path }) => path));
  context.registerClaim(claimToken, new Set(context.drawn.value.map(({ path }) => path).filter((path) => selectedPaths.has(path))));
});

onBeforeUnmount(() => {
  context.unregisterClaim(claimToken);
});

const plain = computed(() =>
  props.inlineAdvanced ? selected.value : selected.value.filter(({ field }) => field.advanced !== true),
);
const advanced = computed(() =>
  props.inlineAdvanced ? [] : selected.value.filter(({ field }) => field.advanced === true),
);
</script>

<template>
  <div class="sdk-object-form-fields" :data-form-group="group || section || (rest ? 'rest' : undefined)">
    <FormFieldPlace v-for="entry in plain" :key="entry.path" :field="entry.field" :path="entry.path" :disabled="entry.disabled" />
    <FormAdvancedSection v-if="advanced.length" :paths="advanced.map((entry) => entry.path)">
      <FormFieldPlace v-for="entry in advanced" :key="entry.path" :field="entry.field" :path="entry.path" :disabled="entry.disabled" />
    </FormAdvancedSection>
  </div>
</template>

<style scoped>
.sdk-object-form-fields {
  min-width: 0;
}
</style>
