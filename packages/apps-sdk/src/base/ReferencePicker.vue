<script setup lang="ts">
import { computed, defineComponent, h, inject, onBeforeUnmount, provide } from "vue";
import { projectionKey, usePanelContext, useProjectionSlot } from "../panel/context";
import { panelMemberKey } from "../panel/member";
import type { PanelObjectRef } from "../panel/state";
import { fieldControlKey, fieldControlsOf } from "./form-controls";
import InlineReferencePicker from "./InlineReferencePicker.vue";
import ReferenceChoice from "./ReferenceChoice.vue";

/**
 * Chooses a reference from the bound type's records or option catalogue.
 *
 * - **Form field mode** (when the member declares `formField: { slot, path, itemPath? }`): registers the picker into
 *   the target `ObjectForm` at that field's pointer (or inside each array row for `itemPath`) and renders nothing at
 *   the `<Projection>` site. Edits write the owner's own value into the form so they are saved, discarded and drafted
 *   with it.
 * - **Standalone inline mode** (when `formField` is omitted): renders a compact, filterable single-select dropdown
 *   directly in place (for toolbar controls such as path start/target selectors), reading `data.rows` (`panelRecordList`
 *   / `panelRecordQuery`, filtered locally with zero extra requests) or `data.options` (`panelOptionList`, with optional
 *   `data.selected`) and syncing the chosen `{ className, primaryKey }` (or `null` when cleared) through the `selected`
 *   member parameter.
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

const panel = usePanelContext();
const slot = useProjectionSlot();
const member = inject(panelMemberKey, null);
const port = panel.manifest.members[slot.slot]?.formField;
const choosesField = computed(() => port !== undefined);

if (port) {
  // Form field mode: the choice is drawn inside the form, under this projection's slot and member.
  const Choice = defineComponent({
    props: { path: { type: String, required: true } },
    setup(field) {
      provide(projectionKey, slot);
      if (member) provide(panelMemberKey, member);
      return () => h(ReferenceChoice, { formSlot: port.slot, path: field.path });
    },
  });
  const controls = fieldControlsOf(panel.instance);
  const key = fieldControlKey(port.slot, port.path, port.itemPath);
  controls.set(key, Choice);
  onBeforeUnmount(() => controls.delete(key));
}
</script>

<template>
  <!-- In form field mode the control is rendered by ObjectForm; in standalone mode it renders inline here. -->
  <InlineReferencePicker
    v-if="!choosesField"
    :placeholder="props.placeholder"
    :placeholder-key="props.placeholderKey"
    :placeholders="props.placeholders"
    :clearable="props.clearable"
    :disabled="props.disabled"
    :size="props.size"
    @update:selected="emit('update:selected', $event)"
  />
</template>
