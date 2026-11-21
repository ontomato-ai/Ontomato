import { cloneVNode, defineComponent, h, inject, type InjectionKey } from "vue";
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
    return () => h("div", { "data-member": props.slot }, [
      cloneVNode(mount.member(props.slot, slots), Object.fromEntries(Object.entries(attrs).filter(([name]) => /^on[A-Z]/.test(name)))),
    ]);
  },
});
