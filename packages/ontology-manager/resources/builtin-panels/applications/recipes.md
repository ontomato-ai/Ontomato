# 应用目录：这一页上的活怎么干

这一页管理本域可见的应用（包含内置应用和域内应用），采用「目录与详情互切」排布：列表态全宽查看与筛选，选中一条进入详情页签查看或维护。每一项读写权限由应用目录属主按当前读者判断。

## 公开状态与导航

- `selected`：当前选中的 `platform:Application` 对象引用（深链）。为空且未新建时显示目录；有值时显示详情。
- `creating`：布尔值（深链）。页头主命令「新建应用」将其置为 `true` 并清空 `selected`。
- `tab`：当前详情页签（深链），取值为 `identity`（基本信息）、`entries`（入口）、`assets`（面板与投影）、`grants`（权限与共享），默认 `identity`。未激活的页签不挂载、不读取。
- `search`、`scope`（`visible` / `maintainable`）、`sort`（`id` / `name` / `updated`）：目录筛选与排序状态（深链）。列表按游标分页，由 `ObjectList` 管理下一页加载，不显示总数。
- `inspectedPanel`：在「面板与投影」页签中查看成员投影时选中的 `platform:ProductPanel` 引用。

## 读取与组件

- `catalogue`（`ObjectList`）：读取 `platform:Application` 的 `query`，按游标分页展示名称、来源、维护权限和入口数。
- `header`（`ObjectHeader`）：读取选中应用的 `record`，展示名称、ID、来源标签、打开应用入口以及危险操作「删除」（`applications.delete`）。
- `save`（`ObjectForm`）：新建时读取 `createForm`，维护身份时读取 `form(section="identity")`，提交 `platform:Application.save`。无维护权限时展示 `summary`（`ObjectSummary`）。
- `entriesRead` / `entriesForm`：入口页签按需读取 `entries`；可维护入口时支持行下展开编辑单条入口（`applications.updateEntry`）、行顶添加入口（`applications.addEntry`）、删除入口（`applications.deleteEntry`）以及切换到整表表单（`form(section="entries")`）。
- `grantsRead`：权限与共享页签按需读取 `grants`，支持切换域内共享（`applications.share`）、新增授权与逐行撤销指定授权（`applications.grant`）。

## 操作

| 操作 | 作用 | 输入 |
| --- | --- | --- |
| `save.save`、`entriesForm.save`（`platform:Application.save`） | 新建应用、保存身份或保存入口表 | `values`、`submittedFields` |
| `header.delete`（`applications.delete`） | 删除域内应用 | 无 |
| `addEntry.addEntry` | 添加一条入口 | `entry` |
| `updateEntry.updateEntry` | 修改指定入口 | `entryId`、`entry` |
| `deleteEntry.deleteEntry` | 删除指定入口 | `entryId` |
| `grant.grant`（`applications.grant`） | 授予或撤销成员/角色的使用或维护权限 | `principalKind`、`principalId`、`verb`、`remove` |
| `share.share`（`applications.share`） | 开启或关闭域内共享 | `shared` |
