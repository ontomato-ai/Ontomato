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
    expect(json.manifest.members.list.config.columns[0]).toMatchObject({ key: "icon", labelKey: "col.name" });
    expect(html).toContain("#cell-icon=");
    expect(html).toContain("agents-avatar");
    expect(html).toContain(":disabled=\"createButtonDisabled\"");
    expect(module).toContain("memberContext(\"createForm\")");
    expect(module).toContain("data.use(\"createForm\")");
  });

  it("wire live header draft, split avatar/color labels, change summary, prompt preview, skill grid, and clean header", async () => {
    const dir = path.join(panelsRoot, "agent-detail");
    const [json, html, module] = await Promise.all([
      readFile(path.join(dir, "panel.json"), "utf8").then((raw) => JSON.parse(raw)),
      readFile(path.join(dir, "panel.html"), "utf8"),
      readFile(path.join(dir, "panel.mjs"), "utf8"),
    ]);

    expect(json.manifest.members.form.config).toMatchObject({
      actions: "none",
      showChangeSummary: true,
      changeSummaryTitle: "detail.changeSummary",
    });
    expect(html).toContain(":title=\"liveTitle\"");
    expect(html).toContain("#leading");
    expect(html).toContain("#field-icon=");
    expect(html).toContain("t('form.avatarColor')");
    expect(html).toContain("#field-systemPrompt=");
    expect(html).toContain("<code-editor");
    expect(html).toContain(":min-height=\"560\"");
    expect(html).toContain("<markdown-view");
    expect(html).toContain("#field-skills=");
    expect(html).toContain("agent-detail-skill-grid");
    expect(module).toContain("memberContext(\"skills\")");
    expect(module).toContain("data.read(\"selected\"");
    expect(html).not.toContain("viewType");
    expect(html).not.toContain("agents.viewType");
    expect(module).not.toContain("viewType");
  });
});
