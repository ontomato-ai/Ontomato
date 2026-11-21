# 本体图谱（Ontology graph）

这一页用本域属主的对象类型和关系画一张有方向的本体图谱，读者在左栏搜索和筛选、在画布上选中、在右栏看详情和路径。

## 页面公开的状态（读者看到的就是这些）

- `objectType`：当前选中的对象类型（`platform:ObjectType`，键是类名，如 `Order`）。
- `relation`：当前选中的关系类型（`platform:Relationship`，键是关系名，如 `order_has_item`）。它和 `objectType` 一次只有一个。
- `search`：搜索词；同时匹配对象类型的类名、显示名、描述、属性名，和关系的关系名、描述、两端。
- `filter`：`all`、`objects`、`relations` 之一。

页面的地址带着这四项，读者的消息里就带着选中的那个对象和这些值。

## 可以替读者做的事

- 问页面在讲什么、选中的是哪个对象类型或关系、搜索词和筛选是什么：照状态回答，别猜。
- 某个对象类型有哪些属性、和谁有哪种方向的关系：用属主的读（`platform:ObjectType`、`platform:Attribute`、`platform:Relationship`）现场读，不要凭状态拼。
- 想知道两个类型之间怎么走：按关系方向找最短的那条链，说明有几跳经过哪些关系；图上读者自己按「查找路径」也会高亮同一条。
- 要改建模：给出可视化建模的地址 `/ontology/visual-modeling?focus=object&id=<类名>`（关系用 `focus=relation&id=<关系名>`），读者在那里改。
