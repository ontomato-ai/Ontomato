import { cloneVNode, defineComponent, h, inject, provide, ref, type InjectionKey, type PropType } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { useAppTheme } from "@ontomato/platform-shell";
import { useDarkMode } from "@ontomato/foundation-ui/theme";
import type { DirectPanelMount } from "./direct-mount";
import { panelMemberHostHiddenKey } from "./member";
import { placementListeners } from "./projection-attrs";

/** The run a panel's component mounted in the platform's document draws its members from. */
export const directMountKey: InjectionKey<DirectPanelMount> = Symbol("ontomato.panel.directMount");

/**
 * `<Projection slot="…"/>` in a panel run in the platform's document: the run's member, drawn by the directly rendered
 * panel's own member component inside the member's container, as a directly rendered layout places each member.
 * `:inputs="{ ... }"` passes what a slot supplies to an instance of its own (a row's `{ target: ref }` inside
 * `ObjectList`'s `#row-detail` or `#cell-*` slot). `:values="{ ... }"` passes the values that follow the page — a title,
 * a disabled state. `class`/`style` size the container; `@event` listeners are the page's. No other attribute configures
 * the component: a fixed value is the member's `config`.
 */
export default defineComponent({
  // eslint-disable-next-line vue/multi-word-component-names
  name: "Projection",
  inheritAttrs: false,
  props: {
    slot: { type: String, required: true },
    inputs: { type: Object as PropType<Readonly<Record<string, RuntimeJsonValue>>>, default: undefined },
    values: { type: Object as PropType<Readonly<Record<string, RuntimeJsonValue>>>, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const mount = inject(directMountKey);
    if (!mount) throw new Error("<Projection> runs inside a panel, which provides its context");
    // A theme given where the panel places a projection is the last word inside the placement, in the reader's mode. A
    // placed panel takes its placement's theme from the host, over that panel's own (see the nested run's `theme`).
    const place = ref<HTMLElement | null>(null);
    const memberRef = ref<{ refresh?: () => void } | null>(null);
    const hostHidden = ref(false);
    provide(panelMemberHostHiddenKey, (hidden: boolean) => {
      hostHidden.value = hidden;
    });
    expose({
      refresh() {
        memberRef.value?.refresh?.();
      },
    });
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
        ...(hostHidden.value ? { hidden: true } : {}),
      };
      if (attrs.style !== undefined) containerProps.style = attrs.style;
      return h("div", containerProps, [
        cloneVNode(mount.member(props.slot, slots, props.inputs, props.values), {
          ...placementListeners(attrs),
          ref: memberRef,
        }),
      ]);
    };
  },
});
