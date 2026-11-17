import type { ShellFeatureDeclaration } from "@ontomato/agent-shell-ui";
import { platformRoutes } from "@ontomato/platform-shell/routes";

/**
 * The agent platform's own entries in its column, before the recent conversations.
 *
 * The settings sit beside the conversation (the agent page is a pilot of page activation): an agent can be written in the
 * conversation, filled into the settings form by its draft and saved there. The dashboards open beside it too, drawn by
 * the page's own component from the platform's registry. The scheduled tasks are the platform's one list, so they are not
 * listed here; an edition that later needs an entry of its own passes it in.
 *
 * A page's skill narrows the composer to the agents that carry it: the settings' own page declares `agent-settings` with
 * the `analysis-agent` code it opens with, and the dashboards' declaration arrives with the dashboard mapping.
 */
const agentSettingsPageSkill = { pageKey: "agent-settings", permissionCode: "analysis-agent" } as const;

const agentSettingsFeature: ShellFeatureDeclaration = {
  id: "agents",
  label: "agents",
  icon: "agents",
  availability: "page",
  withConversation: true,
  address: platformRoutes.ontologyAgents.path,
  pageSkill: agentSettingsPageSkill,
};

/** The dashboards are an application of their own: this application opens one beside its conversation, not a copy. */
export const DASHBOARDS_PAGE_ID = "dashboards";

/**
 * The dashboards page beside the conversation. Its address is what this application's page parameter names: enlarging
 * it opens the dashboard application at that board.
 */
export function dashboardsPageFeature(address: string): ShellFeatureDeclaration {
  return { id: DASHBOARDS_PAGE_ID, label: "dashboards", icon: "dashboards", availability: "page", withConversation: true, address };
}

export function workbenchFeatures(
  editionFeatures: readonly ShellFeatureDeclaration[],
  dashboards = dashboardsPageFeature(""),
): ShellFeatureDeclaration[] {
  return [agentSettingsFeature, dashboards, ...editionFeatures];
}
