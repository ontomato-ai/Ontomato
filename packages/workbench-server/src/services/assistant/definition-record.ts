import type { AgentDefinitionCategory } from "@ontomato/contracts/platform-object-types";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";

export function agentDefinitionRecord(
  { id, name, description, enabled }: { id: string; name: string; description: string; enabled: boolean },
  category: AgentDefinitionCategory,
  locale: string | undefined,
  canEdit: boolean,
  domainShared?: boolean,
): PanelRecord {
  return {
    primaryKey: id,
    label: name,
    fields: {
      name, description,
      enabled: tForLocale(locale, enabled ? "panels.agentForm.enabledOn" : "panels.agentForm.enabledOff"),
      category: tForLocale(locale, `panels.agentDefinition.category.${category}`),
      ...(domainShared !== undefined && { domainShared }),
    },
    fieldLabels: {
      name: tForLocale(locale, "panels.agentForm.name"),
      description: tForLocale(locale, "panels.agentForm.description"),
      enabled: tForLocale(locale, "panels.agentForm.enabled"),
      category: tForLocale(locale, "panels.agentDefinition.category"),
    },
    outputs: { category, canEdit, canGrant: canEdit, ...(domainShared !== undefined && { domainShared }) },
    tones: { enabled: enabled ? "success" : "default" },
  };
}
