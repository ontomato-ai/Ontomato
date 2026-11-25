import { tForLocale } from "../../i18n";
import { isOpsDiagnosisKind } from "../ops-diagnosis/definition";
import { isPresetAgentKind, presetAgentDefinitions } from "./preset-definitions";

export function assistantName(agent: { kind: string; name: string }, locale?: string) {
  if (isOpsDiagnosisKind(agent.kind)) return tForLocale(locale, "panels.simplePages.diagnosisAgent");
  return isPresetAgentKind(agent.kind) && presetAgentDefinitions[agent.kind].name === agent.name
    ? tForLocale(locale, `assistant.default.${agent.kind}.name`) : agent.name;
}

/** Localize only shipped descriptions; user-authored descriptions remain domain content. */
export function assistantDescription(agent: { kind: string; description: string }, locale?: string) {
  if (isOpsDiagnosisKind(agent.kind)) return tForLocale(locale, "panels.simplePages.diagnosisDescription");
  return isPresetAgentKind(agent.kind) && presetAgentDefinitions[agent.kind].description === agent.description
    ? tForLocale(locale, `assistant.default.${agent.kind}.description`) : agent.description;
}
