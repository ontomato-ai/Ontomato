# Connect a graph and its relations

Inspect the graph and relation data ports in the component reference and the named reads in `panel type`.
Declare a shared [graph selection type](../RUNTIME.md#graph-selection) in `manifest.state`. `InstanceGraph` uses
`selected` as its selection port. To connect its selection and relation filters, write:

```json
{
  "graph": { "component": "InstanceGraph", "state": { "selected": "selected", "visibleRelationKinds": "relationKinds" } },
  "relations": {
    "component": "ObjectRelations",
    "type": "platform:OntologyType",
    "data": { "neighbors": { "read": "neighbors", "params": { "node": { "state": "selected" } } } },
    "state": { "selected": "selected", "start": "start", "visibleRelationKinds": "relationKinds" },
    "config": { "showRelationFilter": true, "allowSetStart": true, "showSummary": true, "collapseEmptyGroups": true }
  }
}
```

This fragment shows the state ports. Bind the graph's data for your mode and use the owner's available
`neighbors` read for the relation member. The relation member reads `selected` and `visibleRelationKinds`,
and writes those ports and `start`. Its read-only outputs include `status`, `edgeCount` and `label`.
Clearing `ObjectList` checks writes `[]`. If those checks filter the graph, map `[]` to `null` when clearing the filter
should show all nodes. An explicit empty array makes the graph show an empty set.

For custom `nodes` + `edges` graphs (`RecordGraph`), double-clicking a node or edge selects it and emits `choose` with
its `{ className, primaryKey }` reference — matching `ObjectList`'s `@choose` activation event. See
`sdk read docs/components/RecordGraph.md`.
