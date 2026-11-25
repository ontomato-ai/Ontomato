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
  - Keep `#title` on one horizontal line. For an `ObjectHeader` title, set `config.subtitle: ""` and the owner field
    for `config.statusField`, and pass `:fallback-title="selectedKey"` to the projection. Place descriptive content
    in `#description` with `TypedValue`.
  - optional `back-label` + `@back` (wired to `navigate(CATALOG_PATH)` or `usePanelBack`)
  - Always declare `<template #actions>` for custom actions and put visibility conditions inside. Use `v-show`
    on the delete projection: `letGo` can clear `selected` before `@done` runs, so keep the button mounted
    until completion can navigate.
  - `:draft="formDraft"` wired to `usePanelFormDraft("form")` for automatic Save, Discard, and unsaved-changes feedback

```html
<page-header :title="selectedTitle" :back-label="t('detail.back')" :draft="formDraft" @back="goBack">
  <template #actions>
    <projection v-show="selectedKey && ready" slot="remove" @done="onRemoveDone"></projection>
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
    const goBack = () => navigate(CATALOG_PATH);
    return { formDraft, goBack };
  },
});
```

- **Full-width catalog → full-width detail.** Put the catalog in the application menu (`names` set on its
  `panelUse`) and give the detail page its own non-menu entry (`names` omitted). Clicking a row (`@choose`) builds a
  flat URL with `panelAddress(DETAIL_PATH, { selected: item.primaryKey })` from `@ontomato/sdk/panel` and calls
  `navigate(address)`. Put New in the catalog header's top-right actions, open a centered dialog for required fields,
  and use the saved identity to open the detail entry. Back calls `navigate(CATALOG_PATH)`; the platform retains the
  catalog state and refreshes the list on return.

## Panel controls and platform guardrails

- **Allowed imports in `panel.mjs`.** Only `vue` and `@ontomato/sdk/panel` (`mountPanel`, `usePanelContext`,
  `usePanelFormDraft`, `usePanelBack`, `usePanelNarrow`, `usePanelOutput`, `usePanelOperation`, `savePanelFile`,
  `appIcon`). Never import `element-plus` or any third-party UI library, and never write `<el-*>` tags, `v-loading`,
  or `--el-*` CSS tokens.
- **Overlays & notifications.** Use `<sdk-dialog>` / `<sdk-drawer>` for modal/drawer overlays (such as centered create
  forms). The SDK guards close-button, backdrop, Escape and `handleClose()` requests. Discard affects only dirty
  forms inside the overlay. For an `ObjectForm` with dialog Back handling, bind `:model-value` one way and use
  `:before-close` to call `done()` only when `await dialogBack.back()` succeeds. Drive a custom footer Save with
  `usePanelFormDraft`. See the [dialog recipe](../management-pages.md#guard-a-form-dialog).
- **Native panel CSS.** `SdkPopover`, `SdkDialog` and `SdkDrawer` mount in the panel's
  `[data-panel-overlay-root][data-panel-instance]`. Panel `<style>` applies directly there. Use ordinary
  descendant selectors such as `.wrap .sdk-owner-form`. Omit Vue SFC selectors `:deep` and `::v-deep`.

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

Shell-reserved query parameters (`standalone`, `from`, `navigationContext`)
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

Render business data with projections. Use `usePanelOutput(member, name)` in synchronous Vue setup for a declared
read-only output. It starts no reads. Only mounting the projection lets its component request its data. Keep the
producer mounted with `v-show` when temporarily hidden and its output controls surrounding layout. Wrap trailing
projections in a compact container (for example an inline-flex span inside `<app-menu #item-trailing>`) so the
projection's box fits the slot. Mount dependent UI only when its inputs are ready.

Wire one member's read-only output directly to another member's inputs. For example, connect the
`ObjectForm` member `form` to `AnnotatedCode.currentCode` inside the code member:

```json
{
  "inputs": {
    "currentCode": { "output": { "member": "form", "name": "draft", "path": "/function/code" } }
  }
}
```

Use a JSON Pointer for nested values and omit `path` for the whole output. Keep outputs such as
`usePanelOutput("list", "listed")` and `usePanelOutput("form", "draft")` outside writable `manifest.state`.
A member's `state` shorthand maps the named component inputs or writable outputs and owner read parameters
to public state. It expands to the matching inputs and outputs declared by the component. Use `state` and,
where explicit input sources are needed, `inputs` on inline shorthand members. The `outputs` key is reserved
for formal placements.

Read [the component reference](#offline-check-and-component-reference) for data ports, props, configuration, slots,
events, output types and defaults.

### `ObjectList` counts, selection, and `rowType`

- **List status and references:** `status` is the datum status; it starts at `null` until the member publishes.
  `usePanelOutput("list", "listed")` reads the typed `{ className, primaryKey }` references of the current matching
  batch or page. An empty list publishes `[]`; an unavailable or not-yet-ready batch publishes `null`.
- **Counts:** `total` is the owner-reported total or `null`. `filteredCount` is the local match count for a complete
  unpaged list, and is `null` when the owner declares server `search` or the read is paged.
  Use `filteredCount.value ?? loadedCount.value` to display the current match/batch count where that is the intended
  label. `loadedCount` counts the loaded rows and may be `null` before a result.
- **Search and grouping:** Bind `state.search` for a shareable search. An unpaged list without server search matches
  locally. `config.searchFields` limits matching to the named row fields, including array values.
  `config.groupBy` groups by a returned field (e.g. category), with collapsible headings and per-group counts for
  the current result. `groupEmptyLabel` names the empty group. Match the owner read parameter type when binding a
  filter. For example, a boolean `template` filter uses a nullable boolean scalar, with `null` for all records.
- **Table, tabs, dynamic columns, and CSV export:** Use `config.layout: "table"` for columns,
  `columns[].subtitleKey` for secondary text, `wrap: true` for a multiline cell, `kind: "tag"` for an owner tone or
  exact-match `valueMap`, and `kind: "tags"` for multiple values (empty renders an em dash). For list-valued cells,
  use `listSeparator` to set the inline separator and `listStyle` to choose the rendering (for example `"inline"` or
  `"tags"`). Set `config.dynamicColumns: true` (without static `columns`) to derive columns from owner `fieldLabels`
  and record `fields` (preserving headers across empty results in the same scope). Enable `showColumnToggle: true` for
  a local column-visibility popover, and `exportable: true` (with optional `exportFileName`) to export the currently
  loaded page as UTF-8 BOM CSV in visible-column order. Use `config.layout: "tabs"` for a horizontal tab strip with
  overflow scroll buttons, compact per-tab `rowActions`, and a trailing `#tabs-extra` slot.
  Reference cells emit `@navigate` without selecting
  the row. Give every column a `labelKey` defined in `content.messages`. Owner row labels cannot supply table
  headers when there are no rows. `showFooter: false` hides the footer.
- **Cards:** Use `layout: "cards"` for the row `label`, an optional `statusField`, and secondary text
  (configure `subtitleField` and use `subtitleLines` to clamp it). Cards render `rowActions` with owner
  `unavailable.reason` on disabled actions. `ObjectList` displays the read owner's `diagnostics` directly.
- **Empty and no match:** Set `emptyText` and `noMatchText` to `panel.t` message keys. To replace the built-in
  search box, set `searchable: false` and bind an external `<sdk-input>` to the same state as `state.search`.
  Active search still narrows the list and no-match results keep the table headers.
- **Selectable hierarchy:** Use a table with `showHeader: false`, `fallbackToFirst: true`, and a `#cell-path`
  slot to indent owner-provided paths while selecting object rows. `ObjectTree` consumes a `files` read and
  selects scalar file keys. Use it for file navigation.
- **Multi-select outside a form:** Bind `ObjectList.data.rows` to a list/query of references and
  `state.checked` to a list of those references. For an operation input requiring IDs, watch the checked state
  in `panel.mjs` and map its `primaryKey` values to a list of scalar IDs for the binding.
- **Server field filters and sorting on customer `ObjectType` lists (`query`):** Customer ontology `query` reads
  (and `platform:ObjectType.instances`) accept optional `filters` (`recordFilters`) and `sort` (`recordSort`)
  parameters executed server-side across the whole class before counting `total` and paging (the viewer must have read
  permission on every referenced field):
  - `filters`: JSON array of `{ field, operator, value? }` combined with logical **AND**. Supported `operator` values
    are `"eq"`, `"ne"`, `"contains"` (string `value` required), `"gt"`, `"lt"`, `"gte"`, `"lte"`, `"null"`, and
    `"notnull"` (`"null"` and `"notnull"` forbid `value`; all other operators require scalar `string | number | boolean`
    `value`).
  - `sort`: JSON object `{ field, order: "asc" | "desc" }` (the class primary key is appended as a stable tie-breaker).
  - Declare `filters` and/or `sort` in `manifest.state` as `{ "type": { "kind": "json" }, "default": null }` (`null`
    omits the parameter), bind them under `data.rows.params`, and put filter/sort controls in `<template #filters>` (clear
    both in `@clear-filters` as well). `ObjectList` automatically resets to page 1 when `filters` or `sort` changes.

```json
{
  "manifest": {
    "state": {
      "selected": { "type": { "kind": "object", "objectType": "WorkItem" }, "deepLink": true },
      "search": { "type": { "kind": "scalar", "type": "string" }, "default": "", "deepLink": true },
      "listFilters": { "type": { "kind": "json" }, "default": null },
      "listSort": { "type": { "kind": "json" }, "default": null }
    },
    "members": {
      "list": {
        "component": "ObjectList",
        "type": "WorkItem",
        "data": {
          "rows": {
            "read": "query",
            "params": {
              "filters": { "state": "listFilters" },
              "sort": { "state": "listSort" }
            }
          }
        },
        "state": { "selected": "selected", "search": "search" },
        "config": { "layout": "table", "pagination": "pages", "pageSize": 20 }
      }
    }
  }
}
```

Example values written to `listFilters` and `listSort`:

```js
instance.state.setState("listFilters", [
  { field: "category", operator: "eq", value: "teaching" },
  { field: "status", operator: "ne", value: "archived" },
]);
instance.state.setState("listSort", { field: "updated_at", order: "desc" });
// Clear filters / sort:
instance.state.setState("listFilters", null);
instance.state.setState("listSort", null);
```

- **Selection:** Search, filter, sorting and paging preserve the selected object. Set `fallbackToFirst: false` and
  use `listed` for optional initial selection only if the page opened without one. Keep a specified missing or
  forbidden item selected and show the header's state. On a successful delete, the SDK uses `affected.removed`
  to invalidate bound forms and clear matching selection or checked state before refreshing the list. Base
  post-delete navigation on the operation outcome.
- A writable `state.selected` lets the list commit selection on click. For a selection that needs unsaved
  confirmation first, handle `@choose` and write the state after confirmation, as in the
  [split editor](../templates/list-detail-edit/README.md). For cross-type results the owner read must declare
  `rowType`, which supplies the type of the emitted references and the binding type for `state.selected`.

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

### `GroupedGrid`

Arranges `data.rows` (`panelRecordList`) into collapsible groups on a responsive CSS grid (`columns`, `rowHeight`,
`gap`), with optional parent `data.record` (`groupsField` to order groups and preserve empty groups), stacked section
tracks (`sectionField`, `sectionOrder`, per-section `rowHeight`), drag-and-drop reordering, pointer cell resizing
(`colSpanField`, `rowSpanField`), `selected` state, and per-item `rowActions`. Render each cell body through `#item`
(alongside `#item-header-actions`, `#group-header-actions`, `#group-empty`, `#empty`); `layout-change` fires only when
the reader finishes a drag or resize interaction. When declaring row operations on `GroupedGrid`, specify the row target
explicitly: `{ "type": "<rowType>", "operation": "<opId>", "target": "row" }`.

### `OperationResult`

Pure presentation component (`<operation-result :result="..." />`) for rendering the response of a read-only panel
operation: `markdown`, `json`, `file`, or multi-section `sections` (tabbed `records` tables, language-tagged `code`,
and `json` panes).

### `ObjectHeader`

Bind `data.record` to the selected object. `config.subtitleField` displays a single truncated line by default.
Attach named owner operations with `operations`, or use `#actions` for additional controls. The title and actions
render when the record is ready. For other states the header renders the owner status and reason in place.
Keep the header mounted when a specific selection is missing or forbidden.

Use `usePanelOutput("header", "status")` to gate dependent editors and actions. It returns the
[datum status](RUNTIME.md#projection-outputs-and-operations), or `null` before publication. The `label` and
`errorMessage` outputs and the named scalar values declared by the owner read in `record.outputs` are also available.
`ObjectHeader` publishes those owner outputs automatically, for example `usePanelOutput("header", "category")`.
The header's `@done` handler receives `(operation, outcome)`, where `operation` is the local name and
`outcome.kind === "success"` identifies successful single writes.

### `ObjectSummary`

Bind `target` and `data: { record: "record" }`. Configure `fields`, `copyableFields` and `showTitle: false`
when a header already shows the title. Its `label` output is `null` while no record is ready or readable.

### `OperationButton`

Bind an owner operation and its target. `config.labelKey` selects a localized label. With
`config.hideWhenUnavailable: true`, the button stays hidden while the owner has not admitted it or describes it as
unavailable. Let the owner decide that rule. For a batch, availability is evaluated per target through the owner
batch availability check or the owner's single-target check. A mixed selection stays actionable. Execution skips
unavailable rows and reports each `skipped` item and its reason. The button's `@done` receives the write
`OperationOutcome` directly, including the batch's per-item results. Check `outcome.kind` before updating the view.

Use `operationParams` to bind typed parameters such as a numeric revision or a requested status. Bind every
top-level `inputSchema` property you want to keep out of `OperationInputDialog`, including optional properties.
An optional state value of `null` is omitted from the request. For an object reference, watch the selection
and extract its `primaryKey` into scalar state for the binding. `page_action` uses the same bound values and
only accepts unbound interactive inputs. The owner operation enforces authorization and invariants on those values.

Put a checked-target batch button inside the list's `#batch-actions` slot. The list owns the dismissible receipt
outside that slot, so clearing the checks and unmounting the button keeps the receipt visible. Use `@done` for
page-specific follow-up; the built-in receipt carries the batch outcomes.

```json
{
  "component": "OperationButton",
  "operation": "orders.setStatus",
  "target": "checked",
  "operationParams": { "status": { "state": "batchStatus" } },
  "config": { "labelKey": "order.changeStatus", "hideWhenUnavailable": true }
}
```

For row actions, use `ObjectList.config.rowActions`. `OperationButton` does not accept a `{ fromSlot: true }` target.

For a multi-target platform operation declaring `targetTypes` (accepting multiple `platformTypes` and/or
`customerObjects`, such as unified `platform:Favorite` operations), declare the operation's owner `type` (e.g.
`"type": "platform:Favorite"`) alongside a `target` pointing to a state of any accepted object type.

For a read-only trial of a live form draft, bind a draft read operation and a public parameter object:

```json
{
  "component": "OperationButton",
  "type": "platform:MetricView",
  "operation": "metricViews.test",
  "draft": "definition",
  "parameters": { "state": "testParameters" }
}
```

```html
<projection slot="trial" :disabled="trialDisabled" @read="onTrialRead"></projection>
```

`@read` receives the `PanelReadOperationResult`. The trial reads current form values without saving them. Vue
placement props such as `disabled` are passed through when declared by the mounted component. Declare input
bindings for top-level members in the manifest. Reserve `:inputs` with `fromSlot` for projections instantiated in
repeated row slots. If a selection watcher resets trial state, consult `instance.state.lastPatchedKeys` to preserve fields set alongside the selection
by the same `present` call.

### `ObjectRefCard`

- Renders a clickable object reference card from `data.record` (`config.field` or the record itself) or `data.result`.
- Declares output `navigate` (bindable via `state: { navigate: "targetState" }` in addition to emitting `@navigate`).

### `MetricCard`, `ObjectCount`, `RecordTemplate`, `InfoBanner`, `TypedValue`

- **`InfoBanner`:** Use `<info-banner tone="warning" :text="t('page.notice')"></info-banner>` for a page message.
  A projection can instead bind a record or result and configure the displayed `field`, `template` and `toneField`.
- **`ObjectCount` & `MetricCard`:** Pure presentation — never compute sums or averages on the client. For paged queries
  (`panelRecordQuery`) and `panelOntologyObjects`, both display strictly the owner-returned `total` (never `rows.length`),
  showing `—` when unknown. Complete unpaged `panelRecordList` uses `rows.length`.
  Use `ObjectCount` with `appearance: "badge"` for compact counts and `omitWhenUnavailable` to hide an unknown count.
- **`RecordTemplate`:** Fills values from `data.record` or one row of `data.result` (`metricOutput`) into a fixed
  `{fieldKey}` template (`template`, `templateKey`, or `templates`, with per-field `fieldFormats` including `valueMap`).
- **Auto-refreshing metrics after writes:** When authoring a `MetricView` read by `MetricCard` / `RecordTemplate` /
  `MetricChart`, declare `sourceObjectTypes` on the MetricView definition so any write whose `affected.objectTypes`
  includes those types automatically refreshes the metric projection.

### `ReferencePicker`

Use a standalone inline picker in a toolbar with `type`, `data: { rows: "list" }` and
`state: { selected: "chosenReference" }`. The state is an object reference of the chosen type. On clear it becomes
`null`. Use `config.placeholderKey`, `clearable`, `filterable`, `size` and `groupBy` on a returned record field.
An unpaged read is filtered locally. For server search and pagination, bind a query read accepting the search and
paging parameters, or use `data.options` and its optional `data.selected` to resolve held values. Dropdown text
typed to find options stays local to the picker. In options mode, `InlineReferencePicker` respects the read's
`page` and `keyword` declarations and waits for a nonblank keyword when required. Its selected reference's
`className` comes from the projection's `objectType` for option results. Inside `<sdk-form-item>`, the picker
fills the available width. Use `ObjectList` with `state.checked` for multiple references outside a form.

### `FileUploadControl`

Bind the owner's upload operation to this projection and render the control where the user can choose a file.
If a centered `<sdk-dialog>` already explains the upload, omit `intro` and `rules` to avoid opening a second
instructions dialog. Set `overwriteOn` to the owner's overwrite refusal code when replacing a file is supported.
Listen for `@uploaded` to close the dialog or use the successful receipt. The user chooses and submits the
local file. An assistant can open the entry.

### `ObjectTree` and `ObjectTextReader`

Bind the parent's `files` read to `ObjectTree.data.files` and `state.selected` to a scalar `filePath`.
Use `config.pathField` if it differs from the key and `config.fallbackToFirst: true` for an unspecified initial path.
On the text reader bind the same parent target and a read such as
`data: { record: { read: "file", params: { path: { state: "filePath" } } } }`.
`config.textField: "content"` picks the text and `format: "auto"` infers Markdown (with optional YAML frontmatter
separation), CSV/TSV `table` preview, or read-only `code` from `pathField` / `record.label` / `record.primaryKey`;
pass `format: "plain" | "markdown" | "table" | "code" | "diff"` to override (`diff` parses standard unified diffs into
file summaries, per-file change cards, binary notices, and line-numbered hunks). Clicking a relative `.md` link in
Markdown writes the normalized path to `activePath`. An explicit unavailable file path stays selected and the reader
shows the owner's result. For long segmented texts use `data.sources` and `data.page` and let the reader request
subsequent pages.

### `AnnotatedCode`

Bind `data.content` to an owner read returning `annotatedCode`. Use the `currentCode` input to compare against
live code, for example from `form.draft` via the output binding above. Bind `state.activeSegmentId` to coordinate
line/segment focus. `@select-ref` emits the `refKey` string. Use it to select the matching child record or
object-internal position and activate the relevant tab in one public state update. Keep the other tabs mounted.
Read `status`, `activeSegmentId` and `selectedRef` as read-only outputs when needed.

### `ObjectGraph` and `OntologyGraph`

- **`ObjectGraph`**: displays nodes (`panelRecordList`) and edges (`panelRecordList`) with zoom, fit, relayout, PNG
  export, search highlighting (`highlightedNodes`, `highlightedEdges`), and directed shortest-path (`pathFrom`,
  `pathTo`) computed over the **visible nodes and edges currently loaded in the canvas**.
- **`OntologyGraph`**: renders type mode (`schema`/`counts`), sampled overview mode (`overview` and optional deferred
  `connections`, with group headings, aggregated inter-group edges, and version-conflict recovery), and paginated
  one-hop instance expansion (`neighbors` with `offset`, `limit`, `direction`, `targetClass`, `relationKinds`,
  `layers`), plus per-person saved `positions` (`json`) and `#toolbar` / `#overlay` slots.

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
  In the author type table, they live once at the top level under `operations` keyed uniquely by Action ID, with
  `target: { source: "none" }` and `affects: ["Order", ...]` for discovery and automatic post-write refresh.
  - `panel type <ObjectType>` directly lists top-level targetless Actions whose `affects` include `<ObjectType>` under
    `targetlessOperations` (annotated with `targetless: true` and `callTarget: null`); run `panel type --all` to inspect
    every top-level targetless Action (including ones that did not declare `affects`).
  - When an agent invokes one via `/operate`, it sends `call.target: null`.
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
2. **Action owner returns no new identity (`saved.primaryKey === null`):** Close/reset the create form or
   dialog and let `affected.objectTypes` (`affects`)
   auto-refresh sibling lists and metrics (both humans and agents follow the same behavior). If your flow requires
   "jump straight to the newly created record's detail page", have the Action owner return the created object identity in
   the capability layer.

### 4. Current capability boundaries (customer forms & targetless Actions)

Design your Actions and panel UX around these four current runtime boundaries:

1. **Restricted data-scope grants reject targetless creates (`ACTION_TARGET_OUT_OF_SCOPE`):** If a role is granted a
   targetless create Action only under a restricted data scope (rather than unrestricted scope), the owner rejects
   execution with `ACTION_TARGET_OUT_OF_SCOPE` for both humans and agents alike.
2. **Missing `affects` skips post-create auto-refresh:** If a create Action omits `affects` (the affected object types),
   lists and metrics for that class will **not** auto-refresh after creation. Always declare `affects` on create Actions.
3. **New identity comes from `created`:** A create owner returns `{ kind: "success", created: { objectType, primaryKey }, ... }`
   to identify the new object. The platform carries it in `operation.created`. `ObjectForm` emits `saved` with the
   corresponding `{ className, primaryKey }`, where `primaryKey` is `null` for success without a reported identity.
   Use that key for navigation. Plain result text and `affected.objects` carry no create identity contract.
4. **Clearing text fields sends `""` (not SQL `NULL`):** Current nullable text clearing submits `""` (empty string) and
   cannot yet distinguish database `NULL` from `""` on text attributes.

### 5. Cross-member write submitting a form draft (`draft`)

When a button or operation declared on **another** member submits a form member's current draft, explicitly specify
`draft: "<formMemberKey>"` in that member's operation binding (either top-level `draft` on `OperationButton` or inside
`operations.<name>.draft`), so the platform and agents know which form draft is being submitted.

## Custom list columns, row detail, and per-row operations

Use `ObjectList`'s built-in `config.rowActions` for per-row operation buttons and local buttons (dialog/navigation),
and standard Vue slots (`#cell-<key>`, `#cell`, `#actions`, `#row-detail`, `#card`, `#empty`) to customize a piece of
the list without replacing the whole table.

- **Action layout:** `rowActions.items` holds operations (`kind: "operation"`, `operation`) or local actions
  (`kind: "local"`, `id`, optional `to`). Items accept `labelKey` or `label`, `primary`, `danger`, `when`
  and `disabledWhen`. Conditions match owner fields against `equals`, `notEquals`, `in`, `notIn` or `truthy`.
  Operation items also accept `hideWhenUnavailable`. The action column accepts `labelKey` or `label`,
  `maxVisible` (overflow after two by default), `fixed: "right" | false`, `align`, `width` and `minWidth`.
- **Rowless slots & events:** `ObjectList` never passes raw `row` objects to panel slots or events.
  - `#cell-<columnKey>` and `#cell` receive `{ ref, index, column, value, displayText, tone, operations, runOperation }`
    — pass only `value` / `displayText` / `tone` to your display component; never read raw row record fields or calculate in the
    template.
  - `#actions` receives `{ ref, index, operations, runOperation }`.
  - `#row-detail` receives `{ ref, index, collapse }` — pass `:inputs="{ target: ref }"` to a nested projection whose
    `target` is `{ "fromSlot": true }`.
  - `#row-detail` expansion is internal to the list and is toggled by its row expansion control. Use a drawer or
    detail projection bound to public selection when the expanded editor must be reachable via an address or `present`.
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

Inspect the graph and relation data ports in the component reference and the named reads in `panel type`.
Declare a shared [graph selection type](RUNTIME.md#graph-selection) in `manifest.state`. `OntologyGraph` uses
`selected` as its selection port. To connect its selection and relation filters, write:

```json
{
  "graph": { "component": "OntologyGraph", "state": { "selected": "selected", "visibleRelationKinds": "relationKinds" } },
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

## Select a child record and read from its parent

Use the [child-object field and value shapes](RUNTIME.md#child-objects) for child selection, alongside a parent object
state for the parent's reads. Set the read member's `target` to the parent state and pass any required child/source
parameters through `data.<name>.params` (see [FIELDS.md](FIELDS.md)). To bind `ObjectList.state.selected` to a
`child-object` state, the parent type must declare the collection in `childCollections`, and the owner's read
must describe the child rows. Point a column at the owner's `kind: "child-reference"` field or array of such
references. `@navigate-child` emits the resolved `{ parent, collection, primaryKey }` reference and the column key. Update
the matching child selection or code segment and its tab together with `instance.state.setState`.

## Invoke declared owner operations

Prefer a mounted `OperationButton`. Bind the owner's full ID and the target object or checked list. If you draw
a custom button or menu, call `usePanelOperation(member, name, options?)` in synchronous setup. Use the same
availability and disabled conditions for the visible control and the hook, and put shared post-operation behavior
in `onSettled`. The mounted hook registers the action automatically, so a reader's click and `page_action` share
its target, confirmation and settlement. Pass `entry: false` for a background flow or to read a dialog operation before its button mounts.
For example, subscribe with `usePanelOperation("submit", "apply", { entry: false })`. When its `state.value.status`
is `"ready"`, read `state.value.value.apply?.unavailable?.reason` for the outer toolbar button. The dialog's
`OperationButton` is the entry registered for `page_action`.

```js
const { run, running, operation } = usePanelOperation("archive", "archive", {
  available: () => detailReady.value,
  disabled: () => saving.value,
  onSettled: (receipt) => {
    if (receipt.response?.outcome?.kind === "success") return goBack();
  },
});
```

Invoke `run()` from the button, use `!operation || saving || running` for its disabled state and show the button
only when `detailReady`. Setting a self-managed flag to `true` in the click handler before `run()` makes the click
a no-op if that same flag is passed as `options.busy`. Use the hook's returned `running` state to track its own run.
See [the operation receipt](RUNTIME.md#operation-ids-and-write-results).

For an assistant row action, pass `rowKey` in the exact `<ClassName>:<primaryKey>` format. Copy it verbatim from
the snapshot row and pass it to `page_action` with the declared operation ID.

## Save a form

An `ObjectForm` projection needs its own operation or a sibling write that binds its draft (inline
`draft: "form"` or formal `operationDrafts`). This also applies to a read-only form with
`config.actions: "none"`. For a form with its own save:
- For `platform:*` types, bind the type's declared `form.save` operation (for example `platform:AgentDefinition.save`).
- For customer ontology `ObjectType`s (such as `Student`, `Order`), bind a published write `Action`: an object-targeted
  `Action` for edit (`data: { form: "form" }`, `target: "<selectedState>"`) or a top-level targetless `Action`
  (`target: { source: "none" }`) for create (`data: { createForm: "createForm" }`), wiring parameter names with
  `{ "formField": "/pointer" }` or `{ "formFields": { ... } }` whenever they differ from form attribute names (see
  [Customer `ObjectType` forms and targetless Actions](#customer-objecttype-forms-and-targetless-actions)).

- **`config.actions`**:
  - `"footer"` (default): non-overlapping document-flow Save/Discard/Cancel bar at the bottom of the form.
  - `"create-only"`: Cancel/Create bar only in create mode (pair with `<page-header :draft="formDraft">` in edit mode).
  - `"none"`: omit the form's own bar in both modes (ideal on a dedicated detail entry with `<page-header :draft="formDraft">`).
- **`usePanelFormDraft("form")`**: wire directly into `<page-header :draft="formDraft">` for Save, Discard (with
  confirmation), busy state, and unsaved-changes notice — no manual submit boilerplate needed.
- **`config.fixedFields`**: fix parent-determined fields by JSON Pointer path (`{"state":"selected","path":"/primaryKey"}`
  or `{"literal":"..."}`) so they display read-only and submit with every save.
- `ObjectForm` automatically renders word counters for schema `maxLength` fields, password masking (`show-password`) for
  single-line `text` fields declaring `secret: true`, and disables cascading select fields
  when the owner declares `disabledWhenEmpty`.
- For separate dialogs editing different parts of one owner form, use `config.groups` with
  `unassignedFields: "omit"` on each form. Include only that dialog's fields and let the owner apply its
  `submittedFields`.
- Use either `:parent="activeClassParent" :exclude="['/rowPermission']"` on `<object-form-fields>` or pass
  absolute JSON pointers with `:fields` and omit `:parent`. The component ignores `:fields` when `:parent` is set.
- Call `refreshDraft()` through the form handle or `usePanelFormDraft` controls to refresh owner options,
  fields and errors while preserving a dirty draft and its baseline. A clean form adopts the new baseline.
- The `saved` event carries `{ className, primaryKey }`. On create the key comes from the successful operation's
  `outcome.created` and is `null` when no identity was returned. Use the SDK's save feedback and avoid a second
  success `panel.notify` from `@saved`.

### Secret input and delivery

The owner marks secret inputs with `secret: true`. `OperationInputDialog` uses a password field.
`PanelHost` shows one-time secrets through `SecretDeliveryDialog` for all write entries, including row actions
and `usePanelOperation` writes. Assistant observation hides plaintext. People enter and receive the secrets.

### Assistant live form filling and saving

Use `present` to open the target page, tab or dialog beside the conversation, then `fill_form` on the mounted
`ObjectForm`. Changed fields are marked and stay unsaved for review. When asked to save, use `page_action`
for the form's declared save, with conversation confirmation by default. When an agent's same-page `present` would switch a dirty form's target
or unmount it, the host returns `blocked_unsaved`. Unrelated state updates succeed while the dirty form stays
mounted on the same target. Human clicks go through the panel's unsaved confirmation.

To split one form across sections, configure `presentation` and `groups` or place `<object-form-fields>` in
the form's default slot. The sections share the same draft and save. A form's `saved` event gives
`{ className, primaryKey }`; a successful create can report `primaryKey: null`.

## Availability, narrow containers, and projections

Use `v-if` to unmount a closed editor or an unavailable action. Where the component declares `when` or
`disabledWhen`, use them for current availability, so the same entry is gated for humans and assistants.
Use `v-show` for another tab of the same object, a collapsed section, or a list behind a detail view, preserving
the forms and list interaction. Keep a named `#actions` slot declared and put conditional content inside it.

Measure a container with `const root = ref(null); const narrow = usePanelNarrow(root)` and put `ref="root"`
on the layout element. The hook reads `--pane-narrow-breakpoint` by default, or an explicit `{ token }`.
Use the result to open the selected detail directly beside a conversation, and CSS `@container` for layout.
Route local Back or dialog close through `usePanelBack`. Leave `<sdk-dialog>` Escape handling enabled and
call the guarded `back()` from the dialog model's close setter.

`<projection>` provides a `.sdk-panel-member` wrapper and may render a brief loading state as its component
mounts. Constrain the wrapper in tight slots. For an app-menu badge, scope
`.menu-count:not(:has(.sdk-object-count)) { display: none; }` to the trailing projection to suppress placeholders and
empty spacing. Use `v-if` inside the visible menu item's slot so hidden or unauthorized entries do not mount readers.

## Offline check and component reference

The installed release includes `docs/components.md` (the component docs), `components.json` (the catalogue) and
`docs/reference.md` (the `@ontomato/sdk` API reference). Open those files directly offline. Online, use
`node "$SKILL/scripts/ontomato.mjs" sdk read docs/components.md` or `sdk read docs/reference.md`.

Save the author type table with `node "$SKILL/scripts/ontomato.mjs" panel type --all > type-table.json`.
With the installed SDK release matching the intended deployment, run:

```sh
node "$SKILL/scripts/panel-check.mjs" ./my-panel --sdk-dir "$SDK_RELEASE" --type-table ./type-table.json
```

`SDK_RELEASE` is the directory containing `sdk.json`. The command uses the installed check module and
component catalogue, reports unchecked references, and needs no running service. Use the online
`ontomato.mjs panel check` for already-registered references that need server lookup.

### Metric charts and single-member refresh

For a calculated MetricView chart from an existing dashboard card, declare `component: "MetricChart"` and
`sourceCard: { dashboardId, cardId }`, and connect its inputs in `state` (if unregistered, `panel check` lists it in
`unchecked` and `panel register` asks the card owner to register it and writes the projection ID). `MetricChart` also
supports binding its data directly without `sourceCard` when rendering a standalone or preview chart. To refresh a
single mounted projection in place (for example one dashboard card) without reloading the whole panel, attach a Vue
template `ref` to `<projection slot="...">` and call `memberRef.value?.refresh()`.

## Open the page composer and inline conversation entries

Conversation shell chrome (history list, message stream, dockable page area) belongs to the platform shell rather than
an application panel — do not build a custom chat page inside a panel, and do not import `@ontomato/sdk/chat` in
`panel.mjs` (direct panels allow only `vue` and `@ontomato/sdk/panel`; `AgentShell` is platform-host only and cannot
be placed as a panel projection). Place an `AgentChat` projection member when a panel embeds a live conversation with a
declared agent (pairing with `"pageComposer": "none"` on that entry), or place `ConversationEntry` to hand off to the
platform conversation shell.

- **Button entry (`presentation="button"`, default):** Add a `ConversationEntry` projection when the page needs a button
  that opens the composer with a specific agent (`agent: "page-default"`, `{ "kind": "id", "id": "<agentId>" }`, or
  `{ "kind": "preset", "agentKind": "<kind>" }`) and an optional opening line (`prefill` or multi-locale `prefillKey`
  in `content.messages`). The reader still sends the message.
- **Inline composer (`presentation="inline"`):** When a page itself serves as a conversation entry (such as a workspace
  home), place a `ConversationEntry` member pointing to the target agent with `presentation="inline"` (supporting
  `placeholderKey`, `minLines`, `agentPickerVariant`, `attachPage`, and `@sent`) and set `"pageComposer": "none"` on
  that entry in `panelUses` so the host hides the bottom floating composer. While mounted, the inline
  `ConversationEntry` also serves sibling `ConversationEntry` buttons on the same page; submitting enters the platform
  conversation shell with that agent.

```json
// panel.json (manifest.members)
{
  "askAssistant": {
    "component": "ConversationEntry",
    "agent": { "kind": "id", "id": "<agent-uuid>" },
    "prefillKey": "chat.opening"
  }
}
```

```html
<!-- panel.html -->
<projection slot="askAssistant" presentation="inline" placeholder-key="chat.placeholder" :min-lines="3"></projection>
```

```json
// registration.json (applications[].input.panelUses[] entry)
{
  "id": "home",
  "pageKey": "home",
  "panelId": "<panel-id>",
  "path": "/applications/app-my-app/home",
  "pageComposer": "none",
  "access": { "kind": "domain-member" },
  "names": { "en": "Home", "zh-CN": "首页" }
}
```

## Register and open

Write each new projection inline in `manifest.members`, run `panel check <directory>`, then `panel register <directory>`.
Registration writes each new projection's UUID into `panel.json` as `id` (keep it on future edits). Use
`target.projectionId` to reuse an existing projection.

- Application IDs start with `app-`, and paths start with `/applications/<application-id>/`.
- Give every `panelUse` a domain-unique `pageKey`. Include `names` for menu entries; omit `names` for detail entries
  opened only via navigation or deep links. Optional per-entry `icon` uses any key from `sdk icons`, and optional
  `pageComposer: "none"` suppresses the host's bottom floating composer (defaults to `"bottom"`).
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
