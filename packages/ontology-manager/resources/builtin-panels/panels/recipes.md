# 面板目录：这一页怎么用，智能体怎么做

这一页列出平台自带和本域中读者可用的面板，选中一个就显示它的概览、源码文件、成员引用、使用方、授权和原位预览；
同时列出定义已损坏的不可用面板诊断清单，选中可查看损坏原因并在有权限时删除。
所有读取和写入都通过 `platform:ProductPanel` 属主声明的标准读取与操作完成（引用投影概要与成员选择器使用
`platform:ProductProjection`，授权选择器使用 `platform:User` 和 `platform:Role`）；页面本身不直接解析原始业务记录，也不拼装业务请求。

## 页面现在显示什么

- **面板列表**（`catalogue`，`ObjectList`）：绑定 `platform:ProductPanel.query`。搜索词写进 `search`，范围 `scope`
  取 `all`（全部可用）、`mine`（我的）、`shared`（共享给我），排序 `sort` 取 `updated`（最近更新）或 `name`（名称），
  模板筛选 `templateFilter` 为布尔值（`true` 仅模板、`false` 非模板、`null` 全部）。支持每页 20/50/100 条服务端分页。
- **不可用面板清单**（`unavailableList`，`ObjectList`）：绑定 `platform:ProductPanel.unavailable`，仅在存在损坏面板时显示。
  点击某条不可用面板会将其写入 `selected`，右侧切换为诊断详情视图（`unavailableSummary`，`ObjectSummary` 展示 `id`、
  `unavailableReason`、`revision`、`objectType`）；具备删除权与修订号时可通过 `deletePanel.delete` 确认删除。
- **详情区**：选中面板后由 `ObjectHeader`（`headerTitle`）呈现标题与可见性状态，并透出属主标量输出
  （`canEdit`、`canGrant`、`canDelete`、`isBuiltin`、`isTemplate`、`domainShared`、`revision`、`hiddenUsedByCount`、
  `unavailable`、`unavailableReason`）。正常可用面板包含六个页签（`tab`）：
  1. **概览**（`overview`）：`overviewSummary`（`ObjectSummary`）展示 ID、名称、说明、所属人、公开状态、模板用途、权限、修订号、创建/更新时间与所属类。
  2. **源码**（`source`）：`sourceTree`（`ObjectTree`，读法 `sourceFiles`）列出 `panel.html`、`panel.mjs`、`panel.css`、
     `recipes.md`、`messages.json`、`manifest.json`、`theme.json`，联动 `sourceViewer`（`ObjectTextReader`，读法 `sourceFile`）只读查看当前文件（`sourceFile` 状态）。
  3. **成员引用**（`members`）：`membersList`（`ObjectList`，读法 `memberRows`）列出每个成员槽位、类型、引用目标、组件与输入/输出绑定。
     点击投影行可在当前页原位查看该投影概要（`memberProjectionHeader` + `memberProjectionSummary`，绑定 `memberProjection` 与 `platform:ProductProjection.record`），
     点击引用链接或概要卡片按钮可精准跳往投影目录选中该投影；点击子面板引用链接会切到该面板。
  4. **使用**（`usage`）：`usedByList`（`ObjectList`，读法 `usedByRows`）展示在用的应用入口（行操作可直接打开入口地址）、在用的面板与在用的对象类详情；
     无权查看的使用方数量通过横幅提示，并附页面技能与应用入口对应说明。
  5. **授权**（`grants`，仅 `canGrant` 为真时可见）：展示域内共享状态（`shareStatusDesc`）与开关（`shareEnable.share` / `shareDisable.share`）、
     `grantsList`（`ObjectList`，读法 `grantRows`，含行内撤销按钮 `grantsList.revoke`），以及「添加授权」弹窗（`userPicker` / `rolePicker` + `grantSubmit.grant`）。
  6. **预览**（`preview`）：通过动态成员 `preview`（绑定 `previewTarget`）按需在原位挂载选中面板；仅在查看态、非不可用且处于 `preview` 页签时挂载，切走即卸载。

## 公开状态与地址

- 同步到 URL 的扁平具名参数（`deepLink: true`）：`selected`、`search`、`scope`、`sort`、`templateFilter`、`tab`、`sourceFile`。
- 仅用于页面交互或操作入参、不写入 URL 的公开状态（`deepLink: false`）：`detailMode`、`creating`、`formTarget`、`previewTarget`、
  `selectedRevision`、`memberProjection`、`memberPickProjection`、`memberPickPanel`、`copyDialog`、`copyMode`、`copyId`、`copyName`、
  `copyTemplate`、`grantDialog`、`grantPrincipalKind`、`grantUser`、`grantRole`、`grantPrincipalId`、`grantVerb`。
- 仅更新 `selected` 会回到查看态（`detailMode: "view"`）并关闭已打开的复制/授权弹窗；在无未保存改动时，同一步同时传
  `selected` 与 `detailMode: "edit"` 可直接打开目标面板的编辑表单。表单存在未保存改动时，切行、新建或取消都会触发放弃确认。

## 人与智能体怎么填写表单

- 编辑与新建都使用 `ObjectForm`（成员 `form`，数据读法 `form` / `createForm`，保存操作 `form.save` 对应 `platform:ProductPanel.save`）。
  表单打开且 `/manifest/members` 可编辑时，上方同时提供候选成员选择器（`memberProjectionPicker` / `memberPanelPicker`）用于搜索已有投影或面板并写入 `/manifest/members`。
- 编辑时先用 `present` 一次设置目标面板并切入编辑态（`selected` 指向目标面板 + `detailMode: "edit"`），再用 `fill_form({ member: "form", values: { ... } })` 填入需要改动的字段。
- 新建时先用 `present` 同时清掉当前选择并开启新建态（`selected: null` + `creating: true`），再用 `fill_form({ member: "form", values: { ... } })` 填写字段。
- 表单字段 JSON Pointer 路径（与属主 `describeForm` 一致）：
  - 必填：`/name`、`/description`、`/visibility`（新建可改、编辑只读）、`/content/html`、`/content/module`、`/manifest/state`、`/manifest/members`。
  - 可选：`/template`、`/content/style`、`/content/recipes`、`/content/messages`、`/theme`。
- 需要保存时调用 `page_action({ operation: "form.save" })`（默认经读者在对话中确认后才提交）；未保存前不会产生写入。

## 人与智能体怎么执行操作

- **复制 / 另存为模板 / 从模板创建**：成员操作 `copySubmit.copy`（对应 `productPanels.copy`），接受 `{ id, name, template? }`
  （`template` 省略为普通复制、`true` 为另存为模板、`false` 为从模板创建普通面板）。入口与详情权限对齐（普通复制/另存为模板需 `canEdit`，从模板创建需 `isTemplate`，且不可用面板禁止打开），成功后按属主回执 `data.id` 选中新面板。
- **删除**：成员操作 `deletePanel.delete`（对应 `productPanels.delete`），经属主 `inspectImpact` 展示影响范围或级联投影提示并二次确认；
  被应用入口、其他面板或类详情使用时属主会拒绝；原作者或有编辑权的成员可删除不可用面板。
- **授权 / 撤销 / 域内共享**：分别由 `grantSubmit.grant`（`productPanels.grant`）、`grantsList.revoke`（`productPanels.revoke`）与
  `shareEnable.share` / `shareDisable.share`（`productPanels.share`）完成；开启域内共享时会连带共享该面板引用且你有编辑权的投影。
- 写操作在执行前须经读者确认，不要绕过页面直接发业务请求。
