import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterAll, describe, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }));
vi.mock("../../../config/model-factory", () => ({ createModel: vi.fn() }));
vi.mock("../../analysis-agent/config/skill-references", () => ({
  listAnalysisAgentSkillReferences: vi.fn(),
  removeAnalysisAgentSkillReferences: vi.fn(),
  restoreAnalysisAgentSkillReferences: vi.fn(),
}));

const root = await fs.mkdtemp(path.join(os.tmpdir(), "public-skills-"));
const publicRoot = path.join(root, "public");
const labelsPath = path.join(root, "skill-labels.json");
await fs.writeFile(labelsPath, "{}");
installContentLayout({ runtimeRoot: root, publicSkillsRoot: publicRoot, publicSkillLabelsPath: labelsPath, prompts: [], runtimeResources: [] });
configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });
const { skillRegistryManager } = await import("../../../core/skills/registry/manager");
const { skillRuntime } = await import("../../../core/skills/execution/runtime");
const { resolveSkillPackageFile, loadSkillContent } = await import("../../../core/skills/discovery/loader");
const { skillManager } = await import("../skill-manager");
const { createLoopSkillTools } = await import("../../analysis-agent/loop/skills");

afterAll(async () => {
  skillRegistryManager.dispose();
  await fs.rm(root, { recursive: true, force: true });
});

async function writePackage(base: string, id: string, version: string) {
  const dir = path.join(base, "executable", "analysis", id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${id}\ndescription: ${version}\ntype: executable\ncategory: analysis\nversion: ${version}\nentries: [index.mjs]\n---\n${version}\n`);
  await fs.writeFile(path.join(dir, "index.mjs"), `export async function execute() { return {text: ${JSON.stringify(version)}}; }\n`);
  await fs.writeFile(path.join(dir, "resource.txt"), version);
  return dir;
}

describe("public skill ownership across domains", () => {
  it("passes skill options alongside stored evidence without allowing host input overrides", async () => {
    const dir = await writePackage(publicRoot, "option-reader", "1.0.0");
    await fs.writeFile(path.join(dir, "index.mjs"), 'export async function execute(input) { return {json: {valueField: input.valueField, locations: input.locations, data: input.data, query: input.query}}; }');
    const tools = createLoopSkillTools({
      domainId: "options", selectedSkillIds: ["option-reader"],
      resolveEvidence: id => id === "q" ? { question: "Sales", entries: [{ index: 0, title: "Daily sales", data: [{ cups: 12 }], dataCount: 1 }] } : undefined,
      trajectory: { start: () => "activity", settle: vi.fn() },
    });
    const run = tools.find(tool => tool.name === "run_skill")!;
    const locations = [{ city: "Shanghai", latitude: 31.23, longitude: 121.47 }];
    const output = await run.execute("run", { skill_id: "option-reader", question_id: "q", parameters: { valueField: "cups", locations } });
    expect(output.content[0].text).toContain('"valueField": "cups"');
    expect(output.content[0].text).toContain('"latitude": 31.23');
    expect(output.content[0].text).toContain('"cups": 12');
    for (const parameters of [[], { data: [] }, { services: {} }]) {
      const rejected = await run.execute("invalid", { skill_id: "option-reader", question_id: "q", parameters });
      expect(rejected.content[0].text).toMatch(/must be a JSON object|cannot override/);
    }
  });

  it("refreshes existing and new domains while preserving switches and domain-only packages", async () => {
    const oldRoot = skillRegistryManager.getDomainSkillsRoot("old");
    const oldCopy = await writePackage(oldRoot, "shared", "local-edit");
    const custom = await writePackage(oldRoot, "custom", "custom-v1");
    const states = JSON.stringify({ disabledSkills: ["shared"], lastUpdated: "unchanged" });
    await fs.writeFile(path.join(oldRoot, "skill-states.json"), states);
    const publicPackage = await writePackage(publicRoot, "shared", "1.0.0");

    const old = await skillRegistryManager.forDomain("old");
    expect(old.getSkillById("shared")).toMatchObject({ path: publicPackage, isPublic: true });
    expect(old.getSkillById("custom")).toMatchObject({ path: custom, isPublic: false });
    expect(old.isSkillEnabled("shared")).toBe(false);
    expect((await skillRegistryManager.forDomain("new")).getSkillById("shared")?.manifest.version).toBe("1.0.0");
    await expect(fs.stat(oldCopy)).rejects.toMatchObject({ code: "ENOENT" });
    const retired = await fs.readdir(path.join(oldRoot, ".trash"));
    expect(await fs.readFile(path.join(oldRoot, ".trash", retired[0], "resource.txt"), "utf8")).toBe("local-edit");

    await writePackage(publicRoot, "shared", "2.0.0");
    await writePackage(publicRoot, "added", "1.0.0");
    for (const domain of ["old", "new", "created-later"]) {
      const skills = await skillManager.getAllSkills(domain);
      expect(skills.find((skill) => skill.id === "shared")).toMatchObject({ version: "2.0.0", isPublic: true, enabled: domain !== "old" });
      expect(skills.some((skill) => skill.id === "added")).toBe(true);
      expect(skills.some((skill) => skill.id === "custom")).toBe(domain === "old");
      expect((await skillManager.getSkillContent(domain, "shared"))?.trim()).toBe("2.0.0");
      const registry = await skillRegistryManager.forDomain(domain);
      const file = await resolveSkillPackageFile(registry.getSkillById("shared")!, "resource.txt");
      expect(await fs.readFile(file, "utf8")).toBe("2.0.0");
    }
    expect(await fs.readFile(path.join(oldRoot, "skill-states.json"), "utf8")).toBe(states);
    await expect(skillRuntime.execute("old", "shared", {})).rejects.toMatchObject({ code: "SKILL_DISABLED" });
    await skillManager.toggleSkill("old", "shared");
    expect(await skillRuntime.execute("old", "shared", {})).toMatchObject({ text: "2.0.0" });
    await skillManager.toggleSkill("new", "shared");
    expect((await skillRegistryManager.forDomain("old")).isSkillEnabled("shared")).toBe(true);

    // A withdrawn public package must not resurrect the retired domain copy.
    await fs.rm(publicPackage, { recursive: true });
    expect((await skillRegistryManager.forDomain("old")).getSkillById("shared")).toBeNull();
    expect((await skillRegistryManager.forDomain("old")).getSkillById("custom")?.path).toBe(custom);
  });

  it("rejects all public-content writes and still allows domain-owned content changes", async () => {
    const dir = await writePackage(publicRoot, "protected", "1.0.0");
    const zip = new AdmZip();
    zip.addLocalFolder(dir);
    const readOnly = { status: 403, code: "PUBLIC_SKILL_READ_ONLY" };
    await expect(skillManager.createSkill("writer", "protected", "executable", "analysis", { description: "replacement" })).rejects.toMatchObject(readOnly);
    await expect(skillManager.updateSkill("writer", "protected", { skillContent: "replacement" })).rejects.toMatchObject(readOnly);
    await expect(skillManager.deleteSkill("writer", "protected")).rejects.toMatchObject(readOnly);
    for (const overwrite of [false, true]) {
      await expect(skillManager.importSkill("writer", zip.toBuffer(), overwrite)).rejects.toMatchObject(readOnly);
    }
    expect((await skillManager.getSkillContent("writer", "protected"))?.trim()).toBe("1.0.0");
    await skillManager.createSkill("writer", "mine", "knowledge", "analysis", { description: "Mine", skillContent: "before" });
    await skillManager.updateSkill("writer", "mine", { skillContent: "after" });
    expect((await skillManager.getSkillContent("writer", "mine"))?.trim()).toBe("after");
    expect((await skillManager.getAllSkills("another")).some((skill) => skill.id === "mine")).toBe(false);
  });

  it("localizes cards while sharing core instructions, execution, resources, and exports", async () => {
    const dir = await writePackage(publicRoot, "localized", "1.0.0");
    const labels = { localized: { title: "Translated title", description: "Translated description", tags: ["translated"] } };
    await fs.writeFile(labelsPath, JSON.stringify(labels));

    const registry = await skillRegistryManager.forDomain("translated");
    const skill = registry.getSkillById("localized")!;
    expect(skill).toMatchObject({
      path: dir,
      skillMdPath: path.join(dir, "SKILL.md"),
      isPublic: true,
      manifest: { title: "Translated title", description: "Translated description", version: "1.0.0", entries: ["index.mjs"] },
    });
    expect(loadSkillContent(skill)?.trim()).toBe("1.0.0");
    expect((await skillManager.getSkillContent("translated", "localized"))?.trim()).toBe("1.0.0");
    expect((await skillManager.searchSkills("translated", "Translated title"))[0].id).toBe("localized");

    const tools = createLoopSkillTools({
      domainId: "translated",
      selectedSkillIds: ["localized"],
      resolveEvidence: () => undefined,
      trajectory: { start: () => "activity", settle: vi.fn() },
    });
    const loaded = await tools.find((tool) => tool.name === "load_skill")!.execute("load", { skill_id: "localized" });
    expect(loaded.content[0].text).toBe("1.0.0");

    await writePackage(publicRoot, "localized", "2.0.0");
    expect(await skillRuntime.execute("translated", "localized", {})).toMatchObject({ text: "2.0.0" });
    expect((await skillRegistryManager.forDomain("translated")).getSkillById("localized")?.manifest.version).toBe("2.0.0");
    expect((await skillManager.getSkillContent("translated", "localized"))?.trim()).toBe("2.0.0");
    const reloaded = await tools.find((tool) => tool.name === "load_skill")!.execute("reload", { skill_id: "localized" });
    expect(reloaded.content[0].text).toBe("2.0.0");
    const raw = await tools.find((tool) => tool.name === "read_skill_file")!.execute("read", { skill_id: "localized", path: "SKILL.md" });
    expect(raw.content[0].text).toContain("description: 2.0.0");
    const exported = new AdmZip(await skillManager.exportSkill("translated", "localized"));
    expect(exported.readAsText("SKILL.md")).toBe(await fs.readFile(path.join(dir, "SKILL.md"), "utf8"));
    expect(exported.readAsText("index.mjs")).toBe(await fs.readFile(path.join(dir, "index.mjs"), "utf8"));
    expect(await fs.readFile(await resolveSkillPackageFile(skill, "resource.txt"), "utf8")).toBe("2.0.0");

    await writePackage(publicRoot, "without-card-labels", "1.0.0");
    const updated = await skillRegistryManager.forDomain("translated");
    expect(updated.getSkillById("without-card-labels")?.manifest.description).toBe("1.0.0");
    expect(updated.isSkillEnabled("without-card-labels")).toBe(true);

    // Labels cannot become an alternate owner of instructions or enabled state.
    try {
      for (const forbidden of [{ defaultEnabled: false }, { content: "Duplicated instructions" }]) {
        await fs.writeFile(labelsPath, JSON.stringify({ localized: { ...labels.localized, ...forbidden } }));
        await expect(skillRegistryManager.forDomain("translated")).rejects.toThrow(/Unrecognized key/);
      }
    } finally {
      await fs.writeFile(labelsPath, JSON.stringify(labels));
    }
  });
});
