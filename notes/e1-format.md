# E1 图文件格式（供 E2–F 使用）

入口 `@ontomato/contracts/chart-data`。文件是 JSON ECharts option，加保留字段 `ontomato`；业务行只放 `dataset:[{id:"metric",dimensions:[列名],source:[行对象]}]`，复用时 source 为空。MetricView 引用由消费对象保存。series 有稳定 id；原生图声明 `datasetId:"metric"` 和列名 encode。禁止函数、脚本、renderer、自定义 transform、formatter 模板/表达式，以及另存 series.data/links/indicator。

`ontomato` 仅有 `bindings`、`display`。display = `{sort?:[{field,order:"asc"|"desc"}],displayLimit?:正整数,formats?:{列名:{kind,decimals?,scale?,currency?}}}`；沿用原仪表盘定义。百分比明确指定 scale：100 表示 0.25→25%，1 表示 25→25%；原数值不改。排序稳定，null 始终在后。

binding = `{seriesId,shape,fields}`；graph 另有 8.2 要求的 `input:"object"|"edges"`。以下角色值均为**列名**（不解释路径或代码），`?` 为可选：

| shape | fields | 装填 |
| --- | --- | --- |
| items | name,value,share? | treemap 平面项 |
| tree | id,parent,name,value,share? | null parent 为根，按 id 连 children |
| links | source,target,value | sankey 唯一端点、逐行 links，不合权重 |
| radar | name,value | 每行一轴、一个值数组，max×1.15 |
| boxplot | category,min,q1,median,q3,max | 类目轴、原样五值数组 |
| single | value | gauge 圆环几何；原值保留在 rawValue |
| timeline | date,name,description | line/scatter 纵向类目，日期倒序、同日稳定、无日期在后 |
| graph/object | nodes,links | 零/一行，两列为 JSON 数组；节点 id/name/category，边 source/target/value/relation |
| graph/edges | source,target,value?,relation?,sourceName?,targetName?,sourceCategory?,targetCategory? | 端点连 nodes/links/categories，度数只影响尺寸 |

graph/object 保留额外 JSON 属性；旧节点内的 label/group、边的 edges 等名称须在 MetricView 中明确规范成上述属性/列映射，不猜属性。标准邻接高亮与拖动由后续平台组件负责，外部回调不转换。

| 旧图型 | series / shape（空表示不写 bindings） |
| --- | --- |
| bar、pictorial-bar；line、area-line；bar-line | bar；line（面积加 areaStyle）；bar+line/显式双轴 / 空 |
| pie、donut、nightingale-rose；funnel；scatter | pie（donut 半径、roseType）；funnel；scatter+6–40px visualMap（常量为14px） / 空 |
| treemap；sunburst；sankey；radar；boxplot | treemap/items；sunburst/tree；sankey/links；radar/radar；boxplot/boxplot |
| gauge、liquid-fill；timeline；graph、network-graph | gauge/single（实际旧圆环）；line+scatter/timeline；graph/graph |
| leaflet-map、map；admin-choropleth-map | geo+scatter；map+visualMap / 空；固定 china-provinces，明确资源/坐标/地区匹配前提 |

`validateChartFile(unknown,columns?)` → `{ok:true,file}` 或 `{ok:false,code,issues,missingColumns}`。所需 encode/binding/display 列不在输出中时为 `CARD_OUTPUT_MISMATCH`，不修补。`fillChartFile(unknown,{columns,rows,truncation?})` → `{ok:true,option,presentation:{bindings,display},truncation,rowCount,displayedRowCount}` 或同类错误：替换 source→装填→display 排序/限行→去掉 ontomato；截断信息原样带出。presentation 供后续固定格式化函数使用（含 single 原值、timeline 原日期/说明），option 可交现有配色与轴函数。若限行截断树的必需父节点，明确报形状错误。

`legacyChartToFile({type,fields,display?,seriesNames?,axisNames?,graphInput?,graph?,map?,provenance?})` → `{ok:true,file}`（空 source）或 `{ok:false,code,fields?,details?}`。轴图角色 xAxis/yAxis（yAxis 可数组）、barSeries/lineSeries；其他见上表；点位 lng/lat/name/value?，行政区 name/value。对象视图图型枚举为 bar/line/donut/timeline/graph/leaflet-map，但技能选择器实际上列出本域全部技能，不能据此承诺自定义技能可转。

不可转换码：`UNSUPPORTED_CHART_TYPE`、`MISSING_FIELDS`、`INVALID_FIELD_MAPPING`、`MISSING_QUARTILE_COLUMNS`、`PERCENT_SCALE_REQUIRED`、`CUSTOM_SKILL`、`CUSTOM_SCRIPT`、`HTML_ONLY`、`CUSTOM_GRAPH_CALLBACK`、`MULTIPLE_DATA_SOURCES`、`BUSINESS_AGGREGATION_REQUIRED`、`GRAPH_INPUT_REQUIRED`、`MAP_RESOURCE_MISSING`、`MAP_COORDINATE_MISMATCH`、`MAP_REGION_MISMATCH`。运行时行/形状错误为 `INVALID_METRIC_OUTPUT` / `INVALID_SHAPE_DATA`，非法树、负值/空雷达轴、非法图身份均明确失败。配色、布局、坐标轴及文本格式化不在本模块。
