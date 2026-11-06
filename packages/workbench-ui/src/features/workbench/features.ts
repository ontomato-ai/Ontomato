import type { ShellFeatureDeclaration } from "@ontomato/agent-shell-ui";

/**
 * The agent platform's own entries in its column, after a new conversation and before the recent conversations.
 *
 * The platform's pages are not listed here: the agent settings are the column's own foot, the dashboards are an
 * application of their own, the scheduled tasks are the platform's one list, and the star map belongs to the object
 * browser (DESIGN.md "Applications and shells"). So neither edition has an entry left, and an edition that later needs
 * one of its own passes it in.
 */
export function workbenchFeatures(editionFeatures: readonly ShellFeatureDeclaration[]): ShellFeatureDeclaration[] {
  return [...editionFeatures];
}
