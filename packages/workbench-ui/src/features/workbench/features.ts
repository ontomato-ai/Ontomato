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
 * it opens the dashboard application at that board.
 */
export function dashboardsPageFeature(address: string): ShellFeatureDeclaration {
  return { id: DASHBOARDS_PAGE_ID, label: "dashboards", icon: "dashboards", availability: "page", withConversation: true, address };
}

/** One governance record's report, opened beside the conversation that wrote it. */
export const GOVERNANCE_REPORT_PAGE_ID = "governance-report";

/**
 * The report page beside the conversation. Its address is what this application's page parameter names, `label` its
 * word in the column and the pane's title, and its own skill narrows this page's composer to the agents that carry it —
 * the governance preset the platform's mapping names for `governance-report`, with the business knowledge menu code it
 * is registered under.
 */
export function governanceReportPageFeature(address: string, label: string): ShellFeatureDeclaration {
  return {
    id: GOVERNANCE_REPORT_PAGE_ID,
    label,
    icon: "report",
    availability: "page",
    withConversation: true,
    address,
    pageSkill: { pageKey: "governance-report", permissionCode: "business-knowledge" },
  };
}

export function workbenchFeatures(
  editionFeatures: readonly ShellFeatureDeclaration[],
  dashboards = dashboardsPageFeature(""),
  governanceReport: ShellFeatureDeclaration | null = null,
): ShellFeatureDeclaration[] {
  return [agentSettingsFeature, dashboards, ...(governanceReport ? [governanceReport] : []), ...editionFeatures];
}
