<script lang="ts">
import { Comment, Fragment, Text, computed, defineComponent, provide, type PropType, type Slot, type VNode } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelMemberItemKey } from "@ontomato/contracts/panel-manifest";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { listRowSlotKey, type ListRowSlotOperation } from "../panel/slot-context";
import type { PanelObjectRef } from "../panel/state";

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
 * Provides `listRowSlotKey` around row-scoped Vue slots (`#cell-<key>`, `#cell`, `#actions`, `#row-detail`, `#card`)
 * rendered inside `ObjectList` so author slot components and nested `<Projection>`s can access the current row,
 * its object reference, and declared row operations without hand-assembling targets.
 */
export default defineComponent({
  name: "ListRowSlotHost",
  inheritAttrs: false,
  props: {
    listSlot: { type: String, required: true },
    row: { type: Object as PropType<PlatformObjectRecord>, required: true },
    rowRef: { type: Object as PropType<PanelObjectRef>, required: true },
    itemKey: { type: [String, Object] as PropType<PanelMemberItemKey>, default: undefined },
    index: { type: Number, required: true },
    operations: {
      type: Object as PropType<Readonly<Record<string, ListRowSlotOperation>>>,
      required: true,
    },
    runOperation: {
      type: Function as PropType<
        (operationName: string, extraInput?: Readonly<Record<string, RuntimeJsonValue>>) => Promise<void>
      >,
      required: true,
    },
    renderSlot: { type: Function as PropType<Slot>, required: true },
    slotProps: { type: Object as PropType<Record<string, unknown>>, required: true },
    fallbackToDefault: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    provide(listRowSlotKey, {
      listSlot: props.listSlot,
      row: computed(() => props.row),
      ref: computed(() => props.rowRef),
      itemKey: computed(() => props.itemKey ?? props.rowRef),
      index: computed(() => props.index),
      operations: computed(() => props.operations),
      runOperation: (operationName, extraInput) => props.runOperation(operationName, extraInput),
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
