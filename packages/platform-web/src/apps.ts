import type { PlatformApp, PlatformPanelGroup, PlatformRailSection } from "@ontomato/platform-shell";

/**
 * How an application that holds several pages shows them: as tabs in its header (the object browser, the system
 * settings), or as a menu in its own band beside its pages (the ontology manager, whose groups stay).
 */
export type PlatformAppFrame = "tabs" | "menu";

/** One application the platform shows in its rail. */
export interface PlatformAppDeclaration {
  id: string;
  label: string;
  /**
   * One line under the application's name in the header its pages share. An application that declares it is named in
   * that header even where it shows a single page (the open-source object browser); see `PlatformLayout`.
   */
  description?: string | null;
  icon: string;
  /**
   * Which of the rail's three sections it sits in; the shell groups by it and draws a divider between sections. A
   * declaration made outside this module may leave it out, which puts the application among the business ones.
   */
  rail?: PlatformRailSection;
  /** The application owns the addresses under this prefix. */
  prefix: string;
  /** How its pages are shown when it holds several; absent means header tabs. */
  frame?: PlatformAppFrame;
  /** The address its rail row opens: the first page the account may open, or the entry the declaration names. */
  home?: string;
  /** An external application: its fixed address, or the host's resolver for a signed jump; the rail opens it. */
  href?: string;
  open?: () => void;
  /** Pages of a page-only application, in display order. */
  groups?: readonly PlatformPanelGroup[];
}

/** The rail entry of one declaration, carrying how the rail opens it: a page, a fixed address, or the host's resolver. */
export function railApp(declaration: PlatformAppDeclaration): PlatformApp {
  return {
    id: declaration.id,
    label: declaration.label,
    icon: declaration.icon,
    rail: declaration.rail,
    href: declaration.href,
    open: declaration.open,
  };
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
