import { platformRoutes } from "@ontomato/platform-shell/routes";
import { Activity, Cpu, Database, ScrollText, Server, SlidersHorizontal } from "lucide-vue-next";
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
  /**
   * How the domain's models are used and where they come from: two pages of one model library, edited as one draft and
   * saved together from either.
   */
  modelUsage: {
    path: platformRoutes.usage.path,
    titleKey: "nav.modelUsage",
    descriptionKey: "platform.descriptions.modelUsage",
    icon: Cpu,
    permissions: ["system-config"],
    group: "platform",
  },
  modelProviders: {
    path: platformRoutes.providers.path,
    titleKey: "nav.modelProviders",
    descriptionKey: "platform.descriptions.modelProviders",
    icon: Server,
    permissions: ["system-config"],
    group: "platform",
  },
  general: {
    path: platformRoutes.general.path,
    // Not "System settings": that is the application's own name, and a page that repeats it says nothing.
    titleKey: "nav.systemGeneral",
    descriptionKey: "platform.descriptions.general",
    icon: SlidersHorizontal,
    permissions: ["system-config"],
    group: "platform",
  },
  dataAdapters: {
    path: platformRoutes.adapters.path,
    titleKey: "nav.dataAdapters",
    descriptionKey: "platform.descriptions.dataAdapters",
    icon: Database,
    permissions: ["system-config"],
    group: "platform",
  },
  auditLog: {
    path: platformRoutes.audit.path,
    titleKey: "nav.auditLog",
    descriptionKey: "platform.descriptions.auditLog",
    icon: ScrollText,
    permissions: ["audit-logs"],
    group: "platform",
  },
  systemMonitor: {
    path: platformRoutes.monitor.path,
    titleKey: "nav.systemMonitor",
    descriptionKey: "platform.descriptions.systemMonitor",
    icon: Activity,
    permissions: ["system-monitoring"],
    group: "platform",
  },
} satisfies Record<string, PlatformPage>;

/** Lazily loaded components of the shared pages, keyed by path; the two model pages are one screen of one draft. */
const modelConfigPage = () => import("./pages/ModelConfigPage.vue");
export const platformPageComponents: Readonly<Record<string, () => Promise<unknown>>> = {
  [platformPages.modelUsage.path]: modelConfigPage,
  [platformPages.modelProviders.path]: modelConfigPage,
  [platformPages.general.path]: () => import("./pages/GeneralSettingsPage.vue"),
  [platformPages.dataAdapters.path]: () => import("./pages/DataAdaptersPage.vue"),
  [platformPages.auditLog.path]: () => import("./pages/AuditLogPage.vue"),
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

/** The shared settings pages, in the order of the system settings' column. */
export const ossPlatformPages: readonly PlatformPage[] = [
  platformPages.modelUsage,
  platformPages.modelProviders,
  platformPages.general,
  platformPages.dataAdapters,
  platformPages.auditLog,
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
