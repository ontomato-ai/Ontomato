# 投影详情：这个页面怎么用

独立整宽详情入口（`/ontology/projections/detail?selected=<id>`），不进应用菜单，通过投影目录（`/ontology/projections`）点行、整宽新建保存后跳转或深链进入。默认以**查看态**打开，点页头「编辑」切入整宽编辑态（地址不携带编辑态参数）。

## 页面在看什么

- 单行 `<page-header>`：
  - **查看态**：左侧「返回投影」返回 `/ontology/projections` + 投影名称与共享范围状态（`headerTitle`）；右侧主按钮「编辑」（仅可编辑时显示）+「更多」菜单（含「查看所属类」、复制、权限与共享、删除）。
  - **编辑态**：右侧切换为「取消／保存」（由 `usePanelFormDraft("form")` 驱动脏态、禁用、放弃与保存），取消或离开有未保存改动时走平台统一的未保存离开确认弹窗。
- 地址深链只携带视图定位状态：`selected`、`tab`（`overview` / `definition` / `usage` / `grants`）。`detailMode`（默认 `"view"`，可切 `"edit"`）及弹窗状态（`copyDialog`、`grantDialog` 等）为公开状态（`deepLink: false`），智能体可读可改但不写入地址。
- 查看态分四个标签：
  - `overview`（概览与预览）：基础属性摘要（`summary`，组件引用可跳转）与原位预览（`preview` 槽位挂载当前选中投影）。
  - `definition`（定义与绑定）：数据来处/读法/参数表（`dataList`，来处引用可跳转至能力图谱、对象类、关系类、行动或指标视图）、组件配置表（`configList`）、输入/输出端口表（`inputsList` / `outputsList`）、属主登记的操作表（`operationsList`），以及可展开的完整 JSON 定义（`definitionSummary`）。
  - `usage`（使用方）：列出当前读者可见的使用面板（`usedByList`，点击跳转到面板页），并在存在无权查看的使用面板时提示隐藏数量。
  - `grants`（权限与共享，仅可编辑时显示）：域内共享开关（`shareEnable` / `shareDisable`）、授权列表与行级撤销（`grantsList.revoke`），以及通过成员/角色选择器添加授权的弹窗（`grantSubmit`）。
- 「查看所属类」打开能力图谱（`/ontology/assets/capability-map`）的类型列表，深链参数为 `mode=type&view=list&selectedType=platform:ProductProjection`。

## 读写都按读者的真实身份

属主在 `record` 读法的 `outputs` 中声明权限与类型结论（`canEdit`、`canGrant`、`canDelete`、`canCopy`、`isBuiltin`、`isChart`、`domainShared`、`revision`、`usedByCount`、`hiddenUsedByCount`）。只读投影隐藏编辑、复制、删除与权限管理入口；缺失、无权限或读取失败均在原位呈现。

## 编辑投影：只改这次提交的字段

编辑表单是属主自己的 `platform:ProductProjection` 表单（`form` 成员绑定 `form` 读法，保存操作是 `platform:ProductProjection.save`）。

- 进入编辑态：点页头「编辑」或通过 `present({ selected, detailMode: "edit" })` 切换。保存只提交改过的字段（JSON Pointer），没提交的字段属主保持原样；提交时携带表单读到的 `revision`，并发修改会被属主拒绝。
- 协助编辑：用 `present({ detailMode: "edit" })`（或同时传入 `selected` 与 `detailMode: "edit"`）打开编辑表单，再用 `fill_form` 直接填入实时表单；确认保存时调用 `page_action({ operation: "form.save" })`（默认经读者确认后提交）。

## 属主登记的操作

五项写操作均绑定在正式操作成员上，作用目标为当前选中的投影（`selected`）：

| 成员与操作 | 属主操作 | 输入参数 | 说明 |
| --- | --- | --- | --- |
| `copySubmit.copy` | `productProjections.copy` | `{ id, name }` | 复制为一条新的**私有**投影（需具备编辑权且非图投影）；复制成功后仅按属主回执的 `data.id` 切换选中。 |
| `deleteProjection.delete` | `productProjections.delete` | `{ revision }` | 删除选中投影（入口在页头「更多」菜单与 `page_action` 共用）；由宿主经属主 `inspectImpact` 弹出确认框，列出可见使用面板名称与隐藏引用提示，被任何面板使用时属主拒绝（`PRODUCT_IN_USE`）；删除成功后返回 `/ontology/projections`。 |
| `grantSubmit.grant` | `productProjections.grant` | `{ principalKind: "principal" \| "role", principalId, verb: "use" \| "edit" }` | 给成员或角色授予使用或编辑权。 |
| `grantsList.revoke` | `productProjections.revoke` | `{ principalKind, principalId, verb }` | 撤销授权列表中的单条成员/角色授权（域内共享行不可在行内撤销，请使用域内共享开关）。 |
| `shareEnable.share` / `shareDisable.share` | `productProjections.share` | `{ shared: boolean }` | 开启或关闭域内所有成员的使用授权。 |

## 图投影

`componentId` 是 `@ontomato/sdk:MetricChart` 的投影（`isChart: true`）由看板源卡登记而来：不能复制（`canCopy: false`），不能改绑组件或指标视图，编辑只改名称、说明与初始范围，删除和普通投影一致（未被使用时可删）。要改图本身请前往看板编辑源卡。
