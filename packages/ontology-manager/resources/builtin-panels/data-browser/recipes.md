# 对象浏览器（`builtin-product-data-browser`）

挂在应用 `browser` 的 `/browser/data`（外框 `builtin-product-platform-frame`）。页头提供模式切换（实例图谱 / 表格）、表格模式下的「配置呈现」弹窗与刷新。

## 公开状态
- `viewMode`（深链，默认 `"graph"`）：`"graph"`（实例图谱）或 `"table"`（表格）。
- `selectedClass`（深链，`platform:ObjectType`）：表格模式当前选中的对象类型；旧深链 `/browser/data/<className>` 会重定向至 `/browser/data?selectedClass=<className>&viewMode=table`。
- `selectedNode`（`@any`）：实例图谱当前选中的实例节点，用于右侧非阻塞属性速览。
- `graphStart`（`@any`）：实例图谱进入一跳邻域探索时的中心节点；为空时显示采样总览。
- `search`（深链，字符串）：表格模式关键词搜索。
- `graphQuery`（字符串）：实例图谱高亮及 `instanceGraphSearch` 搜索关键词。
- `positions`（按人持久化的 `json`）：实例图谱节点拖拽位置，由 `InstanceGraph` 双向同步，不使用 `localStorage`。
- `expandedNodes` / `visibleRelationKinds` / `neighborFilter`：实例图谱展开节点、可见关系与双向邻域筛选状态（方向、邻居类型、关系类型、`fitAfterExpand`）。
- `filters` / `sort`（`json`）：表格模式服务端多条件筛选（9 种操作符）与排序，直接下推至 `platform:ObjectType.instances`。
- 表格页码 `page` 与每页条数 `size` 仅由 `ObjectList` 本地维护，不进入公开状态。

## 成员与能力
- 实例图谱模式：`instanceGraph`（`InstanceGraph`，`fitMode: "fit"`、`expandOn: "activate"`、`showHint: true`，绑定 `instanceGraphOverview`、`instanceGraphConnections`、`instanceGraphStatistics`、`instanceNeighbors`、`selectedGroup`、`neighborFilter` 与 `positions`）、`graphSearchClassPicker`（`instanceGraphClasses` + `metaField: "instanceCount"`） / `graphSearchResults`（`instanceGraphSearch`）、右侧邻域筛选表单、`nodeHeader` / `nodeSummary`（`instanceRecord`，`density: "compact"`）；页头展示采样/加载统计与截断/部分失败说明弹窗；支持跳转到对象详情 `/browser/views?selected=<className>~<primaryKey>` 与展开邻域。
- 表格模式：`classPicker`（`platform:ObjectType.list`）、`instanceTable`（`ObjectList`，`dynamicColumns: true`、`showColumnToggle: true`、`exportable: true`、`showRowIndex: true`、`pinPrimaryColumn: true`、`rowActivation: "dblclick"`、`showPageJumper: true`、`showRangeBar: true`）、服务端筛选与排序抽屉；单击高亮行，双击或点击主列链接打开对象详情 `/browser/views?selected=<className>~<primaryKey>`。
- 配置呈现弹窗：当前类 `detailBinding.canConfigure` 为真时开放，复用 `detailBindingSummary`、`detailPanelForm`（`platform:ObjectType.saveDetailPanel`）、`clearDetailPanel`（`objectTypes.clearDetailPanel`）与跳转 `/ontology/panels`。
