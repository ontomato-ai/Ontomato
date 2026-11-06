import { describe, expect, it } from "vitest";
import { workbenchFeatures } from "../features";

/**
 * DESIGN.md "Applications and shells": the agent platform's column holds a new conversation, its own pages and the recent
 * conversations, with its settings at the foot. The dashboards, the scheduled tasks and the graph are applications or
 * pages of their own now, so nothing of them is listed here; an edition adds only what it alone has.
 */
describe("the agent platform's column", () => {
  it("lists no page of its own in the open-source edition", () => {
    expect(workbenchFeatures([])).toEqual([]);
  });

  it("keeps the edition's entries, in the order the edition gives them", () => {
    const graph = { id: "graph", label: "Graph", icon: "graph", availability: "page" as const };
    const report = { id: "report", label: "Report", icon: "review", availability: "page" as const };
    expect(workbenchFeatures([graph, report]).map((feature) => feature.id)).toEqual(["graph", "report"]);
  });
});
