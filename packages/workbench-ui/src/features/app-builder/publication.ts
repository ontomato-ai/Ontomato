import type { ApplicationDeclaration, CatalogApplication } from "@ontomato/contracts/platform-identity";
import type { WorkspaceCommit } from "@ontomato/contracts/workspaces";
import { workbenchLanguage } from "../../i18n";

/** The rail's icon for the applications the builder publishes. */
const APP_ICON = "pages";

/**
 * A new application's declaration: the name the reader gave, under every language the platform supports, and no
 * permissions of its own. The edition adds the entry permission itself and, on the first publication, grants it to the
 * author.
 */
export function newDeclaration(name: string): ApplicationDeclaration {
  return {
    names: Object.fromEntries(workbenchLanguage().supported.map((locale) => [locale, name])),
    descriptions: {},
    icon: APP_ICON,
    groups: [],
    permissions: [],
  };
}

/**
 * The declaration the application already has in the catalog, to publish another version or roll back under it: a later
 * publication keeps the application's own name, so renaming the workspace never renames the application.
 */
export function catalogDeclaration(app: CatalogApplication): ApplicationDeclaration {
  return { names: app.names, descriptions: app.descriptions, icon: app.icon, groups: [], permissions: [] };
}

/** The application's name as the rail shows it in this language. */
export const applicationName = (app: CatalogApplication, locale: string) => app.names[locale] ?? app.names.en!;

/** A commit with files to publish: every commit but the workspace's first, which is made empty. */
export const publishable = (commit: WorkspaceCommit) => commit.parentIds.length > 0;
