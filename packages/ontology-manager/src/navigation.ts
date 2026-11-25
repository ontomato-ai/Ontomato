import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import type { Component } from "vue";
import {
  AlarmClock,
  AppWindow,
  BookOpen,
  Bot,
  Boxes,
  ChartColumn,
  Component as ComponentIcon,
  Layers,
  Link2,
  MousePointerClick,
  Network,
  PanelsTopLeft,
  Puzzle,
  Share2,
  SquareFunction,
  Tags,
  Workflow as WorkflowIcon,
  GitBranch,
} from "lucide-vue-next";

/** A navigation group of the Manager pages; the service shell lists it with the platform groups. */
export interface ManagerNavigationGroup {
  key: string;
  titleKey: string;
}

/** A navigation entry of the Manager pages, in the shape the service shell's navigation takes. */
export interface ManagerNavigationPage {
  path: string;
  titleKey: string;
  icon: Component;
  /** Permission codes that grant the page (any one of them); editions without permissions ignore them. */
  permissions: readonly string[];
  group: string;
  /**
   * The page draws the platform's page header itself, inside the Manager's frame, and carries that header's gutter. The
   * data browser does not: it is a page of the object browser, whose header and gutter the platform draws around it.
   */
  ownHeader: boolean;
}

/**
 * The look of a menu row where the Manager's menu lists a panel entry of the ontology application instead of a page: the
 * icon the page it replaced had. The entry's name and whether the reader may open it are the catalog's.
 */
export interface ManagerEntryRow {
  path: string;
  icon: Component;
}

/** Paths of the Manager pages; they are the hash addresses the Manager has always used. */
export const managerPaths = {
  graph: routes.playground.path,
  objects: routes.objects.path,
  attributes: routes.attributes.path,
  relations: routes.relations.path,
  actions: routes.actions.path,
  workflows: routes.workflows.path,
  capabilityMap: routes.capabilityMap.path,
  visualModeling: routes.modeling.path,
  dataBrowser: routes.data.path.split("/:")[0]!,
  metrics: routes.metrics.path,
  functions: routes.functions.path,
  triggers: routes.triggers.path,
  knowledge: routes.knowledge.path,
} as const;

export const managerGroups = {
  ontology: { key: "ontology", titleKey: "nav.groupOntology" },
  assets: { key: "assets", titleKey: "nav.groupAssets" },
  knowledge: { key: "knowledge", titleKey: "nav.groupKnowledge" },
} satisfies Record<string, ManagerNavigationGroup>;

/*
 * Permission codes: the menu permissions the platform registers for its ontology group. The graph, the model pages,
 * visual modeling and the smart assets follow `ontology-modeling` (the code the workbench used for the Manager and its
 * asset pages); workflows and triggers (`action-management`), the data browser and business knowledge have codes of
 * their own.
 */
const MODELING = ["ontology-modeling"];

function page(
  path: string,
  titleKey: string,
  icon: Component,
  group: string,
  permissions: readonly string[],
): ManagerNavigationPage {
  return { path, titleKey, icon, group, permissions, ownHeader: true };
}

const pages: readonly ManagerNavigationPage[] = [
  page(managerPaths.graph, "nav.ontologyGraph", Network, "ontology", MODELING),
  page(managerPaths.objects, "nav.objectTypes", Boxes, "ontology", MODELING),
  page(managerPaths.attributes, "nav.ontologyAttributes", Tags, "ontology", MODELING),
  page(managerPaths.relations, "nav.relationTypes", Link2, "ontology", MODELING),
  page(managerPaths.visualModeling, "nav.visualModeling", WorkflowIcon, "ontology", MODELING),
];

/**
 * The rows of the panel entries whose native pages are gone, with those pages' icons, and of the product layer's entries,
 * which never had a native page, with icons of their own. An entry at an address the Manager still lists a page for (the
 * graph, the relation types) takes that page's icon.
 */
const entries: readonly ManagerEntryRow[] = [
  { path: managerPaths.knowledge, icon: BookOpen },
  { path: managerPaths.metrics, icon: ChartColumn },
  { path: managerPaths.functions, icon: SquareFunction },
  { path: managerPaths.actions, icon: MousePointerClick },
  { path: managerPaths.workflows, icon: GitBranch },
  { path: managerPaths.triggers, icon: AlarmClock },
  { path: routes.ontologySkills.path, icon: Puzzle },
  { path: managerPaths.capabilityMap, icon: Share2 },
  { path: "/ontology/components", icon: ComponentIcon },
  { path: "/ontology/projections", icon: Layers },
  { path: "/ontology/panels", icon: PanelsTopLeft },
  { path: "/ontology/applications", icon: AppWindow },
  { path: routes.ontologyAgents.path, icon: Bot },
];

/** The Manager's navigation entries in display order (ontology, assets, knowledge). */
export function managerNavigation() {
  return {
    groups: [managerGroups.ontology, managerGroups.assets, managerGroups.knowledge],
    pages: [...pages],
    entries: [...entries],
  };
}
