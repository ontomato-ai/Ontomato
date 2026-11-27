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
    expect(template).toMatch(/only the files used as evidence/i);
    expect(template).toMatch(/never link a path that no tool returned/i);
    expect(template).not.toMatch(/Show every dataset file you obtained/i);
    const customized="Use ontomato-analyst-assistant ask according to my own instructions";
    expect(effectiveSystemPrompt({kind,system_prompt:customized})).toBe(customized);
  });

  it("distinguishes substantive analysis reports from direct answers and preserves evidence inside the report", () => {
    const analysis = getPromptTemplate("assistant.analysis.system");
    expect(analysis).toContain("create a report with `assistant-report` by default");
    expect(analysis).toContain("simple figures, definitions and short follow-ups directly");
    expect(analysis).toContain("current population");
    expect(analysis).toContain("Do not append all retrieved datasets to the chat");
    expect(analysis).toContain("not a confidence interval");
    expect(getPromptTemplate("assistant.regular.system")).toMatch(/only when the user requests them/i);
  });

  it("the product analyst skill delegates through the native agent tool and uses ontology-query for metrics and definitions", () => {
    const skill=readFileSync(path.resolve("../../agent-skills/ontomato-analyst-assistant/SKILL.md"),"utf8");
    expect(skill).toContain('op: "start"');
    expect(skill).toContain('op: "send"');
    expect(skill).toContain("dd3b91b9-9214-4aa6-9937-fb07fd37b232");
    for(const command of ["dataset-desc","classes","schema <class>...","relationships <class>...","knowledge <question>",
      "recall-metrics","run-metric <id> --revision"])
      expect(skill).toContain(command);
    expect(skill).not.toMatch(/start-retrieval|retriever-ref|assistant\.mjs/);
    expect(skill).toContain('op: "wait"');
    expect(skill).toContain('op: "read"');
    expect(skill).toContain("The host supplies the ontology URL");
    expect(skill).toContain('op: "cancel"');
    expect(skill).not.toMatch(/--follow|--reply-to|retriever-cancel/);
  });

  it("stores NULL when a built-in agent still equals the current template", () => {
    const template = getPromptTemplate("assistant.analysis.system");
    expect(storedSystemPrompt("analysis", `\n${template}\n  `)).toBeNull();
    expect(storedSystemPrompt("analysis", "custom")).toBe("custom");
    // User-defined agents never follow the built-in template.
    expect(storedSystemPrompt("7a2e8c4d-agent", template)).toBe(template);
  });
});
