/** One application in the platform rail. */
export interface PlatformApp {
  id: string;
  /** Shown beside the icon when the rail is expanded; the icon alone when collapsed. */
  label: string;
  /** Icon name from the shell's curated set (see icons.ts). */
  icon: string;
  /**
   * Which of the rail's three sections the application sits in, top to bottom: the ontology applications, the business
   * applications, and the platform's own settings above the account. Absent means `apps`.
   */
  rail?: PlatformRailSection;
  /**
   * An external application's fixed address; it opens in a new tab and is never the current application.
   */
  href?: string;
  /**
   * An external application the host must resolve first (a signed jump): called on click, and it opens the target in a
   * new tab itself. Either `href` or `open`, like the platform navigation's links.
   */
  open?: () => void;
  /** Declared but not built yet; shown disabled with this hint rather than hidden. */
  unavailableHint?: string;
}

/** The rail's sections, top to bottom; a divider separates them and none carries a group name. */
export type PlatformRailSection = "top" | "apps" | "bottom";

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

/**
 * An icon the column shows: a name from the shell's curated set, or a component the application already carries (the
 * ontology manager's pages hold their own icons, and the column shows them as they are).
 */
export type PlatformIcon = string | import("vue").Component;

/** One page of an application that only has pages; the host groups and orders them. */
export interface PlatformPanelPage {
  id: string;
  label: string;
  icon: PlatformIcon;
  /** Count shown at the end of the row; null or absent shows none. */
  count?: number | null;
  /** Shown disabled with this hint (a page the application has not taken over yet). */
  unavailableHint?: string;
}

/** A group of pages in the application's column; a group without a label lists its pages under no heading. */
export interface PlatformPanelGroup {
  key: string;
  label?: string;
  pages: readonly PlatformPanelPage[];
}

/** Fixed text the shell draws; the host supplies it from its own i18n. */
/**
 * The edition's brand: its name, and its mark as an image when it has one, with a version for the dark theme when the
 * light one does not read there. Image addresses are relative to the page, so they follow the deployment's prefix.
 */
export interface PlatformBrand {
  name: string;
  logo?: string;
  /** The mark on the dark theme; without one the dark theme shows `logo` too. */
  logoDark?: string;
}

export interface PlatformShellLabels {
  /** Name of the control that expands the rail. */
  expandRail: string;
  /** Name of the control that collapses the rail. */
  collapseRail: string;
  /** Accessible name of the rail's navigation landmark. */
  applications: string;
  /**
   * The product's name on the rail (`Ontomato`). It is the product the applications belong to, not any one application's
   * former name.
   */
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
  /** The page header's own actions: shown only for a page that hands over a draft. */
  save: string;
  discard: string;
  unsavedChanges: string;
}
