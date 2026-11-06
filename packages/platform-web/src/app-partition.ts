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
 *
 * The rail has three sections and no group names: the ontology applications, the business applications, and the
 * platform's own settings above the account. An application declares the section it sits in (`rail`), and this table is
 * the only place that decides it.
 */
export interface PartitionOptions {
  /**
   * An application the edition implements and declares itself, placed among the platform's own (the enterprise
   * edition's permission centre). The platform cannot name it: the pages are the edition's. Its `rail` decides the
   * section like any other application's.
   */
  own?: readonly AppPartition[];
  /** An external application the edition reaches through its own signed jump (the data governance platform). */
  external?: readonly AppPartition[];
}

const platformApps: readonly AppPartition[] = [
  {
    id: "ontology",
    labelKey: "platform.ontologyManager",
    icon: "ontology",
    rail: "top",
    prefix: "/ontology",
    // The manager keeps its own three groups: they are its menu, drawn in its own band inside the area.
    frame: "menu",
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
    id: "browser",
    labelKey: "platform.objectBrowser",
    descriptionKey: "platform.descriptions.objectBrowser",
    icon: "objects",
    rail: "top",
    prefix: "/browser",
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
    id: "agents",
    labelKey: "platform.agentPlatform",
    icon: "agents",
    rail: "apps",
    prefix: "/agents",
    // The conversation is where the platform is entered; the agent settings follow it in the column.
    home: platformRoutes.chat.path,
    // The column is the application's own: the conversation, its pages and the settings. Nothing of another application
    // is listed here, so this application has no page group of its own in the platform's table.
    sections: [],
  },
  {
    id: "operations",
    labelKey: "platform.operations",
    icon: "diagnosis",
    rail: "apps",
    prefix: "/ops",
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
    rail: "apps",
    prefix: "/governance",
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
    id: "dashboards",
    labelKey: "assistant.featureDashboards",
    icon: "dashboards",
    rail: "apps",
    prefix: platformRoutes.dashboards.path,
    sections: [{ key: "dashboards:all", titleKey: "assistant.featureDashboards", paths: [platformRoutes.dashboards.path] }],
  },
  {
    id: "schedules",
    labelKey: "platform.schedules",
    icon: "schedule",
    rail: "apps",
    prefix: platformRoutes.schedules.path,
    sections: [{ key: "schedules:all", titleKey: "platform.schedules", paths: [platformRoutes.schedules.path] }],
  },
  {
    id: "settings",
    labelKey: "platform.settings",
    descriptionKey: "platform.descriptions.settings",
    icon: "settings",
    rail: "bottom",
    prefix: "/settings",
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
 * The applications of one edition, in rail order: the platform's own, the edition's own applications, then the
 * platform's settings and last the external applications.
 *
 * The order is stable inside a section and the shell groups by `rail`; the edition's own applications and external ones
 * join the section they declare, so an edition that adds none draws no empty section.
 */
export function appPartition(options: PartitionOptions = {}): readonly AppPartition[] {
  const settings = platformApps.filter((app) => app.id === "settings");
  const platform = platformApps.filter((app) => app.id !== "settings");
  return [...platform, ...(options.own ?? []), ...settings, ...(options.external ?? [])];
}
