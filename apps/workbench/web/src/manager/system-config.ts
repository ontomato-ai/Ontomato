import type { BusinessConfigProps } from "@ontomato/platform-admin";

/** Original values of the open-source system configuration page (before it moved out of the workbench). */
export const ossSystemConfig: BusinessConfigProps = {
  defaultLanguage: "en",
  adapterDisplay: {
    labelWidth: "150px",
    urlSpan: 24,
    credentialSpan: 12,
  },
  // The open-source data engine ships only lang/en.json.
  languageOptions: [{ value: "en", label: "English" }],
};
