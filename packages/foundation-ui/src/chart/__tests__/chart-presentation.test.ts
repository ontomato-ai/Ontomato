import { expect, it } from "vitest";
import { chartFormats, chartTickFormat, chartTimelineLabel, chartValueText } from "@ontomato/contracts/chart-presentation";
import { legacyChartToFile, type ChartFile } from "@ontomato/contracts/chart-data";

// The platform writes a value the way the metric's own format states; the value itself never changes.
it("writes numbers, percentages, currencies, dates and text in the metric's formats", () => {
  expect(chartValueText(1234.5, { kind: "number" })).toBe((1234.5).toLocaleString());
  expect(chartValueText(1234.5, { kind: "number", decimals: 1 })).toBe((1234.5).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  // A percentage states its scale: 100 means the value is a fraction, 1 means it is already a percentage.
  expect(chartValueText(0.25, { kind: "percent", scale: 100 })).toBe("25%");
  expect(chartValueText(25, { kind: "percent", scale: 1 })).toBe("25%");
  expect(chartValueText(25, { kind: "currency", currency: "CNY", decimals: 0 })).toContain("25");
  expect(chartValueText("2024-03-05", { kind: "date" })).toBe(new Date("2024-03-05").toLocaleDateString());
  expect(chartValueText("未分类", { kind: "text" })).toBe("未分类");
  expect(chartValueText(null)).toBe("—");
  expect(chartValueText(null, { kind: "number" })).toBe("—");
  expect(chartValueText("plain")).toBe("plain");
});

// Ticks are axis positions: they keep the kind and the scale but not the fixed decimals.
it("writes tick positions without the format's fixed decimals", () => {
  expect(chartTickFormat({ kind: "number", decimals: 0 })).toEqual({ kind: "number" });
  expect(chartValueText(0.5, chartTickFormat({ kind: "percent", scale: 100, decimals: 0 }))).toBe("50%");
});

// A timeline event reads its date, its name over at most two lines and its description; an undated event says so.
it("writes a timeline event's date, name and description, saying so when the date is missing", () => {
  expect(chartTimelineLabel({ date: "2024-03-05T08:00:00Z", name: "Review", description: "Signed off" }, "Undated")).toEqual(["2024-03-05", "Review", "Signed off"]);
  expect(chartTimelineLabel({ date: null, name: "Review", description: "" }, "未提供日期")).toEqual(["未提供日期", "Review"]);
  expect(chartTimelineLabel({ date: "", name: "x".repeat(60) }, "Undated")).toEqual(["Undated", "x".repeat(24), "x".repeat(24)]);
});

function axisFile(): ChartFile {
  const converted = legacyChartToFile({
    type: "bar",
    fields: { xAxis: "kind", yAxis: "amount" },
    display: { formats: { amount: { kind: "percent", scale: 100 } } },
  });
  if (!converted.ok) throw new Error(converted.code);
  return converted.file;
}

// The formats reach the axis labels and the tooltip; nothing else about the option changes.
it("applies the metric's formats to a measure's axis ticks and tooltip", () => {
  const file = axisFile();
  const option = {
    dataset: [{ id: "metric", dimensions: ["kind", "amount"], source: [] }],
    xAxis: { type: "category" },
    yAxis: { type: "value" },
    tooltip: { trigger: "axis" },
    series: [{ id: "series-0", type: "bar", datasetId: "metric", encode: { x: "kind", y: "amount" }, name: "Share" }],
  };
  const result = chartFormats(option, { bindings: file.ontomato.bindings ?? [], display: file.ontomato.display ?? {} });
  expect(result.yAxis.axisLabel.formatter(0.25)).toBe("25%");
  expect(result.series[0].tooltip.valueFormatter(0.25)).toBe("25%");
  expect(result.xAxis.axisLabel).toBeUndefined();
  expect((option.series[0] as { tooltip?: unknown }).tooltip).toBeUndefined();
});

// A gauge's centre reads the value the metric gave, not the ring's ratio; a pie's label carries its value and share.
it("reads a single's own value and an item's value and share", () => {
  const gauge = legacyChartToFile({ type: "gauge", fields: { value: "rate" }, display: { formats: { rate: { kind: "percent", scale: 1 } } } });
  if (!gauge.ok) throw new Error(gauge.code);
  const gaugeOption = chartFormats(
    { series: [{ id: "main", type: "gauge", detail: { show: true }, data: [{ value: 0.42, rawValue: 42, name: "rate" }] }] },
    { bindings: gauge.file.ontomato.bindings ?? [], display: gauge.file.ontomato.display ?? {} },
  );
  expect(gaugeOption.series[0].detail.formatter({ data: { value: 0.42, rawValue: 42 } })).toBe("42%");

  const pie = legacyChartToFile({
    type: "pie",
    fields: { name: "kind", value: "amount", share: "share" },
    display: { formats: { amount: { kind: "number", decimals: 0 }, share: { kind: "percent", scale: 100 } } },
  });
  if (!pie.ok) throw new Error(pie.code);
  const pieOption = chartFormats(
    { series: pie.file.series.map((series) => ({ ...series, data: [{ name: "甲", value: 20, share: 0.5 }] })) },
    { bindings: pie.file.ontomato.bindings ?? [], display: pie.file.ontomato.display ?? {} },
  );
  expect(pieOption.series[0].tooltip.formatter({ name: "甲", value: 20, data: { value: 20, share: 0.5 } })).toBe("甲<br/>20 · 50%");
});
