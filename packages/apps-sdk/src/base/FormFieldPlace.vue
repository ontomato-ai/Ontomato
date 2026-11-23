<script setup lang="ts">
import { computed } from "vue";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { useFormControls } from "./form-controls";
import FormFieldControl from "./FormFieldControl.vue";
import FormFieldSlotHost from "./FormFieldSlotHost.vue";

/**
 * One field of an owner form in its place among the form's fields: drawn by a custom Vue slot (`#field-<path>` or
 * `#field`) when the panel supplies one, else by its default control.
 */
const props = defineProps<{ field: PanelFormField }>();
const controls = useFormControls();
const customSlot = computed(() => controls.resolveFieldSlot(props.field, props.field.path));
</script>

<template>
  <form-field-slot-host
    v-if="customSlot"
    :form-slot="controls.formSlot"
    :path="props.field.path"
    :field="props.field"
    :render-slot="customSlot.slot"
    :slot-props="customSlot.props"
  >
    <form-field-control :field="props.field" :path="props.field.path"></form-field-control>
  </form-field-slot-host>
  <form-field-control v-else :field="props.field" :path="props.field.path"></form-field-control>
</template>
