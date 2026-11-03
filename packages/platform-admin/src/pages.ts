import type { PlatformGroup, PlatformNavigation, PlatformPage } from "./navigation";

/**
 * Platform pages this package ships (audit logs, system monitoring, system configuration). Each edition composes the
 * whole navigation from these and its own pages; the paths and permission codes of the shared pages stay here.
 * The codes are the platform's own (`audit-logs`, `system-monitoring`, `system-config`), the ones the workbench menu
 * used for the same pages.
 */
export const platformGroups = {
  system: { key: "system", titleKey: "nav.systemManagement" },
} satisfies Record<string, PlatformGroup>;

export const platformPages = {
  auditLog: {
    path: "/admin/audit-log",
    titleKey: "nav.auditLogs",
    permissions: ["audit-logs"],
    group: "system",
  },
  systemMonitor: {
    path: "/admin/system-monitor",
    titleKey: "nav.systemMonitoring",
    permissions: ["system-monitoring"],
    group: "system",
  },
  systemConfig: {
    path: "/admin/system-config",
    titleKey: "nav.systemConfig",
    permissions: ["system-config"],
    group: "system",
  },
} satisfies Record<string, PlatformPage>;

/** Lazily loaded components of the shared pages, keyed by path. */
export const platformPageComponents = {
  [platformPages.auditLog.path]: () => import("./pages/AuditLogPage.vue"),
  [platformPages.systemMonitor.path]: () => import("./pages/SystemMonitorPage.vue"),
  [platformPages.systemConfig.path]: () => import("./pages/SystemConfigPage.vue"),
};

/** The open-source navigation: the shared pages in one group. */
export const ossNavigation: PlatformNavigation = {
  groups: [platformGroups.system],
  pages: [platformPages.auditLog, platformPages.systemMonitor, platformPages.systemConfig],
};
