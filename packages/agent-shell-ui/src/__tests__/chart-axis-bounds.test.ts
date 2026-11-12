import { expect, it } from "vitest";
import { chartAxisBounds } from "@ontomato/contracts/chart-presentation";

it("keeps axis names inside a grid that contains its labels, without touching the caller's option", () => {
  const source = { grid: { containLabel: true, right: 20 }, xAxis: { name: "Stored type" }, yAxis: {}, series: [{ type: "bar" }] };
  expect(chartAxisBounds(source, 560).grid).toEqual({ right: 20, outerBoundsMode: "same", outerBoundsContain: "all" });
  expect(source.grid).toEqual({ containLabel: true, right: 20 });
});

it("starts a titled chart's grid below the title and leaves an unset top to ECharts", () => {
  const titled = { title: { text: "Bodies", subtext: "by type" }, xAxis: {}, yAxis: { name: "Count" } };
  expect(chartAxisBounds({ ...titled, grid: { top: "5%" } }, 320).grid).toEqual({ top: 64 });
  expect(chartAxisBounds({ ...titled, grid: [{ top: 80 }] }, 320).grid).toEqual([{ top: 80 }]);
  expect(chartAxisBounds({ ...titled, grid: {} }, 320).grid).toEqual({});
});

it("leaves charts without axes as they are", () => {
  const pie = { title: { text: "Share" }, grid: { containLabel: true }, series: [{ type: "pie" }] };
  expect(chartAxisBounds(pie, 320)).toBe(pie);
});
