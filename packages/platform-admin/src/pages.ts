import { platformRoutes } from "@ontomato/platform-shell/routes";
import { Activity } from "lucide-vue-next";
import type { RouteRecordRaw } from "vue-router";
import type { PlatformGroup, PlatformPage } from "./navigation";

/**
 * Platform administration pages this package ships: the system settings' pages beside the permissions. Each page is one
 * leaf of its application's column: its address, its title and description, and the permission code that opens it are
 * declared here once, and the column, the page header, the current row and the router guard all read them. Each edition
 * composes the whole navigation from these, the Manager's pages and its own pages.
 */
export const platformGroups = {
  platform: { key: "platform", titleKey: "platform.title" },
} satisfies Record<string, PlatformGroup>;

export const platformPages = {
  systemMonitor: {
    path: platformRoutes.monitor.path,
    titleKey: "nav.systemMonitor",
    descriptionKey: "platform.descriptions.systemMonitor",
    icon: Activity,
    permissions: ["system-monitoring"],
    group: "platform",
  },
} satisfies Record<string, PlatformPage>;

/** Lazily loaded components of the shared native pages, keyed by path. */
export const platformPageComponents: Readonly<Record<string, () => Promise<unknown>>> = {
  [platformPages.systemMonitor.path]: () => import("./pages/SystemMonitorPage.vue"),
};

/** One route per page: the page renders at its own address and names itself in `meta.page`, which the guard reads. */
function routeName(path: string) {
  return Object.values(platformRoutes).find((route) => route.path === path)!.name;
}

export function pageRoutes(
  pages: readonly PlatformPage[],
  components: Readonly<Record<string, () => Promise<unknown>>>
): RouteRecordRaw[] {
  return pages.map((page) => {
    const component = components[page.path];
    if (!component) throw new Error(`No component for platform page ${page.path}`);
    return { path: page.path, name: routeName(page.path), component, meta: { page: page.path } } as RouteRecordRaw;
  });
}

/**
 * The addresses of the pages that used to hold these as tabs: each forwards to its first page, and the guard sends an
 * account that may not open that one to a page it may.
 */
export const formerParentRoutes: RouteRecordRaw[] = [
  { ...platformRoutes.models, redirect: platformRoutes.usage.path },
  { ...platformRoutes.settings, redirect: platformRoutes.general.path },
  { ...platformRoutes.records, redirect: platformRoutes.audit.path },
];

/** Screens other editions show on their own: the service status is the super admin console's services section too. */
export const systemMonitorPanel = () => import("./pages/SystemMonitorPage.vue");

/** The shared native settings pages, in the order of the system settings' column. */
export const ossPlatformPages: readonly PlatformPage[] = [
  platformPages.systemMonitor,
];

/**
 * Every route the shared pages need: the edition's settings pages and the former parents' addresses. Pages this package
 * does not ship, such as an edition's own permissions and licence, are routed by the edition.
 */
export function sharedPageRoutes(pages: readonly PlatformPage[] = ossPlatformPages): RouteRecordRaw[] {
  const shared = pages.filter((page) => page.path in platformPageComponents);
  return [...pageRoutes(shared, platformPageComponents), ...formerParentRoutes];
}
