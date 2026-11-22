<script setup lang="ts">
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { useFormControls } from "./form-controls";
import FormFieldControl from "./FormFieldControl.vue";

/**
 * One field of an owner form in its place among the form's fields: drawn by the projection the panel declares for it
 * (a reference's choice, a graph of the data scope) once that projection has drawn, else by its own control.
 */
const props = defineProps<{ field: PanelFormField }>();
const controls = useFormControls();
</script>

<template>
  <template v-if="controls.fieldControl(props.field.path) !== undefined">
    <component :is="controls.fieldControl(props.field.path)" v-if="controls.fieldControl(props.field.path)" :path="props.field.path"></component>
  </template>
  <form-field-control v-else :field="props.field" :path="props.field.path"></form-field-control>
</template>
