import en from "element-plus/es/locale/lang/en";
import type { WorkbenchLanguage } from "@ontomato/workbench-ui";
import publicEn from "@ontomato/workbench-ui/locales/en";

/** The open-source language profile: English only, nothing saved, no switch. The platform and the apps SDK use it. */
export const ossLanguage: WorkbenchLanguage = {
  supported: ["en"],
  defaultLocale: "en",
  initialLocale: "en",
  switchEnabled: false,
  save: null,
  messages: { en: publicEn },
  elementLocale: () => en,
};
