// The page gutter every frame and page references (DESIGN.md "Page applications"): loaded with the shell, so the
// class is there wherever a page shows.
import "./page.css";

export { default as PlatformShell } from "./PlatformShell.vue";
export { default as PlatformRail } from "./PlatformRail.vue";
export { default as PlatformAccountMenu } from "./PlatformAccountMenu.vue";
export { default as AppPanelPages } from "./AppPanelPages.vue";
export { default as PanelHost } from "./PanelHost.vue";
export { default as PlatformPageHeader } from "./PlatformPageHeader.vue";
export { default as PlatformTabs } from "./PlatformTabs.vue";
export { default as PlatformBrandMark } from "./PlatformBrandMark.vue";
export { default as AgentModelsPage } from "./AgentModelsPage.vue";
export { appIcon, resolveIcon } from "./icons";
export {default as ApplicationIconPicker} from './ApplicationIconPicker.vue';
export { platformPath, platformRoutes } from "./routes";
export { openApplicationKey } from './application-opening';
export {
  hasPageActions,
  providePageActions,
  usePageActions,
  type PlatformPageAction,
  type PlatformPageActions,
  type PlatformPageDraft,
} from "./page-actions";
export { providePageHeading, usePageHeading, type PlatformPageHeading } from "./page-heading";
export { provideApplicationFrame, useApplicationFrame } from "./app-frame";
export {
  applyTheme, composeThemes, provideApplicationTheme, themeProperties, useApplicationTheme, useAppTheme, type ThemeMode,
} from "./app-theme";
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
export { pilotPageKey, usePilotPage, type PilotPage, type PilotPageResolver } from "./pilot-pages";
export {
  codedPanelTarget,
  newPanelInstanceName,
  panelHostKey,
  panelFrameDocument,
  panelUnavailable,
  usePanelHostPort,
  usePanelInstance,
  type DefinitionChanged,
  type CodedPanelTarget,
  type DirectPanelMount,
  type DirectPanelRun,
  type HostedPanelSource,
  type PanelDetailHeader,
  type PanelDetailHeaderAction,
  type PanelHostState,
  type PanelSdkRelease,
  type PanelHostLabels,
  type PanelFrameRegistration,
  type PanelHostPort,
  type PanelInstanceOptions,
  type PanelInstanceView,
} from "./panel-host";
export { adoptPanelStyle, scopedPanelStyle } from "./panel-content";
export { confirmDanger } from "./confirm-danger";
export {
  createPanelBackController,
  hasOpenOverlay,
  installPanelBackPopStateListener,
  type PanelBackController,
  type PanelBackControllerOptions,
  type PanelBackHandlerRegistration,
} from "./panel-back";
export {
  provideUnsavedChanges,
  useLeaveConfirmation,
  useOptionalLeaveConfirmation,
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
