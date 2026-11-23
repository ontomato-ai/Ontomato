# Write a Vue panel

Write the Vue template and scoped panel styles in `panel.html` inside `<div id="app">`. Place each declared member
with `<projection slot="memberKey"></projection>`, where `slot` matches a key in `manifest.members`. Use standard Vue
templates, CSS (`@container`), and events for layout and interactions.

Style colors, typography, spacing, and radii with platform design variables (`--sdk-*`, `--text-*`, `--spacing-*`,
`--radius-*`, `--page-gutter`, `--page-content-gap`) from `node "$SKILL/scripts/ontomato.mjs" sdk read docs/components.md`
(`Theme tokens`) or `sdk read components.json` (`themeTokens`). Never use `--el-*` variables in CSS or `panel.json`
`theme`.

Declare `{ manifest, content?, theme?, template? }` in `panel.json` using the
[panel descriptor and member fields](FIELDS.md). Keep transient local UI state (hover, tooltip expand, scroll position)
in Vue; declare business view state (selected object, tab, search, filter, sort, view mode) and form/dialog switches
(such as `creating`, `editingEntryId`, `grantDialog`) in `manifest.state`. Mark `deepLink: true` **only** on state
needed to restore the same view — never on dialog toggles or active-edit trackers. Put assistant instructions in
`recipes.md`.

Mount the Vue page in `panel.mjs` with `mountPanel` (see the
[clean reference templates](../templates/README.md)). Read [runtime imports and setup](RUNTIME.md#imports),
`node "$SKILL/scripts/ontomato.mjs" sdk read docs/index.md`, and `sdk read docs/components.md` for component data ports,
`config`, outputs, and events.

Use the platform's data-free interface components directly as template tags (not listed in `manifest.members` and no
script import needed):
- `<page-header>` (pure presentational page header)
- `<sdk-*>` UI primitives (`<sdk-button>`, `<sdk-input>`, `<sdk-select>`, `<sdk-segmented>`, `<sdk-dialog>`, `<sdk-drawer>`, `<sdk-tag>`, `<sdk-tabs>`, `<sdk-empty>`, …) and `v-sdk-*` directives (`v-sdk-loading`, `v-sdk-infinite-scroll`, `v-sdk-popover`)
- `<markdown-view>`, `<code-editor readonly>`, `<e-chart>`, `<table-preview>`, `<html-preview>`, `<form-fields>`

For multi-locale panels, put flat message keys under locale tags in `panel.json`'s `content.messages` (for example
`{"en":{"panel.name":"Students"},"zh-CN":{"panel.name":"学员名册"}}`) and call `t("panel.name")` in the template or
`usePanelContext().t` in `setup()`. Single-locale panels may write UI text directly in `panel.html` / `panel.mjs` or
use `content.messages`.

## Layout, `<page-header>`, and container responsiveness

- **Host content box.** Every entry (full page or beside a conversation) receives a content box with no host page
  header, host padding, or outer card frame. Style outer gutter and layout directly in your panel CSS (for example
  `padding: var(--spacing-lg) var(--page-gutter) var(--page-content-gap)`). The platform floats the page composer above
  the viewport without consuming your content box — do not reserve extra bottom padding for it.
- **Container-driven responsiveness.** Prefer container-relative sizing and CSS `@container` rather than
  `window.innerWidth` or viewport units (`vh`/`vw`/`dvh`) so the same code works full-page, embedded in another panel,
  and beside a conversation. When the container has no definite height, grow naturally with content; when it has a
  definite height, either grow and let the outer container scroll or fill the container and scroll the needed sub-region.
- **No layout components.** Write catalog tables, full-width detail cards, split panes, and tabs with normal HTML, CSS
  grid/flex, and Vue. Start from a matching [page template](../templates/README.md).
- **Button classification (Rule 2):**
  1. **Local UI interaction only** (open/close a create dialog, switch tabs/view modes, navigate, go back, discard
     unsaved draft): write `<sdk-button>` directly in `panel.html` without registering a projection.
  2. **Direct business write** (delete, approve, publish, run task, disable): place an `OperationButton` projection, an
     `ObjectList` `config.rowActions` item, or an `ObjectHeader` `operations` item calling a declared member binding.
  3. **Form save / discard**: use `ObjectForm`'s own bar (`config.actions: "footer" | "create-only"`) or wire the form
     member to `<page-header :draft="usePanelFormDraft('form')">` (so both save and discard operate on the exact same
     form member without creating a separate save projection).
- **Pure presentational `<page-header>`.** Place `<page-header>` at the top of `panel.html` when the page needs a
  header (omit it for headerless pages):
  - `title` (string) or `#title` slot (for example `<projection slot="headerTitle"></projection>` using `ObjectHeader`)
  - optional `description` (string) or `#description` slot
  - optional `back-label` + `@back` (wired to `navigate(CATALOG_PATH)` or `usePanelBack`)
  - `#actions` slot for right-side controls (`<sdk-button>`, `<projection slot="remove">`, inline counts, search inputs)
  - `:draft="formDraft"` wired to `usePanelFormDraft("form")` for automatic Save, Discard, and unsaved-changes feedback

```html
<page-header :title="selectedTitle" :back-label="t('detail.back')" :draft="formDraft" @back="goBack">
  <template #actions>
    <projection slot="remove" @done="onRemoveDone"></projection>
  </template>
</page-header>
```

```js
import { mountPanel, usePanelContext, usePanelFormDraft } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { navigate } = usePanelContext();
    const formDraft = usePanelFormDraft("form");
    // Routing back to the catalog entry triggers the platform's unified unsaved-changes leave guard automatically.
    const goBack = () => { void navigate(CATALOG_PATH).catch(() => undefined); };
    return { formDraft, goBack };
  },
});
```

- **Two-entry catalog → detail *(recommended)*.** Put the catalog in the application menu (`names` set on its
  `panelUse`) and give the detail page its own non-menu entry (`names` omitted). Clicking a row (`@choose`) builds a
  flat URL with `panelAddress(DETAIL_PATH, { selected: item.primaryKey })` from `@ontomato/sdk/panel` and calls
  `navigate(address)`. For a single-panel variant, toggle `v-if="!selectedKey"` and wire
  `usePanelBack(..., { pushHistory: true, forms: "form" })`.

## Panel controls and platform guardrails

- **Allowed imports in `panel.mjs`.** Only `vue` and `@ontomato/sdk/panel` (`mountPanel`, `usePanelContext`,
  `usePanelFormDraft`, `usePanelBack`, `usePanelData`, `usePanelOperation`, `savePanelFile`,
  `appIcon`). Never import `element-plus` or any third-party UI library, and never write `<el-*>` tags, `v-loading`,
  or `--el-*` CSS tokens.
- **Overlays & notifications.** Use `<sdk-dialog>` / `<sdk-drawer>` for modal/drawer overlays (such as centered create
  forms). Call `usePanelContext().notify({ kind: "success" | "info" | "warning" | "error", text })` for transient
  feedback.

## Open a panel with flat named URL parameters

Mark **only** view-restoration state (`selected`, `tab`, `search`, `filter`, `sort`, view mode) with `deepLink: true` in
`manifest.state`. **Never** mark dialog toggles (`creating`, `grantDialog`, `dialog`, `compose`) or active-edit trackers
(`editingEntryId`) with `deepLink: true` — keep them as normal public state so agents can still open and inspect them.

Use `node "$SKILL/scripts/ontomato.mjs" panel uses <app-id>` to confirm the destination entry's registered `path`, and
build addresses with `panelAddress(path, state)` from `@ontomato/sdk/panel`:

```js
import { panelAddress, usePanelContext } from "@ontomato/sdk/panel";

const { navigate } = usePanelContext();
// Fixed single-type object state -> "/ontology/relations/detail?selected=belongs_to"
await navigate(panelAddress("/ontology/relations/detail", { selected: ref.primaryKey }));
// Multi-type object-union state -> "/ontology/map?selected=platform:ObjectType~Student&tab=relations"
await navigate(panelAddress("/ontology/map", {
  selected: { className: "platform:ObjectType", primaryKey: "Student" },
  tab: "relations",
}));
```

| State type / scope | Flat query encoding | Example |
| --- | --- | --- |
| Scalar (`string`, `number`, `boolean`) | `<name>=<value>` (omitted when empty or default) | `?tab=entries&sort=updated` |
| Single-type `object` | `<name>=<primaryKey>` | `?selected=my-app` |
| Multi-type `object-union` | `<name>=<className>~<primaryKey>` | `?selected=platform:ObjectType~Student` |
| `child-object` | `<name>=<parentPk>~<childPk>` (or `<parentType>~<parentPk>~<childPk>`) | `?field=Student~name` |
| `list` | Repeated `<name>` parameters | `?tag=a&tag=b` |
| Application frame `deepLink` field | `frame.<name>=<value>` | `?frame.term=2026-fall` |

Shell-reserved query parameters (`draftSessionId`, `draftRunId`, `draftPath`, `standalone`, `from`, `navigationContext`)
and `frame.*` parameters are preserved automatically by `panelAddress`; do not use them as panel state names. See
[State in an address](RUNTIME.md#state-in-an-address) and the
[object reference shapes table](RUNTIME.md#object-reference-shapes-quick-reference).

## Component vs. panel responsibility

- **Display belongs to universal components.** Components render business fields, graphics, options, and executable
  operations according to their projection declarations. Note that `bindsElement` in the SDK catalogue indicates which
  ontology element types a component applies to; every actual projection binding must still go through a declared read
  or operation (binding a class alone is rejected).
- **Logic belongs to the capability layer; formatting belongs to components.** Calculations, aggregations, and business
  judgments (such as "overdue if > 3 days") belong to MetricViews (reads), Actions (writes), or platform built-in reads.
  Base components may format already-provided values in three ways only:
  1. **Owner gives numbers, component fills a fixed sentence template:** bind a MetricView (`data.result`) or record to
     `RecordTemplate` (`template: "共 {total} 人，其中 {pending} 人待审"`).
  2. **Exact-match `valueMap`:** map already-provided codes/booleans/statuses to localized `label` / `labelKey` /
     `labels`, semantic `tone`, and platform `icon` on `TypedValue`, `RecordTemplate`, `InfoBanner`, or `ObjectList`
     columns (pure exact match; no arithmetic or range/threshold expressions).
  3. **Local text matching on a complete unpaged list:** `ObjectList` filters an unpaged `panelRecordList` locally and
     exposes `filteredCount`. For paged reads (`panelRecordQuery`) or business-scoped filters, always use owner reads
     and the owner-returned `total`.
- **Panels only lay out and wire.** Panels arrange members, own layout and public state, wire read-only projection
  outputs (`usePanelOutput` / `usePanelOutputs`) into other projections, visibility checks (presence, equality, or zero
  checks are NOT business calculation), navigation, or text-only slots (titles, tabs, counts with optional fixed
  prefix/suffix). Never read raw record fields or compute business values; unsaved form drafts do not count as ontology
  data.

### Choose an official component before writing one

Advance to the next step only when the previous step cannot meet the need:

1. **Default appearance.** Run `panel type <type-id> --read <name>` and compare `result` / `resultSchema` with the
   official component's Data section in `sdk read docs/components.md`.
2. **Component `config`.** Configure columns (`width`, `minWidth`, `kind`, `valueMap`, `timeFormat`), `rowActions`,
   visible/copyable fields, `ObjectForm` `presentation` (`"cards" | "tabs" | "steps"`) & `groups`, `OperationButton`
   labels/tones/`hideWhenUnavailable`, or `pageSize`.
3. **Official component Vue slots.** Place a focused slot-only domain component (declared in `manifest.components`) or a
   nested `<projection :inputs="{ target: ref }">` inside `#cell-<key>`, `#actions`, `#row-detail`, or `#field-<dotPath>`.
4. **Author a dedicated domain component (last resort).** Only when steps 1–3 cannot cover the whole block, register a
   domain component with `component register <directory>` and declare its `meaning`, data, config, inputs, outputs, and
   operations. Never wrap an entire page in a custom component.

## Read-only projection outputs and official component reference

Never use `usePanelData` in new panels to read raw business record fields. Instead, read declared read-only outputs with
`usePanelOutput(member, name)` / `usePanelOutputs(member)`:

### `ObjectList` counts, selection, and `rowType`

- **List count outputs (do not confuse them):**
  - `total`: strictly the owner-reported total (`number | null`). When the owner does not report a total, `total` is
    `null` — never fake it as `0` or replace it with `rows.length`.
  - `loadedCount`: number of rows currently loaded in this batch/page (`number`).
  - `filteredCount`: local text-match count **only** when locally filtering a complete unpaged `panelRecordList` (matches
    the list footer count in that mode); `null` for paged queries (`panelRecordQuery`).
  - Other read-only outputs: `status`, `checkedCount`, `selectedLabel`, `activeLabel`.
- **Selection guard:** Clicking a row selects it **only** when `selected` is bound to a writable public state in
  `manifest.state`. If `selected` is unbound or bound to a fixed `{ literal: ... }`, row selection is disabled (read-only).
  Use `@choose` for row-click navigation to a dedicated detail entry.
- **Cross-type `rowType`:** When an owner read lists child records of a different ontology type (declared via `rowType`
  on the read), `ObjectList` emits and selects typed references using `rowType`.

```json
{
  "component": "ObjectList",
  "type": "platform:Application",
  "data": { "rows": "query" },
  "state": { "selected": "selected", "search": "search" },
  "config": {
    "layout": "table",
    "pagination": "pages",
    "pageSize": 20,
    "columns": [
      { "key": "label", "labelKey": "col.name", "subtitleKey": "subtitle", "iconKey": "icon", "minWidth": 240 },
      {
        "key": "status",
        "labelKey": "col.status",
        "kind": "tag",
        "width": 110,
        "valueMap": {
          "approved": { "labelKey": "status.approved", "tone": "success" },
          "pending": { "labelKey": "status.pending", "tone": "warning" }
        }
      },
      { "key": "updatedAt", "labelKey": "col.updatedAt", "kind": "time", "timeFormat": "datetime", "width": 168 }
    ]
  }
}
```

### `ObjectHeader`

- Renders object title (`record.label`), subtitle, status badge, inline `operations`, and overflow More menu.
- Exposes read-only outputs `label`, `status`, `errorMessage`, plus any fixed named typed scalar outputs explicitly
  declared by the bound read's owner (for example `canMaintain`, `canGrant`, `domainShared` on `platform:Application`).
  Read them via `usePanelOutput("headerTitle", "canMaintain")`. Arbitrary raw field bags are not exposed.

### `ObjectSummary`

- Bind `target` to an object state (`selected`), `data: { record: "record" }`. Configure `config.fields`,
  `config.showTitle: false` (avoid duplicating `<page-header>` / `ObjectHeader`), and `config.copyableFields`. Exposes
  read-only output `label`.

### `OperationButton`

- Binds one declared operation (`operation`, optional `target` for single object or checked list; omit `target` for
  targetless Actions).
- `config.hideWhenUnavailable: true` is **fail-closed**: if availability is false, loading fails, or the read errors,
  the button stays hidden/unavailable instead of exposing an unpermitted action.
- Example on a platform relationship:

```json
{
  "component": "OperationButton",
  "operation": "relationships.delete",
  "target": "selected",
  "config": { "label": "Delete", "type": "danger", "plain": true, "icon": "trash", "hideWhenUnavailable": true }
}
```

### `ObjectRefCard`

- Renders a clickable object reference card from `data.record` (`config.field` or the record itself) or `data.result`.
- Declares output `navigate` (bindable via `state: { navigate: "targetState" }` in addition to emitting `@navigate`).

### `MetricCard`, `ObjectCount`, `RecordTemplate`, `InfoBanner`, `TypedValue`

- **`ObjectCount` & `MetricCard`:** Pure presentation — never compute sums or averages on the client. For paged queries
  (`panelRecordQuery`) and `panelOntologyObjects`, both display strictly the owner-returned `total` (never `rows.length`),
  showing `—` when unknown. Complete unpaged `panelRecordList` uses `rows.length`.
- **`RecordTemplate`:** Fills values from `data.record` or one row of `data.result` (`metricOutput`) into a fixed
  `{fieldKey}` template (`template`, `templateKey`, or `templates`, with per-field `fieldFormats` including `valueMap`).
- **Auto-refreshing metrics after writes:** When authoring a `MetricView` read by `MetricCard` / `RecordTemplate` /
  `MetricChart`, declare `sourceObjectTypes` on the MetricView definition so any write whose `affected.objectTypes`
  includes those types automatically refreshes the metric projection.

### `ObjectGraph`

- Displays nodes (`panelRecordList`) and edges (`panelRecordList`) with zoom, fit, relayout, PNG export, search
  highlighting (`highlightedNodes`, `highlightedEdges`), and directed shortest-path (`pathFrom`, `pathTo`).
- **Visible-graph scope note:** `pathFrom` / `pathTo` computes the directed shortest path over the **visible nodes and
  edges currently loaded in the canvas** (not an external unpaged server traversal).

## Customer `ObjectType` forms and targetless Actions

Customer ontology classes (such as `Student`, `Course`, `Order`) support standard `ObjectForm` editing and creation
through the platform's generic `form` / `createForm` reads paired with published `Action`s.

### 1. Edit an existing customer object (`ObjectForm` + object-targeted `Action`)

- Bind `type: "<Class>"`, `target: "<selectedState>"`, `data: { form: "form" }`, and bind a write `Action` under
  `operations.save` (or `operation` + `operationParams`).
- **Editable fields are strictly governed by the bound save `Action` and its parameter wiring:**
  - Any Action parameter not explicitly listed in `params` connects directly by the same name to form field `/<param>`.
  - Use `{ "formField": "/pointer" }` to map a differently named or nested form attribute to an Action parameter.
  - Use `{ "formFields": { "key": "/pointer", ... } }` to pack multiple form fields into a JSON object Action parameter.
  - Use `{ "literal": value }` or `{ "input": "portName" }` for fixed or input-sourced parameters.
  - **Attributes not accepted by the bound Action are automatically rendered read-only.** Make sure your save Action's
    parameters cover every attribute you want users and agents to edit.
  - **Clearing nullable fields:** Clearing a previously populated nullable field explicitly submits `""` (or `"null"` for
    JSON parameters) so intentional clears are never dropped.

```json
{
  "studentForm": {
    "component": "ObjectForm",
    "type": "Student",
    "target": "selected",
    "data": { "form": "form" },
    "operations": {
      "save": {
        "operation": "action-update-student",
        "params": {
          "student_name": { "formField": "/name" },
          "profile": { "formFields": { "grade": "/grade", "note": "/remark" } }
        }
      }
    },
    "config": { "actions": "none" }
  }
}
```

### 2. Create a customer object or run a global Action (targetless `Action`, `target: null`)

- Targetless customer Actions (creating a new object, importing, batch generation, etc.) do **not** invent a new `kind`.
  In the author type table (`panel type --all`), they live once at the top level under `operations` keyed uniquely by
  Action ID, with `target: { source: "none" }` and `affects: ["Order", ...]` for discovery and automatic post-write
  refresh. When an agent invokes one via `/operate`, it sends `call.target: null`.
- **Example A — `ObjectForm` in create mode bound to a targetless `Action`:**

```json
{
  "orderCreateForm": {
    "component": "ObjectForm",
    "type": "Order",
    "data": { "createForm": "createForm" },
    "operations": {
      "save": {
        "operation": "action-create-order",
        "params": {
          "customer_name": { "formField": "/customer" }
        }
      }
    },
    "config": { "actions": "create-only" }
  }
}
```

- **Example B — `OperationButton` bound to a targetless `Action`:**
  Omit `target`. When the Action declares `values` parameters, clicking the button automatically opens the parameter
  collection dialog, validates inputs, confirms, and dispatches with `target: null`:

```json
{
  "createOrderBtn": {
    "component": "OperationButton",
    "operation": "action-create-order",
    "config": { "label": "New Order", "type": "primary", "icon": "plus" }
  }
}
```

### 3. Two valid ways to wrap up after creation (`@saved`)

1. **Action owner returns the new object identity (`saved?.primaryKey`):** You may close the create dialog and select
   or navigate to the newly created object's detail view (`panelAddress(DETAIL_PATH, { selected: saved.primaryKey })`).
2. **Action owner does NOT return a new identity (`saved === null`):** **Never guess the new ID or infer it by diffing
   the list.** Show success (`notify`), close/reset the create form/dialog, and let `affected.objectTypes` (`affects`)
   auto-refresh sibling lists and metrics (both humans and agents follow the same behavior). If your flow requires
   "jump straight to the newly created record's detail page", have the Action owner return the created object identity in
   the capability layer.

### 4. Cross-member write submitting a form draft (`draft`)

When a button or operation declared on **another** member submits a form member's current draft, explicitly specify
`draft: "<formMemberKey>"` in that member's operation binding (either top-level `draft` on `OperationButton` or inside
`operations.<name>.draft`), so the platform and agents know which form draft is being submitted.

## Custom list columns, row detail, and per-row operations

Use `ObjectList`'s built-in `config.rowActions` for per-row operation buttons and local buttons (dialog/navigation),
and standard Vue slots (`#cell-<key>`, `#cell`, `#actions`, `#row-detail`, `#card`, `#empty`) to customize a piece of
the list without replacing the whole table.

- **Rowless slots & events:** `ObjectList` never passes raw `row` objects to panel slots or events.
  - `#cell-<columnKey>` and `#cell` receive `{ ref, index, column, value, displayText, tone, operations, runOperation }`
    — pass only `value` / `displayText` / `tone` to your display component; never read raw row record fields or calculate in the
    template.
  - `#actions` receives `{ ref, index, operations, runOperation }`.
  - `#row-detail` receives `{ ref, index, collapse }` — pass `:inputs="{ target: ref }"` to a nested projection whose
    `target` is `{ "fromSlot": true }`.
  - `runOperation(localName, overrides?)` only accepts parameters declared on that row operation's allowlist.

```json
{
  "manifest": {
    "state": {
      "selected": {
        "type": { "kind": "object", "objectType": "platform:Application" },
        "deepLink": true
      }
    },
    "components": {
      "status-pill-cell": "domain-component:11111111-1111-4111-8111-111111111111"
    },
    "members": {
      "apps": {
        "component": "ObjectList",
        "type": "platform:Application",
        "data": { "rows": "query" },
        "state": { "selected": "selected" },
        "config": {
          "columns": [
            { "key": "label", "labelKey": "col.app", "width": "240px" },
            { "key": "status", "labelKey": "col.status", "kind": "tag", "width": 120 }
          ],
          "rowActions": {
            "maxVisible": 2,
            "items": [
              { "kind": "local", "id": "edit", "labelKey": "action.edit" },
              { "kind": "operation", "operation": "disable", "when": { "field": "status", "equals": "active" } }
            ]
          }
        },
        "operations": {
          "disable": { "operation": "applications.disable", "target": { "row": true } }
        }
      },
      "rowDetail": {
        "component": "ObjectSummary",
        "type": "platform:Application",
        "target": { "fromSlot": true },
        "data": { "record": "record" }
      }
    }
  }
}
```

```html
<projection slot="apps" @row-action="onRowAction">
  <template #cell-status="{ value, displayText, tone }">
    <status-pill-cell :value="value" :text="displayText" :tone="tone"></status-pill-cell>
  </template>
  <template #row-detail="{ ref }">
    <projection slot="rowDetail" :inputs="{ target: ref }"></projection>
  </template>
</projection>
```

For `ObjectForm`, place field-level pickers or custom inputs inside `#field-<dotPath>` (for example `#field-skills`,
`#field-modelSelection.modelId`, or `#field-items.*.skillId` for array rows). `ReferencePicker` and `ObjectGraph`
connect automatically to the enclosing form field.

Register a domain component and check/register the panel workspace:

```sh
node "$SKILL/scripts/ontomato.mjs" component register ./status-pill-cell
node "$SKILL/scripts/ontomato.mjs" panel check ./apps-panel
node "$SKILL/scripts/ontomato.mjs" panel register ./apps-panel
```

## Bind read parameters and listen to component events

Inspect each component's Data and Events sections in `sdk read docs/components.md` and read parameter signatures in
`panel type <type-id> --read <name>`. Explicit `data.<name>.params` map read parameters to `{ state: "fieldName" }`,
`{ literal: value }`, or `{ fromSlot: true }`, or bind a same-named read parameter via the member's `state` map.
Components supply their own runtime parameters (such as search/page/cursor) automatically when unbound.

Listen to component events directly on `<projection>` (`@choose`, `@navigate`, `@saved`, `@discarded`, `@done`).

## Connect a graph and its relations

Inspect `ObjectGraph`, `OntologyGraph`, and `ObjectRelations` in `sdk read docs/components.md` and named reads via
`panel type <type-id> --read <name>`. Declare the shared [graph selection type](RUNTIME.md#graph-selection) in
`manifest.state`, and map the graph and relation list to that same state field so selections stay synchronized. See the
[ontology-graph-workbench template](../templates/ontology-graph-workbench/README.md) for a complete clean example.

## Select a child record and read from its parent

Use the [child-object field and value shapes](RUNTIME.md#child-objects) for child selection, alongside a parent object
state for the parent's reads. Set the read member's `target` to the parent state and pass any required child/source
parameters through `data.<name>.params` (see [FIELDS.md](FIELDS.md)).

## Invoke declared owner operations

Use the owner's full operation ID in the member declaration and bind `target` to the selected object (or a checked list
for batch operations; omit `target` for targetless Actions). Place `<projection slot="remove">` directly in
`<page-header #actions>` or toolbar slots. From Vue code, call [`usePanelOperation`](RUNTIME.md#usepaneloperation) in
synchronous `setup()` and run `handle.run(input)`. The platform handles permissions, confirmation, and write receipts
(see [operation IDs and write results](RUNTIME.md#operation-ids-and-write-results)).

## Save a form or hand off a draft

An `ObjectForm` projection binds one save operation (platform `form.save` or customer `Action`).

- **`config.actions`**:
  - `"footer"` (default): non-overlapping document-flow Save/Discard/Cancel bar at the bottom of the form.
  - `"create-only"`: Cancel/Create bar only in create mode (pair with `<page-header :draft="formDraft">` in edit mode).
  - `"none"`: omit the form's own bar in both modes (ideal on a dedicated detail entry with `<page-header :draft="formDraft">`).
- **`usePanelFormDraft("form")`**: wire directly into `<page-header :draft="formDraft">` for Save, Discard (with
  confirmation), busy state, and unsaved-changes notice — no manual submit boilerplate needed.
- **`config.fixedFields`**: fix parent-determined fields by JSON Pointer path (`{"state":"selected","path":"/primaryKey"}`
  or `{"literal":"..."}`) so they display read-only and submit with every save.
- `ObjectForm` automatically renders word counters for schema `maxLength` fields and disables cascading select fields
  when the owner declares `disabledWhenEmpty`.
- The `saved` event carries `{ className, primaryKey }`.

### Assistant live form filling and saving

Assistants do not write `.page-draft.json` files or draft query links. Instead, once the target page/tab/dialog is open
beside the conversation via `present`, the assistant calls `fill_form` to edit fields directly in the mounted
`ObjectForm` (highlighting changed fields and keeping the form unsaved) and `page_action` to invoke the form's declared
save operation (confirming in conversation by default, or saving immediately in full-auto sessions).

### Metric charts from dashboard cards

For a calculated MetricView chart, declare `component: "MetricChart"` and `sourceCard: { dashboardId, cardId }`, and
connect its inputs in `state`. If the card is not yet registered, `panel check` lists it in `unchecked` and
`panel register` asks the card owner to register it and writes the projection ID.

## Open the page composer

A dialog or conversation entry pointing to a specific agent is also a projection. Add a `ConversationEntry` member when
the page needs a button that opens the composer with a specific agent and an optional opening line (`prefill` or
multi-locale `prefillKey` in `content.messages`). The reader still sends the message.

## Register and open

Write each new projection inline in `manifest.members`, run `panel check <directory>`, then `panel register <directory>`.
Registration writes each new projection's UUID into `panel.json` as `id` (keep it on future edits). Use
`target.projectionId` to reuse an existing projection.

- Application IDs start with `app-`, and paths start with `/applications/<application-id>/`.
- Give every `panelUse` a domain-unique `pageKey`. Include `names` for menu entries; omit `names` for detail entries
  opened only via navigation or deep links.
- For domain-member apps, set `entryAccess: ["domain-member"]` and `access: { kind: "domain-member" }`. For restricted
  apps, declare app-owned permissions (e.g. `app:app-my-app:view`).
- Set `"allowStandalone": true` when the application should support standalone external links (`standalone=1`, copied
  from the sidebar application menu or application properties).
- Choose `declaration.icon` from `node "$SKILL/scripts/ontomato.mjs" sdk icons`.
- Omit `defaultAgent` to use the general assistant; set `{ kind: "id", id }` or `{ kind: "preset", agentKind }` only
  when that agent already selects this panel's skill.

## When a panel looks wrong

Open the registered entry without query parameters first, keep browser Network and Console logs open across a hard
reload, and inspect the first failing request or error:

- **Blank panel or `panel-host-error`.** Inspect console errors, `GET /api/product-panels/<id>`, and SDK asset
  requests. Verify with `panel uses <app-id>`, `panel get <panel-id>`, `panel projection <id>`, and
  `panel check <directory>`.
- **List is empty or waiting.** Check `POST /api/product-panels/read` for `memberPath` and `dataName` against
  `panel type <type-id> --read <name>`. Missing required inputs leave a datum `awaiting`.
- **Form does not fill or save.** Verify the form member is mounted (`observe_display`), check field paths and read-only status from the `fill_form` receipt, and verify the save operation is admitted for the current target.

## What the assistant receives

The platform derives the panel's page skill from its declared reads, state, forms, operations, and `recipes.md`, and
passes current entry metadata, live public state, declared selections, and open form contents in `pageContext` and
`observe_display`. Keep page-specific guidance in `recipes.md` and verify via the
[page input box](SKILL.md#check-the-assistant-from-the-page).
