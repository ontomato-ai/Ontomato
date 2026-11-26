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

Use these fields for a new inline member inside `manifest.members` in `panel.json`. Map writable ports via
`state`, which expands to inputs and outputs according to the component declaration. Use `inputs` for explicit
input sources such as another member's read-only output. The inline shorthand accepts no `outputs` key.

| Field | Required on every member | Value |
| --- | --- | --- |
| `id` | No | Stable projection ID written by registration or by the offline check for a packaged panel. Keep it when renaming or moving the member. |
| `component` | Yes | Component name from the released SDK catalogue. Use its package-qualified ID if the name is ambiguous. |
| `type` | No | Default owner type ID from the type table for this member's reads and operations. |
| `target` | No | Panel state field holding the target object (or object list), or {fromSlot: true} when supplied by an enclosing Vue slot via <Projection :inputs="{ target: ref }">. |
| `data` | No | Map the component's datum names to owner reads. Use a read name or {read, type?, params?}. Each params value is {state: stateName}, {state: stateName, field: primaryKey or objectType}, {literal: value}, {output: {member, name, path?}} for another member's read-only output, or {fromSlot: true}. |
| `operation` | No | Single operation ID from the owner's entry in the type table. |
| `operationParams` | No | Bind input parameters for `operation` to {literal: value}, {state: fieldName}, {input: portName}, {row: 'primaryKey' \| 'label'}, {rowField: fieldKey}, {formField: '/fieldPath'}, or {formFields: {key: '/fieldPath'}}. |
| `operations` | No | Map local operation names to owner operations (e.g. row actions on ObjectList or multiple actions on ObjectHeader). Each value is an operation ID or {operation, type?, target?, params?, draft?} where target may be 'row', {rowField: key} when the target is a field of the clicked row, {state: fieldName}, or {literal: ref}, and draft names a form member in this panel. Omit target on an ObjectList placement to address the clicked row. |
| `draft` | No | Form member key in this panel. Required when the declared read operation takes a draft; optional on a write operation to submit that form member's draft. |
| `parameters` | No | Parameters for a draft read operation. Use {state: fieldName}, {formField: {slot, path}}, or {fields: {parameterName: source}}. Defaults to an empty object. |
| `bindingId` | No | Optional binding ID for a draft read operation, from {state: fieldName} or {formField: {slot, path}}. |
| `state` | No | Map typed component port names or owner read parameter names to panel state fields. |
| `inputs` | No | Explicit projection input bindings: {state: stateName}, {state: stateName, field: primaryKey or objectType}, {literal: value}, {output: {member, name, path?}}, or {fromSlot: true} when supplied by an enclosing Vue slot. |
| `config` | No | Component configuration from the released SDK catalogue. |
| `agent` | No | Required for ConversationEntry and AgentChat. Use "page-default", {kind:"id", id}, or {kind:"preset", agentKind}. |
| `prefill` | No | ConversationEntry text placed in the page composer without sending it. |
| `prefillKey` | No | ConversationEntry opening sentence as a key in this panel's content.messages, read in the reader's language. Use it instead of prefill in a panel shipped to several languages. |
| `submit` | No | ConversationEntry flag to submit non-empty prefill immediately on a reader click. |
| `newSession` | No | ConversationEntry flag to start a fresh conversation session on a reader click. |
| `sourceCard` | No | Optional for MetricChart. Use {dashboardId, cardId} to bind an existing dashboard card through the chart owner, or omit it and bind MetricChart data directly. |
| `name` | No | Projection display name. Defaults to the member name. |
| `description` | No | Projection description. Defaults to the member name. |

## Form controls and operation inputs

- `choice-matrix` locks individual rows with `disabled: boolean` and `disabledReason: string | null`. Supply a reason for a disabled row and `null` for an enabled row. Field-level `readOnly` applies to the whole field.
- Owner forms (`panelFormDescription`) and individual fields (`panelFormField`) may declare `submitOn?: "manual" | "blur" | "change"` (default `"manual"`; field overrides form). Fields with `"blur"` or `"change"` submit single-field saves automatically on blur or change; agent `fill_form` routes auto-submitting fields through the registered save confirmation flow.
- `select` supports `presentation: "dropdown" | "radio" | "checklist" | "tree"` and `presets`. The `text` control supports `variables` and marks secret input with `secret: true`. Its `presentation: "markdown"` draws the same string as a Markdown editor of at least six rows that counts its characters; the value stays the owner's plain string. Operation input schema properties can also declare `secret: true`.
- In `OperationButton`, bind each top-level `inputSchema` property that the button should supply, including optional properties. `OperationInputDialog` prompts for any unbound properties. To omit an optional value, bind a scalar state whose default is `null`.
- For an `operationParams` state binding, use a scalar state directly. To pass a reference's primary key, use `watch` in `panel.mjs` to extract `primaryKey` into that state. The `{ state, field: "primaryKey" }` read-parameter shorthand is unavailable in `operationParams`.
- Use `ObjectList.config.rowActions` for per-row operations. It supports `hideWhenUnavailable` and the host's one-time secret delivery. `OperationButton` targets cannot come from `{ fromSlot: true }`.
