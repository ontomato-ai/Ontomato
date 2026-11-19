/*
 * The projections the metric views panel composes, under their final IDs. Each binds one base component to the metric
 * views' platform type or to one of their owner's operations; what a metric view holds, how it is read, saved and
 * deleted, and which of its fields may change is its owner's.
 */
const METRIC_VIEW = "platform:MetricView";
const type = (id) => ({ kind: "PlatformObjectType", id });
const operation = (id) => ({ kind: "PlatformOperation", id });
const metric = { kind: "object", objectType: METRIC_VIEW };

const projection = (id, name, description, componentId, binding, inputs = {}, display = {}) => ({
  id,
  input: { name, description, visibility: "domain", componentId, binding, inputs, display },
});

export default [
  projection("metric-list", "Metric views", "The domain's metric views, found by name or description, to open one.",
    "ObjectList", type(METRIC_VIEW), {}, {
      // The keys are the fields the metric views' resource client reads from the owner, labels and tones included.
      columns: [
        { key: "label", label: "Name", subtitleKey: "subtitle" },
        { key: "function", label: "Linked function" },
        { key: "origin", label: "Source" },
        { key: "status", label: "Status", kind: "tag" },
        { key: "createdBy", label: "Created by" },
        { key: "reviewedBy", label: "Last published by" },
        { key: "modified", label: "Last updated" },
      ],
      searchable: true,
      showCount: true,
    }),
  projection("metric-definition-form", "Metric view definition",
    "One metric view's definition and bindings, as the metric owner describes and saves it; a new metric view when none is chosen.",
    "ObjectForm", type(METRIC_VIEW), { metric }, { creates: true }),
  projection("metric-delete", "Delete metric view", "Deletes the chosen metric view with its bindings; the metric owner refuses a system one.",
    "OperationButton", operation("metricViews.delete"), { metric }, { type: "danger" }),
];
