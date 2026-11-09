import { tForLocale } from "../../i18n";

export function assistantName(agent: { kind: string; name: string }, locale?: string) {
  const defaults: Record<string, string> = { regular: "Assistant", analysis: "Analyst" };
  return defaults[agent.kind] === agent.name
    ? tForLocale(locale, `assistant.default.${agent.kind}.name`) : agent.name;
}

/** Localize only shipped descriptions; user-authored descriptions remain domain content. */
export function assistantDescription(agent: { kind: string; description: string }, locale?: string) {
  const defaults: Record<string, string> = {
    regular: "Ask questions about your data",
    analysis: "Investigate questions and produce reports",
  };
  return defaults[agent.kind] === agent.description
    ? tForLocale(locale, `assistant.default.${agent.kind}.description`)
    : agent.description;
}
