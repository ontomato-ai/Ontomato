import type { ShellFeatureDeclaration } from "@ontomato/agent-shell-ui";
import { AGENT_PAGE_PERMISSIONS, anyPermission } from "../agents/permissions";

/**
 * The agent platform's own entries in its column, after the conversation itself.
 *
 * Only this application's pages: another application is reached through the platform rail, never through an entry here,
 * and the rail opens it without leaving the page. An edition adds the entries only it has.
 */
export function workbenchFeatures(
  t: (key: string) => string,
  editionFeatures: readonly ShellFeatureDeclaration[],
  can: (permission: string) => boolean,
): ShellFeatureDeclaration[] {
  return [
    { id: "dashboards", label: t("assistant.featureDashboards"), icon: "dashboard", availability: "page" },
    ...editionFeatures,
    ...(anyPermission(can, AGENT_PAGE_PERMISSIONS)
      ? [{ id: "agents", label: t("assistant.featureAgents"), icon: "agents", availability: "page" as const }]
      : []),
    { id: "schedule", label: t("assistant.featureSchedule"), icon: "schedule", availability: "page" },
  ];
}
