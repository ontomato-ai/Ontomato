# Write a Vue panel

Write the Vue template and scoped panel styles in `panel.html` inside `<div id="app">`. Place each declared member
with `<projection slot="memberKey"></projection>`, where `slot` matches a key in `manifest.members`. Use standard Vue
templates, CSS (`@container`), and events for layout and interactions.

Style colors, typography, spacing, and radii with platform design variables (`--sdk-*`, `--text-*`, `--spacing-*`,
`--radius-*`, `--page-gutter`, `--page-content-gap`) from `node "$SKILL/scripts/ontomato.mjs" sdk read docs/components.md`
(`Theme tokens`) or `sdk read components.json` (`themeTokens`). Never use `--el-*` variables in CSS or `panel.json`
`theme`.

Declare `{ manifest, content?, theme?, template? }` in `panel.json` using the
[panel descriptor and member fields](FIELDS.md). Keep page-local UI state in Vue; declare shared or shareable state in
`manifest.state` (an object state such as `selected` stores `{ className, primaryKey }`, and `deepLink: true` syncs it
to the URL `?state=` parameter). Put assistant instructions in `recipes.md`.

Mount the Vue page in `panel.mjs` with `mountPanel` (see the
[two-entry catalog → detail template](../templates/two-entry-catalog-detail/README.md) or
[single-panel catalog-detail template](../templates/catalog-detail-dialog/panel.mjs)). Read
[runtime imports and setup](RUNTIME.md#imports), `node "$SKILL/scripts/ontomato.mjs" sdk read docs/index.md`, and
`sdk read docs/components.md` for component data ports, `config`, outputs, and events.

Use the platform's data-free interface components directly as template tags (no script import needed):
- `<page-header>` (pure presentational page header)
- `<sdk-*>` UI primitives (`<sdk-button>`, `<sdk-input>`, `<sdk-dialog>`, `<sdk-drawer>`, `<sdk-tag>`, `<sdk-tabs>`, …) and `v-sdk-*` directives (`v-sdk-loading`, `v-sdk-infinite-scroll`, `v-sdk-popover`)
- `<markdown-view>`, `<code-editor readonly>`, `<e-chart>`, `<table-preview>`, `<html-preview>`, `<form-fields>`

For multi-locale panels, put flat message keys under locale tags in `panel.json`'s `content.messages` (for example
`{"en":{"panel.name":"Students"},"zh-CN":{"panel.name":"学员名册"}}`) and call `t("panel.name")` in the template or
`usePanelContext().t` in `setup()`. Single-locale panels may write UI text directly in `panel.html` / `panel.mjs` or
use `content.messages`.

## Layout, `<page-header>`, and container responsiveness

- **Host content box.** Every entry (full page or beside a conversation) receives a content box with no host page
  header, host padding, or outer card frame. Style outer gutter and layout directly in your panel CSS (for example
  `padding: var(--spacing-lg) var(--page-gutter) var(--page-content-gap)`). Prefer container-relative sizing and CSS
  `@container` rather than `window.innerWidth` or viewport units (`vh`/`vw`/`dvh`) so the layout stays comfortable
  both full-width and beside a conversation.
- **No layout components.** Write catalog tables, full-width detail cards, split panes, and tabs with normal HTML, CSS
  grid/flex, and Vue. Start from a matching [page template](../templates/README.md).
- **Pure presentational `<page-header>`.** Place `<page-header>` at the top of `panel.html` when the page needs a
  header (omit it for headerless pages):
  - `title` (string) or `#title` slot (e.g. a projection-bound component)
  - optional `description` (string) or `#description` slot
  - optional `back-label` + `@back` (wired to `navigate(CATALOG_PATH)` or `usePanelBack`)
  - `#actions` slot for right-side buttons (`<sdk-button>`, `<projection slot="remove">`, inline counts, search inputs)
  - `:draft="formDraft"` wired to `usePanelFormDraft("form")` for automatic Save, Discard, and unsaved-changes state

```html
<page-header :title="selectedTitle" :back-label="t('detail.back')" :draft="formDraft" @back="goBack">
  <template #actions>
    <projection slot="remove" @done="onRemoveDone"></projection>
  </template>
</page-header>
```

```js
import { mountPanel, usePanelContext, usePanelFormDraft } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { navigate } = usePanelContext();
    const formDraft = usePanelFormDraft("form");
    // Routing back to the catalog entry triggers the platform's unified unsaved-changes leave guard automatically.
    const goBack = () => { void navigate(CATALOG_PATH).catch(() => undefined); };
    return { formDraft, goBack };
  },
});
```

- **Two-entry catalog → detail *(recommended)*.** Put the catalog in the application menu (`names` set on its
  `panelUse`) and give the detail page its own non-menu entry (`names` omitted). Clicking a row (`@choose`) builds
  `${DETAIL_PATH}?${new URLSearchParams({ state: JSON.stringify({ selected }) })}` and calls `navigate(address)`. For a
  single-panel variant, toggle `v-if="!selectedKey"` and wire `usePanelBack(..., { pushHistory: true, forms: "form" })`.

## Panel controls and platform behavior

- **Allowed imports in `panel.mjs`.** Only `vue` and `@ontomato/sdk/panel` (`mountPanel`, `usePanelContext`,
  `usePanelFormDraft`, `usePanelBack`, `usePanelData`, `usePanelOperation`, `savePanelFile`, `draftTarget`,
  `appIcon`). Never import `element-plus` or any third-party UI library, and never write `<el-*>` tags, `v-loading`,
  or `--el-*` CSS tokens.
- **Overlays & notifications.** Use `<sdk-dialog>` / `<sdk-drawer>` for modal/drawer overlays (such as centered create
  forms). Call `usePanelContext().notify({ kind: "success" | "info" | "warning" | "error", text })` for transient
  feedback.
- **Keep business reads and writes declared.** Never call business HTTP APIs from `panel.mjs`. Panels may show
  projection outputs (selected title, counts, draft status) in headers, tabs, or dialogs, but never read raw business
  record fields in the panel or compute business logic.

## Open a panel at a specific state

Mark target state fields with `deepLink: true` in `manifest.state`. Use `node "$SKILL/scripts/ontomato.mjs" panel uses <app-id>`
to confirm the destination entry's registered `path`, encode `?state=` once via `URLSearchParams`
(for example `` `${path}?${new URLSearchParams({ state: JSON.stringify(state) })}` ``), and call
`usePanelContext().navigate(address)` (captured in `setup()`). For links in Markdown or recipes, give site-relative
paths beginning with a single `/` and pass raw JSON once into `URLSearchParams` (`?state=...`). See
[state in an address](RUNTIME.md#state-in-an-address) and the
[object reference shapes table](RUNTIME.md#object-reference-shapes-quick-reference).

## Component vs. panel responsibility

- **Display belongs to universal components.** Components render business fields, graphics, options, and executable
  operations according to their projection declarations. Component formatting only governs how a single value is rendered
  (such as date or number formatting).
- **Logic belongs to the capability layer.** Calculations, filtered aggregations, derived judgments, and writes belong
  to MetricViews (reads), Actions (writes), or platform-owned reads — not panel scripts or templates. Composing
  multiple business values into a summary sentence (for example "12 total, 3 pending") is a business statistic and also
  belongs to the capability layer.
- **Panels only lay out and wire.** Panels arrange projections, own UI layout and public state, wire projection outputs
  into other projections or text slots (titles, tabs, counts, notices), and trigger navigation. Panels do not read
  record fields directly or compute business values; unsaved form drafts do not count as ontology data.
- **No panel-private components.** A block that appears on one page should first be composed from official components;
  when official components + `config` cannot cover it, author a formal component.

### Choose an official component before writing one

1. **Match the read function to an official component's data port.** Run `panel type <type-id> --read <name>` and
   compare `result` / `resultSchema` with the component's Data section in `sdk read docs/components.md`.
   - For customer ontology classes, bind the platform's generic read functions parameterized by class (list / get one,
     shown by `panel type <class>`), MetricViews for calculated/filtered reads, and Actions for writes.
   - For `platform:*` types, bind their built-in platform reads and operations.
2. **Use official defaults first, then `config`.** Start with `component`, `type`/`target`, and `data`. Adjust columns
   (including `width` / `minWidth`), `rowActions`, visible fields, copyable fields, subtitles, tags, button
   labels/styles, or page size via `config`.
3. **Write a focused slot component only as a last resort.** When default rendering and `config` still leave a specific
   gap — a single table column (`#cell-<key>`), action cell (`#actions`), expandable row detail (`#row-detail`), or form
   field (`#field-<dotPath>`) — place a small domain component (declared in `manifest.components`) or nested
   `<projection>` into the official component's Vue slot (see
   [Custom list columns, row detail and per-row operations](#custom-list-columns-row-detail-and-per-row-operations)).
   Do not wrap a whole page in a custom component or hand-roll a table with `PanelData`. Legacy
   `listColumn` / `listRowDetail` / `formField` bindings are removed.

## Read declared data

Inspect any read with `panel type <type-id> --read <name>` (for example
`node "$SKILL/scripts/ontomato.mjs" panel type platform:Action --read definition`). Omit `--read` to see all reads and
operations for that type.

Use the [member fields reference](FIELDS.md) to bind each component's named datum and map ports via `state`. A
non-rendering `PanelData` member + [`usePanelData`](RUNTIME.md#usepaneldata) (called in synchronous `setup()`, before
any `await`) is available for coordination when no component output carries the needed signal, or to declare operations
called via [`usePanelOperation`](RUNTIME.md#usepaneloperation). Never use `PanelData` / `usePanelData` to render
business record fields in `panel.html`.

### Configure an official list or summary

These short members go in `manifest.members`.

**ObjectList.** Default compact list:

```json
{"component":"ObjectList","type":"platform:BusinessKnowledge","data":{"rows":"query"}}
```

Compact rows with subtitle, status badge, tags, and page size:

```json
{
  "component": "ObjectList",
  "type": "platform:BusinessKnowledge",
  "data": {"rows": "query"},
  "config": {"subtitleField": "knowledgeText", "subtitleLines": 2, "statusField": "status", "tagsField": "knowledgeTags", "pageSize": 20}
}
```

For multi-column table mode, set `config.columns` (omitting `config.columns` renders compact rows). Each entry is an
`ObjectListColumn`:

| Property | Type | Required | Default / behavior |
| --- | --- | --- | --- |
| `key` | `string` | Yes | Owner field key (or `"label"` for the record's primary label). Also the column identifier matched by a `#cell-<key>` Vue slot. |
| `labelKey` | `string` | No | Flat key in `content.messages` for the column header. Omit to use the owner's `fieldLabels[key]`. |
| `kind` | `"text" \| "tag" \| "tags" \| "reference" \| "time"` | No | Defaults to `"text"`. `"tag"` draws an owner-toned badge; `"tags"` draws a tag list; `"reference"` draws a clickable link emitting `navigate`; `"time"` formats an ISO timestamp in the reader's locale and time zone. |
| `subtitleKey` | `string` | No | Second field key rendered beneath the primary cell value. |
| `emptyKey` | `string` | No | Flat key in `content.messages` shown when the cell value is empty. |
| `wrap` | `boolean` | No | Defaults to `false` (single-line ellipsis). Set `true` to wrap long cell text. |

Place the member with `<projection slot="list"></projection>`. Listen to `@choose` for row clicks (e.g. navigating to a
detail entry) and `@navigate` for clicking `"reference"` cells. Use `#toolbar-actions` and `#batch-actions="{ checked, clear }"`
to place toolbar or batch controls:

```html
<projection slot="list" @choose="openDetail">
  <template #toolbar-actions>
    <projection slot="review"></projection>
  </template>
</projection>
```

**ObjectSummary.** Bind `target` to an object state field (e.g. `selected`):

```json
{
  "component": "ObjectSummary",
  "target": "selected",
  "data": {"record": "record"},
  "config": {"fields": ["status", "knowledgeTags"], "showTitle": false, "copyableFields": ["id"]}
}
```

- `config.fields`: choose and order visible facts.
- `config.showTitle: false`: hide the duplicate heading when `<page-header>` or `ObjectHeader` already shows the title.
- `config.copyableFields`: add one-click copy buttons on the listed field keys.

**ObjectHeader.** Use `ObjectHeader` inside split/card views for a selected record's heading, status badge, inline
operations, and overflow menu. See `sdk read docs/components.md` for its full configuration.

**OperationButton.** Binds one declared operation on `target` (a single object state or a checked list for batch
operations). Defaults to the owner's operation label; override display label and styling in `config`:

```json
{
  "component": "OperationButton",
  "operation": "platform:RelationType.delete",
  "target": "selected",
  "config": { "label": "Delete", "type": "danger", "plain": true, "icon": "trash" }
}
```

## Custom list columns, row detail and per-row operations

Use `ObjectList`'s built-in `config.rowActions` for per-row operation buttons and local buttons (dialog/navigation),
and use standard Vue slots (`#cell-<key>`, `#cell`, `#actions`, `#row-detail`, `#card`, `#empty`) to customize any
piece of a list without replacing the whole table.

### 1. Built-in row action column (`config.rowActions`) and row operations

Declare row operations directly on the `ObjectList` member under `operations` (each binding specifies `operation`,
`target`: `{ "row": true }` / `{ "rowField": "..." }` / `{ "input": "..." }` / `{ "literal": ... }`, and optional
`params` taking `{ "rowField": "..." }`, `{ "row": "primaryKey" | "label" }`, `{ "input": "..." }`, or
`{ "literal": ... }`). Configure `config.rowActions` to display them inline and overflow extras into a "More" menu:

```json
{
  "manifest": {
    "state": {
      "selected": {
        "type": { "kind": "object", "objectType": "platform:Application" },
        "deepLink": true
      }
    },
    "components": {
      "app-icon-name-cell": "domain-component:11111111-1111-4111-8111-111111111111"
    },
    "members": {
      "apps": {
        "component": "ObjectList",
        "type": "platform:Application",
        "data": { "rows": "query" },
        "state": { "selected": "selected" },
        "config": {
          "columns": [
            { "key": "name", "labelKey": "col.app", "width": "240px" },
            { "key": "status", "labelKey": "col.status", "kind": "tag", "width": 120 }
          ],
          "rowActions": {
            "maxVisible": 2,
            "items": [
              { "kind": "local", "id": "edit", "labelKey": "action.edit" },
              { "kind": "operation", "operation": "disable", "when": { "field": "status", "equals": "active" } }
            ]
          }
        },
        "operations": {
          "disable": { "operation": "applications.disable", "target": { "row": true } }
        }
      },
      "rowDetail": {
        "component": "ObjectSummary",
        "type": "platform:Application",
        "data": { "record": "record" }
      }
    }
  }
}
```

Per-row availability for declared operations is returned in one batch alongside the list read (eliminating N+1
requests), and entry/parent fixed parameters are still injected by the server.

### 2. Custom cells, actions, and expandable row details via Vue slots

Author-registered components placed inside Vue slots (`manifest.components`) only draw the props passed to them and
do not need to be registered as projections. Components that read their own data (such as a form or summary inside
`#row-detail`) remain projections and receive the current row via `:inputs`:

```html
<projection slot="apps" @row-action="onRowAction">
  <template #cell-name="{ row }">
    <app-icon-name-cell
      :icon="row.fields.icon"
      :names="row.fields.names"
      :fallback-label="row.label"
    ></app-icon-name-cell>
  </template>
  <template #row-detail="{ ref }">
    <projection slot="rowDetail" :inputs="{ target: ref }"></projection>
  </template>
</projection>
```

For `ObjectForm`, place field-level pickers or custom inputs inside `#field-<dotPath>` (for example `#field-skills`,
`#field-modelSelection.modelId`, or `#field-items.*.skillId` for array rows). `ReferencePicker` and `ObjectGraph`
connect automatically to the enclosing form field.

Register a domain component and check/register the panel workspace:

```sh
node "$SKILL/scripts/ontomato.mjs" component register ./app-icon-name-cell
node "$SKILL/scripts/ontomato.mjs" panel check ./apps-panel
node "$SKILL/scripts/ontomato.mjs" panel register ./apps-panel
```
## Bind read parameters and listen to component events

Inspect each component's Data and Events sections in `sdk read docs/components.md` and read parameter signatures in
`panel type <type-id> --read <name>`. Explicit `data.<name>.params` map read parameters to `{ state: "fieldName" }` or
`{ literal: value }`, or bind a same-named read parameter via the member's `state` map. Components supply their own
runtime parameters (such as search/page/cursor) automatically when unbound.

Listen to component events directly on `<projection>` (`@choose`, `@navigate`, `@saved`, `@discarded`, `@done`).

## Connect a graph and its relations

Inspect `OntologyGraph` and `ObjectRelations` in `sdk read docs/components.md` and named reads via
`panel type <type-id> --read <name>`. Declare the shared [graph selection type](RUNTIME.md#graph-selection) in
`manifest.state`, and map `OntologyGraph`'s `selectedNode` and `ObjectRelations`'s `selected` to that same state field
so selections stay synchronized. Mount them with `<projection slot="graph">` and `<projection slot="relations">`.

## Select a child record and read from its parent

Use the [child-object field and value shapes](RUNTIME.md#child-objects) for child selection, alongside a parent object
state for the parent's reads. Set the read member's `target` to the parent state and pass any required child/source
parameters through `data.<name>.params` (see [FIELDS.md](FIELDS.md)).

## Invoke declared owner operations

Use the owner's full operation ID in the member declaration and bind `target` to the selected object (or a checked list
for batch operations). Place `<projection slot="remove">` directly in `<page-header #actions>` or toolbar slots —
override button text with `config.label` when needed. From Vue code, call
[`usePanelOperation`](RUNTIME.md#usepaneloperation) in synchronous `setup()` and run `handle.run(input)`. The platform
handles permissions, confirmation, and write receipts (see
[operation IDs and write results](RUNTIME.md#operation-ids-and-write-results)).

## Save a form or hand off a draft

An `ObjectForm` projection binds one `form.save` operation and submits `values`, `revision`, and `submittedFields`.

- **`config.actions`**:
  - `"footer"` (default): non-overlapping document-flow Save/Discard/Cancel bar at the bottom of the form.
  - `"create-only"`: Cancel/Create bar only in create mode (pair with `<page-header :draft="formDraft">` in edit mode).
  - `"none"`: omit the form's own bar in both modes (ideal on a dedicated detail entry with `<page-header :draft="formDraft">`).
- **`usePanelFormDraft("form")`**: wire directly into `<page-header :draft="formDraft">` for Save, Discard (with
  confirmation), busy state, and unsaved-changes notice — no manual submit boilerplate needed.
- **`config.fixedFields`**: fix parent-determined fields by JSON Pointer path (`{"state":"selected","path":"/primaryKey"}`
  or `{"literal":"..."}`) so they display read-only and submit with every save.
- `ObjectForm` automatically renders word counters for schema `maxLength` fields, password masking (`show-password`) for
  single-line `text` fields declaring `secret: true`, and disables cascading select fields
  when the owner declares `disabledWhenEmpty`.

The SDK evaluates incoming drafts against declared form members even before `ObjectForm` mounts, so you can mount
`<projection slot="form">` conditionally (`v-if`) inside a detail view or create `<sdk-dialog>` and watch
`instance.draft`. The `saved` event carries `{ className, primaryKey }`.

Always use `draftTarget(draft)` to inspect an accepted draft's effective target (`{ kind: "create", objectType }` vs.
`{ kind: "update", objectType, id }`, including reopened saved creation drafts):

```js
import { draftTarget, usePanelContext } from "@ontomato/sdk/panel";
import { watch } from "vue";

const { instance } = usePanelContext();
watch(instance.draft, (draft) => {
  if (!draft) return;
  const target = draftTarget(draft);
  if (target.kind === "update") {
    // open detail view for target.id
  } else {
    // open create dialog
  }
}, { immediate: true });
```

### Assistant draft format

For an assistant draft artifact (`outputs/drafts/<name>.page-draft.json`), copy `save.draftOperation` from the owner
form into `operation`, set `pageKey` to the entry's `pageKey`, set `target` to `{ "objectType": "...", "id": "..." }`
(omit `id` for creation; include `itemKey` for row-attached child forms), and place only changed fields as nested
objects in `form` (never flat JSON Pointer keys like `"/modelConfig/modelId"`):

```json
{
  "pageKey": "app-template-two-entry-detail",
  "operation": "platform:AgentDefinition.save",
  "target": { "objectType": "platform:AgentDefinition", "id": "<selected ID>" },
  "form": {
    "name": "Review assistant",
    "modelConfig": { "modelId": "default" }
  }
}
```

Build the site-relative reader link with `URLSearchParams` (one encoding pass; `draftPath` must start with
`outputs/drafts/` with no leading slash):

```js
const entry = new URL(usePath, window.location.origin);
entry.searchParams.set("draftSessionId", sessionId);
entry.searchParams.set("draftRunId", runId);
entry.searchParams.set("draftPath", "outputs/drafts/edit.page-draft.json");
const draftLink = `${entry.pathname}${entry.search}`;
```

See [draft links and instance state](RUNTIME.md#draft-links-and-instance-state) for invalid path examples.

### Metric charts from dashboard cards

For a calculated MetricView chart, declare `component: "MetricChart"` and `sourceCard: { dashboardId, cardId }`, and
connect its inputs in `state`. If the card is not yet registered, `panel check` lists it in `unchecked` and
`panel register` asks the card owner to register it and writes the projection ID.

## Open the page composer

A dialog or conversation entry pointing to a specific agent is also a projection (a base component instantiated with an
ontology entity). Add a `ConversationEntry` member when the page needs a button that opens the composer with a specific
agent and an optional opening line (`prefill` or multi-locale `prefillKey` in `content.messages`). The reader still
sends the message.

## Register and open

Write each new projection inline in `manifest.members`, run `panel check <directory>`, then `panel register <directory>`.
Registration writes each new projection's UUID into `panel.json` as `id` (keep it on future edits). Use
`target.projectionId` to reuse an existing projection.

- Application IDs start with `app-`, and paths start with `/applications/<application-id>/`.
- Give every `panelUse` a domain-unique `pageKey`. Include `names` for menu entries; omit `names` for detail entries
  opened only via navigation or deep links.
- For domain-member apps, set `entryAccess: ["domain-member"]` and `access: { kind: "domain-member" }`. For restricted
  apps, declare app-owned permissions (e.g. `app:app-my-app:view`).
- Set `"allowStandalone": true` when the application should support standalone external links (`standalone=1`, copied
  from the sidebar application menu or application properties).
- Choose `declaration.icon` from `node "$SKILL/scripts/ontomato.mjs" sdk icons`.
- Omit `defaultAgent` to use the general assistant; set `{ kind: "id", id }` or `{ kind: "preset", agentKind }` only
  when that agent already selects this panel's skill.

## When a panel looks wrong

Open the registered entry without query parameters first, keep browser Network and Console logs open across a hard
reload, and inspect the first failing request or error:

- **Blank panel or `panel-host-error`.** Inspect console errors, `GET /api/product-panels/<id>`, and SDK asset
  requests. Verify with `panel uses <app-id>`, `panel get <panel-id>`, `panel projection <id>`, and
  `panel check <directory>`.
- **List is empty or waiting.** Check `POST /api/product-panels/read` for `memberPath` and `dataName` against
  `panel type <type-id> --read <name>`. Missing required inputs leave a datum `awaiting`.
- **Draft does not fill or shows `Required`.** Inspect `GET /api/assistant/sessions/<session-id>/runs/<run-id>/page-draft?path=…`
  and the form's `POST /api/product-panels/read`. Verify `pageKey`, `target.objectType`, `target.id`, `save.draftOperation`,
  and `watch(instance.draft, ...)` using `draftTarget(draft)`.

## What the assistant receives

The platform derives the panel's page skill from its declared reads, state, forms, operations, and `recipes.md`, and
passes current entry metadata plus declared selections in `pageContext`. Keep page-specific guidance in `recipes.md`
and verify via the [page input box](SKILL.md#check-the-assistant-from-the-page).
