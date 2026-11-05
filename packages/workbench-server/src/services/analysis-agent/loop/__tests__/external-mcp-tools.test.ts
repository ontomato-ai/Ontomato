import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMcpTools: vi.fn(),
  callMcpTool: vi.fn(),
  listMcpServiceConfigs: vi.fn(),
}));

vi.mock("../../../mcp", () => ({
  listMcpTools: mocks.listMcpTools,
  callMcpTool: mocks.callMcpTool,
}));
vi.mock("../../../mcp/service-config", () => ({
  listMcpServiceConfigs: mocks.listMcpServiceConfigs,
}));
vi.mock("../../../../logging/logger", () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));
vi.mock("../../../../i18n", () => ({ tApp: (key: string) => key }));

import { loadExternalMcpTools } from "../external-mcp-tools";

beforeEach(() => {
  vi.resetAllMocks();
});

it("keeps colliding Chinese service names unique and routes calls to the original services", async () => {
  mocks.listMcpServiceConfigs.mockResolvedValue([
    { name: "城市坐标", url: "http://coordinates/mcp" },
    { name: "统计计算", url: "http://statistics/mcp" },
  ]);
  mocks.listMcpTools.mockResolvedValue([{ name: "health_check" }]);
  mocks.callMcpTool.mockResolvedValue({ content: [] });
  const tools = await loadExternalMcpTools({
    selectedServiceNames: ["城市坐标", "统计计算", "城市坐标"],
    domainId: "test",
    trajectory: { start: vi.fn(() => "activity"), settle: vi.fn() },
  });

  expect(tools).toHaveLength(2);
  expect(new Set(tools.map(tool => tool.name)).size).toBe(2);
  await tools[0].execute("call-1", {});
  await tools[1].execute("call-2", {});
  expect(mocks.callMcpTool).toHaveBeenNthCalledWith(
    1, "http://coordinates/mcp", "health_check", {}, undefined, undefined
  );
  expect(mocks.callMcpTool).toHaveBeenNthCalledWith(
    2, "http://statistics/mcp", "health_check", {}, undefined, undefined
  );
});

it("handles collisions between normalized tool names and generated suffixes", async () => {
  mocks.listMcpServiceConfigs.mockResolvedValue([{ name: "service", url: "http://service/mcp" }]);
  mocks.listMcpTools.mockResolvedValue([
    { name: "a_b" }, { name: "a b" }, { name: "a_b__2" }, { name: "a_b" },
  ]);
  const tools = await loadExternalMcpTools({
    selectedServiceNames: ["service"],
    domainId: "test",
    trajectory: { start: vi.fn(() => "activity"), settle: vi.fn() },
  });
  expect(tools).toHaveLength(3);
  expect(new Set(tools.map(tool => tool.name)).size).toBe(3);
});
