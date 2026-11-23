<script setup lang="ts">
import { computed } from "vue";
import { useFormFieldSlot } from "../panel/slot-context";
import type { PanelObjectRef } from "../panel/state";
import InlineReferencePicker from "./InlineReferencePicker.vue";
import ReferenceChoice from "./ReferenceChoice.vue";

/**
 * Chooses a reference from the bound type's records or option catalogue.
 *
 * - **Form field mode**: when placed inside an `ObjectForm` field slot (`#field-<path>`, `#field-<arrayPath>/*<itemPath>`,
 *   or `#field`), automatically connects to the enclosing form field via `useFormFieldSlot()` and renders `ReferenceChoice`
 *   in place so edits are saved, discarded, and drafted with the form.
 * - **Standalone inline mode**: otherwise renders a compact filterable single-select dropdown directly in place, syncing
 *   the chosen `{ className, primaryKey }` (or `null` when cleared) through the `selected` member parameter.
 */
const props = withDefaults(
  defineProps<{
    /** Fallback placeholder text shown in standalone inline mode when neither `placeholderKey` nor `placeholders` resolves one. */
    placeholder?: string;
    /** Panel message key (resolved via `panel.t`) or platform i18n key for the placeholder in standalone inline mode. */
    placeholderKey?: string;
    /** Locale-keyed placeholder strings (e.g. `{ en: "Select start", de: "Start wählen" }`) in standalone inline mode. */
    placeholders?: Readonly<Record<string, string>>;
    /** Whether the reader can clear the selection in standalone inline mode; defaults to `true`. */
    clearable?: boolean;
    /** Disables the standalone inline selector. */
    disabled?: boolean;
    /** Visual control size in standalone inline mode (`"small"` by default for compact toolbars). */
    size?: "small" | "default" | "large";
  }>(),
  {
    placeholder: undefined,
    placeholderKey: undefined,
    placeholders: undefined,
    clearable: true,
    disabled: false,
    size: "small",
  },
);

const emit = defineEmits<{
  /** Emitted in standalone inline mode when the selected object reference changes or is cleared to `null`. */
  "update:selected": [value: PanelObjectRef | null];
}>();

const fieldSlot = useFormFieldSlot();
const choosesField = computed(() => fieldSlot !== null);

defineSlots<{
  /** Custom option row renderer inside the dropdown list (both form-field and standalone modes). */
  option?(props: { option: unknown; selected: boolean; disabled: boolean }): unknown;
}>();
</script>

<template>
  <ReferenceChoice
    v-if="choosesField && fieldSlot"
    :form-slot="fieldSlot.formSlot"
    :path="fieldSlot.path.value"
  >
    <template v-if="$slots.option" #option="scope">
      <slot name="option" v-bind="scope"></slot>
    </template>
  </ReferenceChoice>
  <InlineReferencePicker
    v-else
    :placeholder="props.placeholder"
    :placeholder-key="props.placeholderKey"
    :placeholders="props.placeholders"
    :clearable="props.clearable"
    :disabled="props.disabled"
    :size="props.size"
    @update:selected="emit('update:selected', $event)"
  >
    <template v-if="$slots.option" #option="scope">
      <slot name="option" v-bind="scope"></slot>
    </template>
  </InlineReferencePicker>
</template>
