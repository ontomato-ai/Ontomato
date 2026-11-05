import type { PlatformPanelGroup, PlatformPanelPage } from "@ontomato/platform-shell";
import { availablePages, type PlatformAccess, type PlatformNavigation } from "@ontomato/platform-admin";
import type { PlatformAppDeclaration } from "./apps";

/**
 * How the platform's navigation is cut into applications.
 *
 * The navigation is one list of pages (the Manager's and the platform's together); the platform shows each under the
 * application that owns it. Pages are assigned by address, not by the group they sit in: the object browser takes the
 * graph and the data browser out of the ontology group while the ontology manager keeps the rest, so a group is not the
 * unit of ownership.
 */
export interface AppPartition extends Omit<PlatformAppDeclaration, "groups" | "label" | "settings"> {
  /** An external application: the host resolves or fixes its address and the rail opens it in a new tab. */
  href?: string;
  open?: () => void;
  /** The application's name, a message key in the edition's tree. */
  labelKey: string;
  /**
   * The application's own entry at the foot of its column: its words, and the page it opens. An entry that opens a page
   * of another application names that address (the diagnosis model is chosen in the platform's settings).
   */
  settings?: { id: string; labelKey: string; icon: string; path?: string };
  /**
   * Where its rail row opens. An application opens its first page unless the entry into it is another: the agent
   * platform opens the conversation although the dashboards come first in its column.
   */
  home?: string;
  /** The pages this application lists, in display order: one group per entry. */
  sections: readonly { key: string; titleKey: string; paths: readonly string[] }[];
}

/**
 * The declarations the shell draws, built from the platform navigation.
 *
 * A page is listed when the navigation holds it and the account may open it, by the same rule the router guard reads, so
 * a page that is not listed is not enterable either and the column and a deep link cannot disagree. An entry whose pages
 * are all unavailable disappears with them.
 */
export function appDeclarations(
  navigation: PlatformNavigation,
  access: PlatformAccess,
  partition: readonly AppPartition[],
  t: (key: string) => string,
): PlatformAppDeclaration[] {
  const pages = availablePages(navigation, access);
  // A page's address may carry a parameter (`/browser/data/:className?`); the column lists the address up to it, which is
  // also the address the router serves the page at.
  const base = (path: string) => path.split("/:")[0]!;
  const byPath = new Map(pages.map((page) => [base(page.path), page]));

  return partition.map((app): PlatformAppDeclaration => {
    const groups: PlatformPanelGroup[] = app.sections
      .map((section) => ({
        key: section.key,
        label: t(section.titleKey),
        pages: section.paths
          .map((path) => byPath.get(base(path)))
          .filter((page): page is NonNullable<typeof page> => page !== undefined)
          .map(
            (page): PlatformPanelPage => ({
              id: base(page.path),
              // A host may resolve a page's title itself (a registered permission name); otherwise its key is translated.
              label: page.title ?? t(page.titleKey),
              icon: page.icon ?? "pages",
              count: page.count?.() ?? null,
            }),
          ),
      }))
      .filter((group) => group.pages.length > 0);

    return {
      id: app.id,
      label: t(app.labelKey),
      icon: app.icon,
      prefix: app.prefix,
      panel: app.panel,
      settings: app.settings && {
        id: app.settings.id,
        label: t(app.settings.labelKey),
        icon: app.settings.icon,
        path: app.settings.path,
      },
      href: app.href,
      open: app.open,
      // The rail row opens the application's own first page. A declaration that names its entry keeps it (the agent
      // platform is entered at the conversation); otherwise the first page the account may open decides, so a row never
      // opens an address no route serves.
      home: base(app.home ?? groups[0]?.pages[0]?.id ?? app.sections[0]?.paths[0] ?? app.prefix),
      groups,
    };
  });
}
