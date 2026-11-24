import type { AgentDefinitionCategory } from "@ontomato/contracts/platform-object-types";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";

export function agentDefinitionRecord(
  { id, name, description, enabled }: { id: string; name: string; description: string; enabled: boolean },
  category: AgentDefinitionCategory,
  locale?: string,
): PanelRecord {
  return {
    primaryKey: id,
    label: name,
    fields: {
      name, description,
      enabled: tForLocale(locale, enabled ? "panels.agentForm.enabledOn" : "panels.agentForm.enabledOff"),
      category: tForLocale(locale, `panels.agentDefinition.category.${category}`),
    },
    fieldLabels: {
      name: tForLocale(locale, "panels.agentForm.name"),
      description: tForLocale(locale, "panels.agentForm.description"),
      enabled: tForLocale(locale, "panels.agentForm.enabled"),
      category: tForLocale(locale, "panels.agentDefinition.category"),
    },
    outputs: { category },
    tones: { enabled: enabled ? "success" : "default" },
  };
}
