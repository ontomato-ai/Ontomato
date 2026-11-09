import { expect, it } from "vitest";
import { chartBrandColors } from "../renderers/chart-colors";

it("replaces generated categorical palettes and their explicit references without mutating the artifact", () => {
  const source = { color: ["red", "blue"], series: [{ type: "pie", data: [{ value: 2, itemStyle: { color: "red" } }, { value: 3, itemStyle: { color: "blue" } }] },
    { type: "line", color: ["orange"], lineStyle: { color: "orange" }, areaStyle: { color: "orange", opacity: 0.2 } }] };
  const result = chartBrandColors(source, { color: ["indigo", "teal"] });
  expect(result.color).toEqual(["indigo", "teal"]);
  expect(result.series[0].data.map((item: any) => item.itemStyle.color)).toEqual(["indigo", "teal"]);
  expect(result.series[1].lineStyle.color).toBe("teal");
  expect(result.series[1].areaStyle).toEqual({ color: "teal", opacity: 0.12 });
  expect(source.series[0]!.data![0]!.itemStyle.color).toBe("red");
});

it("uses primary for single-measure bars and coherent series colours for lines, areas and scatter", () => {
  const colors = ["indigo", "blue", "violet"];
  const source = { series: [
    { type: "bar", colorBy: "data", itemStyle: { color: { type: "linear", colorStops: [{ offset: 0, color: "orange" }] } }, data: [1, 2] },
    { type: "line", lineStyle: { color: "green" }, areaStyle: { color: "red" }, data: [2, 3] },
    { type: "scatter", itemStyle: { color: "yellow" }, data: [[1, 2]] },
  ] };
  const result = chartBrandColors(source, { color: colors });
  expect(result.series.map((series: any) => series.itemStyle.color)).toEqual(colors);
  expect(result.series.every((series: any) => series.colorBy === "series")).toBe(true);
  expect(result.series[1].lineStyle.color).toBe("blue");
  expect(result.series[1].areaStyle).toEqual({ color: "blue", opacity: 0.12 });
  expect(source.series[0]!.colorBy).toBe("data");
});

it("preserves semantic marks, visual maps and unsupported series", () => {
  const source = { color: ["blue"], visualMap: { inRange: { color: ["green", "red"] } },
    series: [{ type: "bar", data: [{ value: -1, itemStyle: { color: "red" } }] }, { type: "heatmap", itemStyle: { color: "blue" } }] };
  const result = chartBrandColors(source, { color: ["indigo"] });
  expect(result.visualMap).toEqual(source.visualMap);
  expect(result.series[0].data).toEqual(source.series[0]!.data);
  expect(result.series[1]).toEqual(source.series[1]);
  expect(chartBrandColors(source, {})).toBe(source);
});

it("covers nested category marks, graph categories and gauge defaults without replacing status bands", () => {
  const source = { color: ["old"], series: [
    { type: "treemap", data: [{ itemStyle: { color: "old" }, children: [{ itemStyle: { color: "old" } }] }] },
    { type: "graph", categories: [{ itemStyle: { color: "old" } }] },
    { type: "gauge", axisLine: { lineStyle: { color: [[0.5, "green"], [1, "red"]] } } },
  ] };
  const result = chartBrandColors(source, { color: ["indigo"] });
  expect(result.series[0].data[0].children[0].itemStyle.color).toBe("indigo");
  expect(result.series[1].categories[0].itemStyle.color).toBe("indigo");
  expect(result.series[2].progress.itemStyle.color).toBe("indigo");
  expect(result.series[2].pointer.itemStyle.color).toBe("indigo");
  expect(result.series[2].axisLine.lineStyle.color).toEqual([[0.5, "indigo"], [1, "indigo"]]);
});
