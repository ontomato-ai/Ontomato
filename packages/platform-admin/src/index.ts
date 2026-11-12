export { installPlatformPages, type PlatformAdminOptions } from "./app";
export {
  availableGroups,
  availablePages,
  fallbackPage,
  openAccess,
  type PlatformAccess,
  type PlatformGroup,
  type PlatformLink,
  type PlatformNavigation,
  type PlatformPage,
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
  usePlatformHost,
  type PlatformPageHost,
  type PlatformPreferences,
  type PlatformTheme,
} from "./context";
export {
  formerParentRoutes,
  ossPlatformPages,
  pageRoutes,
  platformGroups,
  platformPageComponents,
  platformPageScreen,
  platformKnowledgePages,
  platformPages,
  sharedPageRoutes,
  systemMonitorPanel,
} from "./pages";
export { feedbackPageSchema, type FeedbackPageData, type FeedbackQuery } from "./feedback";
export type {
  BusinessConfigAdapterDisplay,
  BusinessConfigLanguageOption,
  BusinessConfigProps,
} from "./config/business-config";
