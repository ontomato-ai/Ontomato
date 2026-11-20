/*
 * The menu of an application whose pages are its entries, as the frame draws it (design §3, "one address, one route").
 *
 * Java answers this menu with the entry it resolved (`resolveEntry.menu`): the groups the application declares, and the
 * entries this reader may open that carry a name. It is the only source of the menu — the platform's catalogue lists the
 * applications, not their pages. Ordering is this side's, and the same everywhere the menu is drawn:
 *
 * - entries in no group come first, in the order Java holds them;
 * - then each group by its declared `sort`, the entries of a group in the order Java holds them.
 *
 * An entry without a name never appears: a link may open it, the menu never offers it.
 */

export interface ApplicationMenuGroup {
  key: string;
  names: Record<string, string>;
  sort: number;
}

export interface ApplicationMenuEntry {
  id: string;
  pageKey: string;
  path: string;
  names?: Record<string, string>;
  groupKey?: string | null;
}

export interface ApplicationMenu {
  groups: readonly ApplicationMenuGroup[];
  panelUses: readonly ApplicationMenuEntry[];
}

/** One group of the menu as it is drawn: what it is called and the entries in it, in the order they are offered. */
export interface ApplicationMenuSection {
  /** The declared group key, or `null` for the entries the application put in no group. */
  key: string | null;
  /** The group's name in the reader's language; empty for the ungrouped section, which gets no heading. */
  label: string;
  entries: readonly ApplicationMenuSectionEntry[];
}

export interface ApplicationMenuSectionEntry {
  /** The use relation the entry is: what a jump names. */
  id: string;
  pageKey: string;
  /** The entry's own address, which is what jumping to it navigates to. */
  path: string;
  label: string;
}

/** The reader's word for a name held in several languages, falling back to English as Java requires one. */
export function menuLabel(names: Record<string, string>, locale: string): string {
  return names[locale] ?? names.en ?? Object.values(names)[0] ?? "";
}

/** The menu's sections in the order the frame draws them, with the entries only this reader may see. */
export function applicationMenuSections(menu: ApplicationMenu, locale: string): readonly ApplicationMenuSection[] {
  const named = menu.panelUses.filter((entry) => entry.names && menuLabel(entry.names, locale) !== "");
  const ungrouped = named.filter((entry) => !entry.groupKey || !menu.groups.some((group) => group.key === entry.groupKey));
  const sections: ApplicationMenuSection[] = [];
  if (ungrouped.length)
    sections.push({ key: null, label: "", entries: ungrouped.map((entry) => sectionEntry(entry, locale)) });
  for (const group of [...menu.groups].sort((one, other) => one.sort - other.sort)) {
    const entries = named.filter((entry) => entry.groupKey === group.key).map((entry) => sectionEntry(entry, locale));
    if (entries.length) sections.push({ key: group.key, label: menuLabel(group.names, locale), entries });
  }
  return sections;
}

function sectionEntry(entry: ApplicationMenuEntry, locale: string): ApplicationMenuSectionEntry {
  return { id: entry.id, pageKey: entry.pageKey, path: entry.path, label: menuLabel(entry.names ?? {}, locale) };
}
