import type { Component, InjectionKey } from "vue";
import { ONTOLOGY_MANAGER_PATH } from "../../config/app";
import {
  Activity,
  Blocks,
  Bot,
  Cpu,
  Database,
  MessageSquare,
  Monitor,
  Network,
  Puzzle,
  ScrollText,
  ServerCog,
} from "lucide-vue-next";

/**
 * Top tabs of the admin console. permission is a public capability id: apps with permissions filter by it; open source runs no permission logic.
 * A tab is visible when it has permission itself or at least one menu item in its group does.
 */
export interface AdminGroup {
  key: string;
  titleKey: string;
  /** For a link tab this is the linked page's permission: the tab is visible only with it. */
  permission: string;
  icon: Component;
  /**
   * Link tab: a real link that opens another page of the platform in a new window (noopener) and has no menu items
   * (the Ontology Manager is its own page next to the workbench).
   */
  href?: string;
}

export interface AdminMenuItem {
  /** The item is visible when the user has any one of these permissions. */
  permissions: readonly string[];
  path: string;
  /** Menu label; the admin layout also shows it as the page title. */
  titleKey: string;
  /** One-line description the admin layout shows under the page title. */
  descriptionKey: string;
  icon: Component;
  groupKey: string;
}

/** Tabs that only run an action and have no menu items (e.g. a "data governance" jump). Placed before the grouped tabs. */
export interface AdminActionTab {
  key: string;
  titleKey: string;
  icon: Component;
  select(): void;
}

/** The app's access check: ready means permissions are loaded; open source is always ready and always allowed. */
export interface AdminAccess {
  readonly ready: boolean;
  can(permission: string): boolean;
}

/** The admin layout hands the app's access check to its pages (entry cards use it to decide what to show). */
export const adminAccessKey: InjectionKey<AdminAccess> = Symbol("admin-access");

/** Header display and logout for the signed-in account; open source has no account. */
export interface AdminAccount {
  readonly userName: string;
  logout(): void;
}

/**
 * Assembly input of the admin layout. navigationHidden is the reduced layout used when licensing is restricted:
 * only back, title, theme and account remain; tabs, sidebar and loading/no-permission states are hidden.
 */
export interface AdminLayoutConfig {
  access: AdminAccess;
  groups: readonly AdminGroup[];
  items: readonly AdminMenuItem[];
  actionTabs: readonly AdminActionTab[];
  account: AdminAccount | null;
  navigationHidden: boolean;
}

/** Shared tabs and menu items; each app lists the ones it uses explicitly in the original order. */
export const adminGroups = {
  dataAssets: {
    key: "data-assets",
    titleKey: "nav.ontologyManager",
    permission: "ontology-modeling",
    icon: Database,
    href: ONTOLOGY_MANAGER_PATH,
  },
  appCapabilities: {
    key: "app-capabilities",
    titleKey: "nav.agentsAndSkills",
    permission: "application-management",
    icon: Blocks,
  },
  platformManagement: {
    key: "platform-management",
    titleKey: "nav.systemManagement",
    permission: "system-management",
    icon: Monitor,
  },
} satisfies Record<string, AdminGroup>;

export const adminMenuItems = {
  businessAgents: {
    permissions: ["analysis-agent"],
    path: "/admin/analysis",
    titleKey: "nav.businessAgents",
    descriptionKey: "navDescription.businessAgents",
    icon: Blocks,
    groupKey: "app-capabilities",
  },
  systemAgents: {
    permissions: ["observer"],
    path: "/admin/system-agents",
    titleKey: "nav.systemAgents",
    descriptionKey: "navDescription.systemAgents",
    icon: Bot,
    groupKey: "app-capabilities",
  },
  mcpService: {
    permissions: ["mcp-service"],
    path: "/admin/mcp-service",
    titleKey: "nav.mcpService",
    descriptionKey: "navDescription.mcpService",
    icon: Network,
    groupKey: "app-capabilities",
  },
  skills: {
    permissions: ["skill-management"],
    path: "/admin/skills",
    titleKey: "nav.skills",
    descriptionKey: "navDescription.skills",
    icon: Puzzle,
    groupKey: "app-capabilities",
  },
  modelConfig: {
    permissions: ["system-config"],
    path: "/admin/model-config",
    titleKey: "nav.modelConfig",
    descriptionKey: "navDescription.modelConfig",
    icon: Cpu,
    groupKey: "platform-management",
  },
  systemConfig: {
    permissions: ["system-config"],
    path: "/admin/system-config",
    titleKey: "nav.systemConfig",
    descriptionKey: "navDescription.systemConfig",
    icon: ServerCog,
    groupKey: "platform-management",
  },
  auditLog: {
    permissions: ["audit-logs"],
    path: "/admin/audit-log",
    titleKey: "nav.auditLogs",
    descriptionKey: "navDescription.auditLogs",
    icon: ScrollText,
    groupKey: "platform-management",
  },
  feedbackRecords: {
    permissions: ["audit-logs"],
    path: "/admin/feedback-records",
    titleKey: "nav.feedbackRecords",
    descriptionKey: "navDescription.feedbackRecords",
    icon: MessageSquare,
    groupKey: "platform-management",
  },
  systemMonitor: {
    permissions: ["system-monitoring"],
    path: "/admin/system-monitor",
    titleKey: "nav.systemMonitoring",
    descriptionKey: "navDescription.systemMonitoring",
    icon: Activity,
    groupKey: "platform-management",
  },
} satisfies Record<string, AdminMenuItem>;
