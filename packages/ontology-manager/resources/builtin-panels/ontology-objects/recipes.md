# 对象类型目录

这一页是本体里对象类型的目录与新建入口；点整行或新建完成后会跳转到不进菜单的对象类型详情入口（`/ontology/object-detail`）。

## 状态

- `search`：按显示名、API 名或说明筛选目录。
- `creating` 为 `true` 时，打开「新建对象类型」弹窗。
- `selected`（兼容旧深链）：若地址带着选中的 `platform:ObjectType`，会自动跳转到 `/ontology/object-detail` 打开详情。

## 起草表单草稿

新建对象类型时先读 `createForm` 的 `createForm`，`operation` 用返回的 `save.draftOperation`，把草稿链接交给读者检查并保存；不要替读者保存。修改现有对象类型或其属性请前往对象类型详情页（`ontology-object-detail`）。
