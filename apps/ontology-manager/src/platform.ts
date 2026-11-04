import en from "element-plus/es/locale/lang/en";
import { computed } from "vue";
import { managerRoutes, managerStandaloneRoutes } from "@ontomato/ontology-manager";
import {
  createPlatformClient,
  legacyPageRedirects,
  openAccess,
  ossPlatformPages,
  platformApi,
  platformGroups,
  platformKnowledgePages,
  sharedPageRoutes,
  startPlatformAdmin,
  type PlatformLocale,
} from "@ontomato/platform-admin";
import platformEn from "@ontomato/platform-admin/locales/en";
import { readRuntimeConfig } from "./config";
import { ossSystemConfig } from "./system-config";
import {
  agentPlatformLink,
  createServiceI18n,
  createServiceManager,
  deploymentRoot,
  discardLegacyLaunchCredential,
  reloadOnStaleBuild,
  serviceNavigation,
  startPage,
  startShellPreferences,
  stopPage,
  type ManagerShellProfile,
} from "./shell";

const ossPlatformLocales: Record<string, PlatformLocale> = { en: { messages: platformEn, element: en } };

/**
 * The open-source Ontology Service page: anonymous, no sign-in and no permission logic. One router and one vue-i18n
 * serve the Manager pages and the platform administration pages inside one sidebar layout.
 */
export function startOssManager(profile: ManagerShellProfile) {
  reloadOnStaleBuild();
  discardLegacyLaunchCredential();
  const { apiBase } = readRuntimeConfig();
  const preferences = startShellPreferences(profile);
  const { locales, i18n } = createServiceI18n(profile, ossPlatformLocales, preferences);
  let stop: (status: number) => void = () => {};
  const manager = createServiceManager({
    profile,
    preferences,
    i18n,
    credential: { type: "anonymous" },
    // 402 (license failure) keeps the page; the page shows the error.
    onAuthFailure: (status) => {
      if (status === 401) stop(status);
    },
  });
  const client = createPlatformClient({ apiBase, credential: { type: "anonymous" }, locale: () => preferences.locale.value });
  const navigation = serviceNavigation(manager, platformGroups.platform, [...ossPlatformPages, ...platformKnowledgePages]);
  const { app } = startPlatformAdmin({
    navigation,
    routes: [...managerRoutes(), ...sharedPageRoutes(), ...legacyPageRedirects()],
    standalone: managerStandaloneRoutes(),
    home: startPage(),
    i18n,
    locales,
    themeProperties: profile.presentation.themeProperties,
    host: {
      access: openAccess,
      api: platformApi(client),
      preferences,
      navigation: computed(() => navigation),
      account: null,
      links: [agentPlatformLink(deploymentRoot(apiBase))],
      navigationHidden: computed(() => false),
      systemConfig: ossSystemConfig,
      separators: { detail: ": " },
    },
    configure: (app) => manager.install(app),
  });
  stop = (status) => stopPage(app, i18n.global.t("ontology.requestFailedStatus", { status }));
}
