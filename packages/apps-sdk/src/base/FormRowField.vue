<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { useFormControls } from "./form-controls";
import FormFieldControl from "./FormFieldControl.vue";
import FormFieldSlotHost from "./FormFieldSlotHost.vue";

/**
 * One field of a row of the array at `path`, at the row's current `index`: drawn by a custom Vue slot
 * (`#field-<arrayPath>/*<itemPath>` or `#field`) when supplied, else by its default control.
 */
const props = defineProps<{ field: PanelFormField; path: string; index: number; disabled: boolean }>();
const { t } = useI18n();
const controls = useFormControls();
const absolutePath = computed(() => `${props.path}/${props.index}${props.field.path}`);
const customSlot = computed(() => controls.resolveFieldSlot(props.field, absolutePath.value, props.disabled, props.path, props.index));
</script>

<template>
  <form-field-slot-host
    v-if="customSlot"
    class="sdk-form-field"
    :class="{ 'sdk-form-field-full-width': field.fullWidth === true }"
    :form-slot="controls.formSlot"
    :path="absolutePath"
    :field="props.field"
    :index="props.index"
    :render-slot="customSlot.slot"
    :slot-props="customSlot.props"
  >
    <p v-if="field.control.kind === 'reference'" role="alert" class="sdk-form-field-unavailable">
      {{ field.label }}: {{ t("platform.formControlUnavailable") }}
    </p>
    <form-field-control v-else :field="props.field" :path="absolutePath" :disabled="disabled"></form-field-control>
  </form-field-slot-host>
  <p
    v-else-if="field.control.kind === 'reference'"
    role="alert"
    class="sdk-form-field-unavailable"
    :class="{ 'sdk-form-field-full-width': field.fullWidth === true }"
  >
    {{ field.label }}: {{ t("platform.formControlUnavailable") }}
  </p>
  <form-field-control v-else :field="props.field" :path="absolutePath" :disabled="disabled"></form-field-control>
</template>

<style scoped>
/* A row's fields share its lines, as many to a line as fit with every field at least 12rem wide, so no input is narrower
   than a value can be read in (panelisation lead, 2026-11-22): where there is less room, the row grows taller and its
   fields fill their lines, never an input cut down to a few letters. */
.sdk-form-field,
.sdk-form-field-unavailable {
  flex: 1 1 12rem;
  min-width: min(100%, 12rem);
}
.sdk-form-field-full-width {
  grid-column: 1 / -1;
}
.sdk-form-field-unavailable {
  color: var(--el-color-danger-text);
  font-size: var(--text-xs);
  margin: 0;
}
</style>
