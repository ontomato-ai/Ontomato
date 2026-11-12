import type { InjectionKey, Ref } from "vue";
import type { CatalogApplication } from "@ontomato/contracts/platform-identity";
import type { PlatformApp, PlatformPanelGroup, PlatformPanelPage, PlatformRailSection } from "@ontomato/platform-shell";

/**
 * How an application that holds several pages shows them: as a menu in its own column beside its pages, headed by the
 * application's name (the ontology manager, the system settings, the permissions). An application without one shows a
 * single page under a header that names the application (the object browser).
 */
export type PlatformAppFrame = "menu";

/** One application the platform shows in its rail. */
export interface PlatformAppDeclaration {
  id: string;
  label: string;
  /**
   * One line after the application's name: in the header of an application that shows one page under its own name (the
   * object browser), and on the home's square.
   */
  description?: string | null;
  icon: string;
  /**
   * Which of the rail's three sections it sits in; the shell groups by it and draws a divider between sections. A
   * declaration made outside this module may leave it out, which puts the application among the business ones.
   */
  rail?: PlatformRailSection;
  /** The functional group the home's square files it under; the rail's section does not decide it. */
  category: CatalogApplication["category"];
  /** The application owns the addresses under this prefix. */
  prefix: string;
  /** How its pages are shown when it holds several; absent means one page under the application's header. */
  frame?: PlatformAppFrame;
  /** The address its rail row opens: the first page the account may open, or the entry the declaration names. */
  home?: string;
  /** An external application: its fixed address, or the host's resolver for a signed jump; the rail opens it. */
  href?: string;
  open?: () => void;
  /** Pages of a page-only application, in display order. */
  groups?: readonly PlatformPanelGroup[];
  /** The application's own entry at the foot of its column (its models), when the account may open it. */
  foot?: PlatformPanelPage | null;
}

/**
 * Opens an application by its id the way its rail row does. The shell's layout provides it to the pages inside it, so a
 * page that leads to an application never works out the application's address itself.
 */
export const openApplicationKey: InjectionKey<(id: string) => void> = Symbol("open-application");

/** The edition's brand the shell shows (its name, and its logo when it has one); the home shows the same mark. */
export const platformBrandKey: InjectionKey<{ name: string; logo?: string }> = Symbol("platform-brand");

/** The applications the shell's rail shows, in rail order; the shell's layout provides them to the pages inside it. */
export const platformApplicationsKey: InjectionKey<Readonly<Ref<readonly PlatformAppDeclaration[]>>> =
  Symbol("platform-applications");

/**
 * The rail entry of one declaration. An external application (a fixed address or the host's resolver) is opened by
 * `open`, which the caller points at the platform's one application entry, so the rail's click is recorded like any
 * other opening; an application of the platform's own is selected through the rail's `selectApp`.
 */
export function railApp(declaration: PlatformAppDeclaration, open: () => void): PlatformApp {
  return {
    id: declaration.id,
    label: declaration.label,
    icon: declaration.icon,
    rail: declaration.rail,
    open: declaration.href || declaration.open ? open : undefined,
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
