import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as panelCheck from "@ontomato/contracts/panel-check";

const repoRoot = path.resolve(__dirname, "../../../../../..");
const panelsRoot = path.join(repoRoot, "packages/ontology-manager/resources/builtin-panels");

describe("agent-settings and agent-detail builtin panels", () => {
  it("pass builtin panel source checks without authoring violations", async () => {
    const { checkBuiltinPanelSource } = await import(
      path.join(repoRoot, "agent-skills/ontomato-app-builder/scripts/panel-check.mjs")
    );
    const settingsResult = await checkBuiltinPanelSource(
      path.join(panelsRoot, "agent-settings"),
      { ...panelCheck, draftReadOperationIds: [] },
    );
    const detailResult = await checkBuiltinPanelSource(
      path.join(panelsRoot, "agent-detail"),
      { ...panelCheck, draftReadOperationIds: [] },
    );
    expect(settingsResult.panelId).toBe("builtin-product-agent-settings");
    expect(detailResult.panelId).toBe("builtin-product-agent-detail");
  });

  it("wire catalog avatars, deep-linked /new create state, and owner createForm admission", async () => {
    const dir = path.join(panelsRoot, "agent-settings");
    const [json, html, module] = await Promise.all([
      readFile(path.join(dir, "panel.json"), "utf8").then((raw) => JSON.parse(raw)),
      readFile(path.join(dir, "panel.html"), "utf8"),
      readFile(path.join(dir, "panel.mjs"), "utf8"),
    ]);

    expect(json.manifest.state.creating.deepLink).toBe(true);
    expect(json.manifest.members.list.config.columns[0]).toMatchObject({ key: "agentTitle", labelKey: "col.name" });
    expect(html).toContain("#cell-agentTitle=");
    expect(html).toContain("agents-avatar");
    expect(html).toContain(":disabled=\"createButtonDisabled\"");
    expect(module).toContain("memberContext(\"createForm\")");
    expect(module).toContain("data.use(\"createForm\")");
  });

  it("wire live header draft, section navigation, save bar, capability pickers, prompt preview, and clean header", async () => {
    const dir = path.join(panelsRoot, "agent-detail");
    const [json, html, module] = await Promise.all([
      readFile(path.join(dir, "panel.json"), "utf8").then((raw) => JSON.parse(raw)),
      readFile(path.join(dir, "panel.html"), "utf8"),
      readFile(path.join(dir, "panel.mjs"), "utf8"),
    ]);

    expect(json.manifest.members.form.config).toMatchObject({
      actions: "none",
      showChangeSummary: false,
      changeSummaryTitle: "detail.changeSummary",
      presentation: "tabs",
    });
    expect(html).toContain(':values="{ title: liveTitle, fallbackTitle: selectedKey }"');
    expect(html).toContain("#leading");

    expect(html).toContain('class="agent-detail-savebar"');
    for (const key of ["savebar.unsaved", "savebar.save", "savebar.discard"]) {
      expect(html, `expected ${key} in the save bar template`).toContain(key);
    }
    for (const hook of ["dirtyItemCount", "saveDraft", "discardDraft"]) {
      expect(module, `expected ${hook} in the save bar wiring`).toContain(hook);
    }

    expect(module).toContain(
      'const SECTION_KEYS = ["basics", "model", "prompt", "capabilities", "data", "sharing"];',
    );
    expect(module).toContain('sharing: "execution"');
    expect(html).toContain(':values="{ activeGroup: activeSection }"');

    expect(html).not.toContain("agent-detail-skill-grid");
    const skillsField = html.match(/<template #field-skills=[\s\S]*?<\/template>/)?.[0] ?? "";
    expect(skillsField).not.toBe("");
    expect(skillsField).toContain("agent-detail-choice-table");
    expect(skillsField).toContain('@click="openSkillPicker(value)"');
    expect(skillsField).toContain('t("skills.addTitle")');
    expect(html).toContain('slot="skillPicker"');
    expect(html).toContain('slot="toolPicker"');
    expect(json.manifest.members.skillPicker).toMatchObject({
      component: "PickerDialog",
      state: { open: "skillPickerOpen", selected: "skillPickerSelected" },
    });
    expect(json.manifest.members.toolPicker).toMatchObject({
      component: "PickerDialog",
      state: { open: "toolPickerOpen", selected: "toolPickerSelected" },
    });

    expect(html).toContain("#field-systemPrompt=");
    expect(html).toContain("<code-editor");
    expect(html).not.toContain(':min-height="560"');
    expect(html).toContain("<markdown-view");

    for (const member of [json.manifest.members.skills, json.manifest.members.tools]) {
      expect(member.name).toContain("数据源");
      expect(member.description).toContain("不绘制");
    }
    expect(module).toContain("memberContext(\"skills\")");
    expect(module).toContain("data.read(\"selected\"");

    expect(html).not.toContain("viewType");
    expect(html).not.toContain("agents.viewType");
    expect(module).not.toContain("viewType");
  });

});
