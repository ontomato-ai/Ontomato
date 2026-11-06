import { computed } from "vue";
import { BookOpen, Network, Table2 } from "lucide-vue-next";
import type { PlatformAccess, PlatformNavigation } from "@ontomato/platform-admin";
import type { AppPartition } from "../partition";

/**
 * A stand-in for the platform's navigation: a few pages of the Manager's groups, so the column's grouping and filtering
 * can be checked without mounting the ontology manager itself.
 */
export function generatedNavigation(): PlatformNavigation {
  return {
    groups: [
      { key: "ontology", titleKey: "nav.groupOntology" },
      { key: "knowledge", titleKey: "nav.groupKnowledge" },
    ],
    pages: [
      { path: "/ontology/playground", titleKey: "nav.ontologyGraph", icon: Network, permissions: ["ontology-modeling"], group: "ontology", ownHeader: true },
      { path: "/ontology/objects", titleKey: "nav.objectTypes", icon: Network, permissions: ["ontology-modeling"], group: "ontology", ownHeader: true },
      { path: "/browser/data", titleKey: "nav.dataBrowser", icon: Table2, permissions: ["data-browser"], group: "ontology", ownHeader: true },
      { path: "/ontology/knowledge", titleKey: "nav.businessKnowledge", icon: BookOpen, permissions: ["business-knowledge"], group: "knowledge", ownHeader: true },
    ],
  };
}

/** The platform's application table, cut down to the applications these pages belong to. */
export function partitionOf(): readonly AppPartition[] {
  return [
    {
      id: "browser",
      labelKey: "platform.objectBrowser",
      icon: "objects",
      prefix: "/browser",
      sections: [
        { key: "browser:pages", titleKey: "platform.objectBrowser", paths: ["/ontology/playground", "/browser/data"] },
      ],
    },
    {
      id: "ontology",
      labelKey: "platform.ontologyManager",
      icon: "ontology",
      prefix: "/ontology",
      sections: [
        { key: "ontology:model", titleKey: "nav.groupOntology", paths: ["/ontology/objects"] },
        { key: "ontology:knowledge", titleKey: "nav.groupKnowledge", paths: ["/ontology/knowledge"] },
      ],
    },
  ];
}

/** An access check that grants exactly the codes it is given. */
export function closedAccess(granted: readonly string[]): PlatformAccess {
  return { ready: true, error: null, can: (code) => granted.includes(code), load: () => Promise.resolve() };
}

/** A navigation as the host computes it, so a factory argument matches the production shape. */
export function navigationOf(navigation: PlatformNavigation) {
  return computed(() => navigation);
}
