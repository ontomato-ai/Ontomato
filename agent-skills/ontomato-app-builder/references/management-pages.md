# Start a management page

Pick the matching layout from the [page templates](templates/README.md).

- **Recommended (two entries):** [two-entry-catalog-detail](templates/two-entry-catalog-detail/README.md) — a menu
  catalog entry (`ObjectList` + `<page-header>` + centered `<sdk-dialog>` create) that navigates on row click to a
  non-menu detail entry (single-row `<page-header :draft="formDraft">` + two-column `@container` cards).
- **Single-panel starter:** [catalog-detail-dialog](templates/catalog-detail-dialog/README.md) or generate one directly
  with `panel scaffold`.

```sh
template="$SKILL/references/templates/catalog-detail-dialog"
node "$SKILL/scripts/ontomato.mjs" panel check "$template"
node "$SKILL/scripts/ontomato.mjs" panel register "$template"
```

Open `/applications/app-template-catalog-detail/manage`. Clicking a row opens the full-width detail view with a
`<page-header>` (`← Back | <Title> | [Delete] [Discard] [Save]`) wired to `usePanelFormDraft("form")`. Clicking
`+ New …` sets `creating: true, selected: null` and opens the centered `<sdk-dialog>` hosting `ObjectForm`
(`config.actions: "create-only"`).

Generate a single-panel starter for any type from the type table:

```sh
node "$SKILL/scripts/ontomato.mjs" panel scaffold platform:AgentDefinition ./agents-panel --id app-my-agent-management
```

The starter writes `panel.html`, `panel.mjs`, `panel.json`, and `registration.json` using the `catalog-detail-dialog`
structure. Review the generated application entry, columns, and access before registration. Use
`panel type <type-id>` to inspect reads and operations (for customer ontology classes, `panel type <class>` lists the
platform's generic read functions parameterized by class — list / get one — plus any published Actions).

Use `--operation <owner operation ID>` to add a single-record `OperationButton` inside the detail `<page-header #actions>`
and `--batch <owner operation ID>` for a toolbar button targeting checked rows. Repeat either flag to add more buttons.

## Effect and wiring

| Effect | What to write |
| --- | --- |
| Search this list | Set `data.rows` to a read with a `search` parameter. The list shows the search field and supplies the value at runtime. |
| Share the search keyword or put it in the address | Connect `state.search` to a scalar panel state (`deepLink: true`). Reuse the same state on other members whose reads take `search`. |
| Status tabs with counts | Use `SegmentedControl` with `data.counts` and `state.value` connected to status. Connect `state.status` on the list. |
| Pagination | Use a paginated read for `ObjectList.data.rows`; set `config.pageSize` if needed. |
| Two-entry catalog → detail *(recommended)* | Keep the catalog entry in the menu (`names` set) and omit `names` on the detail entry. On `@choose` in the catalog, encode `?state=` with `URLSearchParams` and call `navigate(detailAddress)`. In the detail panel, place `<page-header :title="selectedTitle" :back-label="..." :draft="formDraft" @back="goBack">` (`goBack` calls `navigate(CATALOG_PATH)`). |
| Single-panel catalog → detail | Toggle `v-if="!selectedKey"` between catalog and detail; wire `usePanelFormDraft("form")` into `<page-header :draft="formDraft">` and `usePanelBack` for Back/Escape unsaved-changes confirmation. |
| New in centered dialog, edit in `<page-header>` | Set `ObjectForm` `config.actions: "create-only"` (or `"none"` on a dedicated detail entry). Mount `<projection slot="form">` in the detail card (saved via `usePanelFormDraft`) and inside a centered `<sdk-dialog v-model="createDialog">` when creating. |
| Single operation in `<page-header>` | Declare an `OperationButton` member (`operation`, `target: "selected"`, optional `config: { label: "Delete", type: "danger", plain: true, icon: "trash" }`) and place `<projection slot="remove">` directly inside `<page-header #actions>`. |
| Batch operation | Connect the list's `state.checked` and the button's `target` to the same list of object references on a batch-capable operation. |
| Detail header inside split/card views | Use `ObjectHeader` with `target: "selected"`, `data.record`, and declared `operations`. Pair it with `ObjectSummary` (`config.showTitle: false`, optional `config.copyableFields`). |
| Highlight search hits | Connect `state.search` on the detail when its record read declares `search`. |
| Carry state in the address | Mark state fields to restore with `deepLink: true` in `manifest.state`. |

Write the Vue template inside `<div id="app">` in `panel.html`, placing each member with `<projection slot="name">`.
Write layout in normal HTML, CSS, and Vue (no layout components) using platform design tokens (`--page-gutter`,
`--page-content-gap`, `--spacing-*`, `--sdk-border-color`) and CSS `@container` for responsive layouts. In `panel.mjs`,
call `mountPanel` with `usePanelContext`, `usePanelFormDraft`, `draftTarget`, and (when needed) `usePanelBack`. Put
assistant guidance in `recipes.md`.
