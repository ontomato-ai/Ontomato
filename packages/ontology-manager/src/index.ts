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
