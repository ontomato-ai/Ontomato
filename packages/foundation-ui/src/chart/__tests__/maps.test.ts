import { expect, it, vi } from "vitest";

const registerMap = vi.fn();
vi.mock("echarts/core", () => ({ registerMap: (name: string, json: unknown) => registerMap(name, json) }));

const { registerChartMaps } = await import("../maps");

// A map series draws the platform's own boundaries, fetched only when a chart draws that map and registered under the
// name the chart file states; a resource the platform does not bundle fails with its name instead of drawing nothing.
it("registers a bundled map once under the name the option states", async () => {
  const pending = registerChartMaps({ geo: { map: "china-provinces" }, series: [{ type: "map", map: "china-provinces" }] });
  await pending;
  expect(registerMap).toHaveBeenCalledTimes(1);
  expect(registerMap.mock.calls[0]![0]).toBe("china-provinces");
  // A second chart of the same map registers nothing more: ECharts already keeps those boundaries.
  await registerChartMaps({ series: [{ type: "map", map: "china-provinces" }] });
  expect(registerMap).toHaveBeenCalledTimes(1);
});

it("draws no map and asks for nothing when the option draws none", () => {
  expect(registerChartMaps({ series: [{ type: "bar" }] })).toBeNull();
});

it("fails with the resource's name when the platform does not bundle it", async () => {
  await expect(registerChartMaps({ series: [{ type: "map", map: "street-level" }] })).rejects.toThrow("street-level");
});
