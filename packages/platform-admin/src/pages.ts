import { platformRoutes } from "@ontomato/platform-shell/routes";
import { Activity, Cpu, MessageSquareText, Settings } from "lucide-vue-next";
import type { RouteRecordRaw } from "vue-router";
import type { PlatformGroup, PlatformPage } from "./navigation";

/**
 * Platform administration pages this package ships: the permission centre's siblings — models, system settings and run
 * records. Each edition composes the whole navigation from these, the Manager's pages and its own pages; the paths,
 * permission codes and tab addresses of the shared pages stay here.
 * A page that holds several screens under one entry names each screen as a tab: a route of its own, under the
 * permission code the old page of that screen had, so an account may open the tab it holds even when it holds no other.
 */
export const platformGroups = {
  platform: { key: "platform", titleKey: "platform.title" },
} satisfies Record<string, PlatformGroup>;

/** How models are used (`usage`) and where they come from (`providers`). */
export const modelConfigTabs = {
  usage: { path: platformRoutes.usage.path, titleKey: "nav.modelUsageTab", permissions: ["system-config"] },
  providers: { path: platformRoutes.providers.path, titleKey: "nav.modelProvidersTab", permissions: ["system-config"] },
} as const;

/**
 * The general parameters and the data adapter (`system-config`), and the licence (`authorization-management`). The
 * licence tab is the landing of a failed licence check, when the account's permissions cannot be read; editions without
 * licences (open source) list no tabs at all.
 */
export const systemSettingsTabs = {
  // Not "System settings": that is the application's own name, and a tab that repeats its parent's name says nothing.
  general: { path: platformRoutes.general.path, titleKey: "nav.systemGeneralTab", permissions: ["system-config"] },
  dataAdapters: {
    path: platformRoutes.adapters.path,
    titleKey: "nav.systemDataAdaptersTab",
    permissions: ["system-config"],
  },
  authorization: {
    path: platformRoutes.license.path,
    titleKey: "nav.systemAuthorizationTab",
    permissions: ["authorization-management"],
  },
} as const;

/** The change history (`audit-logs`) and the service status (`system-monitoring`). */
export const runRecordsTabs = {
  auditLog: { path: platformRoutes.audit.path, titleKey: "nav.auditLogTab", permissions: ["audit-logs"] },
  systemMonitor: { path: platformRoutes.monitor.path, titleKey: "nav.systemMonitorTab", permissions: ["system-monitoring"] },
} as const;

export const platformPages = {
  modelConfig: {
    path: platformRoutes.models.path,
    titleKey: "nav.modelConfig",
    descriptionKey: "platform.descriptions.modelConfig",
    icon: Cpu,
    permissions: ["system-config"],
    group: "platform",
    // The page shares its application's header: the save of the whole draft and the unsaved marker are the header's.
    tabs: [modelConfigTabs.usage, modelConfigTabs.providers],
  },
  systemSettings: {
    path: platformRoutes.settings.path,
    // The application is "System settings"; this page under it is the general settings, not a second page of that name.
    titleKey: "nav.systemGeneralSettings",
    descriptionKey: "platform.descriptions.systemConfig",
    icon: Settings,
    permissions: ["system-config", "authorization-management"],
    group: "platform",
    tabs: [systemSettingsTabs.general, systemSettingsTabs.dataAdapters, systemSettingsTabs.authorization],
    // The landing of a failed licence check: the account's permissions cannot be read while the licence is invalid.
    enterableWithoutPermission: true,
  },
  /**
   * The feedback users gave on their conversations. It belongs to the knowledge pages (beside business knowledge), not
   * to platform administration; the records themselves are the workbench's.
   */
  userFeedback: {
    path: platformRoutes.feedback.path,
    titleKey: "nav.userFeedback",
    descriptionKey: "platform.descriptions.userFeedback",
    icon: MessageSquareText,
    permissions: ["user-feedback"],
    group: "knowledge",
    // The knowledge governance application's frame surrounds it (its column, its header): the platform draws no header.
    ownHeader: true,
  },
  runRecords: {
    path: platformRoutes.records.path,
    titleKey: "nav.runRecords",
    icon: Activity,
    permissions: ["audit-logs", "system-monitoring"],
    group: "platform",
    tabs: [runRecordsTabs.auditLog, runRecordsTabs.systemMonitor],
  },
} satisfies Record<string, PlatformPage>;

/** Lazily loaded components of the shared pages, keyed by path. */
export const platformPageComponents: Readonly<Record<string, () => Promise<unknown>>> = {
  [platformPages.modelConfig.path]: () => import("./pages/ModelConfigPage.vue"),
  [platformPages.systemSettings.path]: () => import("./pages/SystemSettingsPage.vue"),
  [platformPages.runRecords.path]: () => import("./pages/RunRecordsPage.vue"),
  [platformPages.userFeedback.path]: () => import("./pages/FeedbackRecordsPage.vue"),
};

/**
 * One route per page, plus one per tab: a tab route renders the page at its own address and names the page it belongs
 * to in `meta.page`, so the guard and the navigation highlight treat a tab as the page it is a screen of.
 */
function routeName(path: string) {
  return Object.values(platformRoutes).find((route) => route.path === path)!.name;
}

export function pageRoutes(
  pages: readonly PlatformPage[],
  components: Readonly<Record<string, () => Promise<unknown>>>
): RouteRecordRaw[] {
  return pages.flatMap((page) => {
    const component = components[page.path];
    if (!component) throw new Error(`No component for platform page ${page.path}`);
    const entry = { path: page.path, name: routeName(page.path), component, meta: { page: page.path } } as RouteRecordRaw;
    const tabs = (page.tabs ?? []).map(
      (tab) => ({ path: tab.path, name: routeName(tab.path), component, meta: { page: page.path } }) as RouteRecordRaw
    );
    return [entry, ...tabs];
  });
}

/** Screens other editions show on their own: the service status is the super admin console's services section too. */
export const systemMonitorPanel = () => import("./pages/SystemMonitorPage.vue");

/**
 * The open-source system settings: the general parameters and the data adapter only. Open source runs no licences, so it
 * has neither the licence tab nor the landing that tab exists for.
 */
export const ossSystemSettingsPage: PlatformPage = {
  ...platformPages.systemSettings,
  permissions: ["system-config"],
  tabs: [systemSettingsTabs.general, systemSettingsTabs.dataAdapters],
  enterableWithoutPermission: false,
};

/** The shared pages in the open-source order of the platform administration group. */
export const ossPlatformPages: readonly PlatformPage[] = [
  platformPages.modelConfig,
  ossSystemSettingsPage,
  platformPages.runRecords,
];

/** The pages outside platform administration that this package ships: the feedback records, under knowledge. */
export const platformKnowledgePages: readonly PlatformPage[] = [platformPages.userFeedback];

/** Pages whose screen another application's frame surrounds, so their route is that application's. */
const MULTI_APPLICATION_PAGES = new Set<string>([platformRoutes.feedback.path]);

/**
 * The screen of a shared page: the page's component, for an edition that mounts it inside another application's frame.
 * The feedback records show inside the knowledge governance application's column, so their route is that application's
 * and this package only supplies the screen.
 */
export const platformPageScreen = (path: string) => platformPageComponents[path];

/**
 * Every route the shared pages need: the edition's platform pages (with their tabs, so an edition whose system
 * settings hold the licence tab gets that tab's address too) and the pages beside them. Pages this package does not
 * ship, such as an edition's own permission centre, are routed by the edition.
 *
 * The feedback records are routed by the knowledge governance application (its column surrounds them), so they are
 * listed in the navigation and left out of the routes here.
 */
export function sharedPageRoutes(pages: readonly PlatformPage[] = ossPlatformPages): RouteRecordRaw[] {
  const shared = pages.filter((page) => page.path in platformPageComponents);
  const routed = [...shared, ...platformKnowledgePages].filter((page) => !MULTI_APPLICATION_PAGES.has(page.path));
  return pageRoutes(routed, platformPageComponents);
}
