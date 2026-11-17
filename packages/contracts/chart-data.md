# Chart data contract

Import `@ontomato/contracts/chart-data`. A `.chart.json` is a JSON ECharts option with reserved `ontomato` metadata. Business rows live only in `dataset: [{id:"metric", dimensions:[column names], source:[row objects]}]`; reusable files have an empty source. Stored consumers own the sole MetricView reference. Series have stable IDs; native dataset series declare `datasetId:"metric"` and column-name `encode` mappings. Functions, scripts, renderers, custom transforms, formatter templates/expressions and separately stored series data/links/indicators are forbidden.

## Display and bindings

`ontomato` contains `bindings`, `display`, and an optional conversation-only `metric` reference. Display settings are `{sort?:[{field,order:"asc"|"desc"}],displayLimit?:positive integer,formats?:{column:{kind,decimals?,scale?,currency?}}}` and retain the dashboard's existing meaning. Percent requires an explicit scale: `100` means `0.25 → 25%`; `1` means `25 → 25%`. Values remain unchanged. Sorting is stable and nulls stay last.

A binding is `{seriesId,shape,fields}`; graph also requires `input:"object"|"edges"`. Role values below are literal column names, never paths or code. `?` marks optional roles.

| Shape | Fields | Materialization |
| --- | --- | --- |
| items | name,value,share? | Flat treemap items |
| tree | id,parent,name,value,share? | Link children by ID; null parent denotes a root |
| links | source,target,value | Unique sankey endpoints and one link per row; no weight aggregation |
| radar | name,value | One axis per row, one value array, maximum × 1.15 |
| boxplot | category,min,q1,median,q3,max | Category axis and unchanged five-value arrays |
| single | value | Gauge geometry from percent ratio or raw numeric value; original value retained as rawValue |
| timeline | date,name,description | Line/scatter on vertical categories; descending dates, stable ties, undated last |
| graph/object | nodes,links | Zero/one row containing two JSON arrays: nodes id/name/category, links source/target/value/relation |
| graph/edges | source,target,value?,relation?,sourceName?,targetName?,sourceCategory?,targetCategory? | Native nodes/links/categories; degree affects node size only |

Graph object input preserves extra JSON attributes and supports the standard object-view mappings `label/group → name/category` on nodes and `label/weight → relation/value` on links. Conflicting native and standard attributes fail. String labels are never passed as ECharts label styles. An `edges` column is explicitly mapped through `fields.links`. The platform component owns standard adjacency highlighting and dragging; external callbacks are not converted.

## Legacy chart conversion

| Legacy types | Native series / shape (none means no bindings) |
| --- | --- |
| bar,pictorial-bar; line,area-line; bar-line | bar; line with areaStyle for area; bar+line with explicit separate axes / none |
| pie,donut,nightingale-rose; funnel; scatter | pie with donut radius or roseType; funnel; scatter with 6–40px visualMap (constant size: 14px) / none |
| treemap; sunburst; sankey; radar; boxplot | treemap/items; sunburst/tree; sankey/links; radar/radar; boxplot/boxplot |
| gauge,liquid-fill; timeline; graph,network-graph | gauge/single (existing ring behavior); line+scatter/timeline; graph/graph |
| leaflet-map,map; admin-choropleth-map | geo+scatter; map+visualMap / none; china-provinces with explicit resource/coordinate/region prerequisites |

`legacyChartToFile({type,fields,display?,seriesNames?,axisNames?,graphInput?,graph?,map?,provenance?})` returns `{ok:true,file}` with an empty source, or `{ok:false,code,fields?,details?}`. Axis roles are `xAxis/yAxis` (conversion also accepts multiple yAxis columns) or `barSeries/lineSeries`; other roles are listed above. Points use `lng/lat/name/value?`; regions use `name/value`. Object views currently enumerate bar/line/donut/timeline/graph/leaflet-map, but their skill selector lists every domain skill; that does not imply custom skills are convertible.

`chartInputs` is the shared role table, including `numeric`, `singleRow`, `arrays` and optional roles. Its `optionalArrays` identifies scalar roles that native conversion also accepts as multiple series; the current dashboard's scalar yAxis requirement remains unchanged. Graph's object/edges role variants share the same table. Dashboard types select entries by name rather than duplicating roles.

`chartMapResources` is the shared map-name-to-coordinate-system constant used by conversion and map registration. The map argument contains only `{resource,coordinateSystem,regionsMatched,featureNameProperty?}`: resource name, the data's coordinate system, region-match confirmation and an optional feature-name property. Resource availability and its coordinate system come from the constant.

## Validation and filling

`validateChartFile(unknown,columns?)` returns `{ok:true,file}` or `{ok:false,code,issues,missingColumns}`. Required encode/binding/display columns absent from the output produce `CARD_OUTPUT_MISMATCH`; nothing is repaired.

`fillChartFile(unknown,{columns,rows,truncation?})` returns `{ok:true,option,presentation:{bindings,display},truncation,rowCount,displayedRowCount}` or the same structured failure. After boundary validation, it selects display rows once: timeline date order first, then display sort and limit. It validates the selected rows' shapes, replaces the source, materializes once and removes `ontomato`. Truncation passes through unchanged. If selection removes a required tree parent, filling fails with a shape error. The presentation sidecar supports later fixed formatters, including single's raw value and timeline's original date/description. The option can pass directly through the existing brand-color and axis functions.

Conversion failure codes: `UNSUPPORTED_CHART_TYPE`, `MISSING_FIELDS`, `INVALID_FIELD_MAPPING`, `MISSING_QUARTILE_COLUMNS`, `PERCENT_SCALE_REQUIRED`, `CUSTOM_SKILL`, `CUSTOM_SCRIPT`, `HTML_ONLY`, `CUSTOM_GRAPH_CALLBACK`, `MULTIPLE_DATA_SOURCES`, `BUSINESS_AGGREGATION_REQUIRED`, `GRAPH_INPUT_REQUIRED`, `MAP_RESOURCE_MISSING`, `MAP_COORDINATE_MISMATCH`, `MAP_REGION_MISMATCH`. Runtime row/shape failures use `INVALID_METRIC_OUTPUT` / `INVALID_SHAPE_DATA`; invalid trees, negative/empty radar axes and invalid graph identities fail explicitly. Brand colors, layout, axis presentation and text formatting belong outside this module.

Single-value filling uses the explicit percent scale for ratio geometry, otherwise the original numeric value against the series min/max. Filling preserves the file's progress settings and retains rawValue for center text. Point coordinates and the bundled basemap are both WGS-84.

## Conversation artifacts and stored presentation

A conversation file may contain `ontomato.metric: {metricId: string, parameters: {[name]: JSON value}}` and the current dataset snapshot. The agent writes this reference; the system does not track artifact provenance. Ordinary `validateChartFile` validates its shape only. When adding or importing the chart, the caller checks that the MetricView exists, the current user may execute it, and its output columns satisfy `validateChartFile`.

`splitChartFileForStorage(unknown)` returns `{ok:true,file,metric}` or a structured chart failure. It clears the cloned file's metric source, removes `ontomato.metric`, and returns the extracted reference without changing the conversation artifact. The reference is undefined when absent; callers must obtain an explicit source rather than infer one.

Stored dashboard, ObjectView and MetricWidget charts contain presentation only. Their consumer owns the sole MetricView reference and parameters. `validateStoredChartFile(unknown,columns?)` and `storedChartFileSchema` reject nonempty sources or any embedded `ontomato.metric`; the function also performs the ordinary format/column checks. They reject invalid storage input instead of silently stripping it. Explicit splitting belongs to the import action.
