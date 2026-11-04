export { startPlatformAdmin, type PlatformAdminOptions } from "./app";
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
export { SERVICE_ROOT, createPlatformRouter, type PlatformRouterOptions } from "./router";
export {
  PlatformBusinessError,
  createPlatformClient,
  platformApi,
  type PlatformApi,
  type PlatformClient,
  type PlatformCredential,
  type PlatformRequestContext,
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
export { ossPlatformPages, pageRoutes, platformGroups, platformPageComponents, platformPages } from "./pages";
export type {
  BusinessConfigAdapterDisplay,
  BusinessConfigLanguageOption,
  BusinessConfigProps,
} from "./config/business-config";
