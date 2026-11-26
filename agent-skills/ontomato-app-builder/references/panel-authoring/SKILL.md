---
name: ontomato-panel-authoring
description: Build an Ontomato application panel from declared read functions, operations, and official SDK components.
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
     [four-step component lookup](recipes/component-vs-panel-responsibility.md#choose-an-official-component-before-writing-one) — check official component
     defaults first (`sdk read docs/components.md` → `sdk read docs/components/<Name>.md`), then `config` (columns, `valueMap`, `rowActions`, `ObjectForm`
     `presentation`/`groups`), then standard Vue slots (`#cell-<key>`, `#actions`, `#row-detail`, `#field-<dotPath>`)
     with a slot-only domain component in `manifest.components` or nested `<projection :inputs="{ target: ref }">`, and
     author a dedicated component only as a last resort.
   - **Write a member's values in their one place**: its fixed configuration in the member's `config`, and the values
     that follow the page as `:values` where the member is placed. `:inputs` carries only the ports the catalogue lists
     as inputs, and a placement that carries it is drawn as an instance of its own (a row's detail, an array item) —
     it does not share the member's registration, form draft or outputs with the rest of the panel. See
     [where a member's value is written](FIELDS.md#where-a-members-value-is-written).
   - **Logic belongs to the capability layer**: calculations and business judgments come from MetricViews (reads),
     Actions (writes), or platform built-in reads. Base components may only fill already-provided numbers into a fixed
     sentence template (`RecordTemplate`), map raw values with exact-match `valueMap`, or do local text matching on a
     complete unpaged list (`filteredCount`). Never use loaded row counts as a paged total — use owner-returned `total`.
   - **Panels only lay out and wire**: panels coordinate layout (`@container` / flex / grid), typed public state
     (`manifest.state`), visibility, flat URL navigation (`panelAddress`), and read-only projection outputs
     (`usePanelOutput` / `usePanelOutputs`). Never read raw business record fields in the panel or compute business values;
     unsaved form drafts do not count as ontology data.
3. **Pick a matching [page template](../templates/README.md).** Use the existing files for the chosen shape.
   When bringing an existing page into the product layer, read
   [Migrating an existing page into the product layer](../migrate-existing-page.md).
   - Place `<page-header>` at the top when the page needs a header, wire edit Save/Discard through
     `usePanelFormDraft("form")`, and classify buttons cleanly: `<sdk-button>` for local UI actions (dialogs, back,
     navigate, discard), `OperationButton` / declared member operations for business writes, and `ObjectForm` /
     `usePanelFormDraft` for form save.
   - Use `<sdk-*>` UI primitives, `v-sdk-*` directives, `--sdk-*` theme tokens, and `usePanelContext().notify()`.
     Never write `el-*` tags, `--el-*` tokens, `v-loading`, `element-plus` imports, or direct `fetch`/`XMLHttpRequest` calls.
   - Unmount closed or unavailable forms/actions with `v-if`. Keep same-object tabs and off-screen lists mounted
     with `v-show`. Confirm before leaving dirty edits.
   - Mark `deepLink: true` **only** on state needed to land on the same view (`selected`, `tab`, `search`, `filter`,
     `sort`). **Never** mark dialog toggles (`creating`, `grantDialog`, `dialog`, `compose`) or active-edit trackers
     (`editingEntryId`) with `deepLink: true`.
4. **Check, preview, and publish.** Run `panel check "$WORKSPACE"` on the application root and review the
   candidate in Application Builder. Keep the source commit. Use the [page publishing flow](../../GUIDE.md#check-preview-and-publish),
   then open the published entry at full-page and beside-conversation widths. Check
   [troubleshooting](recipes/troubleshooting.md) if anything looks off.

Keep each owned panel in `panels/<panelId>/`. Its `panel.json` holds the manifest and panel metadata, and its
members reference projections by ID. Store owned projection definitions in `projections/<projectionId>.json`.
Define the uses and application metadata in the root `application.json`. See the
[application source format](../../GUIDE.md#application-source) and the
[two-entry template](../templates/two-entry-catalog-detail/README.md) for a menu catalog and a hidden detail use.

For a development handoff, give the published entry's site-relative path. To enable external
`standalone=1` links, set `"allowStandalone": true` in `application.json`.

## Check the assistant from the page

Humans and agents operate the page with the exact same logic: same form, same button, same API, same permissions.
Open the registered entry beside the conversation, select a test record, pick an assistant in the page composer, and check:

1. **Observe & read.** “What page, tab, and record are currently open? Read the current [field] on this record.”
2. **Navigate & update state.** “Switch to [another record / tab / open the create dialog].” Verify the panel updates
   in place in the same round without reloading or writing.
3. **Fill form directly.** “Change [field] to [value] in the form without saving yet.” Verify the agent fills the live
   form directly with `fill_form`, marks the changed field, and leaves it unsaved. Verify same-page `present`
   returns `blocked_unsaved` if it would change the dirty form's target or unmount it. A human leaving the form sees
   the confirmation.
4. **Save / execute.** Save in the page or ask “Save this form / Run [declared operation] on this test record.” Verify
   confirmation by default (invalidated if the human edits the form while waiting) and automatic list/metric refresh
   after success.

For read-only pages, verify observation, navigation, and state switching. See the
[task-indexed recipes](../../SKILL.md#what-you-want-to-do--where-to-look) (`recipes/`) for Vue authoring,
customer `ObjectType` forms & targetless Actions, flat URL encoding, component outputs, and troubleshooting, and
[FIELDS.md](FIELDS.md) / [RUNTIME.md](RUNTIME.md) for generated contracts.
