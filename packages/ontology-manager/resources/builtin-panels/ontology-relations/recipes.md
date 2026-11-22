# 关系类型这一页的常见做法

这一页采用“列表详情·并排”布局：左侧是关系类型列表，右侧是选中关系的详情与编辑区（也是新建关系类型的表单区）；容器变窄时自动转为列表与详情互切。

## 看页面现在是什么

- 状态 `selected` 是当前选中的关系类型，`null` 表示未选中（或正在新建）。状态 `creating` 为 `true` 时，右侧显示新建表单；页头的「新建关系类型」命令打开这个状态。地址里带 `state={"selected":{"className":"platform:Relationship","primaryKey":"<关系名>"}}` 可以直接打开那条关系的详情。
- 状态 `search` 是左侧列表的搜索词，由 `ObjectList` 本地筛选关系名称、说明与两端对象标签。
- `list` 成员（`ObjectList`）的 `rows` 是全部关系类型；每行以说明或关系名作标题，以“来源对象 → 目标对象”（`subtitle`）作副标题，便于区分同名关系。
- `header` 成员（`ObjectHeader`）读取选中关系的 `record`，展示名称、两端副标题，并在「更多」菜单中提供删除操作。
- `connections` 成员（`ObjectSummary`）展示选中关系的 `fromObject`、`toObject` 引用链接，点击可跳转到对应对象类型详情。

## 新建或修改关系类型：起草，由人保存

1. 先读属主的表单：`form` 成员（`ObjectForm`）的 `createForm`（新建）或 `form`（修改，`target` 是选中的那条关系）。字段与规则都由属主给出：
   - 新建包含 `relationship`（关系名称）、`fromclass`（来源对象）、`fromField`（源字段）、`toclass`（目标对象）、`toField`（目标字段）、`desc`（说明）；修改时 `relationship`、`fromclass`、`toclass` 只读。
   - `fromField` 的选项是来源对象的属性，`toField` 的选项是目标对象的属性。更换 `fromclass` / `toclass` 后需重新查询表单（带 `values` 和 `changedField: "/fromclass"` 或 `"/toclass"`）获取新选项，不要自行拼装。
   - `fromField` / `toField` 是否必填由属主按当前数据源决定（看字段的 `required`）。
   - 关系名称格式、重名等由属主校验：提交被拒时会在 `errors` 中返回字段和原因，按属主反馈处理。
2. 起草：`operation` 使用表单的 `save.draftOperation`（新建为 `relationship.create`，修改为 `relationship.update`），`form` 只放需要修改的字段值。把草稿链接交给发起人，由人在表单里保存，不要替人直接保存。
3. 人保存后，页面停留在新建或修改的那条关系详情。

## 删除：先问人，再执行

删除是 `header` 成员的 `relationships.delete`，目标是选中的那条关系。删除不可恢复：先向发起人确认要删除的关系名称和说明，确认后再执行一次；未确认前不调用，也不重试。

## 去别处

在详情的「对象连接」区块点击来源对象或目标对象，会打开对象类型页 `/ontology/objects`，带参数 `state={"selected":{"className":"platform:ObjectType","primaryKey":"<类名>"}}`。面板不自行拼装其它平台地址。
