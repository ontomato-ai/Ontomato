// The page gutter every frame and page references (DESIGN.md "Page applications"): loaded with the shell, so the
// class is there wherever a page shows.
import "./page.css";

export { default as PlatformShell } from "./PlatformShell.vue";
export { default as PlatformRail } from "./PlatformRail.vue";
export { default as PlatformAccountMenu } from "./PlatformAccountMenu.vue";
export { default as AppPanelPages } from "./AppPanelPages.vue";
export { default as PlatformPageHeader } from "./PlatformPageHeader.vue";
export { default as PlatformTabs } from "./PlatformTabs.vue";
export { appIcon, resolveIcon } from "./icons";
export { platformPath, platformRoutes } from "./routes";
export type {
  PlatformAccount,
  PlatformApp,
  PlatformIcon,
  PlatformPageActions,
  PlatformPanelGroup,
  PlatformPanelPage,
  PlatformPreferences,
  PlatformRailSection,
  PlatformShellLabels,
} from "./types";
