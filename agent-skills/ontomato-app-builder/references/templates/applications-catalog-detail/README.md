# Applications catalog ↔ multi-tab detail (`platform:Application`)

Reference template for a **two-entry catalog ↔ detail** management application with server-side paging, scoped filters,
sorting, multi-tab detail views, sub-lists, modal sub-editors, and owner-declared read-only outputs:

- **Catalog (`catalog/`)**: paged `ObjectList` (`config.pagination: "pages"`, `columns` with icon/subtitle/tags/time)
  with `#filters` (`<sdk-segmented>` scope + `<sdk-select>` sort wired to `deepLink: true` states), centered create
  dialog (`creating` public state **without** `deepLink: true`), and `panelAddress` navigation to the detail entry.
- **Detail (`detail/`)**: `<page-header :draft="identityDraft">` + tabs (`tab`, `deepLink: true`: `identity`,
  `entries`, `assets`, `grants`) + owner-declared scalar outputs from `ObjectHeader` via `usePanelOutput`
  (`canMaintain`, `canEditEntries`, `canGrant`, `openPath`, `domainShared`) + list `total` outputs (`number | null`) +
  modal editors (`editingEntryId`, `grantDialog` as public state **without** `deepLink: true`).

## Check and register

```sh
base="$SKILL/references/templates/applications-catalog-detail"
node "$SKILL/scripts/ontomato.mjs" panel check "$base/catalog"
node "$SKILL/scripts/ontomato.mjs" panel check "$base/detail"

node "$SKILL/scripts/ontomato.mjs" panel register "$base/catalog"
node "$SKILL/scripts/ontomato.mjs" panel register "$base/detail"
```
