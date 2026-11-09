import { describe, expect, it } from "vitest";
import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";
import {
  AgentLineupMismatchError,
  placeQaAgent,
  resolveLineupSortOrders,
} from "../agent-lineup";

function agent(id: string, sortOrder: number): AnalysisAgent {
  return {
    id,
    name: id,
    description: "",
    executionMode: "loop",
    reportDeliverableEnabled: true,
    summarizerPrompt: "",
    conclusionMakerPrompt: "",
    graphScope: { mode: "panorama" },
    isEnabled: true,
    sortOrder,
    createdAt: 1,
    updatedAt: 1,
  };
}

const ids = (entries: ReturnType<typeof placeQaAgent>) =>
  entries.map((entry) => (entry.kind === "qa" ? "qa" : entry.agent.id));

describe("agent lineup order", () => {
  it("puts Q&A first in a domain that never saved a lineup", () => {
    expect(ids(placeQaAgent([agent("a", 0), agent("b", 1)], null))).toEqual(["qa", "a", "b"]);
  });

  it("places Q&A in the same sort space as the agents, ahead of ties", () => {
    const agents = [agent("new", 0), agent("a", 0), agent("b", 2), agent("c", 3)];
    expect(ids(placeQaAgent(agents, 1))).toEqual(["new", "a", "qa", "b", "c"]);
    expect(ids(placeQaAgent(agents, 0))).toEqual(["qa", "new", "a", "b", "c"]);
    expect(ids(placeQaAgent(agents, 9))).toEqual(["new", "a", "b", "c", "qa"]);
  });

  it("round-trips a saved order through the sort orders it writes", () => {
    const saved = resolveLineupSortOrders(["b", "__qa__", "a"], ["a", "b"]);
    expect(saved).toEqual({
      qaSortOrder: 1,
      agentSortOrders: [
        { id: "b", sortOrder: 0 },
        { id: "a", sortOrder: 2 },
      ],
    });
    const reloaded = saved.agentSortOrders.map(({ id, sortOrder }) => agent(id, sortOrder));
    expect(ids(placeQaAgent(reloaded, saved.qaSortOrder))).toEqual(["b", "qa", "a"]);
  });

  it("rejects an order that drops, repeats or invents entries", () => {
    for (const order of [
      ["a", "b"],
      ["__qa__", "a"],
      ["__qa__", "a", "a", "b"],
      ["__qa__", "__qa__", "a", "b"],
      ["__qa__", "a", "x"],
    ]) {
      expect(() => resolveLineupSortOrders(order, ["a", "b"]), order.join()).toThrow(
        AgentLineupMismatchError
      );
    }
  });
});
