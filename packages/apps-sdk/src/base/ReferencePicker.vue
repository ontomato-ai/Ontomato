<script lang="ts">
/* eslint-disable vue/one-component-per-file -- the choice the form draws is a component made here, under this projection's context */
import { defineComponent, h, inject, onBeforeUnmount, provide } from "vue";
import { projectionKey, usePanelContext, useProjectionSlot } from "../panel/context";
import { panelMemberKey } from "../panel/member";
import { fieldControlKey, fieldControlsOf } from "./form-controls";
import ReferenceChoice from "./ReferenceChoice.vue";

/**
 * A reference field of a form in this panel, chosen from the catalogue of the type the projection binds, written into
 * the form its slot's field port (`formField`) names. Placed once, it is read, registered and admitted once, and the
 * form draws its choice where the field is: in the field's place among the form's fields, or — for a port with an
 * `itemPath` — inside each row of the array at `path` at the row's current index, so moving a row moves its choice.
 * Where the panel places it, it draws nothing.
 */
export default defineComponent({
  name: "ReferencePicker",
  setup() {
    const panel = usePanelContext();
    const slot = useProjectionSlot();
    const member = inject(panelMemberKey, null);
    const port = panel.manifest.members[slot.slot]?.formField;
    if (!port) throw new Error(`Slot '${slot.slot}' edits no form field: its declaration names no formField`);

    // The choice is drawn inside the form, under this projection's slot and member: they name its catalogue.
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
    return () => null;
  },
});
</script>
