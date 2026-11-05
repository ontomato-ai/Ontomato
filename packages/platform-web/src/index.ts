export { default as PlatformShellLayout } from "./PlatformShellLayout.vue";
export { default as PlatformLayout } from "./PlatformLayout.vue";
export type { PlatformShownPage } from "./PlatformLayout.vue";
export {
  appAt,
  columnGroups,
  panelOf,
  railApp,
  type AppGroupEntry,
  type AppPageEntry,
  type PlatformAppDeclaration,
  type PlatformAppPanelKind,
} from "./apps";
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
  startPage,
  startShellPreferences,
  stopPage,
  type ManagerShellProfile,
} from "./shell";
export { readRuntimeConfig } from "./config";
export { serviceHome } from "./view";
export { legacyAdminRoutes, managerLocation, managerViewQuery } from "./admin-routes";
export { observeRoutes } from "./observe-routes";
export { schedulePages, workbenchPages } from "./workbench-routes";
export { schedulesHost } from "./schedules";
