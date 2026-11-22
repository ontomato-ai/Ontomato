import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import { panelAuthoringManifestSchema, panelAuthoringMemberSchema } from "../src/panel-authoring.ts";
import { panelDefinitionContentSchema } from "../src/product-panels.ts";

const guide = new URL("../../../agent-skills/ontomato-app-builder/references/panel-authoring/FIELDS.md", import.meta.url);
const descriptorKeys = new Set(Object.keys(panelDefinitionContentSchema.shape));
const manifestKeys = new Set(Object.keys(panelAuthoringManifestSchema.innerType().shape));
for (const key of ["manifest", "content", "theme", "template"]) {
  assert.ok(descriptorKeys.has(key), `Panel descriptor contract is missing '${key}'`);
}
for (const key of ["state", "members", "commands"]) {
  assert.ok(manifestKeys.has(key), `Panel manifest contract is missing '${key}'`);
}

const descriptorRows = [
  ["`manifest`", "Yes", "Panel declaration object (`{ state, members, commands }`). All three keys inside `manifest` are required."],
  ["`manifest.state`", "Yes", "Declared typed public state fields. Write `{}` when the panel has no public state (for example, a read-only stateless page)."],
  ["`manifest.members`", "Yes", "Map of member keys to short inline member declarations (table below) or formal placements (`{ target: { projectionId } }`). Write `{}` when the panel has no members."],
  ["`manifest.commands`", "Yes", "Named page-header commands (`labelKey` and `do`). Write `{}` when the panel has no header commands."],
  ["`content`", "No", "Optional panel content metadata in `panel.json`. Only `content.messages` is accepted here; `panel.html`, `panel.mjs`, and optional `recipes.md` are loaded from workspace files."],
  ["`content.messages`", "No", "Locale-keyed flat message tables (`{ \"en\": { \"panel.name\": \"…\" }, \"zh-CN\": { \"panel.name\": \"…\" } }`) used by `t(key, params)` and `prefillKey`."],
  ["`theme`", "No", "Optional `{ light?, dark? }` map of overridable `--sdk-*` theme token values (never `--el-*`)."],
  ["`template`", "No", "Optional boolean marking whether this panel is a reusable template."],
].map(([field, req, value]) => `| ${field} | ${req} | ${value} |`);

const minimalReadOnlyPanel = {
  manifest: {
    state: {},
    members: {
      items: {
        component: "ObjectList",
        type: "platform:PublishedMcpService",
        data: { rows: "list" },
      },
    },
    commands: {},
  },
  content: {
    messages: {
      en: { "panel.name": "Published MCP services" },
      "zh-CN": { "panel.name": "对外 MCP 服务" },
    },
  },
};
panelAuthoringManifestSchema.parse(minimalReadOnlyPanel.manifest);

const schema = zodToJsonSchema(panelAuthoringMemberSchema);
const member = schema.anyOf.find(variant => Object.hasOwn(variant.properties ?? {}, "component"));
const required = new Set(member.required);
const rows = Object.entries(member.properties).map(([name, field]) => {
  assert.ok(field.description, `Document panel authoring field '${name}' in the contract`);
  return `| \`${name}\` | ${required.has(name) ? "Yes" : "No"} | ${field.description.replaceAll("|", "\\|")} |`;
});
const contents = [
  "<!-- Generated from the panel authoring contract by pnpm --filter @ontomato/contracts generate:panel-authoring-reference. -->",
  "# Panel descriptor and member fields",
  "",
  "## Panel descriptor (`panel.json`)",
  "",
  "Top-level fields accepted in `panel.json`. Workspace files supply `panel.html`, `panel.mjs`, and optional `recipes.md`.",
  "",
  "| Field | Required | Value |",
  "| --- | --- | --- |",
  ...descriptorRows,
  "",
  "Minimal complete `panel.json` for a read-only stateless page (empty `state` and `commands` objects are required):",
  "",
  "```json",
  JSON.stringify(minimalReadOnlyPanel, null, 2),
  "```",
  "",
  "## Panel member fields",
  "",
  "Use these fields for a new member inside `manifest.members` in `panel.json`.",
  "",
  "| Field | Required on every member | Value |",
  "| --- | --- | --- |",
  ...rows,
  "",
].join("\n");

if (process.argv.includes("--check")) {
  assert.equal(await readFile(guide, "utf8"), contents, "Regenerate the panel authoring field reference");
} else {
  await writeFile(guide, contents);
}
