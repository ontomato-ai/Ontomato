import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { runtimeSkillKey, runtimeSkillRefSchema, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { panelOptionListSchema, panelRecordListSchema, panelRecordQuerySchema, panelRecordSchema } from "@ontomato/contracts/panel-projection";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

/*
 * The skill owner's reference-picker reads through the real catalogue chain: packages really scanned from the
 * domain's skill root, real builtin resources, and the reader's credentials and language, with Java calls
 * answered at the HTTP boundary. `resolve` must name a form's held values one per value in
 * the submitted order, and every value this call cannot see — unreadable, missing, or removed — carries the same
 * generalized label and reason, never the skill's own name.
 */

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-panel-reads-"));
const publicSkillsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "skill-panel-public-"));
installContentLayout({ runtimeRoot: root, prompts: [], runtimeResources: [], publicSkillsRoot });
const { createSkillReadAdapter } = await import("../panel-reads");
const { countAssistantSkills } = await import("../../assistant/skills");

const domain = "skill-reads-domain";
const owner = { domainId: domain, userId: "reader" };
const credentials = { token: "initiator-token", locale: "en" };
const governance: RuntimeSkillRef = { namespace: { kind: "provider", provider: "ontology" }, name: "knowledge-governance" };
const domainSkill: RuntimeSkillRef = { namespace: { kind: "domain", domainId: domain }, name: "domain-helper" };
const systemOnlySkillNames = ["ontomato-app-builder", "ops-diagnosis", "ontomato-analyst", "data-retrieval"];
const skillName = (value: unknown) => {
  const parsed = runtimeSkillRefSchema.safeParse(value);
  return parsed.success ? parsed.data.name : undefined;
};

async function installDomainSkill(name: string, description: string) {
  const skillRoot = path.join(root, "data", "domain-skills", domain, name);
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nRun scripts/main.mjs.\n`);
}

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(publicSkillsRoot, { recursive: true, force: true });
});
beforeEach(() => {
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "test-service-token");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    if (url.endsWith("/internal/workbench-management/require")) {
      expect(JSON.parse(String(init.body))).toEqual({ domainId: domain, operationId: workbenchManagement.skillLibraryRead.id });
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/authorization/objects/decide-batch")) {
      const { requests } = JSON.parse(String(init.body));
      return Response.json({ decisions: requests.map(() => ({ allowed: true })) });
    }
    throw new Error(`Unexpected upstream: ${url}`);
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("answers the reader's visible catalogue as panel options in the owner's order", async () => {
  await installDomainSkill("domain-helper", "A domain skill package");

  const catalogue = await createSkillReadAdapter(owner, credentials).options();

  expect(panelOptionListSchema.parse(catalogue)).toEqual(catalogue);
  expect(catalogue.options[0]).toEqual({
    primaryKey: runtimeSkillKey(governance),
    value: governance,
    label: "Knowledge governance",
    description: "Review business knowledge with traceable evidence",
  });
  expect(catalogue.options.map(({ label }) => label)).toContain("Analysis report");
  for (const name of systemOnlySkillNames) {
    const restricted = catalogue.options.find(option => skillName(option.value) === name);
    expect(restricted?.unavailable).toEqual({ reason: "This skill is not available to you." });
  }
  expect(catalogue.options.find(option => skillName(option.value) === "ontomato-page-operator")?.unavailable).toBeUndefined();
  const helper = catalogue.options.find(option => option.primaryKey === runtimeSkillKey(domainSkill));
  expect(helper).toEqual({
    primaryKey: runtimeSkillKey(domainSkill),
    value: domainSkill,
    label: "domain-helper",
    description: "A domain skill package",
  });
});

it("names each held value in its submitted order, repeating duplicates item by item", async () => {
  await installDomainSkill("domain-helper", "A domain skill package");
  const ghost: RuntimeSkillRef = { namespace: { kind: "domain", domainId: domain }, name: "ghost-skill" };

  const resolved = await createSkillReadAdapter(owner, credentials)
    .resolve({ values: [domainSkill, ghost, governance, domainSkill] });

  expect(resolved.options).toHaveLength(4);
  expect(resolved.options[0]).toEqual({
    primaryKey: runtimeSkillKey(domainSkill),
    value: domainSkill,
    label: "domain-helper",
    description: "A domain skill package",
  });
  expect(resolved.options[1]).toEqual({
    primaryKey: runtimeSkillKey(ghost),
    value: ghost,
    label: "Unavailable skill",
    unavailable: { reason: "This skill is not available to you." },
  });
  expect(resolved.options[2]).toEqual({
    primaryKey: runtimeSkillKey(governance),
    value: governance,
    label: "Knowledge governance",
    description: "Review business knowledge with traceable evidence",
  });
  expect(resolved.options[3]).toEqual(resolved.options[0]);
});

it("answers unreadable, missing, and removed skills with the same generalized label and no private names", async () => {
  await installDomainSkill("gone-skill", "A skill about to disappear");
  const removed: RuntimeSkillRef = { namespace: { kind: "domain", domainId: domain }, name: "gone-skill" };
  const adapter = createSkillReadAdapter(owner, credentials);
  expect((await adapter.options()).options.some(option => option.primaryKey === runtimeSkillKey(removed))).toBe(true);

  await fs.rm(path.join(root, "data", "domain-skills", domain, "gone-skill"), { recursive: true });
  const foreign: RuntimeSkillRef = { namespace: { kind: "domain", domainId: "another-domain" }, name: "gone-skill" };
  const missing: RuntimeSkillRef = { namespace: { kind: "domain", domainId: domain }, name: "ghost-skill" };

  const resolved = await adapter.resolve({ values: [foreign, missing, removed] });

  // The generalized copy is the shipped localization, not the raw key shown while a key is missing.
  expect(resolved.options.map(({ label }) => label))
    .toEqual(["Unavailable skill", "Unavailable skill", "Unavailable skill"]);
  const reason = "This skill is not available to you.";
  expect(resolved.options.map(option => option.unavailable?.reason)).toEqual([reason, reason, reason]);
  for (const option of resolved.options) {
    expect(option.description).toBeUndefined();
    expect(option.label).not.toContain("gone-skill");
    expect(option.label).not.toContain("ghost-skill");
    expect(option.label.startsWith("assistant.")).toBe(false);
  }
  expect("Unavailable skill").not.toContain("gone-skill");
  expect(resolved.options[2].value).toEqual(removed);
});

it("queries the skill library with search, cursor/size paging, and read-only markers", async () => {
  await installDomainSkill("alpha-helper", "Alpha domain skill");
  await fs.writeFile(
    path.join(root, "data", "domain-skills", domain, "alpha-helper", "README.md"),
    "Alpha readme\n",
  );
  const publicSkillDir = path.join(publicSkillsRoot, "builtin-guide");
  await fs.mkdir(publicSkillDir, { recursive: true });
  await fs.writeFile(
    path.join(publicSkillDir, "SKILL.md"),
    "---\nname: builtin-guide\ndescription: Builtin guide skill\n---\nGuide body\n",
  );
  const adapter = createSkillReadAdapter(owner, credentials);

  const page1 = panelRecordQuerySchema.parse(await adapter.query({ size: 2 }));
  expect(page1.total).toBe(13);
  expect(page1.nextCursor).toBe("2");
  expect(page1.rows).toHaveLength(2);

  const page2 = panelRecordQuerySchema.parse(await adapter.query({ cursor: "2", size: 2 }));
  expect(page2.total).toBe(13);
  expect(page2.nextCursor).toBe("4");
  expect(page2.rows).toHaveLength(2);

  const all = panelRecordQuerySchema.parse(await adapter.query({}));
  expect(await adapter.count()).toEqual({ rows: [], total: all.rows.length });
  expect(all.total).toBe(all.rows.length);
  expect((await adapter.options()).options).toHaveLength(all.rows.length);
  expect(await countAssistantSkills(domain, credentials)).toBe(all.total!);
  expect(all.rows.map(row => row.primaryKey)).toEqual([
    "knowledge-governance",
    "assistant-report",
    "application-design",
    "ontomato-agent-builder",
    "ontomato-page-operator",
    "ontomato-analyst-assistant",
    "ontomato-app-builder",
    "ops-diagnosis",
    "ontomato-analyst",
    "data-retrieval",
    "builtin-guide",
    "alpha-helper",
    "domain-helper",
  ]);
  const publicRow = all.rows.find(row => row.primaryKey === "builtin-guide")!;
  expect(publicRow).toEqual({
    primaryKey: "builtin-guide",
    label: "builtin-guide",
    subtitle: "Builtin guide skill",
    fieldLabels: { description: "Description", source: "Source", writeRestriction: "Write restriction" },
    fields: {
      description: "Builtin guide skill",
      source: "Platform",
      writeRestriction: "Built-in skills come with the product and cannot be deleted",
    },
  });
  expect(all.rows.find(row => row.primaryKey === "knowledge-governance")).toMatchObject({
    label: "Knowledge governance",
    subtitle: "Review business knowledge with traceable evidence",
    fields: {
      description: "Review business knowledge with traceable evidence",
      source: "Platform",
      writeRestriction: "Built-in skills come with the product and cannot be deleted",
    },
  });
  expect(all.rows.find(row => row.primaryKey === "alpha-helper")).toEqual({
    primaryKey: "alpha-helper",
    label: "alpha-helper",
    subtitle: "Alpha domain skill",
    fieldLabels: { description: "Description", source: "Source", writeRestriction: "Write restriction" },
    fields: {
      description: "Alpha domain skill",
      source: "This domain",
      writeRestriction: "",
    },
  });

  const searched = panelRecordQuerySchema.parse(await adapter.query({ search: "Alpha" }));
  expect(searched).toEqual({
    rows: [all.rows.find(row => row.primaryKey === "alpha-helper")],
    total: 1,
  });
});

it("reads one skill record, its package files with path keys, and one file's content", async () => {
  await installDomainSkill("file-skill", "Skill with files");
  const skillDir = path.join(root, "data", "domain-skills", domain, "file-skill");
  await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
  await fs.writeFile(path.join(skillDir, "scripts", "run.mjs"), "console.log('ok');\n");

  const adapter = createSkillReadAdapter(owner, credentials);

  const rec = panelRecordSchema.parse(await adapter.record("file-skill"));
  expect(rec.primaryKey).toBe("file-skill");
  expect(rec.fields.source).toBe("This domain");
  expect(rec.fields.writeRestriction).toBe("");

  await expect(adapter.record("missing-skill")).rejects.toMatchObject({
    status: 404,
    code: "SKILL_NOT_FOUND",
  });

  const files = panelRecordListSchema.parse(await adapter.files("file-skill"));
  expect(files).toEqual([
    {
      primaryKey: "SKILL.md",
      label: "SKILL.md",
      fieldLabels: { size: "Size" },
      fields: { size: expect.any(String) },
    },
    {
      primaryKey: "scripts/run.mjs",
      label: "scripts/run.mjs",
      fieldLabels: { size: "Size" },
      fields: { size: String(Buffer.byteLength("console.log('ok');\n", "utf8")) },
    },
  ]);

  const file = panelRecordSchema.parse(await adapter.file("file-skill", { path: "scripts/run.mjs" }));
  expect(file).toEqual({
    primaryKey: "scripts/run.mjs",
    label: "scripts/run.mjs",
    fieldLabels: { content: "Content" },
    fields: { content: "console.log('ok');\n" },
  });

  await expect(adapter.file("file-skill", { path: "scripts/none.mjs" })).rejects.toMatchObject({
    status: 404,
    code: "SKILL_FILE_NOT_FOUND",
  });
});

it("shows built-in skill explanations, reads file-backed instructions, and lists no files for generated skills", async () => {
  const adapter = createSkillReadAdapter(owner, credentials);

  const operator = panelRecordSchema.parse(await adapter.record("ontomato-page-operator"));
  expect(operator).toMatchObject({
    label: "Operate pages",
    fields: {
      description: "Discover applications and pages, read page data, fill forms, and invoke declared page operations.",
      source: "Platform",
    },
  });
  const operatorFiles = panelRecordListSchema.parse(await adapter.files("ontomato-page-operator"));
  expect(operatorFiles.some(file => file.primaryKey === "SKILL.md")).toBe(true);
  const instructions = panelRecordSchema.parse(await adapter.file("ontomato-page-operator", { path: "SKILL.md" }));
  expect(instructions.fields.content).toContain("Discover applications and pages");

  const governanceRecord = panelRecordSchema.parse(await adapter.record("knowledge-governance"));
  expect(governanceRecord).toMatchObject({
    label: "Knowledge governance",
    fields: {
      description: "Review business knowledge with traceable evidence",
      source: "Platform",
    },
  });
  expect(panelRecordListSchema.parse(await adapter.files("knowledge-governance"))).toEqual([]);
  await expect(adapter.file("knowledge-governance", { path: "SKILL.md" })).rejects.toMatchObject({
    status: 404,
    code: "SKILL_FILE_NOT_FOUND",
  });
});
