import type { ShellFeatureDeclaration } from "@ontomato/agent-shell-ui";

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
  /** A panel application's page, declared only while the conversation's page parameter names one. */
  panelApplication: ShellFeatureDeclaration | null = null,
): ShellFeatureDeclaration[] {
  return [
    ...(panelApplication ? [panelApplication] : []),
    ...editionFeatures,
  ];
}
