# Object View runtime components

`ObjectViewRuntime` renders legacy object-projection/product-asset documents, owns
its variables and reads each bound MetricView through the `MetricViewData` that SDK
apps use; `ObjectViewWidget` shows that read and resolves its other data and
interactions.

Object detail presentation and configuration are now served by the builtin
`object-detail` and `object-detail-body` panels under `resources/builtin-panels/`.

These runtime components live under the Manager's provided API/authentication
context. The exported runtime therefore also requires that context when embedded by
a host.
