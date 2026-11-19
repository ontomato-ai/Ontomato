/*
 * The metric views panel's declaration: the state one instance keeps and the projections it composes. The candidate's
 * `panel.json` and the registered panel record carry exactly this; `material.mjs` writes both from it.
 *
 * `selectedMetric` is the metric view shown; `mode` says whether the instance is browsing the list (`list`), creating
 * one (`create`) or editing the selected one (`edit`). Both may travel in the address. The form's values, its unsaved
 * state and its errors never do: the form slot holds them. The delete slot's input is `metric`, the name the owner's
 * delete operation reads its target from.
 */
export default {
  state: {
    selectedMetric: { kind: "object", objectType: "platform:MetricView", deepLink: true },
    mode: { kind: "scalar", type: "string", deepLink: true },
  },
  slots: {
    metrics: { projectionId: "metric-list", inputs: {}, outputs: { selected: { state: "selectedMetric" } } },
    definition: { projectionId: "metric-definition-form", inputs: { metric: { state: "selectedMetric" } } },
    delete: { projectionId: "metric-delete", inputs: { metric: { state: "selectedMetric" } } },
  },
  // Creating a metric view and returning to the list are changes of this instance's own state; the form's owner then
  // supplies a new metric view's defaults.
  operations: [
    { id: "newMetric", label: "New metric view", kind: "state", sets: { selectedMetric: null, mode: "create" } },
    { id: "backToList", label: "Back to metric views", kind: "state", sets: { selectedMetric: null, mode: "list" } },
  ],
};
