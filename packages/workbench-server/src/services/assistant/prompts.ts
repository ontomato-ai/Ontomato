import { getPromptTemplate } from "../../core/prompts/loader";

export type DefaultAgentKind = "regular" | "analysis" | "app-builder";

const DEFAULT_KINDS = new Set<string>(["regular", "analysis", "app-builder"]);

export function isDefaultAgentKind(kind: string): kind is DefaultAgentKind {
  return DEFAULT_KINDS.has(kind);
}

/** The current default template for a built-in agent, or null for a user-defined agent. */
export function defaultSystemPrompt(kind: string): string | null {
  return isDefaultAgentKind(kind) ? getPromptTemplate(`assistant.${kind}.system`) : null;
}

/**
 * The prompt actually sent to the runtime. A NULL stored prompt means the agent follows the
 * current default template; only user-defined agents always carry their own text.
 */
export function effectiveSystemPrompt(agent: {
  kind: string;
  system_prompt: string | null;
}): string {
  if (agent.system_prompt != null) return agent.system_prompt;
  return defaultSystemPrompt(agent.kind) ?? "";
}

/**
 * A built-in agent that still equals the current default is stored as NULL so later template
 * updates apply automatically. Any other text is a customization and is kept.
 */
export function storedSystemPrompt(kind: string, text: string): string | null {
  const template = defaultSystemPrompt(kind);
  return template !== null && text.trim() === template.trim() ? null : text;
}
