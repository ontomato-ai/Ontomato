# Write a Vue panel

Write the Vue template and scoped panel styles in `panel.html`. Put the template inside `<div id="app">`. Place a
declared member with `<projection slot="detail"></projection>`. The slot names the key in `manifest.members`.
Use Vue attributes, events, `v-if` and `v-for` for interactions. Adapt the layout to the container width and
[content-box height](#content-box-height-and-layout).
Panel CSS positions member containers. Set colors, font sizes, spacing and corner radii with the platform's
design variables (`--sdk-*`, `--text-*`, `--spacing-*`, `--radius-*`) from
`node "$SKILL/ontomato.mjs" sdk read docs/components.md` (`Theme tokens`) or `sdk read components.json`
(`themeTokens`). Never use `--el-*` variables in CSS or `panel.json` `theme`. The product design guide in
`docs/design/DESIGN.md` explains which roles to use.

Declare the panel descriptor (`{ manifest, content?, theme?, template? }`) and projections using the
[panel descriptor and member fields](FIELDS.md), and declare public typed state in `panel.json`.
Keep page-local state in Vue. An object state
such as `selected` stores `{className, primaryKey}`. Enable `deepLink` when the address should restore the selection.
Declare named page-header commands in `manifest.commands`. Give each command a `labelKey` and a `do`
action. Fields changed by a `do.set` command need `deepLink: true` so the assistant can open the same state.
Use `recipes.md` for tasks the assistant needs to know how to do.

Use the required `panel.mjs` to mount the Vue page as in the [agent directory module](../../examples/vue-agent-directory/panel.mjs).
The platform runs panels directly. Read [runtime imports and setup](RUNTIME.md#imports-and-application-icons)
and the current SDK guide with `node "$SKILL/ontomato.mjs" sdk read docs/index.md`. For component behavior,
configuration and ports, use `sdk read docs/components.md`. The repository's
`packages/apps-sdk/src/panel/mount.ts` implements the legacy iframe runtime.

Use the platform’s interface components directly in the template: `<markdown-view>`, `<code-editor readonly>`
for code viewing, `<e-chart>`, `<table-preview>`, `<html-preview>` and `<form-fields>`.

For translations, put flat message keys under locale tags in `panel.json`'s `content.messages`. For example,
`{"en":{"panel.greeting":"Hello, {name}"}}` is a message table. Use `t("panel.greeting", { name })` in the
template and `usePanelContext().t` in `setup()`. The direct runtime supplies the template function.
Use the flat `panel.name` key for the panel title, for example
`{"zh-CN":{"panel.name":"治理报告"},"en":{"panel.name":"Governance report"}}`. The host uses an entry's menu name
when present. Otherwise it uses the panel name in the reader's locale, then the platform's default locale and the
name in `registration.json`. Keep the entry's menu metadata for entries that belong in the menu.

## Content box height and layout

Panels do not know where they are hosted — full page, beside a conversation, or inside a custom frame — and size only
against the box given to them, never the browser window.

- **Host content box.** Every entry receives a definite-height content box below the page header and above the bottom
  composer. Its height tracks window resizes, composer expand/collapse, and banners; taller content scrolls inside the
  box while the header and composer stay fixed. Full page, beside-conversation, and a custom frame's current-entry slot
  share this exact contract. The panel root mounts directly inside that box (with no indeterminate-height wrapper
  between them), so filling it works with normal CSS.
- **Two normal-CSS height patterns (no extra manifest declaration):**
  - **Flow / stack naturally:** Let content take its natural height and let the content box scroll. Use this for lists,
    forms, and long pages — write nothing special.
  - **Fill the content box:** Have the panel root fill the content box (for example `height: 100%` with a flex/grid
    layout) and scroll inner panes independently (`min-height: 0; overflow: auto`). Use this for three-pane
    workbenches, graphs, and list-plus-detail views. Give each filling region a `min-height` in `rem` or `px` and **no
    upper cap** (`max-height`): when the box is shorter than `min-height`, or when the panel is placed inside another
    panel's auto-height slot, it lays out at `min-height` and the outer box scrolls. When narrow widths stack columns
    vertically, switch back to natural stacking.
- **Member slots.** Panel CSS sizes each member container. Official components fill the slot they receive and fall back
  to their own default height when the slot has no definite height.
- **Forbidden.** Never write CSS viewport units (`vh`, `vw`, `vmin`, `vmax`, `vi`, `vb`, `sv*`, `lv*`, `dv*`) or
  subtract magic header/composer constants from window height (`calc(100vh - ...)`). Never hand-draw viewport-sized
  modal overlays or cards in a panel — use `<sdk-dialog>` or `<sdk-drawer>`, which handle viewport-relative overlay
  sizing.

## Panel controls and platform behavior

Use only the Ontomato SDK's own interface controls for panel chrome that does not render business fields:

- **Template tags (`panel.html` and `component.html`).** Use `<sdk-*>` tags (such as `<sdk-button>`, `<sdk-tag>`,
  `<sdk-dialog>`, `<sdk-alert>`, `<sdk-input>`, `<sdk-select>`, `<sdk-drawer>`) and `v-sdk-*` directives
  (`v-sdk-loading`, `v-sdk-infinite-scroll`, `v-sdk-popover`) directly in templates without importing them.
- **Theme variables.** Use `--sdk-*` and platform tokens (`--text-*`, `--spacing-*`, `--radius-*`) listed in
  `sdk read docs/components.md` (`Theme tokens`) or `sdk read components.json` (`themeTokens`). Overridable tokens
  may also be set in `panel.json` `theme.light` / `theme.dark`.
- **Authoritative manifest.** The exact supported tags, props, events, slots, directives and theme tokens of the
  target deployment are published in `sdk read docs/components.md` and `sdk read components.json` (`uiPrimitives`,
  `uiDirectives`, `themeTokens`). Rely on that SDK manifest rather than assuming undocumented third-party APIs.
- **Script imports.**
  - In `panel.mjs`, import only `vue` and `@ontomato/sdk/panel` (`mountPanel`, `usePanelContext`, `usePanelData`,
    `usePanelOperation`, `draftTarget`, `appIcon`).
  - In custom component packages, import `Sdk*` controls and `vSdk*` directives from `@ontomato/sdk/ui`.
  - In domain-registered components (`component.mjs`), export Vue component options (`export default { ... }`) and
    import only `vue` and `@ontomato/sdk/panel` (`useMember`, `useMemberData`, `useMemberOperations`,
    `useMemberParam`, `useMemberRead`); use `<sdk-*>` / `v-sdk-*` directly in `component.html`.
- **Transient notifications.** Import `usePanelContext` from `@ontomato/sdk/panel`, capture
  `const panel = usePanelContext()` in `setup()`, and call
  `panel.notify({ kind: "success", text: "Export complete" })` from the event handler (`kind` accepts `"success"`,
  `"info"`, `"warning"` or `"error"`).
- **Forbidden patterns.** Never write `el-*` tags, `v-loading`, `--el-*`
  CSS/theme variables, `import ... from "element-plus"`, CSS viewport units (`vh`, `vw`, `dvh`, etc.), or hand-drawn
  viewport-sized modal overlays. Do not use `mountPanel` to draw business data — neither
  by looping over `PanelData` / `usePanelData` records in `panel.html`, nor by defining an inline business component
  with `defineComponent({ template })` inside `panel.mjs` to bypass component registration.

If a dialog or drawer mounts at the page root, check its theme, stacking and keyboard focus in the
application that opens it. Include a check when the panel is beside a conversation.

Leave the following to the platform.

- **Write confirmation and execution.** Have the button invoke the [declared owner operation](#invoke-declared-owner-operations).
  Button clicks and assistant calls use the same confirmation rules, and the platform executes an accepted write once.
  Use local dialogs for interface choices.
- **Form drafts.** The platform delivers drafts to the form. Follow the [form draft flow](#save-a-form-or-hand-off-a-draft).
- **Page header and refresh (no business data in the header).** The host renders the title, description, back control,
  commands and **Refresh** button solely from declared metadata — the host never reads business data to render the
  header. Put counts, totals, and other business summaries inside the panel content, rendered by the component that
  owns that data. Clicking the host Refresh button automatically re-reads every mounted projection and `usePanelData`
  datum in the panel (including nested panels) — do not wire a manual refresh handler or call `refreshObjects()` for
  page-header refresh. To keep what the page shows current while something runs elsewhere (a task run), call
  `instance.refreshObjects()` on a timer and stop it when nothing runs: it reads everything shown again, exactly as the
  header's Refresh does. Declare page-header commands in `manifest.commands` (or `commands: {}` when none are needed)
  and keep the panel template focused on page content.

## Open a panel at a specific state

Choose the target fields marked `deepLink` and use the [address and child-state contracts](RUNTIME.md#state-in-an-address).
Run `node "$SKILL/ontomato.mjs" panel uses <destination-app-id>` to get the destination use's registered `path`.
Use its path with the encoded state on `usePanelContext().navigate`, captured during setup. The
[generated capability-map address example](RUNTIME.md#state-in-an-address) opens the type view at a selected class.
Give `URLSearchParams` raw JSON once. Give readers page and draft links as site-relative paths beginning with
a single `/`. Include any needed query parameters and omit the scheme and hostname.
See [header commands and navigation](RUNTIME.md#header-commands-and-navigation) when wiring a button to an entry.

## Component vs. panel responsibility

Judge by responsibility, not by HTML tag: **whoever turns business fields into reader-visible text, graphics, options,
or executable business operations is a component.** The **panel** coordinates layout, visibility, selection, navigation,
and passing references between members based on what components emit.

- Put coordination state that the assistant must be able to describe or restore (such as path-finding start and end) in
  declared `manifest.state`. Keep transient UI-only toggles (such as a local expand/collapse flag) in Vue.
- Reading declared data in panel code is legitimate only for coordination, and should prefer a component's own output
  whenever available. Do not pull a data port into `panel.html` to render business fields.

| Case | Wrong (rendering business data in the panel) | Right (component renders, panel coordinates) |
| --- | --- | --- |
| Path-finding start and end dropdowns | Looping over business records in `panel.html` to generate `<option>` items | An object-picker component renders the names and outputs object references; the panel only stores both endpoints and triggers path lookup. Mapping business records into dropdown options is still rendering business data and belongs in a component. |
| Section heading `"Attributes · 37"` | Interpolating the owner-returned count into a panel heading | Write the static label `"Attributes"` in the panel; let the component reading that data display the count. |
| `"Revoke"` inside a grant row | A plain panel button that first mutates panel selection and then invokes an operation | The component invokes a declared per-row operation whose target and parameters come from that row. |

### Choose an official component before writing one

Follow these three steps in order before writing any custom rendering code:

1. **Match the owner's read to an official component's data port.** Run `panel type <type-id> --read <name>` and
   compare `result` and `resultSchema` with the component's Data section in `sdk read docs/components.md`. If they do
   not match, that is a gap on the owner or shared-record side — report or extend the owner/contract rather than
   rendering business fields by hand in the panel.
2. **Use the default first, then check `config`.** Start with the component's default appearance (`component`,
   `type`/`target`, and `data`). For common adjustments — columns, visible fields, subtitles, status/tags, node sizing
   and coloring, page size — check `sdk read docs/components.md` and add a `config` option.
3. **Write a focused component only as a last resort.** When default rendering and `config` still leave a specific gap
   — a single table column, an expandable row detail area, or a single form field — write a small component for that
   slot and declare it as a `listColumn`, `listRowDetail`, or `formField` member (see
   [Custom list columns, row detail and per-row operations](#custom-list-columns-row-detail-and-per-row-operations)).
   Do not wrap an entire page in a custom component or re-implement list selection, field validation, or write
   confirmation.

## Read declared data

Before binding a member, inspect its read with `panel type <type-id> --read <name>`. For example, run
`node "$SKILL/ontomato.mjs" panel type platform:Action --read definition` for `actionDefinition`. Read its
`resultSchema` next to `result`, and use `params` and `requiredParams` for inputs. Omit `--read` to list the
type's reads and the operations with their effect, target, batch support and input schema.

Use the [generated member fields](FIELDS.md) to connect each component's named datum to an owner read and
its parameters. Bind an output by its port name in the short member's `state` map, with the declared panel
state field as its value.

A non-rendering `PanelData` member and [`usePanelData`](RUNTIME.md#usepaneldata) (called in synchronous setup, before
any `await`) remain available for **coordination reads** when no component output already carries the value (for
example, deciding visibility, navigation or follow-up state) or for declaring operations invoked via
[`usePanelOperation`](RUNTIME.md#usepaneloperation). Never use `PanelData` and `usePanelData` to render business fields
in `panel.html`.

For an assistant's named read, pass the member and datum separately. For the `detail` member's
`data.record`, send `memberPath: [{member: "detail"}]` and `dataName: "record"`. Use the entry source
and declared inputs shown in the page skill.

### Configure an official list or summary

These short members go in `manifest.members`. Each example uses the business knowledge owner's standard reads.

**ObjectList.** Start with the compact list and its owner-supplied labels and subtitles.

```json
{"component":"ObjectList","type":"platform:BusinessKnowledge","data":{"rows":"query"}}
```

Configure the compact rows to show the knowledge text on up to two lines, the owner status and tags, and 20 rows per page.

```json
{
  "component": "ObjectList",
  "type": "platform:BusinessKnowledge",
  "data": {"rows": "query"},
  "config": {"subtitleField": "knowledgeText", "subtitleLines": 2, "statusField": "status", "tagsField": "knowledgeTags", "pageSize": 20}
}
```

The toolbar displays a total when the search or paginated read returns one. For table mode, set `config.columns`
instead of the compact-row settings (omitting `config.columns` renders compact rows). Each entry in `config.columns`
is an `ObjectListColumn`:

| Property | Type | Required | Default / behavior |
| --- | --- | --- | --- |
| `key` | `string` | Yes | Owner field key (or `"label"` for the record's primary label). Also the column identifier matched by a `listColumn` member's `column` field. |
| `labelKey` | `string` | No | Flat key in `content.messages` for the column header. Omit to use the owner's `fieldLabels[key]`. |
| `kind` | `"text" \| "tag" \| "tags" \| "reference" \| "time"` | No | Defaults to `"text"`. `"tag"` draws a status badge colored by the owner's `tones`; `"tags"` draws the field's tag list; `"reference"` draws a clickable link emitting `navigate`; `"time"` formats an ISO timestamp in the reader's locale and time zone (full string in title). |
| `subtitleKey` | `string` | No | Second field key rendered as a subtle line beneath the primary cell value. |
| `emptyKey` | `string` | No | Flat key in `content.messages` shown when the cell value is empty. |
| `wrap` | `boolean` | No | Defaults to `false`. Set `true` to wrap long cell text across multiple lines. |

For example, `{"key":"label","kind":"text","subtitleKey":"knowledgeText"}` shows the label with a second line,
`{"key":"status","kind":"tag"}` renders the owner-toned badge, and `{"key":"knowledgeTags","kind":"tags"}` renders
the tag list.

Place the member with `<projection slot="list"></projection>`. In its template, `#toolbar-actions` adds a
control to the visible toolbar and `#batch-actions="{ checked, clear }"` adds controls for checked rows.
For example, place an already declared `review` member in the toolbar.

```html
<projection slot="list">
  <template #toolbar-actions>
    <projection slot="review"></projection>
  </template>
</projection>
```

**ObjectSummary.** Bind `target` to an object state field of type `platform:BusinessKnowledge`, here `selected`.
The default displays the record's fields in the owner's order.

```json
{"component":"ObjectSummary","target":"selected","data":{"record":"record"}}
```

List field names in `config.fields` to choose and order the visible facts. This shows status before tags.

```json
{
  "component": "ObjectSummary",
  "target": "selected",
  "data": {"record": "record"},
  "config": {"fields": ["status", "knowledgeTags"]}
}
```

## Custom list columns, row detail and per-row operations

When one column of an `ObjectList` needs custom rendering (such as an icon key beside a localized name) or a column
must run an operation on an **unselected** row (such as revoking one grant row while another row or application is
selected), attach a dedicated member to the list with `listColumn` instead of replacing the whole table.

### 1. Write and register a small domain component

Put `component.json`, `component.html`, and optional `component.mjs` in a directory (for example `./app-icon-name-cell/`).

- **Inputs boundary.** Declare every row field the cell needs under `declaration.inputs`. The platform resolves
  those inputs from the row's declared bindings and passes **only** those declared inputs to the component (via its
  declared `props` or `useMember().inputs`) — never undeclared fields of the row.
- **No independent data or outputs on `listColumn`.** Omit `data` and `outputs` for a column cell; the host
  `ObjectList` owns the read, selection, keyboard navigation, and row container.
- **SDK UI only.** Use `<sdk-*>` tags and `--sdk-*` tokens in `component.html`. In `component.mjs`, `export default`
  a Vue component options object and import only `vue` and `@ontomato/sdk/panel` (`useMember`, `useMemberData`,
  `useMemberOperations`, `useMemberParam`, `useMemberRead`).

`app-icon-name-cell/component.json`:

```json
{
  "name": "Application icon and localized name cell",
  "visibility": "domain",
  "declaration": {
    "role": "presentation",
    "meaning": "Displays an application's icon key badge beside its localized display name inside a list column.",
    "inputs": {
      "icon": { "kind": "scalar", "type": "string" },
      "names": { "kind": "json" },
      "fallbackLabel": { "kind": "scalar", "type": "string" }
    },
    "ports": { "props": [], "events": [], "slots": [] }
  }
}
```

`app-icon-name-cell/component.html`:

```html
<span class="app-icon-name-cell" style="display:inline-flex;align-items:center;gap:var(--spacing-xs);">
  <sdk-tag v-if="icon" size="small" effect="plain">{{ icon }}</sdk-tag>
  <span style="color:var(--sdk-text-color-primary);font-weight:500;">{{ displayName }}</span>
</span>
```

`app-icon-name-cell/component.mjs`:

```js
import { computed } from "vue";

export default {
  // The host passes only the inputs declared in component.json and bound by the panel member.
  props: {
    icon: { type: String, default: "" },
    names: { type: Object, default: null },
    fallbackLabel: { type: String, default: "" },
  },
  setup(props) {
    const displayName = computed(() => {
      const map = props.names && typeof props.names === "object" ? props.names : null;
      const locale = typeof document !== "undefined" ? document.documentElement.lang : "";
      if (map) {
        if (locale && typeof map[locale] === "string" && map[locale].trim()) return map[locale];
        if (typeof map.en === "string" && map.en.trim()) return map.en;
        const first = Object.values(map).find(value => typeof value === "string" && value.trim());
        if (first) return first;
      }
      return props.fallbackLabel || "";
    });
    return { displayName };
  },
};
```

Register the component in the current domain using the exact `ontomato.mjs` commands:

```sh
# 1. Create the domain component — writes declaration.componentId ("domain-component:<uuid>") into component.json
node "$SKILL/ontomato.mjs" component register ./app-icon-name-cell

# 2. List visible domain components or inspect one component's declaration, source and revision
node "$SKILL/ontomato.mjs" component list
node "$SKILL/ontomato.mjs" component read domain-component:<uuid>

# 3. Update an existing domain component using its current revision
node "$SKILL/ontomato.mjs" component register ./app-icon-name-cell --revision 1
```

### 2. Mount the column cell and a per-row operation in `panel.json`

Use the returned `domain-component:<uuid>` ID in a `listColumn` member, and use official `OperationButton` in another
`listColumn` member for a per-row write operation. Host-mounted members (`listColumn`, `listRowDetail`, `formField`)
are rendered by their host `ObjectList` / `ObjectForm` — **do not** place `<projection slot="appNameCell">` or
`<projection slot="revokeGrant">` in `panel.html`.

```json
{
  "manifest": {
    "state": {
      "selected": {
        "type": { "kind": "object", "objectType": "platform:Application" },
        "deepLink": true
      }
    },
    "members": {
      "apps": {
        "component": "ObjectList",
        "type": "platform:Application",
        "data": { "rows": "query" },
        "state": { "selected": "selected" },
        "config": {
          "columns": [
            { "key": "name", "labelKey": "col.app" },
            { "key": "status", "labelKey": "col.status", "kind": "tag" }
          ]
        }
      },
      "appNameCell": {
        "component": "domain-component:11111111-1111-4111-8111-111111111111",
        "listColumn": { "slot": "apps", "column": "name" },
        "inputs": {
          "icon": { "itemField": "icon" },
          "names": { "itemField": "names" },
          "fallbackLabel": { "item": "label" }
        }
      },
      "grants": {
        "component": "ObjectList",
        "type": "platform:Application",
        "target": "selected",
        "data": { "rows": "grants" },
        "config": {
          "columns": [
            { "key": "principalId", "labelKey": "col.principal" },
            { "key": "verb", "labelKey": "col.verb", "kind": "tag" },
            { "key": "actions", "labelKey": "col.actions" }
          ]
        }
      },
      "revokeGrant": {
        "component": "OperationButton",
        "listColumn": { "slot": "grants", "column": "actions" },
        "type": "platform:Application",
        "target": "selected",
        "operation": "applications.grant",
        "operationParams": {
          "principalKind": { "itemField": "principalKind" },
          "principalId": { "itemField": "principalId" },
          "verb": { "itemField": "verb" },
          "remove": { "literal": true }
        }
      }
    },
    "commands": {}
  },
  "content": {
    "messages": {
      "en": {
        "panel.name": "Applications",
        "col.app": "Application",
        "col.status": "Status",
        "col.principal": "Principal",
        "col.verb": "Permission",
        "col.actions": "Actions"
      }
    }
  }
}
```

How per-row execution stays safe and works on **unselected** rows:

- Clicking **Revoke** on row B while row A is selected resolves `target` (here the outer `platform:Application` from
  `selected`) and `operationParams` (`principalKind`, `principalId`, `verb` from row B, plus `remove: true`) on the
  platform side without changing panel selection.
- When an operation targets the row itself rather than an outer parent object, omit `target` and pass
  `"inputs": { "target": { "item": true } }` (plus any `{ "item": "primaryKey" }`, `{ "itemField": "..." }`,
  `{ "state": "..." }`, or `{ "literal": ... }` entries in `operationParams`).
- The confirmation dialog, execution, and generated page skill all read this same declaration, so the assistant can
  also target an unselected row by name and confirm the exact row.

### 3. Expandable row detail (`listRowDetail`)

When clicking a row should expand an inline detail section beneath it (for example, listing tools inside an MCP
service or child items under a record), declare one `listRowDetail` member pointing at the host `ObjectList`. Unlike
`listColumn`, a `listRowDetail` member **may** declare its own `data` read bound to the row's identity via
`{ "item": true }`:

```json
"rowDetail": {
  "component": "ObjectSummary",
  "listRowDetail": { "slot": "apps" },
  "type": "platform:Application",
  "inputs": { "target": { "item": true } },
  "data": { "record": "record" }
}
```

Check and register the panel workspace once the domain component is registered:

```sh
node "$SKILL/ontomato.mjs" panel check ./apps-panel
node "$SKILL/ontomato.mjs" panel register ./apps-panel
```

## Bind read parameters and listen to component events

Use the component's Data and Events sections in `sdk read docs/components.md`. Use
`panel type <type-id> --read <name>` for the chosen owner's parameter names, types and required inputs.
Explicit `data.<name>.params` map read parameters to `{state: "fieldName"}` or `{literal: value}`.
A short member can also bind a named read parameter through its `state` map. The component supplies its catalogued runtime parameters when the author leaves them unbound. When a non-rendering
coordination read requires runtime parameters, pass them through [the SDK read hook](RUNTIME.md#usepaneldata).

Listen on the placed `<projection>` using Vue's event binding. For the `ObjectList` event `navigate`,
for example, wire `<projection slot="list" @navigate="openReference"></projection>` to the Vue handler
returned from setup. Bind component output values through the member's `state` map.
Write component-driven state changes in Vue. For example, a list's `@update:selected` can call a setup
handler that runs `instance.state.set("filePath", null)`.

## Connect a graph and its relations

Run `node "$SKILL/ontomato.mjs" sdk read docs/components.md` and use the `OntologyGraph` and `ObjectRelations`
sections for each component's datum names, accepted result types, `config`, outputs and events. Inspect named
reads with `panel type <type-id> --read <name>`. Declare the shared [graph selection type](RUNTIME.md#graph-selection)
in `manifest.state`. In new members, map component ports to that field using the member's `state` map. For example,
`OntologyGraph` can write `selectedNode` and `ObjectRelations` can write `selected` to the same state field.

Mount the graph and list as `<projection slot="graph"></projection>` and
`<projection slot="relations"></projection>` when those are the member keys. Use the
[Vue setup reference](RUNTIME.md#vue-setup) for reads or actions added in page code.

## Select a child record and read from its parent

A knowledge governance question belongs to its report's `issues` collection. Use the
[child-object field and value shapes](RUNTIME.md#child-objects) for the question selection, and a separate report
object state for the parent's reads. Set the read member's `target` to the report state. The `issues` read
returns the report's questions, so the selected child's key identifies the row to display. For the report's
`sourcePage` read, bind the required `source` parameter to the selected source ID using
[the member data field](FIELDS.md). A link to a selected question carries both the report and question state.

## Invoke declared owner operations

Use the owner's full operation ID in the member declaration. Bind the target to the selected object or to a
checked list for an operation that supports batches. The official button uses the owner's label. From Vue code,
call [`usePanelOperation`](RUNTIME.md#usepaneloperation) in synchronous setup and invoke its `run` method
with the input the owner's description admits. The hook takes the target from the member's binding. The
platform handles the request, impact details and confirmation. For agent calls and write receipts, see
[operation IDs and write results](RUNTIME.md#operation-ids-and-write-results).

## Save a form or hand off a draft

An `ObjectForm` projection binds one owner operation whose kind is `form.save`. The component sends `call.input`
with `values`, the `revision` from the owner form when present, and `submittedFields` as JSON Pointer strings.
Fields omitted from `submittedFields` remain unchanged.
A custom save button calls [`usePanelOperation(...).run()`](RUNTIME.md#usepaneloperation) on the mounted form's save operation to submit the values it holds.

A populated object input edits that record. An empty input opens creation when the owner supports it and the
projection has the same type's `createForm` read. The successful create selects the returned object.

For child creation, use `ObjectForm.config.fixedFields` as shown in the current SDK guide
(`sdk read docs/components.md`). The owner validates these read-only field values at each save.

Keep the form mounted with `v-show` so it can receive drafts while the detail is open. The example watches
`instance.draft` to open the editor once its form has accepted a draft. Switch back to view mode on `saved` or
`discarded`. The save event carries the saved object as `{className, primaryKey}`. A failed save keeps the editor open.

```html
<projection slot="form" v-show="mode === 'edit'"
  @saved="mode = 'view'" @discarded="mode = 'view'"></projection>
```

Keep `recipes.md` for page-specific business guidance. Use this section as the single reference for the draft format.

For an assistant draft, look up the form's `objectType` in the entry's generated page skill. Read the owner form
and copy `save.draftOperation` into the artifact's `operation`. Use the entry's `pageKey`. For an edit, include
the opaque ID returned by the owner and put only the changed field values in `form`. When an owner form field's
JSON Pointer is a nested path (for example `/modelConfig/modelId`), organize `form` as nested objects
(`{"modelConfig": {"modelId": "..."}}`) — never use a flat JSON Pointer string key such as `"/modelConfig/modelId"`.

```json
{
  "pageKey": "example-vue-agent-directory-manage",
  "operation": "platform:AgentDefinition.save",
  "target": {"objectType": "platform:AgentDefinition", "id": "<selected agent ID>"},
  "form": {
    "name": "Review assistant",
    "modelConfig": {"modelId": "default"}
  }
}
```

For creation, read the owner's create form and set `target` to `{"objectType": "platform:AgentDefinition"}` for this example.
Omit `id`. The target always needs a nonempty `objectType`, and a supplied `id` must be a nonempty string.

If the Vue page needs the effective target of an accepted draft, call the SDK helper with the draft itself.

```js
import { draftTarget, usePanelContext } from "@ontomato/sdk/panel";
import { computed } from "vue";

// In setup
const { instance } = usePanelContext();
const draftMode = computed(() => {
  const draft = instance.draft.value;
  return draft ? draftTarget(draft).kind : null;
});
```

The helper returns `{kind: "create", objectType}` before creation and `{kind: "update", objectType, id}` for an edit.
Reopening a saved creation draft also returns `update` with the ID the first save created.

Publish the draft as a run artifact, such as `outputs/drafts/edit.page-draft.json`.
Build the reader's link from the registered entry path and query. Pass the run-relative artifact path
to `draftPath`, starting at `outputs/drafts/` with no leading slash.

```js
const entry = new URL(usePath, window.location.origin);
entry.searchParams.set("draftSessionId", sessionId);
entry.searchParams.set("draftRunId", runId);
entry.searchParams.set("draftPath", "outputs/drafts/edit.page-draft.json");
const draftLink = `${entry.pathname}${entry.search}`;
```

Use the session and run that wrote the draft. For each newly generated draft, set `draftRunId` to the run ID of
the turn that wrote it. Pass the raw value to `searchParams.set` for one encoding pass and keep any existing
entry parameters. See [the complete reader link and invalid path example](RUNTIME.md#draft-links-and-instance-state).

For a chart from a dashboard card, declare `component: "MetricChart"` and `sourceCard: {dashboardId, cardId}`.
Connect the chart inputs in `state`. If the owner has not registered that card, `panel check` lists its inputs as
unchecked. `panel register` asks the card owner to register the chart and uses the returned projection ID.

## Open the page composer

Add a `ConversationEntry` member when the page needs a named assistant or opening line. Use the generated
[`agent` and opening-line fields](FIELDS.md) and place the member with `<projection>`. The reader sends the message
from the opened composer.

## Register and open

Write each new projection directly in `manifest.members`. Run `panel check <directory>` and
`panel register <directory>` with the same `registration.json` metadata. Registration writes the projection UUID
as the member's `id` in `panel.json`. Keep it when rearranging or renaming the member. Use `target.projectionId`
to reuse an existing projection.

Register trial pages under an application ID starting with `app-`. Give every application use a `pageKey` unique within its domain.
For a trial app open to its domain, set `entryAccess: ["domain-member"]` and each public use's
`access: {kind: "domain-member"}`. For a restricted trial, declare a permission owned by that app, such as
`app:app-my-management-page:view`, and use it in `entryAccess` and `access.permissionCode`.
Set the use's localized `names` for the title beside conversations. The panel name supplies the fallback title.
Choose a domain app's `declaration.icon` from the [domain icon choices](RUNTIME.md#imports-and-application-icons).

Omit the use's `defaultAgent` for the general assistant in a trial. Set `{kind: "id", id}` or
`{kind: "preset", agentKind}` when that agent already selects this panel's skill and appears in the page
input box's candidates. Keep the general assistant while the preset's owner wires up its skill. When replacing
a built-in page, retain its existing default-agent behavior.

For an application delivery list, declare only extra `packages`, `agents` and `skills`. The platform derives the
panel and projection dependencies from registered uses.

Use the [agent directory example](../../examples/vue-agent-directory/panel.html) for the complete layout and owner
form wiring. Give your own panel and use their own IDs. The example opens at `/applications/app-example-vue-agent-directory/manage`.
Exercise the page and run the [assistant check](SKILL.md#check-the-assistant-from-the-page).

## When a panel looks wrong

Open the same registered entry without draft or state query parameters first. In the browser, keep the
Network log while reloading and read the first relevant failure and its response. Use the console's first
error for a Vue or module failure. Keep the browser's storage and cookies intact.

- **Blank panel or `panel-host-error`.** Start with the alert, console, the panel's
  `GET /api/product-panels/<id>` (or `/snapshot` on a recheck), and the SDK asset requests. Use
  `panel uses <app-id>` to verify the path and bound panel, `panel get <panel-id>` for its manifest and revision,
  and `panel projection <id>` for a member's registered definition. Compare with the workspace and run
  `panel check <directory>`. If the definition loads and the module fails, check the import rules, Vue template
  and member slots.
- **List is empty or waiting.** Find that member's `POST /api/product-panels/read` by `memberPath` and `dataName`.
  Compare `inputs` and `runtimeParams` with `panel type <type-id> --read <name>`. Missing required inputs can
  leave it awaiting with no request. If the owner returns no rows, check the selection, filters and reader's
  data access. If it returns rows, check the slot and the component's accepted result shape.
- **Draft does not fill or shows `Required`.** Inspect `GET /api/assistant/sessions/<session-id>/runs/<run-id>/page-draft?path=…`,
  then the form's `POST /api/product-panels/read`. Match the producing run and artifact, the entry's
  `pageKey`, the target's `objectType` and optional owner ID, and the owner's `save.draftOperation`.
  A successful draft read confirms that the artifact loaded. Follow the form read's response to see whether
  the owner accepted the proposal. Keep the form
  mounted while waiting for `instance.draft`.

A field or path named by `panel check` points to the material to fix. For a rejected request, use its response
to distinguish missing records, denied access and invalid values. If the registered material matches the
current SDK and owner contract but a conforming request still fails, report the first failing response or console
error, entry and member IDs, panel revision and the release from `sdk current` to the platform or owner team.

## What the assistant receives

The platform builds page context from the registered entry's title and address and the current object and
child-object selections in declared panel state. A selection supplies the type and ID, including a child's
parent and collection, plus a display name when the page already knows it. The assistant uses the panel's
declared reads to obtain current fields for that selection.

Put page-specific instructions in `recipes.md` beside the panel files. Registration includes them as
`content.recipes`. The platform derives the panel skill from its declared reads, state, forms and operations
and these recipes. The composer sends the current registered use so the platform can admit that skill for the
reader. Verify this through the [page input box](SKILL.md#check-the-assistant-from-the-page).
