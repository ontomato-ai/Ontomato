import type { PlatformApp, PlatformAppPanel, PlatformPanelGroup } from "@ontomato/platform-shell";

/** How an application's second column is filled. */
export type PlatformAppPanelKind =
  /** A conversation application: the agent picker, new conversation and history, with pages as extra entries. */
  | "conversation"
  /** Only pages: groups listed by the host. */
  | "pages";

/** One application the platform shows in its rail. */
export interface PlatformAppDeclaration {
  /** Matches the address: the application owns the paths under `prefix`. */
  id: string;
  label: string;
  icon: string;
  prefix: string;
  panel: PlatformAppPanelKind;
  /** The application's own entry at the foot of its column. */
  settings?: { id: string; label: string; icon: string };
  /** Pages of a page-only application, in the order the application gives them. */
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

/** The application whose paths contain the address; null when no application owns it (a standalone page). */
export function appAt(
  declarations: readonly PlatformAppDeclaration[],
  path: string,
): PlatformAppDeclaration | null {
  let match: PlatformAppDeclaration | null = null;
  for (const declaration of declarations) {
    if (path !== declaration.prefix && !path.startsWith(`${declaration.prefix}/`)) continue;
    // The longest prefix wins, so a nested application can sit under a broader one.
    if (!match || declaration.prefix.length > match.prefix.length) match = declaration;
  }
  return match;
}
