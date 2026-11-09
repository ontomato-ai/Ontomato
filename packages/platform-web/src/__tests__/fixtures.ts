import { applicationCatalogSchema, builtinApplicationSchema, type BuiltinApplication } from "@ontomato/contracts/platform-identity";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { workbenchApplications } from "../../../workbench-server/src/services/applications/builtins";
import { catalogPartition } from "../native-layouts";
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

export function readApplicationDeclarations(directory: string): BuiltinApplication[] {
  return readdirSync(directory).filter(file => file.endsWith(".json"))
    .map(file => builtinApplicationSchema.parse(JSON.parse(readFileSync(join(directory, file), "utf8"))));
}

export function catalogFixture(additional: BuiltinApplication[] = []) {
  const java = readApplicationDeclarations(join(__dirname, "../../../data-engine-core/src/main/resources/applications"));
  return applicationCatalogSchema.parse([...workbenchApplications, ...java, ...additional]
    .map(({ declaration, ...app }) => ({ ...app, ...declaration, releaseId: null }))
    .sort((a,b) => ["top","apps","bottom"].indexOf(a.rail) - ["top","apps","bottom"].indexOf(b.rail) || a.sort-b.sort || a.id.localeCompare(b.id)));
}
export function catalogPartitionFixture() { return catalogPartition(catalogFixture(), "en"); }
