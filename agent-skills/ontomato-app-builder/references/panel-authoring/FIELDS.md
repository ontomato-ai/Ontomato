<!-- Generated from the panel authoring contract by pnpm --filter @ontomato/contracts generate:panel-authoring-reference. -->
# Panel descriptor and member fields

## Panel descriptor (`panel.json`)

Top-level fields accepted in `panel.json`. Workspace files supply `panel.html`, `panel.mjs`, and optional `recipes.md`.

| Field | Required | Value |
| --- | --- | --- |
| `manifest` | Yes | Panel declaration object (`{ state, members }`). Both keys inside `manifest` are required. |
| `manifest.state` | Yes | Declared typed public state fields. Write `{}` when the panel has no public state (for example, a read-only stateless page). |
| `manifest.members` | Yes | Map of member keys to short inline member declarations (table below) or formal placements (`{ target: { projectionId } }`). Write `{}` when the panel has no members. |
| `manifest.components` | No | Optional map of Vue template tag name to author-registered component ID (`domain-component:<uuid>`) used directly inside Vue slots without being projections. |
| `content` | No | Optional panel content metadata in `panel.json`. Only `content.messages` is accepted here; `panel.html`, `panel.mjs`, and optional `recipes.md` are loaded from workspace files. |
| `content.messages` | No | Locale-keyed flat message tables (`{ "en": { "panel.name": "…" }, "zh-CN": { "panel.name": "…" } }`) used by `t(key, params)` and `prefillKey`. |
| `theme` | No | Optional `{ light?, dark? }` map of overridable `--sdk-*` theme token values (never `--el-*`). |
| `template` | No | Optional boolean marking whether this panel is a reusable template. |

Minimal complete `panel.json` for a read-only stateless page (empty `state` and `members` objects are required when unused):

```json
{
  "manifest": {
    "state": {},
    "members": {
      "items": {
        "component": "ObjectList",
        "type": "platform:PublishedMcpService",
        "data": {
          "rows": "list"
        }
      }
    }
  },
  "content": {
    "messages": {
      "en": {
        "panel.name": "Published MCP services"
      },
      "zh-CN": {
        "panel.name": "对外 MCP 服务"
      }
    }
  }
}
```

## Panel member fields

Use these fields for a new member inside `manifest.members` in `panel.json`.

| Field | Required on every member | Value |
| --- | --- | --- |
| `id` | No | Stable projection ID written by registration or by the offline check for a packaged panel. Keep it when renaming or moving the member. |
| `component` | Yes | Component name from the released SDK catalogue. Use its package-qualified ID if the name is ambiguous. |
| `type` | No | Default owner type ID from the type table for this member's reads and operations. |
| `target` | No | Panel state field holding the target object (or object list), or {fromSlot: true} when supplied by an enclosing Vue slot via <Projection :inputs="{ target: ref }">. |
| `data` | No | Map the component's datum names to owner reads. Use a read name or {read, type?, params?}. Each params value is {state: fieldName}, {literal: value}, or {fromSlot: true}. |
| `operation` | No | Single operation ID from the owner's entry in the type table. |
| `operationParams` | No | Bind input parameters for `operation` to {literal: value}, {state: fieldName}, {input: portName}, {row: 'primaryKey' \| 'label'}, {rowField: fieldKey}, {formField: '/fieldPath'}, or {formFields: {key: '/fieldPath'}}. |
| `operations` | No | Map local operation names to owner operations (e.g. row actions on ObjectList or multiple actions on ObjectHeader). Each value is an operation ID or {operation, type?, target?, params?, draft?} where target may be 'row', {row: true}, {rowField: key}, a state field name, {state: fieldName}, or {literal: ref}, and draft names a form member in this panel. |
| `draft` | No | Form member key in this panel. Required when the declared read operation takes a draft; optional on a write operation to submit that form member's draft. |
| `parameters` | No | Parameters for a draft read operation. Use {state: fieldName}, {formField: {slot, path}}, or {fields: {parameterName: source}}. Defaults to an empty object. |
| `bindingId` | No | Optional binding ID for a draft read operation, from {state: fieldName} or {formField: {slot, path}}. |
| `state` | No | Map typed component port names or owner read parameter names to panel state fields. |
| `inputs` | No | Explicit projection input bindings: {state: fieldName}, {literal: value}, {output: {member, name, path?}}, or {fromSlot: true} when supplied by an enclosing Vue slot. |
| `config` | No | Component configuration from the released SDK catalogue. |
| `agent` | No | Required for ConversationEntry. Use "page-default", {kind:"id", id}, or {kind:"preset", agentKind}. |
| `prefill` | No | ConversationEntry text placed in the page composer without sending it. |
| `prefillKey` | No | ConversationEntry opening sentence as a key in this panel's content.messages, read in the reader's language. Use it instead of prefill in a panel shipped to several languages. |
| `sourceCard` | No | Required for MetricChart. Use {dashboardId, cardId}; the source owner registers the chart and assigns its projection ID. |
| `name` | No | Projection display name. Defaults to the member name. |
| `description` | No | Projection description. Defaults to the member name. |
