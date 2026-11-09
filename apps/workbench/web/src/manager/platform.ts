import type { App } from "vue";
import { computed, defineAsyncComponent } from "vue";
import type { Router } from "vue-router";
import en from "element-plus/es/locale/lang/en";
import { managerRoutes, managerStandaloneRoutes, registerGovernanceScreen } from "@ontomato/ontology-manager";
import {
  createPlatformClient, installPlatformPages, openAccess, ossPlatformPages, platformApi,
  platformGroups, platformKnowledgePages, platformPageScreen, sharedPageRoutes,
} from "@ontomato/platform-admin";
import platformEn from "@ontomato/platform-admin/locales/en";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import {
  createServiceManager, installAppHost, installServiceMessages, readRuntimeConfig, serviceNavigation,
  startPage, startShellPreferences, stopPage,
} from "@ontomato/platform-web";
import { ossProfile as profile } from "./profile";
import { ossSystemConfig } from "./system-config";

export function ossServicePages(app: App, router: Router) {
  const preferences = startShellPreferences(profile);
  const i18n = installServiceMessages(profile, { en: { messages: platformEn, element: en } });
  const credential = { type: "anonymous" } as const;
  const onAuthFailure = (status: 401 | 402) => {
    if (status === 401) stopPage(app, i18n.global.t("ontology.requestFailedStatus", { status }));
  };
  const manager = createServiceManager({ profile, preferences, i18n, credential, onAuthFailure });
  manager.install(app);
  installAppHost({ credential, preferences, router, onAuthFailure });
  const client = createPlatformClient({ ...readRuntimeConfig(), credential, locale: () => preferences.locale.value });
  const navigation = serviceNavigation(manager, platformGroups.platform, [...ossPlatformPages, ...platformKnowledgePages]);
  const area = installPlatformPages(app, router, {
    navigation, routes: [...managerRoutes(), ...sharedPageRoutes()], home: startPage(),
    themeProperties: profile.presentation.themeProperties,
    host: { access: openAccess, api: platformApi(client), preferences, navigation: computed(() => navigation),
      account: null, links: [], navigationHidden: computed(() => false), systemConfig: ossSystemConfig, separators: { detail: ": " } },
  });
  // The feedback records are a page of the knowledge governance application (its column surrounds them): its screen is
  // this package's, so the assembly that holds both hands it over instead of either application importing the other.
  const screens = platformPageScreen(platformRoutes.feedback.path);
  if (screens) registerGovernanceScreen("feedback", defineAsyncComponent(screens as () => Promise<never>));
  // `installPlatformPages` returns the pages as routes under the caller's layout; the standalone conversation pages
  // (knowledge governance) join them so one layout holds both.
  return [...area, ...managerStandaloneRoutes()];
}
