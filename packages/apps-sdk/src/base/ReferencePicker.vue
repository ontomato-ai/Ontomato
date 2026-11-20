<script setup lang="ts">
import { defineComponent, h, inject, onBeforeUnmount, provide } from "vue";
import { projectionKey, usePanelContext, useProjectionSlot } from "../panel/context";
import { panelMemberKey } from "../panel/member";
import { rowControlKey, rowControlsOf } from "./form-controls";
import ReferenceChoice from "./ReferenceChoice.vue";

/**
 * A reference field of a form in this panel, chosen from the catalogue of the type the projection binds, written into
 * the form its slot's field port (`formField`) names. A port to one field draws the choice here. A port with an
 * `itemPath` edits that field in every row of the array at `path`: placed once, it is read, registered and admitted
 * once, and the form draws its choice inside each row at the row's current index, so moving a row moves its choice.
 */
const panel = usePanelContext();
const slot = useProjectionSlot();
const member = inject(panelMemberKey, null);
const port = panel.manifest.slots[slot.slot]?.formField;
if (!port) throw new Error(`Slot '${slot.slot}' edits no form field: its declaration names no formField`);
const { itemPath } = port;

if (itemPath) {
  // The row's choice is drawn inside the form, under this projection's slot and member: they name its catalogue.
  const RowChoice = defineComponent({
    props: { path: { type: String, required: true } },
    setup(row) {
      provide(projectionKey, slot);
      if (member) provide(panelMemberKey, member);
      return () => h(ReferenceChoice, { formSlot: port.slot, path: row.path });
    },
  });
  const controls = rowControlsOf(panel.instance);
  const key = rowControlKey(port.slot, port.path, itemPath);
  controls.set(key, RowChoice);
  onBeforeUnmount(() => controls.delete(key));
}
</script>

<template>
  <reference-choice v-if="!itemPath" :form-slot="port!.slot" :path="port!.path"></reference-choice>
</template>
