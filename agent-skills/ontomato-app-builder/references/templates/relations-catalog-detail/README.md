# Relations catalog + side-by-side detail (`platform:Relationship`)

Reference template for a **catalog table + two-column side-by-side detail** application built strictly on official SDK
components, flat URL query parameters, and read-only projection outputs:

- **Catalog (`catalog/`)**: `<page-header>` + toolbar search (`search`, `deepLink: true`) + live local count from
  `usePanelOutput("catalogue", "filteredCount")` + full-width `ObjectList` (`platform:Relationship`) + centered
  `<sdk-dialog>` create form (`creating` public state **without** `deepLink: true`). Row click navigates with
  `panelAddress(DETAIL_PATH, { selected: ref.primaryKey })`.
- **Detail (`detail/`)**: single-row `<page-header :draft="detailDraft">` with `<projection slot="headerTitle">`
  (`ObjectHeader`) in `#title` and `OperationButton` (`relationships.delete`) in `#actions`. Two-column `@container`
  cards show `ObjectForm` (`config.actions: "none"`) on the left and clickable `ObjectRefCard` endpoints (`fromCard` →
  `toCard`) + `<info-banner>` on the right, collapsing cleanly below `850px`.

## Check and register

```sh
base="$SKILL/references/templates/relations-catalog-detail"
node "$SKILL/scripts/ontomato.mjs" panel check "$base/catalog"
node "$SKILL/scripts/ontomato.mjs" panel check "$base/detail"

node "$SKILL/scripts/ontomato.mjs" panel register "$base/catalog"
node "$SKILL/scripts/ontomato.mjs" panel register "$base/detail"
```
