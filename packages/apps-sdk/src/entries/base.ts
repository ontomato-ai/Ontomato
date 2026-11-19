// The generic base components a panel composes its projections from. None of them carries business: the type a
// projection binds decides what a list lists, what a summary shows and which owner answers a form, and the panel state a
// slot's input names decides where a selection goes. The graph canvas and the layouts bind nothing at all: what a graph
// holds and what a choice on it means are the caller's.
export { default as ObjectList } from "../base/ObjectList.vue";
export type {
  ObjectListColumn,
  ObjectListFilter,
  ObjectListFilterOption,
  ObjectListRef,
} from "../base/object-list-types";
export { default as ObjectRelations } from "../base/ObjectRelations.vue";
export { default as ObjectSummary } from "../base/ObjectSummary.vue";
export { default as ObjectForm } from "../base/ObjectForm.vue";
export { default as OperationButton } from "../base/OperationButton.vue";
export { default as SegmentedControl } from "../base/SegmentedControl.vue";
export type { SegmentedControlOption } from "../base/segmented-control-types";
export { default as TwoPaneLayout } from "../base/TwoPaneLayout.vue";
export { default as SectionGroup } from "../base/SectionGroup.vue";
export { default as ReferencePicker } from "../base/ReferencePicker.vue";
export { default as ObjectGraph } from "../base/ObjectGraph.vue";
export { default as MetricChart } from "../base/MetricChart.vue";
export {
  GraphCanvas,
  type GraphCanvasEdge,
  type GraphCanvasLayout,
  type GraphCanvasNode,
  type GraphCanvasSelection,
  type GraphCanvasTone,
  type GraphCanvasViewport,
} from "@ontomato/foundation-ui/graph";
