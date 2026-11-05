import type { App } from "vue";
import { computed } from "vue";
import type { Router } from "vue-router";
import en from "element-plus/es/locale/lang/en";
import { managerRoutes, managerStandaloneRoutes } from "@ontomato/ontology-manager";
import {
  createPlatformClient, installPlatformPages, openAccess, ossPlatformPages, platformApi,
  platformGroups, platformKnowledgePages, sharedPageRoutes,
} from "@ontomato/platform-admin";
import platformEn from "@ontomato/platform-admin/locales/en";
import {
  createServiceManager, installServiceMessages, readRuntimeConfig, serviceNavigation,
  startPage, startShellPreferences, stopPage,
} from "@ontomato/platform-web";
import { ossProfile as profile } from "./profile";
import { ossSystemConfig } from "./system-config";

export function ossServicePages(app: App, router: Router) {
  const preferences = startShellPreferences(profile);
  const i18n = installServiceMessages(profile, { en: { messages: platformEn, element: en } });
  const credential = { type: "anonymous" } as const;
  const manager = createServiceManager({ profile, preferences, i18n, credential,
    onAuthFailure: (status) => { if (status === 401) stopPage(app, i18n.global.t("ontology.requestFailedStatus", { status })); },
  });
  manager.install(app);
  const client = createPlatformClient({ ...readRuntimeConfig(), credential, locale: () => preferences.locale.value });
  const navigation = serviceNavigation(manager, platformGroups.platform, [...ossPlatformPages, ...platformKnowledgePages]);
  const area = installPlatformPages(app, router, {
    navigation, routes: [...managerRoutes(), ...sharedPageRoutes()], home: startPage(),
    themeProperties: profile.presentation.themeProperties,
    host: { access: openAccess, api: platformApi(client), preferences, navigation: computed(() => navigation),
      account: null, links: [], navigationHidden: computed(() => false), systemConfig: ossSystemConfig, separators: { detail: ": " } },
  });
  return [area, ...managerStandaloneRoutes()];
}
