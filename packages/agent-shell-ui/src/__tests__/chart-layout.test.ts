import { expect, it } from "vitest";
import { chartReadingLayout } from "../renderers/chart-layout";

it("centers a single inline donut across the full plot even without a legend", () => {
  const source = { series: [{ type: "pie", center: ["35%", "45%"], left: 20, width: "70%", radius: ["40%", "65%"] }] };
  const result = chartReadingLayout(source, 320, "inline");
  // Across the plot, at the vertical position the card gave it, and the caller's option left as it was.
  expect(result.series[0]).toMatchObject({ center: ["50%", "45%"] });
  expect(source.series[0]!.center).toEqual(["35%", "45%"]);
  expect(chartReadingLayout(source, 320, "panel")).toEqual(source);
});

it("preserves multiple inline pie positions", () => {
  const source = { series: [{ type: "pie", center: ["25%", "50%"] }, { type: "pie", center: ["75%", "50%"] }] };
  expect(chartReadingLayout(source, 320, "inline")).toEqual(source);
});

it("repositions an originally left vertical legend for a single inline donut", () => {
  const result = chartReadingLayout({ legend: { orient: "vertical", left: 0, top: 20, width: "90%" }, series: [{ type: "pie" }] }, 320, "inline");
  // The legend leaves the left side and sits horizontally under the donut.
  expect(result.legend[0]).toMatchObject({ orient: "horizontal", left: "center", bottom: 0 });
});

it("moves a top legend away from the title and reserves plot space without changing the artifact", () => {
  const source = { title: { text: "Staff" }, legend: { top: 0 }, grid: { bottom: 20 }, series: [] };
  const result = chartReadingLayout(source);
  // The legend moved below the plot, which reserves its own band above the axis, and the caller's option is untouched.
  expect(result.legend[0].bottom).toBe(0);
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
  // The pie stops above the legend's band instead of drawing over it.
  expect(result.series[0].bottom).toBe(result.grid[0].bottom);
});

it("cuts a long title to the drawn width and hides overlapping category labels, keeping the option's shape", () => {
  const source = { title: { text: "在职教职工人数（教学科研类单位/学院口径，前20）", left: "center" }, xAxis: { type: "category", data: ["a"] }, yAxis: { type: "value" } };
  const result = chartReadingLayout(source, 320, "inline", 330);
  expect(result.title).toMatchObject({ left: "center", textStyle: { width: 306, overflow: "truncate" } });
  expect(result.xAxis.axisLabel.hideOverlap).toBe(true);
  expect(result.yAxis).toEqual({ type: "value" });
  expect(chartReadingLayout({ ...source, xAxis: [{ data: ["a"], axisLabel: { hideOverlap: false } }] }, 320, "inline").xAxis[0].axisLabel.hideOverlap).toBe(false);
  expect(chartReadingLayout(source, 320, "inline").title).toEqual(source.title);
  // A forced interval would keep every label on a narrow column; spacing them out is left to ECharts.
  expect(chartReadingLayout({ xAxis: { type: "category", axisLabel: { interval: 0, rotate: 25 } } }).xAxis.axisLabel)
    .toMatchObject({ interval: "auto", rotate: 25, hideOverlap: true });
});
