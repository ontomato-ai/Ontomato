// The page gutter every frame and page references (DESIGN.md "Page applications"): loaded with the shell, so the
// class is there wherever a page shows.
import "./page.css";

export { default as PlatformShell } from "./PlatformShell.vue";
export { default as PlatformRail } from "./PlatformRail.vue";
export { default as PlatformAccountMenu } from "./PlatformAccountMenu.vue";
export { default as AppPanelPages } from "./AppPanelPages.vue";
export { default as PlatformPageHeader } from "./PlatformPageHeader.vue";
export { default as PlatformTabs } from "./PlatformTabs.vue";
export { default as PlatformBrandMark } from "./PlatformBrandMark.vue";
export { default as AgentModelsPage } from "./AgentModelsPage.vue";
export { appIcon, resolveIcon } from "./icons";
export { platformPath, platformRoutes } from "./routes";
export {
  providePageActions,
  usePageActions,
  type PlatformPageAction,
  type PlatformPageActions,
  type PlatformPageDraft,
} from "./page-actions";
export {
  agentModelLabelsKey,
  useAgentModelLabels,
  agentModelPage,
  ontologyAgentModelPages,
  ontologyAgentModelSource,
  type AgentModelEntry,
  type AgentModelLabels,
  type AgentModelPage,
  type AgentModelSource,
  type DataEngineTransport,
} from "./agent-models";
export { platformApplicationNameKey, platformPageAccessKey, useApplicationName, usePageAccess } from "./page-access";
export {
  provideUnsavedChanges,
  useLeaveConfirmation,
  useUnsavedChanges,
  type LeaveConfirmation,
  type UnsavedChanges,
  type UnsavedChangesCheck,
} from "./unsaved-changes";
export type {
  PlatformAccount,
  PlatformApp,
  PlatformBrand,
  PlatformIcon,
  PlatformPanelGroup,
  PlatformPanelPage,
  PlatformPreferences,
  PlatformRailSection,
  PlatformShellLabels,
} from "./types";
