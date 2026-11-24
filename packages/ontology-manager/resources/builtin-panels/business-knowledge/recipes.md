# 业务知识管理

本页是业务知识的列表/详情/编辑管理页。页面状态里有当前的搜索词（`search`）、状态筛选（`status`：`all` / `pending` / `approved`，分别对应全部、待审核、已通过）、选中的条目（`selected`）、勾选的条目（`checked`）和当前模式（`mode`：`view` / `edit` / `create`），这些都在页面上下文里，可以直接看到。页头的「添加知识」按钮会把 `mode` 设为 `create` 打开新建表单。

## 读取

- 选中条目的字段（标题、内容、标签、状态）通过本页 `record` 读数拿到；需要看整条时先确认 `selected`，再读它。
- 列表行由共享的 `search` 与 `status` 共同决定；状态计数（全部/待审核/已通过）只随 `search` 变化、不随 `status` 筛选变化，解释筛选结果时以它们为准。

## 填写新增或修改表单

- 新增时，用 `present` 打开本页，设置 `{ mode: "create", selected: null, formTarget: null }`。修改时，在同一次 `present` 中设置 `{ mode: "edit", selected: item, formTarget: item }`，其中 `item = { className: "platform:BusinessKnowledge", primaryKey: "<条目ID>" }`。填表前从页面快照确认表单目标。
- 用 `fill_form({ member: "form", values })` 填入要修改的字段（`knowledgeTitle`、`knowledgeText`、`knowledgeTags`、`status`），页面会标出改动的字段并保持未保存。表单里已有未保存修改时会拒绝覆盖，需先向用户确认再传 `overwriteUnsaved: true`。
- **新增的条目一律待审核**：新增时 `status` 填 `0`，不要留给读者或自己判断，也不要写 `1`。修改时保留条目原来的 `status`。
- 如用户要求保存，调用 `page_action({ operation: "form.save" })`（默认由用户在对话中确认，全自动会话直接保存）。仅要求预览时，把未保存的表单留在页面。

## 审核通过与删除

- 单条操作走 `selected`，且单条审核（`approve.approve`）和单条删除（`remove.delete`）只在查看态（`mode === "view"`）且条目详情就绪时挂载可用，编辑态或新建态不可用。先用 `present` 切到查看态并选中条目，待条目详情就绪后再调用 `page_action({ operation: "approve.approve" })` 或 `page_action({ operation: "remove.delete" })`。
- 批量操作走 `checked`。用 `present` 把 `checked` 设为目标条目的对象引用数组，再调用 `page_action({ operation: "approveAll.approve" })` 或 `page_action({ operation: "deleteAll.delete" })`。
- 批量审核（`approveAll.approve`）仅审核待审核条目：勾选批次里混有已通过条目时，属主会在派发前跳过已通过条目（不重复改写），并在批量回执中以 `skipped` 附原因说明；若勾选的条目全部已通过，批量审核按钮不可用。
- 写入操作由页面按会话确认设置走对话确认（默认）或全自动执行；汇报批量结果时需如实说明成功、跳过（含原因）和失败条数。
