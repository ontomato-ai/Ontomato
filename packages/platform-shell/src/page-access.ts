import { inject, type InjectionKey } from "vue";

/**
 * Whether the account may open a page of the platform's navigation, by its address. The platform answers it from the
 * pages' own declarations (their permission codes), the same rule its menus and its router guard read; an application
 * that draws its own column (the agent platform, knowledge governance) asks it before listing an entry there.
 */
export const platformPageAccessKey: InjectionKey<(path: string) => boolean> = Symbol("platform-page-access");

export function usePageAccess(): (path: string) => boolean {
  const access = inject(platformPageAccessKey);
  if (!access) throw new Error("Page access is read inside the platform, which provides it");
  return access;
}

/**
 * An application's name by its id, as the platform's rail shows it (the application catalog's name in the reader's
 * language): a page that refers the reader to another application names it the same way.
 */
export const platformApplicationNameKey: InjectionKey<(id: string) => string> = Symbol("platform-application-name");

export function useApplicationName(): (id: string) => string {
  const name = inject(platformApplicationNameKey);
  if (!name) throw new Error("Application names are read inside the platform, which provides them");
  return name;
}
