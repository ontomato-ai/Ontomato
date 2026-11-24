# 投影目录：这个页面怎么用

平台自带和本域里读者能使用的投影（SDK 组件 + 它读的数据 + 它登记的操作）。这个入口是整宽目录，负责检索、筛选、排序与整宽表单新建；点任意一行进入独立详情入口（`/ontology/projections/detail?selected=<id>`）查看、预览、编辑、复制、授权或删除。

## 目录在看什么

- 整宽列表（`catalogue`）展示本域里**当前读者有使用授权**的投影，按页读取（支持切换 10/20/50 每页条数）。列：名称与说明、所用组件、所属人、共享范围、更新时间，行尾带右箭头提示可进入详情。
- 范围（`scope`）：`all`（全部，默认）＝有使用授权的全部投影；`mine`（我的）＝所属人是当前读者的；`shared`（共享）＝所属人不是当前读者的。
- 排序（`sort`）：`updated`（最近更新，默认）或 `name`（名称）。检索（`search`）同时匹配名称和说明。
- 地址深链只携带视图定位状态：`search`、`scope`、`sort`（页码不写入地址）。新建态开关 `creating` 为公开状态（`deepLink: false`），智能体可读可写但不进入地址。
- 点击目录中的任意一行跳转到 `/ontology/projections/detail?selected=<primaryKey>`；平台负责目录保活并在返回时自动重读。

## 整宽表单新建投影

- 点击页头主按钮「新建投影」或通过 `present({ creating: true })` 切入**整宽新建视图**（目录退场保活，原位呈现整宽表单），挂载属主的创建表单 `createForm`（`platform:ProductProjection.save`）。
- 表单完整呈现属主声明的全部字段（名称、ID、描述、可见性、所用组件、数据读取、组件配置、输入/输出端口、操作等），按所选组件填齐必填内容后由页头保存。
- 页头左侧提供「返回投影」，右侧呈现由 `usePanelFormDraft("createForm")` 驱动的保存/放弃控制条。存在未保存改动时，点击「返回投影」或按 ESC 均通过平台统一的未保存离开确认弹窗询问，确认放弃后才退回目录。
- 创建成功后，页面退出新建态、刷新目录，并直接跳转到 `/ontology/projections/detail?selected=<primaryKey>` 查看新建的投影详情（默认查看态）。
- 协助新建：用 `present({ creating: true })` 打开整宽新建表单，再用 `fill_form` 填入实时表单；确认提交时调用 `page_action({ operation: "createForm.save" })`（默认经读者确认后提交）。
