# 关系类型目录页的常见做法

这一页是关系类型的整宽表格目录，由官方 `ObjectList` 投影呈现，提供搜索和新建关系类型弹窗；点一行跳到关系类型详情入口 `/ontology/relations/detail`。

## 看页面现在是什么

- 状态 `search` 是目录的搜索词，由 `catalogue`（`ObjectList`）直接匹配关系名、描述和两端对象名称。
- 状态 `creating` 为 `true` 时，打开居中「新建关系类型」弹窗；页头的「新建关系类型」按钮打开的就是这个状态。
- `catalogue` 成员的 `rows` 是目录的全部关系类型；每行的 `primaryKey` 是关系名，`label` 是描述（没有描述时是关系名），`fields` 有 `fromclass`、`toclass`、`fromclassLabel`、`toclassLabel`、`fromObject`、`toObject`、`desc`、`fromField`、`toField`。

## 新建关系类型：起草，由人保存

1. 先读属主的表单：`form` 成员的 `createForm`。字段与规则都由属主给：
   - 新建有 `relationship`（关系名）、`fromclass`（源对象）、`fromField`（源字段）、`toclass`（目标对象）、`toField`（目标字段）、`desc`（描述）。
   - `fromField` 的选项是源对象的属性，`toField` 的选项是目标对象的属性。换了 `fromclass`/`toclass` 后要再问一次表单（带 `values` 和 `changedField: "/fromclass"` 或 `"/toclass"`）拿新选项，不要自己拼选项。
   - `fromField`/`toField` 是否必填由属主按当前数据源决定（看字段的 `required`），不要自己判断。
   - 关系名格式、重名等由属主判：提交时属主拒绝会在 `errors` 里给出字段和原因，照它说，不要自己编规则。
2. 起草：`operation` 用表单的 `save.draftOperation`（新建是 `relationship.create`），`form` 只放要改的字段值。把链接交给发起人，由人在新建弹窗里保存。不要替人直接保存。
3. 人保存后，页面自动进入新建的那条关系类型的详情页 `/ontology/relations/detail`。

## 去别处

- 查看、修改或删除某条关系类型：打开关系类型详情页 `/ontology/relations/detail`，`state` 为 `{"selected":{"className":"platform:Relationship","primaryKey":"<关系名>"}}`。
