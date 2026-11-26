import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(dir, "panel.html"), "utf8");
const moduleSource = readFileSync(join(dir, "panel.mjs"), "utf8");
const panel = JSON.parse(readFileSync(join(dir, "panel.json"), "utf8"));

test("agent detail exposes the six required sections in order", () => {
  assert.deepEqual(
    panel.manifest.members.form.config.groups.map((group) => group.key),
    ["basics", "model", "prompt", "capabilities", "data", "sharing"],
  );
  assert.match(moduleSource, /const SECTION_KEYS = \["basics", "model", "prompt", "capabilities", "data", "sharing"\]/u);
  for (const locale of Object.values(panel.content.messages)) {
    for (const key of ["basics", "model", "prompt", "capabilities", "data", "sharing"]) {
      assert.equal(typeof locale[`section.${key}`], "string", `${key} section label`);
    }
  }
});

test("agent detail has no top-level configuration/grants tab pair", () => {
  assert.equal(html.includes("<sdk-tabs"), false);
  assert.equal(html.includes("<sdk-tab-pane"), false);
});

test("unsaved changes are owned by the sticky save bar rather than the page header", () => {
  assert.match(html, /agent-detail-savebar/u);
  assert.match(html, /savebar\.unsaved/u);
  assert.match(html, /savebar\.discard/u);
  assert.match(html, /savebar\.save/u);
  const header = html.match(/<page-header\b[^>]*>/u)?.[0] ?? "";
  assert.equal(header.includes(":draft"), false);
});

test("agent detail does not use Element Plus tags, classes, or theme tokens directly", () => {
  const source = `${html}\n${moduleSource}\n${JSON.stringify(panel)}`;
  assert.equal(/<el-[a-z-]+/iu.test(source), false);
  assert.equal(/(?:^|[\s.{])el-[a-z-]+/mu.test(source), false);
  assert.equal(/--el-[a-z-]+/iu.test(source), false);
});

test("all original owner operations remain declared", () => {
  const members = panel.manifest.members;
  assert.equal(members.form.operation, "platform:AgentDefinition.save");
  assert.equal(members.remove.operation, "agents.delete");
  assert.equal(members.shareEnable.operation, "agents.share");
  assert.equal(members.shareDisable.operation, "agents.share");
  assert.equal(members.grantSubmit.operation, "agents.grant");
  assert.equal(members.grantsList.operations.revoke.operation, "agents.revoke");
  assert.equal(members.grantsList.config.rowActions.items[0].operation, "revoke");
  for (const slot of ["remove", "shareEnable", "shareDisable", "grantSubmit"]) {
    assert.match(html, new RegExp(`slot="${slot}"`, "u"), `${slot} projection stays mounted`);
  }
});


test("capabilities use shared picker dialogs while the owner form still carries both fields", () => {
  assert.equal(html.includes("agent-detail-skill-card"), false);
  assert.equal(moduleSource.includes("toggleSkill"), false);
  assert.equal(moduleSource.includes("selectedSkillCount"), false);

  const members = panel.manifest.members;
  for (const [memberName, type] of [["skillPicker", "platform:Skill"], ["toolPicker", "platform:ExternalMcpService"]]) {
    const member = members[memberName];
    assert.equal(member.component, "PickerDialog", `${memberName} component`);
    assert.equal(member.type, type, `${memberName} owner type`);
    const options = member.data.options;
    const optionsRead = typeof options === "string" ? options : options.read;
    assert.equal(optionsRead, "options", `${memberName} options read`);
    assert.equal(typeof member.config.titleKey, "string");
    assert.equal(typeof member.config.confirmLabelKey, "string");
    assert.equal(typeof member.config.searchPlaceholderKey, "string");
  }
  assert.equal(members.skillPicker.state.open, "skillPickerOpen");
  assert.equal(members.skillPicker.state.selected, "skillPickerSelected");
  assert.equal(members.toolPicker.state.open, "toolPickerOpen");
  assert.equal(members.toolPicker.state.selected, "toolPickerSelected");
  assert.equal(members.skills.component, "ReferencePicker");
  assert.equal(members.tools.component, "ReferencePicker");
  assert.equal(html.includes('slot="skills"'), false);
  assert.equal(html.includes('slot="tools"'), false);

  assert.match(html, /<template #field-skills="/u);
  assert.match(html, /<template #field-enabledMcpServiceIds="/u);
  assert.match(html, /slot="skillPicker"/u);
  assert.match(html, /slot="toolPicker"/u);
});

test("all panel messages keep the same keys in every locale", () => {
  const messages = panel.content.messages;
  const locales = Object.keys(messages);
  assert.deepEqual([...locales].sort(), ["ar", "de", "en", "fr", "it", "ja", "zh-CN", "zh-TW"]);
  const reference = Object.keys(messages.en).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), reference, `${locale} message keys`);
  }
});
