# 投影目录：这个页面怎么用

平台自带和本域里读者能使用的投影（SDK 组件 + 它读的数据 + 它登记的操作）。这个入口是整宽目录，负责检索、筛选、排序与弹窗新建；点任意一行进入独立详情入口（`/ontology/projections/detail?selected=<id>`）查看、预览、编辑、复制、授权或删除。

## 目录在看什么

- 整宽列表（`catalogue`）展示本域里**当前读者有使用授权**的投影，按页读取（支持切换 10/20/50 每页条数）。列：名称与说明、所用组件、所属人、共享范围、更新时间，行尾带右箭头提示可进入详情。
- 范围（`scope`）：`all`（全部，默认）＝有使用授权的全部投影；`mine`（我的）＝所属人是当前读者的；`shared`（共享）＝所属人不是当前读者的。
- 排序（`sort`）：`updated`（最近更新，默认）或 `name`（名称）。检索（`search`）同时匹配名称和说明。
- 地址深链只携带视图定位状态：`search`、`scope`、`sort`（页码不写入地址）。新建弹窗开关 `creating` 为公开状态（`deepLink: false`），智能体可读可写但不进入地址。
- 点击目录中的任意一行跳转到 `/ontology/projections/detail?selected=<primaryKey>`；平台负责目录保活并在返回时自动重读。

## 居中弹窗新建投影

- 点击页头主按钮「新建投影」或通过 `present({ creating: true })` 打开居中弹窗，挂载属主的创建表单 `createForm`（`platform:ProductProjection.save`）。
- 弹窗只展示最小必填字段集合：`/name`、`/id`、`/description`、`/visibility`、`/componentId`、`/data`；组件配置（`/config`）、端口（`/inputs`、`/outputs`）与操作（`/operations`）留待建完后在详情编辑态继续配置。
- 关闭弹窗（取消、右上角关闭按钮、点击遮罩或按 ESC）时，若表单存在未保存改动，会通过平台统一的未保存离开确认弹窗询问，确认放弃后才关闭。
- 创建成功后，页面关闭弹窗、刷新目录，并写入一次性编辑态消费标记，随即跳转到 `/ontology/projections/detail?selected=<primaryKey>` 自动进入该投影的整宽编辑态（地址本身不含编辑态参数，刷新或分享链接仍打开查看态）。
- 协助新建：用 `present({ creating: true })` 打开弹窗，再用 `fill_form` 填入实时表单；确认提交时调用 `page_action({ operation: "createForm.save" })`（默认经读者确认后提交）。
