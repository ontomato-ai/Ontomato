import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { zodToJsonSchema } from "zod-to-json-schema";
import { referenceMarkdown, componentMetadata } from "../../apps-sdk/reference.mjs";
import { ENTRIES } from "../../apps-sdk/release-entries.mjs";
import capabilityMap from "../../apps-sdk/examples/panels/capability-map/declaration.mjs";
import { applicationIconKeys } from "../src/application-icons.ts";
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
  "## Imports and application icons",
  "",
  `Direct panel modules can import ${inline(Object.values(panelModuleSpecifiers))}.`,
  "",
  `The supported application icon IDs are ${inline(applicationIconKeys)}.`,
  "",
  "## Vue setup",
  "",
  sdkSection("usePanelContext"),
  "",
  sdkFields("PanelContext", ["instance", "t", "navigate", "notify"]),
  "",
  sdkFields("PanelInstance", ["state", "pageContext", "onObjectChanged", "refreshObjects"]),
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
  sdkSection("usePanelOperation"),
  "",
  sdkSection("PanelOperationHandle"),
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
