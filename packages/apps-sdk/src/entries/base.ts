// The generic base components a panel composes its projections from. None of them carries business: the type a
// projection binds decides what a list lists, what a summary shows and which owner answers a form, and the panel state a
// slot's input names decides where a selection goes.
export { default as ObjectList } from "../base/ObjectList.vue";
export { default as ObjectSummary } from "../base/ObjectSummary.vue";
export { default as ObjectForm } from "../base/ObjectForm.vue";
export { default as OperationButton } from "../base/OperationButton.vue";
