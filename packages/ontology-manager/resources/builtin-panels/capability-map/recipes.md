# 能力图谱（`builtin-product-capability-map`）

挂在应用 `ontology` 的 `/ontology/capability-map`。这一页自己不读任何属主读法，只是把平台四层本体的两半接在一起：类型半用本体图谱（`builtin-product-ontology-graph`），实例半用对象浏览器（`builtin-product-data-browser`），两半都以 `dataSource: "platform"`（四层平台本体）运行。

## 看页面上是什么

- `mode`（深链，默认 `"instance"`）：`"instance"` 显示实例半，`"type"` 显示类型半；页头用分段控件切换。
- `view`（深链，默认 `"graph"`）：实例半的显示方式，`"graph"`（实例图谱）或 `"table"`（表格）；旧深链里的 `"list"` 会自动当成 `"table"`。
- `start`、`selected`：实例半的图谱起点与当前实例节点（主键在主键字段里，地址里写作 `<类名>~<主键>`）。
- `selectedType`（深链，类型 ID 字符串）与 `selectedTypeRef`（类型引用）是同一个选中的类型：前者跟着地址走，后者给两半读。
- `selectedRelation`：类型半选中的关系种类；`selectedClass`：实例半表格选中的类型。
- 回答“这页现在是什么样”时，先说在实例半还是类型半，再说选中的类型或实例；细节都归各自那一半，说“看实例半 / 类型半的说明”。

## 两半之间

- 类型半的「浏览该类实例」由这一页接住：切到实例半的表格并选中该类。
- 实例半的图谱与表格共用同一份选中：在表格里双击没有独立详情页的行，会以它为起点切回图谱。

## 跳转

只有页头：模式切换与刷新（刷新当前那一半）。写操作：这一页只读。
