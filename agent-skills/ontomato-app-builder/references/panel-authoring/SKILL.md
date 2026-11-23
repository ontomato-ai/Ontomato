---
name: ontomato-panel-authoring
description: Build and register an Ontomato panel from declared read functions, operations, and official SDK components.
---

# Author an Ontomato panel

1. **Discover available reads and operations before writing code.** Run
   `node "$SKILL/scripts/ontomato.mjs" panel type <type-id>` (and `--read <name>` for one read's parameters and `resultSchema`).
   - **Customer ontology classes** (for example `Student`): projections only bind read and write functions — bind the
     platform's generic read functions parameterized by class (list objects of a class / get one object by ID, listed
     under `panel type <class>`), MetricViews for filtered/calculated reads, and Actions for writes.
   - **Platform types** (`platform:*`): bind their built-in platform reads and management operations.
2. **Respect the four boundaries:**
   - **Hierarchy**: platform sidebar → application menu / frame (use the platform's default application menu; do not
     hand-author custom frame panels yet) → current entry panel → nested panels and components.
   - **Display belongs to universal components**: follow the
     [three-step component lookup](CODE.md#choose-an-official-component-before-writing-one) — check official component
     defaults first (`sdk read docs/components.md`), then `config` (including `ObjectList` `config.rowActions` and
     column widths, `ObjectForm` `config.presentation`/`groups`), and use standard Vue slots (`#cell-<key>`, `#actions`,
     `#row-detail`, `#field-<dotPath>`, etc.) with a domain component declared in `manifest.components` or nested
     `<projection>` only when a specific piece still cannot be configured. Legacy `listColumn` / `listRowDetail` /
     `formField` bindings are removed — follow the
     [end-to-end Vue slots, `rowActions`, and per-row operation example](CODE.md#custom-list-columns-row-detail-and-per-row-operations).
   - **Logic belongs to the capability layer**: calculations, derived labels, and business rules belong in MetricViews
     (reads), Actions (writes), or platform-owned reads — not in panels or components.
   - **Panels only lay out and wire**: panels coordinate layout, typed public state, visibility, navigation, and
     read-only projection outputs (`usePanelOutput` / `usePanelOutputs` for titles, counts, selections, dirty/draft state).
     Panels do not read business record fields directly or compute business values; unsaved form drafts do not count as
     ontology data; there are no panel-private components.
3. **Pick a matching [page template](../templates/README.md)** (prefer
   [two-entry-catalog-detail](../templates/two-entry-catalog-detail/README.md) for multi-column catalogs with full-width
   detail, or [catalog-detail-dialog](../templates/catalog-detail-dialog/README.md) / `panel scaffold` for a single-panel
   starter). Write layout in normal HTML, CSS (`@container`), and Vue — no layout components. Place the pure
   presentational `<page-header>` at the top when the page needs a header, wire edit Save/Discard through
   `usePanelFormDraft("form")`, and use `<sdk-*>` UI primitives, `v-sdk-*` directives, `--sdk-*` theme tokens, and
   `usePanelContext().notify()`. Never write `el-*` tags, `--el-*` tokens, `v-loading`, or `element-plus` imports.
4. **Check, register, and verify.** Run `panel check` and `panel register`, then open the registered entry. After any
   update via `panel register` or `component register`, hard-reload open browser tabs so the new revision loads. Use
   the page's input box for the [assistant check](#check-the-assistant-from-the-page), and check
   [troubleshooting](CODE.md#when-a-panel-looks-wrong) if anything looks off.

```sh
node "$SKILL/scripts/ontomato.mjs" panel check "$WORKSPACE"
node "$SKILL/scripts/ontomato.mjs" panel register "$WORKSPACE"
```

## Registration files (`panel.json` vs. `registration.json`)

Keep the panel definition separate from registration metadata:

- **`panel.json`**: `{ manifest: { state, members }, content?: { messages }, theme?, template? }` — the panel's own
  declaration and optional multi-locale message table.
- **`registration.json`**: the registration envelope naming the panel (`id`, `mode: "create" | "update"`, `revision` on
  update only, `input: { name, description, visibility }`) and optionally the application (`id` starting with `app-`,
  `entry`, `declaration`, `entryAccess`, `allowStandalone`, `panelUses`).

Each entry in `panelUses` declares a domain-unique `pageKey`, `panelId`, `path` (`/applications/<app-id>/...`), and
`access` (`{ "kind": "domain-member" }` or `{ "permissionCode": "..." }`). Include `names` to show the entry in the
application menu; **omit `names`** for a detail entry reached only by navigation or deep link.

Example application item in `registration.json` (two entries: menu catalog + hidden detail):

```json
{
  "id": "app-my-management-page",
  "mode": "create",
  "input": {
    "entry": { "path": "/applications/app-my-management-page", "renderer": "panels" },
    "declaration": {
      "names": { "en": "Management", "zh-CN": "管理应用" },
      "descriptions": { "en": "Management example", "zh-CN": "管理应用示例" },
      "icon": "app-window",
      "groups": [],
      "permissions": []
    },
    "entryAccess": ["domain-member"],
    "allowStandalone": true,
    "panelUses": [
      {
        "id": "catalog-use",
        "pageKey": "app-my-management-page-catalog",
        "panelId": "my-catalog-panel",
        "path": "/applications/app-my-management-page/catalog",
        "access": { "kind": "domain-member" },
        "names": { "en": "Catalog", "zh-CN": "目录" }
      },
      {
        "id": "detail-use",
        "pageKey": "app-my-management-page-detail",
        "panelId": "my-detail-panel",
        "path": "/applications/app-my-management-page/detail",
        "access": { "kind": "domain-member" }
      }
    ]
  }
}
```

For a development handoff, give the registered entry's site-relative path (for example
`/applications/app-my-management-page/catalog`). Reserve `standalone=1` for external sharing; enable it with
`"allowStandalone": true` and copy the external link from the sidebar application menu or application properties.

## Check the assistant from the page

Open the registered entry in the browser, select a test record, pick an assistant in the page composer, and check:

1. **Read.** “What page and record are selected? Read the current [field] on this record.”
2. **Draft.** “Draft a change to [field] on this record. Give me a site-relative draft link and leave it for me to save.”
   Open the link, inspect the prefilled change, save as the reader, and verify.
3. **Execute.** “Run [declared operation] on this test record, with confirmation when required.”

For read-only pages, verify reads only. See [CODE.md](CODE.md) for Vue authoring details, `<page-header>`, forms,
drafts, graphs, and troubleshooting, and [FIELDS.md](FIELDS.md) / [RUNTIME.md](RUNTIME.md) for generated contracts.
