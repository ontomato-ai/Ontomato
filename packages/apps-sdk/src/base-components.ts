export const baseComponents = {
  ObjectList: () => import("./base/ObjectList.vue").then(module => module.default),
  ObjectSummary: () => import("./base/ObjectSummary.vue").then(module => module.default),
  ObjectForm: () => import("./base/ObjectForm.vue").then(module => module.default),
  OperationButton: () => import("./base/OperationButton.vue").then(module => module.default),
  GraphCanvas: () => import("@ontomato/foundation-ui/graph").then(module => module.GraphCanvas),
  TwoPaneLayout: () => import("./base/TwoPaneLayout.vue").then(module => module.default),
  SectionGroup: () => import("./base/SectionGroup.vue").then(module => module.default),
  ReferencePicker: () => import("./base/ReferencePicker.vue").then(module => module.default),
  ObjectGraph: () => import("./base/ObjectGraph.vue").then(module => module.default),
  MetricChart: () => import("./base/MetricChart.vue").then(module => module.default),
};
