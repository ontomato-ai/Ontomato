# 本体图谱页的常见做法

这一页采用工作台模板，由平台的官方组件（`ObjectCount`、`ReferencePicker`、`ObjectList`、`ObjectGraph`、`ObjectHeader`、`ObjectSummary`）共同完成浏览、搜索、路径查找与详情查看。

## 看页面上是什么

- `search` 是左栏搜索词：在本地零请求筛选对象类型（含其属性名）与关系类型；仅当 `search` 非空时把命中的点、边写入 `highlightedNodes`、`highlightedEdges` 在画布上高亮。
- `scope` 是左栏分段筛选：`all`（全部）、`objects`（对象类型）或 `relations`（关系类型）。切换分段本身不会高亮整张图。
- `objectType` 是选中的对象类型（主键为类的 API 名），`relation` 是选中的关系类型（主键为关系名）；两者互斥。右栏详情缺省收起，选中任意节点或关系后自动展开，清空选中或按 `Esc` 收起。
- `pathFrom`、`pathTo` 是工具条内嵌路径查找的起点和终点对象类型；两者都选中后由 `ObjectGraph` 原生计算并高亮有向最短路径，点「清除路径」一键退出路径模式。
- 回答“这页现在是什么样”时，先说选中了什么（没有就说没有），再说搜索词、分段范围和是否在展示路径；查某个类的属性或关联关系时，选中该类即可按需读取 `objectAttributes` 与 `objectRelations`。

## 跳转

- 选中关系类型后，详情区里的来源对象与目标对象可直接点击，跳转到图中对应的对象类型节点。
- 选中对象类型或关系类型后，点详情抬头右侧「去建模」可打开可视化建模并定位到对应条目（`/ontology/visual-modeling?focus=object|relation&id=<主键>&back=playground`）。
- 查看关系类型目录页请用 `/ontology/relations`，`state` 里带 `selected`。

写操作：这一页只读，没有需要读者确认的写操作。
