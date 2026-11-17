/**
 * The agent the reader last used in the agent platform, kept in this browser. The agent platform starts on it, and the
 * platform home offers it first when the reader asks a question from there.
 */
const AGENT_KEY = "ontomato.workbench.agent";

export function readRememberedAgent(): string | null {
  try {
    return localStorage.getItem(AGENT_KEY);
  } catch {
    return null;
  }
}

/**
 * The conversation this tab last held with an agent, so a message written from a page of the platform goes on in it
 * (same tab, same agent) instead of starting again; a new tab holds no conversation and starts a new one.
 */
const SESSION_KEY = "ontomato.workbench.conversation";

export function readRememberedSession(agentId: string): string | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as { agentId?: string; sessionId?: string } | null;
    return stored?.agentId === agentId ? stored.sessionId ?? null : null;
  } catch {
    return null;
  }
}

export function rememberSession(agentId: string, sessionId: string) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ agentId, sessionId }));
  } catch {
    // Remembering the conversation is a convenience only.
  }
}

export function rememberAgent(id: string) {
  try {
    localStorage.setItem(AGENT_KEY, id);
  } catch {
    // Remembering the agent is a convenience only.
  }
}
