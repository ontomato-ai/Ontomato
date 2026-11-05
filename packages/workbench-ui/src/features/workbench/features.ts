import type { ShellFeatureDeclaration } from "@ontomato/agent-shell-ui";
import { AGENT_PAGE_PERMISSIONS, OPS_DIAGNOSIS_PERMISSION, anyPermission } from "../agents/permissions";

/** The edition's workbench entries, filtered using the existing capability codes. */
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
            availability: "action" as const,
          },
        ]
      : []),
  ];
}
