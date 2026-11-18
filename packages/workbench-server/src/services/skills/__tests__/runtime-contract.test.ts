import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { readSkillPackage } from "../../../core/skills/package";
import { standardSkillFrontmatterSchema, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { parse } from "yaml";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

configureI18n({ defaultLocale: "en", packs: { en: { messages: en, ...enLocaleMeta } },
  languageSwitchEnabled: false, appTextLocale: "en" });

const root = await fs.mkdtemp(path.join(os.tmpdir(), "domain-skills-contract-"));
installContentLayout({ runtimeRoot: root, prompts: [], runtimeResources: [], publicSkillsRoot: path.resolve("skills") });
const { skillManager } = await import("../skill-manager");
const { assistantSkillCatalog, prepareAssistantSkills } = await import("../../assistant/skills");
const { skillRegistryManager } = await import("../../../core/skills/registry/manager");
const { registerSkillProvider } = await import("../../../core/skills/providers");
const domain = "contract-domain";
const reference = { namespace: { kind: "domain" as const, domainId: domain }, name: "sample-skill" };
const files = {
  "SKILL.md": "---\r\nname: sample-skill\r\ndescription: A portable sample\r\nlicense: MIT\r\nmetadata:\r\n  author: example\r\n---\r\nRun scripts/main.mjs.\r\n",
  "scripts/main.mjs": "console.log('原始版本');\n",
  "references/guide.md": "# Shared method\n\nKeep this reference intact.\n",
};
const zip = (changes: Record<string, string> = {}) => {
  const archive = new AdmZip();
  for (const [name, content] of Object.entries({ ...files, ...changes })) archive.addFile(name, Buffer.from(content));
  return archive.toBuffer();
};
const skillMarkdown = (name: string) => `---\nname: ${name}\ndescription: Panel-provided skill\n---\nRun scripts/main.mjs.\n`;
type Offering = {
  skill: RuntimeSkillRef;
  manifest: { name: string; description: string };
  provide: () => Promise<{ skill: RuntimeSkillRef; files: { path: string; content: string }[] }>;
};
let panelOfferings: Offering[] = [];
let conflictOfferings: Offering[] = [];
let panelCalls: string[] = [];
let panelListError: Error | null = null;
const panelProvider = {
  id: "panel-test", name: "Test panels",
  async list() { if (panelListError) throw panelListError; return panelOfferings; },
};
const conflictProvider = { id: "conflict-test", name: "Conflicting source", async list() { return conflictOfferings; } };
registerSkillProvider(panelProvider);
registerSkillProvider(conflictProvider);
function offering(name: string, options: { domainId?: string; script?: string; packageName?: string;
  provideError?: Error; namespace?: RuntimeSkillRef["namespace"] } = {}): Offering {
  const skill: RuntimeSkillRef = { namespace: options.namespace ?? { kind: "domain", domainId: options.domainId ?? domain }, name };
  const packageSkill = { ...skill, name: options.packageName ?? name };
  return { skill, manifest: { name, description: "Panel-provided skill" }, provide: async () => {
    panelCalls.push(name);
    if (options.provideError) throw options.provideError;
    return { skill: packageSkill, files: [
      { path: "SKILL.md", content: skillMarkdown(name) },
      { path: "scripts/main.mjs", content: options.script ?? "console.log('panel');\n" },
    ] };
  } };
}
const panelSkill = (name = "panel-skill") => offering(name);
const panelReference = (name = "panel-skill"): RuntimeSkillRef => ({ namespace: { kind: "domain", domainId: domain }, name });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
beforeEach(() => { panelOfferings = []; conflictOfferings = []; panelCalls = []; panelListError = null; });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("round-trips a standard package byte-for-byte and lists and reads its files", async () => {
  const imported = await skillManager.importSkill(domain, zip());
  expect(imported.skill).toEqual(reference);
  expect(imported.title).toBe(reference.name);
  expect(imported.writeRestriction).toBeNull();
  const exported = new AdmZip(await skillManager.exportSkill(domain, reference.name));
  for (const [name, content] of Object.entries(files)) expect(exported.readFile(name)).toEqual(Buffer.from(content));
  const front = parse(exported.readAsText("SKILL.md").split("---")[1]);
  expect(standardSkillFrontmatterSchema.parse(front)).toMatchObject({ license: "MIT", metadata: { author: "example" } });
  expect(await skillManager.listSkillFiles(domain, reference.name)).toEqual(Object.keys(files).sort()
    .map((name) => ({ path: name, size: Buffer.byteLength(files[name as keyof typeof files]) })));
  expect(await skillManager.readSkillFile(domain, reference.name, "references/guide.md")).toBe(files["references/guide.md"]);
});

it("keeps an older package's ontomato.* metadata in the package and reads none of it", async () => {
  const older = "---\nname: sample-skill\ndescription: A portable sample\nmetadata:\n  ontomato.title: Old title\n  ontomato.category: visualization\n  ontomato.tags: not json\n---\nRun scripts/main.mjs.\n";
  const imported = await skillManager.importSkill(domain, zip({ "SKILL.md": older }), true);
  expect(imported).toMatchObject({ title: reference.name, description: "A portable sample" });
  const exported = new AdmZip(await skillManager.exportSkill(domain, reference.name));
  expect(exported.readAsText("SKILL.md")).toBe(older);
});

it("reads only files inside the package", async () => {
  await skillManager.importSkill(domain, zip(), true);
  for (const outside of ["../sample-skill/SKILL.md", "/etc/hosts", "scripts/../../x"])
    await expect(skillManager.readSkillFile(domain, reference.name, outside)).rejects.toMatchObject({ status: 400 });
});

it("lists and reads a provider package on demand, with no source path and one write restriction", async () => {
  await skillManager.importSkill(domain, zip(), true);
  panelOfferings = [panelSkill()];
  const infos = await skillManager.getAllSkills(domain);
  const info = infos.find((entry) => entry.id === "panel-skill")!;
  expect(info).toMatchObject({ isPublic: false, writeRestriction: { kind: "provider", providerId: "panel-test", providerName: "Test panels" } });
  expect(info.path).toBeUndefined();
  expect(infos.find((entry) => entry.id === reference.name)).toMatchObject({ writeRestriction: null, isPublic: false });
  expect(infos.find((entry) => entry.id === "network-graph")).toMatchObject({ writeRestriction: { kind: "public" }, isPublic: true });
  // Listing only asks for metadata; each read asks the provider for its current package.
  expect(panelCalls).toEqual([]);
  expect(await skillManager.listSkillFiles(domain, "panel-skill")).toEqual([
    { path: "SKILL.md", size: Buffer.byteLength(skillMarkdown("panel-skill")) },
    { path: "scripts/main.mjs", size: Buffer.byteLength("console.log('panel');\n") },
  ]);
  expect(await skillManager.readSkillFile(domain, "panel-skill", "scripts/main.mjs")).toBe("console.log('panel');\n");
  const exported = new AdmZip(await skillManager.exportSkill(domain, "panel-skill"));
  expect(exported.readAsText("SKILL.md")).toBe(skillMarkdown("panel-skill"));
});

it("publishes the selected provider's current package and never provides an unselected one", async () => {
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "synthetic-host");
  const published: Array<{ skill: RuntimeSkillRef; files: { path: string; content: string }[] }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    if (url.endsWith("/platform/page-skills")) return Response.json({ success: true, data: { pageSkills: [], registeredSkills: [] } });
    expect(new Headers(init.headers).get("x-domain-id")).toBe(domain);
    const body = JSON.parse(String(init.body));
    published.push(body);
    return Response.json({ skill: body.skill, digest: "a".repeat(64), description: "Panel-provided skill" }, { status: 201 });
  }));
  panelOfferings = [panelSkill(), offering("unused-panel-skill", { provideError: new Error("must not be provided") })];
  await prepareAssistantSkills(domain, { kind: "custom", skills: [panelReference()] }, {});
  expect(published.map((entry) => entry.skill)).toEqual([panelReference()]);
  expect(panelCalls).toEqual(["panel-skill"]);
  panelOfferings = [offering("panel-skill", { script: "console.log('current');\n" })];
  await prepareAssistantSkills(domain, { kind: "custom", skills: [panelReference()] }, {});
  expect(published).toHaveLength(2);
  expect(published[1]!.files.find((file) => file.path === "scripts/main.mjs")?.content).toBe("console.log('current');\n");
  panelOfferings = [offering("panel-skill", { provideError: new Error("cannot supply the selected package") })];
  await expect(prepareAssistantSkills(domain, { kind: "custom", skills: [panelReference()] }, {}))
    .rejects.toThrow("cannot supply the selected package");
});

it("fails the whole catalogue when a provider cannot list, and all preparation with it", async () => {
  panelListError = new Error("panel source unavailable");
  await expect(skillManager.getAllSkills(domain)).rejects.toThrow("panel source unavailable");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, data: { pageSkills: [], registeredSkills: [] } })));
  await expect(prepareAssistantSkills(domain, { kind: "custom", skills: [] }, {})).rejects.toThrow("panel source unavailable");
});

it("fails a page-mapped skill that no source supplies instead of reusing its runtime package", async () => {
  const missing = { namespace: { kind: "provider" as const, provider: "panel-test" }, name: "missing-panel-skill" };
  const published: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.endsWith("/platform/page-skills")) return Response.json({ success: true, data: {
      pageSkills: [{ permissionCode: "business-knowledge", skill: missing }], registeredSkills: [missing] } });
    published.push(JSON.parse(String(init?.body)));
    return Response.json({ skill: missing, digest: "a".repeat(64), description: "Missing" }, { status: 201 });
  }));
  await expect(prepareAssistantSkills(domain, { kind: "regular", skills: [] }, {}))
    .rejects.toMatchObject({ status: 422, code: "SKILL_NOT_FOUND" });
  expect(published).toEqual([]);
});

it("rejects a provider skill for another domain, a repeated manageable name, and a built-in identity takeover", async () => {
  panelOfferings = [offering("other-domain-skill", { domainId: "other-domain" })];
  await expect(skillManager.getAllSkills(domain)).rejects.toThrow(/other-domain\/other-domain-skill/);
  panelOfferings = [panelSkill()];
  conflictOfferings = [panelSkill("panel-skill")];
  await expect(skillManager.getAllSkills(domain)).rejects.toThrow(/conflict-test[\s\S]*panel-test/);
  const governance = { namespace: { kind: "provider" as const, provider: "ontology" }, name: "knowledge-governance" };
  panelOfferings = [offering(governance.name, { namespace: governance.namespace })];
  await expect(assistantSkillCatalog(domain, { locale: "en" }, { pageSkills: [], registeredSkills: [] }))
    .rejects.toThrow(/built-in skill/);
});

it("refuses to overwrite or delete provider content before touching a domain source or reference", async () => {
  panelOfferings = [panelSkill()];
  const providerZip = (() => {
    const archive = new AdmZip();
    archive.addFile("SKILL.md", Buffer.from(skillMarkdown("panel-skill")));
    return archive.toBuffer();
  })();
  await expect(skillManager.importSkill(domain, providerZip, true))
    .rejects.toMatchObject({ status: 403, code: "SKILL_PROVIDER_READ_ONLY" });
  await expect(fs.access(path.join(skillRegistryManager.getDomainSkillsRoot(domain), "panel-skill")))
    .rejects.toThrow();
  await expect(skillManager.deleteSkill(domain, "panel-skill"))
    .rejects.toMatchObject({ status: 403, code: "SKILL_PROVIDER_READ_ONLY" });
  expect((await skillManager.getAllSkills(domain)).find((entry) => entry.id === "panel-skill")?.writeRestriction)
    .toMatchObject({ kind: "provider", providerName: "Test panels" });
});

it("keeps public packages read-only while leaving their files and export readable", async () => {
  expect((await skillManager.listSkillFiles(domain, "network-graph")).length).toBeGreaterThan(0);
  await expect(skillManager.readSkillFile(domain, "network-graph", "SKILL.md")).resolves.toContain("---");
  const replacement = new AdmZip();
  replacement.addFile("SKILL.md", Buffer.from("---\nname: network-graph\ndescription: Replaced\n---\n"));
  await expect(skillManager.importSkill(domain, replacement.toBuffer(), true))
    .rejects.toMatchObject({ status: 403, code: "PUBLIC_SKILL_READ_ONLY" });
  await expect(skillManager.deleteSkill(domain, "network-graph"))
    .rejects.toMatchObject({ status: 403, code: "PUBLIC_SKILL_READ_ONLY" });
});

it("rejects a provided package whose identity differs from the offered skill", async () => {
  panelOfferings = [offering("panel-skill", { packageName: "other-skill" })];
  await expect(skillManager.listSkillFiles(domain, "panel-skill")).rejects.toThrow(/supplied/);
});

it("rejects a provided package whose SKILL.md declares another name", async () => {
  const offered = panelSkill();
  offered.provide = async () => ({ skill: offered.skill,
    files: [{ path: "SKILL.md", content: skillMarkdown("other-skill") }] });
  panelOfferings = [offered];
  await expect(skillManager.listSkillFiles(domain, "panel-skill")).rejects.toThrow(/SKILL.md must declare the package name/);
});

it("publishes only the selected current-domain package and keeps captured versions unchanged across imports", async () => {
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "synthetic-host");
  const published: Array<{ skill: unknown; files: { path: string; content: string }[] }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    if (url.endsWith("/platform/page-skills")) return Response.json({ success: true, data: { pageSkills: [], registeredSkills: [] } });
    expect(new Headers(init.headers).get("x-domain-id")).toBe(domain);
    const body = JSON.parse(String(init.body));
    published.push(body);
    return Response.json({ skill: body.skill, digest: "a".repeat(64), description: "A portable sample" }, { status: 201 });
  }));
  await skillManager.importSkill(domain, zip(), true);
  const provider = { namespace: { kind: "provider" as const, provider: "workbench" }, name: "assistant-report" };
  const analyst = { namespace: { kind: "provider" as const, provider: "ontology" }, name: "ontomato-analyst-assistant" };
  expect((await prepareAssistantSkills(domain, { kind: "custom", skills: [analyst, provider, reference] }, {})).skills).toEqual([analyst, provider, reference]);
  const script = (body: { files: { path: string; content: string }[] }) =>
    body.files.find((file) => file.path === "scripts/main.mjs")?.content;
  await skillManager.importSkill(domain, zip({ "scripts/main.mjs": "console.log('next run');\n" }), true);
  await prepareAssistantSkills(domain, { kind: "custom", skills: [reference] }, {});
  expect(published.map((p) => p.skill)).toEqual([reference, reference]);
  // A captured version is the package as it was: the later import reaches only the new publication.
  expect(script(published[0])).toBe(files["scripts/main.mjs"]);
  expect(script(published[1])).toBe("console.log('next run');\n");
  expect(published).toHaveLength(2);
  await expect(prepareAssistantSkills("another-domain", { kind: "custom", skills: [reference] }, {})).rejects.toThrow();
});

it("publishes every bundled public directory with the same standard package contract", async () => {
  const skills = await skillRegistryManager.publicSkills();
  expect(skills.length).toBeGreaterThan(0);
  for (const skill of skills) {
    const request = await readSkillPackage(skill.path, { namespace: { kind: "provider", provider: "workbench" }, name: skill.id });
    expect(request.files.some((file) => file.path === "SKILL.md")).toBe(true);
  }
});


it("network-graph CLI takes the runtime language only when the input omits it", async () => {
  const script = path.resolve("skills/executable/visualization/network-graph/scripts/index.mjs");
  for (const locale of [undefined, "ja"]) {
    const workspace = await fs.mkdtemp(path.join(root, "visualization-cli-"));
    const source = path.join(workspace, "input.json");
    await fs.writeFile(source, JSON.stringify({ title: "Locale contract", data: { nodes: [{ id: "a", name: "A" }], links: [] }, locale }));
    execFileSync(process.execPath, [script, source], {
      cwd: workspace,
      env: { ...process.env, ONTOMATO_LANGUAGE: "zh-CN", ONTOMATO_OUTPUT_DIR: path.join(workspace, "outputs") },
    });
    const [file] = await fs.readdir(path.join(workspace, "outputs"));
    const html = await fs.readFile(path.join(workspace, "outputs", file), "utf8");
    expect(html).toContain(`<html lang="${(locale ?? "zh-CN").split("-")[0]}"`);
  }
});
