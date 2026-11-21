# 对象类型页

这一页是本体里对象类型的目录和类详情，同一张面板：

- 面板状态 `selected` 为空时是**目录**：列出全部对象类型（`catalog` 的 `rows`），可按 `search` 里的关键词在显示名、API 名、描述里筛选。
- `selected` 指向一个 `platform:ObjectType`（主键就是类的 API 名）时是这个类的**详情**：基本信息和摘要（`detail` 的 `record`：属性数、业务键数、关系数、主键状态 `primaryKey`，`ok` 表示正常）、属性列表（`attributes` 的 `rows`）、两端任一是本类的关系（`relations` 的 `rows`）。
- 新建对象类型是页头的「新建对象类型」命令：它把页面切到空白的创建表单；填完保存后进入新类的详情。
- 目录、类详情、属性编辑区都在同一张面板；直接打开某个类用本页地址 `<页地址>?state={"selected":{...}}`。
- `selectedAttribute` 指向一个 `platform:Attribute`（主键是 JSON 文本 `["<类 API 名>","<属性名>"]`）时，详情里打开的是这个属性的编辑区。

回答“这是哪一页、选中了什么”时，先看 `selected` 和 `selectedAttribute`，再用上面的读取取当前字段，不要凭记忆。要让读者看到某个类，给出本页地址并在 `state` 里带上 `selected`（需要时连同 `selectedAttribute`）。

## 起草表单（读者保存后才写入）

起草前先读对应属主的表单，用它的 `save.draftOperation` 作为草稿的 `operation`，`form` 里只放要改的字段，字段路径以属主表单为准。把草稿链接交给读者，由读者在表单里检查并保存；不要替读者保存。

- 新建对象类型：表单 `objectForm`，`target` 为空，链接里不带 `selected`。字段是 API 名、主键名、显示名、业务描述。格式和重名由属主校验，原因显示在字段旁。
- 修改对象类型：表单 `objectForm`，`target` 是 `{"objectType":"platform:ObjectType","id":"<类的 API 名>"}`，链接 `state` 带 `selected`（属性编辑区开着也不用管，草稿按类型给到对应的表单）。只有显示名和业务描述可改，API 名只读。
- 新建属性：表单 `attributeForm`，`target` 为空；链接里必须在 `state` 带上 `selected`（所属类），所属对象类型由页面固定为当前类，读者不能改。
- 修改属性：表单 `attributeForm`，`target.id` 为属性主键 `["<类>","<属性>"]`，链接 `state` 带上 `selected` 和 `selectedAttribute`。可改显示名、描述、启用、业务键；主键不在表单里改。

## 需要确认才执行的操作

- 删除对象类型 `deleteObject.delete`（目标是 `selected`）：会连同两端涉及这个类的关系一起删除。执行前先读 `relations` 的 `rows`，向读者点名会被一起删掉的关系；经读者确认后执行，完成后页面回到目录。
- 设为主键 `setPrimaryKey.setPrimaryKey`（目标是 `selectedAttribute`）：把这个属性设为所属类的主键，原主键不再是主键。已经是主键的属性不要再设。
- 删除属性 `deleteAttribute.delete`（目标是 `selectedAttribute`）：主键属性、或被某条关系用作关联字段的属性，属主会拒绝；把属主给的原因原样告诉读者。

写操作都经平台的确认后才执行；读者取消就不执行。执行后用读取核对结果再汇报。

## 跳转

- 配置对象呈现：`/ontology/objects/<API 名>/view`
- 浏览数据：`/browser/data/<API 名>`
- 某条关系：关系类型页 `/ontology/relations`，`state` 为 `{"selected":{"className":"platform:Relationship","primaryKey":"<关系名>"}}`（面板里该行就是指向这个地址的链接）
