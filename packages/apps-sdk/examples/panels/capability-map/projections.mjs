/*
 * The projections the four-layer capability map panel composes, under their final IDs (M3, overall design section 5).
 * Every read goes through the read-only platform ontology composite endpoints declared in contracts for
 * `platform:OntologyType` and `platform:OntologyRelationKind`; nothing hardcodes ontology types or guesses edges.
 */
const allLayers = ["fact", "capability", "governance", "product"];
const type = (id) => ({ kind: "PlatformObjectType", id });
const anyLayerObject = { kind: "object-union", layers: allLayers };
const text = { kind: "scalar", type: "string" };

const projection = (id, name, description, componentId, binding, inputs = {}, display = {}, graph) => ({
  id,
  input: { name, description, visibility: "domain", componentId, binding, ...(graph ? { graph } : {}), inputs, display },
});

export default [
  projection(
    "capability-map-graph",
    "Four-layer capability graph",
    "Interactive platform ontology graph across fact, capability, governance and product layers in type or instance mode.",
    "OntologyGraph",
    type("platform:OntologyType"),
    {
      mode: text,
      start: anyLayerObject,
      selected: anyLayerObject,
      selectedType: text,
      query: text,
    },
    {
      showLayerFilter: true,
      showLegend: true,
      showToolbar: true,
    },
    {
      nodeIdentity: anyLayerObject,
      edges: {
        binding: type("platform:OntologyRelationKind"),
        sourcePath: "/from",
        targetPath: "/to",
      },
    },
  ),
  projection(
    "capability-map-relations",
    "Node relations",
    "One-hop relations of the selected platform ontology node, grouped by relation kind with distinct access states.",
    "ObjectRelations",
    type("platform:OntologyType"),
    {
      selected: anyLayerObject,
    },
    {
      emptyText: "capMap.relationsEmpty",
    },
  ),
  projection(
    "capability-map-type-objects",
    "Objects by ontology type",
    "Readable objects of the type selected in type mode, to pick any starting node for instance exploration.",
    "ObjectList",
    type("platform:OntologyType"),
    {
      type: text,
    },
    {
      searchable: true,
      showCount: true,
      pageSize: 20,
      toggleable: false,
      emptyTypeText: "capMap.typePickerEmpty",
    },
  ),
  projection(
    "capability-map-user-picker",
    "Starting user",
    "Readable platform users to switch the starting node in instance mode.",
    "ObjectList",
    type("platform:OntologyType"),
    {},
    {
      type: "platform:User",
      searchable: true,
      showCount: true,
      pageSize: 20,
      toggleable: false,
    },
  ),
];
