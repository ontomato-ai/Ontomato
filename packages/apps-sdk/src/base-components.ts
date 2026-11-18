export const baseComponents = {
  ObjectList: () => import("./base/ObjectList.vue").then(module => module.default),
  ObjectSummary: () => import("./base/ObjectSummary.vue").then(module => module.default),
  ObjectForm: () => import("./base/ObjectForm.vue").then(module => module.default),
  OperationButton: () => import("./base/OperationButton.vue").then(module => module.default),
};
