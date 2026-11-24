# Two-entry catalog → single-row `<page-header>` detail + centered create dialog

Minimal starter pattern for multi-column catalog + detail management applications:

- **Menu entry (`catalog/`)**: appears in the application menu (`names` set on the `panelUse`). Renders a `<page-header>`
  with a top-right primary `+ New …` button, a full-width `ObjectList` whose row click (`@choose`) navigates to the detail entry
  with flat query parameters via `panelAddress(DETAIL_PATH, { selected: item.primaryKey })`, and a centered
  `<sdk-dialog>` hosting `ObjectForm` (`createForm`, `config.actions: "create-only"`). `creating` is public state with `deepLink: false`. Show only the required create fields (here `/name`). The dialog guards unsaved edits on close.
  The form's `saved` event carries the identity from the owner's `created` receipt. On save, close the dialog and
  open the new object's full-width detail when a key was reported.
- **Detail entry (`detail/`)**: omitted from the menu (`names` omitted on the `panelUse`), opened via
  `panelAddress(DETAIL_PATH, { selected: primaryKey })` (`?selected=<primaryKey>`) or a direct deep link.
  Renders a single-row `<page-header>` with Back, title, Discard and Save wired to
  `usePanelFormDraft("form")`, plus equal-height cards in a two-column `@container` grid that collapses to one column
  below `850px`. The ordinary back action calls `navigate(CATALOG_PATH)`. The host guards unsaved edits,
  keeps the catalog state and refreshes its list on return.

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
3. Add a Delete button in `detail/panel.json` (`OperationButton` with `config: { label: "Delete", type: "danger", plain: true, icon: "trash", hideWhenUnavailable: true }`) and place `<projection v-show="selectedKey && ready" slot="remove" @done="onDeleted">` inside `<template #actions>`. Keep the slot declared. The button must stay mounted long enough to handle `@done` after deletion clears the selection.
4. Update IDs, paths (`CATALOG_PATH` / `DETAIL_PATH`), and `registration.json` to match your application ID.
5. Set `"allowStandalone": true` on the application in `detail/registration.json` if you want to share direct external
   links from the application's sidebar menu or properties.

## Reuse the pair in another application

Move `DETAIL_PATH` and `CATALOG_PATH` into scalar string states `detailPath` (on the catalog) and
`catalogPath` (on detail). Set `external: true` and keep the existing paths as defaults. Use the
states in the navigation handlers. Wire each application separately through `panelUse.inputs`, for example
`{ detailPath: { literal: "/applications/app-examples/detail" } }` on the catalog use. The host removes
wired inputs from the URL.

For conversational creation, add a `ConversationEntry` to the catalog header. Teach the assistant to `present`
the detail entry with `creating: true`, and declare that state on detail with `deepLink: false`.
See the [management page wiring](../../management-pages.md#reuse-a-catalog-and-detail-across-applications).
