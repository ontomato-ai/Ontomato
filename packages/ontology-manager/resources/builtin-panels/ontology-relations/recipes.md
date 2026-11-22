# 关系类型这一页的常见做法

这一页有目录和详情两部分，同一张面板：左边是关系类型的目录，选中一条就在右边看它的详情；右边同时是新建和修改的表单。

## 看页面现在是什么

- 状态 `selected` 是当前选中的关系类型，`null` 表示停在目录（或正在新建）。状态 `creating` 为 `true` 时，右边是空白的新建表单；页头的「新建关系类型」命令打开的就是这个状态。地址里带 `state={"selected":{"className":"platform:Relationship","primaryKey":"<关系名>"}}` 就是直接打开那条关系的详情。
- 状态 `search` 是目录的搜索词，匹配关系名、描述和两端对象。
- `catalogue` 成员的 `rows` 是目录的全部关系类型；每行的 `primaryKey` 是关系名，`label` 是描述（没有描述时是关系名），`fields` 有 `fromclass`、`toclass`、`desc`、`fromField`、`toField`。
- `detail` 成员的 `record` 是选中那条关系的同一份记录，读不到时页面显示「找不到关系类型」。
- `types` 成员的 `rows` 是本体的类，用来把 `fromclass` / `toclass` 显示成类的中文名。

## 新建或修改关系类型：起草，由人保存

1. 先读属主的表单：`form` 成员的 `createForm`（新建）或 `form`（修改，`target` 是选中的那条关系）。字段与规则都由属主给：
   - 新建有 `relationship`（关系名）、`fromclass`（源对象）、`fromField`（源字段）、`toclass`（目标对象）、`toField`（目标字段）、`desc`（描述）；修改只有 `relationship`（只读）、`fromclass`/`toclass`（只读）、`fromField`、`toField`、`desc`。
   - `fromField` 的选项是源对象的属性，`toField` 的选项是目标对象的属性。换了 `fromclass`/`toclass` 后要再问一次表单（带 `values` 和 `changedField: "/fromclass"` 或 `"/toclass"`）拿新选项，不要自己拼选项。
   - `fromField`/`toField` 是否必填由属主按当前数据源决定（看字段的 `required`），不要自己判断。
   - 关系名格式、重名等由属主判：提交时属主拒绝会在 `errors` 里给出字段和原因，照它说，不要自己编规则。
2. 起草：`operation` 用表单的 `save.draftOperation`（新建是 `relationship.create`，修改是 `relationship.update`），`form` 只放要改的字段值。草稿怎么写（草稿信封、发布产物、链接参数）见本页生成的技能。把链接交给发起人，由人在表单里保存。不要替人直接保存。
3. 人保存后，页面进入新建或修改的那条关系的详情。

## 删除：先问人，再执行

删除是 `remove` 成员的 `relationships.delete`，目标是选中的那条关系。删掉不可恢复，所以：先向发起人确认要删哪一条（说出关系名和描述），得到确认后再执行一次；执行前不要在没得到确认时调用，也不要重试。

## 去别处

两端的类在详情里可以点开：打开对象类型页 `/ontology/objects`，`state` 为 `{"selected":{"className":"platform:ObjectType","primaryKey":"<类名>"}}`。面板里不要自己拼别的平台地址——领域模型的其它页面由各自的入口负责。
