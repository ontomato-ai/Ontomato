# Two-entry catalog → single-row `<page-header>` detail + centered create dialog

Recommended pattern for multi-column catalog + detail management applications:

- **Menu entry (`catalog/`)**: appears in the application menu (`names` set on the `panelUse`). Renders a `<page-header>`
  with a primary `+ New …` button, a full-width `ObjectList` whose row click (`@choose`) navigates to the detail entry
  with `?state={"selected":...}`, and a centered `<sdk-dialog>` hosting `ObjectForm` (`createForm`, `config.actions: "create-only"`).
- **Detail entry (`detail/`)**: omitted from the menu (`names` omitted on the `panelUse`), opened via
  `navigate(`${DETAIL_PATH}?${new URLSearchParams({ state: JSON.stringify({ selected }) })}`)` or a direct deep link.
  Renders a single-row `<page-header>` (`← Back | <Title> | [Delete] [Discard] [Save]`) wired to
  `usePanelFormDraft("form")`, plus equal-height cards in a two-column `@container` grid that collapses to one column
  below `850px`. Routing back via `navigate(CATALOG_PATH)` automatically invokes the platform's unified unsaved-changes
  confirmation.

## Check and register

```sh
base="$SKILL/references/templates/two-entry-catalog-detail"
node "$SKILL/ontomato.mjs" panel check "$base/catalog"
node "$SKILL/ontomato.mjs" panel check "$base/detail"

node "$SKILL/ontomato.mjs" panel register "$base/catalog"
node "$SKILL/ontomato.mjs" panel register "$base/detail"
```

Open `/applications/app-template-two-entry/catalog`.

## Adapting to a customer ontology class or another platform type

1. Inspect the type with `node "$SKILL/ontomato.mjs" panel type <type-id>`.
   - For a customer ontology class (for example `Student`), bind the platform's generic read functions parameterized by
     class (`list` / `record` shown by `panel type <class>`) and your published Actions for writes.
   - For a platform type (for example `platform:RelationType`), bind its built-in reads and operations.
2. Add `config.columns` on `list` in `catalog/panel.json` for multi-column tables.
3. Add a Delete button in `detail/panel.json` (`OperationButton` with `config: { label: "Delete", type: "danger", plain: true, icon: "trash" }`) and place `<projection slot="remove" @done="onDeleted">` inside `<page-header #actions>`.
4. Update IDs, paths (`CATALOG_PATH` / `DETAIL_PATH`), and `registration.json` to match your application ID.
5. Set `"allowStandalone": true` on the application in `detail/registration.json` if you want to share direct external
   links from the application's sidebar menu or properties.
