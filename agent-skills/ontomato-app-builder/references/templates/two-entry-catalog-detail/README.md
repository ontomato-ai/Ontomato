# Two-entry catalog → single-row `<page-header>` detail + centered create dialog

Minimal starter pattern for multi-column catalog + detail management applications:

- **Menu entry (`catalog/`)**: appears in the application menu (`names` set on the `panelUse`). Renders a `<page-header>`
  with a primary `+ New …` button, a full-width `ObjectList` whose row click (`@choose`) navigates to the detail entry
  with flat query parameters via `panelAddress(DETAIL_PATH, { selected: item.primaryKey })`, and a centered
  `<sdk-dialog>` hosting `ObjectForm` (`createForm`, `config.actions: "create-only"`). `creating` is public state with `deepLink: false`. Dialog close, Escape and Back guard unsaved edits.
- **Detail entry (`detail/`)**: omitted from the menu (`names` omitted on the `panelUse`), opened via
  `panelAddress(DETAIL_PATH, { selected: primaryKey })` (`?selected=<primaryKey>`) or a direct deep link.
  Renders a single-row `<page-header>` with Back, title, Discard and Save wired to
  `usePanelFormDraft("form")`, plus equal-height cards in a two-column `@container` grid that collapses to one column
  below `850px`. Routing back via `navigate(CATALOG_PATH)` automatically invokes the platform's unified unsaved-changes
  confirmation.

The detail entry opens directly at narrow widths and shows a missing or forbidden record in place.
The form mounts only when the selected record is ready.

## Check and register

```sh
base="$SKILL/references/templates/two-entry-catalog-detail"
node "$SKILL/scripts/ontomato.mjs" panel check "$base/catalog"
node "$SKILL/scripts/ontomato.mjs" panel check "$base/detail"

node "$SKILL/scripts/ontomato.mjs" panel register "$base/catalog"
node "$SKILL/scripts/ontomato.mjs" panel register "$base/detail"
```

Open `/applications/app-template-two-entry/catalog`.

## Adapting to a customer ontology class or another platform type

1. Inspect the type with `node "$SKILL/scripts/ontomato.mjs" panel type <type-id>`.
   - For a customer ontology class (for example `Student`), bind the platform's generic read functions (`query`,
     `record`, `form`, `createForm` shown by `panel type <class>`), an object-targeted write `Action` for edit, and a
     top-level targetless `Action` (`target: { source: "none" }`) for create.
   - For a platform type (for example `platform:Relationship`), bind its built-in reads and operations.
2. Add `config.columns` (and optional `valueMap` / `rowActions`) on `list` in `catalog/panel.json`.
3. Add a Delete button in `detail/panel.json` (`OperationButton` with `config: { label: "Delete", type: "danger", plain: true, icon: "trash", hideWhenUnavailable: true }`) and place `<projection slot="remove" @done="onDeleted">` inside `<page-header #actions>`.
4. Update IDs, paths (`CATALOG_PATH` / `DETAIL_PATH`), and `registration.json` to match your application ID.
5. Set `"allowStandalone": true` on the application in `detail/registration.json` if you want to share direct external
   links from the application's sidebar menu or properties.
