import {
  createRouter,
  createWebHashHistory,
  type NavigationGuard,
  type RouteComponent,
  type RouteRecordRaw,
  type Router,
} from "vue-router";
import {
  availablePages,
  fallbackPage,
  type PlatformAccess,
  type PlatformNavigation,
} from "./navigation";

/** Root of the platform navigation pages; `#/admin` opens the account's first available page. */
export const PLATFORM_ROOT = "/admin";

/** Lazily loaded page components keyed by the navigation path they serve. */
export type PlatformPageComponents = Readonly<Record<string, () => Promise<unknown>>>;

export interface PlatformRoutes {
  /** Pages shown inside the platform layout, in navigation order. */
  navigation: PlatformNavigation;
  /**
   * Pages rendered on their own, without the platform layout: the sign-in page, the SSO callback and the super admin
   * console. Their paths are never navigation entries.
   */
  standalone: readonly RouteRecordRaw[];
}

function hashPath(hash: string) {
  return hash.replace(/^#/, "").split("?")[0] || "/";
}

/** Every top-level hash path the platform area owns besides `/admin/*`; anything else belongs to the workspace. */
function standalonePaths(standalone: readonly RouteRecordRaw[]): string[] {
  return standalone.map((route) => route.path);
}

/**
 * Whether a location hash addresses the platform area; the shell uses this to pick which area to start. Only one of
 * the two areas runs on a page load, so only one router owns the hash.
 */
export function isPlatformHash(hash: string, standalone: readonly RouteRecordRaw[] = []): boolean {
  const path = hashPath(hash);
  return [PLATFORM_ROOT, ...standalonePaths(standalone)].some(
    (known) => path === known || path.startsWith(`${known}/`)
  );
}

export interface PlatformRouterOptions extends PlatformRoutes {
  access: PlatformAccess;
  components: PlatformPageComponents;
  /** The layout every navigation page renders inside. */
  layout: RouteComponent;
  /** Host guard run before the permission guard (sign-in and account-kind checks of the enterprise edition). */
  guard?: NavigationGuard;
}

/**
 * One router for the whole platform area: the layout under `/admin` with one child route per navigation page, plus the
 * standalone pages. The guard and the menu both read `availablePages`, so a deep link the account cannot open lands on
 * the first page it can open; with no page at all it lands on the root, which the layout shows as "no permission".
 */
export function createPlatformRouter(options: PlatformRouterOptions): Router {
  const { navigation, access } = options;

  const pageRoutes: RouteRecordRaw[] = navigation.pages.map((page) => {
    const component = options.components[page.path];
    if (!component) throw new Error(`No component for platform page ${page.path}`);
    return {
      path: page.path,
      name: page.path,
      component,
      meta: { platformPage: page.path },
    };
  });

  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      {
        path: PLATFORM_ROOT,
        component: options.layout,
        children: [{ path: "", name: "PlatformRoot", component: { render: () => null } }, ...pageRoutes],
      },
      ...options.standalone,
    ],
  });

  if (options.guard) router.beforeEach(options.guard);

  router.beforeEach(async (to) => {
    const isRoot = to.name === "PlatformRoot";
    const page = navigation.pages.find((candidate) => candidate.path === to.meta.platformPage);
    if (!isRoot && !page) return true;
    if (page?.enterableWithoutPermission) return true;
    await access.load();
    if (page && availablePages(navigation, access).includes(page)) return true;
    const fallback = fallbackPage(navigation, access, page?.group);
    if (fallback) return fallback.path;
    return isRoot ? true : { name: "PlatformRoot" };
  });

  return router;
}
