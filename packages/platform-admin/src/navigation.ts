import type { Component } from "vue";

/**
 * One page of the Ontology Service navigation: its route path (hash) and how its
 * navigation row looks. Ontology, asset and knowledge pages (the Manager's) and platform administration pages are all
 * entries of the same navigation.
 */
export interface PlatformPage {
  /** Hash path of the page, e.g. `/admin/audit-log` or `/objects`. */
  path: string;
  /** Title message key in the page's vue-i18n tree: the page's name in its application's column and in its header. */
  titleKey: string;
  /** One-line description shown after the title in the page header the layout draws. */
  descriptionKey?: string;
  /** 16px navigation icon. */
  icon?: Component;
  /** The page draws its own page header (the Manager pages); otherwise the layout draws title and description. */
  ownHeader?: boolean;
  /** Menu group this page belongs to; pages whose group is not visible are not listed. */
  group: string;
  /**
   * The license page can display the recovery form when the service requires license activation.
   */
  licenseRecovery?: boolean;
}

/**
 * The Ontology Service navigation, supplied by the host so this package never imports an edition's pages (nor the
 * Manager's). The host lists groups and pages in display order; the layout filters them by the access check it is given.
 */
export interface PlatformNavigation {
  groups: readonly PlatformGroup[];
  pages: readonly PlatformPage[];
  /**
   * How a menu row looks where an application's menu table lists one of its panel entries instead of a page. The entry
   * itself (its name, and whether the reader may open it) is the application catalog's; these rows give only what a page
   * declaration would have: the icon.
   */
  entries?: readonly PlatformEntryRow[];
}

/** The look of a panel entry's menu row, by the address it stands at. */
export interface PlatformEntryRow {
  path: string;
  /** 16px navigation icon. */
  icon: Component;
}

/** A navigation group; shown when at least one of its pages is available. */
export interface PlatformGroup {
  key: string;
  /** Title message key in the platform locale. */
  titleKey: string;
}

export type EntryAdmission = "allowed" | "denied" | "license-required";

/** Entry projections for navigation and a fresh admission check when a page opens. */
export interface PlatformAccess {
  readonly ready: boolean;
  /** Why the permissions could not be read; null when they were read (or need no reading). */
  readonly error: string | null;
  canEnter(path: string): boolean;
  verifyEntry(path: string): Promise<EntryAdmission>;
  /** Resolves once the permissions are read (or failed to be read); the router guard waits for it. */
  load(): Promise<void>;
}

/**
 * Pages available to the current account, in navigation order, as projected by the application catalogue.
 */
export function availablePages(navigation: PlatformNavigation, access: PlatformAccess): PlatformPage[] {
  return navigation.pages.filter(page => access.canEnter(page.path));
}

/** Groups that have at least one available page, in navigation order. */
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
