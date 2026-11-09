import { getPromptTemplate } from "../../core/prompts/loader";
import { resolveLocale } from "../../i18n";
import { promptSources } from "../../content/layout";
import fs from "node:fs";
import path from "node:path";

export type DefaultAgentKind = "regular" | "analysis";

const DEFAULT_KINDS = new Set<string>(["regular", "analysis"]);

export function isDefaultAgentKind(kind: string): kind is DefaultAgentKind {
  return DEFAULT_KINDS.has(kind);
}

/** The current default template for a built-in agent, or null for a user-defined agent. */
export function defaultSystemPrompt(kind: string, locale?: string): string | null {
  if (isDefaultAgentKind(kind) && locale) {
    const relative = `locales/${resolveLocale(locale)}/assistant/${kind}/system.md`;
    for (const source of promptSources()) {
      if (source.to === "." && fs.existsSync(path.join(source.from, relative)))
        return getPromptTemplate(`locales.${resolveLocale(locale)}.assistant.${kind}.system`);
    }
  }
  return isDefaultAgentKind(kind) ? getPromptTemplate(`assistant.${kind}.system`) : null;
}

/**
 * The prompt actually sent to the runtime. A NULL stored prompt means the agent follows the
 * current default template; only user-defined agents always carry their own text.
 */
export function effectiveSystemPrompt(agent: {
  kind: string;
  system_prompt: string | null;
}, locale?: string): string {
  if (agent.system_prompt != null) return agent.system_prompt;
  return defaultSystemPrompt(agent.kind, locale) ?? "";
}

/**
 * A built-in agent that still equals the current default is stored as NULL so later template
 * updates apply automatically. Any other text is a customization and is kept.
 */
export function storedSystemPrompt(kind: string, text: string, locale?: string): string | null {
  const template = defaultSystemPrompt(kind, locale);
  return template !== null && text.trim() === template.trim() ? null : text;
}
