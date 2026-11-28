import { expect, it } from "vitest";
import { createCodexPlugin } from "../adapters/codex";
import { preloadedSkillDocument } from "../skills";

it("prepends the mounted location to the SKILL.md body without its frontmatter", () => {
  const document = "---\nname: fixture-skill\ndescription: Fixture\n---\nUse scripts/run.mjs.\n";
  expect(preloadedSkillDocument("fixture-skill", "/skills/fixture-skill", document)).toBe(
    'Skill "fixture-skill" is already loaded below. Its files are in /skills/fixture-skill, and paths in it are relative to that directory. Do not read its SKILL.md again.\n\nUse scripts/run.mjs.\n',
  );
});

it("writes the mounted directory where the skill says <this-skill>", () => {
  const document = "---\nname: fixture-skill\n---\nRun `node <this-skill>/scripts/run.mjs` from the workspace root.\n";
  expect(preloadedSkillDocument("fixture-skill", "/skills/fixture-skill", document)).toContain(
    "Run `node /skills/fixture-skill/scripts/run.mjs` from the workspace root.",
  );
});

it("uses the Codex skill catalog location rather than its source mount", () => {
  expect(createCodexPlugin().skillCatalogDirectory?.(
    { workspace: "/workspace", state: "/native", skills: [] },
    "fixture-skill",
  )).toBe("/native/home/.agents/skills/fixture-skill");
});
