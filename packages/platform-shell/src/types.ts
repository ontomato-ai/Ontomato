/** One application in the platform rail. */
export interface PlatformApp {
  id: string;
  /** Shown beside the icon when the rail is expanded; the icon alone when collapsed. */
  label: string;
  /** Icon name from the shell's curated set (see icons.ts). */
  icon: string;
  /** An external application: opened in a new tab and never the current application. */
  href?: string;
  /** Declared but not built yet; shown disabled with this hint rather than hidden. */
  unavailableHint?: string;
}

/** The signed-in account in the rail's footer; null in editions without sign-in. */
export interface PlatformAccount {
  userName: string;
  signOut(): void;
}

/** Theme and language, owned by the host; the account menu changes them. */
export interface PlatformPreferences {
  /** Supported locales; one entry means no language choice and no language row. */
  readonly locales: readonly string[];
  readonly locale: string;
  setLocale(locale: string): void;
  readonly theme: "light" | "dark";
  setTheme(theme: "light" | "dark"): void;
}

/** One page of an application that only has pages; the host groups and orders them. */
export interface PlatformPanelPage {
  id: string;
  label: string;
  icon: string;
  /** Count shown at the end of the row; null or absent shows none. */
  count?: number | null;
  /** Shown disabled with this hint (a page the application has not taken over yet). */
  unavailableHint?: string;
}

/** A titled group of pages in the application panel. */
export interface PlatformPanelGroup {
  key: string;
  label: string;
  pages: readonly PlatformPanelPage[];
}

/** What an application's second column says about itself, apart from its contents. */
export interface PlatformAppPanel {
  id: string;
  /** The application's name at the top of the panel. */
  label: string;
  /** The application's own entry at the bottom of the panel (smart-agent settings, the diagnosis model). */
  settings?: { id: string; label: string; icon: string };
}

/** Fixed text the shell draws; the host supplies it from its own i18n. */
export interface PlatformShellLabels {
  /** Name of the control that expands the rail. */
  expandRail: string;
  /** Name of the control that collapses the rail. */
  collapseRail: string;
  /** Accessible name of the rail's navigation landmark. */
  applications: string;
  /** The rail's brand name; the host may override it with a configured brand. */
  brand: string;
  /** Accessible name of the account menu's trigger. */
  account: string;
  language: string;
  theme: { light: string; dark: string };
  signOut: string;
  /** Accessible name of the mark on rows that open in a new tab; without it the mark is decorative. */
  opensInNewTab?: string;
  /** The application panel's navigation landmark. */
  pages: string;
}
