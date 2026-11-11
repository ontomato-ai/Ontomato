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

export function rememberAgent(id: string) {
  try {
    localStorage.setItem(AGENT_KEY, id);
  } catch {
    // Remembering the agent is a convenience only.
  }
}
