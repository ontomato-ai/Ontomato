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

Both `catalog/` and `detail/` contain `panel.html`, `panel.mjs`, `panel.json` and `registration.json`.
Check both, then register `catalog/` before `detail/`: the detail registration creates the application with
both entries. Open the catalog at the path returned in `entry`. Review the owner reads, columns and access
before registration. Use `panel type <type-id>` to inspect reads and operations:
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
| Full-width catalog → detail | Keep the catalog entry in the menu (`names` set) and omit `names` on the detail entry. On `@choose` in the catalog, build the flat URL with `panelAddress(DETAIL_PATH, { selected: item.primaryKey })` from `@ontomato/sdk/panel` and call `navigate(address)`. In the detail panel, place `<page-header :title="..." :back-label="..." :draft="formDraft" @back="goBack">` (`goBack` calls `navigate(CATALOG_PATH)`). The host retains catalog state and refreshes the list on return. |
| New in centered dialog, edit in `<page-header>` | Declare `creating` in `manifest.state` **without** `deepLink: true`. Open a centered `<sdk-dialog>` from the catalog header’s primary New button. Mount `createForm` with `v-if`, required fields only and `config.actions: "create-only"`. On `@saved`, close the dialog and navigate to detail using the owner-reported key when present. Wire the separate edit form to `usePanelFormDraft` for header actions. |
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
