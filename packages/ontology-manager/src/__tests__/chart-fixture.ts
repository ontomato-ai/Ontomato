import type { ChartFile } from "@ontomato/contracts/chart-data";
import type { ChartViewWidget } from "@ontomato/contracts/object-views";

/** A stored chart file: presentation only, its dataset declaring the columns it draws. */
export function chartFile(): ChartFile {
  return {
    dataset: [{ id: "metric", dimensions: ["kind", "amount"], source: [] }],
    xAxis: { type: "category" },
    yAxis: { type: "value" },
    series: [{ id: "series-0", type: "bar", datasetId: "metric", encode: { x: "kind", y: "amount" } }],
    ontomato: {},
  };
}

/** A view's chart widget: one MetricView, one file saved in this version and its parameter bindings. */
export function chartWidget(overrides: Partial<ChartViewWidget> = {}): ChartViewWidget {
  return { id: "chart", kind: "chart", title: "Chart", span: 6, height: 320, resourceId: "metric-1", chartFile: chartFile(), parameters: {}, ...overrides };
}
