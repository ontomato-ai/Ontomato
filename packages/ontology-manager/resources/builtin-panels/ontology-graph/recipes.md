# 本体图谱页的常见做法

这一页全部由平台官方投影组装：页头统计（`ObjectCount`）、左栏资源列表（`ObjectList`）、中间共用图谱画布（`RecordGraph`）、右栏路径选择器（`ReferencePicker`）与元素详情（`ObjectHeader`、`TypedValue`、`ObjectRefCard`、`ObjectList`）。画布工具条在画布左下角：放大、缩小、适应画布、重新布局、下载 PNG；也支持滚轮缩放。

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

- 选中一个类或一条关系后可「去建模」：打开可视化建模并定位到它，同时附带 `back=playground` 来路标记（`/ontology/visual-modeling?selectedNode=<类名>&back=playground` 或 `/ontology/visual-modeling?selectedEdge=<关系名>&back=playground`）。
- 选中关系类型后，点右栏两端的对象按钮可直接切到对应对象类型。

写操作：这一页只读，没有要读者确认的操作。
