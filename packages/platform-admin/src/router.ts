import { platformRoutes } from "@ontomato/platform-shell/routes";
import {
  type RouteLocationNormalized,
  type Router,
} from "vue-router";
import {
  availablePages,
  availableTabs,
  fallbackPage,
  landingPages,
  type PlatformAccess,
  type PlatformNavigation,
  type PlatformPage,
} from "./navigation";

function pageOf(navigation: PlatformNavigation, route: Pick<RouteLocationNormalized, "meta">): PlatformPage | undefined {
  return navigation.pages.find((page) => page.path === route.meta.page);
}

/**
 * Where a page's own address goes when it holds tabs: the account lands on the first tab it may see (a tab's address is
 * a route, so the page's own address is only an entry). A page that may be entered without its permissions — the licence
 * landing, whose tab is opened while no code can be read — keeps the tab the address names.
 */
function firstTabOf(page: PlatformPage, access: PlatformAccess, to: RouteLocationNormalized) {
  const tabs = page.tabs ?? [];
  if (tabs.length === 0 || tabs.some((tab) => tab.path === to.path)) return null;
  const visible = availableTabs(page, access);
  return (visible[0] ?? tabs[0])!.path;
}

export function installPageGuard(router: Router, navigation: PlatformNavigation, access: PlatformAccess, home: string) {
  router.beforeEach(async (to) => {
    if (to.name === platformRoutes.ontology.name) {
      await access.load();
      const pages = availablePages(navigation, access);
      if (to.query.section !== "admin") {
        const homePage = pageOf(navigation, router.resolve(home));
        if (homePage && pages.includes(homePage)) return home;
        return landingPages(navigation, access)[0]?.path ?? true;
      }
      return pages.find((page) => page.group === "platform")?.path ?? landingPages(navigation, access)[0]?.path ??
        { name: platformRoutes.ontology.name };
    }
    const page = pageOf(navigation, to);
    if (!page) return true;
    await access.load();
    // A page that may be entered without its permissions (the license landing) skips the code check only: its address
    // still resolves to the tab the account may see.
    if (!page.enterableWithoutPermission && !availablePages(navigation, access).includes(page)) {
      const fallback = fallbackPage(navigation, access, page.group);
      return fallback ? fallback.path : { name: platformRoutes.ontology.name };
    }
    return firstTabOf(page, access, to) ?? true;
  });
}
