# 应用目录：这一页上的活怎么干

这一页管的是本域的应用：内置的和域内建的同列，一张一张看它的身份、入口、用到的面板和投影；有维护权的人在这里新建域内应用、
改身份、增改删入口、删除、授与撤使用授权。每一项能做什么由属主（应用目录，Java）判，这一页只是把它的答案画出来。

## 这一页的入口

- 列表是 `platform:Application` 的 `query` 读，参数就是面板状态：`search`（按名称或 ID 匹配）、`scope`（`visible` 全部可见 /
  `maintainable` 我能维护的）、`cursor`（属主给的游标，`nextCursor` 是下一页）、`size`。
- 排序由应用目录属主完成。深链状态 `sort` 为 `id`（默认顺序）、`name`（名称）或 `updated`（最近更新）。换搜索、范围、排序或页长会回到第一页，游标按原样传回属主。
- 列表用通用查询结果 `panelRecordQuery`。每行以 `primaryKey` 定位，`label` 是属主给的读者语言名称，说明在 `subtitle`。图标、来源、维护和入口数分别取 `fields.icon`、`fields.source`、`fields.maintenance`、`fields.entryCount`。
- 某个入口或面板不可用时，应用照样在列表里：不要因为读不到某一个入口就把它当成不存在。
- 选中一张应用写进面板状态 `selected`。它的 `record` 是通用 `panelRecord`，权限按 `fields.canMaintain`、`fields.canEditEntries`、`fields.canGrant` 判断。单独的 `entries` 读给入口、`panelUses`、组和适用的主题/外框，属主按读者裁剪入口。

## 读当前数据

- 当前这一张：`record` 成员的 `record` 读（`selected` 就是它读的对象）。要确认某个字段现在是什么，用它，不要凭上下文猜。
- 它用到的面板：`entries` 的 `panelUses[].panelId`；点一个面板会把面板引用写进面板状态 `inspectedPanel`，`panelInfo` 成员的 `record` 读
  拿 `platform:ProductPanel` 的这一条，成员里 `target.projectionId` 就是它用到的投影。
- “查看所属类”打开能力图谱（`/ontology/assets/capability-map`）的类型列表，深链状态为 `{"mode":"type","view":"list","selectedType":"platform:Application"}`。“面板目录”打开 `/ontology/panels` 并选中该面板。

## 起草改动

先读属主表单。新建读 `save` 成员的 `createForm`，属主会分配一个 `app-` ID；刷新表单沿用已分配的原 ID。改身份读
`save` 成员的对象 `form`，改入口读 `entriesForm` 成员的对象 `form`。两张编辑表单都从 `selected` 取得应用。

草稿只填要改的字段，字段和值以属主表单的 `fields` 为准。读者打开后核对并保存。新建只建，同一 ID 已存在时属主拒绝；
编辑入口时，属主保留未提交的应用设置和入口。编辑草稿的入口状态用 `selected` 定位应用，新建草稿用 `creating: true` 打开
新建表单。草稿格式和链接用本页技能的起草说明。

## 操作

人的按钮和你的调用是同一个操作，写之前由平台向读者确认；确认不写就什么也不发生。

| 操作 | 作用 | 输入 |
| --- | --- | --- |
| `save.save`、`entriesForm.save`（`platform:Application.save`） | 新建、保存身份或保存入口表 | `values`（属主表单字段）、`submittedFields`（你改了的字段的 JSON 指针，如 `["/names/zh-CN","/icon"]`） |
| `deleteApp.delete`（`applications.delete`） | 删除这张域内应用 | 无 |
| `addEntry.addEntry` | 加一个入口 | `entry`：`{id, pageKey, panelId, path, access, names?, groupKey?, defaultAgent?, inputs?}` |
| `updateEntry.updateEntry` | 改一个入口 | `entryId` 和完整的 `entry` |
| `deleteEntry.deleteEntry` | 删一个入口 | `entryId` |
| `grant.grant`（`applications.grant`） | 授或撤使用授权 | `{principalKind: "principal"|"role", principalId, verb: "use"|"edit", remove: true|false}` |

- 只提交改过的字段：`submittedFields` 是 JSON 指针（`~1` 转义 `/`），没写的字段属主按它现在的值保留。
- 身份里 `names` 必须有 `en`；`names` 的值不能为空字符串；`descriptions` 可以为空。
- 入口的地址要以 `/` 开头、不带问号井号空白；`pageKey` 在本域内唯一；`access` 是 `{kind:"domain-member"}`（本域成员都能进）
  或 `{permissionCode:"<平台已有的权限码>"}`；`defaultAgent` 省掉就是通用助手。
- 内置应用（`source: "builtin"`）、已发布的托管/外接和旧的非面板应用只能改身份、删除、授权，不能改入口（`canEditEntries` 为假）；
  内置应用随平台维护，这些操作属主都不认，页面上也不显示。
- 删除不能撤回；批量的意图不要拆成多次单条调用。

## 这一页的智能体

页面下方的输入框就是这一页的智能体：它读这一份说明，看得到当前选中的是哪一张应用（页面上下文里有 `selected`），
可以按上面的读去查事实、按属主表单起草，读者确认后按操作执行。答复里提到某一张应用时用它自己的名称，不要用 ID 冒充名称。
