# 对象浏览器（`builtin-product-data-browser`）

挂在应用 `browser` 的 `/browser/data`（外框 `builtin-product-platform-frame`）。页头提供模式切换（实例图谱 / 表格）、表格模式下的「配置呈现」弹窗与刷新。

## 读哪一套本体
`dataSource` 决定这一页读哪一套投影，默认 `"business"`（客户业务实例）；`"platform"` 读平台四层本体的实例。两套投影都登记在这一页的 `projections.json` 里，成员按 `dataSource` 选中的投影读；能力图谱嵌入这一页时只传 `dataSource`。

四层本体没有统一的可筛属性表，也没有「配置呈现」这套读法：在 `"platform"` 下 `classAttributesProbe` 与 `detailBinding` 不挂载，「筛选与排序」按钮因此不出现（只剩搜索、列显隐、CSV 与分页），呈现配置入口也自动关闭。四层的实例搜索与实例表格没有快照版本，不发 `version`；表格的行只有在所属类型真有详情页时才带 `detailPath`。

## 公开状态
- `viewMode`（深链，默认 `"graph"`）：`"graph"`（实例图谱）或 `"table"`（表格）。
- `selectedClass`（深链，`platform:ObjectType` / `platform:OntologyType`）：表格模式当前选中的类型；地址里写作 `<类名>~<主键>`（如 `platform:ObjectType~Order`），旧深链 `/browser/data/<className>` 会重定向至 `/browser/data?selectedClass=platform:ObjectType~<className>&viewMode=table`。
- `selectedNode`（`@any`）：实例图谱当前选中的实例节点，用于右侧非阻塞属性速览。
- `graphStart`（`@any`）：实例图谱进入一跳邻域探索时的中心节点；为空时显示采样总览。
- `search`（深链，字符串）：表格模式关键词搜索。
- `graphQuery`（字符串）：实例图谱高亮及 `instanceGraphSearch` 搜索关键词。
- `positions`（按人持久化的 `json`）：实例图谱节点拖拽位置，由 `InstanceGraph` 双向同步，不使用 `localStorage`。
- `expandedNodes` / `visibleRelationKinds` / `neighborFilter`：实例图谱展开节点、可见关系与双向邻域筛选状态（方向、邻居类型、关系类型、`fitAfterExpand`）。
- `filters` / `sort`（`json`）：表格模式服务端多条件筛选（9 种操作符）与排序，直接下推至 `platform:ObjectType.instances`。
- 表格页码 `page` 与每页条数 `size` 仅由 `ObjectList` 本地维护，不进入公开状态。

## 成员与能力
- 实例图谱模式：`instanceGraph`（`InstanceGraph`，`fitMode: "fit"`、`expandOn: "activate"`、`showHint: true`；业务来源绑定 `instanceGraphOverview`、`instanceGraphConnections`、`instanceGraphStatistics`、`instanceNeighbors`，四层来源绑定 `start`、`counts`、`neighbors`，没有总览端口时从本人节点进入逐跳探索）、`graphSearchClassPicker`（业务 `instanceGraphClasses` + `metaField: "instanceCount"`；四层按层分组 + `metaField: "countDisplay"`）/ `graphSearchResults`（业务 `instanceGraphSearch`，四层 `instanceSearch`）、右侧邻域筛选表单、`nodeHeader` / `nodeSummary`（`instanceRecord`，`density: "compact"`）；页头展示采样/加载统计与截断/部分失败说明弹窗；「查看完整详情」只在 `nodeHeader` 出版了 `detailPath` 时出现。
- 表格模式：`classPicker`、`instanceTable`（`ObjectList.data.rows`，随来源读取 `platform:ObjectType.instances` 或 `platform:OntologyType.instances`；`dynamicColumns: true`、`showColumnToggle: true`、`exportable: true`、`showRowIndex: true`、`pinPrimaryColumn: true`、`rowActivation: "dblclick"`、`openOutput: "detailPath"`、`showRangeBar: true`）、服务端筛选与排序抽屉（业务来源）；单击只高亮行：双击带 `detailPath` 的行直接打开该地址，没有地址的行以它为起点切回图谱并展开邻域。
- 配置呈现弹窗：当前类 `detailBinding.canConfigure` 为真时开放，复用 `detailBindingSummary`、`detailPanelForm`（`platform:ObjectType.saveDetailPanel`）、`clearDetailPanel`（`objectTypes.clearDetailPanel`）与跳转 `/ontology/panels`。
