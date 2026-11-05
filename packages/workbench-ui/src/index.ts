export { workbenchI18n, type SupportedLocale, type WorkbenchLanguage } from "./i18n";
export type { WorkbenchAuthHost } from "./utils/auth";
export { turnDiagnosisAccessKey, type TurnDiagnosisAccess } from "./features/diagnosis/access";
export { installWorkbenchContent, type WorkbenchContent } from "./content";
export {
  apiGet,
  apiPost,
  nodeApiDelete,
  nodeApiGet,
  nodeApiPatch,
  nodeApiPost,
} from "./utils/api";
export { apiUrl } from "./utils/api-base";
export { installErrorPunctuation, type ErrorPunctuation } from "./utils/error-punctuation";
export { useLocale } from "./composables/useLocale";
export {
  AGENT_PAGE_PERMISSIONS,
  AGENT_TAB_PERMISSIONS,
  OPS_DIAGNOSIS_PERMISSION,
  anyPermission,
  showsAgentTab,
  workbenchPermissionGroups,
  workbenchPermissions,
} from "./features/agents";
export type { WorkbenchPermissionData, WorkbenchPermissionGroupData } from "./features/agents";
export { workbenchFeatures } from "./features/workbench";
export { ObserveLayout } from "./features/diagnosis";
export type { ObserveAccount } from "./features/diagnosis/components/layout/types";
export {
  ontologyServiceAccessKey,
  openOntologyServiceAccess,
  useOntologyServiceAccess,
  type OntologyServiceAccess,
} from "./app/ontology-service";
