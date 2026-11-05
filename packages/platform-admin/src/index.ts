export { installPlatformPages, type PlatformAdminOptions } from "./app";
export {
  availableGroups,
  availablePages,
  availableTabs,
  fallbackPage,
  openAccess,
  shownTab,
  type PlatformAccess,
  type PlatformGroup,
  type PlatformLink,
  type PlatformNavigation,
  type PlatformPage,
  type PlatformPageTab,
} from "./navigation";
export { installPageGuard } from "./router";
export {
  PlatformBusinessError,
  createPlatformClient,
  platformApi,
  type PlatformApi,
  type PlatformClient,
  type PlatformCredential,
  type PlatformRequestContext,
  type PlatformScope,
} from "./api";
export { createPlatformI18n, mergeMessages, type PlatformI18n, type PlatformLocale, type PlatformMessages } from "./i18n";
export {
  platformHostKey,
  providePlatformHost,
  usePageActions,
  usePageActionsOf,
  usePlatformHost,
  type PlatformPageActions,
  type PlatformPageHost,
  type PlatformPreferences,
  type PlatformTheme,
} from "./context";
export {
  modelConfigTabs,
  ossPlatformPages,
  ossSystemSettingsPage,
  pageRoutes,
  platformGroups,
  platformPageComponents,
  platformKnowledgePages,
  platformPages,
  runRecordsTabs,
  sharedPageRoutes,
  systemMonitorPanel,
  systemSettingsTabs,
} from "./pages";
export { feedbackPageSchema, type FeedbackPageData, type FeedbackQuery } from "./feedback";
export type {
  BusinessConfigAdapterDisplay,
  BusinessConfigLanguageOption,
  BusinessConfigProps,
} from "./config/business-config";
