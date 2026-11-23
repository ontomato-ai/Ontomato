<script lang="ts">
import { Comment, Fragment, Text, computed, defineComponent, provide, type PropType, type Slot, type VNode } from "vue";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { formFieldSlotKey } from "../panel/slot-context";

function hasRenderableVNodes(vnodes: readonly VNode[]): boolean {
  return vnodes.some((node) => {
    if (node.type === Comment) return false;
    if (node.type === Text) return String(node.children ?? "").trim() !== "";
    if (node.type === Fragment) {
      return Array.isArray(node.children) && hasRenderableVNodes(node.children as VNode[]);
    }
    return true;
  });
}

/**
 * Provides `formFieldSlotKey` around a custom `#field-<path>` / `#field` Vue slot rendered inside `ObjectForm` so
 * projection components (`ReferencePicker`, `ObjectGraph`) and custom author field components rendered in that slot
 * automatically connect to the enclosing form field at `path`. When the slot returns no renderable content (for
 * example a conditional `#field` slot that only handles specific paths), falls back to the default control.
 */
export default defineComponent({
  name: "FormFieldSlotHost",
  inheritAttrs: false,
  props: {
    formSlot: { type: String, required: true },
    path: { type: String, required: true },
    field: { type: Object as PropType<PanelFormField>, required: true },
    index: { type: Number, default: undefined },
    renderSlot: { type: Function as PropType<Slot>, required: true },
    slotProps: { type: Object as PropType<Record<string, unknown>>, required: true },
    fallbackToDefault: { type: Boolean, default: true },
  },
  setup(props, { slots }) {
    provide(formFieldSlotKey, {
      formSlot: props.formSlot,
      path: computed(() => props.path),
      field: computed(() => props.field),
      index: computed(() => props.index),
    });
    return () => {
      const rendered = props.renderSlot(props.slotProps);
      if (props.fallbackToDefault && !hasRenderableVNodes(rendered)) {
        return slots.default?.() ?? null;
      }
      return rendered;
    };
  },
});
</script>
