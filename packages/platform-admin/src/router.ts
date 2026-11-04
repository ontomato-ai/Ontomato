import {
  createRouter,
  createWebHashHistory,
  type NavigationGuard,
  type RouteComponent,
  type RouteLocationNormalized,
  type RouteRecordRaw,
  type Router,
} from "vue-router";
import {
  availablePages,
  availableTabs,
  fallbackPage,
  type PlatformAccess,
  type PlatformNavigation,
  type PlatformPage,
} from "./navigation";

/** Route name of the root address; with no available page the layout shows "no permission" there. */
export const SERVICE_ROOT = "ServiceRoot";

/** Old root of the platform area: opens the first available platform administration page (`/admin/...`). */
const ADMIN_ROOT = "/admin";

export interface PlatformRouterOptions {
  /** Every navigation page (paths and permissions the guard checks), in display order. */
  navigation: PlatformNavigation;
  /**
   * Routes rendered inside the service layout (absolute paths). Each page route names its navigation entry in
   * `meta.page`; a route without `meta.page` (a redirect, a frame route) is not checked.
   */
  routes: readonly RouteRecordRaw[];
  /**
   * Pages rendered on their own, without the layout: the sign-in page, the SSO callback and the super admin console.
   * Their paths are never navigation entries.
   */
  standalone: readonly RouteRecordRaw[];
  access: PlatformAccess;
  /** The layout every navigation page renders inside (the sidebar). */
  layout: RouteComponent;
  /** Where the root address lands when the account may open it (the deployment's start page, e.g. `/playground`). */
  home: string;
  /** Host guard run before the permission guard (sign-in and account-kind checks of the enterprise edition). */
  guard?: NavigationGuard;
}

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

/**
 * The one router of the Ontology Service page (hash mode): the layout at `/` with the host's page routes as children,
 * plus the standalone pages. The guard and the navigation both read `availablePages`, so a deep link the account
 * cannot open lands on the first page it can open; a page's own address lands on its first tab the account may see;
 * with no page at all it lands on the root, which the layout shows as "no permission". Unknown addresses go to the root.
 */
export function createPlatformRouter(options: PlatformRouterOptions): Router {
  const { navigation, access } = options;

  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      {
        path: "/",
        component: options.layout,
        children: [
          { path: "", name: SERVICE_ROOT, component: { render: () => null } },
          { path: ADMIN_ROOT, component: { render: () => null }, meta: { adminRoot: true } },
          ...options.routes,
        ],
      },
      ...options.standalone,
      { path: "/:unknown(.*)*", redirect: "/" },
    ],
  });

  if (options.guard) router.beforeEach(options.guard);

  router.beforeEach(async (to) => {
    if (to.name === SERVICE_ROOT || to.meta.adminRoot) {
      await access.load();
      const pages = availablePages(navigation, access);
      if (to.name === SERVICE_ROOT) {
        const home = pageOf(navigation, router.resolve(options.home));
        if (home && pages.includes(home)) return options.home;
        return pages[0]?.path ?? true;
      }
      return pages.find((page) => page.path.startsWith(`${ADMIN_ROOT}/`))?.path ?? pages[0]?.path ?? { name: SERVICE_ROOT };
    }
    const page = pageOf(navigation, to);
    if (!page) return true;
    await access.load();
    // A page that may be entered without its permissions (the license landing) skips the code check only: its address
    // still resolves to the tab the account may see.
    if (!page.enterableWithoutPermission && !availablePages(navigation, access).includes(page)) {
      const fallback = fallbackPage(navigation, access, page.group);
      return fallback ? fallback.path : { name: SERVICE_ROOT };
    }
    return firstTabOf(page, access, to) ?? true;
  });

  return router;
}
