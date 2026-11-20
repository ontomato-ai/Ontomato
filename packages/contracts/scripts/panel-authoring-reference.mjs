import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import { panelAuthoringMemberSchema } from "../src/panel-authoring.ts";

const guide = new URL("../../../agent-skills/ontomato-app-builder/references/panel-authoring/FIELDS.md", import.meta.url);
const schema = zodToJsonSchema(panelAuthoringMemberSchema);
const member = schema.anyOf.find(variant => Object.hasOwn(variant.properties ?? {}, "component"));
const required = new Set(member.required);
const rows = Object.entries(member.properties).map(([name, field]) => {
  assert.ok(field.description, `Document panel authoring field '${name}' in the contract`);
  return `| \`${name}\` | ${required.has(name) ? "Yes" : "No"} | ${field.description.replaceAll("|", "\\|")} |`;
});
const contents = [
  "<!-- Generated from the panel authoring contract by pnpm --filter @ontomato/contracts generate:panel-authoring-reference. -->",
  "# Panel member fields",
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
