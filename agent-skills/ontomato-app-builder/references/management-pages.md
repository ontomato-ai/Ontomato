# Start a management page

Pick the matching layout from the [page templates](templates/README.md).

- Use a [two-entry catalog and detail](templates/two-entry-catalog-detail/README.md) for a multi-column catalog.
- Use a [list and detail editor](templates/list-detail-edit/README.md) when the list stays beside the editor.
- Use a [table and modal editor](templates/table-inline-modal-edit/README.md) for inline row operations and a tabbed editor.
- Use an [application frame](templates/app-frame/README.md) for a value shared across entries.
- Use the [single-panel catalog](templates/catalog-detail-dialog/README.md) for a compact starter.

```sh
template="$SKILL/references/templates/catalog-detail-dialog"
node "$SKILL/scripts/ontomato.mjs" panel check "$template"
node "$SKILL/scripts/ontomato.mjs" panel register "$template"
```

Open `/applications/app-template-catalog-detail/manage`. Clicking a row opens the full-width detail view with a
`<page-header>` with Back, title, Discard and Save wired to `usePanelFormDraft("form")`. Clicking
`+ New …` sets `creating: true` and opens the centered `<sdk-dialog>` hosting `ObjectForm`
(`config.actions: "create-only"`). Notice that `creating` is public state **without** `deepLink: true`.

Generate a single-panel starter for any type from the type table:

```sh
node "$SKILL/scripts/ontomato.mjs" panel scaffold platform:AgentDefinition ./agents-panel --id app-my-agent-management
```

The starter writes `panel.html`, `panel.mjs`, `panel.json`, and `registration.json` using the `catalog-detail-dialog`
structure. Review the generated application entry, columns, and access before registration. Use
`panel type <type-id>` to inspect reads and operations:
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
| Two-entry catalog → detail *(recommended)* | Keep the catalog entry in the menu (`names` set) and omit `names` on the detail entry. On `@choose` in the catalog, build the flat URL with `panelAddress(DETAIL_PATH, { selected: item.primaryKey })` from `@ontomato/sdk/panel` and call `navigate(address)`. In the detail panel, place `<page-header :title="..." :back-label="..." :draft="formDraft" @back="goBack">` (`goBack` calls `navigate(CATALOG_PATH)`). |
| Single-panel catalog → detail | Toggle `v-show` on the catalog when the detail is in front; wire `usePanelFormDraft("form")` into `<page-header :draft="formDraft">` and `usePanelBack` for Back/Escape unsaved-changes confirmation. |
| New in centered dialog, edit in `<page-header>` | Declare `creating` in `manifest.state` **without** `deepLink: true`. Mount `createForm` inside the dialog with `v-if` and `config.actions: "create-only"`. Mount the detail form separately, using `usePanelFormDraft` for header actions. |
| Customer class edit & create forms | Bind `data: { form: "form" }` + an object-targeted write `Action` for edit (not just `form.save`; use `{ formField: "/ptr" }` / `{ formFields: { k: "/ptr" } }` when parameter names differ; unmapped attributes become read-only). Bind `data: { createForm: "createForm" }` + a targetless `Action` (`target: { source: "none" }`) for create. Review the 4 current runtime boundaries (restricted-scope `ACTION_TARGET_OUT_OF_SCOPE`, required `affects` for auto-refresh, `affected.objects: []` on targetless Actions, text clear submits `""`) in [CODE.md](panel-authoring/CODE.md#customer-objecttype-forms-and-targetless-actions). |
| Single operation in `<page-header>` | Declare an `OperationButton` member (`operation`, `target: "selected"`, optional `config: { label: "Delete", type: "danger", plain: true, icon: "trash", hideWhenUnavailable: true }`) and place `<projection slot="remove">` directly inside `<page-header #actions>`. |
| Batch operation | Connect the list's `state.checked` and the button's `target` to the same list of object references on a batch-capable operation. Put the button in `#batch-actions` so the list retains the dismissible receipt after the checks clear. |
| Detail header inside split/card views | Use `ObjectHeader` with `target: "selected"`, `data.record`, and declared `operations`. Read `usePanelOutput("header", "label" \| "status" \| "errorMessage")` and any owner-declared scalar outputs. Pair with `ObjectSummary` (`config.showTitle: false`, optional `config.copyableFields`). |
| Multi-metric KPI or sentence display | Bind `MetricCard` or `RecordTemplate` to a `platform:MetricView` (`data.result`) — owner provides numbers, component fills fixed `{field}` templates (`RecordTemplate`) or exact-match `valueMap`. Declare `sourceObjectTypes` on the metric so writes auto-refresh it. |
| Carry view state in the address | Mark **only** view-restoration state (`selected`, `tab`, `search`, `filter`, `sort`) with `deepLink: true` in `manifest.state`. Never mark dialog toggles or active-edit trackers as `deepLink: true`. |

Write the Vue template inside `<div id="app">` in `panel.html`, placing each member with `<projection slot="name">`.
Write layout in normal HTML, CSS, and Vue (no layout components) using platform design tokens (`--page-gutter`,
`--page-content-gap`, `--spacing-*`, `--sdk-border-color`) and CSS `@container` for responsive layouts. In `panel.mjs`,
call `mountPanel` with `usePanelContext`, `usePanelFormDraft`, and (when needed) `usePanelBack`. Put
assistant guidance in `recipes.md`.

Keep an explicitly selected object in place on missing or forbidden reads. Keep selection through list search,
filters, sort and paging. Close a dirty form through the panel's confirmation first. See
[availability and narrow containers](panel-authoring/CODE.md#availability-narrow-containers-and-projections)
and the [component contracts](panel-authoring/CODE.md#read-only-projection-outputs-and-official-component-reference).
