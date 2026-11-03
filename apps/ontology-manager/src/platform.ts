import { computed, defineComponent, h } from "vue";
import en from "element-plus/es/locale/lang/en";
import {
  createPlatformClient,
  createPlatformI18n,
  isPlatformHash,
  openAccess,
  ossNavigation,
  platformApi,
  platformPageComponents,
  startPlatformAdmin,
  type PlatformLocale,
} from "@ontomato/platform-admin";
import platformEn from "@ontomato/platform-admin/locales/en";
import { readRuntimeConfig } from "./config";
import { ossSystemConfig } from "./system-config";
import { openWorkspace, PlatformEntryLink, reloadOnAreaChange } from "./area";
import { startManagerShell, startShellPreferences, type ManagerShellProfile } from "./shell";

const ossLocales: Record<string, PlatformLocale> = { en: { messages: platformEn, element: en } };

/**
 * The open-source Ontology Manager page: anonymous, no sign-in and no permission logic. The hash picks the platform area
 * (audit logs, system monitoring, system configuration) or the Manager workspace; the workspace header links to the
 * platform area.
 */
export function startOssManager(profile: ManagerShellProfile) {
  const preferences = startShellPreferences(profile);
  const i18n = createPlatformI18n(ossLocales, "en");
  reloadOnAreaChange((hash) => (isPlatformHash(hash) ? "platform" : "workspace"));

  if (!isPlatformHash(window.location.hash)) {
    const EntryLink = defineComponent({
      setup: () => () => h(PlatformEntryLink, { label: () => i18n.global.t("platform.title") }),
    });
    startManagerShell(profile, { credential: { type: "anonymous" }, headerActions: EntryLink }, preferences);
    return;
  }

  const client = createPlatformClient({
    apiBase: readRuntimeConfig().apiBase,
    credential: { type: "anonymous" },
    locale: () => preferences.locale.value,
  });
  startPlatformAdmin({
    navigation: ossNavigation,
    components: platformPageComponents,
    i18n,
    locales: ossLocales,
    themeProperties: profile.presentation.themeProperties,
    host: {
      access: openAccess,
      api: platformApi(client),
      preferences,
      navigation: computed(() => ossNavigation),
      account: null,
      actions: [],
      navigationHidden: computed(() => false),
      openWorkspace,
      systemConfig: ossSystemConfig,
      separators: { detail: ": " },
    },
  });
}
