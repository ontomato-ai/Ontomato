import type { Component } from "vue";

/**
 * One page of the Ontology Service navigation: its route path (hash), the capability that grants access and how its
 * navigation row looks. Ontology, asset and knowledge pages (the Manager's) and platform administration pages are all
 * entries of the same navigation.
 */
export interface PlatformPage {
  /** Hash path of the page, e.g. `/admin/audit-log` or `/objects`. */
  path: string;
  /** Title message key in the page's vue-i18n tree. */
  titleKey: string;
  /** Resolved title that replaces the message key (e.g. the registered permission name); set by the host. */
  title?: string;
  /** One-line description shown after the title in the page header the layout draws. */
  descriptionKey?: string;
  /** 16px navigation icon. */
  icon?: Component;
  /** Count shown at the end of the navigation row; null or absent shows none. */
  count?: () => number | null;
  /** The page draws its own page header (the Manager pages); otherwise the layout draws title and description. */
  ownHeader?: boolean;
  /**
   * Permission codes that grant this page: the page is enterable with any one of them.
   * An empty list means no permission is required (open source runs no permission logic).
   */
  permissions: readonly string[];
  /** Menu group this page belongs to; pages whose group is not visible are not listed. */
  group: string;
  /**
   * Tabs of a page that holds several screens under one entry, in display order; absent for a page without tabs.
   * A tab is shown when the account holds any one of its permission codes, and the page is listed when at least one of
   * its tabs is; the page's own `permissions` is the union of its tabs' codes.
   */
  tabs?: readonly PlatformPageTab[];
  /**
   * The page can be entered without its permissions (it is still listed only with them). The license page is the
   * landing for a failed license check, when the account's permissions cannot be read.
   */
  enterableWithoutPermission?: boolean;
}

/**
 * The Ontology Service navigation, supplied by the host so this package never imports an edition's pages (nor the
 * Manager's). The host lists groups and pages in display order; the layout filters them by the access check it is given.
 */
export interface PlatformNavigation {
  groups: readonly PlatformGroup[];
  pages: readonly PlatformPage[];
}

/** One tab of a page: the screen's own address and the permission codes that grant it. */
export interface PlatformPageTab {
  /** The tab's address (a route of its own); the page's own address lands on the first tab the account may see. */
  path: string;
  /** Title message key in the platform locale. */
  titleKey: string;
  /** Permission codes that grant this tab (any one of them); empty means every account that reached the page. */
  permissions: readonly string[];
}

/** A navigation group; shown when at least one of its pages is available. */
export interface PlatformGroup {
  key: string;
  /** Title message key in the platform locale. */
  titleKey: string;
  /** Resolved title that replaces the message key (e.g. the registered group name); set by the host. */
  title?: string;
}

/** The access check: `can` answers whether the signed-in account holds a permission code. Open source always allows. */
export interface PlatformAccess {
  readonly ready: boolean;
  /** Why the permissions could not be read; null when they were read (or need no reading). */
  readonly error: string | null;
  can(permission: string): boolean;
  /** Resolves once the permissions are read (or failed to be read); the router guard waits for it. */
  load(): Promise<void>;
}

/** Open source runs no permission logic: every page is available. */
export const openAccess: PlatformAccess = {
  ready: true,
  error: null,
  can: () => true,
  load: () => Promise.resolve(),
};

/**
 * Pages available to the current account, in navigation order: a page with no required permissions is always
 * available. This is the single rule the menu, the router guard and the first-available-page redirect all read, so they
 * cannot disagree.
 */
export function availablePages(navigation: PlatformNavigation, access: PlatformAccess): PlatformPage[] {
  return navigation.pages.filter(
    (page) => page.permissions.length === 0 || page.permissions.some((permission) => access.can(permission))
  );
}

/** Groups that have at least one available page, in navigation order. */
/** The tabs of a page the account may see, in display order; every page has one empty tab when it has no tabs. */
export function availableTabs(page: PlatformPage, access: PlatformAccess): PlatformPageTab[] {
  return (page.tabs ?? []).filter(
    (tab) => tab.permissions.length === 0 || tab.permissions.some((permission) => access.can(permission))
  );
}

/** The tab a route shows when the account may open it, otherwise the page's first tab it may open; null for a page
 * without tabs. */
export function shownTab(page: PlatformPage, access: PlatformAccess, path?: string): PlatformPageTab | null {
  const tabs = availableTabs(page, access);
  return tabs.find((tab) => tab.path === path) ?? tabs[0] ?? null;
}

export function availableGroups(navigation: PlatformNavigation, access: PlatformAccess): PlatformGroup[] {
  const keys = new Set(availablePages(navigation, access).map((page) => page.group));
  return navigation.groups.filter((group) => keys.has(group.key));
}

/**
 * Where to go when the current page is not available: the first available page of the requested group, otherwise the
 * first available page. Null means the account has no platform page at all.
 */
export function fallbackPage(
  navigation: PlatformNavigation,
  access: PlatformAccess,
  preferredGroup?: string
): PlatformPage | null {
  const pages = availablePages(navigation, access);
  if (preferredGroup) {
    const inGroup = pages.find((page) => page.group === preferredGroup);
    if (inGroup) return inGroup;
  }
  return pages[0] ?? null;
}

/**
 * A link to another application in the sidebar's function area (Agent Platform, Data Governance Platform). It always
 * opens in a new tab: `href` as a link, or `open` for a target the host must resolve first (a signed jump).
 */
export interface PlatformLink {
  key: string;
  titleKey: string;
  icon: Component;
  href?: string;
  open?: () => void;
}
