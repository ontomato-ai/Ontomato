import { describe, expect, it } from "vitest";
import { workbenchFeatures } from "../features";
import { ONTOLOGY_MANAGER_PATH } from "../../../config/app";

const t = (key: string) => key;

/** DESIGN.md "Applications and shells": the Agent Platform links to the Ontology Service from its function area. */
describe("workbench function area", () => {
  it("ends with the Ontology Service, a new-tab link to the Manager page", () => {
    const features = workbenchFeatures(t, [], false, true);
    expect(features.at(-1)).toEqual({
      id: "ontology-service",
      label: "assistant.featureOntologyService",
      icon: "ontology",
      availability: "link",
      href: ONTOLOGY_MANAGER_PATH,
    });
    expect(ONTOLOGY_MANAGER_PATH.endsWith("/ontology-manager/")).toBe(true);
  });

  it("keeps the existing order around the edition's entries", () => {
    const graph = { id: "graph", label: "Graph", icon: "graph", availability: "action" as const };
    expect(workbenchFeatures(t, [graph], true, true).map((feature) => feature.id)).toEqual([
      "dashboards",
      "graph",
      "agent-config",
      "schedule",
      "ontology-service",
    ]);
  });

  it("leaves the Ontology Service out when the app's access hides it", () => {
    expect(workbenchFeatures(t, [], true, false).map((feature) => feature.id)).not.toContain("ontology-service");
  });
});
