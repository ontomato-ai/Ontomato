---
name: ontomato-app-builder
description: "Compose, check and register panel applications with the Ontomato SDK. Use when building a panel or moving an existing page into the product layer."
---

# Ontomato app builder

## Rules for authoring pages

**Rules the author must follow (not machine-checked, or not yet checked)**

Authoring panels:

1. **Container-driven layout.** Lay out by container width and height (`@container` / flex / grid), never by browser window width or hardcoded viewport subtractions. The same code must work full-page, embedded in another panel, and beside a conversation. When the container has no definite height, grow naturally with content; when it has a definite height, either grow and let the outer area scroll or fill the container and scroll the needed sub-region.
2. **Reads through projections, writes through declared operations.** Never call business APIs directly. Every button that performs a business write must invoke a named operation bound on a projection member of this panel; buttons for local UI interaction only (open dialog, go back, navigate, discard unsaved draft) are written directly in the panel as `<sdk-button>` or component buttons.
   - Whether rendered in `<page-header>`, a table slot, or a form, the button calls the same declared binding so target and parameter sources are traceable.
   - A save bound on a form projection submits that form's live draft; a write operation on another member that submits a form's draft must explicitly name that form member (`draft: "<formMember>"`).
   - Post-action UI updates or navigation must rely on the operation's success outcome; any new object ID needed afterward (for example navigating to a newly created record) must be declared and returned by the operation owner. Never infer success or guess a new ID from list changes.
3. **Never render ontology data in the panel.** Business data is rendered by base components according to projection declarations so every displayed result, field, or object is traceable.
   - Exception 1: Unsaved draft input in a form/canvas/wizard is not ontology data and may be read via the component's declared draft output for live preview.
   - Exception 2: Declared read-only projection outputs may be placed into text-only slots such as titles and tab labels (see Rule 5).
   - Static non-business content and pure local view toggles are written directly in the panel or with data-free SDK UI primitives without registering projections.
4. **No business calculations or business judgments in panels or components.** Computed results and business judgments come from capability-layer MetricViews (reads) or Actions (writes), or platform built-in reads for platform objects. Base components may format already-provided values in three ways only: fill values into a fixed sentence template (`RecordTemplate`), map raw values to label/tone/icon via exact-match `valueMap` (`TypedValue`, `InfoBanner`, `ObjectList` columns), or perform pure text filtering on a complete unpaged list and expose `filteredCount`. Never compute new business values, infer thresholds/statuses, or pass off loaded row counts as a paged total — use the owner-returned `total`.
5. **Read-only projection outputs only.** The only business values a panel script/template may read are declared read-only outputs (`usePanelOutput` / `usePanelOutputs`, e.g., selected object/label, owner `total`, `loadedCount`, `filteredCount`, `dirty`, owner-declared scalar outputs). Use them only to feed other members, control visibility/selection/navigation (checking presence, equality, or zero is not business calculation), or fill text-only slots with optional fixed prefixes/suffixes. Never read raw record fields or compute on them.
6. **No automatic writes on display.** Never trigger business writes on load, URL restoration, selection, or re-render. Writes occur only on explicit user action or an explicit agent call to a registered operation.
7. **Component lookup order.** Advance only when the previous step cannot satisfy the need: (1) official component defaults; (2) component `config`; (3) placing another component in an official Vue slot (`#cell-<key>`, `#actions`, `#row-detail`, `#field-<dotPath>`); (4) authoring a dedicated component as a last resort. Slot components that only display values passed by the official component are listed in `manifest.components` (not registered as projections); slot blocks that read additional ontology data remain projections receiving `:inputs="{ target: ref }"`. Per-row business operations are declared on the `ObjectList` projection and invoked by slot buttons.
8. **Page headers belong to the panel.** The platform does not draw page headers. Place `<page-header>` at the top of `panel.html` when needed (omit for headerless pages), supply title, description, back action, `:draft="usePanelFormDraft(...)"`, and buttons obeying Rule 2.
9. **Public state, `deepLink`, and recipes.** Declare all members (`manifest.members`), slot-only domain components (`manifest.components`), and public states (`manifest.state`). Data-free official UI primitives (`<page-header>`, `<sdk-*>`) are not listed as members.
   - Always declare as public state: (a) state deciding which business content the reader sees (tabs, filters, selections, view modes); (b) state opening or switching an editable business form (including blank create dialogs such as `creating`). Leave pure transient UI state (hover, help tooltips, scroll position) in Vue.
   - Mark `deepLink: true` **only** on state needed for another reader to return to the same view (selected object, tab, view mode, list search/filter/sort). **Never** mark dialog toggles (`creating`, `grantDialog`, `dialog`, `compose`) or active-edit trackers (`editingEntryId`) with `deepLink: true`.
   - Use `present` to open the page or editor, `fill_form` to enter unsaved values in the live form, and `page_action` to request the declared save when asked. The same form, operation and permissions apply to humans and assistants. Write typical flows in `recipes.md`.
10. **Reuse first, escalate missing capabilities.** Search for existing base components, projections, and panels first. Missing business reads, forms, or Actions are added by the capability owner; missing generic UI primitives belong in the official SDK. When migrating an existing page, verify every visible item and user action against the original page.

Authoring components:

11. **Declared meaning, no direct business APIs.** Base components never call business APIs directly; data comes through the projection declaration. Write clear `meaning`, data ports, config, inputs, outputs, and operations so both humans and agents understand what the component renders and can do.

**Machine-checked rules (`panel check` catches these automatically)**

- Panel code uses Vue templates, standard CSS, and scripts importing only `vue` and `@ontomato/sdk/panel`. Direct network calls (`fetch`, `XMLHttpRequest`, `EventSource`, `WebSocket`) are rejected.
- Data-free UI primitives use `<page-header>`, `<sdk-*>`, `v-sdk-*`, and `--sdk-*` tokens. Third-party library names (`el-*`, `v-loading`, `--el-*`, `element-plus`) are rejected.
- Manifest structure, typed public states, member bindings, and component declarations (including `bindsElement` meaning applicable ontology types; actual bindings always go through reads or operations) are validated against the SDK catalogue and type table.

## Getting started

- **New panel or application:** read the [Vue panel skill](references/panel-authoring/SKILL.md) and pick a [page template](references/templates/README.md).
- **Moving an already-built page into the product layer:** read [Migrating an existing page into the product layer](references/migrate-existing-page.md) and the [application decomposition skill](references/app-standard/SKILL.md).
- **CLI, registration, customer Actions & MetricViews:** read the [technical guide](GUIDE.md) (`scripts/ontomato.mjs`) and the [full standard](references/app-standard/references/standard.md). When the platform supplies `application-design`, read it before designing or polishing a panel.

Use the attached workspace and current identity. Run `panel check`, then register and open the application entry. For
new Actions and MetricViews, read the owner context, write a definition, and have the Java authoring API test and accept
it through the CLI. For delegated retrieval, use the product's analyst skill and follow
[agent delegation](GUIDE.md#agent-delegation).
