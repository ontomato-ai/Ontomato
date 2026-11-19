/*
 * The four-layer platform capability map panel's declaration (M3, overall design section 5): the state one instance
 * keeps, the projections it composes, and its state operations. `material.mjs` writes both the workspace candidate
 * (`panel.json`) and the registered panel input from this single source.
 *
 * Layer filter, expanded instance nodes, dragged positions and canvas viewport are internal view state of
 * `OntologyGraph` and deliberately stay out of panel state.
 */
const allLayers = ["fact", "capability", "governance", "product"];

export default {
  state: {
    mode: { kind: "scalar", type: "string", deepLink: true },
    start: { kind: "object-union", layers: allLayers, deepLink: true },
    selected: { kind: "object-union", layers: allLayers, deepLink: true },
    selectedType: { kind: "scalar", type: "string", deepLink: true },
    query: { kind: "scalar", type: "string", deepLink: false },
  },
  slots: {
    graph: {
      projectionId: "capability-map-graph",
      inputs: {
        mode: { state: "mode" },
        start: { state: "start" },
        selected: { state: "selected" },
        selectedType: { state: "selectedType" },
        query: { state: "query" },
      },
      outputs: {
        selectedNode: { state: "selected" },
        selectedType: { state: "selectedType" },
      },
    },
    relations: {
      projectionId: "capability-map-relations",
      inputs: {
        selected: { state: "selected" },
      },
      outputs: {
        selected: { state: "selected" },
      },
    },
    typeObjects: {
      projectionId: "capability-map-type-objects",
      inputs: {
        type: { state: "selectedType" },
      },
      outputs: {
        selected: { state: "start" },
      },
    },
    userPicker: {
      projectionId: "capability-map-user-picker",
      inputs: {},
      outputs: {
        selected: { state: "start" },
      },
    },
  },
  operations: [
    { id: "showTypeMode", labelKey: "capMap.modeType", kind: "state", sets: { mode: "type" } },
    { id: "showInstanceMode", labelKey: "capMap.modeInstance", kind: "state", sets: { mode: "instance" } },
    {
      id: "resetToCurrentUser",
      labelKey: "capMap.resetStart",
      kind: "state",
      sets: { mode: "instance", start: null, selected: null },
    },
  ],
};
