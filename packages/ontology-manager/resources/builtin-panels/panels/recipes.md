# 面板目录：这一页怎么用，智能体怎么做

这一页是本域可用面板的整宽目录，同时列出定义已损坏、需要诊断或清理的不可用面板，并在页头提供居中弹窗新建入口。
所有读取和新建写入均通过 `platform:ProductPanel` 属主声明的标准读取与操作完成；点击任意面板行（含不可用面板）都会跳往整宽详情入口 `/ontology/panels/detail?selected=<id>`。

## 页面现在显示什么

- **面板目录**（`catalogue`，`ObjectList`，整宽表格）：绑定 `platform:ProductPanel.query`。
  - 搜索词写进 `search`，范围 `scope` 取 `all`（全部可用）、`mine`（我的）、`shared`（共享给我），
    排序 `sort` 取 `updated`（最近更新）或 `name`（名称），模板筛选 `templateFilter` 取 `true`（仅模板）、`false`（非模板）或 `null`（全部）。
  - 支持每页 20/50/100 条服务端分页；页码不写入 URL。点击任意行（`@choose`）进入 `/ontology/panels/detail?selected=<id>`。
- **不可用面板清单**（`unavailableList`，`ObjectList`）：绑定 `platform:ProductPanel.unavailable`，仅在存在损坏面板时显示。
  - 点击任意不可用面板条目会跳往 `/ontology/panels/detail?selected=<id>`，在详情页查看损坏原因并在有权限时确认删除。
- **新建面板弹窗**（`createForm`，`ObjectForm`，`actions: "create-only"`）：点击页头主按钮「新建面板」或设置 `creating: true` 打开居中 `<sdk-dialog>`。
  - 后端 `createForm` 已预填最小合法骨架（`content.html`、`content.module`、`manifest: { state: {}, members: {} }`），弹窗仅展示少量基础字段：
    `/name`、`/id`、`/description`、`/visibility`、`/template`。
  - 关闭弹窗（取消、右上角关闭、遮罩、ESC）前若存在未保存改动，会触发平台的未保存离开确认，确认放弃后才关闭。
  - 创建成功后按属主回执 `primaryKey` 写入一次性编辑态提示并自动跳往 `/ontology/panels/detail?selected=<primaryKey>` 的整宽编辑态，继续编写 HTML、脚本、声明与成员。

## 公开状态与地址

- 同步到 URL 的扁平具名参数（`deepLink: true`）：`search`、`scope`、`sort`、`templateFilter`。
- 不写入 URL 的公开状态（`deepLink: false`）：`creating`（居中新建弹窗开关）。
- 返回目录时由平台保活并自动刷新列表；无需在面板内自写保活逻辑。

## 人与智能体怎么操作

- **筛选与查找**：用 `present` 设置 `/ontology/panels` 的 `search`、`scope`、`sort`、`templateFilter`。
- **打开面板详情或诊断不可用面板**：用 `present` 直接打开 `/ontology/panels/detail?selected=<panelId>`。
- **新建面板**：
  1. 用 `present` 将 `creating` 设为 `true` 打开新建弹窗。
  2. 用 `fill_form({ member: "createForm", values: { name: "...", description: "...", visibility: "private", template: false } })` 填入基础字段（可选填 `id`）。
  3. 需要保存时调用 `page_action({ operation: "createForm.save" })`（默认经读者在对话中确认后才提交）；保存成功后页面自动跳入新面板的整宽详情编辑态。
- 写操作在执行前须经读者确认，不要绕过页面直接发业务请求。
