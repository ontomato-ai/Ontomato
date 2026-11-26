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
  publishOntologyAssistantSkill: vi.fn(),
  publishGovernanceSkill: vi.fn(),
}));

vi.mock("../../product-panels/application-use", () => ({ requirePanelEntry: mocks.requirePanelEntry }));
vi.mock("../governance", () => ({ publishGovernanceSkill: mocks.publishGovernanceSkill }));
vi.mock("../../agent-runtime/skills", async original => ({
  ...await original<typeof import("../../agent-runtime/skills")>(),
  publishSkill: mocks.publishSkill,
  publishSkillPackage: mocks.publishSkillPackage,
  publishOntologyAssistantSkill: mocks.publishOntologyAssistantSkill,
}));

configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { ...enLocaleMeta, messages: en } } });
installContentLayout({
  runtimeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "page-operator-prepare-runtime-")),
  prompts: [],
  publicSkillsRoot: fs.mkdtempSync(path.join(os.tmpdir(), "page-operator-prepare-public-")),
  runtimeResources: [],
});
const { prepareAssistantSkills, validateCurrentPageContext } = await import("../skills");

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
