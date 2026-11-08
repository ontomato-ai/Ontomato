import { expect, it } from "vitest";
import { chartReadingLayout } from "../renderers/chart-layout";

it("moves a top legend away from the title and reserves plot space without changing the artifact", () => {
  const source = { title: { text: "Staff" }, legend: { top: 0 }, grid: { bottom: 20 }, series: [] };
  const result = chartReadingLayout(source);
  expect(result.legend[0]).toMatchObject({ bottom: 0, type: "scroll" });
  expect(result.legend[0].top).toBeUndefined();
  expect(result.grid[0].bottom).toBeGreaterThanOrEqual(52);
  expect(source.legend).toEqual({ top: 0 });
});

it("retains deliberately positioned bottom and vertical legends", () => {
  const source = { title: { text: "Staff" }, legend: [{ bottom: 10 }, { orient: "vertical", right: 0 }] };
  expect(chartReadingLayout(source).legend[0].bottom).toBe(10);
  expect(chartReadingLayout(source).legend[1]).toEqual(source.legend[1]);
});

it("reserves space for existing bottom legends and pie plots even without a title or explicit grid", () => {
  const result = chartReadingLayout({ legend: { bottom: 0 }, xAxis: {}, series: [{ type: "pie", radius: "70%", center: ["50%", "80%"] }] });
  expect(result.grid[0].bottom).toBeGreaterThanOrEqual(52);
  expect(result.series[0].bottom).toBe(result.grid[0].bottom);
  expect(result.series[0].center).toEqual(["50%", "50%"]);
});
