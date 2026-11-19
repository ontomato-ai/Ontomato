/*
 * The functions panel's declaration: the state one instance keeps and the projections it composes. The candidate's
 * `panel.json` and the registered panel record carry exactly this; `material.mjs` writes both from it.
 *
 * `selectedFunction` is the function shown; `mode` says whether the instance is browsing the list (`list`), creating
 * one (`create`) or editing the selected one (`edit`). Both may travel in the address. The form's values, its unsaved
 * state and its errors never do: the form slot holds them. The delete slot's input is `function`, the name the owner's
 * delete operation reads its target from.
 */
export default {
  state: {
    selectedFunction: { kind: "object", objectType: "platform:Function", deepLink: true },
    mode: { kind: "scalar", type: "string", deepLink: true },
  },
  slots: {
    functions: { projectionId: "function-list", inputs: {}, outputs: { selected: { state: "selectedFunction" } } },
    definition: { projectionId: "function-definition-form", inputs: { function: { state: "selectedFunction" } } },
    delete: { projectionId: "function-delete", inputs: { function: { state: "selectedFunction" } } },
  },
  // Creating a function and returning to the list are changes of this instance's own state; the form's owner then
  // supplies a new function's defaults.
  operations: [
    { id: "newFunction", label: "New function", kind: "state", sets: { selectedFunction: null, mode: "create" } },
    { id: "backToList", label: "Back to functions", kind: "state", sets: { selectedFunction: null, mode: "list" } },
  ],
};
