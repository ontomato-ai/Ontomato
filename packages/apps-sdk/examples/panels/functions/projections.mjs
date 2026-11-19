/*
 * The projections the functions panel composes, under their final IDs. Each binds one base component to the functions'
 * platform type or to one of their owner's operations; what a function holds, how it is read, saved and deleted, and
 * which of its fields may change is its owner's.
 */
const FUNCTION = "platform:Function";
const type = (id) => ({ kind: "PlatformObjectType", id });
const operation = (id) => ({ kind: "PlatformOperation", id });
const fn = { kind: "object", objectType: FUNCTION };

const projection = (id, name, description, componentId, binding, inputs = {}, display = {}) => ({
  id,
  input: { name, description, visibility: "domain", componentId, binding, inputs, display },
});

export default [
  projection("function-list", "Functions", "The domain's functions, found by name or description, to open one.",
    "ObjectList", type(FUNCTION), {}, {
      // The keys are the fields the functions' resource client reads from the owner, labels included.
      columns: [
        { key: "label", label: "Name", subtitleKey: "subtitle" },
        { key: "operation", label: "Operation type" },
      ],
      searchable: true,
      showCount: true,
    }),
  projection("function-definition-form", "Function definition",
    "One function's definition, as the function owner describes and saves it; a new function when none is chosen.",
    "ObjectForm", type(FUNCTION), { function: fn }, { creates: true }),
  projection("function-delete", "Delete function", "Deletes the chosen function; the function owner refuses one that is still in use.",
    "OperationButton", operation("functions.delete"), { function: fn }, { type: "danger" }),
];
