<script setup lang="ts">
import { computed, onBeforeUnmount, watchEffect } from "vue";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import FormAdvancedSection from "./FormAdvancedSection.vue";
import FormFieldPlace from "./FormFieldPlace.vue";
import { useFormFieldsContext } from "./object-form-types";

/**
 * Renders a chosen slice of an enclosing `ObjectForm`'s fields inside any panel-authored card, tab pane, or wizard step
 * while sharing the form's single draft, validation, dirty state, `usePanelFormDraft`, `usePanelBack`, and agent draft
 * lifecycle. Select fields by explicit JSON Pointer paths (`fields`), an owner `section` key, a declared `group` key,
 * or `rest` (all remaining non-hidden fields not claimed by sibling `<object-form-fields>` slices).
 */
const props = withDefaults(
  defineProps<{
    /** Top-level owner field JSON Pointer paths to render in this container (for example `["/name", "/displayName"]`). */
    fields?: readonly string[];
    /** Owner `description.sections` key whose fields should render in this container. */
    section?: string;
    /** Declared `ObjectForm` `config.groups` key whose fields should render in this container. */
    group?: string;
    /** Render all remaining non-hidden owner fields not claimed by other `<object-form-fields>` slices in this form. */
    rest?: boolean;
    /** Optional field paths to omit from this slice (useful alongside `rest` or `section`). */
    exclude?: readonly string[];
    /** Render fields marked `advanced: true` directly inline instead of collapsing them into an Advanced disclosure. */
    inlineAdvanced?: boolean;
  }>(),
  {
    fields: undefined,
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

const selected = computed<readonly PanelFormField[]>(() => {
  const all = context.drawn.value;
  let matched: readonly PanelFormField[];
  if (props.rest) {
    const claimed = context.claimedPaths.value;
    matched = all.filter((field) => !claimed.has(field.path));
  } else if (props.fields && props.fields.length > 0) {
    const byPath = new Map(all.map((field) => [field.path, field]));
    matched = props.fields
      .map((path) => byPath.get(path))
      .filter((field): field is PanelFormField => field !== undefined);
  } else if (props.group) {
    const found = context.groups.value.find((item) => item.key === props.group);
    matched = found ? found.fields : [];
  } else if (props.section) {
    matched = all.filter((field) => field.section === props.section);
  } else {
    matched = all;
  }
  return excluded.value.size > 0 ? matched.filter((field) => !excluded.value.has(field.path)) : matched;
});

watchEffect(() => {
  if (props.rest) {
    context.unregisterClaim(claimToken);
    return;
  }
  context.registerClaim(claimToken, new Set(selected.value.map((field) => field.path)));
});

onBeforeUnmount(() => {
  context.unregisterClaim(claimToken);
});

const plain = computed(() =>
  props.inlineAdvanced ? selected.value : selected.value.filter((field) => field.advanced !== true),
);
const advanced = computed(() =>
  props.inlineAdvanced ? [] : selected.value.filter((field) => field.advanced === true),
);
</script>

<template>
  <div class="sdk-object-form-fields" :data-form-group="group || section || (rest ? 'rest' : undefined)">
    <FormFieldPlace v-for="field in plain" :key="field.path" :field="field" />
    <FormAdvancedSection v-if="advanced.length" :paths="advanced.map((field) => field.path)">
      <FormFieldPlace v-for="field in advanced" :key="field.path" :field="field" />
    </FormAdvancedSection>
  </div>
</template>

<style scoped>
.sdk-object-form-fields {
  min-width: 0;
}
</style>
