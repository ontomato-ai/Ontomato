import { cloneVNode, defineComponent, h, inject, ref, type InjectionKey } from "vue";
import { useAppTheme } from "@ontomato/platform-shell";
import { useDarkMode } from "@ontomato/foundation-ui/theme";
import type { DirectPanelMount } from "./direct-mount";

/** The run a panel's component mounted in the platform's document draws its members from. */
export const directMountKey: InjectionKey<DirectPanelMount> = Symbol("ontomato.panel.directMount");

/**
 * `<Projection slot="…"/>` in a panel run in the platform's document: the run's member, drawn by the directly rendered
 * panel's own member component inside the member's container, as a directly rendered layout places each member. The
 * container is where the panel's own style stops: it can place the member, not restyle the component inside. As in a
 * frame, only what the panel's template listens to reaches the drawn component — and what it places in the component's
 * slots (`<template #batch-actions>`), other members' `<Projection>`s included, which the component draws where its slot is.
 */
export default defineComponent({
  // eslint-disable-next-line vue/multi-word-component-names
  name: "Projection",
  inheritAttrs: false,
  props: { slot: { type: String, required: true } },
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
    return () => h("div", { ref: place, "data-member": props.slot }, [
      cloneVNode(mount.member(props.slot, slots), Object.fromEntries(Object.entries(attrs).filter(([name]) => /^on[A-Z]/.test(name)))),
    ]);
  },
});
