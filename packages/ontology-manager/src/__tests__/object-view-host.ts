import type { App } from "vue";
import { ref } from "vue";
import { createI18n } from "vue-i18n";
import { createManager } from "../context";
import { englishMessages, managerMessageTree } from "../i18n";

export function installObjectViewHost(app: App, apiBase = "/api", token = "test-token") {
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: managerMessageTree(englishMessages) } });
  app.use(i18n);
  const manager = createManager({
    apiBase, credential: { type: "token", token }, theme: ref("light"), locale: ref("en"),
    translate: (key, params) => i18n.global.t(key, params ?? {}),
    dataFallbacks: { noBusinessDescription: "", unnamedAsset: "" },
    knowledgeTagValues: { general: "", business: "", tech: "" },
    presentation: { themeProperties: { light: {}, dark: {} }, nodePalette: { light: [], dark: [] }, edgeLabel: {}, maxFitZoom: null, dataBrowserDescription: () => "", compactDialogs: false },
    onAuthFailure: () => {},
  });
  manager.install(app);
}
