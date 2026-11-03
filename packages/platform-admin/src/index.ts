export { startPlatformAdmin, type PlatformAdminOptions } from "./app";
export {
  availableGroups,
  availablePages,
  fallbackPage,
  openAccess,
  type PlatformAccess,
  type PlatformGroup,
  type PlatformNavigation,
  type PlatformPage,
} from "./navigation";
export {
  PLATFORM_ROOT,
  createPlatformRouter,
  isPlatformHash,
  type PlatformPageComponents,
  type PlatformRoutes,
} from "./router";
export {
  PlatformBusinessError,
  createPlatformClient,
  platformApi,
  type PlatformApi,
  type PlatformClient,
  type PlatformCredential,
  type PlatformRequestContext,
} from "./api";
export { createPlatformI18n, type PlatformI18n, type PlatformLocale, type PlatformMessages } from "./i18n";
export {
  platformHostKey,
  providePlatformHost,
  usePlatformHost,
  type PlatformAction,
  type PlatformPageHost,
  type PlatformPreferences,
  type PlatformTheme,
} from "./context";
export { ossNavigation, platformGroups, platformPageComponents, platformPages } from "./pages";
export type {
  BusinessConfigAdapterDisplay,
  BusinessConfigLanguageOption,
  BusinessConfigProps,
} from "./config/business-config";
