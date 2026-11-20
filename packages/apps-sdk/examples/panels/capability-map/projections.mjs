/*
 * The projections the four-layer capability map panel composes, under their final IDs (M3, overall design section 5).
 * Every read goes through the named read-only platform ontology declarations in contracts for
 * `PlatformObjectType:platform:OntologyType`; nothing hardcodes ontology types or guesses edges.
 */
const allLayers = ["fact", "capability", "governance", "product"];
const ONTOLOGY_TYPE = { kind: "PlatformObjectType", id: "platform:OntologyType" };
const USER = "platform:User";
const anyLayerObject = { kind: "object-union", layers: allLayers };
const text = { kind: "scalar", type: "string" };
const json = { kind: "json" };

const read = (readName, params = {}) => ({ source: { type: ONTOLOGY_TYPE }, read: readName, params });

const projection = (id, name, description, component, ports) => ({
  id,
  input: {
    name,
    description,
    visibility: "domain",
    componentId: `@ontomato/sdk:${component}`,
    inputs: {},
    outputs: {},
    config: {},
    ...ports,
  },
});

export default [
  projection(
    "capability-map-graph",
    "Four-layer capability graph",
    "Interactive platform ontology graph across fact, capability, governance and product layers in type or instance mode.",
    "OntologyGraph",
    {
      inputs: {
        mode: text,
        start: anyLayerObject,
        selected: anyLayerObject,
        selectedType: text,
        query: text,
        node: anyLayerObject,
        layers: json,
        relationKinds: json,
      },
      outputs: {
        selectedNode: anyLayerObject,
        selectedType: text,
      },
      data: {
        schema: read("schema"),
        counts: read("counts"),
        start: read("start"),
        neighbors: read("neighbors", {
          node: { input: "node" },
          layers: { input: "layers" },
          relationKinds: { input: "relationKinds" },
        }),
      },
      config: {
        showLayerFilter: true,
        showLegend: true,
        showToolbar: true,
      },
    },
  ),
  projection(
    "capability-map-relations",
    "Node relations",
    "One-hop relations of the selected platform ontology node, grouped by relation kind with distinct access states.",
    "ObjectRelations",
    {
      inputs: {
        selected: anyLayerObject,
      },
      outputs: {
        selected: anyLayerObject,
      },
      data: {
        neighbors: read("neighbors", {
          node: { input: "selected" },
        }),
      },
      config: {
        emptyText: "capMap.relationsEmpty",
      },
    },
  ),
  projection(
    "capability-map-type-objects",
    "Objects by ontology type",
    "Readable objects of the type selected in type mode, to pick any starting node for instance exploration.",
    "ObjectList",
    {
      inputs: {
        type: text,
        keyword: text,
        page: json,
      },
      outputs: {
        selected: anyLayerObject,
      },
      data: {
        objects: read("objects", {
          type: { input: "type" },
          keyword: { input: "keyword" },
          page: { input: "page" },
        }),
      },
      config: {
        searchable: true,
        showCount: true,
        pageSize: 20,
        toggleable: false,
        emptyTypeText: "capMap.typePickerEmpty",
      },
    },
  ),
  projection(
    "capability-map-user-picker",
    "Starting user",
    "Readable platform users to switch the starting node in instance mode.",
    "ObjectList",
    {
      inputs: {
        keyword: text,
        page: json,
      },
      outputs: {
        selected: { kind: "object", objectType: USER },
      },
      data: {
        objects: read("objects", {
          type: { literal: USER },
          keyword: { input: "keyword" },
          page: { input: "page" },
        }),
      },
      config: {
        searchable: true,
        showCount: true,
        pageSize: 20,
        toggleable: false,
      },
    },
  ),
];
