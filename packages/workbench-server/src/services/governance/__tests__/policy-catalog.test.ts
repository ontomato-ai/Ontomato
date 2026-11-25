import { describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const channelAgentsMock = vi.fn();

vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query: queryMock }),
  qualifiedTable: (name: string) => `public.${name}`,
}));

vi.mock("../../assistant/store", () => ({
  assistantStore: {
    channelAgents: (...args: unknown[]) => channelAgentsMock(...args),
  },
}));

import { loadPolicyWorkbenchCatalog } from "../policy-catalog";

describe("loadPolicyWorkbenchCatalog", () => {
  it("loads domain panels, projections, components, and all domain agents with localized labels", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "panel-b",
            definition: { content: { messages: { "zh-CN": { "panel.name": "审批面板" }, en: { "panel.name": "Approval" } } } },
          },
          {
            id: "panel-a",
            definition: { name: "Alpha Panel", description: "First" },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "proj-1",
            definition: { names: { "zh-CN": "订单投影", en: "Order Projection" }, description: "Orders" },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "domain-component:d1:badge",
            definition: { name: "Status Badge", description: "Custom badge" },
          },
        ],
      });

    channelAgentsMock.mockResolvedValueOnce([
      { id: "agent-sys-analysis", name: "Analysis Agent", description: "Builtin analysis" },
      { id: "agent-custom", name: "Teaching Assistant", description: "" },
    ]);

    const catalog = await loadPolicyWorkbenchCatalog("d1", "zh-CN");
    expect(catalog.panels).toEqual([
      { id: "panel-a", label: "Alpha Panel", description: "First" },
      { id: "panel-b", label: "审批面板" },
    ]);
    expect(catalog.projections).toEqual([
      { id: "proj-1", label: "订单投影", description: "Orders" },
    ]);
    expect(catalog.components).toEqual([
      { id: "domain-component:d1:badge", label: "Status Badge", description: "Custom badge" },
    ]);
    expect(catalog.agents).toEqual([
      { id: "agent-sys-analysis", label: "Analysis Agent", description: "Builtin analysis" },
      { id: "agent-custom", label: "Teaching Assistant" },
    ]);
    expect(channelAgentsMock).toHaveBeenCalledWith("d1");
  });
});
