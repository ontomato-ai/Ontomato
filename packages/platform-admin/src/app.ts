import { watchEffect, type App } from "vue";
import type { Router, RouteRecordRaw } from "vue-router";
import { installPageGuard } from "./router";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { platformHostKey, type PlatformPageHost, type PlatformTheme } from "./context";
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

/**
 * The platform's pages as routes, under the layout the caller mounts them in.
 *
 * This keeps the three things a page area needs and nothing about its frame: the host the pages read is provided on the
 * app, the page guard is installed on the router, and the routes come back for the caller's layout to hold. The caller
 * owns the frame, so the platform's shell is the only one and this package depends on no presentation package.
 */
export function installPlatformPages(app: App, router: Router, options: PlatformAdminOptions): RouteRecordRaw[] {
  const { host } = options;
  app.provide(platformHostKey, host);
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
  // Every page of this area is marked as a platform page (`meta.service`): the edition's router guard reads the mark to
  // decide what needs a signed-in account, and the document tokens above apply while one is shown. The mark used to sit
  // on the layout route; it belongs to the pages, since the layout is the caller's now.
  return [{ ...platformRoutes.ontology, component: { render: () => null }, meta: { service: true } },
    ...options.routes.map((route) => ({ ...route, meta: { ...route.meta, service: true } }))];
}
