import { defineComponent, inject, provide, type PropType } from "vue";
import { overlayFormScopeKey, type OverlayFormScope } from "../panel/context";
import type { PanelFormAdapters } from "../panel/forms";

export interface RowDetailFormRegistration {
  readonly slot: string;
  readonly forms: PanelFormAdapters | null;
}

/**
 * Renderless scope provider placed around each expanded row's `#row-detail` region in `ObjectList`.
 * Any form mounted inside the expanded detail registers via `overlayFormScopeKey` so collapsing
 * or switching away from that row can guard and discard only the forms owned by that row while
 * forwarding registration to any enclosing overlay scope (such as a dialog or drawer).
 */
export default defineComponent({
  name: "RowDetailFormScope",
  inheritAttrs: false,
  props: {
    rowKey: { type: String, required: true },
    onRegister: {
      type: Function as PropType<(rowKey: string, entry: RowDetailFormRegistration) => () => void>,
      required: true,
    },
  },
  setup(props, { slots }) {
    const parentScope = inject(overlayFormScopeKey, null);
    const scope: OverlayFormScope = {
      register(slot: string, forms?: PanelFormAdapters): () => void {
        const entry: RowDetailFormRegistration = { slot, forms: forms ?? null };
        const unregisterLocal = props.onRegister(props.rowKey, entry);
        const unregisterParent = parentScope?.register(slot, forms);
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          unregisterLocal();
          unregisterParent?.();
        };
      },
    };
    provide(overlayFormScopeKey, scope);
    return () => slots.default?.() ?? null;
  },
});
