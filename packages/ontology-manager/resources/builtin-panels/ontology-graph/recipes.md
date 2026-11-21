# 本体图谱页的常见做法

这一页用平台的共用图谱画布画属主的对象类型（点）和关系类型（边），人在图上浏览、选中、找路径，选中一个就能看它的属性和关系。画布工具在画布右上角：适应画布、重新布局、下载 PNG；放大缩小用滚轮。

## 看页面上是什么

- `search` 是页面顶部的搜索词：命中的对象类型和关系类型在图上标出来，其余的淡出；搜索不动选中。
- `objectType` 是选中的对象类型（主键是类的 API 名），`relation` 是选中的关系类型（主键是关系名）。地址里带 `state={"objectType":{"className":"platform:ObjectType","primaryKey":"<类>"}}` 就是直接打开并选中那个类。
- `highlightedNodes`、`highlightedEdges` 是页面上被标出来的对象和关系（搜索命中，或找到的路径）；只是画面，不是选中。
- 回答“这页现在是什么样”时，先说选中了什么（没有就说没有），再说搜索词和是否在展示一条路径；要某个类的字段，用 `objectTypes` 的 `rows` 找它那一行，`attributes` 的 `rows` 里 `className` 等于这个类的就是它的属性，`relations` 的 `rows` 里两端任一是这个类的就是它的关系。

## 找路径

页面上方选起点和终点对象类型，点「查找路径」：页面按关系方向找最短的一条，把经过的点和边标出来。这个计算在页面里做，不走属主；属主只提供三份列表。

## 跳转

- 选中一个类或一条关系后可「去建模」：打开可视化建模并定位到它（`/ontology/visual-modeling?focus=object|relation&id=<主键>&back=playground`）。
- 要看关系类型的详情用关系类型页 `/ontology/relations`，`state` 里带 `selected`。

写操作：这一页只读，没有要读者确认的操作。
