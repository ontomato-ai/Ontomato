import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { PAGE_OPERATOR_SKILL } from "../page-operator";

const mocks = vi.hoisted(() => ({
  requirePanelEntry: vi.fn(),
  publishSkill: vi.fn(),
  publishSkillPackage: vi.fn(),
  publishOntologySkill: vi.fn(),
}));

vi.mock("../../product-panels/application-use", () => ({ requirePanelEntry: mocks.requirePanelEntry }));
vi.mock("../../agent-runtime/skills", async original => ({
  ...await original<typeof import("../../agent-runtime/skills")>(),
  publishSkill: mocks.publishSkill,
  publishSkillPackage: mocks.publishSkillPackage,
  publishOntologySkill: mocks.publishOntologySkill,
}));

configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { ...enLocaleMeta, messages: en } } });
installContentLayout({
  runtimeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "page-operator-prepare-runtime-")),
  prompts: [],
  publicSkillsRoot: fs.mkdtempSync(path.join(os.tmpdir(), "page-operator-prepare-public-")),
  runtimeResources: [],
});
const { prepareAssistantSkills, validateAssistantSkills, validateCurrentPageContext } = await import("../skills");

const domainId = "domain";
const credentials = { token: "token", locale: "en" };
const placement = {
  applicationId: "app",
  entryKey: "entry",
  pageKey: "page",
  useId: "entry",
  panelId: "panel",
  path: "/applications/app/entry",
  memberPath: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publishSkill.mockImplementation(async (_root: string, skill: unknown) => ({ skill, digest: "a".repeat(64) }));
  mocks.publishSkillPackage.mockImplementation(async (pkg: { skill: unknown }) => ({ skill: pkg.skill, digest: "a".repeat(64) }));
  mocks.publishOntologySkill.mockImplementation(async (_domain: string, name: string) => ({
    skill: { namespace: { kind: "provider", provider: "ontology" }, name },
    digest: "b".repeat(64),
  }));
});

it("gives page control to a custom agent only when the operator is explicitly selected", async () => {
  const without = await prepareAssistantSkills(domainId, { kind: "custom", skills: [] }, credentials);
  expect(without.pageControl).toBe(false);
  expect(without.skills).toEqual([]);

  const withOperator = await prepareAssistantSkills(domainId, { kind: "custom", skills: [PAGE_OPERATOR_SKILL] }, credentials);
  expect(withOperator.pageControl).toBe(true);
  expect(withOperator.skills.map(({ skill }) => skill)).toEqual([PAGE_OPERATOR_SKILL]);
});

it("accepts the exact admitted current placement and rejects mismatches as forbidden", async () => {
  mocks.requirePanelEntry.mockResolvedValue({
    use: { id: "entry", pageKey: "page", panelId: "panel", path: "/applications/app/entry" },
  });
  await expect(validateCurrentPageContext(domainId, credentials, placement, "user")).resolves.toEqual(placement);

  for (const changed of [
    { ...placement, pageKey: "other-page" },
    { ...placement, panelId: "other-panel" },
    { ...placement, path: "/applications/app/other" },
    { ...placement, useId: "other-entry" },
  ]) {
    await expect(validateCurrentPageContext(domainId, credentials, changed, "user"))
      .rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  }
});

it("keeps system-agent-only skills in the catalogue but rejects selecting them for a custom agent", async () => {
  const opsSkill = { namespace: { kind: "provider" as const, provider: "workbench" }, name: "ops-diagnosis" };
  await expect(validateAssistantSkills(domainId, [opsSkill], credentials))
    .rejects.toMatchObject({ status: 400, code: "SKILL_NOT_FOUND" });

  const prepared = await prepareAssistantSkills(domainId, { kind: "custom", skills: [opsSkill] }, credentials);
  expect(prepared.skills).toEqual([]);
  expect(prepared.pageControl).toBe(false);
  expect(mocks.publishSkill).not.toHaveBeenCalledWith(expect.anything(), opsSkill);
});

it("asks ontology to publish every selected ontology-owned catalog skill by name", async () => {
  for (const name of ["knowledge-governance", "ontomato-analyst-assistant", "ontology-query"]) {
    const skill = { namespace: { kind: "provider" as const, provider: "ontology" }, name };
    const prepared = await prepareAssistantSkills(domainId, { kind: "custom", skills: [skill] }, credentials);
    expect(prepared.skills).toEqual([{ skill, digest: "b".repeat(64) }]);
  }
  expect(mocks.publishOntologySkill.mock.calls).toEqual([
    [domainId, "knowledge-governance"],
    [domainId, "ontomato-analyst-assistant"],
    [domainId, "ontology-query"],
  ]);
  expect(mocks.publishSkill).not.toHaveBeenCalled();
  expect(mocks.publishSkillPackage).not.toHaveBeenCalled();
});
