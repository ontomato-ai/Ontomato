import assert from "node:assert/strict";
import test from "node:test";
import {
  chartFileSchema, fillChartFile, legacyChartToFile, validateChartFile,
  type ChartFile, type ChartOption, type ChartRow, type FilledChart, type LegacyChartSpec,
} from "./index";
import { chartAxisBounds, chartBrandColors } from "../chart-presentation";
import { dashboardFormatSchema, dashboardPresentationSchema } from "../dashboard";

const map = { resource: "china-provinces", available: true, coordinateSystem: "GCJ-02", resourceCoordinateSystem: "GCJ-02", regionsMatched: true };
function make(input: LegacyChartSpec): ChartFile {
  const result = legacyChartToFile(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.file;
}
function fill(file: ChartFile, rows: ChartRow[], extraColumns: string[] = []): FilledChart {
  const columns = [...new Set([...file.dataset[0].dimensions, ...extraColumns])].map(key => ({ key }));
  const result = fillChartFile(file, { columns, rows });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
const cases: { type: string; fields: LegacyChartSpec["fields"]; native: string[]; extra?: Partial<LegacyChartSpec> }[] = [
  ...["bar", "pictorial-bar"].map(type => ({ type, fields: { xAxis: "category", yAxis: "amount" }, native: ["bar"] })),
  ...["line", "area-line"].map(type => ({ type, fields: { xAxis: "category", yAxis: "amount" }, native: ["line"] })),
  { type: "bar-line", fields: { xAxis: "category", barSeries: ["amount", "cost"], lineSeries: "ratio" }, native: ["bar", "bar", "line"] },
  ...["pie", "donut", "nightingale-rose"].map(type => ({ type, fields: { name: "category", value: "amount", share: "share" }, native: ["pie"] })),
  { type: "funnel", fields: { name: "category", value: "amount" }, native: ["funnel"] },
  { type: "treemap", fields: { name: "category", value: "amount" }, native: ["treemap"] },
  { type: "sunburst", fields: { id: "id", parent: "parent", name: "category", value: "amount" }, native: ["sunburst"] },
  { type: "sankey", fields: { source: "from", target: "to", value: "amount" }, native: ["sankey"] },
  { type: "scatter", fields: { xAxis: "x", yAxis: "y", size: "size", name: "name" }, native: ["scatter"] },
  { type: "radar", fields: { name: "category", value: "amount" }, native: ["radar"] },
  { type: "boxplot", fields: { category: "category", min: "a", q1: "b", median: "c", q3: "d", max: "e" }, native: ["boxplot"] },
  ...["gauge", "liquid-fill"].map(type => ({ type, fields: { value: "amount" }, native: ["gauge"], extra: { display: { formats: { amount: { kind: "percent" as const, scale: 100 as const } } } } })),
  { type: "timeline", fields: { date: "date", name: "name", description: "description" }, native: ["line", "scatter"] },
  { type: "graph", fields: { nodes: "nodes", links: "links" }, native: ["graph"], extra: { graphInput: "object" } },
  { type: "network-graph", fields: { source: "from", target: "to" }, native: ["graph"], extra: { graphInput: "edges" } },
  ...["leaflet-map", "map"].map(type => ({ type, fields: { lng: "longitude", lat: "latitude", name: "name" }, native: ["scatter"], extra: { map } })),
  { type: "admin-choropleth-map", fields: { name: "province", value: "amount" }, native: ["map"], extra: { map } },
];
for (const entry of cases) test(`${entry.type} generates an empty-source file with the intended native series`, () => {
  const file = make({ type: entry.type, fields: entry.fields, ...entry.extra });
  assert.equal(chartFileSchema.safeParse(file).success, true);
  assert.deepEqual(file.dataset[0].source, []);
  assert.deepEqual(file.series.map(series => series.type), entry.native);
});

test("items preserves zero, null and metric-provided share without aggregation", () => {
  const file = make({ type: "treemap", fields: { name: "name", value: "value", share: "share" } });
  const rows = [{ name: "A", value: 0, share: 0 }, { name: "A", value: null, share: null }];
  const result = fill(file, rows);
  assert.deepEqual(result.option.series[0].data, rows);
  assert.deepEqual(file.dataset[0].source, []);
  assert.equal("ontomato" in result.option, false);
  assert.equal("itemStyle" in result.option.dataset[0].source[0], false);
});
test("tree preserves each node's own value and links parents independently of row order", () => {
  const file = make({ type: "sunburst", fields: { id: "id", parent: "parent", name: "name", value: "value" } });
  const result = fill(file, [{ id: "child", parent: "root", name: "C", value: 3 }, { id: "root", parent: null, name: "R", value: 10 }]);
  assert.equal(result.option.series[0].data[0].value, 10);
  assert.equal(result.option.series[0].data[0].children[0].value, 3);
});
test("invalid trees report duplicate identities, missing parents and cycles", () => {
  const file = make({ type: "sunburst", fields: { id: "id", parent: "parent", name: "name", value: "value" } });
  const samples = [
    [{ id: "a", parent: null, name: "a", value: 1 }, { id: "a", parent: null, name: "b", value: 2 }],
    [{ id: "a", parent: "missing", name: "a", value: 1 }],
    [{ id: "a", parent: "b", name: "a", value: 1 }, { id: "b", parent: "a", name: "b", value: 1 }],
  ];
  for (const rows of samples) {
    const result = fillChartFile(file, { columns: file.dataset[0].dimensions.map(key => ({ key })), rows });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_SHAPE_DATA");
  }
});
test("sankey deduplicates identities while retaining parallel links and their weights", () => {
  const file = make({ type: "sankey", fields: { source: "from", target: "to", value: "value" } });
  const result = fill(file, [{ from: "A", to: "B", value: 0 }, { from: "A", to: "B", value: 3 }]);
  assert.deepEqual(result.option.series[0].data, [{ name: "A" }, { name: "B" }]);
  assert.deepEqual(result.option.series[0].links.map((link: ChartOption) => link.value), [0, 3]);
});
test("radar uses final values and geometric headroom, and rejects unusable axes", () => {
  const file = make({ type: "radar", fields: { name: "name", value: "value" } });
  const result = fill(file, [{ name: "A", value: 10 }, { name: "B", value: 20 }]);
  assert.deepEqual(result.option.series[0].data[0].value, [10, 20]);
  assert.equal(result.option.radar.indicator[1].max, 23);
  for (const rows of [[{ name: "A", value: -1 }], [{ name: "", value: 1 }], [{ name: "A", value: null }]]) {
    const bad = fillChartFile(file, { columns: [{ key: "name" }, { key: "value" }], rows });
    assert.equal(bad.ok, false);
  }
  assert.deepEqual(fill(file, []).option.radar.indicator, []);
});
test("boxplot takes supplied quartiles verbatim rather than deriving statistics", () => {
  const file = make({ type: "boxplot", fields: { category: "name", min: "a", q1: "b", median: "c", q3: "d", max: "e" } });
  const result = fill(file, [{ name: "A", a: 0, b: 2, c: 3, d: 7, e: 10 }]);
  assert.deepEqual(result.option.xAxis.data, ["A"]);
  assert.deepEqual(result.option.series[0].data, [[0, 2, 3, 7, 10]]);
});
test("single separates percent geometry from raw values and distinguishes empty, null and zero", () => {
  for (const [scale, raw] of [[100, 0.25], [1, 25]] as const) {
    const file = make({ type: "gauge", fields: { value: "value" }, display: { formats: { value: { kind: "percent", scale } } } });
    const result = fill(file, [{ value: raw }]);
    assert.equal(result.option.series[0].data[0].value, 0.25);
    assert.equal(result.option.series[0].data[0].rawValue, raw);
    assert.equal(result.presentation.display.formats?.value.scale, scale);
    assert.equal(fill(file, [{ value: 0 }]).option.series[0].progress.show, true);
    assert.equal(fill(file, [{ value: null }]).option.series[0].progress.show, false);
    assert.deepEqual(fill(file, []).option.series[0].data, []);
  }
});
test("timeline orders by descending date, retains tied event order and selects the latest events", () => {
  const file = make({ type: "timeline", fields: { date: "date", name: "name", description: "description" }, display: { displayLimit: 3 } });
  const rows = [
    { date: null, name: "undated", description: "d" }, { date: "2024-01-01", name: "old", description: "d" },
    { date: "2025-01-01", name: "first", description: "d" }, { date: "2025-01-01", name: "second", description: "d" },
    { date: "bad date", name: "invalid", description: "d" },
  ];
  const result = fill(file, rows);
  for (const series of result.option.series) assert.deepEqual(series.data.map((item: ChartOption) => item.name), ["first", "second", "old"]);
  assert.deepEqual(result.option.dataset[0].source.map((row: ChartRow) => row.name), ["first", "second", "old"]);
});
test("graph object input preserves isolated nodes, properties, weights and categories", () => {
  const file = make({ type: "graph", graphInput: "object", fields: { nodes: "nodes", links: "links" } });
  const result = fill(file, [{
    nodes: [{ id: "a", name: "A", category: "one", properties: { status: "ready" } }, { id: "b", name: "B", category: "two" }, { id: "c", name: "Isolated" }],
    links: [{ source: "a", target: "b", value: 7, relation: "uses" }],
  }]);
  assert.equal(result.option.series[0].data.length, 3);
  assert.deepEqual(result.option.series[0].data[0].properties, { status: "ready" });
  assert.deepEqual(result.option.series[0].categories, [{ name: "one" }, { name: "two" }]);
  assert.equal(result.option.series[0].links[0].value, 7);
});
test("graph edge input keeps parallel edges and endpoint metadata", () => {
  const file = make({ type: "graph", graphInput: "edges", fields: { source: "s", target: "t", value: "v", sourceName: "sn", targetName: "tn", relation: "r", sourceCategory: "sc", targetCategory: "tc" } });
  const rows = [{ s: "a", t: "b", v: 0, sn: "A", tn: "B", r: "r1", sc: "one", tc: "two" }, { s: "a", t: "b", v: 8, sn: "A", tn: "B", r: "r2", sc: "one", tc: "two" }];
  const result = fill(file, rows);
  assert.equal(result.option.series[0].data[0].name, "A");
  assert.deepEqual(result.option.series[0].links.map((link: ChartOption) => link.value), [0, 8]);
});
test("all encode, binding and display references participate in missing-column diagnostics", () => {
  const file = make({ type: "treemap", fields: { name: "name", value: "value" }, display: { sort: [{ field: "rank", order: "asc" }], formats: { money: { kind: "currency", currency: "USD" } } } });
  file.series.push({ id: "native", type: "bar", datasetId: "metric", encode: { x: "name", y: "encoded" } });
  file.dataset[0].dimensions.push("encoded");
  const result = validateChartFile(file, [{ key: "name" }]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "CARD_OUTPUT_MISMATCH");
    assert.deepEqual(new Set(result.missingColumns), new Set(["value", "encoded", "rank", "money"]));
  }
});
test("display sort is stable, keeps nulls last in both directions and cuts all series consistently", () => {
  for (const order of ["asc", "desc"] as const) {
    const file = make({ type: "treemap", fields: { name: "name", value: "value" }, display: { sort: [{ field: "value", order }], displayLimit: 3 } });
    const rows = [{ name: "null", value: null }, { name: "a", value: 2 }, { name: "b", value: 2 }, { name: "c", value: 1 }];
    const result = fill(file, rows);
    const expected = order === "asc" ? ["c", "a", "b"] : ["a", "b", "c"];
    assert.deepEqual(result.option.dataset[0].source.map((row: ChartRow) => row.name), expected);
    assert.deepEqual(result.option.series[0].data.map((row: ChartRow) => row.name), expected);
    assert.equal(rows[0].name, "null");
  }
});
test("scatter geometry spans 6–40px without modifying dataset values; constant sizes use 14px", () => {
  const file = make({ type: "scatter", fields: { xAxis: "x", yAxis: "y", size: "size" } });
  const result = fill(file, [{ x: 1, y: 2, size: 100 }, { x: 3, y: 4, size: 200 }]);
  assert.equal(result.option.visualMap.min, 100);
  assert.equal(result.option.visualMap.max, 200);
  assert.deepEqual(result.option.visualMap.inRange.symbolSize, [6, 40]);
  assert.equal(result.option.dataset[0].source[1].size, 200);
  assert.deepEqual(fill(file, [{ x: 1, y: 2, size: 100 }]).option.visualMap.inRange.symbolSize, [14, 14]);
});
test("native multi-series mapping preserves labels, separate axes and area geometry", () => {
  const file = make({ type: "bar-line", fields: { xAxis: "x", barSeries: ["a", "b"], lineSeries: "ratio" }, seriesNames: { a: "Amount", ratio: "Rate" }, axisNames: { y: "Money", y2: "Percent" } });
  assert.equal(file.series[0].name, "Amount");
  assert.equal(file.series[2].name, "Rate");
  assert.equal(file.series[2].yAxisIndex, 1);
  assert.equal(file.yAxis[1].name, "Percent");
  assert.ok(make({ type: "area-line", fields: { xAxis: "x", yAxis: ["a", "b"] } }).series[1].areaStyle);
  assert.deepEqual(make({ type: "donut", fields: { name: "n", value: "v" } }).series[0].radius, ["42%", "76%"]);
  assert.equal(make({ type: "nightingale-rose", fields: { name: "n", value: "v" } }).series[0].roseType, "radius");
});
test("unconvertible configurations are diagnosed rather than guessed", () => {
  const base: LegacyChartSpec = { type: "bar", fields: { xAxis: "x", yAxis: "y" } };
  const cases: [LegacyChartSpec, string][] = [
    [{ ...base, type: "unknown" }, "UNSUPPORTED_CHART_TYPE"],
    [{ ...base, fields: { xAxis: "x" } }, "MISSING_FIELDS"],
    [{ ...base, fields: { xAxis: ["x"], yAxis: "y" } }, "INVALID_FIELD_MAPPING"],
    [{ type: "boxplot", fields: { category: "n", min: "a", max: "b" } }, "MISSING_QUARTILE_COLUMNS"],
    [{ ...base, display: { formats: { y: { kind: "percent" } } } }, "PERCENT_SCALE_REQUIRED"],
    [{ ...base, provenance: { kind: "custom-skill" } }, "CUSTOM_SKILL"],
    [{ ...base, provenance: { kind: "custom-script" } }, "CUSTOM_SCRIPT"],
    [{ ...base, provenance: { kind: "html" } }, "HTML_ONLY"],
    [{ ...base, provenance: { multipleDataSources: true } }, "MULTIPLE_DATA_SOURCES"],
    [{ ...base, provenance: { businessAggregation: true } }, "BUSINESS_AGGREGATION_REQUIRED"],
    [{ type: "graph", fields: { source: "s", target: "t" } }, "GRAPH_INPUT_REQUIRED"],
    [{ type: "graph", fields: { source: "s", target: "t" }, graphInput: "edges", provenance: { graphCallbacks: ["custom-click"] } }, "CUSTOM_GRAPH_CALLBACK"],
    [{ type: "map", fields: { lng: "x", lat: "y", name: "n" } }, "MAP_RESOURCE_MISSING"],
    [{ type: "map", fields: { lng: "x", lat: "y", name: "n" }, map: { ...map, coordinateSystem: "WGS-84" } }, "MAP_COORDINATE_MISMATCH"],
    [{ type: "admin-choropleth-map", fields: { name: "n", value: "v" }, map: { ...map, regionsMatched: false } }, "MAP_REGION_MISMATCH"],
  ];
  for (const [input, code] of cases) {
    const result = legacyChartToFile(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, code);
  }
});
test("chart boundary rejects executable options, misplaced data and dangling bindings", () => {
  const file = make({ type: "bar", fields: { xAxis: "x", yAxis: "y" } });
  for (const bad of [
    { ...file, series: [{ ...file.series[0], data: [1] }] },
    { ...file, series: [{ ...file.series[0], label: { formatter: "{b}: {c}" } }] },
    { ...file, series: [{ ...file.series[0], label: { formatter: () => "bad" } }] },
    { ...file, series: [{ ...file.series[0], type: "custom" }] },
    { ...file, dataset: [{ ...file.dataset[0], source: [{ x: "a" }] }] },
    { ...file, dataset: [{ ...file.dataset[0], transform: { type: "filter" } }] },
    { ...file, ontomato: { bindings: [{ seriesId: "missing", shape: "items", fields: { name: "x", value: "y" } }] } },
  ]) assert.equal(validateChartFile(bad).ok, false);
});
test("metric boundary rejects absent row fields, undeclared fields and non-JSON values", () => {
  const file = make({ type: "bar", fields: { xAxis: "x", yAxis: "y" } });
  for (const rows of [[{ x: "a" }], [{ x: "a", y: 1, extra: 2 }], [{ x: "a", y: NaN }]]) {
    const result = fillChartFile(file, { columns: [{ key: "x" }, { key: "y" }], rows });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_METRIC_OUTPUT");
  }
});
test("truncation passes through unchanged and current rows replace a previous snapshot", () => {
  const file = make({ type: "bar", fields: { xAxis: "x", yAxis: "y" } });
  file.dataset[0].source = [{ x: "old", y: 99 }];
  const truncation = { truncated: true, rowLimit: 3, truncationHint: "source limit" };
  const result = fillChartFile(file, { columns: [{ key: "x" }, { key: "y" }], rows: [{ x: "new", y: 0 }], truncation });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.truncation, truncation);
    assert.equal(result.option.dataset[0].source[0].y, 0);
  }
});
test("filled options can use the shared brand and axis functions without mutating business rows", () => {
  const file = make({ type: "bar", fields: { xAxis: "x", yAxis: "y" } });
  const option = fill(file, [{ x: "category", y: 3 }]).option;
  const presented = chartAxisBounds(chartBrandColors(option, { color: ["red", "blue"] }), 300);
  assert.deepEqual(presented.dataset[0].source, [{ x: "category", y: 3 }]);
  assert.equal(presented.series[0].itemStyle.color, "red");
  assert.ok(presented.xAxis.axisLabel.width > 0);
});
test("dashboard uses the same display contract and explicit percentage scale", () => {
  assert.equal(dashboardPresentationSchema.safeParse({ name: "Card", sort: [{ field: "x", order: "asc" }], formats: { y: { kind: "percent", scale: 100 } } }).success, true);
  assert.equal(dashboardFormatSchema.safeParse({ kind: "percent" }).success, false);
});

test("column names in metadata are literal names even when they match an option key", () => {
  const file = make({ type: "bar", fields: { xAxis: "formatter", yAxis: "renderer" }, display: { formats: { renderer: { kind: "number" } } } });
  assert.equal(validateChartFile(file).ok, true);
});

test("standard object-view graph labels, groups and weights become native fields without losing zero", () => {
  const file = make({ type: "graph", graphInput: "object", fields: { nodes: "nodes", links: "edges" } });
  const rows = [{ nodes: [{ id: "a", label: "Alpha", group: "one" }, { id: "b", label: "Beta", group: "two" }], edges: [{ source: "a", target: "b", label: "uses", weight: 0 }] }];
  const result = fill(file, rows);
  assert.equal(result.option.series[0].data[0].name, "Alpha");
  assert.deepEqual(result.option.series[0].categories, [{ name: "one" }, { name: "two" }]);
  assert.equal(result.option.series[0].links[0].relation, "uses");
  assert.equal(result.option.series[0].links[0].value, 0);
  assert.equal("label" in result.option.series[0].data[0], false);
  assert.equal(result.option.dataset[0].source[0].nodes[0].label, "Alpha");
});
test("conflicting graph attributes fail instead of selecting a display meaning", () => {
  const file = make({ type: "graph", graphInput: "object", fields: { nodes: "nodes", links: "links" } });
  const result = fillChartFile(file, { columns: [{ key: "nodes" }, { key: "links" }], rows: [{ nodes: [{ id: "a", name: "A", label: "B" }], links: [] }] });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "INVALID_SHAPE_DATA");
    assert.equal(result.issues[0].reason, "CONFLICTING_GRAPH_NAME");
  }
});
