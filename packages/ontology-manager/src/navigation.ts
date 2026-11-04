import type { Component } from "vue";
import {
  BookOpen,
  Boxes,
  ChartColumn,
  Clock3,
  Link2,
  MousePointerClick,
  Network,
  SquareFunction,
  Table2,
  Tags,
  Workflow,
} from "lucide-vue-next";
import type { ManagerCounts } from "./context";
import type { OntologyResourceCounts } from "./workspace";

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
  /** Manager pages render their own page header. */
  ownHeader: true;
  count?: () => number | null;
}

/** Paths of the Manager pages; they are the hash addresses the Manager has always used. */
export const managerPaths = {
  graph: "/playground",
  objects: "/objects",
  attributes: "/attributes",
  relations: "/relations",
  actions: "/assets/actions",
  visualModeling: "/visual-modeling",
  dataBrowser: "/data",
  metrics: "/assets/metrics",
  functions: "/assets/functions",
  tasks: "/assets/tasks",
  knowledge: "/knowledge",
} as const;

export const managerGroups = {
  ontology: { key: "ontology", titleKey: "nav.groupOntology" },
  assets: { key: "assets", titleKey: "nav.groupAssets" },
  knowledge: { key: "knowledge", titleKey: "nav.groupKnowledge" },
} satisfies Record<string, ManagerNavigationGroup>;

/*
 * Permission codes: the menu permissions the platform registers for its ontology group. The graph, the model pages,
 * visual modeling and the smart assets follow `ontology-modeling` (the code the workbench used for the Manager and its
 * asset pages); actions, the data browser and business knowledge have codes of their own.
 */
const MODELING = ["ontology-modeling"];

function page(
  path: string,
  titleKey: string,
  icon: Component,
  group: string,
  permissions: readonly string[],
  count?: keyof OntologyResourceCounts
) {
  return { path, titleKey, icon, group, permissions, ownHeader: true as const, count };
}

const pages = [
  page(managerPaths.graph, "nav.ontologyGraph", Network, "ontology", MODELING),
  page(managerPaths.objects, "nav.objectTypes", Boxes, "ontology", MODELING, "objects"),
  page(managerPaths.attributes, "nav.ontologyAttributes", Tags, "ontology", MODELING, "attributes"),
  page(managerPaths.relations, "nav.relationTypes", Link2, "ontology", MODELING, "relations"),
  page(managerPaths.actions, "nav.actionManagement", MousePointerClick, "ontology", ["action-management"], "actions"),
  page(managerPaths.visualModeling, "nav.visualModeling", Workflow, "ontology", MODELING),
  page(managerPaths.dataBrowser, "nav.dataBrowser", Table2, "ontology", ["data-browser"]),
  page(managerPaths.metrics, "nav.metrics", ChartColumn, "assets", MODELING, "metrics"),
  page(managerPaths.functions, "nav.functionDefinitions", SquareFunction, "assets", MODELING, "functions"),
  page(managerPaths.tasks, "nav.scheduledWriteTasks", Clock3, "assets", MODELING, "tasks"),
  page(managerPaths.knowledge, "nav.businessKnowledge", BookOpen, "knowledge", ["business-knowledge"]),
];

/**
 * The Manager's navigation entries in display order (ontology, assets, knowledge); the counts come from the page's
 * Manager counts.
 */
export function managerNavigation(counts: ManagerCounts) {
  return {
    groups: [managerGroups.ontology, managerGroups.assets, managerGroups.knowledge],
    pages: pages.map(({ count, ...entry }): ManagerNavigationPage =>
      count ? { ...entry, count: () => counts.values[count] } : entry
    ),
  };
}
