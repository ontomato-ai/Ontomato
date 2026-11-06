import type { ShellFeatureDeclaration } from "@ontomato/agent-shell-ui";

/**
 * The agent platform's own entries in its column, after a new conversation and before the recent conversations.
 *
 * The platform's pages are not listed here any more: the agent settings are the column's own foot, the dashboards are
 * their own application, and the scheduled tasks are the platform's one list (DESIGN.md "Applications and shells"). What
 * remains is what an edition adds — the enterprise edition's graph — and nothing in the open-source edition.
 */
export function workbenchFeatures(editionFeatures: readonly ShellFeatureDeclaration[]): ShellFeatureDeclaration[] {
  return [...editionFeatures];
}
