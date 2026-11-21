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
      :is="controls.rowControl(path, field.path)"
      v-if="controls.rowControl(path, field.path)"
      class="sdk-form-field"
      :path="path + '/' + index + field.path"
    ></component>
    <p v-else-if="controls.rowControl(path, field.path) === undefined" role="alert" class="sdk-form-field-unavailable">
      {{ field.label }}: {{ t("platform.formControlUnavailable") }}
    </p>
  </template>
  <form-field-control v-else :field="field" :path="path + '/' + index + field.path" :disabled="disabled"></form-field-control>
</template>

<style scoped>
/* Fields share a row's line, each at least wide enough to read. */
.sdk-form-field,
.sdk-form-field-unavailable {
  flex: 1 1 160px;
  min-width: 0;
}
.sdk-form-field-unavailable {
  color: var(--el-color-danger-text);
  font-size: var(--text-xs);
  margin: 0;
}
</style>
