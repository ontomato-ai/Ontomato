import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { panelOptionListSchema } from "@ontomato/contracts/panel-projection";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

/*
 * The skill owner's reference-picker reads through the real catalogue chain: packages really scanned from the
 * domain's skill root, real builtin resources, and the reader's credentials and language, with only the Java
 * page-skill projection answered at its HTTP boundary. `resolve` must name a form's held values one per value in
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

const domain = "skill-reads-domain";
const owner = { domainId: domain, userId: "reader" };
const credentials = { token: "initiator-token", locale: "en" };
const governance: RuntimeSkillRef = { namespace: { kind: "provider", provider: "ontology" }, name: "knowledge-governance" };
const domainSkill: RuntimeSkillRef = { namespace: { kind: "domain", domainId: domain }, name: "domain-helper" };

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
  vi.stubGlobal("fetch", vi.fn(async () =>
    Response.json({ success: true, data: { pageSkills: [], registeredSkills: [] } })));
});
afterEach(() => {
  vi.unstubAllGlobals();
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
