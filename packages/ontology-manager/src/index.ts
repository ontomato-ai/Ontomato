export type { ManagerAuthFailureStatus, ManagerCredential, ManagerDataFallbacks } from "./api";
export {
  createManager,
  provideManager,
  type Manager,
  type ManagerContext,
  type ManagerCounts,
  type ManagerKnowledgeTagValues,
  type ManagerOptions,
  type ManagerPresentation,
  type ManagerTheme,
} from "./context";
export { managerRoutes, managerStandaloneRoutes, registerGovernanceScreen } from "./routes";
export {
  managerGroups,
  managerNavigation,
  managerPaths,
  type ManagerNavigationGroup,
  type ManagerNavigationPage,
} from "./navigation";
export { default as ObjectViewRuntime } from "./object-views/ObjectViewRuntime.vue";
export { default as ObjectViewPage } from "./object-views/ObjectViewPage.vue";
export { default as ManagerFrame } from "./ManagerFrame.vue";
export {dropdownBoundaryOptions} from '@ontomato/foundation-ui/overlay';
export { default as ProductAssetRuntime } from "./products/ProductAssetRuntime.vue";
