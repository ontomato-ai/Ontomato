# 面板详情：这一页怎么用，智能体怎么做

这一页是单个面板的整宽详情入口（`/ontology/panels/detail?selected=<id>`），从面板目录点击行、通过深度链接或引用链接进入。
默认以**查看态**呈现概览、源码、成员引用、使用方、授权和原位预览；点击页头主操作「编辑」（或新建弹窗保存后自动进入）切入**整宽编辑态**；
当目标面板定义已损坏时，在原位展示不可用诊断横幅与摘要，并在具备权限和修订号时支持确认删除。
所有读取和写入都通过 `platform:ProductPanel` 属主声明的标准读取与操作完成（引用投影概要与候选选择器使用
`platform:ProductProjection`，授权选择器使用 `platform:User` 和 `platform:Role`）；页面本身不直接解析原始业务记录，也不拼装业务请求。

## 页面现在显示什么

- **单行页头**（`<page-header>`）：
  - **查看态**：左侧「返回面板」（跳 `/ontology/panels`）+ 面板标题与可见性状态（`headerTitle`，`ObjectHeader`）；右侧提供「设为个人首页」（`setAsHome.setAsHome`，对应 `productPanels.setAsHome`）、主操作「编辑」（仅可编辑且非不可用时显示）+「更多」菜单（复制、另存为模板、从模板创建、域共享与授权、红色语义「删除」）；不可用面板直接展示红色「删除」按钮。
  - **编辑态**：右侧收口为单一退出动作「取消」与主按钮「保存」（由 `usePanelFormDraft("form")` 与 `formBack` 驱动，不再并排出现取消与放弃）；点击「取消」、按 Escape 或离开页面时若有未保存改动，统一经过一次平台未保存确认（`confirmLeaveUnsaved`）。
- **查看态六个页签**（`tab`）：
  1. **概览**（`overview`）：`overviewSummary`（`ObjectSummary`）展示 ID、名称、说明、所属人、共享范围、模板用途、权限、修订号、创建/更新时间与所属类。
  2. **源码**（`source`）：`sourceTree`（`ObjectTree`，读法 `sourceFiles`）列出 `panel.html`、`panel.mjs`、`panel.css`、`recipes.md`、`messages.json`、`manifest.json`、`theme.json`，联动 `sourceViewer`（`ObjectTextReader`，读法 `sourceFile`）只读查看当前文件（`sourceFile` 状态）。
  3. **成员引用**（`members`）：`membersList`（`ObjectList`，读法 `memberRows`）列出每个成员槽位、类型、引用目标、组件与输入/输出绑定。
     点击投影行可在当前页原位查看该投影概要（`memberProjectionHeader` + `memberProjectionSummary`），点击引用链接或「在投影中打开」可跳往投影页选中该投影；点击嵌套面板引用链接会跳往 `/ontology/panels/detail?selected=<panelId>`。
  4. **使用**（`usage`）：`usedByList`（`ObjectList`，读法 `usedByRows`）展示在用的应用入口（行操作可直接打开入口地址）、在用的面板与在用的对象类详情；无权查看的使用方数量通过横幅提示，并附页面操作说明与「全部应用」入口。
  5. **授权**（`grants`，仅 `canGrant` 为真时可见）：这里做的是把面板加进某一份对象策略，是站在面板这头的快捷方式。先是域内共享状态（`shareStatusDesc`）与开关（`shareEnable.share` / `shareDisable.share`）；接着是加进某一份策略的区（`grants.title` / `grants.intro`）与 `grantsList`（`ObjectList`，读法 `grantRows`，列为策略 / 权限 / 操作，行内「从策略中移除」按钮 `grantsList.revoke`）；弹窗按先选策略、再选权限档位的顺序排列，档位用分段控件选 `USE` / `EDIT`（`policyPicker`（`platform:PermissionPolicy`） + `grantVerb`），最后由 `grantSubmit.grant` 提交。
  6. **预览**（`preview`）：通过动态成员 `preview`（绑定 `previewTarget`）按需在原位挂载当前面板；仅在查看态、非不可用且处于 `preview` 页签时挂载，切走即卸载。
- **不可用面板诊断视图**：当属主返回 `unavailable: true` 时，原位展示警告横幅与 `unavailableSummary`（`id`、`unavailableReason`、`revision`、`objectType`），不可进入编辑态，有删除权与修订号时可通过 `deletePanel.delete` 确认删除并返回目录。
- **整宽编辑态**（`detailMode: "edit"`）：
  - 当 `/manifest/members` 可编辑时，上方提供候选成员选择器（`memberProjectionPicker` / `memberPanelPicker`）与可视化成员布局区（支持主/侧栏或网格模式、列数/侧栏宽度、间距，以及逐项上移、下移、切换分栏/列宽与移除，并可按需将可视化布局同步到 HTML，同时不覆盖任意自写 Vue 源码）。
  - 下方整宽 `ObjectForm`（成员 `form`，数据读法 `form`，保存操作 `form.save` 对应 `platform:ProductPanel.save`，底部动作条隐藏改由页头驱动），完整支持编辑名称、说明、模板标记、HTML、脚本、样式、技能文档、多语言消息、状态与成员声明、主题等全部字段。

## 公开状态与地址

- 同步到 URL 的扁平具名参数（`deepLink: true`）：`selected`、`tab`、`sourceFile`。
- 不写入 URL 的公开状态（`deepLink: false`）：`detailMode`（默认 `"view"`，绝不进地址）、`previewTarget`、`selectedRevision`、`memberProjection`、`memberPickProjection`、`memberPickPanel`、`copyDialog`、`copyMode`、`copyId`、`copyName`、`copyTemplate`、`grantDialog`、`grantPolicy`、`grantPolicyId`、`grantVerb`。
- 从面板目录新建弹窗保存跳入时，会消费一次性 `sessionStorage` 键 `ontomato:open-edit:builtin-product-ontology-panel-detail:<id>` 自动进入整宽编辑态；直接刷新或分享链接保持默认查看态。
- 仅更新 `selected` 会回到查看态（`detailMode: "view"`）并关闭已打开的复制/授权弹窗；同一步同时传 `selected` 与 `detailMode: "edit"` 可直接进入目标面板的编辑态。

## 人与智能体怎么填写表单

- 编辑面板时，先用 `present` 打开 `/ontology/panels/detail` 并设置目标面板与编辑态（`selected` 指向目标面板 + `detailMode: "edit"`），再用 `fill_form({ member: "form", values: { ... } })` 填入需要改动的字段。
- 表单字段 JSON Pointer 路径（与属主 `describeForm` 一致）：
  - 必填：`/name`、`/description`、`/content/html`、`/content/module`、`/manifest/state`、`/manifest/members`（`/visibility` 在编辑态只读）。
  - 可选：`/template`、`/content/style`、`/content/recipes`、`/content/messages`、`/theme`。
- 需要保存时调用 `page_action({ operation: "form.save" })`（默认经读者在对话中确认后才提交）；保存成功后自动回到查看态并刷新数据。

## 人与智能体怎么执行操作

- **复制 / 另存为模板 / 从模板创建**：成员操作 `copySubmit.copy`（对应 `productPanels.copy`），接受 `{ id, name, template? }`（`template` 省略为普通复制、`true` 为另存为模板、`false` 为从模板创建普通面板）。普通复制/另存为模板需 `canEdit`，从模板创建需 `isTemplate`，不可用面板禁止打开；成功后按属主回执 `data.id` 跳往 `/ontology/panels/detail?selected=<newId>`。
- **删除**：成员操作 `deletePanel.delete`（对应 `productPanels.delete`，由 `usePanelOperation` 绑定），经属主 `inspectImpact` 展示影响范围或级联投影提示并二次确认；被应用入口、其他面板或类详情使用时属主会拒绝；原作者或有编辑权的成员可删除不可用面板；删除成功后自动返回 `/ontology/panels`。
- **授权 / 撤销 / 域内共享**：分别由 `grantSubmit.grant`（`productPanels.grant`）、`grantsList.revoke`（`productPanels.revoke`）与 `shareEnable.share` / `shareDisable.share`（`productPanels.share`）完成。授权和撤销都提交 `{ policyId, verb: "USE" | "EDIT" }`，使用权和编辑权独立操作。域内共享提交 `{ shared: boolean }` 并返回 `{ success: true }`。这些操作仅作用于所选面板；面板引用的投影在各自详情中授权。
- 写操作在执行前须经读者确认，不要绕过页面直接发业务请求。
