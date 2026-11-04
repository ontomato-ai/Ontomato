import { describe, expect, it } from "vitest";
import { workbenchFeatures } from "../features";
import { ONTOLOGY_MANAGER_PATH } from "../../../config/app";

const t = (key: string) => key;

/** A permission check that grants exactly these codes. */
const granting = (...granted: string[]) => (permission: string) => granted.includes(permission);

/**
 * DESIGN.md "Applications and shells": the function area holds the workbench's own pages, shown by capability codes, and
 * links to the Ontology Service in a new tab.
 */
describe("workbench function area", () => {
  it("ends with the Ontology Service, a new-tab link to the Manager page", () => {
    const features = workbenchFeatures(t, [], granting(), true);
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
    expect(workbenchFeatures(t, [graph], granting("analysis-agent", "observer"), true).map((feature) => feature.id)).toEqual([
      "dashboards",
      "graph",
      "agents",
      "ops-diagnosis",
      "schedule",
      "ontology-service",
    ]);
  });

  it("shows agents with any one of its tabs' codes and operations diagnosis with observer", () => {
    const ids = (...granted: string[]) => workbenchFeatures(t, [], granting(...granted), true).map((feature) => feature.id);
    // Any one code grants the agents entry; when both apply, agents comes before operations diagnosis.
    expect(ids("analysis-agent")).toEqual(["dashboards", "agents", "schedule", "ontology-service"]);
    expect(ids("skill-management")).toEqual(["dashboards", "agents", "schedule", "ontology-service"]);
    expect(ids("mcp-service")).toContain("agents");
    expect(ids("observer")).toEqual(["dashboards", "agents", "ops-diagnosis", "schedule", "ontology-service"]);
    // Codes of the old console that no longer own an entry of the function area.
    expect(ids("audit-logs", "system-config")).toEqual(["dashboards", "schedule", "ontology-service"]);
  });

  it("leaves the Ontology Service out when the app's access hides it", () => {
    expect(workbenchFeatures(t, [], granting("observer"), false).map((feature) => feature.id)).not.toContain(
      "ontology-service",
    );
  });
});
