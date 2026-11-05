import { afterEach, describe, expect, it } from "vitest";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSkillMarkdown, SkillIdSchema, SkillManifestSchema, InvalidSkillPackageError,
  assertSkillPackageComplete, migrateLegacySkillManifest } from "../manifest";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function rejectsPackage(action: () => unknown) {
  let error: unknown;
  try { action(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(InvalidSkillPackageError);
  expect(error).toMatchObject({ code: "INVALID_SKILL_PACKAGE", status: 400 });
}

configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: false,
  appTextLocale: "en",
  packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
});

describe("skill manifest parsing", () => {
  it("successfully parses skill markdown with legacy supportedChartTypes in frontmatter", () => {
    const markdown = `---
name: legacy-chart-skill
description: A chart skill package with legacy supportedChartTypes field
type: executable
category: visualization
title: Legacy Chart Skill
supportedChartTypes:
  - bar
  - line
entries:
  - scripts/index.mjs
---
## Legacy Chart Skill
This skill renders charts.
`;

    const parsed = parseSkillMarkdown(markdown);
    expect(parsed).not.toBeNull();
    expect(parsed?.manifest.name).toBe("legacy-chart-skill");
    expect(parsed?.manifest.type).toBe("executable");
    expect(parsed?.manifest.category).toBe("visualization");
    expect((parsed?.manifest as Record<string, unknown>).supportedChartTypes).toBeUndefined();
    expect(parsed?.content.trim()).toBe("## Legacy Chart Skill\nThis skill renders charts.");
  });
});

describe("invalid skill packages", () => {
  it("rejects invalid IDs, absent entries, escaping entries and non-executable visualizations", () => {
    expect(SkillIdSchema.safeParse("Bad_ID").success).toBe(false);
    const base = { name: "demo", description: "d", type: "executable", category: "analysis" };
    expect(SkillManifestSchema.safeParse({ ...base, description: "  ", entries: ["main.mjs"] }).success).toBe(false);
    for (const entries of [[], ["../escape"]]) {
      expect(SkillManifestSchema.safeParse({ ...base, entries }).success).toBe(false);
    }
    expect(SkillManifestSchema.safeParse({ ...base, type: "knowledge", category: "visualization" }).success).toBe(false);
  });

  it.each([
    "---\ntitle: bad\n",
    "---\n: bad: [\n---\nbody\n",
    '---\nname: Bad_ID!\ndescription: ""\ntype: executable\ncategory: analysis\nentries: []\n---\nbody\n',
  ])("rejects malformed frontmatter as an invalid package: %s", markdown => {
    rejectsPackage(() => parseSkillMarkdown(markdown));
  });

  it.each(["{bad", "{}"])('rejects an invalid legacy manifest: %s', content => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-validation-"));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, "manifest.json"), content);
    rejectsPackage(() => migrateLegacySkillManifest(dir));
  });

  it("rejects a missing executable entry or empty knowledge body", () => {
    const executable = SkillManifestSchema.parse({ name: "demo", description: "d", type: "executable", category: "analysis", entries: ["scripts/missing.mjs"] });
    const knowledge = SkillManifestSchema.parse({ name: "demo", description: "d", type: "knowledge", category: "analysis" });
    rejectsPackage(() => assertSkillPackageComplete(executable, () => false, "body"));
    rejectsPackage(() => assertSkillPackageComplete(knowledge, () => true, "   "));
  });
});
