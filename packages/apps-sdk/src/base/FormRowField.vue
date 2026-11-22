<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { useFormControls } from "./form-controls";
import FormFieldControl from "./FormFieldControl.vue";

/**
 * One field of a row of the array at `path`, at the row's current `index`: a reference is drawn by the projection
 * declared for it, any other field by its own control.
 */
defineProps<{ field: PanelFormField; path: string; index: number; disabled: boolean }>();
const { t } = useI18n();
const controls = useFormControls();
</script>

<template>
  <template v-if="field.control.kind === 'reference'">
    <component
      :is="controls.fieldControl(path, field.path)"
      v-if="controls.fieldControl(path, field.path)"
      class="sdk-form-field"
      :path="path + '/' + index + field.path"
    ></component>
    <p v-else-if="controls.fieldControl(path, field.path) === undefined" role="alert" class="sdk-form-field-unavailable">
      {{ field.label }}: {{ t("platform.formControlUnavailable") }}
    </p>
  </template>
  <form-field-control v-else :field="field" :path="path + '/' + index + field.path" :disabled="disabled"></form-field-control>
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
.sdk-form-field-unavailable {
  color: var(--el-color-danger-text);
  font-size: var(--text-xs);
  margin: 0;
}
</style>
