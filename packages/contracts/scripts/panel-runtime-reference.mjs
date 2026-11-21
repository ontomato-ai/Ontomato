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
import { PAGE_DRAFT_QUERY_KEYS } from "../src/page-draft.ts";
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
const agentDirectory = JSON.parse(await readFile(new URL(
  "../../../agent-skills/ontomato-app-builder/examples/vue-agent-directory/registration.json", import.meta.url,
), "utf8"));
const draftEntryExample = agentDirectory.applications[0].input.panelUses[0].path;
const [draftSessionKey, draftRunKey, draftPathKey] = PAGE_DRAFT_QUERY_KEYS;
const draftQueryExample = new URLSearchParams({
  [draftSessionKey]: "SESSION_ID",
  [draftRunKey]: "RUN_ID",
  [draftPathKey]: "outputs/drafts/edit.page-draft.json",
});

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
  "## Imports and application icons",
  "",
  `Direct panel modules can import ${inline(Object.values(panelModuleSpecifiers))}.`,
  "",
  'For a domain application, choose `declaration.icon` from `node "$SKILL/ontomato.mjs" sdk icons`.',
  "The built-in icons identify the platform's own entries.",
  "To show an application by its icon key, draw `<component :is=\"appIcon(key)\" :size=\"16\" />` with `appIcon` from",
  "`@ontomato/sdk/panel`: it is the platform's own icon for the key, and an unknown key draws the platform's fallback.",
  "",
  "## Vue setup",
  "",
  sdkSection("usePanelContext"),
  "",
  sdkFields("PanelContext", ["instance", "t", "navigate", "notify", "currentEntry", "entryMenu"]),
  "",
  sdkFields("PanelInstance", ["state", "pageContext", "draft", "onObjectChanged", "refreshObjects"]),
  "",
  sdkSection("PanelStateStore"),
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
  "skill's Declared operations. For a member `opRunNow` declaring `schedules.runNow`, send `opRunNow.runNow`",
  "as `operationId` to `/operate`. In Vue, the same binding is `usePanelOperation(\"opRunNow\", \"runNow\")`.",
  "",
  "For an assistant call on an existing object, send a typed `call.target`, for example:",
  "",
  "```json",
  '{ "target": { "kind": "object", "objectType": "platform:ScheduledTask", "primaryKey": "<task-id>" }, "input": {} }',
  "```",
  "",
  "The corresponding panel selection stores `{className, primaryKey}`. On the wire, map `className` to `objectType` and add",
  '`kind: "object"`. In Vue, call the hook’s `run(input)`. The SDK obtains the target from the binding and the host',
  "handles confirmation and requests. For an action write, the hook resolves to a receipt. Read these fields before",
  "updating the editor or announcing a successful write.",
  "",
  "- `decision: \"cancel\"` means the user cancelled. Keep the editor open.",
  "- On `decision: \"confirm\"`, read `response`. If its kind is `not-dispatched`, show its message.",
  "- For a single dispatched call, `response.outcome.kind === \"success\"` confirms the write. Use its `data` and then",
  "  show success. On `refusal` or `failure`, keep the edits and show the owner's message and any named field errors.",
  "- A null or `unknown` outcome leaves the result unconfirmed. A batch receipt reports one outcome per item.",
  "",
  "## Header commands and navigation",
  "",
  "Declare each page-header command under `manifest.commands` with a localized `labelKey` and a `do` action; at most one",
  "is `primary: true`, the header's main button. `manifest.commands` is required; use `commands: {}` when the panel has no",
  "header commands. A command's values are literals or state fields. A `do.set` field must be a `deepLink: true` state",
  "field, so the changed address reproduces the page. Handle component-driven interactions (a selection, an output) in Vue.",
  "`do.open` with `mode: \"entry\"` describes a `platform:ApplicationPanelUse` reference and optional destination state inputs.",
  "In the current direct runtime, an open command reports that the SDK opens no entry or member from a command.",
  "For a browser button or component output that should navigate, call `usePanelContext().navigate` with the registered path",
  "from `panel uses <application-id>` and, when needed, the destination's deep-linkable state.",
  "",
  "The generated page skill's Panel commands section gives the assistant the address or operation for each command.",
  "`do.set` opens the current entry with the changed deep-linkable fields in `state`. `do.invoke` calls the listed",
  "owner operation. `do.open` follows the indicated destination address. Use a declared operation ID for `/operate`.",
  "",
  "## Draft links and instance state",
  "",
  "Copy the registered entry path, including its initial slash, and keep any existing entry parameters.",
  "Every draft link in a reply is a site-relative Markdown destination. Put one slash first and omit the scheme,",
  "hostname and port, including `localhost`. Neither `http://`, `https://`, nor `//host` belongs in the destination.",
  "Use the producing session and run IDs. Give `draftPath` only the run-relative artifact path",
  "`outputs/drafts/<name>.page-draft.json`. Encode that value once.",
  "",
  `For the agent directory, the reply is ${asCode(`[Open the draft](${draftEntryExample}?${draftQueryExample})`)}.`,
  "",
  "A raw `draftPath` of `/outputs/drafts/edit.page-draft.json` starts with a slash and is invalid.",
  "The encoded query value `draftPath=%2Foutputs%2Fdrafts%2Fedit.page-draft.json` still starts with that slash after decoding.",
  "",
  "The SDK reads the artifact, verifies it was written for the entry's `pageKey`, and offers it to the mounted forms.",
  "The target identifies the object type and, for an edit, the owner's object ID. A form of that type matches",
  "`save.draftOperation` and gives the owner's form read the proposed field values to check. If the owner accepts",
  "changed fields, the SDK fills the form and sets `instance.draft`.",
  "Keep the form projection mounted with `v-show` so it can receive the draft before the editor is visible.",
  "Watch `instance.draft` to reveal the editor. It is null while waiting or when the draft changes nothing.",
  "Use [`draftTarget(draft)`](CODE.md#save-a-form-or-hand-off-a-draft) to get the accepted draft's effective create or update target.",
  "The reader saves or discards the proposed change in the form.",
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
  `The ${asCode("deepLink")} flag is ${deepLink.type} and defaults to ${deepLink.default}. The capability-map type view uses`,
  `${asCode(JSON.stringify(graphState))} as state. The address contract encodes it as ${asCode(graphQuery)}.`,
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
].join("\n");

if (process.argv.includes("--check")) {
  assert.equal(await readFile(destination, "utf8"), contents, "Regenerate the panel runtime reference");
} else {
  await writeFile(destination, contents);
}
