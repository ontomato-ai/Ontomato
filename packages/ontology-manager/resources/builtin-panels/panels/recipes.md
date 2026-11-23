# 面板目录：这一页怎么用，智能体怎么做

这一页列出平台自带和本域中读者可用的面板，选中一个就显示它的概览、源码文件、成员引用、使用方、授权和原位预览。
所有读取和写入都通过 `platform:ProductPanel` 属主声明的标准读取与操作完成（授权选择器使用 `platform:User` 和
`platform:Role`）；页面本身不直接解析原始业务记录，也不拼装业务请求。

## 页面现在显示什么

- **面板列表**（`catalogue`，`ObjectList`）：绑定 `platform:ProductPanel.query`。搜索词写进 `search`，范围 `scope`
  取 `all`（全部可用）、`mine`（我的）、`shared`（共享给我），排序 `sort` 取 `updated`（最近更新）或 `name`（名称），
  模板筛选 `templateFilter` 为布尔值（`true` 仅模板、`false` 非模板、`null` 全部）。由属主解析好所属人显示名、
  可见性、模板用途与更新时间，并做服务端分页。
- **详情区**：选中面板后由 `ObjectHeader`（`headerTitle`）呈现标题与可见性状态，并透出属主标量输出
  （`canEdit`、`canGrant`、`canDelete`、`isBuiltin`、`isTemplate`、`domainShared`、`revision`、`hiddenUsedByCount`）。
  包含六个页签（`tab`）：
  1. **概览**（`overview`）：`ObjectSummary` 展示 ID、名称、说明、所属人、公开状态、模板用途、权限、修订号、创建/更新时间与所属类。
  2. **源码**（`source`）：`ObjectTree`（`sourceFiles`）列出 `panel.html`、`panel.mjs`、`panel.css`、`recipes.md`、
     `messages.json`、`manifest.json`、`theme.json`，联动 `ObjectTextReader`（`sourceFile`）只读查看当前文件（`sourceFile` 状态）。
  3. **成员引用**（`members`）：`ObjectList`（`memberRows`）列出每个成员槽位、类型、引用目标（点击投影跳往投影目录、点击子面板切到该面板）、组件与输入/输出绑定。
  4. **使用**（`usage`）：`ObjectList`（`usedByRows`）统一展示在用的应用入口（行操作可直接打开入口地址）、在用的面板与在用的对象类详情；无权查看的使用方数量通过横幅提示。
  5. **授权**（`grants`，仅 `canGrant` 为真时可见）：展示域内共享状态与开关（`productPanels.share`）、`ObjectList`（`grantRows`）含行内撤销按钮（`productPanels.revoke`），以及「添加授权」弹窗（`ReferencePicker` 选择 `platform:User`/`platform:Role` + `OperationButton` 执行 `productPanels.grant`）。
  6. **预览**（`preview`）：通过动态成员 `<projection slot="preview">` 在原位挂载选中面板。

## 公开状态与地址

- 同步到 URL 的扁平具名参数（`deepLink: true`）：`selected`、`search`、`scope`、`sort`、`templateFilter`、`tab`、`detailMode`、`sourceFile`。
- 仅用于页面交互或操作入参、不写入 URL 的公开状态：`creating`、`selectedRevision`、`copyDialog`、`copyMode`、`copyId`、`copyName`、`copyTemplate`、`grantDialog`、`grantPrincipalKind`、`grantUser`、`grantRole`、`grantPrincipalId`、`grantVerb`。

## 人与智能体怎么填写表单

- 编辑与新建都使用 `ObjectForm`（`form`）及 `platform:ProductPanel.save`。
- 编辑时先用 `present` 一次设置选中目标并切入编辑态（`selected` 指向目标面板 + `detailMode: "edit"`，与人先选面板再点「编辑」到达同一处），再用 `fill_form` 直接填入需要改动的字段。
- 新建时先用 `present` 同时清掉当前选择并开启新建态（`selected: null` + `creating: true`，与点「新建」按钮一致，避免保留页面上已选旧面板），再用 `fill_form` 至少填入 `name`、`content.html`、`content.module` 和 `manifest`。
- 需要保存时调用 `page_action({ operation: "form.save" })`（默认经读者在对话中确认后才提交）；未保存前不会产生写入。

## 人与智能体怎么执行操作

- **复制 / 另存为模板 / 从模板创建**：均由 `productPanels.copy` 完成，接受 `{ id, name, template? }`（`template` 省略为普通复制、`true` 为另存为模板、`false` 为从模板创建普通面板）。
- **删除**：由 `productPanels.delete` 完成，被应用入口、其他面板或类详情使用时属主会拒绝；成功时返回一并清理或保留的投影 ID。
- **授权 / 撤销 / 域内共享**：分别由 `productPanels.grant`、`productPanels.revoke`、`productPanels.share` 完成；开启域内共享时会连带共享该面板引用且你有编辑权的投影。
- 写操作在执行前须经读者确认，不要绕过页面直接发业务请求。
