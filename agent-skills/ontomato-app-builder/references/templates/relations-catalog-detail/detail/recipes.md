# 关系类型详情页的常见做法

这一页展示一条关系类型的详情：顶部单行页头包含返回、关系名称（由 `headerTitle` 投影绘制）、删除按钮与保存/放弃草稿条；下方两栏分别是「基本信息」编辑表单和「对象连接」两端对象卡片（由 `fromCard` / `toCard` 两个 `ObjectRefCard` 投影绘制）。

## 看页面现在是什么

- 状态 `selected` 是当前打开的关系类型（`{"className":"platform:Relationship","primaryKey":"<关系名>"}`）。
- `headerTitle`（`ObjectHeader`）、`fromCard` / `toCard`（`ObjectRefCard`）均绑定选中关系类型的 `record`；读不到时页面显示「关系类型不存在或已删除」。

## 修改关系类型：起草，由人保存

1. 先读属主的表单：`form` 成员的 `form`（`target` 是选中的那条关系）。字段与规则都由属主给：
   - 修改有 `relationship`（只读）、`fromField`（源字段）、`toField`（目标字段）、`desc`（描述）。
   - `fromField`/`toField` 是否必填由属主按当前数据源决定（看字段的 `required`），不要自己判断。
2. 起草：`operation` 用表单的 `save.draftOperation`（修改是 `relationship.update`），`form` 只放要改的字段值。把链接交给发起人，由人在页头确认保存或放弃。不要替人直接保存。

## 删除：先问人，再执行

删除是 `remove` 成员的 `relationships.delete`，目标是选中的那条关系。删掉不可恢复，所以：先向发起人确认要删哪一条（说出关系名和描述），得到确认后再执行一次；执行前不要在没得到确认时调用，也不要重试。删除成功后页面返回关系类型目录 `/ontology/relations`。

## 去别处

- 返回关系类型目录：点页头「返回关系类型」，或打开 `/ontology/relations`。
- 查看两端对象类型：点右侧「对象连接」里的来源对象或目标对象卡片，打开 `/ontology/objects?selected=<类名>`。
