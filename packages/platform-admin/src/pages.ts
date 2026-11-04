import { Activity, Cpu, ScrollText, Settings } from "lucide-vue-next";
import type { RouteRecordRaw } from "vue-router";
import type { PlatformGroup, PlatformPage } from "./navigation";

/**
 * Platform administration pages this package ships (audit logs, system monitoring, model and system configuration).
 * Each edition composes the whole navigation from these, the Manager's pages and its own pages; the paths and permission
 * codes of the shared pages stay here.
 * The codes are the platform's own (`audit-logs`, `system-monitoring`, `system-config`), the ones the workbench menu
 * used for the same pages; the model configuration shares `system-config` with the system configuration.
 */
export const platformGroups = {
  platform: { key: "platform", titleKey: "platform.title" },
} satisfies Record<string, PlatformGroup>;

export const platformPages = {
  auditLog: {
    path: "/admin/audit-log",
    titleKey: "nav.auditLogs",
    descriptionKey: "platform.descriptions.auditLog",
    icon: ScrollText,
    permissions: ["audit-logs"],
    group: "platform",
  },
  systemMonitor: {
    path: "/admin/system-monitor",
    titleKey: "nav.systemMonitoring",
    descriptionKey: "platform.descriptions.systemMonitor",
    icon: Activity,
    permissions: ["system-monitoring"],
    group: "platform",
  },
  modelConfig: {
    path: "/admin/model-config",
    titleKey: "nav.modelConfig",
    descriptionKey: "platform.descriptions.modelConfig",
    icon: Cpu,
    permissions: ["system-config"],
    group: "platform",
  },
  systemConfig: {
    path: "/admin/system-config",
    titleKey: "nav.systemConfig",
    descriptionKey: "platform.descriptions.systemConfig",
    icon: Settings,
    permissions: ["system-config"],
    group: "platform",
  },
} satisfies Record<string, PlatformPage>;

/** Lazily loaded components of the shared pages, keyed by path. */
export const platformPageComponents: Readonly<Record<string, () => Promise<unknown>>> = {
  [platformPages.auditLog.path]: () => import("./pages/AuditLogPage.vue"),
  [platformPages.systemMonitor.path]: () => import("./pages/SystemMonitorPage.vue"),
  [platformPages.modelConfig.path]: () => import("./pages/ModelConfigPage.vue"),
  [platformPages.systemConfig.path]: () => import("./pages/SystemConfigPage.vue"),
};

/** The shared pages in the open-source order of the platform administration group. */
export const ossPlatformPages: readonly PlatformPage[] = [
  platformPages.modelConfig,
  platformPages.systemConfig,
  platformPages.auditLog,
  platformPages.systemMonitor,
];

/** One route per page from its lazily loaded component; `meta.page` names the navigation entry. */
export function pageRoutes(
  pages: readonly PlatformPage[],
  components: Readonly<Record<string, () => Promise<unknown>>>
): RouteRecordRaw[] {
  return pages.map((page) => {
    const component = components[page.path];
    if (!component) throw new Error(`No component for platform page ${page.path}`);
    return { path: page.path, name: page.path, component, meta: { page: page.path } } as RouteRecordRaw;
  });
}
