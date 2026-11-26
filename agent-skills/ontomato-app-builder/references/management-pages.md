# Start a management page

Pick the matching layout from the [page templates](templates/README.md).

- Use a [two-entry catalog and detail](templates/two-entry-catalog-detail/README.md) for a multi-column catalog.
- Use a [list and detail editor](templates/list-detail-edit/README.md) when the list stays beside the editor.
- Use a [table and modal editor](templates/table-inline-modal-edit/README.md) for inline row operations and a tabbed editor.
- Use an [application frame](templates/app-frame/README.md) for a value shared across entries.

Generate a catalog and detail pair from the type table:

```sh
node "$SKILL/scripts/ontomato.mjs" panel scaffold platform:AgentDefinition ./agents-panel --id app-my-agent-management
```

The application root has `application.json`, separate catalog and detail directories in `panels/`, and their definitions in `projections/`.
Run `panel check ./agents-panel` and review the owner reads, columns and access in the candidate.
After publishing through Application Builder, open the catalog at the path returned in `entry`.
Use `panel type <type-id>` to inspect reads and operations:
- For customer ontology classes (e.g., `Student`, `Order`), `panel type <class>` lists the platform's generic reads
  (`query`, `record`, `form`, `createForm`), object-targeted Actions, and top-level targetless Actions whose `affects`
  include `<class>` (under `targetlessOperations`, with `target: { source: "none" }` and `callTarget: null`). Run
  `panel type --all` to inspect all top-level targetless Actions (including ones that did not declare `affects`).
- For `platform:*` types (e.g., `platform:Relationship`, `platform:Application`), it lists built-in platform reads and
  operations.

Use `--operation <owner operation ID>` to add a single-record `OperationButton` inside the detail `<page-header #actions>`
and `--batch <owner operation ID>` for a toolbar button targeting checked rows. Repeat either flag to add more buttons.

## Effect and wiring

| Effect | What to write |
| --- | --- |
| Search this list | Set `data.rows` to a read with a `search` parameter (server search), or bind `state.search` / `searchable: true` on a complete unpaged `panelRecordList` (local text search). |
| Share the search keyword or put it in the address | Connect `state.search` to a scalar panel state (`deepLink: true`). Reuse the same state on other members whose reads take `search`. |
| Status tabs with counts | Use `SegmentedControl` with `data.counts` and `state.value` connected to status. Connect `state.status` on the list. |
| List counts in headers/toolbars | Read `usePanelOutput("list", "total")` (strictly owner-reported total, `null` when unknown — never fake as `0` or `rows.length`), `loadedCount` (current batch/page rows), or `filteredCount` (local match count on complete unpaged lists only). |
| Pagination | Use a paginated read (`panelRecordQuery`) for `ObjectList.data.rows`; set `config.pageSize` and `config.pagination` (`"pages"` or `"cursor"`) if needed. |
| Server field filters & sort on customer classes | Declare `json` public state(s) (`default: null`) and bind `data.rows: { read: "query", params: { filters: { state: "listFilters" }, sort: { state: "listSort" } } }` (`filters` is `[{ field, operator, value? }]` AND-ed; `sort` is `{ field, order: "asc" \| "desc" }`; executed across the whole class before counting `total` and paging). Put filter/sort controls in `#filters` and clear on `@clear-filters`. |
| Tab strip, dynamic columns, or CSV export | On `ObjectList`, use `config.layout: "tabs"` (with `#tabs-extra`) for a horizontal tab strip; set `dynamicColumns: true` to derive columns from owner `fieldLabels`/`fields`, `showColumnToggle: true` for column visibility, and `exportable: true` for current-page CSV export. |
| Grouped draggable grid (e.g. dashboard cards) | Use `GroupedGrid` with `data.rows` (and optional parent `data.record` + `groupsField`), `#item` slot, explicit `{ type, operation, target: "row" }` for row actions, and `<projection ref>.refresh()` to refresh a single child member in place. |
| Inline conversation entry page | Place a `ConversationEntry` projection with `presentation="inline"` and set `"pageComposer": "none"` on that entry in `panelUses` to hide the bottom floating composer. |
| Full-width catalog → detail | Keep the catalog entry in the menu (`names` set) and omit `names` on the detail entry. On `@choose` in the catalog, build the flat URL with `panelAddress(DETAIL_PATH, { selected: item.primaryKey })` from `@ontomato/sdk/panel` and call `navigate(address)`. In the detail panel, place `<page-header :title="..." :back-label="..." :draft="formDraft" @back="goBack">` (`goBack` calls `navigate(CATALOG_PATH)`). The host retains catalog state and refreshes the list on return. |
| New in centered dialog, edit in `<page-header>` | Declare `creating` in `manifest.state` **without** `deepLink: true`. Open a centered `<sdk-dialog>` from the catalog header’s primary New button. Mount `createForm` with `v-if`, required fields only and `config.actions: "create-only"`. On `@saved`, close the dialog and navigate to detail using the owner-reported key when present. Wire the separate edit form to `usePanelFormDraft` for header actions. |
| Pick items to add in a modal dialog | Use `PickerDialog` with `data.options` (`panelOptionList`) or `data.rows` (`panelRecordList` / `panelRecordQuery`), and bind `state.open` (boolean, `deepLink: false`) and `state.selected` (string list, `deepLink: false`). Search adapts automatically (local when complete, owner `keyword`/`search` when truncated). On `@confirm`, invoke a registered panel operation whose parameter reads from `selected`, or write into the form field; put extra controls in `#extra`. See [controls and guardrails](panel-authoring/recipes/controls-and-guardrails.md#pick-items-to-add-with-pickerdialog). |
| Customer class edit & create forms | Bind `data: { form: "form" }` + an object-targeted write `Action` for edit (not just `form.save`; use `{ formField: "/ptr" }` / `{ formFields: { k: "/ptr" } }` when parameter names differ; unmapped attributes become read-only). Bind `data: { createForm: "createForm" }` + a targetless `Action` (`target: { source: "none" }`) for create. Review the 4 current runtime boundaries (restricted-scope `ACTION_TARGET_OUT_OF_SCOPE`, required `affects` for auto-refresh, `affected.objects: []` on targetless Actions, text clear submits `""`) in [customer ObjectType forms & Actions](panel-authoring/recipes/customer-object-forms-and-actions.md). |
| Single operation in `<page-header>` | Declare an `OperationButton` member (`operation`, `target: "selected"`, optional `config: { label: "Delete", type: "danger", plain: true, icon: "trash", hideWhenUnavailable: true }`) and place `<projection slot="remove">` directly inside `<page-header #actions>`. |
| Batch operation | Run `panel type <type-id>` to confirm the owner operation declares `batch: true`. Connect the list's `state.checked` and the button's `target` to the same list of object references. Put the button in `#batch-actions` so the list retains the dismissible receipt after the checks clear. |
| Detail header inside split/card views | Use `ObjectHeader` with `target: "selected"`, `data.record`, and declared `operations`. Read `usePanelOutput("header", "label" \| "status" \| "errorMessage")` and any owner-declared scalar outputs. Pair with `ObjectSummary` (`config.showTitle: false`, optional `config.copyableFields`). |
| Multi-metric KPI or sentence display | Bind `MetricCard` or `RecordTemplate` to a `platform:MetricView` (`data.result`) — owner provides numbers, component fills fixed `{field}` templates (`RecordTemplate`) or exact-match `valueMap`. Declare `sourceObjectTypes` on the metric so writes auto-refresh it. |
| Carry view state in the address | Mark **only** view-restoration state (`selected`, `tab`, `search`, `filter`, `sort`) with `deepLink: true` in `manifest.state`. Never mark dialog toggles or active-edit trackers as `deepLink: true`. |

Write the Vue template inside `<div id="app">` in `panel.html`, placing each member with `<projection slot="name">`.
Write layout in normal HTML, CSS, and Vue (or `<two-pane-layout>` for master-detail split panes) using platform design tokens (`--page-gutter`,
`--page-content-gap`, `--spacing-*`, `--sdk-border-color`) and CSS `@container` for responsive layouts. In `panel.mjs`,
call `mountPanel` with `usePanelContext`, `usePanelFormDraft`, and (when needed) `usePanelBack`. Put
assistant guidance in `recipes.md`.

Keep an explicitly selected object in place on missing or forbidden reads. Keep selection through list search,
filters, sort and paging. Close a dirty form through the panel's confirmation first. See
[availability and narrow containers](panel-authoring/recipes/availability-and-narrow-containers.md)
and [projection outputs](panel-authoring/recipes/projection-outputs.md) (plus `sdk read docs/components/<Name>.md`).

## Guard a form dialog

Bind the declared open state one way. The same Back layer handles Cancel and close requests. The form's
`@saved` handler can close immediately after success. Use `config.actions: "none"` when the footer owns Save.

```js
const draft = usePanelFormDraft("form");
const dialogBack = usePanelBack(() => dialogOpen.value, closeDialog, { forms: "form" });
async function beforeClose(done) {
  if (await dialogBack.back()) done();
}
const cancel = () => dialogBack.back();
```

```html
<sdk-dialog :model-value="dialogOpen" :before-close="beforeClose">
  <projection v-if="dialogOpen" slot="form" @saved="closeDialog"></projection>
  <template #footer>
    <sdk-button @click="cancel">{{ t('action.cancel') }}</sdk-button>
    <sdk-button type="primary" :disabled="!draft?.canSave" :loading="draft?.saving" @click="draft?.save()">
      {{ t('action.save') }}
    </sdk-button>
  </template>
</sdk-dialog>
```

To edit separate subsets of one owner form in different dialogs, configure each form's `groups` with its
field pointers and set `unassignedFields: "omit"`. The owner applies the subset in `submittedFields`.

## Reuse a catalog and detail across applications

Declare `detailPath` on the catalog and `catalogPath` on the detail as scalar string states with
`external: true` and default paths. Read these states when navigating. Each application's `panelUse.inputs`
can wire a sibling path, for example `{ detailPath: { literal: "/applications/app-examples/detail" } }`.
The host removes wired inputs from the URL.

- To offer conversational creation, place a `ConversationEntry` in the catalog header and teach the
  assistant to `present` the detail entry with `creating: true`. The detail panel declares `creating`
  as public state with `deepLink: false`.
- For a detail page with `detailMode` defaulting to `"view"` and `deepLink: false`, open the created object
  with `navigate(panelAddress(detailPath, { selected: primaryKey }))` using the owner-reported key. The destination
  starts in its default view mode. Keep the navigation state in declared inputs rather than in `sessionStorage`.
- Use `ObjectList` with `showHeader: false`, `fallbackToFirst: true` and `#cell-path` for a selectable
  hierarchy of object references. Use `ObjectTree` for an owner's `files` read and scalar file-path selection.
