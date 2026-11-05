import { watchEffect, type App } from "vue";
import type { Router, RouteRecordRaw } from "vue-router";
import { installPageGuard } from "./router";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import ServiceLayout from "./layout/ServiceLayout.vue";
import { platformHostKey, providePageActions, type PlatformPageHost, type PlatformTheme } from "./context";
import type { PlatformNavigation } from "./navigation";
import "./styles/platform.css";
import "./styles/admin-common.css";

export interface PlatformAdminOptions {
  navigation: PlatformNavigation;
  routes: RouteRecordRaw[];
  home: string;
  host: PlatformPageHost;
  themeProperties: Readonly<Record<PlatformTheme, Readonly<Record<string, string>>>>;
}

export function installPlatformPages(app: App, router: Router, options: PlatformAdminOptions): RouteRecordRaw {
  const { host } = options;
  app.provide(platformHostKey, host);
  providePageActions(app);
  installPageGuard(router, options.navigation, host.access, options.home);
  // Apply the service's document tokens only while displaying its pages, including teleported dialogs.
  watchEffect((cleanup) => {
    if (!router.currentRoute.value.meta.service) return;
    const root = document.documentElement;
    root.classList.add("platform-document");
    const properties = options.themeProperties[host.preferences.theme.value];
    const previous = Object.entries(properties).map(([key, value]) => {
      const saved = root.style.getPropertyValue(key);
      root.style.setProperty(key, value);
      return [key, saved] as const;
    });
    cleanup(() => {
      root.classList.remove("platform-document");
      for (const [key, value] of previous) root.style.setProperty(key, value);
    });
  });
  return {
    path: "/_service",
    component: ServiceLayout,
    meta: { service: true },
    children: [
      { ...platformRoutes.ontology, component: { render: () => null } },
      ...options.routes,
    ],
  };
}
