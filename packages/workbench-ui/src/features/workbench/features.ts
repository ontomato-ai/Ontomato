import type { ShellFeatureDeclaration } from "@ontomato/agent-shell-ui";

/**
 * The agent platform's own entries in its column, before the recent conversations.
 *
 * The settings sit beside the conversation (the agent page is a pilot of page activation): an agent can be written in the
 * conversation, filled into the settings form by its draft and saved there. The dashboards open beside it too, drawn by
 * the page's own component from the platform's registry. The scheduled tasks are the platform's one list, so they are not
 * listed here; an edition that later needs an entry of its own passes it in.
 *
 * A page's skill narrows the composer to the agents that carry it. The pages whose skills are not registered yet carry no
 * declaration, and their composer offers every agent: the settings' skill arrives with the configuration skill, the
 * dashboards' with the dashboard mapping.
 */
const agentSettingsFeature: ShellFeatureDeclaration = {
  id: "agents",
  label: "agents",
  icon: "agents",
  availability: "page",
  withConversation: true,
};

/** The dashboards are an application of their own: this application opens one beside its conversation, not a copy. */
export const DASHBOARDS_PAGE_ID = "dashboards";

/**
 * The dashboards page beside the conversation. Its address is what this application's page parameter names: enlarging
 * it opens the dashboard application at that board. Its skill narrows the composer to the agents that can read and draft
 * a board's cards, by the domain membership the dashboards application itself is open to.
 */
export function dashboardsPageFeature(address: string): ShellFeatureDeclaration {
  return {
    id: DASHBOARDS_PAGE_ID,
    label: "dashboards",
    icon: "dashboards",
    availability: "page",
    withConversation: true,
    address,
    pageSkill: { pageKey: "dashboard", access: "domain-member" },
  };
}

export function workbenchFeatures(
  editionFeatures: readonly ShellFeatureDeclaration[],
  dashboards = dashboardsPageFeature(""),
): ShellFeatureDeclaration[] {
  return [agentSettingsFeature, dashboards, ...editionFeatures];
}
