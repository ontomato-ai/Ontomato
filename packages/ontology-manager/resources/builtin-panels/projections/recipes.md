# 投影目录：这个页面怎么用

平台自带和本域里读者能使用的投影（SDK 组件 + 它读的数据 + 它登记的操作）。这个页面管理投影本身；面板组合、应用与发布不在这里。
页面上的列表、详情、子表、授权与操作全部通过属主标准读法与正式操作按钮声明，这里只写读者和智能体需要知道的、从页面上看不出来的规则。

## 页面在看什么

- 左侧列表（`catalogue`）是本域里**当前读者有使用授权**的投影，按游标分页（支持切换 10/20/50 每页条数）。列：名称与说明、所用组件、所属人、共享范围、更新时间。
- 范围（`scope`）：`all`（全部，默认）＝有使用授权的全部投影；`mine`（我的）＝所属人是当前读者的；`shared`（共享）＝所属人不是当前读者的。
- 排序（`sort`）：`updated`（最近更新，默认）或 `name`（名称）。检索（`search`）同时匹配名称和说明。
- 地址深链只携带视图定位状态（扁平具名查询参数）：`selected`、`search`、`scope`、`sort`、`tab`（`overview` / `definition` / `usage` / `grants`）。对话框开关与编辑态（`creating`、`detailMode`、`copyDialog`、`deleteDialog`、`grantDialog` 等）为公开状态，智能体可读可改，但不写入地址。
- 选中一条投影后，右侧分标签展示：
  - `overview`（概览与预览）：基础属性摘要（含可跳转的组件引用）与原位预览（`preview` 槽位挂载当前选中投影）。
  - `definition`（定义与绑定）：数据来处/读法/参数表（`dataList`，来处引用可跳转至能力图谱、对象类、关系类、行动或指标视图）、组件配置表（`configList`）、输入/输出端口表（`inputsList` / `outputsList`）、属主登记的操作表（`operationsList`），以及可展开的完整 JSON 定义（`definitionSummary`）。
  - `usage`（使用方）：列出当前读者可见的使用面板（`usedByList`，点击跳转到面板目录），并在存在无权查看的使用面板时提示隐藏数量。
  - `grants`（权限与共享，仅可编辑时显示）：域内共享开关（`shareEnable` / `shareDisable`）、授权列表与行级撤销（`grantsList.revoke`），以及通过成员/角色选择器添加授权的弹窗（`grantSubmit`）。
- `查看所属类` 打开能力图谱（`/ontology/assets/capability-map`）的类型列表，深链参数为 `mode=type&view=list&selectedType=platform:ProductProjection`。

## 读写都按读者的真实身份

入口沿用 `ontology-modeling`。列表、详情、子表、使用方与授权列表都是属主按读者真实身份与授权过滤后的答案；写操作也由投影属主裁决。
属主在 `record` 读法的 `outputs` 中声明权限与类型结论（`canEdit`、`canGrant`、`canDelete`、`canCopy`、`isBuiltin`、`isChart`、`domainShared`、`revision`、`usedByCount`、`hiddenUsedByCount`）。只读投影隐藏编辑、复制、删除与权限管理入口；无权查看时详情返回 `forbidden`。

## 新建与编辑：只改这次提交的字段

表单是属主自己的 `platform:ProductProjection` 表单（`form` 成员绑定 `form` 与 `createForm` 读法，保存操作是 `platform:ProductProjection.save`）。

- 编辑：选中一条可编辑投影后将 `detailMode` 设为 `"edit"` 打开表单；保存只提交读者改过的字段（JSON Pointer），没提交的字段属主保持原样。提交时携带表单读到的 `revision`，并发修改会被属主拒绝。
- 新建：清空 `selected` 并将 `creating` 设为 `true` 打开同一个表单，属主返回创建表单；标识由属主生成或沿用表单中填入的 `id`。
- 协助填写：用 `present` 切换到对应投影的编辑态（`selected` + `detailMode: "edit"`）或新建态（`state: { selected: null, creating: true }`），再用 `fill_form` 直接填入实时表单。需要保存时调用 `page_action({ operation: "form.save" })`（默认经读者确认后提交）。

## 属主登记的操作

五项写操作均绑定在正式操作投影成员上，作用目标为当前选中的投影（`selected`）：

| 成员与操作 | 属主操作 | 输入参数 | 说明 |
| --- | --- | --- | --- |
| `copySubmit.copy` | `productProjections.copy` | `{ id, name }` | 复制为一条新的**私有**投影；图投影不可复制，属主会拒绝。 |
| `deleteSubmit.delete` | `productProjections.delete` | `{ revision }` | 删除选中投影；被任何面板使用时属主拒绝（`PRODUCT_IN_USE`）。 |
| `grantSubmit.grant` | `productProjections.grant` | `{ principalKind: "principal" \| "role", principalId, verb: "use" \| "edit" }` | 给成员或角色授予使用或编辑权。 |
| `grantsList.revoke` | `productProjections.revoke` | `{ principalKind, principalId, verb }` | 撤销授权列表中的单条成员/角色授权（域内共享行不可在行内撤销，请使用域内共享开关）。 |
| `shareEnable.share` / `shareDisable.share` | `productProjections.share` | `{ shared: boolean }` | 开启或关闭域内所有成员的使用授权。 |

## 图投影

`componentId` 是 `@ontomato/sdk:MetricChart` 的投影（`isChart: true`）由看板源卡登记而来：不能复制（`canCopy: false`），不能改绑组件或指标视图，编辑只改名称、说明与初始范围，删除和普通投影一致（未被使用时可删）。要改图本身请前往看板编辑源卡。
