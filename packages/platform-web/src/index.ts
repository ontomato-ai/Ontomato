export { default as PlatformShellLayout } from "./PlatformShellLayout.vue";
export { default as PlatformLayout } from "./PlatformLayout.vue";
export type { PlatformShownPage } from "./PlatformLayout.vue";
export { appAt, railApp, type PlatformAppDeclaration, type PlatformAppFrame } from "./apps";
export { appDeclarations, type AppPartition } from "./partition";
export { startWorkbenchWeb, type WorkbenchWebOptions } from "./start";
export { platformLayoutRoute } from "./layout-route";
export {
  discardLegacyLaunchCredential,
  installServiceMessages,
  createServiceManager,
  normalizeManagerEntry,
  reloadOnStaleBuild,
  serviceLocales,
  serviceNavigation,
  ontologyWorkspacePages,
  startPage,
  startShellPreferences,
  stopPage,
  type ManagerShellProfile,
} from "./shell";
export { readRuntimeConfig } from "./config";
export { serviceHome } from "./view";
export { legacyAdminRoutes, managerLocation, managerViewQuery } from "./admin-routes";
export { observeRoutes } from "./observe-routes";
export { dashboardPages, schedulePages, workbenchPages } from "./workbench-routes";

export type { NativeLayout } from "./native-layouts";
export { useApplicationCatalog } from "./catalog";
