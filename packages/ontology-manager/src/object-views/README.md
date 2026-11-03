# Object View components

`ObjectViewBuilder` edits type-level documents. `ObjectViewPage` loads a published
document and an instance through the Manager client. `ObjectViewRuntime` renders a
document and owns its variables; `ObjectViewWidget` resolves data and interactions.

These components live under the Manager's provided API/authentication context.
The exported runtime therefore also requires that context when embedded by a host.
See [the feature guide](../../../../docs/object-views.md) for authoring and API details.

`OntomatoObjectView` is the public loading boundary: it accepts a host context and an
`ObjectViewEmbed` declaration, provides an isolated client and feedback scope, loads a
published revision and the object, and forwards navigation and Action completion events.
`ObjectViewEmbedContent` owns requests and drops responses after declaration changes or
unmounting. The standalone shell exposes the same component in object-view embed mode.
