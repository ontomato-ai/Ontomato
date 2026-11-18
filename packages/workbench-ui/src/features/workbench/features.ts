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
/** The ids are what the conversation's parameter and the host's slots name; the labels are what a reader reads. */
export const AGENT_SETTINGS_PAGE_ID = "agents";
const agentSettingsPageSkill = { pageKey: "agent-settings", permissionCode: "analysis-agent" } as const;
const agentSettingsFeature = (label: string): ShellFeatureDeclaration => ({
  id: AGENT_SETTINGS_PAGE_ID,
  label,
  icon: "agents",
  availability: "page",
  listed: false,
  withConversation: true,
  address: platformRoutes.ontologyAgents.path,
  pageSkill: agentSettingsPageSkill,
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

/** One governance record's report, opened beside the conversation that wrote it. */
export const GOVERNANCE_REPORT_PAGE_ID = "governance-report";

/**
 * The report's own skill: the governance preset the platform's mapping names for `governance-report`, under the business
 * knowledge menu code. One declaration, read by the composer beside the conversation and by the page's own composer.
 */
export const GOVERNANCE_REPORT_PAGE_SKILL = { pageKey: "governance-report", permissionCode: "business-knowledge" } as const;

/**
 * The report page beside the conversation. Its address is what this application's page parameter names, and its own
 * skill narrows the composer to the agents that carry it: the governance preset the platform's mapping names for
 * `governance-report`, under the business knowledge menu code.
 */
export function governanceReportPageFeature(label: string, address: string): ShellFeatureDeclaration {
  return {
    id: GOVERNANCE_REPORT_PAGE_ID,
    label,
    icon: "report",
    availability: "page",
    listed: false,
    withConversation: true,
    address,
    pageSkill: GOVERNANCE_REPORT_PAGE_SKILL,
  };
}

export function workbenchFeatures(
  editionFeatures: readonly ShellFeatureDeclaration[],
  /** The two pages this application opens beside its conversation, named in the reader's language. */
  pages: { agents: string; dashboards: string },
  dashboardsAddress = "",
  /** A governance record's report, declared only while the conversation's page parameter names one. */
  governanceReport: ShellFeatureDeclaration | null = null,
): ShellFeatureDeclaration[] {
  return [
    agentSettingsFeature(pages.agents),
    dashboardsPageFeature(pages.dashboards, dashboardsAddress),
    ...(governanceReport ? [governanceReport] : []),
    ...editionFeatures,
  ];
}
