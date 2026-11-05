import { describe, expect, it } from "vitest";
import { workbenchFeatures } from "../features";

const t = (key: string) => key;

/** A permission check that grants exactly these codes. */
const granting = (...granted: string[]) => (permission: string) => granted.includes(permission);

/**
 * DESIGN.md "Applications and shells": an application's column holds its own pages, shown by capability codes. Another
 * application is reached through the platform rail, so no entry here leaves this application.
 */
describe("the agent platform's column", () => {
  it("holds only its own pages: no entry opens another application", () => {
    const features = workbenchFeatures(t, [], granting("analysis-agent", "observer"));
    expect(features.map((feature) => feature.id)).not.toContain("ontology-service");
    expect(features.map((feature) => feature.id)).not.toContain("ops-diagnosis");
    // Every entry is a page of this application, not an action that leaves it.
    expect(features.every((feature) => feature.availability === "page")).toBe(true);
  });

  it("keeps the existing order around the edition's entries", () => {
    const graph = { id: "graph", label: "Graph", icon: "graph", availability: "page" as const };
    expect(workbenchFeatures(t, [graph], granting("analysis-agent")).map((feature) => feature.id)).toEqual([
      "dashboards",
      "graph",
      "agents",
      "schedule",
    ]);
  });

  it("shows agents with any one of its tabs' codes", () => {
    const ids = (...granted: string[]) => workbenchFeatures(t, [], granting(...granted)).map((feature) => feature.id);
    expect(ids("analysis-agent")).toEqual(["dashboards", "agents", "schedule"]);
    expect(ids("skill-management")).toEqual(["dashboards", "agents", "schedule"]);
    expect(ids("mcp-service")).toContain("agents");
    // Codes of the old console that no longer own an entry of the column.
    expect(ids("audit-logs", "system-config")).toEqual(["dashboards", "schedule"]);
  });
});
