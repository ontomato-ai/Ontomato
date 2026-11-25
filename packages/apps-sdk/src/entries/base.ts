// The generic base components a panel composes its projections from. None of them carries business: the type a
// projection binds decides what a list lists, what a summary shows and which owner answers a form, and the panel state a
// slot's input names decides where a selection goes. The graph canvas and the layouts bind nothing at all: what a graph
// holds and what a choice on it means are the caller's.
export { default as ObjectList } from "../base/ObjectList.vue";
export type {
  ObjectListColumn,
  ObjectListRef,
} from "../base/object-list-types";
export { default as GroupedGrid } from "../base/GroupedGrid.vue";
export type {
  GroupedGridControlsVisibility,
  GroupedGridDividerStyle,
  GroupedGridGroup,
  GroupedGridGroupSlotScope,
  GroupedGridGroupSummary,
  GroupedGridGroupSurface,
  GroupedGridItem,
  GroupedGridItemDraftOverride,
  GroupedGridItemSlotScope,
  GroupedGridItemSurface,
  GroupedGridLayoutChange,
  GroupedGridLayoutGroup,
  GroupedGridLayoutItem,
  GroupedGridLayoutState,
  GroupedGridResizeAxis,
  GroupedGridRowSizing,
  GroupedGridSection,
  GroupedGridStaticGroupConfig,
  GroupedGridStaticItemConfig,
} from "../base/grouped-grid-types";
export { default as ObjectCount } from "../base/ObjectCount.vue";
export type { ObjectCountItem } from "../base/object-count-types";
export { default as ObjectRelations } from "../base/ObjectRelations.vue";
export { default as ObjectSummary } from "../base/ObjectSummary.vue";
export { default as ObjectHeader } from "../base/ObjectHeader.vue";
export { default as PageHeader } from "../base/PageHeader.vue";
export type { PageHeaderDraft, PageHeaderLabels } from "../base/page-header-types";
export { default as AppMenu } from "../base/AppMenu.vue";
export type { AppMenuGroup, AppMenuIcon, AppMenuItem } from "../base/app-menu-types";
export { default as TypedValue } from "../base/TypedValue.vue";
export { default as RecordTemplate } from "../base/RecordTemplate.vue";
export { default as InfoBanner } from "../base/InfoBanner.vue";
export { default as ObjectRefCard } from "../base/ObjectRefCard.vue";
export { default as MetricCard } from "../base/MetricCard.vue";
export type {
  TypedFieldFormat,
  TypedNumberFormat,
  TypedValueKind,
  TypedValueMap,
  TypedValueMapEntry,
} from "../base/display-value";
export type { MetricCardItem } from "../base/metric-card-types";
export { default as ObjectForm } from "../base/ObjectForm.vue";
export { default as ObjectFormFields } from "../base/ObjectFormFields.vue";
export type {
  ObjectFormGroup,
  ObjectFormPresentation,
  ObjectFormResolvedGroup,
  ObjectFormSlotScope,
} from "../base/object-form-types";
export { default as OperationButton } from "../base/OperationButton.vue";
export { default as OperationResult } from "../base/OperationResult.vue";
export { default as FileUploadControl } from "../base/FileUploadControl.vue";
export { default as SegmentedControl } from "../base/SegmentedControl.vue";
export type { SegmentedControlOption } from "../base/segmented-control-types";
export { default as TwoPaneLayout } from "../base/TwoPaneLayout.vue";
export { default as WorkbenchLayout } from "../base/WorkbenchLayout.vue";
export { default as SectionGroup } from "../base/SectionGroup.vue";
export { default as ReferencePicker } from "../base/ReferencePicker.vue";
export { default as ObjectGraph } from "../base/ObjectGraph.vue";
export { default as ObjectTree } from "../base/ObjectTree.vue";
export { default as ObjectTextReader } from "../base/ObjectTextReader.vue";
export { default as AnnotatedCode } from "../base/AnnotatedCode.vue";
export { default as ConversationEntry } from "../base/ConversationEntry.vue";
export { default as PanelData } from "../base/PanelData.vue";
export { default as CurrentEntry } from "../base/CurrentEntry.vue";
export { default as MetricChart } from "../base/MetricChart.vue";
export { default as DashboardMetricPreview } from "../base/DashboardMetricPreview.vue";
export type { DashboardMetricPreviewCard } from "../base/dashboard-metric-preview-types";
export { default as ScheduledTaskSummaryList } from "../base/ScheduledTaskSummaryList.vue";
export { default as ScheduledTaskRunDetail } from "../base/ScheduledTaskRunDetail.vue";
export type {
  ScheduledTaskRunView,
  ScheduledTaskSummaryItem,
} from "../base/scheduled-task-summary-types";
export {
  PathTree,
  buildPathTree,
  firstTreeFile,
  type PathTreeFile,
  type PathTreeItem,
  type PathTreeNode,
} from "@ontomato/foundation-ui/tree";
export {
  SegmentedTextReader,
  type SegmentedTextPage,
  type SegmentedTextSource,
  type TextSegmentItem,
} from "@ontomato/foundation-ui/reader";
export {
  GraphCanvas,
  type GraphCanvasEdge,
  type GraphCanvasLayout,
  type GraphCanvasNode,
  type GraphCanvasSelection,
  type GraphCanvasTone,
  type GraphCanvasViewport,
} from "@ontomato/foundation-ui/graph";
