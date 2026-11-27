import { platformRoutes } from "@ontomato/platform-shell/routes";
import { panelUsePath } from "@ontomato/contracts/panel-host";
import { applicationRootPath, isPanelApplication, isPlatformCatalogApplication, type CatalogApplication } from "@ontomato/contracts/platform-identity";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import type { AppPartition } from "./partition";

/**
 * First visible panel entry path of an application, ordered by its declared groups (named entries preferred).
 */
export function firstVisiblePanelPath(app: CatalogApplication): string | null {
  const uses = app.panelUses ?? [];
  if (uses.length === 0) return null;
  const ordered = app.groups?.length
    ? [
        ...[...app.groups].sort((left, right) => left.sort - right.sort).flatMap((group) =>
          uses.filter((use) => use.groupKey === group.key),
        ),
        ...uses.filter((use) => !use.groupKey || !app.groups!.some((group) => group.key === use.groupKey)),
      ]
    : uses;
  const first = ordered.find((use) => use.inMenu !== false) ?? ordered[0];
  return first ? panelUsePath(first.path) : null;
}
export type NativeLayout = Pick<AppPartition, "sections" | "foot" | "home" | "homePage" | "entryHome" | "open" | "descriptionKey">;
const layouts: readonly (NativeLayout & { renderer: string })[] = [
  { renderer: "personal-workspace", sections: [] },
  // The platform's home draws its own page: no column, no header of the shell's.
  { renderer: "home", sections: [] },
  // An application whose pages are panels: it has no pages of its own to list, because every one of them is a use
  // relation the panel shows full.
  { renderer: "panels", sections: [] },
  {
    renderer: "agents",
    // The conversation is where the platform is entered, by every member of the domain; the agent settings and the models
    // follow it at the foot of the column.
    home: platformRoutes.chat.path,
    // The column is the application's own: the conversation, its pages and the settings. Nothing of another application
    // is listed here, so this application has no page group of its own in the platform's table.
    sections: [],
  },
  {
    renderer: "operations",
    // Operations diagnosis runs inside the shared platform frame: one menu lists remaining native pages and migrated
    // panel entries together. Observers open on turn evidence; readers with user feedback alone open on feedback.
    home: platformRoutes.turn.path,
    entryHome: platformRoutes.feedback.path,
    sections: [
      {
        key: "operations:pages",
        paths: [
          platformRoutes.turn.path,
          platformRoutes.test.path,
          platformRoutes.results.path,
          platformRoutes.cases.path,
          platformRoutes.logs.path,
          platformRoutes.dsl.path,
          platformRoutes.opsKnowledge.path,
          platformRoutes.feedback.path,
        ],
      },
    ],
  },
  {
    renderer: "dashboards",
    sections: [{ key: "dashboards:all", titleKey: "assistant.featureDashboards", paths: [platformRoutes.dashboards.path] }],
  },
];

export const nativeLayouts: Record<string, NativeLayout> = Object.fromEntries(layouts.map(({ renderer, ...layout }) => [renderer, layout]));

export function catalogPartition(applications: import("@ontomato/contracts/platform-identity").CatalogApplication[], locale: string,
  renderers: Record<string, NativeLayout> = {}): AppPartition[] {
  return applications.filter(app => isPlatformCatalogApplication(app) && (app.kind === "connected" || isPanelApplication(app)
    || Boolean(nativeLayouts[app.entry.renderer!] || renderers[app.entry.renderer!])
    || Boolean(app.panelUses?.length)
    || Boolean(app.framePanelId))).map((app) => {
    const embedded = app.kind === "connected";
    const panels = isPanelApplication(app);
    const applicationRoute = embedded || panels;
    const hasLegacyLayout = Boolean(nativeLayouts[app.entry.renderer!] || renderers[app.entry.renderer!]);
    const detailLoaded = app.panelUses !== undefined;
    // Entry names, icons and menu placement are entry-table facts: use them only after the application's detail arrived.
    const entries = !panels && !embedded && detailLoaded ? new Map(app.panelUses?.flatMap(use => use.inMenu !== false ? [[panelUsePath(use.path), {
      id: panelUsePath(use.path),
      label: localizedApplicationText(use.names, locale)!,
      ...(use.icon ? { icon: use.icon } : {}),
    }] as const] : []) ?? []) : undefined;
    // Panel applications and catalog-driven built-ins draw navigation through their frame panel, never the shell.
    const layout: NativeLayout = applicationRoute || !hasLegacyLayout ? { sections: [] } : {
      ...nativeLayouts[app.entry.renderer!], ...renderers[app.entry.renderer!],
      sections: renderers[app.entry.renderer!]?.sections ?? nativeLayouts[app.entry.renderer!]?.sections ?? [],
    };
    const firstPanelPath = detailLoaded ? firstVisiblePanelPath(app) : null;
    const declaredHome = app.entry.home ?? layout.home;
    const admittedHome = app.entry.home ?? (layout.home && app.entryPaths?.some(path => panelUsePath(path) === layout.home)
      ? declaredHome : undefined);
    const entryHome = layout.entryHome
      ? (app.entryPaths?.some(path => panelUsePath(path) === layout.entryHome) ? layout.entryHome : undefined)
      : (!applicationRoute && !hasLegacyLayout && firstPanelPath ? firstPanelPath : undefined);
    return { ...layout, entryHome, entries, id: app.id, label: localizedApplicationText(app.names, locale) ?? app.id, description: app.descriptions[locale] ?? ("descriptionKey" in layout && layout.descriptionKey ? undefined : localizedApplicationText(app.descriptions, locale) ?? null), icon: app.icon, rail: app.rail, category: app.category,
      allowStandalone: app.allowStandalone,
      framePanelId: app.framePanelId,
      ...(app.singleEntry !== undefined ? { singleEntry: app.singleEntry } : {}),
      built: app.kind === "product" && panels,
      prefix: applicationRoute ? applicationRootPath(app.id) : app.entry.path,
      home: applicationRoute ? applicationRootPath(app.id) : admittedHome ?? firstPanelPath ?? app.entry.path };
  });
}
