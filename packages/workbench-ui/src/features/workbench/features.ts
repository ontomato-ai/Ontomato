import type { ShellFeatureDeclaration } from "@ontomato/agent-shell-ui";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";

/** The dashboards are an application of their own: this application opens one beside its conversation, not a copy. */
export const DASHBOARDS_PAGE_ID = "dashboards";

/**
 * The dashboards' own skill, by the domain membership the dashboards application itself is open to: one declaration,
 * read by the composer beside the conversation and by the page's own composer at its address.
 */
export const DASHBOARDS_PAGE_SKILL: PageSkillContext = {
  mode: "public",
  locator: { pageKey: "dashboard", access: "domain-member" },
};

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

/** A panel application's page, opened beside the conversation. */
export const PANEL_APPLICATION_PAGE_ID = "panel-application";

/**
 * A panel application's page beside the conversation, at the address the conversation's page parameter names. It is
 * named by the panel itself, as its instance reports what the reader looks at, so its label is that report's.
 */
export function panelApplicationPageFeature(label: string, address: string): ShellFeatureDeclaration {
  return {
    id: PANEL_APPLICATION_PAGE_ID,
    label,
    icon: "dashboard",
    availability: "page",
    listed: false,
    withConversation: true,
    scrollsItself: true,
    address,
  };
}

export function workbenchFeatures(
  editionFeatures: readonly ShellFeatureDeclaration[],
  dashboard: { label: string; address: string },
  /** A panel application's page, declared only while the conversation's page parameter names one. */
  panelApplication: ShellFeatureDeclaration | null = null,
): ShellFeatureDeclaration[] {
  return [
    dashboardsPageFeature(dashboard.label, dashboard.address),
    ...(panelApplication ? [panelApplication] : []),
    ...editionFeatures,
  ];
}
