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
/** The ids are what the conversation's parameter and the host's slots name; the labels are what a reader reads. */
export const AGENT_SETTINGS_PAGE_ID = "agents";
const agentSettingsFeature = (label: string): ShellFeatureDeclaration => ({
  id: AGENT_SETTINGS_PAGE_ID,
  label,
  icon: "agents",
  availability: "page",
  listed: false,
  withConversation: true,
});

/** The dashboards are an application of their own: this application opens one beside its conversation, not a copy. */
export const DASHBOARDS_PAGE_ID = "dashboards";

/**
 * The dashboards' own skill, by the domain membership the dashboards application itself is open to: one declaration,
 * read by the composer beside the conversation and by the page's own composer at its address.
 */
export const DASHBOARDS_PAGE_SKILL = { pageKey: "dashboard", access: "domain-member" } as const;

/**
 * The dashboards page beside the conversation. Its address is what this application's page parameter names: enlarging
 * it opens the dashboard application at that board. Its skill narrows the composer to the agents that can read and draft
 * a board's cards, by the domain membership the dashboards application itself is open to.
 */
export function dashboardsPageFeature(label: string, address: string): ShellFeatureDeclaration {
  return {
    id: DASHBOARDS_PAGE_ID,
    label,
    icon: "dashboard",
    availability: "page",
    listed: false,
    withConversation: true,
    address,
    pageSkill: DASHBOARDS_PAGE_SKILL,
  };
}

export function workbenchFeatures(
  editionFeatures: readonly ShellFeatureDeclaration[],
  /** The two pages this application opens beside its conversation, named in the reader's language. */
  pages: { agents: string; dashboards: string },
  dashboardsAddress = "",
): ShellFeatureDeclaration[] {
  return [agentSettingsFeature(pages.agents), dashboardsPageFeature(pages.dashboards, dashboardsAddress), ...editionFeatures];
}
