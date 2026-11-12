import type { PlatformPanelGroup, PlatformPanelPage } from "@ontomato/platform-shell";
import { availablePages, type PlatformAccess, type PlatformNavigation, type PlatformPage } from "@ontomato/platform-admin";
import type { PlatformAppDeclaration } from "./apps";

/**
 * How the platform's navigation is cut into applications.
 *
 * The navigation is one list of pages (the Manager's and the platform's together); the platform shows each under the
 * application that owns it. Pages are assigned by address, not by the group they sit in: the object browser takes the
 * graph and the data browser out of the ontology group while the ontology manager keeps the rest, so a group is not the
 * unit of ownership.
 */
export interface AppPartition extends Omit<PlatformAppDeclaration, "groups" | "label" | "foot"> {
  /** An external application: the host resolves or fixes its address and the rail opens it in a new tab. */
  href?: string;
  open?: () => void;
  /** The application's name, a message key in the edition's tree. */
  labelKey?: string;
  label?: string;
  /** One line under the name, when the application's pages share one header (a message key in the edition's tree). */
  descriptionKey?: string;
  /**
   * Where its rail row opens. An application opens its first page unless the entry into it is another: the agent
   * platform opens the conversation, and its settings are reached from the head of that column.
   */
  home?: string;
  /** The existing navigation page whose permission also governs this home route. */
  homePage?: string;
  /** The pages this application lists, in display order: one group per entry; a group without a title has no heading. */
  sections: readonly { key: string; titleKey?: string; paths: readonly string[] }[];
  /** The page at the foot of the application's column (its models), listed apart from the groups. */
  foot?: string;
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
  const panelPage = (page: PlatformPage): PlatformPanelPage => ({
    id: base(page.path),
    label: t(page.titleKey),
    icon: page.icon ?? "pages",
    count: page.count?.() ?? null,
  });

  return partition.map((app): PlatformAppDeclaration => {
    const groups: PlatformPanelGroup[] = app.sections
      .map((section) => ({
        key: section.key,
        label: section.titleKey ? t(section.titleKey) : undefined,
        pages: section.paths
          .map((path) => byPath.get(base(path)))
          .filter((page): page is NonNullable<typeof page> => page !== undefined)
          .map(panelPage),
      }))
      // A group the account may open nothing of is not shown: no empty heading.
      .filter((group) => group.pages.length > 0);
    const footPage = app.foot ? byPath.get(base(app.foot)) : undefined;

    const home = app.home && (!app.homePage || byPath.has(app.homePage)) ? app.home : undefined;
    return {
      id: app.id,
      label: app.label ?? t(app.labelKey!),
      description: app.description ?? (app.descriptionKey ? t(app.descriptionKey) : null),
      icon: app.icon,
      rail: app.rail ?? "apps",
      category: app.category,
      prefix: app.prefix,
      frame: app.frame,
      href: app.href,
      open: app.open,
      // The rail row opens the application's own first page. A declaration that names its entry keeps it (the agent
      // platform is entered at the conversation); otherwise the first page the account may open decides, so a row never
      // opens an address no route serves.
      home: base(home ?? groups[0]?.pages[0]?.id ?? footPage?.path ?? app.sections[0]?.paths[0] ?? app.prefix),
      groups,
      foot: footPage ? panelPage(footPage) : null,
    };
  });
}
