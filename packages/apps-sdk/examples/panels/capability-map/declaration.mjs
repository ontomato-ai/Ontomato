/*
 * The four-layer platform capability map panel's declaration (M3, overall design section 5): the state one instance
 * keeps, the projections it composes as members, and its explicit state events. `material.mjs` writes both the
 * workspace candidate (`panel.json`) and the registered panel input from this single source.
 *
 * Layer filter, expanded instance nodes, dragged positions and canvas viewport are internal view state of
 * `OntologyGraph` and deliberately stay out of panel state.
 */
const allLayers = ["fact", "capability", "governance", "product"];
const graphNodeObject = { kind: "object-union", layers: allLayers, objectTypes: ["platform:OntologyType"] };
const text = { kind: "scalar", type: "string" };

export default {
  state: {
    mode: { type: text, deepLink: true, default: "instance" },
    start: { type: graphNodeObject, deepLink: true },
    selected: { type: graphNodeObject, deepLink: true },
    selectedType: { type: text, deepLink: true },
    query: { type: text, deepLink: false },
  },
  members: {
    graph: {
      target: { projectionId: "capability-map-graph" },
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
      target: { projectionId: "capability-map-relations" },
      inputs: {
        selected: { state: "selected" },
      },
      outputs: {
        selected: { state: "selected" },
      },
    },
    typeObjects: {
      target: { projectionId: "capability-map-type-objects" },
      inputs: {
        type: { state: "selectedType" },
      },
      outputs: {
        selected: { state: "start" },
      },
    },
    userPicker: {
      target: { projectionId: "capability-map-user-picker" },
      inputs: {
        type: { literal: "platform:User" },
      },
      outputs: {
        selected: { state: "start" },
      },
    },
  },
  events: {
    showTypeMode: {
      labelKey: "capMap.modeType",
      do: { set: { fields: { mode: { literal: "type" } } } },
    },
    showInstanceMode: {
      labelKey: "capMap.modeInstance",
      do: { set: { fields: { mode: { literal: "instance" } } } },
    },
    resetToCurrentUser: {
      labelKey: "capMap.resetToCurrentUser",
      do: { set: { fields: { mode: { literal: "instance" }, start: { literal: null }, selected: { literal: null } } } },
    },
  },
};
