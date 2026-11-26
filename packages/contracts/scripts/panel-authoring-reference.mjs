import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import { panelAuthoringManifestSchema, panelAuthoringMemberSchema } from "../src/panel-authoring.ts";
import { panelDefinitionContentSchema } from "../src/product-panels.ts";

const guide = new URL("../../../agent-skills/ontomato-app-builder/references/panel-authoring/FIELDS.md", import.meta.url);
const descriptorKeys = new Set(Object.keys(panelDefinitionContentSchema.shape));
const manifestKeys = new Set(Object.keys(panelAuthoringManifestSchema.shape));
for (const key of ["manifest", "content", "theme", "template"]) {
  assert.ok(descriptorKeys.has(key), `Panel descriptor contract is missing '${key}'`);
}
for (const key of ["state", "members"]) {
  assert.ok(manifestKeys.has(key), `Panel manifest contract is missing '${key}'`);
}

const descriptorRows = [
  ["`manifest`", "Yes", "Panel declaration object (`{ state, members }`). Both keys inside `manifest` are required."],
  ["`manifest.state`", "Yes", "Declared typed public state fields. Write `{}` when the panel has no public state (for example, a read-only stateless page)."],
  ["`manifest.members`", "Yes", "Map of member keys to short inline member declarations (table below) or formal placements (`{ target: { projectionId } }`). Write `{}` when the panel has no members."],
  ["`manifest.components`", "No", "Optional map of Vue template tag name to author-registered component ID (`domain-component:<uuid>`) used directly inside Vue slots without being projections."],
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
  "Minimal complete `panel.json` for a read-only stateless page (empty `state` and `members` objects are required when unused):",
  "",
  "```json",
  JSON.stringify(minimalReadOnlyPanel, null, 2),
  "```",
  "",
  "## Panel member fields",
  "",
  "Use these fields for a new inline member inside `manifest.members` in `panel.json`. Map writable ports via",
  "`state`, which expands to inputs and outputs according to the component declaration. Use `inputs` for explicit",
  "input sources such as another member's read-only output. The inline shorthand accepts no `outputs` key.",
  "",
  "| Field | Required on every member | Value |",
  "| --- | --- | --- |",
  ...rows,
  "",
  "## Where a member's value is written",
  "",
  "| Written at | It holds |",
  "| --- | --- |",
  "| the member's `config` in `panel.json` | the fixed configuration: columns, labels, layout, sizes |",
  "| `:values` where the member is placed | the same configuration keys, for the ones that change with the page (disabled while the draft is dirty, the title being edited); a key written in both places fails the offline check |",
  "| `:inputs` where the member is placed | only the ports the component catalogue lists as inputs, and only inside another component's scoped slot |",
  "",
  "A placement that carries `:inputs` is drawn as an instance of its own: it does not share the member's registration,",
  "form draft or published outputs with the rest of the panel. That is how a row's detail or an array item gets its own",
  "data, and it is not a way to pass a value — a value that follows the page goes in `:values`.",
  "",
  "## Form controls and operation inputs",
  "",
  '- `choice-matrix` locks individual rows with `disabled: boolean` and `disabledReason: string | null`. Supply a reason for a disabled row and `null` for an enabled row. Field-level `readOnly` applies to the whole field.',
  '- Owner forms (`panelFormDescription`) and individual fields (`panelFormField`) may declare `submitOn?: "manual" | "blur" | "change"` (default `"manual"`; field overrides form). Fields with `"blur"` or `"change"` submit single-field saves automatically on blur or change; agent `fill_form` routes auto-submitting fields through the registered save confirmation flow.',
  '- `select` supports `presentation: "dropdown" | "radio" | "checklist" | "tree"` and `presets`. The `text` control supports `variables` and marks secret input with `secret: true`. Its `presentation: "markdown"` draws the same string as a Markdown editor of at least six rows that counts its characters; the value stays the owner\'s plain string. Operation input schema properties can also declare `secret: true`.',
  '- In `OperationButton`, bind each top-level `inputSchema` property that the button should supply, including optional properties. `OperationInputDialog` prompts for any unbound properties. To omit an optional value, bind a scalar state whose default is `null`.',
  '- For an `operationParams` state binding, use a scalar state directly. To pass a reference\'s primary key, use `watch` in `panel.mjs` to extract `primaryKey` into that state. The `{ state, field: "primaryKey" }` read-parameter shorthand is unavailable in `operationParams`.',
  '- Use `ObjectList.config.rowActions` for per-row operations. It supports `hideWhenUnavailable` and the host\'s one-time secret delivery. `OperationButton` targets cannot come from `{ fromSlot: true }`.',
  "",
].join("\n");

if (process.argv.includes("--check")) {
  assert.equal(await readFile(guide, "utf8"), contents, "Regenerate the panel authoring field reference");
} else {
  await writeFile(guide, contents);
}
