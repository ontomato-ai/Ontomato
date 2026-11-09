import { expect, it } from "vitest";
import { chartReadingLayout } from "../renderers/chart-layout";

it("centers a single inline donut across the full plot even without a legend", () => {
  const source = { series: [{ type: "pie", center: ["35%", "45%"], left: 20, width: "70%", radius: ["40%", "65%"] }] };
  const result = chartReadingLayout(source, 320, "inline");
  expect(result.series[0]).toMatchObject({ center: ["50%", "45%"], left: 0, right: 0, radius: ["40%", "65%"] });
  expect(result.series[0].width).toBeUndefined();
  expect(source.series[0]!.center).toEqual(["35%", "45%"]);
  expect(chartReadingLayout(source, 320, "panel")).toEqual(source);
});

it("preserves multiple inline pie positions", () => {
  const source = { series: [{ type: "pie", center: ["25%", "50%"] }, { type: "pie", center: ["75%", "50%"] }] };
  expect(chartReadingLayout(source, 320, "inline")).toEqual(source);
});

it("repositions an originally left vertical legend for a single inline donut", () => {
  const result = chartReadingLayout({ legend: { orient: "vertical", left: 0, top: 20, width: "90%" }, series: [{ type: "pie" }] }, 320, "inline");
  expect(result.legend[0]).toMatchObject({ orient: "horizontal", left: "center", top: null, right: null, width: "auto", bottom: 0 });
});

it("moves a top legend away from the title and reserves plot space without changing the artifact", () => {
  const source = { title: { text: "Staff" }, legend: { top: 0 }, grid: { bottom: 20 }, series: [] };
  const result = chartReadingLayout(source);
  expect(result.legend[0]).toMatchObject({ bottom: 0, type: "scroll" });
  expect(result.legend[0].top).toBeNull();
  expect(result.legend[0].left).toBe("center");
  expect(result.legend[0].width).toBe("auto");
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
