import { expect, it } from "vitest";
import { ref } from "vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";

/*
 * A panel's words follow the platform's language by the platform's own rule, so a panel never shows a third language
 * the reader did not pick and the deployment did not default to, and a word not yet translated shows where it is missing.
 */

const messages = {
  en: { "settings.title": "Agent settings", "scope.count": "{count} object types", "only.en": "English only" },
  "zh-CN": { "settings.title": "智能体设置", "scope.count": "{count} 个对象类" },
  ja: { "only.ja": "日本語のみ" },
};

it("reads the panel's words in the platform's language and follows it when it changes", () => {
  const locale = ref("zh-CN");
  const t = createPanelText(messages, locale, "en");
  expect(t("settings.title")).toBe("智能体设置");
  expect(t("scope.count", { count: 3 })).toBe("3 个对象类");
  locale.value = "en";
  expect(t("settings.title")).toBe("Agent settings");
});

it("falls back to the deployment's default language and then to the key, never through another language", () => {
  const t = createPanelText(messages, ref("ja"), "zh-CN");
  expect(t("only.ja")).toBe("日本語のみ");
  expect(t("settings.title")).toBe("智能体设置");
  // English is neither the reader's language nor the default here, so its word is not used.
  expect(t("only.en")).toBe("only.en");
});
