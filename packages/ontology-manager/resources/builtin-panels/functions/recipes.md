# 函数面板：这一页上的活怎么干

这一页管本域的函数：一条一条看，按名称和说明搜，改一个读函数的查询逻辑包或列标签，改一个写函数的参数和代码，
新建一个，删掉不要的。页面的声明（状态和它组成的投影）与每个投影都说明了哪里有什么，这里只补页面看不出来的几件事。

## 这一页有什么

- 左侧列表是 `platform:Function` 的函数，显示名称、说明和操作类型（读 / 写），搜索框按名称和说明匹配，右上角是条数。
- 选中一条写进面板状态 `selected`，右侧是它的表单，字段由属主按操作类型给出。
- 页头的「新建函数」命令（`newFunction`）把 `selected` 清空、`creating` 设为 true，打开空白表单；保存后新建一条，撤下后回到没选中的状态。

## 读取当前数据

- 列表：面板声明里的 `query` 读，参数 `search` 就是面板状态 `search`（按名称和说明匹配，不区分大小写）。
- 一条函数的全部字段：读它的 `form`，目标的 `primaryKey` 是这一条的 id。`values` 里是属主现在存的值：
  名称 `name`、说明 `description`、操作类型 `operation`（`OPERATION_READ` / `OPERATION_WRITE`）、逻辑说明 `logic`；
  读函数还有查询逻辑包 `queryPackage` 和列标签 `returnDef.columnLabels`，写函数还有参数 `parameters`、
  返回类 `returnDef.classNames` 和代码 `code`。表单读的 `errors` 是属主对当前值的意见，`fields[].readOnlyReason`
  说明哪些字段为什么不能改。
- 想按操作类型或类名找函数，用平台的 `function list` 过滤，不要自己遍历全部再筛。

## 起草改动

读者确认之前什么都不会写。先按目标读属主的表单（已有的一条用 `form`，新建用 `createForm`），把 `save.draftOperation`
抄进草稿的 `operation`，写到 `outputs/drafts/<名字>.page-draft.json`。

`form` 里只放要改的字段；没写的字段保持现值。比如只改描述：

```json
{
  "pageKey": "ontology-functions",
  "operation": "function.update",
  "target": {"id": "<选中函数的 id>"},
  "form": { "description": "按单位类别统计在职教职工人数" }
}
```

新建时 `operation` 用 `function.create`、`target` 留空（`{}`）。把草稿路径和当前会话、运行一起放进页面链接
（`draftSessionId`、`draftRunId`、`draftPath`）交给读者；打开链接后表单会被填好并标出改过的字段，由读者保存。
属主不收的草稿会整份退回来，并指出是哪个字段、为什么。

读函数的 `queryPackage` 要写整份查询逻辑包（含 `manifest` 和 `files`）；写函数的 `parameters` 是
`[{name, type, description, sample, classNames}]` 的数组，`type` 只能是 `TYPE_STRING`、`TYPE_NUMBER`、`TYPE_TIME`、
`TYPE_STRING_ARRAY`、`TYPE_NUMBER_ARRAY`、`TYPE_TIME_ARRAY`。`returnDef` 里读函数用 `columnLabels`，写函数用
`classNames`（返回类）。

## 保存、删除与只读

- 保存就是表单自己的保存（`platform:Function.save`），读者在表单上按保存，平台按属主的字段逐条显示错误。
- 删除用 `functions.delete`，作用在面板状态 `selected` 上；平台先请读者确认，属主拒绝时把原因显示出来。
- 系统来源的函数、产品函数、被指标视图、动作或写任务引用的函数只能看，不能改也不能删：属主会在对应字段上
  说明原因，或拒绝保存与删除。遇到这种拒绝就如实告诉读者原因，不要换别的办法去写。

函数页没有测试或执行，这一页也不提供。
