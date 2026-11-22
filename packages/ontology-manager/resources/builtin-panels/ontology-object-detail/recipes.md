# 对象类型详情

这一页是不进菜单的对象类型详情入口（`/ontology/object-detail`），用于查看和编辑单个对象类型的基本信息、属性列表、关联关系与主键状态；基本信息表单的保存与放弃由平台页头承载。

## 状态

- `selected`：当前查看的 `platform:ObjectType`（如 `{"className":"platform:ObjectType","primaryKey":"org"}`）。
- `selectedAttribute`：当前在属性表行内展开编辑的 `platform:Attribute`（主键为 JSON 文本 `["<类 API 名>","<属性名>"]`）。

## 起草表单草稿

起草前先读对应属主表单（`objectForm` 的 `form`、`attributeForm` 的 `form` / `createForm`），`operation` 用返回的 `save.draftOperation`，把草稿链接交给读者检查并保存；不要替读者保存。

- 修改对象类型：用 `objectForm` 的 `form`，链接 `state` 带上 `selected`。
- 新建属性：用 `attributeForm` 的 `createForm`，链接 `state` 带上 `selected`（所属对象类型由页面固定为当前类）。
- 修改属性：用 `attributeForm` 的 `form`，链接 `state` 带上 `selected` 和 `selectedAttribute`。
- 删除对象类型、设为主键、删除属性由对应的 `OperationButton` 走平台确认流程。
