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
  usage: { path: "/admin/model-config/usage", titleKey: "nav.modelUsageTab", permissions: ["system-config"] },
  providers: { path: "/admin/model-config/providers", titleKey: "nav.modelProvidersTab", permissions: ["system-config"] },
} as const;

/**
 * The general parameters and the data adapter (`system-config`), and the licence (`authorization-management`). The
 * licence tab is the landing of a failed licence check, when the account's permissions cannot be read; editions without
 * licences (open source) list no tabs at all.
 */
export const systemSettingsTabs = {
  general: { path: "/admin/system-config/general", titleKey: "nav.systemGeneralTab", permissions: ["system-config"] },
  dataAdapters: {
    path: "/admin/system-config/data-adapters",
    titleKey: "nav.systemDataAdaptersTab",
    permissions: ["system-config"],
  },
  authorization: {
    path: "/admin/system-config/authorization",
    titleKey: "nav.systemAuthorizationTab",
    permissions: ["authorization-management"],
  },
} as const;

/** The change history (`audit-logs`) and the service status (`system-monitoring`). */
export const runRecordsTabs = {
  auditLog: { path: "/admin/records/audit-log", titleKey: "nav.auditLogTab", permissions: ["audit-logs"] },
  systemMonitor: { path: "/admin/records/system-monitor", titleKey: "nav.systemMonitorTab", permissions: ["system-monitoring"] },
} as const;

export const platformPages = {
  modelConfig: {
    path: "/admin/model-config",
    titleKey: "nav.modelConfig",
    descriptionKey: "platform.descriptions.modelConfig",
    icon: Cpu,
    permissions: ["system-config"],
    group: "platform",
    // The page draws its own header: the save of the whole draft and the unsaved marker sit there.
    ownHeader: true,
    tabs: [modelConfigTabs.usage, modelConfigTabs.providers],
  },
  systemSettings: {
    path: "/admin/system-config",
    titleKey: "nav.systemConfig",
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
    path: "/knowledge/feedback",
    titleKey: "nav.userFeedback",
    descriptionKey: "platform.descriptions.userFeedback",
    icon: MessageSquareText,
    permissions: ["audit-logs"],
    group: "knowledge",
  },
  runRecords: {
    path: "/admin/records",
    titleKey: "nav.runRecords",
    descriptionKey: "platform.descriptions.runRecords",
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
export function pageRoutes(
  pages: readonly PlatformPage[],
  components: Readonly<Record<string, () => Promise<unknown>>>
): RouteRecordRaw[] {
  return pages.flatMap((page) => {
    const component = components[page.path];
    if (!component) throw new Error(`No component for platform page ${page.path}`);
    const entry = { path: page.path, name: page.path, component, meta: { page: page.path } } as RouteRecordRaw;
    const tabs = (page.tabs ?? []).map(
      (tab) => ({ path: tab.path, name: tab.path, component, meta: { page: page.path } }) as RouteRecordRaw
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

/**
 * Every route the shared pages need: the edition's platform pages (with their tabs, so an edition whose system
 * settings hold the licence tab gets that tab's address too) and the pages beside them. Pages this package does not
 * ship, such as an edition's own permission centre, are routed by the edition.
 */
export function sharedPageRoutes(pages: readonly PlatformPage[] = ossPlatformPages): RouteRecordRaw[] {
  const shared = pages.filter((page) => page.path in platformPageComponents);
  return pageRoutes([...shared, ...platformKnowledgePages], platformPageComponents);
}

/**
 * Addresses of pages that were split into tabs: each one opens the tab that replaced it, so old links and bookmarks
 * land on the same screen. Editions add the addresses only they used to have.
 */
export function legacyPageRedirects(extra: readonly (readonly [string, string])[] = []): RouteRecordRaw[] {
  const redirects: readonly (readonly [string, string])[] = [
    ["/admin/license", systemSettingsTabs.authorization.path],
    ["/admin/audit-log", runRecordsTabs.auditLog.path],
    ["/admin/system-monitor", runRecordsTabs.systemMonitor.path],
    ...extra,
  ];
  return redirects.map(([path, redirect]) => ({ path, redirect }));
}
