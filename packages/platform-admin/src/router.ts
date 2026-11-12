import { platformRoutes } from "@ontomato/platform-shell/routes";
import {
  type RouteLocationNormalized,
  type Router,
} from "vue-router";
import { availablePages, fallbackPage, type PlatformAccess, type PlatformNavigation, type PlatformPage } from "./navigation";

function pageOf(navigation: PlatformNavigation, route: Pick<RouteLocationNormalized, "meta">): PlatformPage | undefined {
  return navigation.pages.find((page) => page.path === route.meta.page);
}

export function installPageGuard(router: Router, navigation: PlatformNavigation, access: PlatformAccess, home: string) {
  router.beforeEach(async (to) => {
    if (to.name === platformRoutes.ontology.name) {
      await access.load();
      const pages = availablePages(navigation, access);
      if (to.query.section !== "admin") {
        const homePage = pageOf(navigation, router.resolve(home));
        // The platform's home and the conversation are no navigation pages; their own routes decide who enters.
        if (home === platformRoutes.home.path || home === platformRoutes.chat.path) return home;
        if (homePage && pages.includes(homePage)) return home;
        return pages[0]?.path ?? true;
      }
      return pages.find((page) => page.group === "platform")?.path ?? pages[0]?.path ?? { name: platformRoutes.ontology.name };
    }
    const page = pageOf(navigation, to);
    if (!page) return true;
    await access.load();
    // A page that may be entered without its permissions (the license landing) skips the code check.
    if (!page.enterableWithoutPermission && !availablePages(navigation, access).includes(page)) {
      const fallback = fallbackPage(navigation, access, page.group);
      return fallback ? fallback.path : { name: platformRoutes.ontology.name };
    }
    return true;
  });
}
