# Object View components

`ObjectViewBuilder` edits type-level documents. `ObjectViewPage` loads a published
document and an instance through the Manager client. `ObjectViewRuntime` renders a
document and owns its variables; `ObjectViewWidget` resolves data and interactions.

These components live under the Manager's provided API/authentication context.
The exported runtime therefore also requires that context when embedded by a host.
See [the feature guide](../../../../docs/object-views.md) for authoring and API details.
