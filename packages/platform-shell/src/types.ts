/** One application in the platform rail. */
export interface PlatformApp {
  id: string;
  /** Shown beside the icon when the rail is expanded; the icon alone when collapsed. */
  label: string;
  /** Icon name from the shell's curated set (see icons.ts). */
  icon: string;
  /** The application was published from App Builder. */
  built?: boolean;
  /**
    * The application's rail section: user applications, builders, governance, or settings above the account.
    * Absent means `apps`.
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
  /**
   * External link URL (`?standalone=1`) for opening this application directly in a standalone tab from the expanded
   * rail; absent when standalone open is disabled or for external-link applications.
   */
  standaloneHref?: string;
  /** Declared but not built yet; shown disabled with this hint rather than hidden. */
  unavailableHint?: string;
}

/** The rail's sections, top to bottom; a divider separates them and none carries a group name. */
export type PlatformRailSection = "top" | "builders" | "apps" | "bottom";

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
  icon?: PlatformIcon;
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

/** Icon shown beside an application menu row: a curated platform icon key or a Vue component. */
export type AppMenuIcon = PlatformIcon;

/** One entry in an application menu column. */
export interface AppMenuItem {
  /** Stable identifier of the entry (typically its route path). */
  id: string;
  /** Localized display label shown on the row. */
  label: string;
  /** Optional icon key from the platform's curated icon set or a Vue icon component. */
  icon?: AppMenuIcon;
  /** Optional directory count shown right-aligned; null or undefined hides the badge. */
  count?: number | null;
  /** When set, renders the row disabled with this tooltip hint instead of clickable. */
  unavailableHint?: string;
}

/** A group of entries in an application menu column; omit `label` for an untitled section. */
export interface AppMenuGroup {
  /** Stable group key. */
  key: string;
  /** Optional section heading shown above the group's entries. */
  label?: string;
  /** Entries in display order. */
  items: readonly AppMenuItem[];
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
  /** The way back on a page the reader reached from elsewhere. */
  back: string;
  /** The page header's "more" button. */
  more: string;
  /** The header's item that copies the entry's external link, and what it says once copied. */
  copyExternalLink: string;
  externalLinkCopied: string;
  /** Name of the control that expands the rail. */
  expandRail: string;
  /** Name of the control that collapses the rail. */
  collapseRail: string;
  /** Accessible name of the rail's navigation landmark. */
  applications: string;
  home?: string;
  builtApplication?: string;
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
  /** Accessible name and tooltip of the expanded-rail button that opens an application in a standalone tab. */
  openStandalone?: string;
  /** The application panel's navigation landmark. */
  pages: string;
  /** The page header's own actions: shown only for a page that hands over a draft. */
  save: string;
  discard: string;
  unsavedChanges: string;
}
