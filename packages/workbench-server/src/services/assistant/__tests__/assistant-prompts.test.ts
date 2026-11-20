import path from "node:path";
import { readFileSync } from "node:fs";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { __test__ as promptLoaderTest, getPromptTemplate } from "../../../core/prompts/loader";
import {
  effectiveSystemPrompt,
  storedSystemPrompt,
} from "../prompts";

configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: false,
  appTextLocale: "en",
  packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
});

describe("default assistant prompts", () => {
  beforeAll(() => {
    promptLoaderTest.setPromptDirectories({
      sources: [],
      runtimeDir: path.resolve("prompts"),
    });
  });
  afterAll(() => promptLoaderTest.setPromptDirectories(null));

  it("reads the current template when the stored prompt is NULL", () => {
    const template = getPromptTemplate("assistant.regular.system");
    expect(
      effectiveSystemPrompt({ kind: "regular", system_prompt: null }),
    ).toBe(template);
    expect(
      effectiveSystemPrompt({ kind: "regular", system_prompt: "custom" }),
    ).toBe("custom");
  });

  it.each(["regular", "analysis"])("%s delegates through the skill without obsolete transport instructions", (kind) => {
    const template=getPromptTemplate(`assistant.${kind}.system`);
    expect(template).toContain("ontomato-analyst-assistant/SKILL.md");
    expect(template).not.toMatch(/ontomato-analyst-assistant\s+ask|\bask\s+--|--resume|cancel-retriever|resume (?:that|the same|that same) retrieval/i);
    expect(template).toMatch(/only when the user requests them/i);
    expect(template).toMatch(/only the accepted dataset files used as evidence/i);
    expect(template).not.toMatch(/Show every dataset file you obtained/i);
    const customized="Use ontomato-analyst-assistant ask according to my own instructions";
    expect(effectiveSystemPrompt({kind,system_prompt:customized})).toBe(customized);
  });

  it("the product analyst skill preserves metadata commands and uses native delegation", () => {
    const skill=readFileSync(path.resolve("../../agent-skills/ontomato-analyst-assistant/SKILL.md"),"utf8");
    expect(skill).toContain('op: "list"');expect(skill).toContain('op: "start"');expect(skill).toContain('op: "read"');
    expect(skill).toContain("notification");
    for(const command of ["dataset-desc","classes","schema <class>...","relationships <class>...","metrics <question>","knowledge <question>"])
      expect(skill).toContain(command);
    expect(skill).toContain("The host supplies ONTOMATO_ONTOLOGY_URL");
    expect(skill).toContain('op: "cancel"');
    expect(skill).not.toMatch(/node[^\r\n`]*\bagent\b|--follow|--files|--reply-to|retriever-cancel/);
  });

  it("stores NULL when a built-in agent still equals the current template", () => {
    const template = getPromptTemplate("assistant.analysis.system");
    expect(storedSystemPrompt("analysis", `\n${template}\n  `)).toBeNull();
    expect(storedSystemPrompt("analysis", "custom")).toBe("custom");
    // User-defined agents never follow the built-in template.
    expect(storedSystemPrompt("7a2e8c4d-agent", template)).toBe(template);
  });
});
