import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { zodToJsonSchema } from "zod-to-json-schema";
import { referenceMarkdown, componentMetadata } from "../../apps-sdk/reference.mjs";
import { ENTRIES } from "../../apps-sdk/release-entries.mjs";
import capabilityMap from "../../apps-sdk/examples/panels/capability-map/declaration.mjs";
import { panelAddress, panelDataStateSchema } from "../src/panel-host.ts";
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

const directCode = await readFile(new URL("../../apps-sdk/src/panel/direct.ts", import.meta.url), "utf8");
const directSource = ts.createSourceFile("direct.ts", directCode, ts.ScriptTarget.ESNext, true);
const sdkTypes = new Map(directSource.statements.filter(ts.isTypeAliasDeclaration)
  .map(statement => [statement.name.text, statement.getText(directSource).replace(/^export /u, "")]));
assert.ok(sdkTypes.has("MemberDataState"));
const outputRows = panelDataStateSchema.options.map(variant => [
  asCode(variant.shape.status.value),
  Object.keys(variant.shape).filter(name => name !== "status").map(asCode).join(", "),
]);
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
  sdkFields("PanelContext", ["instance", "t", "navigate", "notify", "currentEntry", "entryMenu"]),
  "",
  sdkFields("PanelInstance", ["state", "outputs", "pageContext", "forms", "onObjectChanged", "refreshObjects"]),
  "",
  sdkSection("PanelStateStore"),
  "",
  sdkSection("usePanelOutput"),
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
  sdkSection("usePanelBack"),
  "",
  sdkSection("UsePanelBackOptions"),
  "",
  sdkSection("PanelBackHandle"),
  "",
  sdkSection("savePanelFile"),
  "",
  "## Reads and operations",
  "",
  sdkSection("usePanelData"),
  "",
  `The result type is ${asCode(sdkTypes.get("MemberDataState"))}.`,
  "",
  "| Status in PanelDataState | Additional fields |",
  "| --- | --- |",
  ...outputRows.map(row => `| ${row.join(" | ")} |`),
  "",
  "A datum in `error` also carries `retry()`, which reads it again: offer it beside the message. When the platform never",
  "answered (the request reached nothing), `unreachable` is `true` and `message` already says so in the reader's language;",
  "show `message` as it is.",
  "",
  sdkSection("usePanelOperation"),
  "",
  sdkSection("PanelOperationHandle"),
  "",
  "### Operation IDs and write results",
  "",
  "The member declaration's `operation` is the owner's full ID. Invoke using the member-qualified ID from the page",
  "skill's Declared operations. For a member `opRunNow` declaring `schedules.runNow`, pass `opRunNow.runNow`",
  "as `operation` to `page_action`. In Vue, the same binding is `usePanelOperation(\"opRunNow\", \"runNow\")`.",
  "",
  "In Vue, call the hook’s `run(input)`. The SDK obtains the target from the binding and the host",
  "handles confirmation and requests. For an action write, the hook resolves to a receipt. Read these fields before",
  "updating the editor or announcing a successful write.",
  "",
  "- `decision: \"cancel\"` means the user cancelled. Keep the editor open.",
  "- On `decision: \"confirm\"`, read `response`. If its kind is `not-dispatched`, show its message.",
  "- For a single dispatched call, `response.outcome.kind === \"success\"` confirms the write. Use its `data` and then",
  "  show success. On `refusal` or `failure`, keep the edits and show the owner's message and any named field errors.",
  "- A null or `unknown` outcome leaves the result unconfirmed. A batch receipt reports one outcome per item.",
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
  "",
  "Every entry (full page or beside a conversation) receives a content box with no host page header, host padding, or",
  "outer card frame. Style panels with normal HTML, CSS, and Vue (prefer container-relative sizing and CSS `@container`",
  "rather than `window.innerWidth` or viewport units so the layout stays comfortable when hosted beside a conversation),",
  "and use `<sdk-dialog>` / `<sdk-drawer>` for overlays. When a single panel hosts an editable in-panel sub-view (rather",
  "than navigating to a separate detail entry), wire `usePanelBack` so browser Back, Escape, and in-page back buttons",
  "share the host's unified unsaved-changes guard.",
  "",
  "## Live remote control by assistants",
  "",
  "Assistants beside a displayed panel operate directly through four live tools on the real-time presentation channel:",
  "- `observe_display`: read the latest live public state and open form values (including unsaved user edits).",
  "- `present`: navigate to a site-relative entry path or update declared public state in place (including non-`deepLink` state such as dialogs, tabs, and selections).",
  "- `fill_form`: fill explicit fields into a mounted live `ObjectForm` through its own edit entry, highlighting changed fields and keeping the form unsaved (refuses when unsaved edits exist unless `overwriteUnsaved: true` is confirmed by the user).",
  "- `page_action`: execute a declared operation (including form save, button actions, row actions with `rowKey`, batch actions on checked items, nested panel actions, `page.refresh`, or `<form>.discard`) through the exact same UI entry a user clicks, under the logged-in user's permissions.",
  "",
  "The mounted `ObjectForm` owns its live values and submission.",
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
  "Each `deepLink: true` field is written as its own flat named query parameter (default/empty values are omitted; JSON is",
  "never serialized into `?state=` or `?frame=`). Single-type `object` fields use bare `primaryKey` (`?selected=my-app`),",
  "`object-union` fields use `className~primaryKey`, `list` fields repeat the parameter (`?tag=a&tag=b`), and application",
  "frame deep-link fields use the `frame.` prefix (`?frame.term=2026-fall`). Use `panelAddress(path, state)` from",
  `${asCode("@ontomato/sdk/panel")} to build in-app links cleanly.`,
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
