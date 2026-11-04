import type { ShellFeatureDeclaration } from "@ontomato/agent-shell-ui";
import { ONTOLOGY_MANAGER_PATH } from "../../config/app";

/**
 * The function area of the business workbench, in order: dashboards, the edition's own entries, agent settings (with
 * the edition's permission), scheduled tasks, and the Ontology Service. The Ontology Service is the other application
 * (DESIGN.md "Applications and shells"): a link that opens its page in a new tab.
 */
export function workbenchFeatures(
  t: (key: string) => string,
  editionFeatures: readonly ShellFeatureDeclaration[],
  canManageAgents: boolean,
): ShellFeatureDeclaration[] {
  return [
    { id: "dashboards", label: t("assistant.featureDashboards"), icon: "dashboard", availability: "page" },
    ...editionFeatures,
    ...(canManageAgents
      ? [{ id: "agent-config", label: t("assistant.featureAgentConfig"), icon: "agents", availability: "page" as const }]
      : []),
    { id: "schedule", label: t("assistant.featureSchedule"), icon: "schedule", availability: "page" },
    {
      id: "ontology-service",
      label: t("assistant.featureOntologyService"),
      icon: "ontology",
      availability: "link",
      href: ONTOLOGY_MANAGER_PATH,
    },
  ];
}
