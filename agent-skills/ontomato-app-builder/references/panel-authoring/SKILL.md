---
name: ontomato-panel-authoring
description: Build and register an Ontomato panel from declared read functions, operations, and official SDK components.
---

# Author an Ontomato panel

1. **Discover available reads and operations before writing code.** Run
   `node "$SKILL/scripts/ontomato.mjs" panel type <type-id>` (and `--read <name>` for one read's parameters and `resultSchema`).
   - **Customer ontology classes** (for example `Student`, `Order`): projections only bind read and write functions —
     `bindsElement` in the SDK catalogue indicates applicable ontology element types, while every actual binding MUST go
     through a projection's declared read or operation (binding a class alone is rejected). For customer classes, bind
     the platform's generic read functions (`query`, `record`, `form`, `createForm` shown under `panel type <class>`),
     MetricViews for calculated/filtered reads, and Actions for writes (object-targeted Actions and affecting targetless
     Actions under `panel type <class>`'s `operations` / `targetlessOperations`, or all top-level targetless Actions via
     `panel type --all`).
   - **Platform types** (`platform:*`, e.g., `platform:Relationship`, `platform:Application`): bind their built-in
     platform reads and management operations.
2. **Respect the four boundaries:**
   - **Hierarchy**: platform sidebar → application menu / frame (use the platform's default application menu unless
     authoring an explicit frame panel) → current entry panel → nested panels, projections, and data-free SDK UI primitives.
   - **Display belongs to universal components**: follow the
     [four-step component lookup](CODE.md#choose-an-official-component-before-writing-one) — check official component
     defaults first (`sdk read docs/components.md`), then `config` (columns, `valueMap`, `rowActions`, `ObjectForm`
     `presentation`/`groups`), then standard Vue slots (`#cell-<key>`, `#actions`, `#row-detail`, `#field-<dotPath>`)
     with a slot-only domain component in `manifest.components` or nested `<projection :inputs="{ target: ref }">`, and
     author a dedicated component only as a last resort.
   - **Logic belongs to the capability layer**: calculations and business judgments come from MetricViews (reads),
     Actions (writes), or platform built-in reads. Base components may only fill already-provided numbers into a fixed
     sentence template (`RecordTemplate`), map raw values with exact-match `valueMap`, or do local text matching on a
     complete unpaged list (`filteredCount`). Never use loaded row counts as a paged total — use owner-returned `total`.
   - **Panels only lay out and wire**: panels coordinate layout (`@container` / flex / grid), typed public state
     (`manifest.state`), visibility, flat URL navigation (`panelAddress`), and read-only projection outputs
     (`usePanelOutput` / `usePanelOutputs`). Never read raw business record fields in the panel or compute business values;
     unsaved form drafts do not count as ontology data.
3. **Pick a matching [page template](../templates/README.md)** (including the three clean reference templates:
   [relations-catalog-detail](../templates/relations-catalog-detail/README.md),
   [applications-catalog-detail](../templates/applications-catalog-detail/README.md), and
   [ontology-graph-workbench](../templates/ontology-graph-workbench/README.md), plus
   [two-entry-catalog-detail](../templates/two-entry-catalog-detail/README.md) and
   [catalog-detail-dialog](../templates/catalog-detail-dialog/README.md) / `panel scaffold`). If you are bringing an
   already-built page into the product layer, read
   [Migrating an existing page into the product layer](../migrate-existing-page.md) first.
   - Place `<page-header>` at the top when the page needs a header, wire edit Save/Discard through
     `usePanelFormDraft("form")`, and classify buttons cleanly: `<sdk-button>` for local UI actions (dialogs, back,
     navigate, discard), `OperationButton` / declared member operations for business writes, and `ObjectForm` /
     `usePanelFormDraft` for form save.
   - Use `<sdk-*>` UI primitives, `v-sdk-*` directives, `--sdk-*` theme tokens, and `usePanelContext().notify()`.
     Never write `el-*` tags, `--el-*` tokens, `v-loading`, `element-plus` imports, or direct `fetch`/`XMLHttpRequest` calls.
   - Mark `deepLink: true` **only** on state needed to land on the same view (`selected`, `tab`, `search`, `filter`,
     `sort`). **Never** mark dialog toggles (`creating`, `grantDialog`, `dialog`, `compose`) or active-edit trackers
     (`editingEntryId`) with `deepLink: true`.
4. **Check, register, and verify.** Run `panel check` and `panel register`, then open the registered entry in both
   full-page and beside-conversation widths. After updating via `panel register` or `component register`, hard-reload open
   browser tabs. Use the page's input box for the [assistant check](#check-the-assistant-from-the-page), and check
   [troubleshooting](CODE.md#when-a-panel-looks-wrong) if anything looks off.

```sh
node "$SKILL/scripts/ontomato.mjs" panel check "$WORKSPACE"
node "$SKILL/scripts/ontomato.mjs" panel register "$WORKSPACE"
```

## Registration files (`panel.json` vs. `registration.json`)

Keep the panel definition separate from registration metadata:

- **`panel.json`**: `{ manifest: { state, members, components? }, content?: { messages }, theme?, template? }` — the
  panel's own declaration and optional multi-locale message table.
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

Humans and agents operate the page with the exact same logic: same form, same button, same API, same permissions.
Open the registered entry beside the conversation, select a test record, pick an assistant in the page composer, and check:

1. **Observe & read.** “What page, tab, and record are currently open? Read the current [field] on this record.”
2. **Navigate & update state.** “Switch to [another record / tab / open the create dialog].” Verify the panel updates
   in place in the same round without reloading or writing.
3. **Fill form directly.** “Change [field] to [value] in the form without saving yet.” Verify the agent fills the live
   form directly in the same round (no link for the user to click), marks the changed field, triggers the same leave-page
   unsaved-changes prompt as human typing, and asks before overwriting if the human already has unsaved edits
   (`UNSAVED_FORM_CONFLICT`).
4. **Save / execute.** Save in the page or ask “Save this form / Run [declared operation] on this test record.” Verify
   confirmation by default (invalidated if the human edits the form while waiting) and automatic list/metric refresh
   after success.

For read-only pages, verify observation, navigation, and state switching. See [CODE.md](CODE.md) for Vue authoring,
customer `ObjectType` forms & targetless Actions, flat URL encoding, component outputs, and troubleshooting, and
[FIELDS.md](FIELDS.md) / [RUNTIME.md](RUNTIME.md) for generated contracts.
