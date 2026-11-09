# Object View components

`ObjectViewBuilder` edits type-level documents. `ObjectViewPage` loads a published
document and an instance through the Manager client. `ObjectViewRuntime` renders a
document, owns its variables and reads each bound MetricView through the
`MetricViewData` that SDK apps use; `ObjectViewWidget` shows that read and resolves
its other data and interactions.

These components live under the Manager's provided API/authentication context.
The exported runtime therefore also requires that context when embedded by a host.
See [the feature guide](../../../../docs/object-views.md) for authoring and API details.
