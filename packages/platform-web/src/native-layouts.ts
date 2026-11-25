import { managerPaths } from "@ontomato/ontology-manager";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { panelUsePath } from "@ontomato/contracts/panel-host";
import { applicationRootPath, isPanelApplication } from "@ontomato/contracts/platform-identity";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import type { AppPartition } from "./partition";
export type NativeLayout = Pick<AppPartition, "sections" | "foot" | "home" | "homePage" | "homePermission" | "entryHome" | "open" | "descriptionKey">;
const layouts: readonly (NativeLayout & { renderer: string })[] = [
  { renderer: "personal-workspace", sections: [] },
  // The platform's home draws its own page: no column, no header of the shell's.
  { renderer: "home", sections: [] },
  // An application whose pages are panels: it has no pages of its own to list, because every one of them is a use
  // relation the panel shows full.
  { renderer: "panels", sections: [] },
  {
    renderer: "ontology",
    // Four layers organize existing screens; cross-application entries keep their original routes and permissions.
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
        // entry the ontology manager declares.
        paths: [
          "/ontology/components", "/ontology/projections", "/ontology/panels", "/ontology/applications",
          platformRoutes.ontologyAgents.path,
        ],
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
    // Operations diagnosis runs inside the shared platform frame: one menu lists remaining native pages and migrated
    // panel entries together. Observers open on turn evidence; readers with user feedback alone open on feedback.
    home: platformRoutes.turn.path,
    homePermission: "observer",
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
    renderer: "app-builder",
    // Its column is its own (the workspaces and their conversations), drawn inside the application, like the agents'.
    sections: [],
  },
  {
    renderer: "dashboards",
    sections: [{ key: "dashboards:all", titleKey: "assistant.featureDashboards", paths: [platformRoutes.dashboards.path] }],
  },
];

export const nativeLayouts: Record<string, NativeLayout> = Object.fromEntries(layouts.map(({ renderer, ...layout }) => [renderer, layout]));

export function catalogPartition(applications: import("@ontomato/contracts/platform-identity").CatalogApplication[], locale: string,
  renderers: Record<string, NativeLayout> = {}): AppPartition[] {
  return applications.filter(app => app.kind === "hosted" || app.kind === "connected" || app.kind === "product"
    || Boolean(nativeLayouts[app.entry.renderer!] || renderers[app.entry.renderer!])
    || Boolean(app.panelUses?.length)).map((app) => {
    const embedded = app.kind === "hosted" || app.kind === "connected";
    const panels = isPanelApplication(app);
    const applicationRoute = embedded || panels;
    const hasLegacyLayout = Boolean(nativeLayouts[app.entry.renderer!] || renderers[app.entry.renderer!]);
    // A native application's panel entries stand where its menu table lists their addresses.
    const entries = !panels && !embedded ? new Map(app.panelUses?.flatMap(use => use.names ? [[panelUsePath(use.path), {
      id: panelUsePath(use.path),
      label: localizedApplicationText(use.names, locale) ?? use.pageKey,
      ...(use.icon ? { icon: use.icon } : {}),
    }] as const] : []) ?? []) : undefined;
    // Panel applications and catalog-driven built-ins draw navigation through their frame panel, never the shell.
    const layout: NativeLayout = applicationRoute || app.kind === "product" || !hasLegacyLayout ? { sections: [] } : {
      ...nativeLayouts[app.entry.renderer!], ...renderers[app.entry.renderer!],
      sections: renderers[app.entry.renderer!]?.sections ?? nativeLayouts[app.entry.renderer!]?.sections ?? [],
    };
    const orderedUses = app.groups?.length
      ? [
          ...[...app.groups].sort((left, right) => left.sort - right.sort).flatMap(group =>
            (app.panelUses ?? []).filter(use => use.groupKey === group.key),
          ),
          ...(app.panelUses ?? []).filter(use => !use.groupKey || !app.groups!.some(group => group.key === use.groupKey)),
        ]
      : (app.panelUses ?? []);
    const firstPanelUse = orderedUses.find(use => Boolean(use.names)) ?? orderedUses[0];
    const entryHome = layout.entryHome
      ? (app.panelUses?.some(use => panelUsePath(use.path) === layout.entryHome) ? layout.entryHome : undefined)
      : (!applicationRoute && !hasLegacyLayout && firstPanelUse ? panelUsePath(firstPanelUse.path) : undefined);
    return { ...layout, entryHome, entries, id: app.id, label: localizedApplicationText(app.names, locale) ?? app.id, description: app.descriptions[locale] ?? ("descriptionKey" in layout && layout.descriptionKey ? undefined : localizedApplicationText(app.descriptions, locale) ?? null), icon: app.icon, rail: app.rail, category: app.category,
      allowStandalone: app.allowStandalone,
      framePanelId: app.framePanelId,
      built: (app.kind === "hosted" || app.kind === "product") && (!!app.releaseId || panels),
      prefix: applicationRoute ? applicationRootPath(app.id) : app.kind==='product'?`/products/${app.id}`:app.entry.path,
      home: applicationRoute ? applicationRootPath(app.id) : app.kind==='product'?app.entry.path:app.entry.home ?? layout.home ?? (firstPanelUse ? panelUsePath(firstPanelUse.path) : undefined) };
  });
}
