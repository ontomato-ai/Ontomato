import { applicationCatalogSchema, builtinApplicationSchema, type BuiltinApplication } from "@ontomato/contracts/platform-identity";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { workbenchApplications } from "../../../workbench-server/src/services/applications/builtins";
import { catalogPartition, nativeLayouts } from "../native-layouts";
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
      category: "business",
      prefix: "/browser",
      sections: [
        { key: "browser:pages", titleKey: "platform.objectBrowser", paths: ["/ontology/playground", "/browser/data"] },
      ],
    },
    {
      id: "ontology",
      labelKey: "platform.ontologyManager",
      icon: "ontology",
      category: "build",
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

/** The built-in applications this repository ships, as Java declares them. */
export function builtinApplications(): BuiltinApplication[] {
  return readApplicationDeclarations(join(__dirname, "../../../data-engine-core/src/main/resources/applications"));
}

/**
 * Where the built-in applications' panel entries and their native menu tables disagree, for the native pages an edition
 * serves (big main's ruling, 2026-11-21): an entry with a menu name has a place in its own application's table, and every
 * address a table lists is a native page or an entry some built-in application declares — not both, not neither. A table
 * may list another application's entry (the ontology manager's business knowledge, which knowledge governance owns). `served` is the edition router's addresses; `own`
 * keeps to the listed addresses the edition is the one to judge (another edition's pages are its own run's).
 */
export function nativeEntryConflicts(
  served: ReadonlySet<string>, applications: readonly BuiltinApplication[], own: (path: string) => boolean = () => true,
): string[] {
  const conflicts: string[] = [];
  const declared = new Set(applications.flatMap((application) => (application.declaration.panelUses ?? []).map((use) => use.path)));
  for (const application of applications) {
    const layout = nativeLayouts[application.entry.renderer];
    if (!layout) continue;
    const listed = [...layout.sections.flatMap((section) => "paths" in section ? section.paths : []), ...(layout.foot ? [layout.foot] : [])]
      .filter((path) => !path.includes(":"));
    const uses = application.declaration.panelUses ?? [];
    for (const use of uses) {
      if (use.names && !listed.includes(use.path)) conflicts.push(`${application.id}: ${use.path} has a menu name but no place in its menu table`);
    }
    for (const path of listed.filter(own)) {
      const entry = declared.has(path);
      if (served.has(path) === entry) conflicts.push(`${application.id}: ${path} is ${entry ? "both a native page and a panel entry" : "neither a native page nor a panel entry"}`);
    }
  }
  return conflicts;
}
