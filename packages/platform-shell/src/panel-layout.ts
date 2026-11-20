import { defineComponent, h, type PropType, type VNodeChild } from "vue";
import type { PanelLayoutCondition, PanelLayoutNode } from "@ontomato/contracts/panel-layout";
import type { PanelMember } from "@ontomato/contracts/panel-manifest";

/*
 * A direct panel's layout, drawn by the platform (direct rendering design 1.1–1.2): the parsed node tree mapped to the
 * platform's own containers, and each member drawn by the panel's instance where the layout places it. The layout holds
 * containers and positions only; what a member shows and reads is its instance's.
 *
 * A container lays out by its own width, not the browser's: below 36rem every member takes a whole row, otherwise a
 * member takes the share of twelve columns its declaration's width names. A row and a grid wrap; a column stacks.
 */

/** How many of twelve columns a declared width takes; `auto` takes what the row leaves. */
const SPANS = { quarter: 3, third: 4, half: 6, twoThirds: 8, full: 12 } as const;

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
    members: { type: Object as PropType<Readonly<Record<string, PanelMember>>>, required: true },
    values: { type: Object as PropType<Readonly<Record<string, unknown>>>, required: true },
    /** Draws the member the layout places under this key. */
    member: { type: Function as PropType<(ref: string) => VNodeChild>, required: true },
  },
  setup(props) {
    function draw(node: PanelLayoutNode): VNodeChild {
      if (node.kind === "member") {
        const width = props.members[node.ref]!.params?.width;
        return h("div", {
          key: node.ref,
          class: "panel-layout-member",
          style: width && width !== "auto" ? { "--panel-layout-span": SPANS[width] } : undefined,
          "data-member": node.ref,
        }, [props.member(node.ref)]);
      }
      if (node.when && !holds(node.when, props.values)) return null;
      return h(node.tag, {
        key: `${node.position.offset}`,
        class: ["panel-layout", `panel-layout-${node.flow}`, `panel-layout-gap-${node.gap}`],
      }, node.children.map(draw));
    }
    return () => props.nodes.map(draw);
  },
});
