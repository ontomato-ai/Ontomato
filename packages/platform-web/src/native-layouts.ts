import { managerPaths } from "@ontomato/ontology-manager";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import type { AppPartition } from "./partition";
export type NativeLayout = Pick<AppPartition, "sections" | "foot" | "frame" | "home" | "homePage" | "open" | "descriptionKey">;
const layouts: readonly (NativeLayout & { renderer: string })[] = [
  { renderer: "personal-workspace", sections: [] },
  // The platform's home draws its own page: no column, no header of the shell's.
  { renderer: "home", sections: [] },
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
        ],
      },
      {
        key: "ontology:capabilities",
        titleKey: "platform.layers.capabilities",
        // Scheduled tasks of functions are the platform's: one list for every kind of task.
        paths: [managerPaths.metrics, managerPaths.functions, managerPaths.actions, managerPaths.workflows, platformRoutes.ontologySkills.path],
      },
      {
        key: "ontology:governance",
        titleKey: "platform.layers.governance",
        // Business knowledge stays with the ontology it describes.
        paths: [managerPaths.knowledge, managerPaths.capabilityMap],
      },
      { key: "ontology:products", titleKey: "platform.layers.products", paths: [managerPaths.products] },
    ],
    // The models of the modeling agents, at the foot of the menu like every application's own settings.
    foot: platformRoutes.ontologyModels.path,
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
    renderer: "governance",
    home: platformRoutes.governance.path,
    homePage: managerPaths.knowledge,
    sections: [
      {
        key: "governance:pages",
        titleKey: "platform.governance",
        // User feedback sits with the conversations it was given on.
        paths: [platformRoutes.feedback.path],
      },
    ],
    // Drawn at the foot of the application's own column; listed here so an account that may open only it lands there.
    foot: platformRoutes.governanceModels.path,
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
      { key: "settings:models", titleKey: "platform.settingsGroups.models", paths: [platformRoutes.usage.path, platformRoutes.providers.path] },
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

export function catalogPartition(applications: import("@ontomato/contracts/platform-identity").CatalogApplication[], locale: string,
  renderers: Record<string, NativeLayout> = {}): AppPartition[] {
  return applications.filter(app => app.kind === "hosted" || app.kind === "connected"
    || Boolean(nativeLayouts[app.entry.renderer!] || renderers[app.entry.renderer!])).map((app) => {
    const embedded = app.kind === "hosted" || app.kind === "connected";
    // Catalog entries may precede their renderer or an edition's asynchronous layout registration.
    const layout: NativeLayout = embedded ? { sections: [] } : {
      ...nativeLayouts[app.entry.renderer!], ...renderers[app.entry.renderer!],
      sections: renderers[app.entry.renderer!]?.sections ?? nativeLayouts[app.entry.renderer!]?.sections ?? [],
    };
    return { ...layout, id: app.id, label: app.names[locale] ?? app.names.en!, description: app.descriptions[locale] ?? ("descriptionKey" in layout && layout.descriptionKey ? undefined : app.descriptions.en ?? null), icon: app.icon, rail: app.rail, category: app.category,
      prefix: embedded ? `/applications/${app.id}` : app.entry.path,
      home: embedded ? `/applications/${app.id}` : app.entry.home ?? layout.home };
  });
}
