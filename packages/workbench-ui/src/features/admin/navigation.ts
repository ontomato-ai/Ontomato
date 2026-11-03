import { adminGroupData, adminMenuItemData, type AdminGroupData, type AdminMenuItemData } from "./navigation-data";
import type { Component, InjectionKey } from "vue";
import { ONTOLOGY_MANAGER_PATH } from "../../config/app";
import {
  Blocks,
  Bot,
  Cpu,
  Database,
  MessageSquare,
  Monitor,
  Network,
  Puzzle,
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

/** Assembly input of the admin layout. */
export interface AdminLayoutConfig {
  access: AdminAccess;
  groups: readonly AdminGroup[];
  items: readonly AdminMenuItem[];
  account: AdminAccount | null;
}

/** Only the browser adapter resolves icons and deployment-relative links. */
export const adminNavigationIcons: Record<string, Component> = {
  Blocks, Bot, Cpu, Database, MessageSquare, Monitor, Network, Puzzle, ServerCog,
};

export function decorateAdminGroup(group: AdminGroupData): AdminGroup {
  const { icon, target, ...data } = group;
  return { ...data, icon: adminNavigationIcons[icon], ...(target ? { href: ONTOLOGY_MANAGER_PATH } : {}) };
}

export function decorateAdminMenuItem(item: AdminMenuItemData, icons = adminNavigationIcons): AdminMenuItem {
  return { ...item, icon: icons[item.icon] };
}

export const adminGroups = Object.fromEntries(
  Object.entries(adminGroupData).map(([key, group]) => [key, decorateAdminGroup(group)]),
) as Record<keyof typeof adminGroupData, AdminGroup>;

export const adminMenuItems = Object.fromEntries(
  Object.entries(adminMenuItemData).map(([key, item]) => [key, decorateAdminMenuItem(item)]),
) as Record<keyof typeof adminMenuItemData, AdminMenuItem>;
