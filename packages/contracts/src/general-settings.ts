export type GeneralConfigKey = "knowledgeMaxResult" | "dslCookerTimeout" | "lang";

/** Native Java endpoints, one per editable key. */
export const generalConfigSaveEndpoints: Record<GeneralConfigKey, string> = {
  knowledgeMaxResult: "/businessConfig/saveKnowledgeMaxResult",
  dslCookerTimeout: "/businessConfig/saveDslCookerTimeout",
  lang: "/businessConfig/saveLang",
};
