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
    /** Fallback placeholder text shown in standalone inline mode when `placeholderKey` resolves no text. */
    placeholder?: string;
    /** Panel message key (resolved via `panel.t`) or platform i18n key for the placeholder in standalone inline mode. */
    placeholderKey?: string;
    /** Whether the reader can clear the selection in standalone inline mode; defaults to `true`. */
    clearable?: boolean;
    /** Disables the standalone inline selector. */
    disabled?: boolean;
    /** Visual control size in standalone inline mode (`"small"` by default for compact toolbars). */
    size?: "small" | "default" | "large";
    /** Optional record field key in `row.fields` used to group options in standalone inline mode (`data.rows`). */
    groupBy?: string;
    /** Optional record field key in `row.fields` displayed as right-aligned secondary metadata (e.g. counts) in standalone inline mode (`data.rows`). */
    metaField?: string;
    /** Show a 6px warning dot beside options and the selected value that have an unsaved local draft in this browser. */
    showDraftIndicator?: boolean;
    /** Auto-select the first available option once loaded when the current selection is empty or no longer present. */
    fallbackToFirst?: boolean;
    /** Offer a manual refresh for a form field's choices. */
    refreshable?: boolean;
  }>(),
  {
    placeholder: undefined,
    placeholderKey: undefined,
    clearable: true,
    disabled: false,
    size: "small",
    groupBy: undefined,
    metaField: undefined,
    showDraftIndicator: undefined,
    fallbackToFirst: undefined,
    refreshable: undefined,
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
    :show-draft-indicator="props.showDraftIndicator"
    :fallback-to-first="props.fallbackToFirst"
    :refreshable="props.refreshable"
  >
    <template v-if="$slots.option" #option="scope">
      <slot name="option" v-bind="scope"></slot>
    </template>
  </ReferenceChoice>
  <InlineReferencePicker
    v-else
    :placeholder="props.placeholder"
    :placeholder-key="props.placeholderKey"
    :clearable="props.clearable"
    :disabled="props.disabled"
    :size="props.size"
    :group-by="props.groupBy"
    :meta-field="props.metaField"
    :show-draft-indicator="props.showDraftIndicator"
    :fallback-to-first="props.fallbackToFirst"
    @update:selected="emit('update:selected', $event)"
  >
    <template v-if="$slots.option" #option="scope">
      <slot name="option" v-bind="scope"></slot>
    </template>
  </InlineReferencePicker>
</template>
