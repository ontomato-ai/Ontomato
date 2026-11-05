import type { PlatformApp, PlatformAppPanel, PlatformPanelGroup, PlatformPanelPage } from "@ontomato/platform-shell";
import type { Component } from "vue";

/** How an application's second column is filled. */
export type PlatformAppPanelKind =
  /** A conversation application: the agent, new conversation and history, contributed by the page itself. */
  | "conversation"
  /** Only pages: the groups listed below. */
  | "pages";

/** One application the platform shows in its rail. */
export interface PlatformAppDeclaration {
  id: string;
  label: string;
  icon: string;
  /** The application owns the addresses under this prefix. */
  prefix: string;
  panel: PlatformAppPanelKind;
  /** The application's own entry at the foot of its column (smart-agent settings, the diagnosis model). */
  settings?: { id: string; label: string; icon: string };
  /** An external application: its fixed address, or the host's resolver for a signed jump; the rail opens it. */
  href?: string;
  open?: () => void;
  /** Pages of a page-only application, in display order. */
  groups?: readonly PlatformPanelGroup[];
}

/** The rail entry of one declaration. */
export function railApp(declaration: PlatformAppDeclaration): PlatformApp {
  return { id: declaration.id, label: declaration.label, icon: declaration.icon };
}

/** The column heading of one declaration. */
export function panelOf(declaration: PlatformAppDeclaration): PlatformAppPanel {
  return { id: declaration.id, label: declaration.label, settings: declaration.settings };
}

/** The application whose prefix contains the address, the longest match winning; null when no application owns it. */
export function appAt(declarations: readonly PlatformAppDeclaration[], path: string): PlatformAppDeclaration | null {
  let match: PlatformAppDeclaration | null = null;
  for (const declaration of declarations) {
    if (path !== declaration.prefix && !path.startsWith(`${declaration.prefix}/`)) continue;
    if (!match || declaration.prefix.length > match.prefix.length) match = declaration;
  }
  return match;
}

/**
 * One page of the platform's navigation, as the column lists it: the address the column opens, the resolved title, and
 * the icon. The navigation stays the single source of a page's title and permissions; this only names it for the column.
 */
export interface AppPageEntry {
  path: string;
  title: string;
  icon: Component;
  count?: () => number | null;
  /** A page that holds several screens is listed once; its tabs are reached from the page. */
  tabs?: readonly { path: string; title: string }[];
}

/** One group of a page-only application, as its navigation declares it. */
export interface AppGroupEntry {
  key: string;
  title: string;
  pages: readonly AppPageEntry[];
}

/** The pages of one application, taken from the platform's navigation and grouped as the application groups them. */
export function columnGroups(groups: readonly AppGroupEntry[]): readonly PlatformPanelGroup[] {
  return groups.map((group) => ({
    key: group.key,
    label: group.title,
    pages: group.pages.map(
      (page): PlatformPanelPage => ({ id: page.path, label: page.title, icon: page.icon, count: page.count?.() ?? null }),
    ),
  }));
}
