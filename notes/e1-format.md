# E1 chart file contract

Import `@ontomato/contracts/chart-data`. A `.chart.json` is a JSON ECharts option with exactly one `dataset: [{id:"metric", dimensions:[column names], source:[row objects]}]`. Saved reusable files have an empty source. MetricView identity belongs to the consumer. Series have stable `id`s; native series use `datasetId:"metric"` and named `encode`. No functions, callbacks, formatter templates, custom renderer/transform or business data outside the metric dataset. `ontomato` contains only `bindings` and `display`; it is removed before ECharts.

`display` owns `sort:[{field,order:"asc"|"desc"}]`, positive `displayLimit`, and `formats:{column:{kind,decimals?,scale?,currency?}}`. Percent requires `scale:100` for fractions (0.25 → 25%) or `scale:1` for percentage points (25 → 25%). Values remain unchanged; formatting belongs to presentation. Missing sort values stay last, ties retain input order.

Each binding has `seriesId`, `shape`, `fields` (column names only); graph additionally has `input:"object"|"edges"` as specified in design 8.2. Required roles below are plain column names; `?` denotes optional roles.

| shape | fields | native output |
| --- | --- | --- |
| items | name, value, share? | treemap data |
| tree | id, parent, name, value, share? | sunburst children; null parent is root |
| links | source, target, value | sankey nodes/links, no weight aggregation |
| radar | name, value | radar indicator and one value array; max × 1.15 |
| boxplot | category, min, q1, median, q3, max | category axis and five-value tuples |
| single | value | gauge ring geometry; original value retained for formatting |
| timeline | date, name, description | line/scatter on vertical categories; date descending, stable ties, undated last |
| graph / object | nodes, links | one row containing JSON arrays of standard nodes/links |
| graph / edges | source, target, value?, relation?, sourceName?, targetName?, sourceCategory?, targetCategory? | graph nodes/links/categories; degree affects size only |

Graph object arrays use native node `id/name/category` and link `source/target/value/relation` properties; extra JSON attributes are preserved, callbacks are rejected. Normalize old nested field names before producing that MetricView. Duplicate tree IDs, cycles, absent parents, invalid radar axes and invalid graph identities fail explicitly.

| old type | series / binding |
| --- | --- |
| bar, pictorial-bar | bar / none |
| line, area-line | line (areaStyle for area) / none |
| bar-line | bar + line with explicit yAxisIndex / none |
| pie, donut, nightingale-rose | pie (donut radius / roseType) / none |
| funnel | funnel / none |
| treemap, sunburst, sankey | treemap/items, sunburst/tree, sankey/links |
| scatter | scatter / none; visualMap size 6–40px (constant range: 14px) |
| radar, boxplot | radar/radar, boxplot/boxplot |
| gauge, liquid-fill | gauge/single (existing ring behavior) |
| timeline | line + scatter / timeline on both series |
| graph, network-graph | graph / graph with explicit input |
| leaflet-map, map | geo + scatter / none; fixed china-provinces map |
| admin-choropleth-map | map + visualMap / none |

`validateChartFile(unknown, columns?)` returns `{ok:true,file}` or `{ok:false,code,issues,missingColumns}`; missing encode/binding/display columns use `CARD_OUTPUT_MISMATCH`. `fillChartFile(unknown, {columns,rows,truncation?})` returns `{ok:true,option,presentation:{bindings,display},truncation,rowCount,displayedRowCount}` or a structured failure. It replaces source, materializes shapes, applies display ordering/limit consistently to dataset and shaped data, and removes `ontomato`; the presentation sidecar lets later fixed formatters use original values without inspecting stripped metadata. Truncation passes through unchanged. No DOM/ECharts runtime or business aggregation.

`legacyChartToFile({type,fields,display?,...})` returns `{ok:true,file}` (empty source) or `{ok:false,code,...}`. Roles use dashboard names (`xAxis/yAxis`, `barSeries/lineSeries`) for axis charts, binding names above for special shapes, `lng/lat/name/value?` for points, `name/value` for regions; graph requires `graphInput`. Optional series/axis labels are explicit settings. Map conversion requires declared matching resource, coordinate system and region coverage; no inferred offsets or resources.

Conversion reason codes: `UNSUPPORTED_CHART_TYPE`, `MISSING_FIELDS`, `INVALID_FIELD_MAPPING`, `MISSING_QUARTILE_COLUMNS`, `PERCENT_SCALE_REQUIRED`, `CUSTOM_SKILL`, `CUSTOM_SCRIPT`, `HTML_ONLY`, `CUSTOM_GRAPH_CALLBACK`, `MULTIPLE_DATA_SOURCES`, `BUSINESS_AGGREGATION_REQUIRED`, `GRAPH_INPUT_REQUIRED`, `MAP_RESOURCE_MISSING`, `MAP_COORDINATE_MISMATCH`, `MAP_REGION_MISMATCH`. Invalid runtime rows return `INVALID_METRIC_OUTPUT` / `INVALID_SHAPE_DATA`, with issues identifying rows/roles. These diagnoses require corrected MetricView/configuration or manual regeneration; no guessed conversion.
