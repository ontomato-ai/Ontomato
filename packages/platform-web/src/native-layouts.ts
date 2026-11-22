import { managerPaths } from "@ontomato/ontology-manager";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { panelUsePath } from "@ontomato/contracts/panel-host";
import { applicationRootPath, isPanelApplication } from "@ontomato/contracts/platform-identity";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type { AppPartition } from "./partition";
export type NativeLayout = Pick<AppPartition, "sections" | "foot" | "frame" | "home" | "homePage" | "homePermission" | "entryHome" | "open" | "descriptionKey">;
const layouts: readonly (NativeLayout & { renderer: string })[] = [
  { renderer: "personal-workspace", sections: [] },
  // The platform's home draws its own page: no column, no header of the shell's.
  { renderer: "home", sections: [] },
  { renderer:"application-gallery",sections:[] },
  // An application whose pages are panels: it has no pages of its own to list, because every one of them is a use
  // relation the panel shows full.
  { renderer: "panels", sections: [] },
  {
    renderer: "ontology",
    // Four layers organize existing screens; cross-application entries keep their original routes and permissions.
    frame: "menu",
    sections: [
      {
        key: "ontology:facts",
        titleKey: "platform.layers.facts",
        paths: [
          managerPaths.graph,
          managerPaths.objects,
          managerPaths.attributes,
          managerPaths.relations,
          managerPaths.visualModeling,
          managerPaths.knowledge,
        ],
      },
      {
        key: "ontology:capabilities",
        titleKey: "platform.layers.capabilities",
        // Scheduled tasks of functions are the platform's: one list for every kind of task.
        paths: [managerPaths.metrics, managerPaths.functions, managerPaths.actions, managerPaths.workflows, managerPaths.triggers, platformRoutes.ontologySkills.path],
      },
      {
        key: "ontology:governance",
        titleKey: "platform.layers.governance",
        // The agent principals page is gone: agents are configured in the product layer's settings page.
        paths: [platformRoutes.members.path,platformRoutes.roles.path,platformRoutes.policies.path,platformRoutes.organization.path,managerPaths.capabilityMap],
      },
      {
        key: "ontology:products",
        titleKey: "platform.layers.products",
        // The product layer in its own order — base components, projections, panels, applications, agents — each a panel
        // entry the ontology manager declares. The old products catalogue stays until its page is taken out, before the
        // agents' settings: what a product page is given to run on.
        paths: [
          "/ontology/components", "/ontology/projections", "/ontology/panels", "/ontology/applications",
          managerPaths.products, platformRoutes.ontologyAgents.path,
        ],
      },
    ],
    // The models of the modeling agents, at the foot of the menu like every application's own settings.
  },
  {
    renderer: "browser",
    descriptionKey: "platform.descriptions.objectBrowser",
    sections: [
      {
        key: "browser:pages",
        titleKey: "platform.objectBrowser",
        // Instance graph and table are modes of one browser, not separate application tabs.
        paths: [platformRoutes.data.path],
      },
    ],
  },
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
    // Observers enter on turn evidence (its routes live in ObserveLayout rather than PlatformNavigation); a reader with
    // user feedback alone opens on it, and since it has no menu name the menu does not list it.
    home: platformRoutes.turn.path,
    homePermission: "observer",
    entryHome: platformRoutes.feedback.path,
    sections: [
      {
        key: "operations:pages",
        titleKey: "platform.operations",
        paths: [
          platformRoutes.turn.path,
          platformRoutes.test.path,
          platformRoutes.logs.path,
          platformRoutes.dsl.path,
          platformRoutes.opsKnowledge.path,
        ],
      },
    ],
  },
  {
    renderer: "app-builder",
    // Its column is its own (the workspaces and their conversations), drawn inside the application, like the agents'.
    sections: [],
  },
  {
    renderer: "dashboards",
    sections: [{ key: "dashboards:all", titleKey: "assistant.featureDashboards", paths: [platformRoutes.dashboards.path] }],
  },
  {
    renderer: "schedules",
    sections: [{ key: "schedules:all", titleKey: "platform.schedules", paths: [platformRoutes.schedules.path] }],
  },
  {
    renderer: "settings",
    // Its pages are its own menu, by group; an account enters at the first page it may open.
    frame: "menu",
    sections: [
      { key: "settings:models", titleKey: "platform.settingsGroups.models", paths: [platformRoutes.usage.path, platformRoutes.providers.path,platformRoutes.systemAgentModels.path] },
      // The licence is the enterprise edition's; the open-source navigation has no such page, so it is not listed.
      { key: "settings:system", titleKey: "platform.settingsGroups.system", paths: [platformRoutes.general.path, platformRoutes.license.path] },
      {
        key: "settings:connections",
        titleKey: "platform.settingsGroups.connections",
        paths: [platformRoutes.adapters.path, platformRoutes.externalMcp.path, platformRoutes.publishedMcp.path],
      },
      { key: "settings:records", titleKey: "platform.settingsGroups.records", paths: [platformRoutes.audit.path, platformRoutes.monitor.path] },
    ],
  },
];

export const nativeLayouts: Record<string, NativeLayout> = Object.fromEntries(layouts.map(({ renderer, ...layout }) => [renderer, layout]));

/** The count a declaring entry's row shows: the shell's reading of the read the entry declares (`entry-counts`). */
export type EntryCount = (applicationId: string, use: ApplicationPanelUse) => number | null;

export function catalogPartition(applications: import("@ontomato/contracts/platform-identity").CatalogApplication[], locale: string,
  renderers: Record<string, NativeLayout> = {}, entryCount: EntryCount = () => null): AppPartition[] {
  return applications.filter(app => app.kind === "hosted" || app.kind === "connected"||app.kind==='product'
    || Boolean(nativeLayouts[app.entry.renderer!] || renderers[app.entry.renderer!])).map((app) => {
    const embedded = app.kind === "hosted" || app.kind === "connected";
    const panels = isPanelApplication(app);
    const applicationRoute = embedded || panels;
    // Catalog entries may precede their renderer or an edition's asynchronous layout registration.
    // An entry's count is the one its declaration names, read as its page reads it, by the shell that draws the menu.
    const panelPages = panels ? app.panelUses?.flatMap(use => use.names ? [{
      id: panelUsePath(use.path),
      label: use.names[locale] ?? use.names.en!,
      ...use.count ? { count: entryCount(app.id, use) } : {},
    }] : []) ?? [] : [];
    // A native application's panel entries stand where its menu table lists their addresses.
    const entries = !panels && !embedded ? new Map(app.panelUses?.flatMap(use => use.names ? [[panelUsePath(use.path), {
      id: panelUsePath(use.path),
      label: use.names[locale] ?? use.names.en!,
      ...use.count ? { count: entryCount(app.id, use) } : {},
    }] as const] : []) ?? []) : undefined;
    const layout: NativeLayout = panelPages.length > 1
      ? { frame: "menu", sections: [{ key: app.id, pages: panelPages }] }
      : applicationRoute || app.kind === "product" ? { sections: [] } : {
      ...nativeLayouts[app.entry.renderer!], ...renderers[app.entry.renderer!],
      sections: renderers[app.entry.renderer!]?.sections ?? nativeLayouts[app.entry.renderer!]?.sections ?? [],
    };
    const entryHome = layout.entryHome && app.panelUses?.some(use => panelUsePath(use.path) === layout.entryHome)
      ? layout.entryHome : undefined;
    return { ...layout, entryHome, entries, id: app.id, label: app.names[locale] ?? app.names.en!, description: app.descriptions[locale] ?? ("descriptionKey" in layout && layout.descriptionKey ? undefined : app.descriptions.en ?? null), icon: app.icon, rail: app.rail, category: app.category,
      built: (app.kind === "hosted" || app.kind === "product") && (!!app.releaseId || panels),
      prefix: applicationRoute ? applicationRootPath(app.id) : app.kind==='product'?`/products/${app.id}`:app.entry.path,
      home: applicationRoute ? applicationRootPath(app.id) : app.kind==='product'?app.entry.path:app.entry.home ?? layout.home };
  });
}
