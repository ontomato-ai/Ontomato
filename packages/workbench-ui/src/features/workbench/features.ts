import type { ShellFeatureDeclaration } from "@ontomato/agent-shell-ui";
import { ONTOLOGY_MANAGER_PATH } from "../../config/app";
import { AGENT_PAGE_PERMISSIONS, OPS_DIAGNOSIS_PERMISSION, anyPermission } from "../agents/permissions";

/**
 * The function area of the business workbench, in order: new chat (the shell's own first row), dashboards, the
 * edition's own entries (the enterprise graph), agents, operations diagnosis, scheduled tasks and the Ontology Service
 * (when the app's OntologyServiceAccess shows it).
 *
 * Entries of this application appear by their capability codes: "agents" with any one of the permissions of its two
 * tabs (the tabs are filtered inside the page), "ops-diagnosis" with the observer code. Agents is a page of the
 * workbench; operations diagnosis is its own conversation shell page, so the workbench opens it in a new tab (the same
 * as the entry the old admin header had). The Ontology Service is the other application (DESIGN.md "Applications and
 * shells"): a link that opens its page in a new tab.
 */
export function workbenchFeatures(
  t: (key: string) => string,
  editionFeatures: readonly ShellFeatureDeclaration[],
  can: (permission: string) => boolean,
  showOntologyService: boolean,
): ShellFeatureDeclaration[] {
  return [
    { id: "dashboards", label: t("assistant.featureDashboards"), icon: "dashboard", availability: "page" },
    ...editionFeatures,
    ...(anyPermission(can, AGENT_PAGE_PERMISSIONS)
      ? [{ id: "agents", label: t("assistant.featureAgents"), icon: "agents", availability: "page" as const }]
      : []),
    ...(can(OPS_DIAGNOSIS_PERMISSION)
      ? [
          {
            id: "ops-diagnosis",
            label: t("assistant.featureOpsDiagnosis"),
            icon: "diagnosis",
            availability: "action" as const,
          },
        ]
      : []),
    { id: "schedule", label: t("assistant.featureSchedule"), icon: "schedule", availability: "page" },
    ...(showOntologyService
      ? [
          {
            id: "ontology-service",
            label: t("assistant.featureOntologyService"),
            icon: "ontology",
            availability: "link" as const,
            href: ONTOLOGY_MANAGER_PATH,
          },
        ]
      : []),
  ];
}
