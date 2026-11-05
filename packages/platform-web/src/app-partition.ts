import { managerPaths } from "@ontomato/ontology-manager";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import type { AppPartition } from "./partition";

/**
 * The platform's applications, in the order its rail lists them (DESIGN "Applications and shells").
 *
 * Each application names the pages it owns by address and the words its column uses. The addresses come from the route
 * table, the titles from the edition's message tree, and the ownership is the platform's decision: an application module
 * inherits the place it is shown in. Nothing here restates a page's permission, so the router guard stays the only
 * authority on what may be opened.
 */
export interface PartitionOptions {
  /**
   * An application the edition implements and declares itself, placed among the platform's own before the system
   * settings (the enterprise edition's permission centre). The platform cannot name it: the pages are the edition's.
   */
  own?: readonly AppPartition[];
  /** An external application the edition reaches through its own signed jump (the data governance platform). */
  external?: readonly AppPartition[];
}

const platformApps: readonly AppPartition[] = [
  {
    id: "agents",
    labelKey: "platform.agentPlatform",
    icon: "agents",
    prefix: "/agents",
    // The conversation is where the platform is entered; the dashboards and settings follow it in the column.
    home: platformRoutes.chat.path,
    panel: "conversation",
    // The agent settings page is the platform's own entry at the foot of the column.
    settings: { id: "agent-settings", labelKey: "assistant.featureAgents", icon: "agents" },
    sections: [
      {
        key: "agents:pages",
        titleKey: "platform.agentPlatform",
        paths: [platformRoutes.dashboards.path, platformRoutes.agents.path, platformRoutes.agentSchedules.path],
      },
    ],
  },
  {
    id: "operations",
    labelKey: "platform.operations",
    icon: "diagnosis",
    prefix: "/ops",
    panel: "conversation",
    // Choosing the model belongs to the diagnosis that uses it, not to the agent platform.
    // Choosing the model belongs to the diagnosis that runs on it: the entry opens the operations application's own page.
    settings: { id: "ops-model", labelKey: "ops.modelSettings", icon: "settings", path: platformRoutes.opsModel.path },
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
    id: "governance",
    labelKey: "platform.governance",
    icon: "knowledge",
    prefix: "/governance",
    panel: "conversation",
    sections: [
      {
        key: "governance:pages",
        titleKey: "platform.governance",
        // User feedback sits with the conversations it was given on.
        paths: [platformRoutes.feedback.path],
      },
    ],
  },
  {
    id: "browser",
    labelKey: "platform.objectBrowser",
    icon: "objects",
    prefix: "/browser",
    panel: "pages",
    sections: [
      {
        key: "browser:pages",
        titleKey: "platform.objectBrowser",
        // The graph and data browsing, in one application: both are ways to look at objects.
        paths: [platformRoutes.graph.path, platformRoutes.data.path],
      },
    ],
  },
  {
    id: "ontology",
    labelKey: "platform.ontologyManager",
    icon: "ontology",
    prefix: "/ontology",
    panel: "pages",
    sections: [
      {
        key: "ontology:model",
        titleKey: "nav.groupOntology",
        paths: [
          managerPaths.graph,
          managerPaths.objects,
          managerPaths.attributes,
          managerPaths.relations,
          managerPaths.actions,
          managerPaths.visualModeling,
        ],
      },
      {
        key: "ontology:assets",
        titleKey: "nav.groupAssets",
        // Scheduled tasks of functions are the platform's: one list for every kind of task.
        paths: [managerPaths.metrics, managerPaths.functions],
      },
      {
        key: "ontology:knowledge",
        titleKey: "nav.groupKnowledge",
        // Business knowledge stays with the ontology it describes.
        paths: [managerPaths.knowledge],
      },
    ],
  },
  {
    id: "schedules",
    labelKey: "platform.schedules",
    icon: "schedule",
    prefix: platformRoutes.schedules.path,
    panel: "pages",
    sections: [
      { key: "schedules:all", titleKey: "platform.schedules", paths: [platformRoutes.schedules.path] },
    ],
  },
  {
    id: "settings",
    labelKey: "platform.settings",
    icon: "settings",
    prefix: "/settings",
    panel: "pages",
    // The settings page is entered at its first tab; the address without one is not a page of its own.
    home: platformRoutes.usage.path,
    sections: [
      {
        key: "settings:platform",
        titleKey: "platform.settings",
        paths: [platformRoutes.models.path, platformRoutes.settings.path, platformRoutes.records.path],
      },
    ],
  },
];

/**
 * The applications of one edition, in rail order: the platform's own up to the scheduled tasks, the edition's own
 * applications, the system settings, and last the external applications.
 *
 * The settings application is the platform's last one and stays last: it holds the account's own configuration, which
 * nothing else is entered after. An external application carries no pages — the rail opens it in a new tab and never
 * makes it current.
 */
export function appPartition(options: PartitionOptions = {}): readonly AppPartition[] {
  const settings = platformApps.filter((app) => app.id === "settings");
  const platform = platformApps.filter((app) => app.id !== "settings");
  return [...platform, ...(options.own ?? []), ...settings, ...(options.external ?? [])];
}
