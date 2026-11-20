import { defineComponent, h, type PropType, type VNodeChild } from "vue";
import type { PanelLayoutCondition, PanelLayoutNode } from "@ontomato/contracts/panel-layout";

/*
 * A direct panel's layout, drawn by the platform (standard part two, layout): the panel's own HTML, cleaned and parsed,
 * drawn as it is written, and each member drawn by the panel's instance where the layout places it. Where things go,
 * how wide they are and what scrolls is the panel's own CSS; what a member shows and reads is its instance's.
 */

/** Whether a condition holds for the instance's current value; an object compares with null as chosen or not. */
function holds(condition: PanelLayoutCondition, values: Readonly<Record<string, unknown>>) {
  const value = values[condition.state] ?? null;
  const equal = condition.value === null ? value === null : value === condition.value;
  return condition.operator === "eq" ? equal : !equal;
}

export const PanelLayout = defineComponent({
  name: "PanelLayout",
  props: {
    nodes: { type: Array as PropType<readonly PanelLayoutNode[]>, required: true },
    values: { type: Object as PropType<Readonly<Record<string, unknown>>>, required: true },
    /** Draws the member the layout places under this key. */
    member: { type: Function as PropType<(ref: string) => VNodeChild>, required: true },
  },
  setup(props) {
    function draw(node: PanelLayoutNode): VNodeChild {
      if (node.kind === "text") return node.value;
      // The member's own element: the panel's CSS places it by its class or style; what it draws is its instance's.
      if (node.kind === "member")
        return h("panel-member", { ...node.attrs, key: node.ref, "data-member": node.ref }, [props.member(node.ref)]);
      if (node.when && !holds(node.when, props.values)) return null;
      return h(node.tag, { ...node.attrs, key: `${node.position.offset}` }, node.children.map(draw));
    }
    return () => props.nodes.map(draw);
  },
});
