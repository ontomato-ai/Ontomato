import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { zodToJsonSchema } from "zod-to-json-schema";
import { referenceMarkdown, componentMetadata } from "../../apps-sdk/reference.mjs";
import { ENTRIES } from "../../apps-sdk/release-entries.mjs";
import capabilityMap from "../../apps-sdk/examples/panels/capability-map/declaration.mjs";
import { panelAddress, PANEL_ADDRESS_RESERVED_QUERY_KEYS, panelDataStateSchema } from "../src/panel-host.ts";
import { directPanelPortTypeSchema, panelChildObjectIdentitySchema, panelStateFieldSchema } from "../src/panel-manifest.ts";
import { panelModuleSpecifiers } from "../src/panel-module.ts";
import { SDK_COMPONENT } from "../src/platform-object-types.ts";

const destination = new URL("../../../agent-skills/ontomato-app-builder/references/panel-authoring/RUNTIME.md", import.meta.url);
const root = fileURLToPath(new URL("../../apps-sdk/", import.meta.url));
const tsconfig = fileURLToPath(new URL("../../apps-sdk/tsconfig.json", import.meta.url));
const source = fileURLToPath(new URL("../../apps-sdk/src/catalogue.ts", import.meta.url));
const entries = ENTRIES.filter(({ specifier }) => [panelModuleSpecifiers.sdk, "@ontomato/sdk/base"].includes(specifier));
const reference = referenceMarkdown({ root, tsconfig, entries });
const sections = new Map(reference.split(/^### /mu).slice(1).map(section => [
  section.split("\n", 1)[0],
  section.split(/^## /mu)[0].trimEnd(),
]));

function sdkSection(name) {
  const section = sections.get(name);
  assert.ok(section, `SDK reference is missing '${name}'`);
  const signature = section.lastIndexOf("\n```ts\n");
  assert.ok(signature >= 0, `SDK reference has no declaration for ${name}`);
  const description = section.slice(0, signature).split("\n```")[0].trimEnd();
  return "### " + description + "\n" + section.slice(signature);
}

function sdkFields(name, fields) {
  const text = sdkSection(name).split("```ts\n")[1].split("\n```")[0];
  const source = ts.createSourceFile("reference.ts", text, ts.ScriptTarget.ESNext, true);
  const [declaration] = source.statements;
  const selected = declaration.members.filter(member => fields.includes(member.name.getText(source)));
  assert.ok(selected.length, `SDK reference is missing fields of '${name}'`);
  const fence = "```";
  return [
    "### " + name,
    "",
    fence + "ts",
    "interface " + name + " {" + selected.map(member => member.getFullText(source)).join("") + "\n}",
    fence,
  ].join("\n");
}

function contractType(schema, root = schema) {
  if (schema.$ref) {
    const target = schema.$ref.split("/").slice(1).reduce((object, key) => object[key], root);
    return contractType(target, root);
  }
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (!schema.properties) {
    assert.ok(schema.type);
    return schema.type;
  }
  return `{ ${Object.entries(schema.properties).map(([name, field]) =>
    `${name}: ${contractType(field, root)}`).join("; ")} }`;
}

const catalogue = componentMetadata({ tsconfig, source }).map(({ metadata }) => metadata);
const { data: listReads } = catalogue.find(({ componentId }) => componentId === "ObjectList");
const listSize = sections.get("`<object-list>` ObjectList").split("\n").find(line => line.startsWith("| `page-size` |"));
assert.ok(listSize, "The ObjectList reference is missing pageSize");
const portSchema = zodToJsonSchema(directPanelPortTypeSchema);
const port = portSchema.anyOf.flatMap(alternative => alternative.anyOf ?? [alternative])
  .find(alternative => alternative.properties?.kind?.const === "child-object");
const child = zodToJsonSchema(panelChildObjectIdentitySchema);
const deepLink = zodToJsonSchema(panelStateFieldSchema).properties.deepLink;

const graphState = {
  mode: "type",
  selectedType: SDK_COMPONENT,
};
assert.ok(Object.keys(graphState).every(name => capabilityMap.state[name].deepLink));
const graphSelection = panelStateFieldSchema.parse(capabilityMap.state.selected);
const graphAddress = panelAddress("/destination", graphState);
const graphQuery = new URL(graphAddress, "http://runtime-reference.invalid").search;

const mark = "`";
const asCode = value => mark + value + mark;
const inline = values => values.map(asCode).join(", ");

const datumStatuses = panelDataStateSchema.options.map(variant => variant.shape.status.value);
const contents = [
  "<!-- Generated from SDK declarations and panel contracts by pnpm --filter @ontomato/contracts generate:panel-runtime-reference. -->",
  "# Panel runtime reference",
  "",
  "## Imports",
  "",
  `Direct panel modules can import ${inline(Object.values(panelModuleSpecifiers))}.`,
  "",
  'For a domain application, choose `declaration.icon` from `node "$SKILL/scripts/ontomato.mjs" sdk icons` (all catalogue icons are available).',
  "To show an application by its icon key, draw `<component :is=\"appIcon(key)\" :size=\"16\" />` with `appIcon` from",
  "`@ontomato/sdk/panel`: it is the platform's own icon for the key, and an unknown key draws the platform's fallback.",
  "",
  "## Vue setup",
  "",
  sdkSection("usePanelContext"),
  "",
  sdkFields("PanelContext", ["instance", "refreshing", "refreshObjects", "t", "navigate", "notify", "confirmLeaveUnsaved", "currentEntry", "entryMenu", "currentUser", "hasLocalDraft"]),
  "",
  sdkFields("PanelInstance", ["state", "outputs", "pageContext", "forms", "refreshing", "onObjectChanged", "refreshObjects"]),
  "",
  sdkSection("PanelStateStore"),
  "",
  sdkSection("usePanelOutput"),
  "",
  "`usePanelOutput` reads from `instance.outputs`. Outputs are published by mounted projections. Subscribing never mounts a",
  "member or starts its reads. The component requests its named data when it mounts. An output with no",
  "published value is `null`. Use an `inputs` binding such as `{ output: { member, name, path } }` to connect",
  "the output directly to another member. Omit `path` for the whole value or use a JSON Pointer for a nested value.",
  "",
  sdkSection("usePanelOutputs"),
  "",
  sdkSection("usePanelFormDraft"),
  "",
  sdkSection("UsePanelFormDraftOptions"),
  "",
  sdkSection("PageHeaderDraft"),
  "",
  sdkSection("AppMenuGroup"),
  "",
  sdkSection("AppMenuItem"),
  "",
  sdkSection("PanelFormHandle"),
  "",
  "`PanelFormHandle.refreshDraft()` refreshes the owner's fields, options and errors in place while the form is dirty,",
  "preserving the unsaved draft and its baseline. A clean form adopts the new description and baseline.",
  "",
  "On `<object-form-fields>`, use either `:parent` or `:fields`. Setting `:parent` makes the component ignore `:fields`.",
  "Use `:parent=\"activeClassParent\" :exclude=\"['/rowPermission']\"` to omit a child of that parent, or omit `:parent`",
  "and pass full absolute JSON pointers in `:fields`.",
  "",
  sdkSection("usePanelNarrow"),
  "",
  sdkSection("UsePanelNarrowOptions"),
  "",
  sdkSection("usePanelBack"),
  "",
  "Back layers close last-in first-out. `<sdk-dialog>` and `<sdk-drawer>` automatically guard dirty forms registered",
  "through `useProjectionForm` before closing via the close button, backdrop, Escape, or `handleClose()`. Discarding",
  "clears only the dirty forms inside that overlay. For a form dialog with a Back layer, bind `:model-value` and",
  "`:before-close`. Call `done()` only when `await dialogBack.back()` returns true. Drive a custom Save button with",
  "`usePanelFormDraft`. Use the same Back layer for the dialog's Cancel button.",
  "",
  sdkSection("UsePanelBackOptions"),
  "",
  sdkSection("PanelBackHandle"),
  "",
  sdkSection("savePanelFile"),
  "",
  "## Projection outputs and operations",
  "",
  `A mounted \`ObjectList\` or \`ObjectHeader\` exposes its datum status as ${inline(datumStatuses)}. Before the member`,
  "publishes, its status output is `null`. Keep the header mounted for a selected record so the component can",
  "display the owner's missing, forbidden, or error state in place. Owner-declared read outputs pass through to",
  "`usePanelOutput`, alongside the header's own `label`, `status`, and `errorMessage`.",
  "",
  'For the current list batch, read `usePanelOutput("list", "listed")`. It returns typed references when ready,',
  "`[]` when empty, and `null` when unavailable or before the first result. Keep the output separate from public",
  "state. Searches, filters, sorting, and paging preserve the selection. Only default-select when there was no",
  "selection on open. Keep a specified missing or forbidden selection in place. Use `v-show` to retain a list across",
  "tab switches. `total` is owner-reported, `loadedCount` counts loaded rows, and `filteredCount` counts local matches",
  "only for a complete unpaged list without server search. Unavailable counts are `null`.",
  "",
  "Before refreshing for `affected.removed`, `letGo(removed)` discards drafts targeting removed objects or bound to",
  "parent state about to be cleared. It then clears matching object state and removes deleted references from checked lists.",
  "",
  sdkSection("usePanelOperation"),
  "",
  sdkSection("UsePanelOperationOptions"),
  "",
  sdkSection("PanelOperationHandle"),
  "",
  "### Operation IDs and write results",
  "",
  "The member declaration's `operation` is the owner's full ID. Invoke using the member-qualified ID from the page",
  "skill's Declared operations. For a member `opRunNow` declaring `schedules.runNow`, pass `opRunNow.runNow`",
  "as `operation` to `page_action`. In Vue, the same binding is `usePanelOperation(\"opRunNow\", \"runNow\", options?)`,",
  "which registers a mounted page action entry automatically. Pass `{ entry: false }` for a background flow or",
  "to subscribe ahead of time to an operation behind a dialog. For example,",
  "`usePanelOperation(\"submit\", \"apply\", { entry: false })` exposes the operation read through `state`. Once",
  "`state.value.status === \"ready\"`, use `state.value.value.apply?.unavailable?.reason` in the outer toolbar.",
  "Only the dialog's `OperationButton` registers a `page_action`.",
  "",
  "In Vue, call the hook’s `run(input)`. The SDK obtains the target from the binding and the host",
  "handles confirmation and requests. For an action write, the hook resolves to a receipt. Read these fields before",
  "updating the editor or announcing a successful write.",
  "",
  "- `decision: \"cancel\"` means the user cancelled. Keep the editor open.",
  "- On `decision: \"confirm\"`, read `response`. If its kind is `not-dispatched`, show its message.",
  "- For a single dispatched call, `response.outcome.kind === \"success\"` confirms the write. Use its `data` and then",
  "  show success. On `refusal` or `failure`, keep the edits and show the owner's message and any named field errors.",
  "- A successful create carries the owner-reported `created: { objectType, primaryKey }`, also available as",
  "  `operation.created` on completion. Without it, the success has no key to navigate to. Use `affected` for refresh.",
  "- A null or `unknown` outcome leaves the result unconfirmed. A batch receipt reports one outcome per item.",
  "",
  "`OperationInputDialog` uses password inputs for owner fields with `secret: true`. `PanelHost` mounts",
  "`SecretDeliveryDialog` once per panel and delivers one-time secrets from all write entries, including",
  "`ObjectForm`, `OperationButton`, `ObjectList` row actions and `usePanelOperation`. The operator receives the",
  "secret. Assistant observation hides the plaintext, and the assistant leaves secret entry and delivery to the person.",
  "",
  "## Page header and navigation",
  "",
  "Place the official presentational `<page-header>` component at the top of a panel's content when the page needs a",
  "header, and omit it for headerless pages. Pass `title` (or a `#title` slot with a projection-bound component such as",
  "`<projection>` / `ObjectSummary`), optional `description`, optional `back-label` + `@back` wired to `usePanelBack`",
  "or `navigate`, right-side controls in `#actions` (such as ordinary `<sdk-button>`, `<OperationButton>`, inline counts,",
  "or search inputs), and optional `:draft` from `usePanelFormDraft` for Save/Discard/unsaved feedback. Buttons in",
  "`<page-header>` change declared panel state or call declared owner operations, so skills continue to produce valid",
  "deep-link addresses and `page_action` calls.",
  "",
  "For a browser button or component output that should navigate, call `usePanelContext().navigate` with the registered path",
  "from `panel uses <application-id>` and, when needed, the destination's deep-linkable state.",
  "",
  "On `ObjectForm`, set `config.actions` to `\"footer\"` (default, non-overlapping document-flow bar), `\"create-only\"`",
  "(Cancel/Create bar only in create mode when edit Save/Discard lives in `<page-header>` via `usePanelFormDraft`), or",
  "`\"none\"` (omit the bar in both modes). To split one form's fields across multiple cards (1 or 2 columns), tabs, or",
  "wizard steps while sharing one form state, validation, dirty tracking, `usePanelFormDraft`, `usePanelBack`, and agent",
  "drafts, set `config.presentation` (`\"cards\" | \"tabs\" | \"steps\"`) with `config.groups` (or owner `sections`), or place",
  "`<object-form-fields :fields=\"...\" />` / `<object-form-fields rest />` slices inside `ObjectForm`'s `#default` slot.",
  "`ObjectForm` automatically shows word counters for schema `maxLength` fields and",
  "disables cascading select fields whose owner declares `disabledWhenEmpty`.",
  "",
  "## General display components and MetricView `result` binding",
  "",
  "Use the five official general display components (available both as projection components and as `<kebab-case>` tags",
  "in panel templates / slots) instead of formatting business fields in panel HTML:",
  "",
  "- `<typed-value>` (`TypedValue`): formats one typed field value (text, number, date/datetime/relative-time, boolean,",
  "  status tag, tags, clickable object reference, localized map, list, code/JSON) from `data.record`, `data.result`",
  "  (`metricOutput` scalar/first-row or named column), or a direct `value` prop. Supports exact-match `valueMap`",
  "  (`{ [rawValue]: { label?, labelKey?, labels?, tone?, icon? } }`) for mapping raw codes/booleans/enums to localized",
  "  text, semantic tones, and platform icons (pure exact match; no calculation or range/threshold expressions).",
  "- `<record-template>` (`RecordTemplate`): fills already-provided values from `data.record` or one row of",
  "  `data.result` (`metricOutput`) into a fixed `{fieldKey}` sentence template (`template`, `templateKey`, or",
  "  locale-keyed `templates`, with per-field `fieldFormats` including `valueMap`). Strictly presentation-only: no",
  "  expressions, calculation, or conditional sentence branching.",
  "- `<info-banner>` (`InfoBanner`): standardized `info`/`success`/`warning`/`danger` callout banner supporting static/",
  "  localized copy, slots, or already-provided `data.record` / `data.result` fields and fixed templates, plus exact-match",
  "  `toneMap`/`valueMap` and platform `icon`.",
  "- `ObjectList` columns also accept `column.valueMap` with the same exact-match `{ label?, labelKey?, labels?, tone?, icon? }`",
  "  shape (or use `<typed-value :value=\"value\" :value-map=\"...\" />` inside `#cell-<columnKey>` slots).",
  "- `<object-ref-card>` (`ObjectRefCard`): clickable object reference card (icon/monogram, caption, localized name,",
  "  monospace identifier, optional badge) from `data.record` (via `field` or the record itself), `data.result`, or a",
  "  direct `reference` prop — ideal for composing relationship `Source → Target` blocks. Declares output `navigate`",
  "  (bindable via `state: { navigate: \"...\" }`, typed by `config.targetClassName`, the bound record type, or an",
  "  ontology `object-union`) in addition to emitting `@navigate`.",
  "- `<metric-card>` (`MetricCard`): single or multi-KPI statistic cards (`card`, `compact`, or `inline` variants) bound",
  "  directly to `data.result` (`metricOutput`), `data.record`, `data.rows`, `data.objects`, or standalone `value`/`items`.",
  "- `<grouped-grid>` (`GroupedGrid`): responsive CSS grid arranging `data.rows` (`panelRecordList`) into collapsible",
  "  groups (optionally ordered/preserving empty groups from a parent `data.record` via `groupsField`) with stacked",
  "  sections (`sectionField`, `sectionOrder`, per-section `rowHeight`), drag-and-drop reordering, pointer cell resizing,",
  "  `selected`, built-in per-item `rowActions`, and scoped slots (`#item`, `#item-header-actions`, `#group-header-actions`,",
  "  `#group-empty`, `#empty`). Emits `layout-change` only when the reader finishes a drag or resize interaction.",
  "- `<operation-result>` (`OperationResult`): renders a read-only panel operation's result (`markdown`, `json`, `file`,",
  "  or multi-section `sections` with tabbed `records` tables, language-tagged `code`, and `json` panes).",
  "- `<object-list>` (`ObjectList`) also supports `layout: \"tabs\"` (horizontal tab strip with overflow buttons, per-tab",
  "  `rowActions`, and `#tabs-extra`), `dynamicColumns: true` (derives table columns from owner `fieldLabels` and record",
  "  `fields` when no static `columns` are set), `showColumnToggle`, and `exportable` (current-page UTF-8 BOM CSV export).",
  "  For customer `ObjectType` `query` reads, bind `data.rows.params.filters` (`[{ field, operator, value? }]` with",
  "  `eq|ne|contains|gt|lt|gte|lte|null|notnull`) and `data.rows.params.sort` (`{ field, order: \"asc\" | \"desc\" }`) to",
  "  `json` state (`default: null`) for whole-class server filtering and sorting before `total` and paging.",
  "- `<object-text-reader>` (`ObjectTextReader`) supports `format: \"auto\" | \"plain\" | \"markdown\" | \"table\" | \"code\" | \"diff\"`",
  "  (parsing standard unified diffs into file summaries and line-numbered hunks) and writes clicked relative `.md` links",
  "  to `activePath`.",
  "- `<conversation-entry>` (`ConversationEntry`) defaults to `presentation=\"button\"` (expands the page composer) and",
  "  also supports `presentation=\"inline\"` (embeds the platform's inline composer and serves sibling `ConversationEntry`",
  "  buttons; pair with `pageComposer: \"none\"` on the application entry to suppress the bottom floating composer).",
  "- Calling `.refresh()` on a `<projection ref=\"...\">` template ref refreshes that single mounted member in place",
  "  without reloading the rest of the panel.",
  "",
  "Every entry (full page or beside a conversation) receives a content box with no host page header, host padding, or",
  "outer card frame. Style panels with normal HTML, CSS, and Vue (prefer container-relative sizing and CSS `@container`",
  "rather than `window.innerWidth` or viewport units so the layout stays comfortable when hosted beside a conversation),",
  "and use `<sdk-dialog>` / `<sdk-drawer>` for overlays. When a single panel hosts an editable in-panel sub-view (rather",
  "than navigating to a separate detail entry), wire `usePanelBack` so browser Back, Escape, and in-page back buttons",
  "share the host's unified unsaved-changes guard.",
  "",
  "`SdkPopover`, `SdkDialog` and `SdkDrawer` mount inside the panel's `[data-panel-overlay-root][data-panel-instance]`.",
  "Panel `<style>` is native browser CSS and applies to these overlays directly. The host scopes it to the panel",
  "instance. Use ordinary descendant selectors and omit the Vue SFC selectors `:deep` and `::v-deep`.",
  "",
  "## Live remote control by assistants",
  "",
  "Assistants beside a displayed panel operate directly through four live tools on the real-time presentation channel:",
  "- `observe_display`: read the latest live public state and open form values (including unsaved user edits).",
  "- `present`: navigate to a site-relative entry path or update declared public state in place (including non-`deepLink` state such as dialogs, tabs, and selections).",
  "- `fill_form`: fill explicit fields into a mounted live `ObjectForm` through its own edit entry, highlighting changed fields and keeping the form unsaved (refuses to overwrite fields with unsaved user edits unless the user confirms and the agent passes `overwriteUnsaved: true`).",
  "- `page_action`: execute a declared operation (including form save, button actions, row actions with `rowKey` in the exact `<ClassName>:<primaryKey>` format copied verbatim from the snapshot row, batch actions on checked items, nested panel actions, `page.refresh`, or `<form>.discard`) through the exact same UI entry a user clicks, under the logged-in user's permissions.",
  "",
  "The mounted `ObjectForm` owns its live values and submission. When an agent's same-page `present` would switch",
  "a dirty form's target or unmount it, the host returns `blocked_unsaved`. Unrelated state updates succeed while",
  "the dirty form stays mounted on the same target. Human controls that switch, close, or cancel a form use the",
  "panel's unsaved confirmation. `ObjectForm` also guards changes to both its `requestedTarget` and",
  "`requestedFixedValues` before taking up the new target or fixed values.",
  "",
  "When a selection watcher resets related fields, use `instance.state.lastPatchedKeys` to preserve fields explicitly",
  "set in the same state patch, such as a trial dialog and its parameters supplied together by `present`.",
  "",
  "Use `v-if` or operation availability/disabled conditions when an entry cannot be used now. Use `v-show` for",
  "stateful content the reader could still use after switching a tab, expanding a section, or returning to a list.",
  "",
  "## List paging",
  "",
  `ObjectList's ${asCode("data.rows")} accepts ${inline(listReads.rows.results)} and supplies the declared parameters ${inline(listReads.rows.runtimeParams)}.`,
  "",
  "| Prop | Type | Required | Default | Description |",
  "| --- | --- | --- | --- | --- |",
  listSize.replace("`page-size`", "`config.pageSize`"),
  "",
  "## State in an address",
  "",
  `The ${asCode("deepLink")} flag is ${deepLink.type} and defaults to ${deepLink.default}. Only state needed for another`,
  "reader to land on the same view (selected object, tab, view mode, list search/filter/sort) may set `deepLink: true`;",
  "dialog toggles (such as `creating`, `grantDialog`) and active-edit trackers (such as `editingEntryId`) must remain",
  "public state without `deepLink: true`.",
  "",
  "Each `deepLink: true` field has its own flat query parameter. Single-type `object` fields use bare",
  "`primaryKey` (`?selected=my-app`), `object-union` fields use `className~primaryKey`, and list fields repeat",
  "the parameter (`?tag=a&tag=b`). An empty list uses `?tag=`. Frame fields use the `frame.` prefix",
  "(`?frame.term=2026-fall`). Build in-app links with `panelAddress(path, state)` from `@ontomato/sdk/panel`.",
  `The shell owns ${inline(PANEL_ADDRESS_RESERVED_QUERY_KEYS)}.`,
  `The capability-map type view uses ${asCode(JSON.stringify(graphState))} as state; the address contract encodes it as ${asCode(graphQuery)}.`,
  "",
  "### Graph selection",
  "",
  "The capability map uses this declaration for its public `selected` state:",
  "",
  "```json",
  JSON.stringify(graphSelection, null, 2),
  "```",
  "",
  "An `object-union` admits one object reference of a type in the selected ontology layers, the explicit `objectTypes`, or both.",
  "The value has `className` and `primaryKey`. Linking the graph and relation list to this same state keeps their selection in sync.",
  "",
  "### Child objects",
  "",
  `- State field type ${asCode(contractType(port, portSchema))}.`,
  `- A value in that field ${asCode(contractType(child))}.`,
  "",
  "### Object reference shapes quick reference",
  "",
  "| Where | Shape |",
  "| --- | --- |",
  "| Panel state, `@saved` event | `{ className, primaryKey }` |",
  "| URL query parameter (`deepLink: true`) | `primaryKey` (fixed `object`) or `className~primaryKey` (`object-union`) |",
  "| `instance.pageContext.value.selection` item | `{ id, label, ... }` |",
  "",
  "## Application icons",
  "",
  'Choose an application\'s `declaration.icon` from `node "$SKILL/scripts/ontomato.mjs" sdk icons`.',
  "To render an application icon by key in a catalog panel, draw `<component :is=\"appIcon(key)\" :size=\"16\" />` with",
  "`appIcon` from `@ontomato/sdk/panel`.",
  "",
].join("\n");

if (process.argv.includes("--check")) {
  assert.equal(await readFile(destination, "utf8"), contents, "Regenerate the panel runtime reference");
} else {
  await writeFile(destination, contents);
}
