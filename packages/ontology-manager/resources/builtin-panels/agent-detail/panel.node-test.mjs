import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(dir, "panel.html"), "utf8");
const moduleSource = readFileSync(join(dir, "panel.mjs"), "utf8");
const panel = JSON.parse(readFileSync(join(dir, "panel.json"), "utf8"));

function extractFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} function source`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

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
  for (const slot of ["remove", "shareEnable", "shareDisable"]) {
    assert.equal(html.includes(`slot="${slot}"`), false, `${slot} has no hidden projection`);
  }
  assert.match(html, /slot="grantSubmit"/u, "grantSubmit projection stays mounted");
  assert.equal(html.includes("agent-detail-operation-sources"), false);
  assert.equal(moduleSource.includes("entry: false"), false);
  assert.equal(moduleSource.includes("onShareDone"), false);
  assert.equal(moduleSource.includes("onRemoveDone"), false);
});

test("undrawn skills and tools members remain explicit code-read data sources", () => {
  const members = panel.manifest.members;
  for (const name of ["skills", "tools"]) {
    const member = members[name];
    assert.equal(member.component, "ReferencePicker", `${name} keeps its owner read contract`);
    assert.match(member.name, /不绘制/u, `${name} name says it is not drawn`);
    assert.match(member.description, /不绘制；仅由面板脚本读取 options 与 resolve/u, `${name} description says who reads it`);
    const optionsRead = typeof member.data.options === "string" ? member.data.options : member.data.options.read;
    const resolveRead = typeof member.data.selected === "string" ? member.data.selected : member.data.selected.read;
    assert.equal(optionsRead, "options", `${name} options read`);
    assert.equal(resolveRead, "resolve", `${name} resolve read`);
    assert.equal(html.includes(`slot="${name}"`), false, `${name} is not rendered`);
  }
  assert.match(moduleSource, /memberContext\("skills"\)/u);
  assert.match(moduleSource, /memberContext\("tools"\)/u);

  const context = vm.createContext({
    skillOptionsByKey: { value: new Map() },
  });
  vm.runInContext(
    `${extractFunctionSource(moduleSource, "runtimeSkillKey")}
${extractFunctionSource(moduleSource, "selectedSkillRows")}`,
    context,
  );
  const heldSkill = {
    namespace: { kind: "domain", domainId: "domain-a" },
    name: "deleted-skill",
  };
  const rows = context.selectedSkillRows([heldSkill]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "deleted-skill", "a held skill absent from candidates still gets a non-empty label");
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
  const referenceSet = new Set(reference);
  for (const locale of locales) {
    const keys = Object.keys(messages[locale]).sort();
    const keySet = new Set(keys);
    const missing = reference.filter((key) => !keySet.has(key));
    const extra = keys.filter((key) => !referenceSet.has(key));
    assert.deepEqual(
      keys,
      reference,
      `${locale} message keys must exactly match en; missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}`,
    );
  }
});
