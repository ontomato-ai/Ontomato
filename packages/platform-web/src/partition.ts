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
  /** The application's name, a message key in the edition's tree. */
  labelKey: string;
  /** The application's own entry at the foot of its column, a message key and the page it opens. */
  settings?: { id: string; labelKey: string; icon: string };
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
  const byPath = new Map(pages.map((page) => [page.path, page]));

  return partition.map((app): PlatformAppDeclaration => {
    const groups: PlatformPanelGroup[] = app.sections
      .map((section) => ({
        key: section.key,
        label: t(section.titleKey),
        pages: section.paths
          .map((path) => byPath.get(path))
          .filter((page): page is NonNullable<typeof page> => page !== undefined)
          .map(
            (page): PlatformPanelPage => ({
              id: page.path,
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
      settings: app.settings && { id: app.settings.id, label: t(app.settings.labelKey), icon: app.settings.icon },
      groups,
    };
  });
}
