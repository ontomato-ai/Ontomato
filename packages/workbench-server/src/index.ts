export {
  installWorkbenchIdentity,
  workbenchIdentity,
  requirePermission,
  guardMcpServiceManagement,
} from "./identity/installed";
export { installWorkbenchProduct, workbenchProduct } from "./product/installed";
export { installContentLayout, type ContentLayout, type ResourceCopy } from "./content/layout";
export {
  installRuntimeDefaults,
  type RuntimeDefaults,
} from "./runtime/defaults";
export {
  configureI18n,
  getDefaultLocale,
  resolveLocale,
  type Locale,
  type LocalePack,
} from "./i18n/index";
export {
  registerDslResultSectionProvider,
  type DslResultSectionContext,
  type DslResultSectionProvider,
} from "./services/ops-diagnosis/dsl-result-sections";
