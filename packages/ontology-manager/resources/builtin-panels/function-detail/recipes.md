# 函数详情面板：这一页上的活怎么干

这一页是单条 `platform:Function` 的整宽详情与新建入口（`/ontology/assets/functions/detail`，不进左侧菜单）：
用于查看和修改一条读函数（查询逻辑包与列标签）或写函数（参数、返回类与代码），也可以新建或删除函数。

## 这一页有什么

- 单层页头左侧是返回按钮（回到 `/ontology/assets/functions`），中间在详情态显示当前函数的名称与操作类型（`header`），新建态显示「新建函数」；右侧放删除按钮（`remove`，仅就绪且属主允许删除时显示）与页头保存/放弃条（绑定到表单 `definition`）。
- 正文由单份属主表单 `definition`（`platform:Function` 的 `form` / `createForm`）分左右两张卡片呈现：左卡为名称、说明与操作类型（单选，已有函数固定），右卡为函数逻辑（读函数的查询包/列标签/说明，写函数的行内参数/返回类/说明/Python 代码），名称字段 `/name` 只出现一次。
- 当目标函数正在加载、无权查看、加载失败或不存在时，原位展示状态提示，不挂载表单。

## 进入详情态与新建态

- 查看或修改已有函数：用 `present` 打开 `/ontology/assets/functions/detail`，设 `{ selected: { className: "platform:Function", primaryKey: "<id>" } }`。编辑保存成功后提示保存成功并返回目录 `/ontology/assets/functions`。
- 新建函数：用 `present` 打开 `/ontology/assets/functions/detail`，设 `{ selected: null, mode: "create" }`。新建保存成功后状态自动收敛为 `{ selected: { className: "platform:Function", primaryKey: "<newId>" }, mode: null }` 并留在详情页；放弃或取消新建会返回目录 `/ontology/assets/functions`。

## 填写表单与保存

- 用 `fill_form` 往 `definition` 填入要改或新建的字段（页面在页头标出未保存改动，离开时由平台拦截确认）；需要保存时用 `page_action` 调用 `definition.save`（`platform:Function.save`）。
- 读函数（`OPERATION_READ`）保存必须包含完整的 `queryPackage`（含 `manifest` 和 `files`），可选 `returnDef.columnLabels`；写函数（`OPERATION_WRITE`）保存必须包含带 `# ontomato-python:2` 标记的 `code`，可选 `parameters`（`[{name, type, description, sample, classNames}]`，`type` 限于 `TYPE_STRING`、`TYPE_NUMBER`、`TYPE_TIME`、`TYPE_STRING_ARRAY`、`TYPE_NUMBER_ARRAY`、`TYPE_TIME_ARRAY`）与 `returnDef.classNames`。
- 表单读的 `errors` 是属主对当前值的校验意见，`fields[].readOnlyReason` 说明只读原因。

## 删除与只读规则

- 删除走 `remove.delete`（`functions.delete`），作用在 `selected` 上；平台先请读者确认，删除成功后自动返回函数目录。
- 系统来源函数、产品函数、以及被指标视图、动作或写任务引用的函数只能查看，不能修改也不能删除；属主会在字段与操作可用性上给出原因，遇到拒绝时如实告知读者，不换路强写。

函数详情页不提供测试或执行。
