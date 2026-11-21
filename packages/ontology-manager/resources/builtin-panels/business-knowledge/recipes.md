# 业务知识管理

本页是业务知识的列表/详情/编辑管理页。页面状态里有当前的搜索词（`search`）、状态筛选（`status`：all / 待审核 / 已通过 的分组键）、选中的条目（`selected`）和勾选的条目（`checked`），这些都在页面上下文里，可以直接看到。

## 读取

- 选中条目的字段（标题、内容、标签、状态）通过本页 `record` 读数拿到；需要看整条时先确认 `selected`，再读它。
- 列表行、状态计数由共享的 `search`/`status` 决定，解释筛选结果时以它们为准。

## 起草新增或修改

- 先读本类 `form`（按 `selected` 的目标）或 `createForm`，用表单返回的 `save.draftOperation` 作为起草操作，`form` 里只放要改的字段。
- 修改现有条目时 `target` 给 `{"id": "<选中条目的 primaryKey>"}`；新增时 `target` 给 `{}`。
- `pageKey` 用当前页面上下文里的 `pageKey`。
- 把 draft 作为产物发布，给用户一个回到本页入口地址并带 `draftSessionId`/`draftRunId`/`draftPath` 的链接；由人在页面上过目后再保存。

## 审核通过与删除

- 单条用 `knowledge.approve` / `knowledge.delete`，目标是当前选中的条目；勾选多条时把 `checked` 里的条目一起作为目标做批量。
- 写入操作先说明要做什么，征得人的确认后再执行；执行失败要如实报告失败条数。
