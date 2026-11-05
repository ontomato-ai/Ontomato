import path from "node:path";
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

  it("stores NULL when a built-in agent still equals the current template", () => {
    const template = getPromptTemplate("assistant.analysis.system");
    expect(storedSystemPrompt("analysis", `\n${template}\n  `)).toBeNull();
    expect(storedSystemPrompt("analysis", "custom")).toBe("custom");
    // User-defined agents never follow the built-in template.
    expect(storedSystemPrompt("7a2e8c4d-agent", template)).toBe(template);
  });
});
