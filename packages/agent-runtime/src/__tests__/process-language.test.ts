import { expect, it } from "vitest";
import { processLanguageInstruction } from "../process-language";

it.each([
  ["en", "English"], ["zh-CN", "Simplified Chinese"], ["zh-TW", "Traditional Chinese"],
  ["ja", "Japanese"], ["ar", "Arabic"], ["fr", "French"], ["de", "German"], ["it", "Italian"],
])("uses the admitted UI language %s for process text", (locale, name) => {
  const instruction = processLanguageInstruction(locale);
  expect(instruction).toContain(`Process display language: ${name}.`);
  expect(instruction).toContain("reasoning/thinking text");
  expect(instruction).toContain("retain the agent's answer-language instructions");
});
