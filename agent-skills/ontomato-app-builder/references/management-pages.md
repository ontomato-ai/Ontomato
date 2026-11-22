# Start a management page

Pick the matching layout from the [page templates](templates/README.md). For a full-width catalog table that opens
full-width detail on row click with a centered create dialog, start from the
[catalog-detail-dialog template](templates/catalog-detail-dialog/README.md) (derived from the verified Ontology
Relations page) or generate a starter with `panel scaffold`.

```sh
template="$SKILL/references/templates/catalog-detail-dialog"
node "$SKILL/ontomato.mjs" panel check "$template"
node "$SKILL/ontomato.mjs" panel register "$template"
```

Open the template's application entry at `/applications/app-template-catalog-detail/manage`. Click a row to open its
full-width detail view (where `usePanelDetailHeader` replaces the catalog header with `← Back | <Title> | [Save]`).
The header's primary **+ New** command (`manifest.commands.create` with `icon: "plus"`) sets public state
`creating: true, selected: null` (automatically disabling itself while open) and opens the centered create `<sdk-dialog>`.
After a successful create, `onSaved` selects the object returned by the owner and opens its detail view.

Start your own page by choosing the registered platform type and your intended application ID:

```sh
node "$SKILL/ontomato.mjs" panel scaffold platform:AgentDefinition ./agents-panel --id app-my-agent-management
```

The starter writes `panel.html`, `panel.mjs`, `panel.json` and `registration.json` into a new directory using the
`catalog-detail-dialog` template structure. It reads owner declarations from the platform's type table. Review the
generated application entry, columns, and access before registration. Use `panel type <type-id>` to inspect the same
reads and operations.

Use `--operation <owner operation ID>` for a single-record button placed in the detail header (`placement: "header"`)
and `--batch <owner operation ID>` for a toolbar button targeting checked rows. Repeat either flag to add more buttons.
When an operation needs additional required inputs, connect the form or supply those values in Vue. The starter includes
an owner save when the type declares both the form read and a `form.save` operation.

## Effect and wiring

| Effect | What to write |
| --- | --- |
| Search this list | Set `data.rows` to a read with a `search` parameter. The list shows the search field and supplies the value at runtime. |
| Share the search keyword or put it in the address | Connect `state.search` to a scalar panel state. Use the same connection on other members whose reads need it. |
| Status tabs with counts | Use a `SegmentedControl` with `data.counts` and `state.value` connected to status. Connect `state.status` on the list. Counts and rows can share the search state. The owner supplies the ordered `[{key, label, count}]` options. |
| Pagination | Use an owner read with pagination parameters. The list supplies the values at runtime, with `config.pageSize` for a different page size. |
| Full-width catalog → full-width detail | Hide the catalog (`v-if="!selectedKey"`) when `selected` is set, call `usePanelDetailHeader` for a single platform header (`backLabel`, `title`, `onBack`, `actions`), and wire `usePanelBack(() => Boolean(selectedKey.value), backToCatalog, { pushHistory: true })`. |
| New in centered dialog, edit in detail header | Set `ObjectForm` `config.actions: "create-only"` with `data.form`, `data.createForm`, and `operation`. Declare `creating` (`deepLink: true`) and a primary `manifest.commands.create` (`icon: "plus"`, `do.set: { creating: true, selected: null }`). Mount `<projection slot="form">` in the detail card (saved via `usePanelDetailHeader` calling `instance.forms.submit("form")`) and inside a centered `<sdk-dialog v-model="createDialog">` when `creating && !selectedKey`. |
| Single operation in detail header | Set `component: "OperationButton"`, `operation`, `target: "selected"`, and `config: { placement: "header", type: "danger", plain: true, icon: "trash" }` (for destructive delete). Keep `<projection slot="...">` mounted in `.detail-header-op-host` so confirmation dialogs and error feedback stay active. |
| Batch operation | Connect the list's `state.checked` and the button's `target` to the same list of object references. Use an owner operation that supports batch execution. |
| Detail header inside split/card views | Use `ObjectHeader` with `target` bound to `selected`, `data.record`, and declared `operations`. Pair it with `ObjectSummary` (`config.showTitle: false`) when showing fields beneath the header. |
| Highlight search hits | Connect `state.search` on the detail when its record read declares `search`. The owner returns highlight ranges that `ObjectList` and `ObjectSummary` render. |
| Carry state in the address | Mark the state fields to restore with `deepLink: true` in the manifest. |

For server-side paging, choose a paginated read from `panel type` for the `ObjectList.rows` datum and let
the list supply the paging inputs. See the [generated paging configuration](panel-authoring/RUNTIME.md#list-paging).

Use a read object `{read, params}` for explicit state or literal bindings. Components supply their own runtime
parameters. For example, `ObjectForm` supplies `values` and `changedField` to the owner form read, shows word counters
automatically for schema `maxLength` fields, and disables cascading select controls when the owner declares
`disabledWhenEmpty`.

Write the Vue template inside `<div id="app">` in `panel.html`, and place each member with `<projection slot="name"></projection>`.
Write layout in normal HTML, CSS, and Vue (not layout components) using platform design tokens (`--page-gutter`,
`--page-content-gap`, `--spacing-*`, `--sdk-border-color`), reserving bottom scroll room (`calc(var(--page-content-gap) + 56px)`)
for the floating page composer and without CSS viewport units. In `panel.mjs`, call `mountPanel` and use `usePanelContext`,
`usePanelDetailHeader`, `usePanelBack`, and `usePanelNarrow` (or CSS `@container`) for container-width responsiveness.
Put page instructions in `recipes.md`.
