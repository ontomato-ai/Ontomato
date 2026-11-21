<!-- Generated from the panel authoring contract by pnpm --filter @ontomato/contracts generate:panel-authoring-reference. -->
# Panel member fields

Use these fields for a new member inside `manifest.members` in `panel.json`.

| Field | Required on every member | Value |
| --- | --- | --- |
| `id` | No | Stable projection ID written by registration or by the offline check for a packaged panel. Keep it when renaming or moving the member. |
| `component` | Yes | Component name from the released SDK catalogue. Use its package-qualified ID if the name is ambiguous. |
| `type` | No | Default owner type ID from the type table for this member's reads and operation. |
| `target` | No | Panel state field holding the object for an object read or the object or object list targeted by an operation. |
| `data` | No | Map the component's datum names to owner reads. Use a read name or {read, type?, params?}. Each params value is {state: fieldName} or {literal: value}. |
| `operation` | No | Operation ID from the owner's entry in the type table. |
| `state` | No | Map typed component port names or owner read parameter names to panel state fields. |
| `config` | No | Component configuration from the released SDK catalogue. |
| `agent` | No | Required for ConversationEntry. Use "page-default", {kind:"id", id}, or {kind:"preset", agentKind}. |
| `prefill` | No | ConversationEntry text placed in the page composer without sending it. |
| `sourceCard` | No | Required for MetricChart. Use {dashboardId, cardId}; the source owner registers the chart and assigns its projection ID. |
| `name` | No | Projection display name. Defaults to the member name. |
| `description` | No | Projection description. Defaults to the member name. |
