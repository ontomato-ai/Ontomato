import { expect, it } from "vitest";
import { prepareChart } from "../modules";

/*
 * A chart draws exactly as before whatever it draws: the common parts are there at once, and an option that needs any
 * other part has the whole library loaded before it is drawn. What these guard is the boundary between the two — a
 * series type or a setting outside the common parts must never be drawn without them.
 */

it("draws the common charts with the parts already there", () => {
  expect(prepareChart({
    dataset: [{ id: "metric", source: [] }], xAxis: { type: "category" }, yAxis: {}, grid: {}, tooltip: {}, legend: { type: "scroll" },
    visualMap: { type: "continuous", show: false }, color: ["#000"], textStyle: {}, animation: false,
    series: [{ type: "bar" }, { type: "line", areaStyle: {} }, { type: "pie", radius: ["40%", "70%"] }, { type: "scatter" }],
  })).toBeNull();
});

it.each([
  ["a series type outside them", { series: [{ type: "treemap" }] }],
  ["a map", { geo: { map: "china-provinces" }, series: [{ type: "scatter", coordinateSystem: "geo" }] }],
  ["a coordinate system outside them", { polar: {}, angleAxis: {}, radiusAxis: {}, series: [{ type: "bar", coordinateSystem: "polar" }] }],
  ["a setting it does not know", { toolbox: {}, series: [{ type: "bar" }] }],
  ["a zoom bar", { dataZoom: [{ type: "slider" }], series: [{ type: "line" }] }],
  ["a series setting another part draws", { series: [{ type: "line", markLine: { data: [{ type: "average" }] } }] }],
])("loads the whole library before drawing %s", async (_case, option) => {
  const pending = prepareChart(option);
  expect(pending).toBeInstanceOf(Promise);
  await pending;
});

it("draws the platform's own bar, line and pie charts, as filled for a panel, with the parts already there", async () => {
  const { fillChartPresentation } = await import("@ontomato/contracts/chart-presentation");
  const columns = [{ key: "region", label: "Region", type: "string" }, { key: "amount", label: "Amount", type: "number" }];
  const rows = [{ region: "east", amount: 12 }, { region: "west", amount: 7 }];
  const series = [
    { id: "bars", type: "bar", datasetId: "metric", encode: { x: "region", y: "amount" } },
    { id: "line", type: "line", datasetId: "metric", encode: { x: "region", y: "amount" }, areaStyle: {} },
  ];
  for (const file of [
    { xAxis: { type: "category" }, yAxis: { type: "value" }, series },
    { series: [{ id: "share", type: "pie", radius: ["40%", "70%"], datasetId: "metric", encode: { itemName: "region", value: "amount" } }] },
  ]) {
    const filled = fillChartPresentation({
      dataset: [{ id: "metric", dimensions: ["region", "amount"], source: [] }],
      ontomato: { display: { formats: { amount: { kind: "number" } } } }, ...file,
    }, { columns, rows }, {}, { height: 320, presentation: "panel", undated: "Undated" });
    expect(filled.ok).toBe(true);
    expect(filled.ok && prepareChart(filled.option as Record<string, unknown>)).toBeNull();
  }
});
