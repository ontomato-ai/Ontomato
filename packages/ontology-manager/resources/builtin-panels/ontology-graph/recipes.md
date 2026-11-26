# 本体图谱页的常见做法

这一页全部由平台官方投影组装：页头统计（`ObjectCount`）、左栏资源列表（`ObjectList`）、中间共用图谱画布（`OntologyTypeGraph`，本体类型图的固定画法：62px 节点、13px 名字、力导排布、5px 白描边，导出用页面底色并落成 `ontology-graph-{date}.png`）、右栏路径选择器（`ReferencePicker`）与元素详情（`ObjectHeader`、`TypedValue`、`ObjectRefCard`、`ObjectSummary`、`ObjectList`）。画布工具条在画布左下角：放大、缩小、适应画布、重新布局、下载 PNG；也支持滚轮缩放。

## 读哪一套本体

`dataSource` 决定这一页读哪一套投影，默认 `"business"`（客户业务本体）；`"platform"` 读平台四层本体（23 类类型、44 种关系种类，画布按 `layerId` 分色并可点图例按层显隐，推导关系画虚线）。两套投影都登记在这一页的 `projections.json` 里，成员按 `dataSource` 选中的投影读；能力图谱嵌入这一页时只传 `dataSource`，不传任何投影编号。

四层本体没有独立的属性实体，也没有详情页配置的读法：在 `"platform"` 下页头不显示属性数，右栏的属性平面换成公开属性、具名读法与可用操作三块；`"business"` 下这三块不挂载、不发请求。

## 看页面上是什么

- `search` 是左栏顶部的搜索词：命中的对象类型（含名称、API 名、描述与属性名）和关系类型（含名称、描述及源/目标类 API 名）在图上标出来，其余的淡出；搜索不动选中。
- `filter` 是左栏的类型筛选分段：`all`（全部）、`objects`（仅对象类型）、`relations`（仅关系类型）。
- `objectType` 是选中的对象类型（主键是类的 API 名），`relation` 是选中的关系类型（主键是关系名）。地址里带 `?objectType=<类>` 或 `?relation=<关系名>` 就是直接打开并选中它。
- `highlightedNodes`、`highlightedEdges` 是搜索或类型筛选命中的对象和关系；只是画面，不是选中。
- `draftPathFrom`、`draftPathTo` 是路径查找的两个待查下拉值；`pathFrom`、`pathTo` 是点「查找路径」后提交给画布的起点和终点对象类型；画布按有向最短路径标出经过的点和边，并汇报路径状态与跳数。
- 回答“这页现在是什么样”时，先说选中了什么（没有就说没有），再说搜索词、筛选范围（`filter`）和是否在展示一条路径；要某个类的属性和关联关系，看右栏的 `objectAttributes` 与 `objectRelations` 投影即可。

## 找路径

右栏上方选起点（`draftPathFrom`）和终点（`draftPathTo`）对象类型，点「查找路径」提交到 `pathFrom`、`pathTo`：共用画布按关系方向计算最短路径并以路径样式标出经过的点和边，同时用平台消息提示跳数或无路反馈；选中节点或边时会清除画布路径高亮但保留下拉里的待查值。

## 跳转

- 动作只看当前元素的读法给了什么，两种来源一致：「去建模」在 `modelingPath` 有值时才出现（`/ontology/visual-modeling?selectedNode=<类名>&back=playground` 或 `?selectedEdge=<关系名>&back=playground`）；「查看实例目录」在 `directoryPath` 有值时才出现（四层里有目录页的类型才有）。
- 「浏览该类实例」两种来源都给：被能力图谱嵌着时由它接住并切到实例半的表格；单独打开这一页时自己跳到 `/browser/data?viewMode=table&selectedClass=<类型>`。
- 选中关系类型后，点右栏两端的对象按钮可直接切到对应对象类型。

写操作：这一页只读，没有要读者确认的操作。
