# Select a child record and read from its parent

Use the [child-object field and value shapes](../RUNTIME.md#child-objects) for child selection, alongside a parent object
state for the parent's reads. Set the read member's `target` to the parent state and pass any required child/source
parameters through `data.<name>.params` (see [FIELDS.md](../FIELDS.md)). To bind `ObjectList.state.selected` to a
`child-object` state, the parent type must declare the collection in `childCollections`, and the owner's read
must describe the child rows. Point a column at the owner's `kind: "child-reference"` field or array of such
references. `@navigate-child` emits the resolved `{ parent, collection, primaryKey }` reference and the column key. Update
the matching child selection or code segment and its tab together with `instance.state.setState`.
