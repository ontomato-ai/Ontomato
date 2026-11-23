import { cloneVNode, defineComponent, h, inject, ref, type InjectionKey, type PropType } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { useAppTheme } from "@ontomato/platform-shell";
import { useDarkMode } from "@ontomato/foundation-ui/theme";
import type { DirectPanelMount } from "./direct-mount";

/** The run a panel's component mounted in the platform's document draws its members from. */
export const directMountKey: InjectionKey<DirectPanelMount> = Symbol("ontomato.panel.directMount");

/**
 * `<Projection slot="…"/>` in a panel run in the platform's document: the run's member, drawn by the directly rendered
 * panel's own member component inside the member's container, as a directly rendered layout places each member.
 * Optional `:inputs="{ ... }"` passes slot-scoped input values (such as a row's `{ target: ref }` inside `ObjectList`'s
 * `#row-detail` or `#cell-*` slot) into an isolated instance of that member.
 */
export default defineComponent({
  // eslint-disable-next-line vue/multi-word-component-names
  name: "Projection",
  inheritAttrs: false,
  props: {
    slot: { type: String, required: true },
    inputs: { type: Object as PropType<Readonly<Record<string, RuntimeJsonValue>>>, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const mount = inject(directMountKey);
    if (!mount) throw new Error("<Projection> runs inside a panel, which provides its context");
    // A theme given where the panel places a projection is the last word inside the placement, in the reader's mode. A
    // placed panel takes its placement's theme from the host, over that panel's own (see the nested run's `theme`).
    const place = ref<HTMLElement | null>(null);
    const declaration = mount.instance.direct.members[props.slot];
    if (declaration && "projectionId" in declaration.target) {
      const dark = useDarkMode();
      useAppTheme(place, () => declaration.theme, () => (dark.value ? "dark" : "light"));
    }
    const isCurrentEntry = Boolean(declaration && "fromPlatform" in declaration.target);
    return () => {
      const containerProps: Record<string, unknown> = {
        ref: place,
        class: ["sdk-panel-member", isCurrentEntry ? "sdk-current-entry-slot" : null, attrs.class],
        "data-member": props.slot,
      };
      if (attrs.style !== undefined) containerProps.style = attrs.style;
      return h("div", containerProps, [
        cloneVNode(mount.member(props.slot, slots, props.inputs), Object.fromEntries(Object.entries(attrs).filter(([name]) => /^on[A-Z]/.test(name)))),
      ]);
    };
  },
});
